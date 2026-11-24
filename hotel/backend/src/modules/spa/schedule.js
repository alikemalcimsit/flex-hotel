import { SPA_PICK_ERRORS, pickSpaResources, spaSlotMinutes, spaTimeOfMinute, spaWeekday } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { blockView } from './setup.js';
import { dayBounds, iso, loadSpaSettings, minutesAfter, prisma, spaContext, wallParts, wallToUtc } from './shared.js';

/**
 * Spa takvimi ve boş saat hesabı (modül 57).
 *
 * Bir hizmetin bir günde verilebileceği saatler: açılıştan kapanışa aralık adımıyla; her adım için hizmeti
 * verebilen, o saatte çalışan ve **temizlik arası dahil** boş terapist(ler) ile uygun, boş bir oda aranır
 * (`pickSpaResources`, sözleşmede — birim testli). Doluluk `SpaHold`'un etkin satırlarından (randevu, seans) ve
 * bloklardan okunur; günün verisi birkaç sorguyla çekilir, adımlar bellekte denenir (N+1 yok).
 *
 * Hesap bir **öneridir**: iki kişi aynı anda aynı saati alırsa ikincisini veritabanının EXCLUDE kısıtı reddeder.
 */

/** En uzun dolu aralık (hizmet 600 dk + ara 120 dk): günün penceresi bu kadar geriden okunur. */
const MAX_HOLD_MINUTES = 720;
/** Kapanışa yakın başlayan hizmetin temizlik arası gün sonunu bu kadar aşabilir. */
const DAY_TAIL_MINUTES = 120;
/** Takvimde bir günde gösterilen en fazla tutma satırı (büyük bir spa günde birkaç yüzü geçmez). */
const CALENDAR_HOLD_LIMIT = 4000;

const SERVICE_PLACEMENT_SELECT = Object.freeze({
  id: true,
  name: true,
  description: true,
  translations: true,
  category: true,
  kind: true,
  durationMinutes: true,
  bufferMinutes: true,
  price: true,
  therapistCount: true,
  guestCount: true,
  capacity: true,
  requiresRoom: true,
  portalBookable: true,
  isActive: true,
});

/**
 * Randevu verilebilen hizmet (silinmemiş). `active`: kullanımdan kaldırılana yeni randevu verilmez.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} serviceId
 * @param {{ kind?: 'PRIVATE' | 'GROUP', field?: string }} [options]
 */
export async function loadBookableService(client, hotelId, serviceId, { kind = 'PRIVATE', field = 'serviceId' } = {}) {
  const service = await client.spaService.findFirst({ where: { id: serviceId, hotelId }, select: SERVICE_PLACEMENT_SELECT });
  if (!service) throw new NotFoundError('Hizmet bulunamadı');
  if (service.kind !== kind) throw new ValidationError(kind === 'PRIVATE' ? 'Grup dersine randevu açılmaz; dersin seansına kayıt yapın.' : 'Bu hizmet grup dersi değil.', { field });
  if (!service.isActive) throw new ValidationError('Bu hizmet kullanımda değil.', { field });
  return service;
}

/**
 * Hizmeti bir güne yerleştirmek için gereken veri: hizmeti verebilen kullanımdaki terapistler (çalışma saatleri,
 * dolu aralıkları, o günkü yükleri) ve uygun odalar (dolu aralıkları).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {{ serviceId: string, day: string, timezone: string, ignoreAppointmentId?: string | null, ignoreSessionId?: string | null }} input
 */
