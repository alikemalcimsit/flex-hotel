import {
  CHANNEL_SYNC_WORKER_NAME,
  ChannexError,
  addIsoDays,
  availabilityValues,
  clampWindow,
  createChannexClient,
  mergeSent,
  planTarget,
  restrictionValues,
} from '@hotelos/channel-sync-worker';
import { MAX_CHANNEL_HORIZON_DAYS, PERMISSIONS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { readActorEnabled } from '../../lib/actor-settings.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { lockChannels } from '../../lib/locks.js';
import { openSecret } from '../../lib/secret-box.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getHotelSettings } from '../settings/service.js';
import { channelToday, channexTargets, computeRoomTypeValues, horizonWindow } from './ari.js';

/**
 * Channex'e müsaitlik / fiyat / stop-sale gönderimi (modül 33).
 *
 * ### Akış
 *
 * Değişiklik olayları kanalı kirli işaretler (`markChannelsDirty`: gün penceresi
 * birikir). Ham SQL'de gün metin (`'2027-06-01'::date`), "şimdi" UTC duvar saati
 * (`SQL_NOW`) olarak verilir: veritabanı oturumunun saat dilimi sonucu kaydırmaz. Zamanlanmış iş (`runChannexSyncTick`, birkaç saniyede bir) işi olan
 * kanalları sırayla ele alır:
 *
 * 1. Kanal satırı kilitlenip kirli pencere **üstlenilir** (temizlenir).
 * 2. Penceredeki değerler hesaplanır, kanala en son gönderilenle karşılaştırılır;
 *    yalnızca fark, ardışık aynı değerler tek aralıkta, **en fazla iki çağrıda**
 *    (müsaitlik, fiyat + stop-sale) gönderilir.
 * 3. Başarıda gönderilenler kaydedilir, log satırı yazılır. Hatada pencere geri
 *    işaretlenir, kanal bir süre bekletilir; hiçbir değişiklik kaybolmaz.
 *
 * Tam eşitleme (pencerenin tamamı, Channex sertifikasyonu: 500 gün, iki çağrı)
 * senkrona alınınca, eşleştirme / fiyat farkı değişince, elle ve gece bir kez
 * (otelin saatiyle sakin saatlerde) yapılır.
 *
 * Çalışma durumu `ChannelState`'tedir: kanal ayarının sürümü (`Channel.updatedAt`)
 * gönderimle ilerlemez.
 *
 * ### Hız sınırı
 *
 * Channex mülk başına dakikada 10 müsaitlik + 10 fiyat çağrısı kabul eder. Fark
 * gönderimi kanal başına en sık `MIN_DELTA_INTERVAL_MS`'de bir yapılır (en fazla
 * 6 + 6 çağrı / dakika); 429 gelirse kanal bir dakika bekletilir.
 */

/** Aynı kanala iki fark gönderimi arasındaki en kısa süre (dakikada en fazla 6 + 6 çağrı). */
export const MIN_DELTA_INTERVAL_MS = 10_000;
/** Gece tam eşitlemesi: son tam eşitlemeden bu kadar sonra, otelin sakin saatlerinde. */
const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60_000;
/** Sakin saat penceresi kaçırılırsa (sunucu kapalıydı) bu kadar sonra saat beklemeden yapılır. */
const FULL_SYNC_OVERDUE_MS = 30 * 60 * 60_000;
const QUIET_HOUR_FROM = 2;
const QUIET_HOUR_TO = 5;
/** Bir turda en fazla bu kadar kanal (geri kalanı sonraki turda). */
const MAX_CHANNELS_PER_TICK = 20;
/** Art arda hatada bekleme: 30 sn × 2^(hata − 1), en fazla 15 dk. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;
/** Anahtar geçersizse yeniden denemeden önce (ayar düzeltilince hemen denenir). */
const AUTH_PAUSE_MS = 30 * 60_000;
/** Bu kadar art arda hatadan sonra yöneticinin ziline uyarı. */
const ALERT_AFTER_FAILURES = 3;
/** Log ayrıntısında hedef başına gösterilen en fazla aralık. */
const LOG_RANGE_SAMPLE = 12;
/** Hata metninin saklanan uzunluğu. */
const MAX_ERROR_LENGTH = 500;

/** Otelin saati (0–23). @param {string} timeZone @param {Date} now */
function hourIn(timeZone, now) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** "YYYY-MM-DD" → @db.Date değeri. */
const dateValue = (day) => new Date(`${day}T00:00:00.000Z`);
/** @db.Date → "YYYY-MM-DD" */
const dayText = (value) => (value ? value.toISOString().slice(0, 10) : null);
const clip = (text) => String(text ?? '').slice(0, MAX_ERROR_LENGTH);

/** @param {{ environment: string, apiKey: string }} channel */
export function channexClientFor(channel) {
  return createChannexClient({ environment: channel.environment, apiKey: openSecret(channel.apiKey) });
}

/* ══════════════════ İşaretleme (aktör) ══════════════════ */

/**
 * Otelin senkrondaki Channex kanallarını kirli işaretler. Pencere birikir
 * (önceki kirli pencereyle birleşir).
 *
 * Oda atamasında gövde tarih taşımaz: pencere rezervasyonun gecelerinden okunur
 * (`{ reservationId }`); rezervasyon bulunamazsa bütün ufuk.
 *
 * @param {string} hotelId
 * @param {{ from: string, to: string | null } | { reservationId: string } | null} hint `to` hariç; `null` = ufkun sonu
 * @returns {Promise<{ channels: number, window: { from: string, to: string | null } | null }>}
 */
export async function markChannelsDirty(hotelId, hint) {
  const window = hint && 'reservationId' in hint ? await reservationWindow(hotelId, hint.reservationId) : hint;
  const hotel = await getHotelSettings(hotelId);
  const today = channelToday(hotel);
  const limit = addIsoDays(today, MAX_CHANNEL_HORIZON_DAYS);
  const from = window?.from && window.from > today ? window.from : today;
  const to = window?.to && window.to < limit ? window.to : limit;
  if (to <= from) return { channels: 0, window };
  // Pencere `to` hariç; sütun iki ucu dahil tutar.
  const last = addIsoDays(to, -1);
  const channels = await prisma.$executeRaw`
    UPDATE "ChannelState" s
    SET "dirtyFrom" = LEAST(COALESCE(s."dirtyFrom", ${from}::date), ${from}::date),
        "dirtyTo" = GREATEST(COALESCE(s."dirtyTo", ${last}::date), ${last}::date),
        "updatedAt" = ${SQL_NOW}
    FROM "Channel" c
    WHERE s."channelId" = c."id" AND c."hotelId" = ${hotelId} AND c."status" = 'ACTIVE' AND c."type" = 'CHANNEX' AND c."deletedAt" IS NULL`;
  return { channels, window };
}

/**
 * Rezervasyonun geceleri (giriş dahil, çıkış hariç); bulunamazsa `null` (bütün ufuk).
 * @param {string} hotelId
 * @param {string} reservationId
 */
async function reservationWindow(hotelId, reservationId) {
  const row = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { checkIn: true, checkOut: true } });
  return row ? { from: dayText(row.checkIn), to: dayText(row.checkOut) } : null;
}

