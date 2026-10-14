import { randomBytes } from 'node:crypto';
import { ChannexError, addIsoDays } from '@hotelos/channel-sync-worker';
import { currentActor, toIsoDay, toMoneyString } from '@hotelos/core';
import { CHANNEL_BOOKING_STATE_LABELS, MAX_CHANNEL_STOP_SALES, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockChannelBookings, lockChannels } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { openSecret, sealSecret } from '../../lib/secret-box.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { getActiveRoomTypes, getHotelSettings } from '../settings/service.js';
import { channelToday } from './ari.js';
import { markRevisionForStaff, pollChannexBookings, processBookingRevision } from './bookings.js';
import { forgetIcalExports, importIcalChannel } from './ical.js';
import { channexClientFor, markChannelsDirty, requestFullSync } from './sync.js';
import { isSyncTarget, refreshSyncTarget } from './targets.js';

/**
 * Kanal yönetimi servisi (modül 33): kanal ayarı, eşleştirme, stop-sale,
 * senkron logu ve kanal rezervasyonları.
 *
 * ### Kanalın ömrü
 *
 * Kuruluyor (bağlantı + eşleştirme) → senkronda ⇄ durduruldu → (durmuşken) silinir.
 * Senkrona alma eksik varsa reddedilir (bağlantı doğrulanmamış, para birimi
 * farklı, eşleşme yok). Senkrona alınınca / eşleştirme ya da fiyat farkı
 * değişince tam eşitleme istenir; gönderimin kendisi zamanlanmış işte.
 *
 * ### Sırlar
 *
 * Channex API anahtarı ve webhook sırrı şifreli saklanır (`secret-box`); hiçbir
 * cevapta dönmez (yalnızca "var" bilgisi). Anahtar değişince bağlantı yeniden
 * doğrulanır.
 *
 * ### Kilit
 *
 * Ayarı / eşleştirmesi / stop-sale'i değiştiren işlem kanal satırını kilitler
 * ve sürümü (`updatedAt`) denetler. Gönderim durumu ayrı tabloda (`ChannelState`):
 * arka plandaki gönderim ayarın sürümünü ilerletmez.
 */

/** Elle tam eşitleme en sık bu aralıkla (Channex tam eşitlemeyi günde bir kez ister). */
const MANUAL_FULL_SYNC_INTERVAL_MS = 5 * 60_000;
/** Elle takvim okuma en sık bu aralıkla. */
const MANUAL_ICAL_INTERVAL_MS = 60_000;
/** Belirteç uzunluğu (bayt): dışa aktarma adresi ve webhook sırrı. */
const TOKEN_BYTES = 24;

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
const day = (value) => (value ? toIsoDay(value) : null);
const dateValue = (text) => new Date(`${text}T00:00:00.000Z`);
const token = () => randomBytes(TOKEN_BYTES).toString('base64url');

/* ══════════════════ Seçimler ve DTO'lar ══════════════════ */

const STATE_SELECT = Object.freeze({
  dirtyFrom: true,
  fullSyncRequestedAt: true,
  lastFullSyncAt: true,
  lastDeltaAt: true,
  lastBookingPollAt: true,
  lastIcalImportAt: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  pausedUntil: true,
  failureCount: true,
  lastError: true,
  lastErrorAt: true,
});

const CHANNEL_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  type: true,
  name: true,
  status: true,
  environment: true,
  propertyId: true,
  apiKey: true,
  webhookId: true,
  externalName: true,
  externalCurrency: true,
  provider: true,
  priceMarkupPercent: true,
  horizonDays: true,
  activatedAt: true,
  activatedBy: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  state: { select: STATE_SELECT },
});

/**
 * Kanal (sırsız). `apiKey` yalnızca "var mı" olarak döner.
 * @param {any} row
 */
function toChannelDto(row) {
  const state = row.state ?? {};
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    environment: row.environment,
    propertyId: row.propertyId,
    hasApiKey: Boolean(row.apiKey),
    webhookConfigured: Boolean(row.webhookId),
    externalName: row.externalName,
    externalCurrency: row.externalCurrency,
    provider: row.provider,
    priceMarkupPercent: toMoneyString(String(row.priceMarkupPercent ?? 0)),
    horizonDays: row.horizonDays,
    activatedAt: iso(row.activatedAt),
    activatedBy: row.activatedBy,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    sync: {
      // Bekleyen gönderim yalnızca Channex'te olur (iCal'i kanal kendisi okur).
      pending: row.type === 'CHANNEX' && Boolean(state.dirtyFrom || state.fullSyncRequestedAt),
      lastSyncAt: iso(state.lastSyncAt),
      lastSyncStatus: state.lastSyncStatus ?? null,
      lastFullSyncAt: iso(state.lastFullSyncAt),
      lastDeltaAt: iso(state.lastDeltaAt),
      lastBookingPollAt: iso(state.lastBookingPollAt),
      lastIcalImportAt: iso(state.lastIcalImportAt),
      pausedUntil: state.pausedUntil && state.pausedUntil > new Date() ? iso(state.pausedUntil) : null,
      failureCount: state.failureCount ?? 0,
      lastError: state.lastError ?? null,
      lastErrorAt: iso(state.lastErrorAt),
    },
  };
}

/** Kanalın kaydı (kilitli ya da değil); yoksa / silinmişse 404. */
async function loadChannel(client, hotelId, channelId) {
  const row = await client.channel.findFirst({ where: { id: channelId, hotelId }, select: CHANNEL_SELECT });
  if (!row) throw new NotFoundError('Kanal bulunamadı');
  return row;
}

/**
 * Kilitli kanal + sürüm denetimi.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} channelId
 * @param {Date | undefined} expectedUpdatedAt
 */