export async function loadDayBoard(client, hotelId, { serviceId, day, timezone, ignoreAppointmentId = null, ignoreSessionId = null }) {
  const { start, end } = dayBounds(day, timezone);
  const [therapists, rooms] = await Promise.all([
    client.spaTherapist.findMany({
      where: { hotelId, isActive: true, services: { some: { serviceId } } },
      select: { id: true, name: true, gender: true, sortOrder: true, hours: { select: { weekday: true, startMinute: true, endMinute: true } } },
    }),
    client.spaRoom.findMany({ where: { hotelId, isActive: true, services: { some: { serviceId } } }, select: { id: true, name: true, sortOrder: true } }),
  ]);
  const therapistIds = therapists.map((row) => row.id);
  const roomIds = rooms.map((row) => row.id);
  const resources = [...(therapistIds.length ? [{ therapistId: { in: therapistIds } }] : []), ...(roomIds.length ? [{ roomId: { in: roomIds } }] : [])];
  const windowEnd = minutesAfter(end, DAY_TAIL_MINUTES);
  const [holds, blocks] = resources.length
    ? await Promise.all([
        client.spaHold.findMany({
          where: {
            hotelId,
            active: true,
            blockId: null,
            startsAt: { gte: minutesAfter(start, -MAX_HOLD_MINUTES), lt: windowEnd },
            endsAt: { gt: start },
            OR: resources,
            // Yeniden planlamada kaydın kendi tutmaları boş sayılır.
            NOT: [...(ignoreAppointmentId ? [{ appointmentId: ignoreAppointmentId }] : []), ...(ignoreSessionId ? [{ sessionId: ignoreSessionId }] : [])],
          },
          select: { therapistId: true, roomId: true, startsAt: true, endsAt: true },
        }),
        client.spaBlock.findMany({ where: { hotelId, endsAt: { gt: start }, startsAt: { lt: windowEnd }, OR: resources }, select: { therapistId: true, roomId: true, startsAt: true, endsAt: true } }),
      ])
    : [[], []];

  /** @type {Map<string, Array<{ start: number, end: number }>>} */
  const busy = new Map();
  /** @type {Map<string, number>} */
  const load = new Map();
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const row of [...holds, ...blocks]) {
    const key = row.therapistId ?? row.roomId;
    const interval = { start: row.startsAt.getTime(), end: row.endsAt.getTime() };
    busy.set(key, [...(busy.get(key) ?? []), interval]);
  }
  // Yük: terapistin o gün içindeki randevu / ders dakikaları (bloklar yük sayılmaz).
  for (const row of holds) {
    if (!row.therapistId) continue;
    const minutes = (Math.min(row.endsAt.getTime(), endMs) - Math.max(row.startsAt.getTime(), startMs)) / 60_000;
    if (minutes > 0) load.set(row.therapistId, (load.get(row.therapistId) ?? 0) + minutes);
  }
  return {
    weekday: spaWeekday(day),
    therapists: therapists.map((row) => ({ ...row, busy: busy.get(row.id) ?? [], load: load.get(row.id) ?? 0 })),
    rooms: rooms.map((row) => ({ ...row, busy: busy.get(row.id) ?? [] })),
  };
}

/**
 * Günün boş saatleri.
 *
 * @param {string} hotelId
 * @param {{ serviceId: string, day: string, therapistId?: string, gender?: string, ignoreAppointmentId?: string }} query
 * @param {{ leadMinutes?: number, portal?: boolean }} [options] `leadMinutes`: şimdiden en az bu kadar sonra başlayan saatler
 */
export async function spaAvailability(hotelId, query, { leadMinutes = 0, portal = false } = {}) {
  const [context, settings] = await Promise.all([spaContext(hotelId), loadSpaSettings(prisma, hotelId)]);
  const service = await loadBookableService(prisma, hotelId, query.serviceId);
  if (portal && !service.portalBookable) throw new NotFoundError('Hizmet bulunamadı');
  const board = await loadDayBoard(prisma, hotelId, { serviceId: service.id, day: query.day, timezone: context.timezone, ignoreAppointmentId: query.ignoreAppointmentId ?? null });
  if (query.therapistId && service.therapistCount !== 1) throw new ValidationError('Terapist süzgeci yalnız tek terapistli hizmette kullanılır.', { field: 'therapistId' });
  const earliest = context.now.getTime() + leadMinutes * 60_000;
  const slots = spaSlotMinutes({ ...settings, durationMinutes: service.durationMinutes }).map((minute) => {
    const time = spaTimeOfMinute(minute);
    const at = wallToUtc(`${query.day}T${time}`, context.timezone).getTime();
    if (at < earliest) return { time, available: false };
    const pick = pickSpaResources({ service, weekday: board.weekday, minute, at, therapists: board.therapists, rooms: board.rooms, therapistIds: query.therapistId ? [query.therapistId] : null, gender: query.gender ?? null });
    return { time, available: !('error' in pick) };
  });
  return {
    day: query.day,
    service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, therapistCount: service.therapistCount, requiresRoom: service.requiresRoom },
    slots,
    /** Hiç boş saat yoksa ekran sebebi söyler: tanım eksik mi, gün mü dolu. */
    staffed: board.therapists.length >= service.therapistCount && (!service.requiresRoom || board.rooms.length > 0),
  };
}

