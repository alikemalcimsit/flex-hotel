import { KBS_DONE_STATES, kbsMissingFields, kbsMissingText } from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { KBS_PERSON_SELECT, documentMasked, fullName, loadKbsSettings, prisma } from './shared.js';

/**
 * KBS kuyruğu (modül 58): giriş / çıkış / oda değişikliği / geri alma olaylarından kişi başına bildirim açar. Aktör (kbs-worker)
 * çağırır; gönderimi gönderici yapar (`dispatcher.js`).
 *
 * Kişinin **zinciri**: aynı konaklamada aynı kişinin iptal edilmemiş bildirimleri (oluşma sırasıyla). Yeni bildirim zincirin son
 * halkasına bağlanır (`dependsOnId`): çıkış, giriş bildirilmeden gönderilmez. Kişi "içeride bildirilmiş" sayılır: zincirde bir
 * giriş var ve ondan sonra çıkış yok. Kaynak anahtarı tekil: aynı olay iki kez gelse de ikinci bildirim açılmaz.
 */

/** @type {() => void} */
let kick = () => {};
/** Gönderici tetikleyicisini bağlar (döngüsel içe aktarmayı önler). @param {() => void} fn */
export function onKbsEnqueued(fn) {
  kick = fn;
}

const OPEN_STATES = Object.freeze(['PENDING', 'FAILED']);

/** @param {any} client @param {string} hotelId @param {string} reservationId */
async function loadStay(client, hotelId, reservationId) {
  const stay = await client.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: {
      id: true,
      status: true,
      guestId: true,
      checkedInAt: true,
      checkedOutAt: true,
      confirmationCode: true,
      room: { select: { number: true } },
      reservationGuests: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { guest: { select: KBS_PERSON_SELECT } } },
      guest: { select: KBS_PERSON_SELECT },
    },
  });
  if (!stay) throw new NotFoundError('Rezervasyon bulunamadı');
  const people = stay.reservationGuests.length > 0 ? stay.reservationGuests.map((row) => row.guest) : [stay.guest];
  return { ...stay, people };
}

