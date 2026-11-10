import { currentActor, toIsoDay, toMoneyString } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName, searchGuests, storablePhone, toGuestDto } from '../reservations/guests.js';
import { getHotelSettings } from '../settings/service.js';
import { mergeTags } from './rules.js';

/** guestId taşıyan ve `mergeGuests`'in basitçe (çakışmasız) taşıyacağı tablolar. */
const REASSIGN_MODELS = ['reservation', 'conversation', 'guestRequest', 'folio', 'lostItem', 'invoice', 'waitlistEntry', 'notification', 'guestPreference', 'guestNote'];

/* ───────────────────────── Özet (konaklama / harcama) ───────────────────────── */

/**
 * Bir grup misafirin özeti: tamamlanmış konaklama sayısı, toplam harcama
 * (folyo borçları), ilk / son konaklama. Tek sorgu seti (liste için).
 *
 * @param {string} hotelId @param {string[]} ids
 * @returns {Promise<Map<string, { stayCount: number, totalSpend: string, lastStay: any, firstStayOn: string | null }>>}
 */
async function summarize(hotelId, ids) {
  if (ids.length === 0) return new Map();
  const [stays, spend] = await Promise.all([
    prisma.$queryRaw`
      SELECT r."guestId",
             count(*) FILTER (WHERE r."status" = 'CHECKED_OUT')::int AS "stayCount",
             min(r."checkIn") AS "firstStay",
             (array_agg(r."checkIn" ORDER BY r."checkIn" DESC))[1] AS "lastCheckIn",
             (array_agg(r."checkOut" ORDER BY r."checkIn" DESC))[1] AS "lastCheckOut",
             (array_agg(r."status"::text ORDER BY r."checkIn" DESC))[1] AS "lastStatus",
             (array_agg(r."confirmationCode" ORDER BY r."checkIn" DESC))[1] AS "lastCode"
        FROM "Reservation" r
       WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL AND r."guestId" = ANY(${ids}::text[])
       GROUP BY r."guestId"`,
    prisma.$queryRaw`
      SELECT f."guestId", COALESCE(sum(f."chargesTotal"), 0) AS "totalSpend"
        FROM "Folio" f
       WHERE f."hotelId" = ${hotelId} AND f."deletedAt" IS NULL AND f."status" <> 'TRANSFERRED' AND f."guestId" = ANY(${ids}::text[])
       GROUP BY f."guestId"`,
  ]);
  const spendByGuest = new Map(spend.map((row) => [row.guestId, toMoneyString(row.totalSpend)]));
  const map = new Map();
  for (const row of stays) {
    map.set(row.guestId, {
      stayCount: Number(row.stayCount),
      totalSpend: spendByGuest.get(row.guestId) ?? '0.00',
      firstStayOn: row.firstStay ? toIsoDay(row.firstStay) : null,
      lastStay: row.lastCheckIn
        ? { checkIn: row.lastCheckIn.toISOString(), checkOut: row.lastCheckOut.toISOString(), status: row.lastStatus, confirmationCode: row.lastCode }
        : null,
    });
  }
  // Konaklaması yok ama folyosu olan (nadir) için de harcamayı göster.
  for (const [guestId, totalSpend] of spendByGuest) {
    if (!map.has(guestId)) map.set(guestId, { stayCount: 0, totalSpend, firstStayOn: null, lastStay: null });
  }
  return map;
}

const emptySummary = () => ({ stayCount: 0, totalSpend: '0.00', firstStayOn: null, lastStay: null });

/* ───────────────────────── Liste / arama ───────────────────────── */

const GUEST_SELECT = { id: true, firstName: true, lastName: true, phone: true, email: true, nationality: true, tags: true, updatedAt: true };

/**
 * Misafir listesi: arama (ad / telefon / e-posta) ya da etikete göre sayfalı
 * döküm; her kartta konaklama sayısı, toplam harcama, son konaklama.
 *
 * @param {string} hotelId @param {{ q?: string, tag?: string, page?: number, pageSize?: number }} query
 */