/**
 * Randevuyu yerleştirir: istenen saat için terapist(ler) ve oda seçer (ya da istenenleri doğrular).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{
 *   service: { id: string, therapistCount: number, requiresRoom: boolean, durationMinutes: number, bufferMinutes: number },
 *   startsAt: Date, timezone: string, settings: { openMinute: number, closeMinute: number, slotMinutes: number },
 *   therapistIds?: string[] | null, roomId?: string | null, gender?: string | null,
 *   ignoreAppointmentId?: string | null, ignoreSessionId?: string | null, field?: string, onGrid?: boolean,
 * }} input
 *   `onGrid`: başlangıç ayardaki aralığa oturmalı (yeni saat). Saati değişmeyen kaydın yalnız terapisti / odası
 *   değişiyorsa `false`: aralık ayarı sonradan değiştiyse eski saat engellenmesin.
 * @returns {Promise<{ therapistIds: string[], roomId: string | null, endsAt: Date, busyUntil: Date }>}
 */
export async function placeOnBoard(tx, hotelId, { service, startsAt, timezone, settings, therapistIds = null, roomId = null, gender = null, ignoreAppointmentId = null, ignoreSessionId = null, field = 'startsAt', onGrid = true }) {
  const local = wallParts(startsAt, timezone);
  if (local.minute < settings.openMinute || local.minute + service.durationMinutes > settings.closeMinute) {
    throw new ValidationError(`Spa ${spaTimeOfMinute(settings.openMinute)}–${spaTimeOfMinute(settings.closeMinute)} arası açık; hizmet kapanıştan önce bitmeli.`, { field });
  }
  if (onGrid && (local.minute - settings.openMinute) % settings.slotMinutes !== 0) {
    throw new ValidationError(`Saat randevu aralığına oturmalı: açılıştan (${spaTimeOfMinute(settings.openMinute)}) itibaren ${settings.slotMinutes} dakikada bir.`, { field });
  }
  const board = await loadDayBoard(tx, hotelId, { serviceId: service.id, day: local.day, timezone, ignoreAppointmentId, ignoreSessionId });
  const pick = pickSpaResources({ service, weekday: board.weekday, minute: local.minute, at: startsAt.getTime(), therapists: board.therapists, rooms: board.rooms, therapistIds, roomId, gender });
  if ('error' in pick) {
    const target = pick.error === 'NO_ROOM' || pick.error === 'ROOM_BUSY' ? (roomId ? 'roomId' : field) : therapistIds ? 'therapistIds' : field;
    throw new ConflictError(SPA_PICK_ERRORS[pick.error], 'SPA_SLOT_TAKEN', { field: target, reason: pick.error });
  }
  const endsAt = minutesAfter(startsAt, service.durationMinutes);
  return { ...pick, endsAt, busyUntil: minutesAfter(endsAt, service.bufferMinutes) };
}

/**
 * Kaynak tutmalarını yazar (terapist başına ve oda için birer satır). Çakışma varsa EXCLUDE kısıtı reddeder.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ appointmentId?: string, sessionId?: string, therapistIds: string[], roomId: string | null, startsAt: Date, busyUntil: Date }} input
 */
export async function writeHolds(tx, hotelId, { appointmentId, sessionId, therapistIds, roomId, startsAt, busyUntil }) {
  const owner = appointmentId ? { appointmentId } : { sessionId };
  const rows = [...therapistIds.map((therapistId) => ({ hotelId, ...owner, therapistId, startsAt, endsAt: busyUntil })), ...(roomId ? [{ hotelId, ...owner, roomId, startsAt, endsAt: busyUntil }] : [])];
  if (rows.length) await tx.spaHold.createMany({ data: rows });
}

/* ══════════════════ Takvim ══════════════════ */

const CALENDAR_APPOINTMENT_SELECT = Object.freeze({
  id: true,
  code: true,
  serviceName: true,
  category: true,
  startsAt: true,
  endsAt: true,
  busyUntil: true,
  guestCount: true,
  customerName: true,
  roomNumber: true,
  status: true,
  source: true,
  note: true,
  therapistPreference: true,
  balance: true,
  updatedAt: true,
});
const CALENDAR_SESSION_SELECT = Object.freeze({ id: true, serviceName: true, startsAt: true, endsAt: true, capacity: true, bookedCount: true, waitlistCount: true, status: true, note: true, updatedAt: true });

/**
 * Günün takvimi: terapistler (o günkü çalışma dilimleriyle), odalar ve günün kayıtları (randevu, seans, blok).
 * Her kayıt tuttuğu terapist(ler) ve odayla birlikte gelir; ekran terapist ya da oda sütunlarına dizer. Tamamlanan
 * randevular da görünür (tutmaları etkin kalır); iptal / gelmedi takvimde yer tutmaz.
 *
 * @param {string} hotelId @param {{ day: string }} query
 */
