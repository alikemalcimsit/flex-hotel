import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError } from '../../lib/errors.js';
import { lockFolios } from '../../lib/locks.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { chargeLine, linesTotal, nextWindow, nightSourceKey, planRoomPostings, resolvePostingFolio, reversalLine } from './rules.js';

/**
 * Folyoya yazmanın çekirdeği (modül 15): kalem işleme, oda ücreti
 * uzlaştırması, ters kayıt, toplamların yeniden hesabı. Hepsi çağıranın
 * transaction'ında çalışır; olaylar `stage` ile aynı transaction'a yazılır.
 *
 * ### Kilit sırası
 *
 * Konaklamaya yeni folyo açabilen her işlem önce **rezervasyon** kilidini
 * alır (pencere numarası tekil), sonra hedef **folyoları** tek seferde, id
 * sırasıyla kilitler. Kilit altında folyo yeniden okunur: bu arada kapanmış
 * ya da birleştirilmiş folyoya kalem düşmez. Toplamlar kilit altında
 * kalemlerden yeniden hesaplanır (`refreshFolioTotals`).
 *
 * ### Tekrar işleme
 *
 * Her sistem kaleminin tekil bir anahtarı var (`sourceKey`): gece
 * `night:<konaklama>:<gün>`, olay `evt:<olay>`, elle harcama
 * `manual:<istek>`, iptal `void:<kalem>`. Aynı iş iki kez (yeniden deneme,
 * iki çalışma aynı anda) yapılırsa veritabanı ikincisini yazmaz
 * (`ON CONFLICT DO NOTHING`); yazılmayan satır için olay da çıkmaz.
 */

/** Tek olayda taşınan en fazla kalem kimliği (katalog sınırı). */
const EVENT_MAX_ITEM_IDS = 100;

/** Kilit altında hedef folyo kapanmışsa yönlendirme en fazla bu kadar yeniden çözülür. */
const MAX_RESOLVE_ATTEMPTS = 3;

/** Prisma Decimal → "1234.50". */
export const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));

/** "2026-09-29" → "29.09.2026" */
export function dotted(value) {
  const [year, month, day] = toIsoDay(value).split('-');
  return `${day}.${month}.${year}`;
}

/** "YYYY-MM-DD" → o günün UTC başı (`@db.Date` ve gece kolonları için). */
export const dayStart = (day) => new Date(`${day}T00:00:00.000Z`);

/**
 * Kalem satırının veritabanı kaydı.
 * @param {{ hotelId: string, folioId: string, spec: PostingSpec, line: import('./rules.js').ChargeLine, actor: string }} input
 */
function itemRow({ hotelId, folioId, spec, line, actor }) {
  return {
    hotelId,
    folioId,
    reservationId: spec.reservationId,
    type: spec.type,
    source: spec.source,
    description: spec.description,
    amount: line.amount,
    quantity: line.quantity,
    taxCategory: spec.taxCategory ?? null,
    netAmount: line.netAmount,
    taxAmount: line.taxAmount,
    total: line.total,
    taxLines: line.taxLines,
    serviceDate: dayStart(spec.serviceDate),
    sourceKey: spec.sourceKey ?? null,
    reversalOfId: spec.reversalOfId ?? null,
    postedBy: actor,
  };
}

/**
 * @typedef {{
 *   reservationId: string,
 *   type: string,
 *   routeType?: string,
 *   taxCategory: string | null,
 *   description: string,
 *   amount: string,
 *   quantity: number,
 *   serviceDate: string,
 *   source: string,
 *   sourceKey?: string | null,
 *   reversalOfId?: string | null,
 * }} PostingSpec
 */

const POSTED_SELECT = Object.freeze({
  id: true,
  folioId: true,
  reservationId: true,
  type: true,
  source: true,
  description: true,
  quantity: true,
  amount: true,
  total: true,
  serviceDate: true,
});

/* ══════════════════ Toplamlar ══════════════════ */

/**
 * Folyoların borç / ödenen / bakiye toplamlarını kalem ve ödemelerden yeniden
 * hesaplar (çağıran folyoları kilitlemiş olmalı). Ödemenin folyoya giren
 * tutarı (`folioAmount`: kurla çevrilmiş, ödeme başına kuruşa yuvarlanmış)
 * toplanır; yalnızca işlenmiş (`POSTED`) satırlar — onay bekleyen ve
 * reddedilen ödeme bakiyeye girmez. İade ve iptal kaydı eksi tutarlıdır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string[]} folioIds
 * @returns {Promise<Map<string, { chargesTotal: string, paymentsTotal: string, balance: string }>>}
 */