/** Konaklamanın kişi başına zincirleri. @param {any} client @param {string} hotelId @param {string} reservationId */
async function chainsOf(client, hotelId, reservationId) {
  const rows = await client.kbsNotification.findMany({ where: { hotelId, reservationId, state: { not: 'CANCELLED' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  /** @type {Map<string, any[]>} */
  const chains = new Map();
  for (const row of rows) chains.set(row.guestId, [...(chains.get(row.guestId) ?? []), row]);
  return chains;
}

/** Zincirde son girişten sonraki halkalar (giriş dahil); çıkış geldiyse boş. @param {any[]} chain */
export function activeStretch(chain) {
  const lastIn = chain.map((row) => row.kind).lastIndexOf('CHECK_IN');
  if (lastIn < 0) return [];
  const stretch = chain.slice(lastIn);
  return stretch.some((row) => row.kind === 'CHECK_OUT') ? [] : stretch;
}

/** Çıkış / oda değişikliği: kişinin görünen bilgisi zincirden. @param {string} guestId @param {any[]} chain */
const carried = (guestId, chain) => ({ id: guestId, firstName: chain[0].guestName, lastName: '', nationality: chain[0].nationality, documentMasked: chain[0].documentMasked });

/** Bildirilmiş son oda. @param {any[]} stretch */
const reportedRoom = (stretch) => [...stretch].reverse().find((row) => row.kind !== 'CHECK_OUT')?.roomNumber ?? null;

/**
 * Bir bildirim yazar (anahtar varsa yazmaz). Zorunlu alan eksikse doğrudan "gönderilemedi" ve zil.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, reservationId: string, person: any, kind: 'CHECK_IN' | 'CHECK_OUT' | 'ROOM_CHANGE', sourceKey: string,
 *   dependsOnId: string | null, roomNumber: string, previousRoomNumber?: string | null, settings: any, note?: string | null, actor: string }} input
 */
async function enqueue(tx, stage, input) {
  const missing = input.kind === 'CHECK_IN' ? kbsMissingFields(input.person, input.settings) : [];
  const failed = missing.length > 0;
  const [row] = await tx.kbsNotification.createManyAndReturn({
    data: [
      {
        hotelId: input.hotelId,
        reservationId: input.reservationId,
        guestId: input.person.id,
        kind: input.kind,
        state: failed ? 'FAILED' : 'PENDING',
        sourceKey: input.sourceKey,
        dependsOnId: input.dependsOnId,
        roomNumber: input.roomNumber,
        previousRoomNumber: input.previousRoomNumber ?? null,
        guestName: fullName(input.person),
        documentMasked: input.person.documentMasked !== undefined ? input.person.documentMasked : documentMasked(input.person),
        nationality: input.person.nationality ?? null,
        nextAttemptAt: failed ? null : new Date(),
        lastCode: failed ? 'MISSING_FIELDS' : null,
        lastMessage: failed ? `Eksik bilgi: ${kbsMissingText(missing)}. Misafir kartını tamamlayıp tekrar gönderin.` : (input.note ?? null),
        createdBy: input.actor,
      },
    ],
    skipDuplicates: true,
  });
  if (!row) return null;
  await tx.kbsLog.create({ data: { hotelId: input.hotelId, notificationId: row.id, ok: !failed, code: failed ? 'MISSING_FIELDS' : 'QUEUED', message: failed ? row.lastMessage : `Sıraya alındı${input.note ? ` — ${input.note}` : ''}`, actor: input.actor } });
  await stage('kbs.notification.changed', { hotelId: input.hotelId, notificationId: row.id, reservationId: input.reservationId, kind: input.kind, state: row.state });
  if (failed) {
    await raiseStaffAlert(tx, stage, {
      hotelId: input.hotelId,
      kind: 'KBS',
      severity: 'WARNING',
      title: `KBS bildirimi eksik bilgi: ${row.guestName}`,
      body: `${row.lastMessage} Oda ${row.roomNumber}.`,
      link: `/kbs/bildirimler/${row.id}`,
      permission: PERMISSIONS.KBS_SEND,
      entityType: 'KbsNotification',
      entityId: row.id,
      dedupeKey: `kbs:${row.id}:missing`,
    });
  }
  return row;
}

/** @param {any} tx @param {Function} stage @param {any} row @param {string} note @param {string} actor */
async function cancel(tx, stage, row, note, actor) {
  const { count } = await tx.kbsNotification.updateMany({ where: { id: row.id, state: { in: [...OPEN_STATES] } }, data: { state: 'CANCELLED', nextAttemptAt: null, lastMessage: note } });
  if (count === 0) return false;
  await tx.kbsLog.create({ data: { hotelId: row.hotelId, notificationId: row.id, ok: true, code: 'CANCELLED', message: note, actor } });
  await stage('kbs.notification.changed', { hotelId: row.hotelId, notificationId: row.id, reservationId: row.reservationId, kind: row.kind, state: 'CANCELLED' });
  return true;
}

/**
 * Ortak çerçeve: ayar kapalıysa atlar, işi tek işlemde yapar, yazılan varsa göndericiyi tetikler.
 * @param {string} hotelId @param {string} reservationId
 * @param {(ctx: { tx: any, stage: Function, settings: any, stay: any, chains: Map<string, any[]> }) => Promise<{ count: number, message: string }>} work
 */
async function withStay(hotelId, reservationId, work, { status, whenDisabled = 'skip' } = {}) {
  const settings = await loadKbsSettings(prisma, hotelId);
  // Kapalıyken yalnız daha önce bildirilmiş konaklamanın kapanışı yazılır (ayar açılınca gider): KBS'de hayalet kayıt kalmasın.
  if (!settings.isEnabled && whenDisabled === 'skip') return { posted: false, skipped: 'KBS kapalı' };
  // Kilitten önce ucuz denetim: olay sıra dışı ya da gecikmeli işlendiyse konaklama artık o durumda olmayabilir.
  const current = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { status: true } });
  if (!current) throw new NotFoundError('Rezervasyon bulunamadı');
  if (status && current.status !== status) return { posted: false, skipped: `Konaklama artık bu durumda değil (${current.status})` };
  if (!settings.isEnabled && (await prisma.kbsNotification.count({ where: { hotelId, reservationId } })) === 0) return { posted: false, skipped: 'KBS kapalı' };
  const result = await writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`;
    const [stay, chains] = await Promise.all([loadStay(tx, hotelId, reservationId), chainsOf(tx, hotelId, reservationId)]);
    if (status && stay.status !== status) return { count: 0, message: `Konaklama artık bu durumda değil (${stay.status})` };
    return work({ tx, stage, settings, stay, chains });
  });
  if (result.count > 0) kick();
  return { posted: result.count > 0, message: result.message };
}

const ACTOR = 'kbs-worker';

/** Giriş: belgesi girilmiş her kişi için giriş bildirimi. @param {string} hotelId @param {string} reservationId */
export function onCheckedIn(hotelId, reservationId) {
  return withStay(hotelId, reservationId, async ({ tx, stage, settings, stay, chains }) => {
    if (stay.status !== 'CHECKED_IN' || !stay.checkedInAt) return { count: 0, message: 'Konaklama içeride değil' };
    let count = 0;
    let skipped = 0;
    for (const person of stay.people) {
      if (!person.idNumber) {
        skipped += 1;
        continue;
      }
      if (activeStretch(chains.get(person.id) ?? []).length > 0) continue;
      const chain = chains.get(person.id) ?? [];
      // Geri alınıp yeniden yapılan giriş aynı zaman damgasını taşıyabilir: sıra numarası anahtarı ayırır.
      const earlier = await tx.kbsNotification.count({ where: { hotelId, reservationId, guestId: person.id, kind: 'CHECK_IN' } });
      const row = await enqueue(tx, stage, {
        hotelId,
        reservationId,
        person,
        kind: 'CHECK_IN',
        sourceKey: `CHECK_IN:${reservationId}:${person.id}:${stay.checkedInAt.toISOString()}#${earlier + 1}`,
        dependsOnId: chain.at(-1)?.id ?? null,
        roomNumber: stay.room?.number ?? '—',
        settings,
        actor: ACTOR,
      });
      if (row) count += 1;
    }
    return { count, message: `${stay.confirmationCode}: ${count} giriş bildirimi sıraya alındı${skipped ? `; ${skipped} belgesiz çocuk bildirilmedi` : ''}` };
  }, { status: 'CHECKED_IN' });
}

