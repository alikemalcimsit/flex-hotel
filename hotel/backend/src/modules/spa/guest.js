import { toIsoDay } from '@hotelos/core';
import { SPA_ACTIVE_STATUSES, SPA_LANGUAGES, SPA_PORTAL_SESSION_LIMIT, spaPortalWindow, spaServiceText } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { resolvePortalToken, touchPortalLink } from '../guest-portal/links.js';
import { APPOINTMENT_SELECT, appointmentView, closeSpaAppointment, createSpaAppointment, spaViewContext } from './appointments.js';
import { spaListPrice, spaTotal } from './rules.js';
import { spaAvailability } from './schedule.js';
import { enrollSpaSession } from './sessions.js';
import { dayBounds, minutesAfter, money, prisma, wallParts } from './shared.js';

/**
 * Misafir portalının spa uçları (modül 57), `/public/portal/:token/spa` altında. Oturumsuzdur: kimlik portal
 * bağlantısının imzasıdır (modül 53), hız sınırı route'ta. Misafir yalnız **kendi konaklamasının** kayıtlarını görür
 * ve yalnız konaklama günlerine (giriş – çıkış) randevu alır.
 *
 * - Randevu **anında kesinleşir**: gerçekten boş saatler gösterilir, terapist ve oda otomatik atanır; spa'ya zil
 *   düşer. Terapistin adı misafire gösterilmez (yalnız tercih ettiği cinsiyet gözetilir).
 * - Sınırlar spa ayarından: en erken şimdiden `portalLeadMinutes` sonrası, konaklama başına en çok
 *   `portalMaxActive` açık kayıt.
 * - İptalde bedel ayardaki kuralla işler; misafir onaylamadan önce bedeli görür (`cancelFee`).
 */

/** Portalın spa'sı bu konaklama durumlarında açıktır (gelmeden önce de randevu alınır). */
const PORTAL_STAY_STATUSES = Object.freeze(['CONFIRMED', 'CHECKED_IN']);
/** Misafire gösterilen en fazla kayıt (geçmiş dahil). */
const PORTAL_APPOINTMENT_LIMIT = 50;

/**
 * Bağlantıyı çözer ve spa'nın bu konaklamaya açık olup olmadığını söyler.
 * @param {string} token @param {Date} [now]
 */
async function portalSpaContext(token, now = new Date()) {
  const { link, reservation } = await resolvePortalToken(prisma, token);
  const view = await spaViewContext(link.hotelId, now);
  const window = spaPortalWindow({ checkIn: toIsoDay(reservation.checkIn), checkOut: toIsoDay(reservation.checkOut), today: view.today });
  const enabled = view.settings.portalEnabled && PORTAL_STAY_STATUSES.includes(reservation.status) && Boolean(window);
  return { link, reservation, hotelId: link.hotelId, view, window, enabled, earliest: minutesAfter(now, view.settings.portalLeadMinutes) };
}

/** @param {{ enabled: boolean }} context */
function assertOpen(context) {
  if (!context.enabled) throw new ConflictError('Spa randevusu şu an portaldan alınamıyor; lütfen resepsiyonu arayın.', 'SPA_PORTAL_CLOSED');
}

/** @param {{ window: { from: string, to: string } | null }} context @param {string} day */
function assertInWindow(context, day) {
  if (!context.window || day < context.window.from || day > context.window.to) throw new ValidationError('Randevu yalnız konaklama günlerinize alınabilir.', { field: 'day' });
}

/** @param {{ hotelId: string, reservation: { id: string }, view: any }} context */
async function assertBelowLimit({ hotelId, reservation, view }) {
  const active = await prisma.spaAppointment.count({ where: { hotelId, reservationId: reservation.id, status: { in: SPA_ACTIVE_STATUSES } } });
  if (active >= view.settings.portalMaxActive) {
    throw new ConflictError(`Aynı anda en fazla ${view.settings.portalMaxActive} açık randevunuz olabilir; daha fazlası için spa resepsiyonunu arayın.`, 'SPA_PORTAL_LIMIT');
  }
}

/** Dört dilde ad ve açıklama. @param {any} service */
const texts = (service) => Object.fromEntries(SPA_LANGUAGES.map((language) => [language, spaServiceText(service, language)]));

