import { Prisma } from '@prisma/client';
import { currentActor, toIsoDay } from '@hotelos/core';
import { GUEST_PORTAL_LANGUAGES, GUEST_PORTAL_TEXT_KEYS, onlineCheckinToCheckInValues } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError } from '../../lib/errors.js';
import { lockReservations } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { iso, loadPortalSettings, prisma } from './shared.js';

/**
 * Misafir portalı ve online check-in — personel tarafı (modül 53): ayarlar, online check-in listesi / ayrıntısı,
 * onay / düzeltme isteği, girişte tamamlanma.
 *
 * Online check-in girişi **hızlandırır, yerine geçmez**: onay "bilgiler ve belge görüldü" demektir; giriş modül 6'nın
 * kuralıyla yapılır (pencere bu kaydın verisiyle dolu açılır), giriş olayı kaydı "giriş yapıldı"ya çeker.
 */

/* ══════════════════ Ayarlar ══════════════════ */

/**
 * Ayarlar + metinler (her dil, her anahtar) + eksik dil uyarısı + web sohbetinin portalda açılıp açılamayacağı.
 * @param {string} hotelId
 */
export async function getPortalSettings(hotelId) {
  const [row, webchat] = await Promise.all([
    loadPortalSettings(prisma, hotelId),
    prisma.messagingChannel.findFirst({ where: { hotelId, channel: 'WEBCHAT' }, select: { enabled: true, settings: true } }),
  ]);
  const texts = Object.fromEntries(
    GUEST_PORTAL_LANGUAGES.map((language) => [language, Object.fromEntries(GUEST_PORTAL_TEXT_KEYS.map((key) => [key, row.texts?.[language]?.[key] ?? '']))]),
  );
  // Otel bir metni bir dilde yazdıysa diğer dillerde boş bırakılanlar varsayılan (genel) metne düşer: ekranda uyarı.
  const missingTexts = GUEST_PORTAL_TEXT_KEYS.flatMap((key) => {
    const written = GUEST_PORTAL_LANGUAGES.filter((language) => texts[language][key].trim());
    return written.length ? GUEST_PORTAL_LANGUAGES.filter((language) => !written.includes(language)).map((language) => ({ key, language })) : [];
  });
  const origin = row.publicBaseUrl ? new URL(row.publicBaseUrl).origin : null;
  return {
    enabled: row.enabled,
    inviteDaysBefore: row.inviteDaysBefore,
    checkinOpenDays: row.checkinOpenDays,
    documentRetentionDays: row.documentRetentionDays,
    publicBaseUrl: row.publicBaseUrl,
    texts,
    missingTexts,
    webchat: {
      enabled: Boolean(webchat?.enabled),
      originAllowed: Boolean(origin && (webchat?.settings?.allowedOrigins ?? []).includes(origin)),
    },
    updatedAt: iso(row.updatedAt),
    updatedBy: row.updatedBy,
  };
}

/**
 * Ayarları kaydeder (iyimser kilit: ekrandaki sürüm). Boş metin "varsayılan metin" demektir.
 * @param {string} hotelId @param {any} input `guestPortalSettingsSchema`
 */
export async function savePortalSettings(hotelId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-portal-settings:${hotelId}`}))`;
    const current = await tx.guestPortalSettings.findUnique({ where: { hotelId } });
    if (current && (!input.expectedUpdatedAt || current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())) throw new StaleWriteError();
    const data = {
      enabled: input.enabled,
      inviteDaysBefore: input.inviteDaysBefore,
      checkinOpenDays: input.checkinOpenDays,
      documentRetentionDays: input.documentRetentionDays,
      publicBaseUrl: input.publicBaseUrl ?? null,
      texts: input.texts,
      updatedBy: actor,
    };
    await tx.guestPortalSettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    const summary = (row) => (row ? { enabled: row.enabled, inviteDaysBefore: row.inviteDaysBefore, checkinOpenDays: row.checkinOpenDays, documentRetentionDays: row.documentRetentionDays, publicBaseUrl: row.publicBaseUrl } : null);
    await recordAudit(tx, { hotelId, entity: 'GuestPortalSettings', entityId: hotelId, action: current ? 'UPDATE' : 'CREATE', before: summary(current), after: summary(data) });
    await stage('guest_portal.settings.changed', { hotelId });
  });
  return getPortalSettings(hotelId);
}