/**
 * Mutabakattan: içerideki konaklamada bildirimi hiç açılmamış kişiler için giriş bildirimi (aktör kapalıydı, KBS konaklama
 * ortasında açıldı…). Açık olanı yeniden açmaz.
 * @param {string} hotelId @param {string} reservationId
 */
export async function enqueueMissingCheckIns(hotelId, reservationId) {
  const result = await onCheckedIn(hotelId, reservationId);
  return { created: result.posted, message: result.message ?? result.skipped ?? '' };
}

/** Çıkış: içeride bildirilmiş her kişi için çıkış bildirimi (ayar açıksa). @param {string} hotelId @param {string} reservationId */
export async function onCheckedOut(hotelId, reservationId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  if (settings.isEnabled && !settings.sendCheckOut) return { posted: false, skipped: 'Çıkış bildirimi kapalı (ayar)' };
  return withStay(hotelId, reservationId, async ({ tx, stage, stay, chains }) => {
    let count = 0;
    for (const [guestId, chain] of chains) {
      const stretch = activeStretch(chain);
      if (stretch.length === 0) continue;
      // Çıkış → geri alma → yeniden çıkış: sıra numarası (iptaller dahil) her çıkışa ayrı anahtar verir.
      const earlier = await tx.kbsNotification.count({ where: { hotelId, reservationId, guestId, kind: 'CHECK_OUT' } });
      const row = await enqueue(tx, stage, {
        hotelId,
        reservationId,
        person: carried(guestId, chain),
        kind: 'CHECK_OUT',
        sourceKey: `CHECK_OUT:${stretch[0].id}#${earlier + 1}`,
        dependsOnId: stretch.at(-1).id,
        roomNumber: reportedRoom(stretch) ?? stay.room?.number ?? '—',
        settings: {},
        actor: ACTOR,
      });
      if (row) count += 1;
    }
    return { count, message: `${stay.confirmationCode}: ${count} çıkış bildirimi sıraya alındı` };
  }, { status: 'CHECKED_OUT', whenDisabled: 'ifChained' });
}

/**
 * Giriş geri alındı: gönderilmemiş bildirimler iptal; gönderilmiş giriş için çıkış bildirimi ("giriş geri alındı").
 * @param {string} hotelId @param {string} reservationId
 */