export async function listGuests(hotelId, query) {
  if (query.q) {
    const hotel = await getHotelSettings(hotelId);
    const rows = await searchGuests(hotelId, query.q, hotel);
    const map = await summarize(hotelId, rows.map((r) => r.id));
    const items = rows.map((r) => ({ ...r, ...(map.get(r.id) ?? emptySummary()) }));
    // Arama tek sayfa döner; sayfalama dalıyla aynı zarf (buildPage).
    return buildPage(items, items.length, { page: 1, pageSize: Math.max(items.length, 1) });
  }

  const { skip, take } = toSkipTake(query);
  const where = { hotelId, deletedAt: null };
  if (query.tag) where.tags = { has: query.tag };
  const [rows, total] = await Promise.all([
    prisma.guest.findMany({ where, select: GUEST_SELECT, orderBy: { updatedAt: 'desc' }, skip, take }),
    prisma.guest.count({ where }),
  ]);
  const map = await summarize(hotelId, rows.map((r) => r.id));
  const items = rows.map((r) => ({ ...toGuestDto(r), tags: r.tags, ...(map.get(r.id) ?? emptySummary()) }));
  return buildPage(items, total, query);
}

/**
 * Rezervasyon formu önizlemesi: arama sonuçlarına tercih özeti ve etiket ekler.
 * @param {string} hotelId @param {string} q
 */
export async function searchGuestCards(hotelId, q) {
  const hotel = await getHotelSettings(hotelId);
  const rows = await searchGuests(hotelId, q, hotel);
  if (rows.length === 0) return [];
  const [prefs, full] = await Promise.all([
    prisma.guestPreference.findMany({ where: { hotelId, guestId: { in: rows.map((r) => r.id) }, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.guest.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, tags: true } }),
  ]);
  const prefsByGuest = new Map();
  for (const p of prefs) prefsByGuest.set(p.guestId, [...(prefsByGuest.get(p.guestId) ?? []), toPreferenceDto(p)]);
  const tagsByGuest = new Map(full.map((g) => [g.id, g.tags]));
  return rows.map((r) => ({ ...r, tags: tagsByGuest.get(r.id) ?? [], preferences: prefsByGuest.get(r.id) ?? [] }));
}

/* ───────────────────────── Kart ───────────────────────── */

async function loadGuest(hotelId, guestId) {
  const guest = await prisma.guest.findFirst({ where: { id: guestId, hotelId, deletedAt: null } });
  if (!guest) throw new NotFoundError('Misafir kartı bulunamadı');
  return guest;
}

/** @param {string} hotelId @param {string} guestId */
export async function getGuestCard(hotelId, guestId) {
  const guest = await loadGuest(hotelId, guestId);
  const [prefs, notes, summaryMap] = await Promise.all([
    prisma.guestPreference.findMany({ where: { hotelId, guestId, deletedAt: null }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] }),
    prisma.guestNote.findMany({ where: { hotelId, guestId, deletedAt: null }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] }),
    summarize(hotelId, [guestId]),
  ]);
  return {
    ...toGuestDto(guest),
    birthDate: guest.birthDate ? toIsoDay(guest.birthDate) : null,
    idType: guest.idType,
    idNumber: guest.idNumber,
    tags: guest.tags,
    summary: summaryMap.get(guestId) ?? emptySummary(),
    preferences: prefs.map(toPreferenceDto),
    notes: notes.map(toNoteDto),
  };
}

/** Konaklama geçmişi (sayfalı). */
export async function getStayHistory(hotelId, guestId, query) {
  await loadGuest(hotelId, guestId);
  const { skip, take } = toSkipTake(query);
  const where = { hotelId, guestId, deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.reservation.findMany({ where, select: { id: true, confirmationCode: true, checkIn: true, checkOut: true, status: true, roomId: true, totalPrice: true }, orderBy: { checkIn: 'desc' }, skip, take }),
    prisma.reservation.count({ where }),
  ]);
  return buildPage(
    rows.map((r) => ({ id: r.id, confirmationCode: r.confirmationCode, checkIn: toIsoDay(r.checkIn), checkOut: toIsoDay(r.checkOut), status: r.status, totalPrice: toMoneyString(r.totalPrice) })),
    total,
    query,
  );
}