/* ══════════════════ Online check-in listesi ══════════════════ */

const LIST_INCLUDE = Object.freeze({
  reservation: {
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      checkIn: true,
      checkOut: true,
      adults: true,
      children: true,
      room: { select: { number: true } },
      roomType: { select: { name: true } },
      guest: { select: { firstName: true, lastName: true } },
    },
  },
  _count: { select: { documents: { where: { purgedAt: null } } } },
});

/** @param {any} row */
function toListDto(row) {
  const r = row.reservation;
  return {
    id: row.id,
    reservationId: r.id,
    confirmationCode: r.confirmationCode,
    guestName: `${r.guest.firstName} ${r.guest.lastName}`.trim(),
    roomTypeName: r.roomType?.name ?? null,
    roomNumber: r.room?.number ?? null,
    checkIn: toIsoDay(r.checkIn),
    checkOut: toIsoDay(r.checkOut),
    adults: r.adults,
    children: r.children,
    reservationStatus: r.status,
    status: row.status,
    people: 1 + (Array.isArray(row.companions) ? row.companions.length : 0),
    photoCount: row._count.documents,
    documentsPurged: Boolean(row.documentsPurgedAt),
    arrivalTime: row.arrivalTime,
    paymentPreference: row.paymentPreference,
    language: row.language,
    submittedAt: iso(row.submittedAt),
    submitCount: row.submitCount,
    rejectReason: row.rejectReason,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Online check-in'ler: giriş gününe göre (yakın önce), durum ve giriş günü aralığı süzgeci, arama (onay kodu, ad).
 * `meta.counts`: aynı süzgeçte duruma göre sayılar (sekmeler).
 *
 * @param {string} hotelId @param {any} query `onlineCheckinListQuerySchema`
 */
export async function listOnlineCheckins(hotelId, query) {
  // Tek süzgeç (giriş günü aralığı + arama) iki sorguda: durum sayıları ve sayfanın kimlikleri. Giriş günü kaydın
  // kendisinde ve indeksli; arama metni (onay kodu, misafir ve refakatçi adları) da kayıtta, trigram indeksli; 550.000 rezervasyonlu ölçümde birleştirmeli
  // sıralama 0,2–1 sn sürüyordu.
  // Gün metinle (`::date`) verilir: oturumun saat dilimi sınırı kaydırmasın.
  const search = query.search?.trim();
  const pattern = search ? `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const filter = Prisma.sql`o."hotelId" = ${hotelId}
    ${query.from ? Prisma.sql`AND o."arrivalDate" >= ${query.from}::date` : Prisma.empty}
    ${query.to ? Prisma.sql`AND o."arrivalDate" <= ${query.to}::date` : Prisma.empty}
    ${pattern ? Prisma.sql`AND o."searchText" ILIKE ${pattern}` : Prisma.empty}`;
  const from = Prisma.sql`FROM "OnlineCheckin" o`;
  const { skip, take } = toSkipTake(query);
  const [grouped, ids] = await Promise.all([
    prisma.$queryRaw`SELECT o."status"::text AS "status", COUNT(*)::int AS "count" ${from} WHERE ${filter} GROUP BY o."status"`,
    prisma.$queryRaw`SELECT o."id" ${from} WHERE ${filter} ${query.status ? Prisma.sql`AND o."status" = ${query.status}::"OnlineCheckinStatus"` : Prisma.empty}
      ORDER BY o."arrivalDate", o."submittedAt", o."id" LIMIT ${take} OFFSET ${skip}`,
  ]);
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row.count]));
  const total = query.status ? (counts[query.status] ?? 0) : Object.values(counts).reduce((sum, count) => sum + count, 0);
  const rows = ids.length ? await prisma.onlineCheckin.findMany({ where: { id: { in: ids.map((row) => row.id) } }, include: LIST_INCLUDE }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const page = buildPage(ids.map((row) => toListDto(byId.get(row.id))), total, query);
  return { ...page, meta: { ...page.meta, counts } };
}

/* ══════════════════ Ayrıntı ══════════════════ */

/** @param {any} row */
function toDetailDto(row, documents) {
  const consents = row.consents ?? {};
  return {
    ...toListDto(row),
    guest: row.guest,
    companions: row.companions ?? [],
    vehiclePlate: row.vehiclePlate,
    note: row.note,
    consents: { privacyAt: consents.privacyAt ?? null, rulesAt: consents.rulesAt ?? null, documentPhotosAt: consents.documentPhotosAt ?? null, marketing: Boolean(consents.marketing) },
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    completedAt: iso(row.completedAt),
    documentsPurgedAt: iso(row.documentsPurgedAt),
    documents: documents.map((doc) => ({ id: doc.id, person: doc.person, contentType: doc.contentType, createdAt: iso(doc.createdAt), purged: Boolean(doc.purgedAt) })),
    // Giriş penceresinin (modül 6) ön dolumu.
    checkInValues: onlineCheckinToCheckInValues(row),
  };
}

/** @param {any} client @param {object} where */
async function loadDetail(client, where) {
  const row = await client.onlineCheckin.findFirst({ where, include: LIST_INCLUDE });
  if (!row) return null;
  const documents = await client.onlineCheckinDocument.findMany({ where: { onlineCheckinId: row.id }, orderBy: [{ person: 'asc' }, { createdAt: 'asc' }], select: { id: true, person: true, contentType: true, createdAt: true, purgedAt: true } });
  return toDetailDto(row, documents);
}

/** @param {string} hotelId @param {string} onlineCheckinId */
export async function getOnlineCheckin(hotelId, onlineCheckinId) {
  const detail = await loadDetail(prisma, { id: onlineCheckinId, hotelId });
  if (!detail) throw new NotFoundError('Online check-in bulunamadı');
  return detail;
}

/** Rezervasyonun online check-in'i (yoksa boş): giriş penceresi ve rezervasyon ekranı için. @param {string} hotelId @param {string} reservationId */
export async function getOnlineCheckinByReservation(hotelId, reservationId) {
  return { onlineCheckin: await loadDetail(prisma, { reservationId, hotelId }) };
}

/* ══════════════════ Onay / düzeltme ══════════════════ */

/**
 * @param {string} hotelId @param {string} onlineCheckinId @param {Date} expectedUpdatedAt
 * @param {(row: any, tx: any) => Promise<{ status: 'APPROVED' | 'REJECTED', data: object, audit: object }>} decide
 */
async function review(hotelId, onlineCheckinId, expectedUpdatedAt, decide) {
  await writeWithEvents(async (tx, stage) => {
    const seed = await tx.onlineCheckin.findFirst({ where: { id: onlineCheckinId, hotelId }, select: { reservationId: true } });
    if (!seed) throw new NotFoundError('Online check-in bulunamadı');
    await lockReservations(tx, hotelId, [seed.reservationId]);
    const row = await tx.onlineCheckin.findFirst({ where: { id: onlineCheckinId, hotelId }, include: { reservation: { select: { status: true, confirmationCode: true } } } });
    if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
    if (row.status === 'COMPLETED') throw new ConflictError('Misafirin girişi yapıldı; online check-in artık değişmez.', 'INVALID_STATUS');
    if (!['PENDING', 'CONFIRMED'].includes(row.reservation.status)) throw new ConflictError('Rezervasyon gelmesi beklenen durumda değil.', 'INVALID_STATUS');
    const { status, data, audit } = await decide(row, tx);
    await tx.onlineCheckin.update({ where: { id: row.id }, data: { status, reviewedAt: new Date(), reviewedBy: currentActor(), ...data } });
    await recordAudit(tx, { hotelId, entity: 'OnlineCheckin', entityId: row.id, action: 'UPDATE', before: { status: row.status }, after: { status, reservation: row.reservation.confirmationCode, ...audit } });
    await stage('online_checkin.changed', { hotelId, onlineCheckinId: row.id, reservationId: row.reservationId, status, change: status });
  });
  return getOnlineCheckin(hotelId, onlineCheckinId);
}

/**
 * Onay: bilgiler ve belge görüldü; misafir gelince tek tıkla giriş. Misafir onaydan sonra değiştirirse kayıt
 * yeniden "inceleme bekliyor"a döner.
 * @param {string} hotelId @param {string} onlineCheckinId @param {{ expectedUpdatedAt: Date }} input
 */
export function approveOnlineCheckin(hotelId, onlineCheckinId, { expectedUpdatedAt }) {
  return review(hotelId, onlineCheckinId, expectedUpdatedAt, async (row) => {
    if (row.status === 'APPROVED') throw new ConflictError('Zaten onaylı.', 'INVALID_STATUS');
    if (row.documentsPurgedAt) throw new ConflictError('Belgeler silinmiş; misafirden yeniden göndermesini isteyin.', 'DOCUMENT_PURGED');
    return { status: 'APPROVED', data: { rejectReason: null }, audit: {} };
  });
}

/**
 * Düzeltme isteği: sebep misafirin portalında görünür; misafir düzeltip yeniden gönderir.
 * @param {string} hotelId @param {string} onlineCheckinId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export function rejectOnlineCheckin(hotelId, onlineCheckinId, { expectedUpdatedAt, reason }) {
  return review(hotelId, onlineCheckinId, expectedUpdatedAt, async (row) => {
    if (row.status === 'REJECTED') throw new ConflictError('Düzeltme zaten istendi; misafirin yeniden göndermesi bekleniyor.', 'INVALID_STATUS');
    return { status: 'REJECTED', data: { rejectReason: reason }, audit: { reason } };
  });
}

/**
 * Rezervasyonun giriş günü değişince (modül 4'ün düzenlemesi, oda planında taşıma) kaydın giriş günü eşitlenir.
 * `reservation.updated` aboneliği; olayın günü sunucunun yazdığı gündür.
 * @param {{ hotelId: string, reservationId: string, checkIn: string }} payload
 */
export async function syncArrivalDate({ hotelId, reservationId, checkIn }) {
  const arrivalDate = new Date(`${checkIn}T00:00:00.000Z`);
  await prisma.onlineCheckin.updateMany({ where: { hotelId, reservationId, NOT: { arrivalDate } }, data: { arrivalDate } });
}

/* ══════════════════ Giriş (modül 6) ══════════════════ */

/**
 * Giriş yapılınca online check-in tamamlanır; giriş geri alınırsa onaylı duruma döner (yeniden giriş yine dolu açılır).
 * `guest.checked_in` / `guest.check_in_reverted` aboneliği.
 *
 * @param {{ hotelId: string, reservationId: string }} payload @param {'COMPLETED' | 'REVERTED'} kind
 */
export async function onStayCheckInChanged(payload, kind) {
  const { hotelId, reservationId } = payload;
  await writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const row = await tx.onlineCheckin.findFirst({ where: { hotelId, reservationId }, select: { id: true, status: true } });
    if (!row) return;
    const next = kind === 'COMPLETED' ? 'COMPLETED' : 'APPROVED';
    if (kind === 'COMPLETED' ? row.status === 'COMPLETED' : row.status !== 'COMPLETED') return;
    await tx.onlineCheckin.update({ where: { id: row.id }, data: { status: next, completedAt: kind === 'COMPLETED' ? new Date() : null } });
    await recordAudit(tx, { hotelId, entity: 'OnlineCheckin', entityId: row.id, action: 'UPDATE', before: { status: row.status }, after: { status: next, by: 'giriş (modül 6)' } });
    await stage('online_checkin.changed', { hotelId, onlineCheckinId: row.id, reservationId, status: next, change: next === 'COMPLETED' ? 'COMPLETED' : 'APPROVED' });
  });
}