/** Misafire giden kayıt: personel alanları (not, gerekçe, terapist adı, kim açtı) yok. @param {any} row @param {any} view */
function guestAppointment(row, view) {
  const item = appointmentView(row, view);
  return {
    id: item.id,
    code: item.code,
    kind: item.kind,
    serviceId: item.serviceId,
    sessionId: item.sessionId,
    serviceName: item.serviceName,
    day: item.day,
    time: item.time,
    endTime: item.endTime,
    status: item.status,
    guestCount: item.guestCount,
    priceTotal: item.priceTotal,
    totalDue: item.totalDue,
    roomName: item.room?.name ?? null,
    /** Saati gelmemiş açık kayıt portaldan iptal edilebilir; bedeli (varsa) onaydan önce gösterilir. */
    canCancel: SPA_ACTIVE_STATUSES.includes(item.status) && !item.started,
    cancelFee: item.status === 'BOOKED' && item.cancelFee && Number(item.cancelFee.total) > 0 ? { pct: item.cancelFee.pct, total: item.cancelFee.total } : null,
  };
}

/**
 * Portalın spa sayfası: politika, randevu alınabilecek günler, hizmetler, yaklaşan dersler ve misafirin kayıtları.
 * @param {string} token @param {{ now?: Date }} [options]
 */