/**
 * Tam eşitleme ister (bir sonraki turda yapılır). `channelId` verilmezse otelin
 * senkrondaki bütün Channex kanallarında.
 *
 * @param {string} hotelId
 * @param {{ reason: string, trigger?: 'CHANGE' | 'MANUAL', channelId?: string }} request
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} [client]
 * @returns {Promise<{ channels: number }>}
 */
export async function requestFullSync(hotelId, { reason, trigger = 'CHANGE', channelId }, client = prisma) {
  const channels = channelId
    ? await client.$executeRaw`
        UPDATE "ChannelState" s
        SET "fullSyncRequestedAt" = ${SQL_NOW}, "fullSyncReason" = ${reason}, "fullSyncTrigger" = ${trigger}::"ChannelSyncTrigger", "updatedAt" = ${SQL_NOW}
        FROM "Channel" c
        WHERE s."channelId" = c."id" AND c."id" = ${channelId} AND c."hotelId" = ${hotelId} AND c."type" = 'CHANNEX' AND c."deletedAt" IS NULL`
    : await client.$executeRaw`
        UPDATE "ChannelState" s
        SET "fullSyncRequestedAt" = ${SQL_NOW}, "fullSyncReason" = ${reason}, "fullSyncTrigger" = ${trigger}::"ChannelSyncTrigger", "updatedAt" = ${SQL_NOW}
        FROM "Channel" c
        WHERE s."channelId" = c."id" AND c."hotelId" = ${hotelId} AND c."status" = 'ACTIVE' AND c."type" = 'CHANNEX' AND c."deletedAt" IS NULL`;
  return { channels };
}

