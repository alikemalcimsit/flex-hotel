import { Prisma } from '@prisma/client';
import { toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';
import { DEFAULT_YIELD_SETTINGS } from '@hotelos/hotel-contracts';
import { cache } from '../../lib/cache.js';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { priceStay } from '../reservations/rules.js';
import { buildAvailabilityCalendar } from '../rooms/rules.js';
import { loadInventorySnapshot } from '../rooms/service.js';
import { getActiveRoomTypes, getActiveSeasons, getHotelSettings } from '../settings/service.js';
import { actorRegistry } from '../../lib/actors.js';
import { getActiveRatePlans } from './service.js';
import { applyPriceMultiplier, calendarToYieldDays, evaluateYield } from './yield-rules.js';

/**
 * Dinamik fiyat / yield servisi (modül 34).
 *
 * İki üretici, tek karar yolu: günlük iş kural tabanlı önerileri üretir
 * (LLM'siz her otelde), pricing-agent (LLM, kayıtlıysa) aynı yapıya kendi
 * önerilerini ekler. **Hiçbir fiyat kendiliğinden değişmez** — her öneri M11
 * onay kuyruğuna düşer (`BULK_PRICE_CHANGE`); karar olayını buradaki
 * subscriber uygular: dönemin her gecesine `PriceAdjustment` (upsert) +
 * `rate.changed` (kanallar).
 *
 * 2500 oda ölçeği: üretim günde bir toplu iştir (otel başına tek envanter
 * anlık görüntüsü + tek geçen-yıl sorgusu); satış sıcak yoluna eklenen tek
 * şey cache'li bir ayar sözlüğüdür (`getActiveAdjustments`, 5 dk TTL,
 * `settings.` olaylarıyla geçersiz kılınır).
 */

const HOT_READ_TTL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

const money = (value) => toMoneyString(value.toString());
const isoDay = (value) => toIsoDay(value);

/* ══════════════════ Sıcak okuma: onaylı çarpanlar ══════════════════ */

/**
 * Bugünden ileri onaylı gece çarpanları: `{ roomTypeId: { gün: "1.100" } }`.
 * Fiyat hesabı (`priceStay`) her satışta tüketir.
 * @param {string} hotelId
 */
export async function getActiveAdjustments(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:priceAdjustments`,
    async () => {
      const since = new Date(toUtcDayStart(new Date()) - DAY_MS);
      const rows = await prisma.priceAdjustment.findMany({
        where: { hotelId, date: { gte: since } },
        select: { roomTypeId: true, date: true, multiplier: true },
      });
      /** @type {Record<string, Record<string, string>>} */
      const map = {};
      for (const row of rows) {
        (map[row.roomTypeId] ??= {})[isoDay(row.date)] = toDecimal(row.multiplier.toString()).toFixed(3);
      }
      return map;
    },
    HOT_READ_TTL_MS,
  );
}

/* ══════════════════ Yield ayarları (Hotel.settings.yield) ══════════════════ */

/** @param {string} hotelId */
export async function getYieldSettings(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:yield`,
    async () => {
      const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { settings: true, updatedAt: true } });
      if (!hotel) throw new NotFoundError('Otel bulunamadı');
      return { ...DEFAULT_YIELD_SETTINGS, ...(hotel.settings?.yield ?? {}), updatedAt: hotel.updatedAt.toISOString() };
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * @param {string} hotelId
 * @param {object} input `updateYieldSettingsSchema` çıktısı
 */
export async function saveYieldSettings(hotelId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeWithEvents(async (tx, stage) => {
    const hotel = await tx.hotel.findFirst({ where: { id: hotelId }, select: { settings: true } });
    if (!hotel) throw new NotFoundError('Otel bulunamadı');
    const before = { ...DEFAULT_YIELD_SETTINGS, ...(hotel.settings?.yield ?? {}) };
    await updateWithVersionCheck(
      tx,
      'hotel',
      { id: hotelId },
      expectedUpdatedAt,
      { settings: { ...(hotel.settings ?? {}), yield: data } },
      'Otel bulunamadı',
    );
    const changedFields = await recordAudit(tx, { hotelId, entity: 'YieldSettings', entityId: hotelId, action: 'UPDATE', before, after: data });
    await stage('settings.yield.updated', { hotelId, changedFields });
    const after = await tx.hotel.findFirst({ where: { id: hotelId }, select: { updatedAt: true } });
    return { ...data, updatedAt: after.updatedAt.toISOString() };
  });
}

/* ══════════════════ Öneriler: liste / düzenleme / geçmiş ══════════════════ */

const SUGGESTION_SELECT = Object.freeze({
  id: true,
  roomTypeId: true,
  startDate: true,
  endDate: true,
  multiplier: true,
  currentPrice: true,
  suggestedPrice: true,
  reason: true,
  inputs: true,
  source: true,
  status: true,
  approvalId: true,
  decidedBy: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
  roomType: { select: { code: true, name: true } },
});

/** @param {Record<string, any>} row */
function toSuggestionDto(row) {
  return {
    id: row.id,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    startDate: isoDay(row.startDate),
    endDate: isoDay(row.endDate),
    multiplier: toDecimal(row.multiplier.toString()).toFixed(3),
    currentPrice: money(row.currentPrice),
    suggestedPrice: money(row.suggestedPrice),
    reason: row.reason,
    inputs: row.inputs ?? {},
    source: row.source,
    status: row.status,
    approvalId: row.approvalId,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, roomTypeId?: string }} query
 */
export async function listSuggestions(hotelId, query) {
  const where = {
    hotelId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.priceSuggestion.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { createdAt: 'desc' }],
      select: SUGGESTION_SELECT,
      ...toSkipTake(query),
    }),
    prisma.priceSuggestion.count({ where }),
  ]);
  return buildPage(items.map(toSuggestionDto), total, query);
}