export function onCheckInReverted(hotelId, reservationId) {
  return withStay(hotelId, reservationId, async ({ tx, stage, stay, chains }) => {
    let count = 0;
    for (const [guestId, chain] of chains) {
      const stretch = activeStretch(chain);
      if (stretch.length === 0) continue;
      // İptal edilemeyen (bu arada gönderilmeye alınmış ya da gönderilmiş) halkalar KBS'de kalır: çıkışla kapatılır.
      const kept = [];
      for (const row of [...stretch].reverse()) {
        if (await cancel(tx, stage, row, 'Giriş geri alındı; bildirime gerek kalmadı', ACTOR)) count += 1;
        else kept.unshift(row);
      }
      if (kept.length === 0) continue;
      const row = await enqueue(tx, stage, {
        hotelId,
        reservationId,
        person: carried(guestId, chain),
        kind: 'CHECK_OUT',
        sourceKey: `CHECK_OUT:${kept[0].id}:revert#${(await tx.kbsNotification.count({ where: { hotelId, reservationId, guestId, kind: 'CHECK_OUT' } })) + 1}`,
        dependsOnId: kept.at(-1).id,
        roomNumber: reportedRoom(kept) ?? '—',
        settings: {},
        note: 'Giriş geri alındı (yanlış giriş): bildirilen giriş çıkışla kapatılıyor',
        actor: ACTOR,
      });
      if (row) count += 1;
    }
    return { count, message: `${stay.confirmationCode}: giriş geri alındı, KBS kaydı düzeltildi (${count} işlem)` };
  }, { status: 'CONFIRMED', whenDisabled: 'ifChained' });
}

/**
 * Çıkış geri alındı: gönderilmemiş çıkış iptal; gönderilmiş çıkıştan sonra yeniden giriş bildirimi.
 * @param {string} hotelId @param {string} reservationId
 */
export function onCheckOutReverted(hotelId, reservationId) {
  return withStay(hotelId, reservationId, async ({ tx, stage, settings, stay, chains }) => {
    let count = 0;
    const people = new Map(stay.people.map((person) => [person.id, person]));
    for (const [guestId, chain] of chains) {
      const last = chain.at(-1);
      if (last?.kind !== 'CHECK_OUT') continue;
      if (await cancel(tx, stage, last, 'Çıkış geri alındı; bildirime gerek kalmadı', ACTOR)) {
        count += 1;
        continue;
      }
      const person = people.get(guestId) ?? (await tx.guest.findFirst({ where: { id: guestId, hotelId }, select: KBS_PERSON_SELECT }));
      if (!person) continue;
      const row = await enqueue(tx, stage, {
        hotelId,
        reservationId,
        person,
        kind: 'CHECK_IN',
        sourceKey: `CHECK_IN:${reservationId}:${guestId}:reopen:${last.id}`,
        dependsOnId: last.id,
        roomNumber: last.roomNumber,
        settings,
        note: 'Çıkış geri alındı: misafir yine içeride',
        actor: ACTOR,
      });
      if (row) count += 1;
    }
    return { count, message: `${stay.confirmationCode}: çıkış geri alındı, KBS kaydı düzeltildi (${count} işlem)` };
  }, { status: 'CHECKED_IN', whenDisabled: 'ifChained' });
}

/**
 * İçerideki konaklamanın odası değişti: bildirilen odası farklı olan her kişi için oda değişikliği (ayar açıksa). Girişte oda
 * verilmesi de bu olayı üretir; o anda giriş bildirimi ya henüz yoktur ya da aynı odayı söyler → bildirim açılmaz.
 * @param {string} hotelId @param {string} reservationId
 */
export async function onRoomAssigned(hotelId, reservationId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  if (settings.isEnabled && !settings.sendRoomChange) return { posted: false, skipped: 'Oda değişikliği bildirimi kapalı (ayar)' };
  return withStay(hotelId, reservationId, async ({ tx, stage, stay, chains }) => {
    if (stay.status !== 'CHECKED_IN' || !stay.room) return { count: 0, message: 'Konaklama içeride değil' };
    let count = 0;
    for (const [guestId, chain] of chains) {
      const stretch = activeStretch(chain);
      const from = reportedRoom(stretch);
      if (!from || from === stay.room.number) continue;
      const row = await enqueue(tx, stage, {
        hotelId,
        reservationId,
        person: carried(guestId, chain),
        kind: 'ROOM_CHANGE',
        sourceKey: `ROOM_CHANGE:${stretch[0].id}:${stretch.length}:${stay.room.number}`,
        dependsOnId: stretch.at(-1).id,
        roomNumber: stay.room.number,
        previousRoomNumber: from,
        settings: {},
        actor: ACTOR,
      });
      if (row) count += 1;
    }
    return { count, message: count ? `${stay.confirmationCode}: ${count} oda değişikliği bildirimi sıraya alındı` : 'Bildirilen oda aynı' };
  }, { status: 'CHECKED_IN' });
}

export { KBS_DONE_STATES };