export async function portalSpa(token, { now = new Date() } = {}) {
  const context = await portalSpaContext(token, now);
  const { hotelId, reservation, view, window } = context;
  await touchPortalLink(context.link);
  const mine = await prisma.spaAppointment.findMany({
    where: { hotelId, reservationId: reservation.id },
    select: APPOINTMENT_SELECT,
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: PORTAL_APPOINTMENT_LIMIT,
  });
  const base = {
    enabled: context.enabled,
    currency: view.currency,
    window,
    policy: {
      freeCancelHours: view.settings.freeCancelHours,
      lateCancelFeePct: view.settings.lateCancelFeePct,
      noShowFeePct: view.settings.noShowFeePct,
      leadMinutes: view.settings.portalLeadMinutes,
      maxActive: view.settings.portalMaxActive,
    },
    activeCount: mine.filter((row) => SPA_ACTIVE_STATUSES.includes(row.status)).length,
    appointments: mine.map((row) => guestAppointment(row, view)).reverse(),
  };
  if (!context.enabled || !window) return { ...base, services: [], sessions: [] };

  const range = { gte: new Date(Math.max(dayBounds(window.from, view.timezone).start.getTime(), context.earliest.getTime())), lt: dayBounds(window.to, view.timezone).end };
  const [services, sessions] = await Promise.all([
    prisma.spaService.findMany({
      where: { hotelId, isActive: true, portalBookable: true },
      select: { id: true, name: true, description: true, translations: true, category: true, kind: true, durationMinutes: true, price: true, guestCount: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.spaSession.findMany({
      where: { hotelId, status: 'SCHEDULED', startsAt: range, service: { portalBookable: true, isActive: true } },
      select: { id: true, serviceId: true, startsAt: true, endsAt: true, capacity: true, bookedCount: true, price: true, holds: { select: { roomId: true, room: { select: { name: true } } } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: SPA_PORTAL_SESSION_LIMIT,
    }),
  ]);
  const enrolled = new Map(mine.filter((row) => row.sessionId && SPA_ACTIVE_STATUSES.includes(row.status)).map((row) => [row.sessionId, row.status]));
  return {
    ...base,
    services: services.map((service) => ({
      id: service.id,
      kind: service.kind,
      category: service.category,
      durationMinutes: service.durationMinutes,
      guestCount: service.guestCount,
      /** Randevunun toplamı (çift masajında iki kişi); grup dersinde kişi başı. */
      priceTotal: spaTotal(spaListPrice(money(service.price), service.kind === 'PRIVATE' ? service.guestCount : 1), view.taxes),
      texts: texts(service),
    })),
    sessions: sessions.map((session) => {
      const start = wallParts(session.startsAt, view.timezone);
      return {
        id: session.id,
        serviceId: session.serviceId,
        day: start.day,
        time: start.time,
        endTime: wallParts(session.endsAt, view.timezone).time,
        free: Math.max(0, session.capacity - session.bookedCount),
        priceTotal: spaTotal(money(session.price), view.taxes),
        roomName: session.holds.find((hold) => hold.roomId)?.room?.name ?? null,
        enrolled: enrolled.get(session.id) ?? null,
      };
    }),
  };
}

/**
 * Bir hizmetin bir gündeki boş saatleri (yalnız boş olanlar).
 * @param {string} token @param {{ serviceId: string, day: string, gender?: string }} query @param {{ now?: Date }} [options]
 */
export async function portalSpaAvailability(token, query, { now = new Date() } = {}) {
  const context = await portalSpaContext(token, now);
  assertOpen(context);
  assertInWindow(context, query.day);
  const result = await spaAvailability(context.hotelId, query, { leadMinutes: context.view.settings.portalLeadMinutes, portal: true });
  return { day: result.day, times: result.slots.filter((slot) => slot.available).map((slot) => slot.time) };
}

/**
 * Randevu alır (anında kesinleşir).
 * @param {string} token @param {{ requestId: string, serviceId: string, day: string, time: string, gender: string | null, note?: string | null }} input
 * @param {{ now?: Date }} [options]
 */
export async function portalSpaBook(token, input, { now = new Date() } = {}) {
  const context = await portalSpaContext(token, now);
  assertOpen(context);
  assertInWindow(context, input.day);
  await assertBelowLimit(context);
  const result = await createSpaAppointment(
    context.hotelId,
    { requestId: input.requestId, serviceId: input.serviceId, startsAt: `${input.day}T${input.time}`, reservationId: context.reservation.id, therapistPreference: input.gender, note: input.note ?? null },
    { source: 'PORTAL', earliest: context.earliest, now },
  );
  return { created: result.created, appointment: guestAppointment(await readOwn(context, result.appointment.id), context.view) };
}

/**
 * Grup dersine kaydolur (yer yoksa ve istenmişse yedek listeye).
 * @param {string} token @param {string} sessionId @param {{ requestId: string, guestCount: number, waitlist: boolean }} input @param {{ now?: Date }} [options]
 */
export async function portalSpaEnroll(token, sessionId, input, { now = new Date() } = {}) {
  const context = await portalSpaContext(token, now);
  assertOpen(context);
  const session = await prisma.spaSession.findFirst({ where: { id: sessionId, hotelId: context.hotelId }, select: { startsAt: true } });
  if (!session) throw new NotFoundError('Ders bulunamadı');
  assertInWindow(context, wallParts(session.startsAt, context.view.timezone).day);
  await assertBelowLimit(context);
  const result = await enrollSpaSession(context.hotelId, sessionId, { ...input, reservationId: context.reservation.id, note: null }, { source: 'PORTAL', earliest: context.earliest, now });
  return { created: result.created, waitlisted: result.waitlisted, appointment: guestAppointment(await readOwn(context, result.appointmentId), context.view) };
}

/**
 * Misafirin kendi kaydını iptal eder (saati gelmemişse). Bedel ayardaki kuralla işler.
 * @param {string} token @param {string} appointmentId @param {{ now?: Date }} [options]
 */
export async function portalSpaCancel(token, appointmentId, { now = new Date() } = {}) {
  const context = await portalSpaContext(token, now);
  await readOwn(context, appointmentId);
  await closeSpaAppointment(context.hotelId, appointmentId, { reason: 'Misafir portaldan iptal etti' }, { outcome: 'CANCELLED', source: 'PORTAL', reservationId: context.reservation.id, now });
  return { appointment: guestAppointment(await readOwn(context, appointmentId), context.view) };
}

/** Kayıt bu konaklamanın mı? Değilse "bulunamadı" (başkasının kaydının varlığı sızmaz). @param {any} context @param {string} appointmentId */
async function readOwn({ hotelId, reservation }, appointmentId) {
  const row = await prisma.spaAppointment.findFirst({ where: { id: appointmentId, hotelId, reservationId: reservation.id }, select: APPOINTMENT_SELECT });
  if (!row) throw new NotFoundError('Randevu bulunamadı');
  return row;
}