async function lockForWrite(tx, hotelId, channelId, expectedUpdatedAt) {
  if (!(await lockChannels(tx, hotelId, [channelId])).has(channelId)) throw new NotFoundError('Kanal bulunamadı');
  const row = await loadChannel(tx, hotelId, channelId);
  if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/** Denetim izine giden kanal hâli (sırlar yalnızca "değişti" olarak). @param {any} row */
function snapshot(row) {
  return {
    name: row.name,
    status: row.status,
    environment: row.environment,
    propertyId: row.propertyId,
    provider: row.provider,
    priceMarkupPercent: toMoneyString(String(row.priceMarkupPercent ?? 0)),
    horizonDays: row.horizonDays,
    webhookConfigured: Boolean(row.webhookId),
  };
}

/* ══════════════════ Bağlantı denetimi ══════════════════ */

/**
 * Channex'te mülkü okur: anahtar ve mülk doğru mu, para birimi ne.
 * Hata kullanıcıya alanıyla döner (anahtar / mülk).
 *
 * @param {{ environment: string, apiKey: string, propertyId: string }} credentials `apiKey` açık metin
 */
async function verifyChannex({ environment, apiKey, propertyId }) {
  try {
    const client = channexClientFor({ environment, apiKey: sealSecret(apiKey) });
    return await client.getProperty(propertyId);
  } catch (error) {
    if (!(error instanceof ChannexError)) throw error;
    if (error.auth) throw new ValidationError('Channex API anahtarı geçersiz ya da bu mülke yetkisi yok', { field: 'apiKey' });
    if (error.status === 404) throw new ValidationError("Bu kimlikle bir Channex mülkü bulunamadı (ortamı ve mülk kimliğini kontrol edin)", { field: 'propertyId' });
    throw new AppError(`Channex'e ulaşılamadı: ${error.message}`, { statusCode: 502, code: 'CHANNEX_UNAVAILABLE' });
  }
}

/**
 * Ad otel içinde, Channex mülkü bütün kanallarda tekil (silinmemişler arasında).
 * Veritabanının kısmi index'leri son savunmadır; burada açık mesajla söylenir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ name: string, environment?: string | null, propertyId?: string | null, exceptId?: string }} candidate
 */
async function assertUnique(tx, hotelId, { name, environment, propertyId, exceptId }) {
  const notSelf = exceptId ? { id: { not: exceptId } } : {};
  const sameName = await tx.channel.findFirst({ where: { hotelId, name: { equals: name, mode: 'insensitive' }, deletedAt: null, ...notSelf }, select: { id: true } });
  if (sameName) throw new ConflictError('Bu adla bir kanal zaten var', 'DUPLICATE', { field: 'name' });
  if (!propertyId) return;
  const sameProperty = await tx.channel.findFirst({ where: { type: 'CHANNEX', environment, propertyId, deletedAt: null, ...notSelf }, select: { id: true } });
  if (sameProperty) throw new ConflictError('Bu Channex mülkü başka bir kanala bağlı (bir mülk tek kanala bağlanır)', 'DUPLICATE', { field: 'propertyId' });
}

/* ══════════════════ Liste ve kart ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string }} query
 */
export async function listChannels(hotelId, query) {
  const where = {
    hotelId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { name: containsText(query.search) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.channel.findMany({
      where,
      select: { ...CHANNEL_SELECT, _count: { select: { rooms: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.channel.count({ where }),
  ]);
  // Dikkat isteyen kanal rezervasyonları: sayfadaki kanallar için tek sorgu.
  const attention = rows.length
    ? await prisma.channelBooking.groupBy({
        by: ['channelId', 'state'],
        where: { hotelId, channelId: { in: rows.map((row) => row.id) }, state: { in: ['REVIEW', 'ATTENTION'] } },
        _count: { _all: true },
      })
    : [];
  const countOf = (channelId, state) => attention.find((row) => row.channelId === channelId && row.state === state)?._count._all ?? 0;
  return buildPage(
    rows.map((row) => ({
      ...toChannelDto(row),
      mappedRoomTypes: row._count.rooms,
      bookings: { attention: countOf(row.id, 'ATTENTION'), review: countOf(row.id, 'REVIEW') },
    })),
    total,
    query,
  );
}

/**
 * Kanal kartı: ayar, eşleştirme, gelecek stop-sale'ler, eksikler ve uyarılar.
 * @param {string} hotelId
 * @param {string} channelId
 */
export async function getChannel(hotelId, channelId) {
  const [row, hotel, roomTypes] = await Promise.all([loadChannel(prisma, hotelId, channelId), getHotelSettings(hotelId), getActiveRoomTypes(hotelId)]);
  const today = channelToday(hotel);
  const [rooms, stopSales, bookingCounts] = await Promise.all([
    prisma.channelRoomMapping.findMany({
      where: { channelId },
      select: {
        id: true,
        roomTypeId: true,
        externalRoomTypeId: true,
        externalName: true,
        icalImportUrl: true,
        exportToken: true,
        lastImportAt: true,
        lastImportError: true,
        lastExportAt: true,
        roomType: { select: { code: true, name: true, deletedAt: true } },
        rates: { select: { id: true, externalRatePlanId: true, externalName: true, boardType: true }, orderBy: [{ boardType: 'asc' }, { id: 'asc' }] },
      },
      orderBy: [{ roomType: { code: 'asc' } }],
    }),
    prisma.channelStopSale.findMany({
      where: { channelId, endDate: { gte: dateValue(today) } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: MAX_CHANNEL_STOP_SALES,
    }),
    prisma.channelBooking.groupBy({ by: ['state'], where: { channelId }, _count: { _all: true } }),
  ]);
  const dto = toChannelDto(row);
  const mapped = rooms.map((room) => ({
    id: room.id,
    roomTypeId: room.roomTypeId,
    roomType: { code: room.roomType.code, name: room.roomType.name, deleted: Boolean(room.roomType.deletedAt) },
    externalRoomTypeId: room.externalRoomTypeId,
    externalName: room.externalName,
    icalImportUrl: room.icalImportUrl,
    // Dışa aktarma adresinin yolu (ekran sunucunun kök adresiyle birleştirir).
    exportPath: row.type === 'ICAL' && room.exportToken ? `/channel-ical/${room.exportToken}.ics` : null,
    lastImportAt: iso(room.lastImportAt),
    lastImportError: room.lastImportError,
    lastExportAt: iso(room.lastExportAt),
    rates: room.rates,
  }));
  const typeName = new Map(roomTypes.map((type) => [type.id, type.name]));
  return {
    ...dto,
    rooms: mapped,
    stopSales: stopSales.map((sale) => ({
      id: sale.id,
      roomTypeIds: sale.roomTypeIds,
      roomTypes: sale.roomTypeIds.map((id) => typeName.get(id) ?? '—'),
      startDate: day(sale.startDate),
      endDate: day(sale.endDate),
      reason: sale.reason,
      createdBy: sale.createdBy,
      createdAt: iso(sale.createdAt),
    })),
    bookingCounts: Object.fromEntries(Object.keys(CHANNEL_BOOKING_STATE_LABELS).map((state) => [state, bookingCounts.find((row) => row.state === state)?._count._all ?? 0])),
    readiness: readiness(row, mapped, roomTypes, hotel),
    today,
  };
}

/**
 * Senkrona almayı engelleyen eksikler ve uyarılar.
 * @param {any} channel
 * @param {Array<{ roomType: { name: string, deleted: boolean }, roomTypeId: string, externalRoomTypeId: string | null, icalImportUrl: string | null, rates: unknown[] }>} rooms
 * @param {Array<{ id: string, name: string }>} roomTypes
 * @param {{ currency: string }} hotel
 */
function readiness(channel, rooms, roomTypes, hotel) {
  const blockers = [];
  const warnings = [];
  if (channel.type === 'CHANNEX') {
    if (!channel.externalCurrency) {
      blockers.push('Channex bağlantısı doğrulanmadı: ayarı kaydedin (anahtar ve mülk denetlenir)');
    } else if (channel.externalCurrency !== hotel.currency) {
      blockers.push(
        `Channex mülkünün para birimi (${channel.externalCurrency}) otelinkinden (${hotel.currency}) farklı: fiyatlar yanlış gider. Channex'te mülkün para birimini düzeltip ayarı yeniden kaydedin`,
      );
    }
    for (const room of rooms) if (room.rates.length === 0) blockers.push(`${room.roomType.name}: fiyat planı eşleşmemiş (fiyat ve pansiyon için en az bir plan)`);
    if (!channel.webhookId) warnings.push('Webhook kurulmadı: yeni rezervasyonlar dakikada bir okunur (kurulursa anında)');
  } else {
    for (const room of rooms) if (!room.icalImportUrl) warnings.push(`${room.roomType.name}: kanalın takvim adresi girilmedi; yalnızca dışa aktarılır (kanaldaki rezervasyonlar gelmez)`);
  }
  if (rooms.length === 0) blockers.push('En az bir oda tipi eşleştirin');
  for (const room of rooms) if (room.roomType.deleted) blockers.push(`${room.roomType.name}: oda tipi silinmiş; eşleşmeyi kaldırın`);
  const mappedIds = new Set(rooms.map((room) => room.roomTypeId));
  const unmapped = roomTypes.filter((type) => !mappedIds.has(type.id)).map((type) => type.name);
  if (rooms.length > 0 && unmapped.length > 0) warnings.push(`Eşleşmeyen oda tipleri bu kanalda satılmaz: ${unmapped.join(', ')}`);
  return { blockers, warnings };
}

/* ══════════════════ Açma / düzenleme ══════════════════ */

/**
 * @param {string} hotelId
 * @param {object} input `createChannelSchema` çıktısı
 */
export async function createChannel(hotelId, input) {
  const property = input.type === 'CHANNEX' ? await verifyChannex(input) : null;
  const actor = currentActor();
  let channelId;
  try {
    channelId = await writeWithEvents(async (tx, stage) => {
      await assertUnique(tx, hotelId, { name: input.name, environment: input.environment ?? null, propertyId: input.propertyId ?? null });
      const created = await tx.channel.create({
        data: {
          hotelId,
          type: input.type,
          name: input.name,
          horizonDays: input.horizonDays,
          createdBy: actor,
          ...(input.type === 'CHANNEX'
            ? {
                environment: input.environment,
                propertyId: input.propertyId,
                apiKey: sealSecret(input.apiKey),
                priceMarkupPercent: input.priceMarkupPercent,
                externalName: property?.title ?? null,
                externalCurrency: property?.currency ?? null,
              }
            : { provider: input.provider }),
          state: { create: { hotelId } },
        },
        select: CHANNEL_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Channel', entityId: created.id, action: 'CREATE', after: snapshot(created) });
      await stage('channel.changed', { hotelId, channelId: created.id, change: 'CREATED' });
      return created.id;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir kanal zaten var' });
  }
  return getChannel(hotelId, channelId);
}

/**
 * Ayar düzenleme. Channex bağlantısı (ortam, mülk, anahtar) değişince yeniden
 * doğrulanır; mülk ya da ortam değişince eşleştirme ve gönderim durumu silinir
 * (kimlikler eski mülke aitti) — bu yalnızca durdurulmuş / kurulan kanalda olur.
 *
 * @param {string} hotelId
 * @param {string} channelId
 * @param {object} input `updateChannelSchema` çıktısı
 */
export async function updateChannel(hotelId, channelId, input) {
  const current = await loadChannel(prisma, hotelId, channelId);
  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
  const isChannex = current.type === 'CHANNEX';
  const environment = isChannex ? input.environment ?? current.environment : null;
  const propertyId = isChannex ? input.propertyId ?? current.propertyId : null;
  const propertyChanged = isChannex && (environment !== current.environment || propertyId !== current.propertyId);
  const credentialsChanged = isChannex && (propertyChanged || Boolean(input.apiKey));
  if (propertyChanged && current.status === 'ACTIVE') {
    throw new ConflictError('Senkrondaki kanalın Channex mülkü ya da ortamı değişmez; önce kanalı durdurun', 'CHANNEL_ACTIVE');
  }
  const property = credentialsChanged
    ? await verifyChannex({ environment, propertyId, apiKey: input.apiKey ?? openSecret(current.apiKey) })
    : null;

  let staleWebhook = null;
  try {
    await writeWithEvents(async (tx, stage, afterCommit) => {
      const before = await lockForWrite(tx, hotelId, channelId, input.expectedUpdatedAt);
      await assertUnique(tx, hotelId, { name: input.name, environment, propertyId, exceptId: channelId });
      const markup = isChannex ? input.priceMarkupPercent ?? toMoneyString(String(before.priceMarkupPercent)) : '0.00';
      const pricingChanged = isChannex && (markup !== toMoneyString(String(before.priceMarkupPercent)) || input.horizonDays !== before.horizonDays);
      if (propertyChanged) {
        // Eşleştirme ve gönderilen değerler eski mülkündü; webhook da eski mülke kuruluydu.
        await tx.channelRoomMapping.deleteMany({ where: { channelId } });
        await tx.channelAriState.deleteMany({ where: { channelId } });
        staleWebhook = before.webhookId ? { environment: before.environment, apiKey: before.apiKey, webhookId: before.webhookId } : null;
      }
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: {
          name: input.name,
          horizonDays: input.horizonDays,
          ...(isChannex
            ? {
                environment,
                propertyId,
                priceMarkupPercent: markup,
                ...(input.apiKey ? { apiKey: sealSecret(input.apiKey) } : {}),
                ...(property ? { externalName: property.title ?? null, externalCurrency: property.currency ?? null } : {}),
                ...(propertyChanged ? { webhookId: null, webhookSecret: null } : {}),
              }
            : { provider: input.provider ?? before.provider }),
        },
        select: CHANNEL_SELECT,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'Channel',
        entityId: channelId,
        action: 'UPDATE',
        before: snapshot(before),
        after: { ...snapshot(updated), ...(input.apiKey ? { apiKey: 'değişti' } : {}) },
      });
      if (pricingChanged && before.status === 'ACTIVE') {
        await requestFullSync(hotelId, { channelId, reason: 'Kanal fiyat farkı / gün sayısı değişti' }, tx);
      }
      await stage('channel.changed', { hotelId, channelId, change: 'UPDATED' });
      afterCommit(() => forgetIcalExports());
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir kanal zaten var' });
  }
  if (staleWebhook) await dropWebhook(staleWebhook);
  return getChannel(hotelId, channelId);
}

/**
 * Channex'teki eski webhook'u kaldırır (yapamazsa kanal çalışmaya devam eder; Channex
 * eski adrese bildirim gönderse de sır uymadığı için reddedilir).
 * @param {{ environment: string, apiKey: string, webhookId: string }} webhook
 */
async function dropWebhook(webhook) {
  try {
    await channexClientFor(webhook).deleteWebhook(webhook.webhookId);
  } catch {
    // Sessiz değil: bir sonraki webhook kurulumunda eski kayıt yine kaldırılmaya çalışılır.
  }
}

/**
 * Senkrona al / durdur.
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ expectedUpdatedAt: Date, status: 'ACTIVE' | 'PAUSED' }} input
 */
export async function setChannelStatus(hotelId, channelId, input) {
  const card = await getChannel(hotelId, channelId);
  if (input.status === 'ACTIVE' && card.readiness.blockers.length > 0) {
    throw new ConflictError(`Kanal senkrona alınamaz: ${card.readiness.blockers.join('; ')}`, 'CHANNEL_NOT_READY', { blockers: card.readiness.blockers });
  }
  await writeWithEvents(async (tx, stage, afterCommit) => {
    const before = await lockForWrite(tx, hotelId, channelId, input.expectedUpdatedAt);
    if (before.status === input.status) return;
    const actor = currentActor();
    await tx.channel.update({
      where: { id: channelId },
      data: { status: input.status, ...(input.status === 'ACTIVE' && !before.activatedAt ? { activatedAt: new Date(), activatedBy: actor } : {}) },
    });
    if (input.status === 'ACTIVE') {
      // İlk gönderim tam eşitleme; iCal takvimi hemen okunur. Durmuşken biriken kirli pencere atılır (tam eşitleme kapsar).
      await tx.channelState.update({
        where: { channelId },
        data: {
          dirtyFrom: null,
          dirtyTo: null,
          pausedUntil: null,
          failureCount: 0,
          lastIcalImportAt: null,
          ...(before.type === 'CHANNEX' ? { fullSyncRequestedAt: new Date(), fullSyncReason: 'Senkrona alındı', fullSyncTrigger: 'CHANGE' } : {}),
        },
      });
    }
    await recordAudit(tx, { hotelId, entity: 'Channel', entityId: channelId, action: 'UPDATE', before: { status: before.status }, after: { status: input.status } });
    await stage('channel.changed', { hotelId, channelId, change: input.status === 'ACTIVE' ? 'ACTIVATED' : 'PAUSED' });
    afterCommit(() => {
      forgetIcalExports();
      refreshSyncTarget(hotelId).catch(() => {});
    });
  });
  return getChannel(hotelId, channelId);
}

/**
 * Kanalı siler (yumuşak): log ve kanal rezervasyonları kalır. Senkrondaki kanal
 * silinmez (önce durdurulur). Channex webhook'u kaldırılır.
 *
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteChannel(hotelId, channelId, input) {
  const removed = await writeWithEvents(async (tx, stage, afterCommit) => {
    const before = await lockForWrite(tx, hotelId, channelId, input.expectedUpdatedAt);
    if (before.status === 'ACTIVE') throw new ConflictError('Senkrondaki kanal silinemez; önce durdurun', 'CHANNEL_ACTIVE');
    await tx.channel.update({ where: { id: channelId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'Channel', entityId: channelId, action: 'DELETE', before: snapshot(before) });
    await stage('channel.changed', { hotelId, channelId, change: 'DELETED' });
    afterCommit(() => forgetIcalExports());
    return before;
  });
  if (removed.webhookId) await dropWebhook({ environment: removed.environment, apiKey: removed.apiKey, webhookId: removed.webhookId });
}

/* ══════════════════ Eşleştirme ══════════════════ */

/**
 * Channex'teki oda tipleri ve fiyat planları (eşleştirme ekranı için, canlı okunur).
 * @param {string} hotelId
 * @param {string} channelId
 */
export async function getExternalOptions(hotelId, channelId) {
  const channel = await loadChannel(prisma, hotelId, channelId);
  if (channel.type !== 'CHANNEX') return { roomTypes: [], ratePlans: [] };
  const client = channexClientFor(channel);
  try {
    const [roomTypes, ratePlans] = await Promise.all([client.listRoomTypes(channel.propertyId), client.listRatePlans(channel.propertyId)]);
    return { roomTypes, ratePlans };
  } catch (error) {
    if (!(error instanceof ChannexError)) throw error;
    if (error.auth) throw new AppError('Channex API anahtarı geçersiz; kanal ayarından düzeltin', { statusCode: 422, code: 'CHANNEX_AUTH' });
    throw new AppError(`Channex'ten oda tipleri okunamadı: ${error.message}`, { statusCode: 502, code: 'CHANNEX_UNAVAILABLE' });
  }
}

/**
 * Eşleştirmenin tamamını kaydeder. Oda tipi başına eşleşme kaydı korunur (iCal
 * dışa aktarma adresi değişmez); kaldırılan iCal eşleşmesinden gelmiş geçerli
 * rezervasyon varsa kaldırma reddedilir (yeniden eklenince aynı kayıtlar ikinci
 * kez açılırdı).
 *
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ expectedUpdatedAt: Date, rooms: Array<{ roomTypeId: string, externalRoomTypeId?: string | null, externalName?: string | null, rates: Array<{ externalRatePlanId: string, externalName?: string | null, boardType: string }>, icalImportUrl?: string | null }> }} input
 */
export async function saveChannelMappings(hotelId, channelId, input) {
  const roomTypes = await getActiveRoomTypes(hotelId);
  const typeIds = new Set(roomTypes.map((type) => type.id));
  try {
    await writeWithEvents(async (tx, stage, afterCommit) => {
      const channel = await lockForWrite(tx, hotelId, channelId, input.expectedUpdatedAt);
      input.rooms.forEach((room, index) => {
        if (!typeIds.has(room.roomTypeId)) throw new ValidationError('Oda tipi bulunamadı', { field: `rooms.${index}.roomTypeId` });
        if (channel.type === 'CHANNEX') {
          if (!room.externalRoomTypeId) throw new ValidationError('Channex oda tipini seçin', { field: `rooms.${index}.externalRoomTypeId` });
          if (room.icalImportUrl) throw new ValidationError('Channex kanalında takvim adresi olmaz', { field: `rooms.${index}.icalImportUrl` });
        } else {
          if (room.externalRoomTypeId) throw new ValidationError('iCal kanalında kanal oda tipi olmaz', { field: `rooms.${index}.externalRoomTypeId` });
          if (room.rates.length > 0) throw new ValidationError('iCal kanalında fiyat planı olmaz', { field: `rooms.${index}.rates` });
        }
      });

      const existing = await tx.channelRoomMapping.findMany({
        where: { channelId },
        select: { id: true, roomTypeId: true, externalRoomTypeId: true, icalImportUrl: true, rates: { select: { externalRatePlanId: true, boardType: true } } },
      });
      const keep = new Set(input.rooms.map((room) => room.roomTypeId));
      const removed = existing.filter((row) => !keep.has(row.roomTypeId));
      if (channel.type === 'ICAL') {
        for (const row of removed) {
          const live = await tx.channelBooking.count({ where: { channelId, status: 'ACTIVE', externalBookingId: { startsWith: `${row.id}:` } } });
          if (live > 0) {
            const name = roomTypes.find((type) => type.id === row.roomTypeId)?.name ?? 'Oda tipi';
            throw new ConflictError(
              `${name}: bu takvimden gelmiş ${live} geçerli rezervasyon var; eşleşmeyi kaldırmak yerine takvim adresini boşaltın`,
              'MAPPING_IN_USE',
            );
          }
        }
      }
      if (removed.length) await tx.channelRoomMapping.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
      // Kalanların kanal kimlikleri önce boşaltılır: iki satır kimlik değiş tokuş ederse tekillik ara adımda bozulmasın.
      await tx.channelRateMapping.deleteMany({ where: { channelId } });
      await tx.channelRoomMapping.updateMany({ where: { channelId }, data: { externalRoomTypeId: null } });

      const byType = new Map(existing.map((row) => [row.roomTypeId, row]));
      for (const room of input.rooms) {
        const data = {
          externalRoomTypeId: room.externalRoomTypeId ?? null,
          externalName: room.externalName ?? null,
          icalImportUrl: channel.type === 'ICAL' ? room.icalImportUrl ?? null : null,
        };
        const previous = byType.get(room.roomTypeId);
        const mapping = previous
          ? await tx.channelRoomMapping.update({
              where: { id: previous.id },
              data: { ...data, ...(previous.icalImportUrl !== data.icalImportUrl ? { lastImportAt: null, lastImportError: null } : {}) },
              select: { id: true },
            })
          : await tx.channelRoomMapping.create({
              data: { hotelId, channelId, roomTypeId: room.roomTypeId, ...data, exportToken: channel.type === 'ICAL' ? token() : null },
              select: { id: true },
            });
        if (room.rates.length) {
          await tx.channelRateMapping.createMany({
            data: room.rates.map((rate) => ({
              hotelId,
              channelId,
              roomMappingId: mapping.id,
              externalRatePlanId: rate.externalRatePlanId,
              externalName: rate.externalName ?? null,
              boardType: rate.boardType,
            })),
          });
        }
      }
      // Eşleştirme kanalın ayarıdır: sürüm ilerler (açık başka form eski eşleştirmeyle yazmasın).
      await tx.channel.update({ where: { id: channelId }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        hotelId,
        entity: 'Channel',
        entityId: channelId,
        action: 'UPDATE',
        before: { mappings: existing.map((row) => ({ roomTypeId: row.roomTypeId, external: row.externalRoomTypeId, rates: row.rates.length, ical: Boolean(row.icalImportUrl) })) },
        after: { mappings: input.rooms.map((room) => ({ roomTypeId: room.roomTypeId, external: room.externalRoomTypeId ?? null, rates: room.rates.length, ical: Boolean(room.icalImportUrl) })) },
      });
      if (channel.status === 'ACTIVE') {
        if (channel.type === 'CHANNEX') await requestFullSync(hotelId, { channelId, reason: 'Eşleştirme değişti' }, tx);
        else await tx.channelState.update({ where: { channelId }, data: { lastIcalImportAt: null } });
      }
      await stage('channel.changed', { hotelId, channelId, change: 'MAPPINGS_SAVED' });
      afterCommit(() => forgetIcalExports());
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getChannel(hotelId, channelId);
}

/* ══════════════════ Stop-sale ══════════════════ */

/**
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ roomTypeIds: string[], startDate: Date, endDate: Date, reason?: string | null }} input
 */
export async function addChannelStopSale(hotelId, channelId, input) {
  const hotel = await getHotelSettings(hotelId);
  const today = channelToday(hotel);
  const start = toIsoDay(input.startDate);
  const end = toIsoDay(input.endDate);
  if (end < today) throw new ValidationError('Geçmiş günlere stop-sale konmaz', { field: 'endDate' });
  await writeWithEvents(async (tx, stage, afterCommit) => {
    const channel = await lockForWrite(tx, hotelId, channelId);
    const mapped = new Set((await tx.channelRoomMapping.findMany({ where: { channelId }, select: { roomTypeId: true } })).map((row) => row.roomTypeId));
    input.roomTypeIds.forEach((id, index) => {
      if (!mapped.has(id)) throw new ValidationError('Bu oda tipi kanalda eşleşmemiş', { field: `roomTypeIds.${index}` });
    });
    const open = await tx.channelStopSale.count({ where: { channelId, endDate: { gte: dateValue(today) } } });
    if (open >= MAX_CHANNEL_STOP_SALES) throw new ConflictError(`Bir kanalda en fazla ${MAX_CHANNEL_STOP_SALES} güncel stop-sale olur; eskileri kaldırın`, 'STOP_SALE_LIMIT');
    const created = await tx.channelStopSale.create({
      data: { hotelId, channelId, roomTypeIds: input.roomTypeIds, startDate: dateValue(start), endDate: dateValue(end), reason: input.reason ?? null, createdBy: currentActor() },
      select: { id: true },
    });
    await recordAudit(tx, { hotelId, entity: 'ChannelStopSale', entityId: created.id, action: 'CREATE', after: { channelId, roomTypeIds: input.roomTypeIds, startDate: start, endDate: end, reason: input.reason ?? null } });
    // Gönderim yalnızca Channex'e; iCal takvimi her okumada güncel hesaplanır.
    if (channel.status === 'ACTIVE' && channel.type === 'CHANNEX') await markStopSaleDirty(tx, channelId, start, end, today);
    await stage('channel.stop_sale.changed', { hotelId, channelId, change: 'ADDED' });
    afterCommit(() => forgetIcalExports());
  });
  return getChannel(hotelId, channelId);
}

/**
 * @param {string} hotelId
 * @param {string} channelId
 * @param {string} stopSaleId
 */
export async function removeChannelStopSale(hotelId, channelId, stopSaleId) {
  const hotel = await getHotelSettings(hotelId);
  const today = channelToday(hotel);
  await writeWithEvents(async (tx, stage, afterCommit) => {
    const channel = await lockForWrite(tx, hotelId, channelId);
    const sale = await tx.channelStopSale.findFirst({ where: { id: stopSaleId, channelId, hotelId } });
    if (!sale) throw new NotFoundError('Stop-sale kaydı bulunamadı');
    await tx.channelStopSale.delete({ where: { id: sale.id } });
    await recordAudit(tx, {
      hotelId,
      entity: 'ChannelStopSale',
      entityId: sale.id,
      action: 'DELETE',
      before: { channelId, roomTypeIds: sale.roomTypeIds, startDate: day(sale.startDate), endDate: day(sale.endDate), reason: sale.reason },
    });
    // Gönderim yalnızca Channex'e; iCal takvimi her okumada güncel hesaplanır.
    if (channel.status === 'ACTIVE' && channel.type === 'CHANNEX') await markStopSaleDirty(tx, channelId, day(sale.startDate), day(sale.endDate), today);
    await stage('channel.stop_sale.changed', { hotelId, channelId, change: 'REMOVED' });
    afterCommit(() => forgetIcalExports());
  });
  return getChannel(hotelId, channelId);
}

/**
 * Stop-sale günlerini (bugünden önceki kısmı hariç) kanalın kirli penceresine ekler.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function markStopSaleDirty(tx, channelId, start, end, today) {
  const from = start > today ? start : today;
  if (end < from) return;
  await tx.$executeRaw`
    UPDATE "ChannelState"
    SET "dirtyFrom" = LEAST(COALESCE("dirtyFrom", ${from}::date), ${from}::date),
        "dirtyTo" = GREATEST(COALESCE("dirtyTo", ${end}::date), ${end}::date),
        "updatedAt" = ${SQL_NOW}
    WHERE "channelId" = ${channelId}`;
}

/* ══════════════════ Senkron ══════════════════ */

/**
 * Elle senkron: Channex'te tam eşitleme istenir (birkaç saniye içinde zamanlanmış
 * iş yapar) ve rezervasyonlar okunur; iCal'de takvimler hemen okunur.
 *
 * @param {string} hotelId
 * @param {string} channelId
 * @returns {Promise<{ queued: true, kind: 'FULL' | 'ICAL_IMPORT' }>}
 */
export async function requestManualSync(hotelId, channelId) {
  const channel = await loadChannel(prisma, hotelId, channelId);
  if (channel.status !== 'ACTIVE') throw new ConflictError('Yalnızca senkrondaki kanal eşitlenir', 'CHANNEL_NOT_ACTIVE');
  const now = Date.now();
  if (channel.type === 'CHANNEX') {
    const last = channel.state?.lastFullSyncAt?.getTime() ?? 0;
    if (!channel.state?.fullSyncRequestedAt && now - last < MANUAL_FULL_SYNC_INTERVAL_MS) {
      const minutes = Math.ceil((MANUAL_FULL_SYNC_INTERVAL_MS - (now - last)) / 60_000);
      throw new ConflictError(`Son tam eşitleme az önce yapıldı; ${minutes} dakika sonra yeniden deneyin`, 'SYNC_TOO_SOON');
    }
    await requestFullSync(hotelId, { channelId, reason: 'Elle istendi', trigger: 'MANUAL' });
    pollChannexBookings(channelId, { trigger: 'MANUAL' }).catch(() => {});
    return { queued: true, kind: 'FULL' };
  }
  const last = channel.state?.lastIcalImportAt?.getTime() ?? 0;
  if (now - last < MANUAL_ICAL_INTERVAL_MS) throw new ConflictError('Takvim az önce okundu; bir dakika sonra yeniden deneyin', 'SYNC_TOO_SOON');
  importIcalChannel(channelId, { trigger: 'MANUAL' }).catch(() => {});
  return { queued: true, kind: 'ICAL_IMPORT' };
}

/**
 * Channex'te rezervasyon webhook'u kurar (varsa eskisini kaldırır). Sır şifreli
 * saklanır; Channex her bildirimde başlıkta gönderir.
 *
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ expectedUpdatedAt: Date, callbackBaseUrl: string }} input
 */
export async function setupChannexWebhook(hotelId, channelId, input) {
  const channel = await loadChannel(prisma, hotelId, channelId);
  if (channel.type !== 'CHANNEX') throw new ConflictError('Webhook yalnızca Channex kanalında kurulur', 'CHANNEL_TYPE');
  if (channel.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
  const secret = token();
  const callbackUrl = `${input.callbackBaseUrl.replace(/\/+$/, '')}/webhooks/channex/${channelId}`;
  const client = channexClientFor(channel);
  const startedAt = Date.now();
  let webhookId;
  try {
    webhookId = await client.createWebhook({ propertyId: channel.propertyId, callbackUrl, secret });
  } catch (error) {
    if (!(error instanceof ChannexError)) throw error;
    await writeSetupLog(channel, { status: 'FAILED', summary: `Webhook kurulamadı — ${error.message}`, error: error.message, startedAt });
    throw new AppError(`Channex webhook'u kurulamadı: ${error.message}`, { statusCode: error.auth ? 422 : 502, code: 'CHANNEX_WEBHOOK' });
  }
  const previous = channel.webhookId;
  await writeWithEvents(async (tx, stage) => {
    await lockForWrite(tx, hotelId, channelId, input.expectedUpdatedAt);
    await tx.channel.update({ where: { id: channelId }, data: { webhookId, webhookSecret: sealSecret(secret) } });
    await recordAudit(tx, { hotelId, entity: 'Channel', entityId: channelId, action: 'UPDATE', before: { webhookConfigured: Boolean(previous) }, after: { webhookConfigured: true, callbackUrl } });
    const log = await tx.channelSyncLog.create({
      data: { hotelId, channelId, kind: 'SETUP', status: 'SUCCESS', trigger: 'MANUAL', summary: `Webhook kuruldu: ${callbackUrl}`, details: { callbackUrl }, externalIds: [webhookId], durationMs: Date.now() - startedAt },
      select: { id: true },
    });
    await stage('channel.changed', { hotelId, channelId, change: 'WEBHOOK_SET' });
    await stage('channel.synced', { hotelId, channelId, logId: log.id, kind: 'SETUP', status: 'SUCCESS' });
  });
  if (previous && previous !== webhookId) await dropWebhook({ environment: channel.environment, apiKey: channel.apiKey, webhookId: previous });
  return getChannel(hotelId, channelId);
}

/** @param {any} channel @param {{ status: string, summary: string, error?: string, startedAt: number }} entry */
async function writeSetupLog(channel, { status, summary, error = null, startedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const log = await tx.channelSyncLog.create({
      data: { hotelId: channel.hotelId, channelId: channel.id, kind: 'SETUP', status, trigger: 'MANUAL', summary: summary.slice(0, 500), error, durationMs: Date.now() - startedAt },
      select: { id: true },
    });
    await stage('channel.synced', { hotelId: channel.hotelId, channelId: channel.id, logId: log.id, kind: 'SETUP', status });
  });
}

/* ══════════════════ Log ══════════════════ */

const LOG_SELECT = Object.freeze({
  id: true,
  kind: true,
  status: true,
  trigger: true,
  summary: true,
  error: true,
  externalIds: true,
  windowFrom: true,
  windowTo: true,
  durationMs: true,
  createdAt: true,
});

/** @param {any} row */
const toLogDto = (row) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  trigger: row.trigger,
  summary: row.summary,
  error: row.error,
  externalIds: row.externalIds,
  windowFrom: day(row.windowFrom),
  windowTo: day(row.windowTo),
  durationMs: row.durationMs,
  createdAt: iso(row.createdAt),
  ...(row.details !== undefined ? { details: row.details } : {}),
});

/**
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ page: number, pageSize: number, kind?: string, status?: string, from?: Date, to?: Date }} query
 */
export async function listChannelLogs(hotelId, channelId, query) {
  await loadChannel(prisma, hotelId, channelId);
  const hotel = await getHotelSettings(hotelId);
  const where = {
    hotelId,
    channelId,
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: zonedWallTimeToUtc(`${toIsoDay(query.from)}T00:00`, hotel.timezone) } : {}),
            ...(query.to ? { lt: zonedWallTimeToUtc(`${addIsoDays(toIsoDay(query.to), 1)}T00:00`, hotel.timezone) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.channelSyncLog.findMany({ where, select: LOG_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }),
    prisma.channelSyncLog.count({ where }),
  ]);
  return buildPage(rows.map(toLogDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {string} channelId
 * @param {string} logId
 */
export async function getChannelLog(hotelId, channelId, logId) {
  const row = await prisma.channelSyncLog.findFirst({ where: { id: logId, channelId, hotelId }, select: { ...LOG_SELECT, details: true } });
  if (!row) throw new NotFoundError('Log kaydı bulunamadı');
  return toLogDto(row);
}

/* ══════════════════ Kanal rezervasyonları ══════════════════ */

/**
 * @param {string} hotelId
 * @param {string} channelId
 * @param {{ page: number, pageSize: number, search?: string, state?: string }} query
 */
export async function listChannelBookings(hotelId, channelId, query) {
  await loadChannel(prisma, hotelId, channelId);
  const where = {
    hotelId,
    channelId,
    ...(query.state ? { state: query.state } : {}),
    ...(query.search ? { OR: [{ externalCode: containsText(query.search) }, { guestName: containsText(query.search) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.channelBooking.findMany({
      where,
      select: {
        id: true,
        externalBookingId: true,
        externalCode: true,
        otaName: true,
        status: true,
        state: true,
        stateReason: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        roomCount: true,
        amount: true,
        currency: true,
        appliedRevisionAt: true,
        resolvedAt: true,
        resolvedBy: true,
        resolutionNote: true,
        createdAt: true,
        updatedAt: true,
        reservations: { select: { id: true, confirmationCode: true, status: true, channelRoomIndex: true }, orderBy: [{ channelRoomIndex: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
    prisma.channelBooking.count({ where }),
  ]);
  return buildPage(
    rows.map((row) => ({
      ...row,
      checkIn: day(row.checkIn),
      checkOut: day(row.checkOut),
      amount: row.amount === null ? null : toMoneyString(String(row.amount)),
      appliedRevisionAt: iso(row.appliedRevisionAt),
      resolvedAt: iso(row.resolvedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    total,
    query,
  );
}

/**
 * "Doğrulanmalı" / "elle işlenmeli" kaydı, personel gereğini yaptıktan sonra kapatır.
 * @param {string} hotelId
 * @param {string} channelId
 * @param {string} bookingId
 * @param {{ note: string }} input
 */
export async function resolveChannelBooking(hotelId, channelId, bookingId, input) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockChannelBookings(tx, hotelId, [bookingId])).has(bookingId)) throw new NotFoundError('Kanal rezervasyonu bulunamadı');
    const booking = await tx.channelBooking.findFirst({ where: { id: bookingId, channelId, hotelId }, select: { id: true, state: true, stateReason: true } });
    if (!booking) throw new NotFoundError('Kanal rezervasyonu bulunamadı');
    if (!['REVIEW', 'ATTENTION'].includes(booking.state)) {
      throw new ConflictError(`Bu kayıt "${CHANNEL_BOOKING_STATE_LABELS[booking.state]}" durumunda; kapatılacak bir şey yok`, 'BOOKING_NOT_OPEN');
    }
    const actor = currentActor();
    await tx.channelBooking.update({
      where: { id: bookingId },
      data: { state: 'PROCESSED', resolvedAt: new Date(), resolvedBy: actor, resolutionNote: input.note },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'ChannelBooking',
      entityId: bookingId,
      action: 'UPDATE',
      before: { state: booking.state, stateReason: booking.stateReason },
      after: { state: 'PROCESSED', resolutionNote: input.note },
    });
    await stage('channel.booking.changed', { hotelId, channelId, bookingId, state: 'PROCESSED' });
  });
}

/* ══════════════════ Aktör servisi ══════════════════ */

/**
 * Kanal aktörünün (`channel-sync-worker`) veritabanına bağlandığı yer.
 */
export const channelSyncService = Object.freeze({
  isSyncTarget,
  markDirty: (hotelId, window) => markChannelsDirty(hotelId, window),
  requestFullSync: (hotelId, reason) => requestFullSync(hotelId, { reason }),
  processBookingRevision,
  markRevisionForStaff,
});