/** Harcama geçmişi: misafirin folyoları (borç, ödeme, bakiye). */
export async function getSpendHistory(hotelId, guestId) {
  await loadGuest(hotelId, guestId);
  const folios = await prisma.folio.findMany({
    where: { hotelId, guestId, deletedAt: null, status: { not: 'TRANSFERRED' } },
    select: { id: true, reservationId: true, status: true, chargesTotal: true, paymentsTotal: true, balance: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return folios.map((f) => ({
    id: f.id, reservationId: f.reservationId, status: f.status,
    chargesTotal: toMoneyString(f.chargesTotal), paymentsTotal: toMoneyString(f.paymentsTotal), balance: toMoneyString(f.balance),
    createdAt: f.createdAt.toISOString(),
  }));
}

/** Kart düzenleme: iletişim, kimlik, etiketler, doğum tarihi. */
export async function updateGuestCard(hotelId, guestId, input) {
  const hotel = await getHotelSettings(hotelId);
  const guest = await writeWithEvents(async (tx, stage) => {
    const current = await tx.guest.findFirst({ where: { id: guestId, hotelId, deletedAt: null } });
    if (!current) throw new NotFoundError('Misafir kartı bulunamadı');
    const data = {};
    for (const field of ['firstName', 'lastName', 'nationality', 'idType', 'idNumber']) {
      if (input[field] !== undefined) data[field] = input[field] || null;
    }
    if (input.phone !== undefined) data.phone = input.phone ? storablePhone(input.phone, hotel.phoneCountryCode) : null;
    if (input.email !== undefined) data.email = input.email ? input.email.toLowerCase() : null;
    if (input.birthDate !== undefined) data.birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
    if (input.tags !== undefined) data.tags = [...new Set(input.tags)];
    const updated = await tx.guest.update({ where: { id: guestId }, data });
    await recordAudit(tx, { hotelId, entity: 'Guest', entityId: guestId, action: 'UPDATE', after: data });
    await stage('guest.card.updated', { hotelId, guestId });
    return updated;
  });
  return getGuestCard(hotelId, guest.id);
}

/* ───────────────────────── Tercihler ───────────────────────── */

function toPreferenceDto(p) {
  return { id: p.id, category: p.category, value: p.value, source: p.source, confidence: p.confidence, lastConfirmedAt: p.lastConfirmedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString() };
}

export async function addPreference(hotelId, guestId, input) {
  await loadGuest(hotelId, guestId);
  const pref = await writeWithEvents(async (tx, stage) => {
    const created = await tx.guestPreference.create({
      data: { hotelId, guestId, category: input.category, value: input.value, source: input.source ?? 'STAFF', confidence: input.confidence ?? 'MEDIUM', lastConfirmedAt: new Date(), createdBy: currentActor() },
    });
    await recordAudit(tx, { hotelId, entity: 'GuestPreference', entityId: created.id, action: 'CREATE', after: { category: created.category, value: created.value } });
    await stage('guest.preference.updated', { hotelId, guestId });
    return created;
  });
  return toPreferenceDto(pref);
}

export async function updatePreference(hotelId, guestId, prefId, input) {
  const pref = await writeWithEvents(async (tx, stage) => {
    const current = await tx.guestPreference.findFirst({ where: { id: prefId, guestId, hotelId, deletedAt: null } });
    if (!current) throw new NotFoundError('Tercih bulunamadı');
    const data = {};
    for (const field of ['category', 'value', 'source', 'confidence']) if (input[field] !== undefined) data[field] = input[field];
    data.lastConfirmedAt = new Date();
    const updated = await tx.guestPreference.update({ where: { id: prefId }, data });
    await recordAudit(tx, { hotelId, entity: 'GuestPreference', entityId: prefId, action: 'UPDATE', after: data });
    await stage('guest.preference.updated', { hotelId, guestId });
    return updated;
  });
  return toPreferenceDto(pref);
}

export async function deletePreference(hotelId, guestId, prefId) {
  await writeWithEvents(async (tx, stage) => {
    const current = await tx.guestPreference.findFirst({ where: { id: prefId, guestId, hotelId, deletedAt: null } });
    if (!current) throw new NotFoundError('Tercih bulunamadı');
    await tx.guestPreference.update({ where: { id: prefId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'GuestPreference', entityId: prefId, action: 'DELETE' });
    await stage('guest.preference.updated', { hotelId, guestId });
  });
  return { id: prefId };
}

/* ───────────────────────── Notlar ───────────────────────── */

function toNoteDto(n) {
  return { id: n.id, body: n.body, pinned: n.pinned, createdBy: n.createdBy, createdAt: n.createdAt.toISOString() };
}

export async function addNote(hotelId, guestId, input) {
  await loadGuest(hotelId, guestId);
  const note = await writeWithEvents(async (tx, stage) => {
    const created = await tx.guestNote.create({ data: { hotelId, guestId, body: input.body, pinned: input.pinned ?? false, createdBy: currentActor() } });
    await recordAudit(tx, { hotelId, entity: 'GuestNote', entityId: created.id, action: 'CREATE' });
    await stage('guest.note.added', { hotelId, guestId });
    return created;
  });
  return toNoteDto(note);
}

export async function updateNote(hotelId, guestId, noteId, input) {
  const note = await writeWithEvents(async (tx) => {
    const current = await tx.guestNote.findFirst({ where: { id: noteId, guestId, hotelId, deletedAt: null } });
    if (!current) throw new NotFoundError('Not bulunamadı');
    const data = {};
    if (input.body !== undefined) data.body = input.body;
    if (input.pinned !== undefined) data.pinned = input.pinned;
    const updated = await tx.guestNote.update({ where: { id: noteId }, data });
    await recordAudit(tx, { hotelId, entity: 'GuestNote', entityId: noteId, action: 'UPDATE', after: data });
    return updated;
  });
  return toNoteDto(note);
}

export async function deleteNote(hotelId, guestId, noteId) {
  await writeWithEvents(async (tx) => {
    const current = await tx.guestNote.findFirst({ where: { id: noteId, guestId, hotelId, deletedAt: null } });
    if (!current) throw new NotFoundError('Not bulunamadı');
    await tx.guestNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'GuestNote', entityId: noteId, action: 'DELETE' });
  });
  return { id: noteId };
}

/* ───────────────────────── Birleştirme ───────────────────────── */

/**
 * İki misafir kartını birleştirir: kaynağın bütün bağlı kayıtları (rezervasyon,
 * folyo, konuşma, istek, kayıp eşya, fatura, bekleme, bildirim, tercih, not)
 * hedefe taşınır; etiketler birleşir; `keep` ile seçilen alanlar hedefe yazılır;
 * kaynak kart silinir (soft-delete). Modül 69 (göç) de bu kuralı kullanır.
 *
 * @param {string} hotelId
 * @param {{ sourceId: string, targetId: string, keep?: object }} input
 */
export async function mergeGuests(hotelId, input) {
  const { sourceId, targetId, keep = {} } = input;
  if (sourceId === targetId) throw new ValidationError('Bir kaydı kendisiyle birleştiremezsiniz', { field: 'sourceId' });

  await writeWithEvents(async (tx, stage) => {
    const [source, target] = await Promise.all([
      tx.guest.findFirst({ where: { id: sourceId, hotelId, deletedAt: null } }),
      tx.guest.findFirst({ where: { id: targetId, hotelId, deletedAt: null } }),
    ]);
    if (!source) throw new NotFoundError('Birleştirilecek (kaynak) misafir bulunamadı');
    if (!target) throw new NotFoundError('Hedef misafir bulunamadı');

    // ReservationGuest: aynı rezervasyonda hedef zaten varsa kaynağın satırı çakışır → sil, kalanı taşı.
    await tx.$executeRaw`
      DELETE FROM "ReservationGuest" sg
       WHERE sg."hotelId" = ${hotelId} AND sg."guestId" = ${sourceId}
         AND EXISTS (SELECT 1 FROM "ReservationGuest" tg WHERE tg."reservationId" = sg."reservationId" AND tg."guestId" = ${targetId})`;
    await tx.reservationGuest.updateMany({ where: { hotelId, guestId: sourceId }, data: { guestId: targetId } });

    // Diğer tablolar: doğrudan taşınır.
    for (const model of REASSIGN_MODELS) {
      await tx[model].updateMany({ where: { hotelId, guestId: sourceId }, data: { guestId: targetId } });
    }

    // Hedef alanları: keep'teki değerler + etiket birleşimi.
    const data = { tags: mergeTags(target.tags, source.tags) };
    for (const field of ['firstName', 'lastName', 'phone', 'email', 'nationality', 'idType', 'idNumber']) {
      if (keep[field] !== undefined) data[field] = keep[field];
    }
    if (keep.birthDate !== undefined) data.birthDate = keep.birthDate ? new Date(`${keep.birthDate}T00:00:00.000Z`) : null;
    await tx.guest.update({ where: { id: targetId }, data });

    // Kaynağı sil.
    await tx.guest.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });

    await recordAudit(tx, { hotelId, entity: 'Guest', entityId: targetId, action: 'UPDATE', after: { mergedFrom: sourceId, name: guestFullName({ firstName: data.firstName ?? target.firstName, lastName: data.lastName ?? target.lastName }) } });
    await stage('guest.card.merged', { hotelId, sourceId, targetId });
  });

  return getGuestCard(hotelId, targetId);
}