export async function refreshFolioTotals(tx, folioIds) {
  const ids = [...new Set(folioIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw`
    UPDATE "Folio" f
    SET "chargesTotal" = t."charges",
        "paymentsTotal" = t."paid",
        "balance" = t."charges" - t."paid",
        "updatedAt" = ${SQL_NOW}
    FROM (
      SELECT fo."id",
             COALESCE((SELECT SUM(i."total") FROM "FolioItem" i
                       WHERE i."folioId" = fo."id" AND i."deletedAt" IS NULL), 0) AS "charges",
             COALESCE((SELECT SUM(p."folioAmount") FROM "Payment" p
                       WHERE p."folioId" = fo."id" AND p."status" = 'POSTED' AND p."deletedAt" IS NULL), 0) AS "paid"
      FROM "Folio" fo
      WHERE fo."id" = ANY(${ids}::text[])
    ) t
    WHERE f."id" = t."id"
    RETURNING f."id", f."chargesTotal"::text AS "chargesTotal", f."paymentsTotal"::text AS "paymentsTotal", f."balance"::text AS "balance"`;
  return new Map(
    rows.map((row) => [
      row.id,
      { chargesTotal: money(row.chargesTotal), paymentsTotal: money(row.paymentsTotal), balance: money(row.balance) },
    ]),
  );
}

/* ══════════════════ Konaklamanın folyoları ══════════════════ */

/**
 * Konaklamaların folyoları ve yönlendirmeleri (tek sorguda, N+1 yok).
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string[]} reservationIds
 */
export async function loadStayFolioState(client, hotelId, reservationIds) {
  const ids = [...new Set(reservationIds)];
  const [folios, routes] = await Promise.all([
    client.folio.findMany({
      where: { hotelId, reservationId: { in: ids } },
      select: { id: true, reservationId: true, window: true, status: true, currency: true, payerName: true },
    }),
    client.folioRoute.findMany({
      where: { hotelId, reservationId: { in: ids } },
      select: { reservationId: true, type: true, folio: { select: { id: true, status: true, reservationId: true } } },
    }),
  ]);
  /** @type {Map<string, { folios: typeof folios, routes: typeof routes }>} */
  const state = new Map(ids.map((id) => [id, { folios: [], routes: [] }]));
  for (const folio of folios) state.get(folio.reservationId)?.folios.push(folio);
  for (const route of routes) state.get(route.reservationId)?.routes.push(route);
  return state;
}

/**
 * Konaklamaya yeni folyo (sıradaki pencere). Çağıran rezervasyonu kilitlemiş olmalı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, stay: { id: string, guestId: string, currency: string }, windows: number[], payerName?: string | null, announce?: boolean }} input
 */
export async function createStayFolio(tx, stage, { hotelId, stay, windows, payerName = null, announce = true }) {
  const created = await tx.folio.create({
    data: {
      hotelId,
      reservationId: stay.id,
      guestId: stay.guestId,
      window: nextWindow(windows),
      payerName,
      currency: stay.currency,
      openedBy: currentActor(),
    },
    select: { id: true, reservationId: true, window: true, status: true, currency: true, payerName: true },
  });
  if (announce) await stage('folio.opened', { hotelId, folioId: created.id, reservationId: stay.id, window: created.window });
  return created;
}

/* ══════════════════ Kalem işleme ══════════════════ */

/**
 * Sistem kalemlerini konaklamaların yönlendirmesine göre işler: her kalem
 * yönlendirilen açık folyoya, yoksa konaklamanın ilk açık folyosuna; hiç açık
 * folyosu olmayan konaklamaya yeni folyo açılır. Çağıran **rezervasyonları
 * kilitlemiş** olmalı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string,
 *   specs: PostingSpec[],
 *   stays: Map<string, { id: string, guestId: string, currency: string }>,
 *   taxes: import('./rules.js').TaxSetting[],
 *   announce?: boolean,
 * }} input `announce: false`: toplu gece çalışması tek özet olay yayınlar
 * @returns {Promise<{ items: Array<{ id: string, folioId: string, reservationId: string, source: string, total: string }>, openedFolios: number }>}
 */
export async function postSpecs(tx, stage, { hotelId, specs, stays, taxes, announce = true }) {
  if (specs.length === 0) return { items: [], openedFolios: 0 };
  const actor = currentActor();
  const reservationIds = [...new Set(specs.map((spec) => spec.reservationId))];
  let openedFolios = 0;

  for (let attempt = 1; ; attempt += 1) {
    const state = await loadStayFolioState(tx, hotelId, reservationIds);
    for (const reservationId of reservationIds) {
      const entry = state.get(reservationId);
      if (entry.folios.some((folio) => folio.status === 'OPEN')) continue;
      const stay = stays.get(reservationId);
      if (!stay) throw new Error(`postSpecs: ${reservationId} konaklaması verilmedi`);
      entry.folios.push(
        await createStayFolio(tx, stage, { hotelId, stay, windows: entry.folios.map((folio) => folio.window), announce }),
      );
      openedFolios += 1;
    }

    const targets = specs.map((spec) => {
      const entry = state.get(spec.reservationId);
      return resolvePostingFolio({ type: spec.routeType ?? spec.type, routes: entry.routes, stayFolios: entry.folios });
    });
    const targetIds = [...new Set(targets.map((target) => target.folioId))];
    await lockFolios(tx, hotelId, targetIds);
    const current = await tx.folio.findMany({
      where: { id: { in: targetIds }, hotelId },
      select: { id: true, status: true, currency: true, reservationId: true },
    });
    const byId = new Map(current.map((folio) => [folio.id, folio]));
    if (targetIds.some((id) => byId.get(id)?.status !== 'OPEN')) {
      // Okuma ile kilit arasında hedef kapandı / birleştirildi: yeniden çöz.
      if (attempt < MAX_RESOLVE_ATTEMPTS) continue;
      throw new ConflictError('Hedef folyo bu sırada kapandı; işlemi tekrar deneyin.', 'FOLIO_CLOSED');
    }

    const rows = specs.map((spec, index) => {
      const folio = byId.get(targets[index].folioId);
      const stayCurrency = stays.get(spec.reservationId)?.currency ?? folio.currency;
      if (folio.currency !== stayCurrency) {
        throw new ConflictError('Kalem, para birimi farklı bir folyoya yönlendirilmiş; yönlendirmeyi düzeltin.', 'CURRENCY_MISMATCH');
      }
      const line = chargeLine({ amount: spec.amount, quantity: spec.quantity, taxCategory: spec.taxCategory, taxes });
      return itemRow({ hotelId, folioId: folio.id, spec, line, actor });
    });
    const items = await tx.folioItem.createManyAndReturn({ data: rows, skipDuplicates: true, select: POSTED_SELECT });
    const posted = items.map((item) => ({ id: item.id, folioId: item.folioId, reservationId: item.reservationId, source: item.source, total: money(item.total) }));
    if (posted.length > 0) await refreshFolioTotals(tx, posted.map((item) => item.folioId));

    if (announce) {
      // Tek tek sistem kalemi (giriş / çıkış ücreti, iptal ücreti, minibar): kalem başına
      // denetim kaydı. Toplu gece çalışması (announce: false) çalışma başına tek kayıt yazar.
      for (const item of items) {
        await recordAudit(tx, {
          hotelId,
          entity: 'FolioItem',
          entityId: item.id,
          action: 'CREATE',
          after: {
            folioId: item.folioId,
            type: item.type,
            source: item.source,
            description: item.description,
            amount: money(item.amount),
            quantity: item.quantity,
            total: money(item.total),
            serviceDate: toIsoDay(item.serviceDate),
          },
        });
      }
      /** @type {Map<string, typeof posted>} */
      const byFolio = new Map();
      for (const item of posted) byFolio.set(item.folioId, [...(byFolio.get(item.folioId) ?? []), item]);
      for (const [folioId, list] of byFolio) {
        for (let start = 0; start < list.length; start += EVENT_MAX_ITEM_IDS) {
          const chunk = list.slice(start, start + EVENT_MAX_ITEM_IDS);
          await stage('folio.charge.posted', {
            hotelId,
            folioId,
            reservationId: byId.get(folioId).reservationId,
            itemIds: chunk.map((item) => item.id),
            source: chunk[0].source,
            total: linesTotal(chunk),
          });
        }
      }
    }
    return { items: posted, openedFolios };
  }
}

/* ══════════════════ Oda ücretleri ══════════════════ */

/**
 * Konaklamaların oda gecelerini uzlaştırıp eksik olanları işler (bkz.
 * `planRoomPostings`). Çağıran rezervasyonları kilitlemiş olmalı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string,
 *   stays: Array<{ id: string, guestId: string, currency: string }>,
 *   throughNight: string | null,
 *   taxes: import('./rules.js').TaxSetting[],
 *   announce?: boolean,
 * }} input `throughNight: null` → bütün geceler (çıkış)
 */
export async function postRoomCharges(tx, stage, { hotelId, stays, throughNight, taxes, announce = true }) {
  if (stays.length === 0) return { items: [], openedFolios: 0, stays: 0 };
  const specs = await planStayRoomSpecs(tx, hotelId, stays.map((stay) => stay.id), { throughNight });
  const result = await postSpecs(tx, stage, { hotelId, specs, stays: new Map(stays.map((stay) => [stay.id, stay])), taxes, announce });
  return { ...result, stays: new Set(result.items.map((item) => item.reservationId)).size };
}

/**
 * Konaklamaların işlenecek oda gecesi kalemleri (yazmadan).
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string[]} reservationIds
 * @param {{ throughNight: string | null, nightsOverride?: Map<string, Array<{ date: string, amount: string }>> }} options
 *   `nightsOverride`: çıkış önizlemesi — erken ayrılışta kalacak geceler
 * @returns {Promise<PostingSpec[]>}
 */
export async function planStayRoomSpecs(client, hotelId, reservationIds, { throughNight, nightsOverride }) {
  const [nights, posted] = await Promise.all([
    nightsOverride
      ? Promise.resolve([])
      : client.reservationNight.findMany({
          where: { hotelId, reservationId: { in: reservationIds }, ...(throughNight ? { date: { lte: dayStart(throughNight) } } : {}) },
          select: { reservationId: true, date: true, amount: true },
        }),
    client.folioItem.findMany({
      where: { hotelId, reservationId: { in: reservationIds }, source: 'ROOM_NIGHT' },
      select: { reservationId: true, serviceDate: true, amount: true, quantity: true, voidedAt: true },
    }),
  ]);
  const nightsBy = new Map(reservationIds.map((id) => [id, nightsOverride?.get(id) ?? []]));
  if (!nightsOverride) {
    for (const night of nights) nightsBy.get(night.reservationId).push({ date: toIsoDay(night.date), amount: money(night.amount) });
  }
  const postedBy = new Map(reservationIds.map((id) => [id, []]));
  for (const item of posted) {
    postedBy.get(item.reservationId).push({
      serviceDate: toIsoDay(item.serviceDate),
      amount: money(item.amount),
      quantity: item.quantity,
      voided: Boolean(item.voidedAt),
    });
  }

  /** @type {PostingSpec[]} */
  const specs = [];
  for (const reservationId of reservationIds) {
    const plan = planRoomPostings({ nights: nightsBy.get(reservationId), posted: postedBy.get(reservationId), throughNight });
    for (const posting of plan) {
      const negative = toDecimal(posting.amount).isNegative();
      specs.push({
        reservationId,
        routeType: 'ROOM',
        // Eksi fark (fiyat düştü) oda gelirinden indirimdir: vergisi oda vergisi.
        type: negative ? 'DISCOUNT' : 'ROOM',
        taxCategory: 'ROOM',
        description:
          posting.kind === 'NIGHT' ? `Oda ücreti · ${dotted(posting.date)} gecesi` : `Oda ücreti düzeltmesi · ${dotted(posting.date)} gecesi`,
        amount: posting.amount,
        quantity: 1,
        serviceDate: posting.date,
        source: 'ROOM_NIGHT',
        sourceKey: nightSourceKey(reservationId, posting),
      });
    }
  }
  return specs;
}

/* ══════════════════ Ters kayıt ══════════════════ */

const REVERSIBLE_SELECT = Object.freeze({
  id: true,
  folioId: true,
  reservationId: true,
  type: true,
  source: true,
  description: true,
  amount: true,
  quantity: true,
  taxCategory: true,
  netAmount: true,
  taxAmount: true,
  total: true,
  taxLines: true,
  voidedAt: true,
});

/**
 * Kalemleri iptal eder: her birine eksi tutarlı ters kayıt işlenir, asıl
 * kalem "iptal edildi" olur. Ters kayıt kalemin **şu an bulunduğu** folyoya
 * düşer (aktarılmışsa oraya); o folyo açık olmalı. Zaten iptal edilmiş kalem
 * atlanır. Folyoları kendisi kilitler (id sırasıyla).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, itemIds: string[], reason: string, serviceDate: string, approvalId?: string | null }} input
 * @returns {Promise<Array<{ itemId: string, reversalId: string, folioId: string, reservationId: string }>>}
 */
export async function reverseItems(tx, stage, { hotelId, itemIds, reason, serviceDate, approvalId = null }) {
  if (itemIds.length === 0) return [];
  const actor = currentActor();
  // Kalem, okuma ile kilit arasında başka folyoya aktarılmış olabilir: kilitli
  // olmayan folyo kalırsa o da kilitlenip yeniden okunur.
  const locked = new Set();
  let items = [];
  for (let attempt = 1; attempt <= MAX_RESOLVE_ATTEMPTS; attempt += 1) {
    const located = await tx.folioItem.findMany({ where: { id: { in: itemIds }, hotelId }, select: { folioId: true } });
    const pending = [...new Set(located.map((item) => item.folioId))].filter((id) => !locked.has(id));
    if (pending.length === 0) break;
    for (const id of await lockFolios(tx, hotelId, pending)) locked.add(id);
  }
  items = await tx.folioItem.findMany({
    where: { id: { in: itemIds }, hotelId, voidedAt: null, source: { not: 'REVERSAL' } },
    select: { ...REVERSIBLE_SELECT, folio: { select: { status: true, reservationId: true } } },
  });
  if (items.some((item) => !locked.has(item.folioId))) {
    throw new ConflictError('Kalem bu sırada başka folyoya taşındı; işlemi tekrar deneyin.', 'FOLIO_CHANGED');
  }
  const closed = items.find((item) => item.folio.status !== 'OPEN');
  if (closed) throw new ConflictError('Kalemin bulunduğu folyo kapalı; iptal için önce folyoyu yeniden açın.', 'FOLIO_CLOSED');

  const now = new Date();
  const results = [];
  for (const item of items) {
    const line = reversalLine({
      amount: money(item.amount),
      quantity: item.quantity,
      netAmount: money(item.netAmount),
      taxAmount: money(item.taxAmount),
      total: money(item.total),
      taxLines: /** @type {any} */ (item.taxLines) ?? [],
    });
    const reversal = await tx.folioItem.create({
      data: itemRow({
        hotelId,
        folioId: item.folioId,
        line,
        actor,
        spec: {
          reservationId: item.reservationId,
          type: item.type,
          taxCategory: item.taxCategory,
          description: `İptal: ${item.description}`.slice(0, 200),
          amount: line.amount,
          quantity: line.quantity,
          serviceDate,
          source: 'REVERSAL',
          sourceKey: `void:${item.id}`,
          reversalOfId: item.id,
        },
      }),
      select: { id: true },
    });
    await tx.folioItem.update({
      where: { id: item.id },
      data: { voidedAt: now, voidedBy: actor, voidReason: reason, voidRequestedAt: null, voidRequestedBy: null },
    });
    results.push({ itemId: item.id, reversalId: reversal.id, folioId: item.folioId, reservationId: item.folio.reservationId });
  }
  await refreshFolioTotals(tx, results.map((result) => result.folioId));
  for (const result of results) {
    await stage('folio.item.voided', {
      hotelId,
      folioId: result.folioId,
      reservationId: result.reservationId,
      itemId: result.itemId,
      reversalId: result.reversalId,
      approvalId,
    });
  }
  return results;
}

/**
 * Konaklamanın bu kaynaktan etkin (iptal edilmemiş) ücret kalemleri — "tek
 * seferlik" ücretler için (erken giriş, geç çıkış, iptal, gelmedi).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {string[]} sources
 * @param {{ postedBefore?: Date }} [options] yalnızca bu andan önce işlenenler
 */
export function activeFeeItems(client, hotelId, reservationId, sources, { postedBefore } = {}) {
  return client.folioItem.findMany({
    where: {
      hotelId,
      reservationId,
      source: { in: sources },
      voidedAt: null,
      ...(postedBefore ? { postedAt: { lte: postedBefore } } : {}),
    },
    select: { id: true, folioId: true, source: true, total: true },
  });
}