/* ══════════════════ Zamanlanmış tur ══════════════════ */

/**
 * @param {{ fullSyncRequestedAt: Date | null, lastFullSyncAt: Date | null }} state
 * @param {{ timezone: string }} hotel
 * @param {Date} now
 * @returns {'REQUESTED' | 'SCHEDULE' | null}
 */
export function fullSyncDue(state, hotel, now) {
  if (state.fullSyncRequestedAt || !state.lastFullSyncAt) return 'REQUESTED';
  const age = now.getTime() - state.lastFullSyncAt.getTime();
  if (age >= FULL_SYNC_OVERDUE_MS) return 'SCHEDULE';
  if (age < FULL_SYNC_INTERVAL_MS) return null;
  const hour = hourIn(hotel.timezone, now);
  return hour >= QUIET_HOUR_FROM && hour < QUIET_HOUR_TO ? 'SCHEDULE' : null;
}

/**
 * Bir tur: işi olan Channex kanalları sırayla (tam eşitleme ya da fark).
 * @param {{ now?: Date, logger?: { warn: Function } }} [options]
 * @returns {Promise<Array<{ channelId: string, outcome: string }>>}
 */
export async function runChannexSyncTick({ now = new Date(), logger } = {}) {
  const states = await prisma.channelState.findMany({
    where: {
      channel: { type: 'CHANNEX', status: 'ACTIVE', deletedAt: null },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    select: { channelId: true, hotelId: true, dirtyFrom: true, fullSyncRequestedAt: true, lastFullSyncAt: true, lastDeltaAt: true },
    orderBy: [{ lastDeltaAt: { sort: 'asc', nulls: 'first' } }, { channelId: 'asc' }],
  });
  const results = [];
  for (const state of states) {
    if (results.length >= MAX_CHANNELS_PER_TICK) break;
    const hotel = await getHotelSettings(state.hotelId);
    const full = fullSyncDue(state, hotel, now);
    const deltaDue = state.dirtyFrom && (!state.lastDeltaAt || now.getTime() - state.lastDeltaAt.getTime() >= MIN_DELTA_INTERVAL_MS);
    if (!full && !deltaDue) continue;
    try {
      const outcome = await syncChannel(state.channelId, { full: Boolean(full), scheduled: full === 'SCHEDULE', now });
      results.push({ channelId: state.channelId, outcome });
    } catch (error) {
      // Beklenmeyen hata (veritabanı): kanal sonraki turda yeniden ele alınır.
      logger?.warn?.({ err: error, channelId: state.channelId }, 'Kanal senkronu yapılamadı');
      results.push({ channelId: state.channelId, outcome: 'ERROR' });
    }
  }
  return results;
}

/* ══════════════════ Tek kanal ══════════════════ */

/**
 * @param {string} channelId
 * @param {{ full: boolean, scheduled?: boolean, now?: Date }} options
 * @returns {Promise<'SKIPPED' | 'NOTHING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'>}
 */
export async function syncChannel(channelId, { full, scheduled = false, now = new Date() }) {
  const head = await prisma.channel.findFirst({ where: { id: channelId }, select: { hotelId: true } });
  if (!head) return 'SKIPPED';
  const { hotelId } = head;
  // Aktör kapalıyken kanala hiçbir şey gitmez; kirli pencere bekler (açılınca tam eşitleme istenir).
  if (!(await readActorEnabled(hotelId, CHANNEL_SYNC_WORKER_NAME))) return 'SKIPPED';
  const hotel = await getHotelSettings(hotelId);
  const today = channelToday(hotel);

  const claim = await writeWithEvents(async (tx) => {
    if (!(await lockChannels(tx, hotelId, [channelId])).has(channelId)) return null;
    const channel = await tx.channel.findFirst({ where: { id: channelId, hotelId }, include: { state: true } });
    const state = channel?.state;
    if (!channel || !state || channel.status !== 'ACTIVE' || channel.type !== 'CHANNEX') return null;
    if (state.pausedUntil && state.pausedUntil > now) return null;
    const dirty = state.dirtyFrom ? { from: dayText(state.dirtyFrom), to: addIsoDays(dayText(state.dirtyTo), 1) } : null;
    const window = full ? horizonWindow(today, channel.horizonDays) : dirty ? clampWindow(dirty, today, channel.horizonDays) : null;
    await tx.channelState.update({
      where: { channelId },
      data: {
        dirtyFrom: null,
        dirtyTo: null,
        ...(full ? { fullSyncRequestedAt: null, fullSyncReason: null, fullSyncTrigger: null } : {}),
        // Pencere geçmişte kaldıysa gönderilecek bir şey yok; yine de "son gönderim" ilerler.
        ...(!full && !window ? { lastDeltaAt: now } : {}),
      },
    });
    return window ? { channel, state, window } : null;
  });
  if (!claim) return 'SKIPPED';
  const { channel, state, window } = claim;
  const trigger = full ? (scheduled ? 'SCHEDULE' : state.fullSyncTrigger ?? 'CHANGE') : 'CHANGE';
  const reason = full ? (scheduled ? 'Gece tam eşitlemesi' : state.fullSyncReason ?? 'İlk tam eşitleme') : null;
  const startedAt = Date.now();
  const failure = { channel, state, window, full, trigger, reason, startedAt, now };

  const rooms = await prisma.channelRoomMapping.findMany({
    where: { channelId, externalRoomTypeId: { not: null } },
    select: {
      id: true,
      roomTypeId: true,
      externalRoomTypeId: true,
      externalName: true,
      roomType: { select: { name: true } },
      rates: { select: { externalRatePlanId: true, externalName: true, boardType: true } },
    },
  });
  if (rooms.length === 0) {
    await prisma.channelState.update({ where: { channelId }, data: { lastDeltaAt: now, ...(full ? { lastFullSyncAt: now } : {}) } });
    return 'NOTHING';
  }

  const sentStates = await prisma.channelAriState.findMany({ where: { channelId }, select: { kind: true, externalId: true, sent: true } });
  const sentOf = (kind, externalId) => sentStates.find((row) => row.kind === kind && row.externalId === externalId)?.sent ?? {};

  let plan;
  try {
    const values = await computeRoomTypeValues({ hotelId, channel, rooms, window });
    plan = buildPlan({ channel, rooms, targets: channexTargets(values, rooms), sentOf, full });
  } catch (error) {
    await recordFailure({ ...failure, error });
    throw error;
  }

  if (plan.availabilityValues.length === 0 && plan.restrictionValues.length === 0) {
    await prisma.channelState.update({ where: { channelId }, data: { lastDeltaAt: now, ...(full ? { lastFullSyncAt: now } : {}) } });
    return 'NOTHING';
  }

  const client = channexClientFor(channel);
  const taskIds = [];
  const warnings = [];
  let availabilityDelivered = false;
  try {
    if (plan.availabilityValues.length > 0) {
      const result = await client.updateAvailability(plan.availabilityValues);
      availabilityDelivered = true;
      if (result.taskId) taskIds.push(result.taskId);
      warnings.push(...result.warnings.map((warning) => ({ endpoint: 'availability', warning })));
    }
    if (plan.restrictionValues.length > 0) {
      const result = await client.updateRestrictions(plan.restrictionValues);
      if (result.taskId) taskIds.push(result.taskId);
      warnings.push(...result.warnings.map((warning) => ({ endpoint: 'restrictions', warning })));
    }
  } catch (error) {
    // Müsaitlik gittiyse kaydedilir (yeniden gönderilmez); fiyat penceresi geri işaretlenir.
    if (availabilityDelivered) await saveSent({ channelId, plan, kinds: ['AVAILABILITY'], full: false, sentOf, today });
    await recordFailure({ ...failure, error, partialTaskIds: taskIds, plan });
    return 'FAILED';
  }

  const status = warnings.length > 0 ? 'PARTIAL' : 'SUCCESS';
  await writeWithEvents(async (tx, stage) => {
    await saveSent({ channelId, plan, kinds: ['AVAILABILITY', 'RATE'], full, sentOf, today, tx, staleStates: full ? sentStates : null });
    const log = await tx.channelSyncLog.create({
      data: {
        hotelId,
        channelId,
        kind: full ? 'FULL' : 'DELTA',
        status,
        trigger,
        summary: plan.summary + (warnings.length ? ` · kanal ${warnings.length} satırı reddetti` : ''),
        details: { ...plan.details, warnings: warnings.slice(0, 50), reason },
        externalIds: taskIds,
        windowFrom: dateValue(window.from),
        windowTo: dateValue(addIsoDays(window.to, -1)),
        durationMs: Date.now() - startedAt,
      },
      select: { id: true },
    });
    await tx.channelState.update({
      where: { channelId },
      data: {
        lastDeltaAt: now,
        ...(full ? { lastFullSyncAt: now } : {}),
        lastSyncAt: now,
        lastSyncStatus: status,
        failureCount: 0,
        pausedUntil: null,
        ...(status === 'SUCCESS' ? { lastError: null, lastErrorAt: null } : { lastError: clip(`Kanal ${warnings.length} satırı reddetti`), lastErrorAt: now }),
      },
    });
    if (status === 'PARTIAL') {
      await raiseStaffAlert(tx, stage, syncAlert(channel, `Kanal ${warnings.length} satırı reddetti (fiyat / tarih); senkron logunda ayrıntı var`, 'WARNING'));
    }
    await stage('channel.synced', { hotelId, channelId, logId: log.id, kind: full ? 'FULL' : 'DELTA', status });
  });
  return status;
}

/**
 * Gönderilen değerleri kaydeder. Tam eşitlemede durum penceredekiyle değişir ve
 * eşleşmesi kaldırılmış hedeflerin durumu atılır (yeniden eşleşirse baştan gönderilir).
 *
 * @param {{
 *   channelId: string,
 *   plan: ReturnType<typeof buildPlan>,
 *   kinds: string[],
 *   full: boolean,
 *   sentOf: (kind: string, externalId: string) => Record<string, unknown>,
 *   today: string,
 *   tx?: import('@prisma/client').Prisma.TransactionClient,
 *   staleStates?: Array<{ kind: string, externalId: string }> | null,
 * }} input
 */
async function saveSent({ channelId, plan, kinds, full, sentOf, today, tx = prisma, staleStates = null }) {
  for (const target of plan.targets) {
    if (!kinds.includes(target.kind)) continue;
    const sent = full ? Object.fromEntries(target.days) : mergeSent(sentOf(target.kind, target.externalId), target.days, today);
    await tx.channelAriState.upsert({
      where: { channelId_kind_externalId: { channelId, kind: target.kind, externalId: target.externalId } },
      create: { channelId, kind: target.kind, externalId: target.externalId, sent },
      update: { sent },
    });
  }
  if (!staleStates) return;
  const live = new Set(plan.liveTargets);
  for (const state of staleStates) {
    if (live.has(`${state.kind}:${state.externalId}`)) continue;
    await tx.channelAriState.deleteMany({ where: { channelId, kind: state.kind, externalId: state.externalId } });
  }
}

/**
 * Gönderim planı: hedef başına fark (ya da tam), Channex gövdeleri, log özeti.
 *
 * @param {{
 *   channel: { propertyId: string },
 *   rooms: Array<{ externalRoomTypeId: string, externalName: string | null, roomType: { name: string }, rates: Array<{ externalRatePlanId: string, externalName: string | null, boardType: string }> }>,
 *   targets: ReturnType<typeof channexTargets>,
 *   sentOf: (kind: string, externalId: string) => Record<string, unknown>,
 *   full: boolean,
 * }} input
 */
function buildPlan({ channel, rooms, targets, sentOf, full }) {
  const planned = [];
  const liveTargets = [];
  const availability = [];
  const restrictions = [];
  const details = { availability: [], restrictions: [] };
  for (const room of rooms) {
    const desired = targets.availability.get(room.externalRoomTypeId);
    if (!desired) continue;
    liveTargets.push(`AVAILABILITY:${room.externalRoomTypeId}`);
    const { days, ranges } = planTarget({ desired, sent: sentOf('AVAILABILITY', room.externalRoomTypeId), full });
    if (days.length > 0) {
      planned.push({ kind: 'AVAILABILITY', externalId: room.externalRoomTypeId, days });
      availability.push(...availabilityValues(channel.propertyId, room.externalRoomTypeId, ranges));
      details.availability.push({
        roomType: room.roomType.name,
        external: room.externalName ?? room.externalRoomTypeId,
        days: days.length,
        ranges: ranges.length,
        sample: ranges.slice(0, LOG_RANGE_SAMPLE).map((range) => ({ from: range.from, to: range.to, availability: range.value })),
      });
    }
    for (const rate of room.rates) {
      const rateDesired = targets.restrictions.get(rate.externalRatePlanId);
      if (!rateDesired) continue;
      liveTargets.push(`RATE:${rate.externalRatePlanId}`);
      const ratePlan = planTarget({ desired: rateDesired, sent: sentOf('RATE', rate.externalRatePlanId), full });
      if (ratePlan.days.length === 0) continue;
      planned.push({ kind: 'RATE', externalId: rate.externalRatePlanId, days: ratePlan.days });
      const values = restrictionValues(channel.propertyId, rate.externalRatePlanId, ratePlan.ranges);
      restrictions.push(...values);
      details.restrictions.push({
        roomType: room.roomType.name,
        boardType: rate.boardType,
        external: rate.externalName ?? rate.externalRatePlanId,
        days: ratePlan.days.length,
        ranges: ratePlan.ranges.length,
        sample: values.slice(0, LOG_RANGE_SAMPLE).map((value) => ({ from: value.date_from, to: value.date_to, rate: value.rate, stopSell: value.stop_sell })),
      });
    }
  }
  const availabilityDays = details.availability.reduce((total, row) => total + row.days, 0);
  const rateDays = details.restrictions.reduce((total, row) => total + row.days, 0);
  const parts = [];
  if (details.availability.length) parts.push(`müsaitlik: ${details.availability.length} oda tipi, ${availabilityDays} gün`);
  if (details.restrictions.length) parts.push(`fiyat: ${details.restrictions.length} fiyat planı, ${rateDays} gün`);
  const summary = `${full ? 'Tam eşitleme' : 'Değişiklik'} — ${parts.join(' · ') || 'gönderilecek değer yok'}`;
  return { targets: planned, liveTargets, availabilityValues: availability, restrictionValues: restrictions, details, summary };
}

/** @param {{ id: string, hotelId: string, name: string }} channel @param {string} body @param {'WARNING' | 'CRITICAL'} severity */
function syncAlert(channel, body, severity) {
  return {
    hotelId: channel.hotelId,
    kind: 'CHANNEL_SYNC',
    severity,
    title: `${channel.name}: kanala gönderim başarısız`,
    body,
    link: `/kanallar/${channel.id}/log`,
    permission: PERMISSIONS.CHANNEL_MANAGER_MANAGE,
    entityType: 'Channel',
    entityId: channel.id,
    dedupeKey: `channel-sync:${channel.id}`,
  };
}

/**
 * Hata: pencere geri işaretlenir (tam eşitleme isteği geri konur), kanal hata
 * türüne göre bekletilir, log yazılır; art arda hatada ya da anahtar hatasında
 * yöneticiye uyarı.
 *
 * @param {object} input
 */
async function recordFailure({ channel, state, window, full, trigger, reason, error, startedAt, now, partialTaskIds = [], plan = null }) {
  const isChannex = error instanceof ChannexError;
  const failureCount = state.failureCount + 1;
  const pauseMs = isChannex && error.code === 'CHANNEX_RATE_LIMIT'
    ? error.retryAfterMs
    : isChannex && error.auth
      ? AUTH_PAUSE_MS
      : Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS);
  const message = clip(error?.message ?? 'Bilinmeyen hata');

  await writeWithEvents(async (tx, stage) => {
    // Gönderilemeyen pencere geri işaretlenir (bu arada gelen yeni kirli pencereyle birleşerek).
    if (!full) {
      await tx.$executeRaw`
        UPDATE "ChannelState"
        SET "dirtyFrom" = LEAST(COALESCE("dirtyFrom", ${window.from}::date), ${window.from}::date),
            "dirtyTo" = GREATEST(COALESCE("dirtyTo", ${addIsoDays(window.to, -1)}::date), ${addIsoDays(window.to, -1)}::date)
        WHERE "channelId" = ${channel.id}`;
    }
    await tx.channelState.update({
      where: { channelId: channel.id },
      data: {
        failureCount,
        lastError: message,
        lastErrorAt: now,
        lastSyncAt: now,
        lastSyncStatus: 'FAILED',
        pausedUntil: new Date(now.getTime() + pauseMs),
        ...(full ? { fullSyncRequestedAt: now, fullSyncReason: reason ?? 'Önceki tam eşitleme başarısız', fullSyncTrigger: trigger } : {}),
      },
    });
    const log = await tx.channelSyncLog.create({
      data: {
        hotelId: channel.hotelId,
        channelId: channel.id,
        kind: full ? 'FULL' : 'DELTA',
        status: 'FAILED',
        trigger,
        summary: `${full ? 'Tam eşitleme' : 'Değişiklik'} gönderilemedi — ${message}`.slice(0, MAX_ERROR_LENGTH),
        details: {
          ...(plan?.details ?? {}),
          reason,
          error: { code: isChannex ? error.code : 'INTERNAL', status: isChannex ? error.status : null, retryInSeconds: Math.round(pauseMs / 1000) },
          // İlk çağrı geçtiyse (müsaitlik) kaydedildi; yalnızca kalan gönderilir.
          deliveredTasks: partialTaskIds,
        },
        error: message,
        externalIds: partialTaskIds,
        windowFrom: dateValue(window.from),
        windowTo: dateValue(addIsoDays(window.to, -1)),
        durationMs: Date.now() - startedAt,
      },
      select: { id: true },
    });
    if ((isChannex && error.auth) || failureCount >= ALERT_AFTER_FAILURES) {
      await raiseStaffAlert(
        tx,
        stage,
        syncAlert(channel, `${message}${isChannex && error.auth ? ' — kanal ayarından API anahtarını kontrol edin' : ` (${failureCount}. deneme)`}`, isChannex && error.auth ? 'CRITICAL' : 'WARNING'),
      );
    }
    await stage('channel.synced', { hotelId: channel.hotelId, channelId: channel.id, logId: log.id, kind: full ? 'FULL' : 'DELTA', status: 'FAILED' });
  });
}