export async function getSpaCalendar(hotelId, { day }) {
  const [context, settings] = await Promise.all([spaContext(hotelId), loadSpaSettings(prisma, hotelId)]);
  const { start, end } = dayBounds(day, context.timezone);
  const weekday = spaWeekday(day);
  const [therapists, rooms, holds, blocks] = await Promise.all([
    prisma.spaTherapist.findMany({
      where: { hotelId },
      select: { id: true, name: true, title: true, gender: true, isActive: true, sortOrder: true, hours: { where: { weekday }, select: { startMinute: true, endMinute: true }, orderBy: { startMinute: 'asc' } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.spaRoom.findMany({ where: { hotelId }, select: { id: true, name: true, kind: true, isActive: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.spaHold.findMany({
      where: { hotelId, active: true, blockId: null, startsAt: { gte: minutesAfter(start, -MAX_HOLD_MINUTES), lt: end }, endsAt: { gt: start } },
      select: {
        therapistId: true,
        roomId: true,
        appointmentId: true,
        sessionId: true,
        therapist: { select: { name: true } },
        room: { select: { name: true } },
        appointment: { select: CALENDAR_APPOINTMENT_SELECT },
        session: { select: CALENDAR_SESSION_SELECT },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: CALENDAR_HOLD_LIMIT + 1,
    }),
    prisma.spaBlock.findMany({
      where: { hotelId, endsAt: { gt: start }, startsAt: { lt: end } },
      select: { id: true, therapistId: true, roomId: true, startsAt: true, endsAt: true, reason: true, createdBy: true, therapist: { select: { name: true } }, room: { select: { name: true } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
  ]);

  const startMs = start.getTime();
  const minuteOf = (value) => Math.round((value.getTime() - startMs) / 60_000);
  /** @type {Map<string, any>} */
  const items = new Map();
  for (const hold of holds.slice(0, CALENDAR_HOLD_LIMIT)) {
    const source = hold.appointment ?? hold.session;
    const key = hold.appointmentId ?? hold.sessionId;
    if (!source || !key) continue;
    let item = items.get(key);
    if (!item) {
      const local = wallParts(source.startsAt, context.timezone);
      item = hold.appointment
        ? {
            type: 'APPOINTMENT',
            id: source.id,
            code: source.code,
            title: source.customerName,
            subtitle: source.serviceName,
            category: source.category,
            status: source.status,
            source: source.source,
            guestCount: source.guestCount,
            roomNumber: source.roomNumber,
            note: source.note,
            therapistPreference: source.therapistPreference,
            hasBalance: Number(source.balance) !== 0 && source.status !== 'BOOKED',
            busyMinute: minuteOf(source.busyUntil),
          }
        : {
            type: 'SESSION',
            id: source.id,
            title: source.serviceName,
            subtitle: `${source.bookedCount} / ${source.capacity} kişi${source.waitlistCount ? ` · ${source.waitlistCount} yedek` : ''}`,
            status: source.status,
            capacity: source.capacity,
            bookedCount: source.bookedCount,
            waitlistCount: source.waitlistCount,
            note: source.note,
            busyMinute: minuteOf(source.endsAt),
          };
      Object.assign(item, { startsAt: iso(source.startsAt), endsAt: iso(source.endsAt), time: local.time, startMinute: minuteOf(source.startsAt), endMinute: minuteOf(source.endsAt), updatedAt: iso(source.updatedAt), therapistIds: [], therapistNames: [], roomId: null, roomName: null });
      items.set(key, item);
    }
    if (hold.therapistId) {
      item.therapistIds.push(hold.therapistId);
      item.therapistNames.push(hold.therapist?.name ?? '—');
    }
    if (hold.roomId) {
      item.roomId = hold.roomId;
      item.roomName = hold.room?.name ?? '—';
    }
  }

  return {
    day,
    today: context.today,
    nowMinute: day === context.today ? minuteOf(context.now) : null,
    currency: context.currency,
    openMinute: settings.openMinute,
    closeMinute: settings.closeMinute,
    slotMinutes: settings.slotMinutes,
    truncated: holds.length > CALENDAR_HOLD_LIMIT,
    therapists: therapists.map((row) => ({ id: row.id, name: row.name, title: row.title, gender: row.gender, isActive: row.isActive, working: row.hours.map((hour) => ({ startMinute: hour.startMinute, endMinute: hour.endMinute })) })),
    rooms: rooms.map((row) => ({ id: row.id, name: row.name, kind: row.kind, isActive: row.isActive })),
    items: [...items.values()],
    blocks: blocks.map((row) => ({ ...blockView(row, context.timezone), startMinute: Math.max(0, minuteOf(row.startsAt)), endMinute: Math.min(1440, minuteOf(row.endsAt)) })),
  };
}