/**
 * Onaylayan karar vermeden çarpanı düzenler (yalnız bekleyen öneri).
 * Önerilen fiyat gösterimi de yeni çarpana göre tazelenir.
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `updatePriceSuggestionSchema` çıktısı
 */
export async function updateSuggestionMultiplier(hotelId, id, input) {
  const { expectedUpdatedAt, multiplier } = input;
  try {
    return await writeWithEvents(async (tx) => {
      const before = await tx.priceSuggestion.findFirst({ where: { id, hotelId }, select: SUGGESTION_SELECT });
      if (!before) throw new NotFoundError('Fiyat önerisi bulunamadı');
      if (before.status !== 'PENDING') throw new ConflictError('Karar verilmiş öneri düzenlenemez', 'SUGGESTION_DECIDED');
      // Taban fiyat önerinin kendi içinden türetilir: suggested = taban × çarpan
      // (currentPrice mevcut-ayar-dahil etkin fiyattır, taban değildir).
      const base = toDecimal(before.suggestedPrice.toString()).dividedBy(toDecimal(before.multiplier.toString()));
      await updateWithVersionCheck(
        tx,
        'priceSuggestion',
        { id, hotelId },
        expectedUpdatedAt,
        { multiplier, suggestedPrice: toMoneyString(base.times(toDecimal(multiplier))) },
        'Fiyat önerisi bulunamadı',
      );
      const after = await tx.priceSuggestion.findFirst({ where: { id }, select: SUGGESTION_SELECT });
      await recordAudit(tx, {
        hotelId,
        entity: 'PriceSuggestion',
        entityId: id,
        action: 'UPDATE',
        before: toSuggestionDto(before),
        after: toSuggestionDto(after),
      });
      return toSuggestionDto(after);
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Fiyat geçmişi (grafik): dönemdeki uygulanmış gece çarpanları.
 * @param {string} hotelId
 * @param {{ from: Date, to: Date, roomTypeId?: string }} query
 */
export async function getPriceHistory(hotelId, query) {
  const rows = await prisma.priceAdjustment.findMany({
    where: {
      hotelId,
      date: { gte: query.from, lte: query.to },
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    },
    orderBy: [{ date: 'asc' }],
    select: { roomTypeId: true, date: true, multiplier: true, createdBy: true, updatedAt: true, roomType: { select: { code: true, name: true } } },
  });
  return rows.map((row) => ({
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    date: isoDay(row.date),
    multiplier: toDecimal(row.multiplier.toString()).toFixed(3),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/* ══════════════════ Üretim (günlük iş + ajan girişi) ══════════════════ */

/**
 * Geçen yılın satılan geceleri: `${roomTypeId}|${gün}` → adet. Tek gruplu
 * sorgu (`ReservationNight` `[hotelId, date]` indeksli); iptal ve gelmedi
 * sayılmaz.
 * @param {string} hotelId
 * @param {Date} from bu yılki pencere başı
 * @param {number} horizonDays
 */
async function loadLastYearSold(hotelId, from, horizonDays) {
  const start = new Date(toUtcDayStart(from) - 364 * DAY_MS);
  const end = new Date(start.getTime() + horizonDays * DAY_MS);
  const rows = await prisma.$queryRaw`
    SELECT r."roomTypeId", n."date", COUNT(*)::int AS sold
    FROM "ReservationNight" n
    JOIN "Reservation" r ON r."id" = n."reservationId"
    WHERE n."hotelId" = ${hotelId}
      AND n."deletedAt" IS NULL AND r."deletedAt" IS NULL
      AND r."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
      AND n."date" >= ${start} AND n."date" < ${end}
    GROUP BY r."roomTypeId", n."date"`;
  return new Map(rows.map((row) => [`${row.roomTypeId}|${isoDay(row.date)}`, Number(row.sold)]));
}

/**
 * Ufuktaki gün gün doluluk satırları (kural işi ve pricing-agent paylaşır):
 * otel başına tek envanter anlık görüntüsü + tek geçen-yıl sorgusu.
 * @param {string} hotelId
 * @param {{ today: string, horizonDays: number }} window
 */
export async function collectYieldDays(hotelId, { today, horizonDays }) {
  const from = new Date(`${today}T00:00:00.000Z`);
  const to = new Date(from.getTime() + horizonDays * DAY_MS);
  const [snapshot, roomTypes, lastYearByKey] = await Promise.all([
    loadInventorySnapshot(prisma, hotelId, from, to),
    getActiveRoomTypes(hotelId),
    loadLastYearSold(hotelId, from, horizonDays),
  ]);
  const calendar = buildAvailabilityCalendar({ ...snapshot, from, to, roomTypeIds: roomTypes.map((type) => type.id) });
  return calendarToYieldDays(calendar, { today, lastYearByKey });
}

/**
 * Kural tabanlı önerileri üretir ve onaya düşürür; pricing-agent kayıtlıysa
 * değerlendirme olayını yayınlar (ajan kendi önerilerini aynı yoldan ekler).
 * İdempotent: aynı tip + dönemle çakışan bekleyen öneri varken yenisi
 * açılmaz (iş 6 saatte bir koşabilir, kuyruk şişmez).
 *
 * @param {string} hotelId
 * @returns {Promise<{ created: number, skipped: number, agentNotified: boolean }>}
 */
export async function generateSuggestions(hotelId) {
  const settings = await getYieldSettings(hotelId);
  const agentRegistered = Boolean(actorRegistry.get('pricing-agent'));
  if (!settings.enabled && !agentRegistered) return { created: 0, skipped: 0, agentNotified: false };

  const businessDate = await getBusinessDate(hotelId);
  const today = isoDay(businessDate);

  let created = 0;
  let skipped = 0;
  if (settings.enabled) {
    const days = await collectYieldDays(hotelId, { today, horizonDays: settings.horizonDays });
    const proposals = evaluateYield(days, settings);
    const outcome = await createSuggestions(hotelId, proposals.map((proposal) => ({ ...proposal, source: 'RULE' })), {
      requestedBy: 'yield-kuralı',
    });
    created = outcome.created;
    skipped = outcome.skipped;
  }

  if (agentRegistered) {
    await writeWithEvents(async (_tx, stage) => {
      await stage('pricing.review.requested', { hotelId, businessDate: today, horizonDays: settings.horizonDays });
    });
  }
  return { created, skipped, agentNotified: agentRegistered };
}

/** Ajan girdisindeki en fazla gün satırı (istem maliyeti sınırı). */
const AGENT_MAX_DAY_ROWS = 120;

/**
 * pricing-agent'ın gördüğü veri (modül 34): eşiklere yakın "ilginç" günler
 * (istem maliyeti için `AGENT_MAX_DAY_ROWS` ile sınırlı), oda tipleri, yield
 * ayarları ve zaten bekleyen öneri dönemleri (mükerrer önermesin). Kişisel
 * veri yok — yalnız toplam sayılar.
 *
 * @param {string} hotelId
 * @param {{ businessDate: string, horizonDays: number }} window
 */
export async function agentReviewInputs(hotelId, { businessDate, horizonDays }) {
  const [settings, hotel, roomTypes, days, pending] = await Promise.all([
    getYieldSettings(hotelId),
    getHotelSettings(hotelId),
    getActiveRoomTypes(hotelId),
    collectYieldDays(hotelId, { today: businessDate, horizonDays }),
    prisma.priceSuggestion.findMany({
      where: { hotelId, status: 'PENDING' },
      select: { roomTypeId: true, startDate: true, endDate: true },
    }),
  ]);
  const margin = 10;
  const interesting = days
    .filter((day) => day.occupancyPct >= settings.highOccupancyPct - margin || day.occupancyPct <= settings.lowOccupancyPct + margin)
    .slice(0, AGENT_MAX_DAY_ROWS)
    .map((day) => ({
      roomTypeId: day.roomTypeId,
      date: day.date,
      occupancyPct: Math.round(day.occupancyPct),
      sellable: day.sellable,
      sold: day.sold,
      daysOut: day.daysOut,
      lastYearOccupancyPct: day.lastYearOccupancyPct,
    }));
  return {
    today: businessDate,
    horizonDays,
    currency: hotel.currency,
    settings: {
      highOccupancyPct: settings.highOccupancyPct,
      highAdjustmentPct: settings.highAdjustmentPct,
      lowOccupancyPct: settings.lowOccupancyPct,
      lowDaysOut: settings.lowDaysOut,
      lowAdjustmentPct: settings.lowAdjustmentPct,
    },
    roomTypes: roomTypes.map((type) => ({ id: type.id, code: type.code, name: type.name, basePrice: type.basePrice })),
    days: interesting,
    truncated: interesting.length === AGENT_MAX_DAY_ROWS,
    pendingPeriods: pending.map((row) => ({ roomTypeId: row.roomTypeId, startDate: isoDay(row.startDate), endDate: isoDay(row.endDate) })),
  };
}

/**
 * Önerileri yazar ve her biri için M11 onayı açar — kural işi ve pricing-agent
 * aynı kapıdan girer. Çakışan bekleyen öneri ve "zaten aynı çarpan uygulanmış"
 * dönemler atlanır; emniyet aralığı dışı çarpan (LLM hatası) reddedilir.
 *
 * @param {string} hotelId
 * @param {Array<{ roomTypeId: string, startDate: string, endDate: string, multiplier: string, reason: string, rule?: string, days?: object[], source: 'RULE' | 'AGENT' }>} proposals
 * @param {{ requestedBy: string }} options
 */
export async function createSuggestions(hotelId, proposals, { requestedBy }) {
  if (proposals.length === 0) return { created: 0, skipped: 0 };
  const [hotel, roomTypes, seasons, ratePlans, adjustments] = await Promise.all([
    getHotelSettings(hotelId),
    getActiveRoomTypes(hotelId),
    getActiveSeasons(hotelId),
    getActiveRatePlans(hotelId),
    getActiveAdjustments(hotelId),
  ]);
  const typeById = new Map(roomTypes.map((type) => [type.id, type]));

  let created = 0;
  let skipped = 0;
  for (const proposal of proposals) {
    const type = typeById.get(proposal.roomTypeId);
    const multiplier = Number(proposal.multiplier);
    if (!type || !(multiplier >= 0.5 && multiplier <= 3)) {
      skipped += 1;
      continue;
    }
    // Dönemin her gecesinde zaten aynı çarpan uygulanmışsa öneri gereksizdir.
    const nights = periodDays(proposal.startDate, proposal.endDate);
    const identical = nights.every((day) => adjustments[proposal.roomTypeId]?.[day] === toDecimal(proposal.multiplier).toFixed(3));
    if (identical) {
      skipped += 1;
      continue;
    }

    try {
      await writeWithEvents(async (tx, stage) => {
        const overlapping = await tx.priceSuggestion.findFirst({
          where: {
            hotelId,
            roomTypeId: proposal.roomTypeId,
            status: 'PENDING',
            startDate: { lte: new Date(`${proposal.endDate}T00:00:00.000Z`) },
            endDate: { gte: new Date(`${proposal.startDate}T00:00:00.000Z`) },
          },
          select: { id: true },
        });
        if (overlapping) {
          skipped += 1;
          return;
        }

        // Gösterim fiyatı: dönem ilk gecesi, varsayılan pansiyon, mevcut ayar dahil etkin fiyat.
        const firstNight = priceStay({
          basePrice: type.basePrice,
          seasons,
          ratePlans,
          roomTypeId: proposal.roomTypeId,
          boardType: hotel.defaultBoardType,
          adjustments,
          checkIn: proposal.startDate,
          checkOut: isoDay(new Date(new Date(`${proposal.startDate}T00:00:00.000Z`).getTime() + DAY_MS)),
        }).nights[0];
        const baseNight = priceStay({
          basePrice: type.basePrice,
          seasons,
          ratePlans,
          roomTypeId: proposal.roomTypeId,
          boardType: hotel.defaultBoardType,
          checkIn: proposal.startDate,
          checkOut: isoDay(new Date(new Date(`${proposal.startDate}T00:00:00.000Z`).getTime() + DAY_MS)),
        }).nights[0];
        const suggestedPrice = applyPriceMultiplier(baseNight.amount, proposal.multiplier);

        const row = await tx.priceSuggestion.create({
          data: {
            hotelId,
            roomTypeId: proposal.roomTypeId,
            startDate: new Date(`${proposal.startDate}T00:00:00.000Z`),
            endDate: new Date(`${proposal.endDate}T00:00:00.000Z`),
            multiplier: proposal.multiplier,
            currentPrice: firstNight.amount,
            suggestedPrice,
            reason: proposal.reason.slice(0, 2000),
            inputs: { rule: proposal.rule ?? null, days: proposal.days ?? [] },
            source: proposal.source,
          },
        });

        const pctText = multiplier >= 1 ? `+%${Math.round((multiplier - 1) * 100)}` : `−%${Math.round((1 - multiplier) * 100)}`;
        const approval = await requestApproval(tx, stage, {
          hotelId,
          type: 'BULK_PRICE_CHANGE',
          summary: `${type.name} · ${dotted(proposal.startDate)} – ${dotted(proposal.endDate)} · ${pctText}`.slice(0, 200),
          reason: proposal.reason.slice(0, 1000),
          data: {
            'Oda tipi': type.name,
            Dönem: `${dotted(proposal.startDate)} – ${dotted(proposal.endDate)}`,
            'Mevcut fiyat': `${firstNight.amount} ${hotel.currency}`,
            'Önerilen fiyat': `${suggestedPrice} ${hotel.currency}`,
            Kaynak: proposal.source === 'AGENT' ? 'Fiyat ajanı (AI)' : 'Yield kuralı',
          },
          entityType: 'PriceSuggestion',
          entityId: row.id,
          requestedBy,
          // Dönem bitince karar anlamsız: onay o gece sonunda kendiliğinden düşer.
          expiresInMs: new Date(`${proposal.endDate}T00:00:00.000Z`).getTime() + DAY_MS - Date.now(),
        });
        await tx.priceSuggestion.update({ where: { id: row.id }, data: { approvalId: approval.approvalId } });
        await recordAudit(tx, { hotelId, entity: 'PriceSuggestion', entityId: row.id, action: 'CREATE', after: { ...proposal, approvalId: approval.approvalId } });
        created += 1;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
  return { created, skipped };
}

/** @param {string} start @param {string} end iki uç dahil */
function periodDays(start, end) {
  const days = [];
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  for (let ms = new Date(`${start}T00:00:00.000Z`).getTime(); ms <= endMs; ms += DAY_MS) days.push(isoDay(new Date(ms)));
  return days;
}

/** @param {string} day "YYYY-MM-DD" → "GG.AA.YYYY" */
function dotted(day) {
  const [year, month, dayPart] = day.split('-');
  return `${dayPart}.${month}.${year}`;
}

/* ══════════════════ Onay kararının uygulanması ══════════════════ */

/**
 * M11 kararını öneriye işler (approvals olay subscriber'ı çağırır).
 * Onaylanınca dönemin her gecesine çarpan yazılır (upsert: bir geceye tek
 * ayar, yeni onay eskisini günceller) ve kanallar tazelenir (`rate.changed`).
 *
 * @param {string} hotelId
 * @param {string} approvalId
 * @param {'GRANTED' | 'DENIED' | 'EXPIRED'} decision
 * @param {string | null} decidedBy
 */
export async function applySuggestionDecision(hotelId, approvalId, decision, decidedBy) {
  const suggestion = await prisma.priceSuggestion.findFirst({
    where: { hotelId, approvalId },
    select: { ...SUGGESTION_SELECT, hotelId: true },
  });
  if (!suggestion || suggestion.status !== 'PENDING') return null;

  return writeWithEvents(async (tx, stage) => {
    const current = await tx.priceSuggestion.findFirst({ where: { id: suggestion.id }, select: SUGGESTION_SELECT });
    if (!current || current.status !== 'PENDING') return null;
    const now = new Date();

    if (decision === 'GRANTED') {
      const multiplier = toDecimal(current.multiplier.toString()).toFixed(3);
      for (const day of periodDays(isoDay(current.startDate), isoDay(current.endDate))) {
        await tx.priceAdjustment.upsert({
          where: { hotelId_roomTypeId_date: { hotelId, roomTypeId: current.roomTypeId, date: new Date(`${day}T00:00:00.000Z`) } },
          create: {
            hotelId,
            roomTypeId: current.roomTypeId,
            date: new Date(`${day}T00:00:00.000Z`),
            multiplier,
            suggestionId: current.id,
            createdBy: decidedBy ?? 'system',
          },
          update: { multiplier, suggestionId: current.id, createdBy: decidedBy ?? 'system' },
        });
      }
      await stage('settings.price_adjustment.changed', {
        hotelId,
        roomTypeIds: [current.roomTypeId],
        from: isoDay(current.startDate),
        to: isoDay(current.endDate),
      });
      await stage('rate.changed', {
        hotelId,
        roomTypeIds: [current.roomTypeId],
        from: isoDay(current.startDate),
        to: isoDay(current.endDate),
        reason: `Dinamik fiyat onaylandı: ${current.roomType?.name ?? current.roomTypeId} ×${multiplier}`.slice(0, 200),
      });
    }

    const status = decision === 'GRANTED' ? 'APPROVED' : decision === 'DENIED' ? 'REJECTED' : 'EXPIRED';
    await tx.priceSuggestion.update({
      where: { id: current.id },
      data: { status, decidedBy: decidedBy ?? null, decidedAt: now },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'PriceSuggestion',
      entityId: current.id,
      action: 'UPDATE',
      before: toSuggestionDto(current),
      after: { ...toSuggestionDto(current), status, decidedBy, decidedAt: now.toISOString() },
    });
    return status;
  });
}
