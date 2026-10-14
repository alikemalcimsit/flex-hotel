import { randomUUID } from 'node:crypto';
import {
  CHANNEX_FEED_PAGE_SIZE,
  ChannexError,
  InvalidChannelBookingError,
  normalizeChannexRevision,
} from '@hotelos/channel-sync-worker';
import { getContext, runWithContext } from '@hotelos/core';
import { MAX_PRICE_NOTE_LENGTH, MAX_RESERVATION_NOTES_LENGTH, PERMISSIONS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { applyReservationUpdate, cancelReservation, createReservation } from '../reservations/service.js';
import { getHotelSettings } from '../settings/service.js';
import { channexClientFor } from './sync.js';

/**
 * Kanaldan gelen rezervasyonlar (modül 33).
 *
 * ### Alım (Channex)
 *
 * Revizyon akışı okunur (eskiden yeniye); her revizyon ortak biçime çevrilip
 * **önce kalıcı olarak saklanır, sonra Channex'e teyit edilir** (teyit
 * edilmeyen revizyon tekrar gelir; saklanmadan teyit edilen kaybolurdu). Saklama
 * ile birlikte `channel.booking.received` yayınlanır; kanal aktörü işler.
 * Webhook yalnızca "akışı şimdi oku" demektir; akış dakikada bir de okunur.
 *
 * ### İşleme (Channex ve iCal ortak)
 *
 * Karar (kullanıcı): OTA rezervasyonu **onaylı** açılır, tutarı **OTA'nın
 * tutarıdır**; yer yoksa reddedilmez — kapasite aşılarak açılır, resepsiyona
 * "overbooking" uyarısı düşer. Her oda ayrı rezervasyondur (oda sırasıyla bağlı).
 * Değişiklikte bekleyen / onaylı rezervasyon güncellenir; iptalde iptal edilir
 * (ceza OTA'nın konusu: iptal cezası uygulanmaz). Yapılamayan adım (eşleşmeyen
 * oda tipi, içerideki misafir, geçmiş giriş) "elle işlenmeli" olur ve
 * resepsiyona görev düşer. Aynı rezervasyonun revizyonları sırayla, eskisi
 * yenisinin üstüne yazılmadan uygulanır.
 */

/** Bir okumada en fazla bu kadar sayfa (sayfa = 100 revizyon); kalanı sonraki turda. */
const MAX_FEED_ROUNDS = 10;
/** Aynı hata bu süreden sık loga yazılmaz (dakikada bir okuma, saatlerce süren kesinti). */
const POLL_ERROR_LOG_INTERVAL_MS = 15 * 60_000;
/** Okuma hatasının öneki (kanalın hatası okuma mı gönderim mi, ayırt edilsin). */
const POLL_ERROR_PREFIX = 'Rezervasyonlar okunamadı:';
/** Etkin (envanter tüketen ya da gerçekleşmiş) rezervasyon durumları. */
const CANCELLABLE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED']);
/** Kanal otomasyonunun kendi iptallerinin imzası (`cancelledBy`). */
const CHANNEL_ACTOR_PREFIX = 'kanal:';
const MAX_STATE_REASON_LENGTH = 1000;

/** "2027-06-01" → "01.06.2027" */
const dotted = (day) => (day ? day.split('-').reverse().join('.') : '?');
/** @db.Date / Date → "YYYY-MM-DD" */
const dayText = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const dateValue = (day) => new Date(`${day}T00:00:00.000Z`);
const money = (value) => (value === null || value === undefined ? null : String(value));

/* ══════════════════ Saklama ══════════════════ */

/**
 * Ortak biçimdeki revizyonu saklar (yoksa kanal rezervasyonunu açar) ve
 * aktöre haber verir. Aynı revizyon ikinci kez saklanmaz.
 *
 * @param {{ id: string, hotelId: string }} channel
 * @param {import('@hotelos/channel-sync-worker').NormalizedBooking} booking
 * @returns {Promise<boolean>} yeni saklandı mı
 */
export async function storeRevision(channel, booking) {
  return writeWithEvents(async (tx, stage) => {
    const row = await tx.channelBooking.upsert({
      where: { channelId_externalBookingId: { channelId: channel.id, externalBookingId: booking.externalBookingId } },
      create: {
        hotelId: channel.hotelId,
        channelId: channel.id,
        externalBookingId: booking.externalBookingId,
        externalCode: booking.externalCode,
        otaName: booking.otaName,
        status: booking.status,
        guestName: guestLabel(booking.guest),
        checkIn: booking.checkIn ? dateValue(booking.checkIn) : null,
        checkOut: booking.checkOut && booking.checkIn && booking.checkOut > booking.checkIn ? dateValue(booking.checkOut) : null,
        roomCount: Math.max(booking.rooms.length, 1),
        amount: booking.amount,
        currency: booking.currency,
      },
      update: {},
      select: { id: true },
    });
    const revisionId = randomUUID();
    const inserted = await tx.channelBookingRevision.createMany({
      data: [
        {
          id: revisionId,
          hotelId: channel.hotelId,
          channelId: channel.id,
          bookingId: row.id,
          externalRevisionId: booking.externalRevisionId,
          kind: booking.kind,
          occurredAt: new Date(booking.occurredAt),
          payload: booking,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return false;
    await stage('channel.booking.received', { hotelId: channel.hotelId, channelId: channel.id, bookingId: row.id, revisionId });
    return true;
  });
}

/** @param {{ firstName: string | null, lastName: string | null }} guest */
function guestLabel(guest) {
  return [guest.firstName, guest.lastName].filter(Boolean).join(' ').slice(0, 200) || null;
}

/* ══════════════════ Channex akışı ══════════════════ */

/** Aynı kanalın akışı bu süreçte aynı anda iki kez okunmaz (webhook + zamanlanmış). */
const polling = new Set();

/**
 * Teyit edilmemiş revizyonları okur, saklar, teyit eder.
 *
 * @param {string} channelId
 * @param {{ trigger?: 'SCHEDULE' | 'WEBHOOK' | 'MANUAL', now?: Date }} [options]
 * @returns {Promise<{ skipped?: boolean, received: number, duplicates: number, invalid: number, error?: string }>}
 */
export async function pollChannexBookings(channelId, { trigger = 'SCHEDULE', now = new Date() } = {}) {
  if (polling.has(channelId)) return { skipped: true, received: 0, duplicates: 0, invalid: 0 };
  polling.add(channelId);
  try {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, type: 'CHANNEX', status: 'ACTIVE' }, include: { state: true } });
    if (!channel?.state) return { skipped: true, received: 0, duplicates: 0, invalid: 0 };
    const startedAt = Date.now();
    const counts = { NEW: 0, MODIFIED: 0, CANCELLED: 0 };
    let duplicates = 0;
    let invalid = 0;
    const invalidDetails = [];
    try {
      const client = channexClientFor(channel);
      for (let round = 0; round < MAX_FEED_ROUNDS; round += 1) {
        const { revisions } = await client.bookingFeed(channel.propertyId);
        let progressed = false;
        for (const raw of revisions) {
          let booking;
          try {
            booking = normalizeChannexRevision(raw);
          } catch (error) {
            if (!(error instanceof InvalidChannelBookingError)) throw error;
            invalid += 1;
            invalidDetails.push({ revisionId: raw?.id ?? null, bookingId: raw?.booking_id ?? null, otaCode: raw?.ota_reservation_code ?? null, error: error.message });
            // Kimliği olmayan revizyon teyit edilemez; akış takılmasın diye tur biter.
            if (!raw?.id) continue;
            await client.ackRevision(raw.id);
            progressed = true;
            continue;
          }
          if (await storeRevision(channel, booking)) counts[booking.kind] += 1;
          else duplicates += 1;
          await client.ackRevision(booking.externalRevisionId);
          progressed = true;
        }
        if (!progressed || revisions.length < CHANNEX_FEED_PAGE_SIZE) break;
      }
    } catch (error) {
      await recordPollFailure(channel, { error, trigger, startedAt, now });
      return { received: counts.NEW + counts.MODIFIED + counts.CANCELLED, duplicates, invalid, error: error.message };
    }

    const received = counts.NEW + counts.MODIFIED + counts.CANCELLED;
    await writeWithEvents(async (tx, stage) => {
      const pollFailed = channel.state.lastError?.startsWith(POLL_ERROR_PREFIX);
      await tx.channelState.update({
        where: { channelId: channel.id },
        data: {
          lastBookingPollAt: now,
          // Önceki okuma hatası düzeldiyse kanalın hatası temizlenir (gönderim hatası kendi turunda).
          ...(pollFailed ? { lastError: null, lastErrorAt: null } : {}),
        },
      });
      if (received === 0 && invalid === 0) return;
      const status = invalid > 0 ? 'PARTIAL' : 'SUCCESS';
      const parts = [];
      if (counts.NEW) parts.push(`${counts.NEW} yeni`);
      if (counts.MODIFIED) parts.push(`${counts.MODIFIED} değişiklik`);
      if (counts.CANCELLED) parts.push(`${counts.CANCELLED} iptal`);
      if (invalid) parts.push(`${invalid} okunamadı`);
      const log = await tx.channelSyncLog.create({
        data: {
          hotelId: channel.hotelId,
          channelId: channel.id,
          kind: 'BOOKINGS',
          status,
          trigger,
          summary: `Rezervasyon alındı — ${parts.join(', ')}`,
          details: { counts, duplicates, invalid: invalidDetails.slice(0, 50) },
          durationMs: Date.now() - startedAt,
        },
        select: { id: true },
      });
      await tx.channelState.update({ where: { channelId: channel.id }, data: { lastSyncAt: now, lastSyncStatus: status } });
      if (invalid > 0) {
        await raiseStaffAlert(tx, stage, {
          hotelId: channel.hotelId,
          kind: 'CHANNEL_BOOKING',
          severity: 'CRITICAL',
          title: `${channel.name}: okunamayan kanal rezervasyonu`,
          body: `${invalid} revizyon okunamadı (${invalidDetails[0]?.error ?? '?'}). Channex panelinden bakıp elle açın.`,
          link: `/kanallar/${channel.id}/log`,
          permission: PERMISSIONS.RESERVATIONS_MANAGE,
          entityType: 'Channel',
          entityId: channel.id,
          dedupeKey: `channel-invalid:${channel.id}`,
        });
      }
      await stage('channel.synced', { hotelId: channel.hotelId, channelId: channel.id, logId: log.id, kind: 'BOOKINGS', status });
    });
    return { received, duplicates, invalid };
  } finally {
    polling.delete(channelId);
  }
}

/**
 * Okuma hatası: kanalın hatası yazılır; aynı hata 15 dakikadan sık loga düşmez.
 * @param {object} channel
 * @param {{ error: unknown, trigger: string, startedAt: number, now: Date }} input
 */
async function recordPollFailure(channel, { error, trigger, startedAt, now }) {
  const message = `${POLL_ERROR_PREFIX} ${error?.message ?? error}`.slice(0, 500);
  const { state } = channel;
  const repeated = state.lastError === message && state.lastErrorAt && now.getTime() - state.lastErrorAt.getTime() < POLL_ERROR_LOG_INTERVAL_MS;
  await writeWithEvents(async (tx, stage) => {
    await tx.channelState.update({ where: { channelId: channel.id }, data: { lastBookingPollAt: now, lastError: message, ...(repeated ? {} : { lastErrorAt: now }) } });
    if (repeated) return;
    const log = await tx.channelSyncLog.create({
      data: {
        hotelId: channel.hotelId,
        channelId: channel.id,
        kind: 'BOOKINGS',
        status: 'FAILED',
        trigger,
        summary: message,
        details: { error: { code: error instanceof ChannexError ? error.code : 'INTERNAL', status: error instanceof ChannexError ? error.status : null } },
        error: message,
        durationMs: Date.now() - startedAt,
      },
      select: { id: true },
    });
    await tx.channelState.update({ where: { channelId: channel.id }, data: { lastSyncAt: now, lastSyncStatus: 'FAILED' } });
    if (error instanceof ChannexError && error.auth) {
      await raiseStaffAlert(tx, stage, {
        hotelId: channel.hotelId,
        kind: 'CHANNEL_SYNC',
        severity: 'CRITICAL',
        title: `${channel.name}: rezervasyonlar alınamıyor`,
        body: `${message} — kanal ayarından API anahtarını kontrol edin`,
        link: `/kanallar/${channel.id}`,
        permission: PERMISSIONS.CHANNEL_MANAGER_MANAGE,
        entityType: 'Channel',
        entityId: channel.id,
        dedupeKey: `channel-sync:${channel.id}`,
      });
    }
    await stage('channel.synced', { hotelId: channel.hotelId, channelId: channel.id, logId: log.id, kind: 'BOOKINGS', status: 'FAILED' });
  });
}

/* ══════════════════ İşleme ══════════════════ */

/** Aynı kanal rezervasyonunun revizyonları bu süreçte sırayla işlenir. */
const bookingQueues = new Map();

/**
 * @template T
 * @param {string} bookingId
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
function inBookingQueue(bookingId, work) {
  const previous = bookingQueues.get(bookingId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  bookingQueues.set(bookingId, next);
  return next.finally(() => {
    if (bookingQueues.get(bookingId) === next) bookingQueues.delete(bookingId);
  });
}

/**
 * Revizyon personele düştü (kanal aktörü kapalı ya da iş yapılamadı): kanal kaydı
 * "elle işlenmeli" olur. Aktör kaydı zaten "elle işlenmeli" yaptıysa (işlenmiş
 * revizyon) dokunulmaz.
 *
 * @param {string} hotelId
 * @param {string} revisionId
 * @param {string} reason
 */
export async function markRevisionForStaff(hotelId, revisionId, reason) {
  await writeWithEvents(async (tx, stage) => {
    const revision = await tx.channelBookingRevision.findFirst({ where: { id: revisionId, hotelId }, select: { id: true, processedAt: true, bookingId: true, channelId: true } });
    if (!revision || revision.processedAt) return;
    const text = `Kanal aktörü işleyemedi (${reason}); rezervasyonu elle açın / değiştirin`.slice(0, MAX_STATE_REASON_LENGTH);
    await tx.channelBookingRevision.update({ where: { id: revision.id }, data: { processedAt: new Date(), outcome: 'ATTENTION', error: text } });
    await tx.channelBooking.update({
      where: { id: revision.bookingId },
      data: { state: 'ATTENTION', stateReason: text, resolvedAt: null, resolvedBy: null, resolutionNote: null },
    });
    await recordAudit(tx, { hotelId, entity: 'ChannelBooking', entityId: revision.bookingId, action: 'UPDATE', after: { state: 'ATTENTION', stateReason: text } });
    await stage('channel.booking.changed', { hotelId, channelId: revision.channelId, bookingId: revision.bookingId, state: 'ATTENTION' });
  });
}

/** Elle işlenmesi gereken rezervasyon: aktör görevi açar (yeniden denemez). */
export class ChannelBookingAttentionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChannelBookingAttentionError';
    this.retryable = false;
  }
}

/**
 * Kanal aktörünün işi: saklanmış revizyonu rezervasyonlara uygular.
 *
 * @param {string} hotelId
 * @param {string} revisionId
 * @returns {Promise<{ message: string, meta?: object }>}
 */
export async function processBookingRevision(hotelId, revisionId) {
  const head = await prisma.channelBookingRevision.findFirst({ where: { id: revisionId, hotelId }, select: { bookingId: true } });
  if (!head) throw Object.assign(new NotFoundError('Kanal revizyonu bulunamadı'), { retryable: false });
  return inBookingQueue(head.bookingId, () => applyRevision(hotelId, revisionId));
}

/**
 * @param {string} hotelId
 * @param {string} revisionId
 */
async function applyRevision(hotelId, revisionId) {
  const revision = await prisma.channelBookingRevision.findFirst({
    where: { id: revisionId, hotelId },
    select: {
      id: true,
      kind: true,
      occurredAt: true,
      payload: true,
      processedAt: true,
      booking: { select: { id: true, appliedRevisionAt: true, state: true, stateReason: true } },
      channel: { select: { id: true, hotelId: true, name: true, type: true } },
    },
  });
  if (!revision) throw Object.assign(new NotFoundError('Kanal revizyonu bulunamadı'), { retryable: false });
  if (revision.processedAt) return { message: 'Revizyon daha önce işlenmiş' };

  const { booking, channel } = revision;
  /** @type {import('@hotelos/channel-sync-worker').NormalizedBooking} */
  const payload = /** @type {any} */ (revision.payload);
  const label = bookingLabel(payload, channel);

  if (booking.appliedRevisionAt && revision.occurredAt < booking.appliedRevisionAt) {
    await prisma.channelBookingRevision.update({ where: { id: revision.id }, data: { processedAt: new Date(), outcome: 'SUPERSEDED' } });
    return { message: `${label}: daha yeni bir revizyon zaten uygulanmış; bu revizyon atlandı` };
  }

  // Rezervasyon işlemleri kanalın adıyla yapılır (denetim izi, iptal eden): kanal kendi iptalini tanır.
  const outer = getContext();
  return runWithContext(
    { correlationId: outer?.correlationId, causationId: outer?.causationId, actor: `${CHANNEL_ACTOR_PREFIX}${channel.name}` },
    () => applyChanges(hotelId, { revision, booking, channel, payload, label }),
  );
}

/**
 * @param {string} hotelId
 * @param {object} loaded
 */
async function applyChanges(hotelId, { revision, booking, channel, payload, label }) {
  const hotel = await getHotelSettings(hotelId);
  const mappings = await prisma.channelRoomMapping.findMany({
    where: { channelId: channel.id },
    select: { id: true, roomTypeId: true, externalRoomTypeId: true, rates: { select: { externalRatePlanId: true, boardType: true } } },
  });
  const reservations = await prisma.reservation.findMany({
    where: { hotelId, channelBookingId: booking.id },
    select: RESERVATION_FIELDS,
    orderBy: [{ channelRoomIndex: 'asc' }, { createdAt: 'desc' }],
  });

  const outcome = { attention: [], review: [], overbooked: [], codes: [] };
  const context = { hotelId, hotel, channel, booking, revision, payload, label, mappings, reservations, outcome };

  if (payload.status === 'CANCELLED') {
    await cancelAll(context, reservations, `Kanal iptali: ${label}`);
  } else {
    for (const [index, room] of payload.rooms.entries()) await applyRoom(context, index, room);
    // Kanalda azalan odalar: fazla rezervasyonlar iptal.
    const extras = reservations.filter((row) => row.channelRoomIndex >= payload.rooms.length && row.status !== 'CANCELLED');
    await cancelAll(context, extras, `Kanal değişikliği: oda çıkarıldı (${label})`);
  }

  const state = outcome.attention.length ? 'ATTENTION' : outcome.review.length ? 'REVIEW' : 'PROCESSED';
  const reason = [...outcome.attention, ...outcome.review].join(' · ').slice(0, MAX_STATE_REASON_LENGTH) || null;
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.channelBooking.findFirst({ where: { id: booking.id }, select: { state: true, status: true, stateReason: true } });
    await tx.channelBooking.update({
      where: { id: booking.id },
      data: {
        status: payload.status,
        state,
        stateReason: reason,
        externalCode: payload.externalCode,
        otaName: payload.otaName,
        guestName: guestLabel(payload.guest),
        ...(payload.checkIn && payload.checkOut && payload.checkOut > payload.checkIn
          ? { checkIn: dateValue(payload.checkIn), checkOut: dateValue(payload.checkOut) }
          : {}),
        roomCount: Math.max(payload.rooms.length, 1),
        amount: payload.amount,
        currency: payload.currency,
        appliedRevisionAt: revision.occurredAt,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
    });
    await tx.channelBookingRevision.update({
      where: { id: revision.id },
      data: { processedAt: new Date(), outcome: state, error: outcome.attention.join(' · ').slice(0, MAX_STATE_REASON_LENGTH) || null },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'ChannelBooking',
      entityId: booking.id,
      action: 'UPDATE',
      before,
      after: { state, status: payload.status, stateReason: reason, revision: revision.kind, reservations: outcome.codes },
    });
    for (const reservation of outcome.overbooked) {
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'CHANNEL_BOOKING',
        severity: 'CRITICAL',
        title: `Kanal rezervasyonu kapasiteyi aştı: ${reservation.confirmationCode}`,
        body: `${label} — kanalda satılmış olduğu için yer olmasa da açıldı. Misafire oda bulun ya da kanalla görüşün.`,
        link: `/rezervasyonlar/${reservation.id}`,
        permission: PERMISSIONS.RESERVATIONS_MANAGE,
        entityType: 'Reservation',
        entityId: reservation.id,
        dedupeKey: `channel-overbooking:${reservation.id}`,
      });
    }
    await stage('channel.booking.changed', { hotelId, channelId: channel.id, bookingId: booking.id, state });
  });

  const done = outcome.codes.length ? outcome.codes.join(', ') : 'rezervasyon değişmedi';
  if (state === 'ATTENTION') {
    throw new ChannelBookingAttentionError(`${label}: ${outcome.attention.join('; ')}${outcome.codes.length ? ` (işlenen: ${done})` : ''}`);
  }
  return {
    message: `${label}: ${done}${state === 'REVIEW' ? ' — doğrulanmalı' : ''}${outcome.overbooked.length ? ' — kapasite aşıldı' : ''}`,
    meta: { state, reservations: outcome.codes, overbooked: outcome.overbooked.length },
  };
}

const RESERVATION_FIELDS = Object.freeze({
  id: true,
  status: true,
  confirmationCode: true,
  channelRoomIndex: true,
  checkIn: true,
  checkOut: true,
  roomTypeId: true,
  boardType: true,
  adults: true,
  children: true,
  totalPrice: true,
  priceMode: true,
  cancelledBy: true,
  createdAt: true,
});

/**
 * "Booking.com 1234567890 · Jane Doe · 01.06.2027 – 03.06.2027"
 * @param {import('@hotelos/channel-sync-worker').NormalizedBooking} payload
 * @param {{ name: string }} channel
 */
function bookingLabel(payload, channel) {
  const source = [payload.otaName ?? channel.name, payload.externalCode].filter(Boolean).join(' ');
  const guest = guestLabel(payload.guest) ?? 'misafir';
  return `${source} · ${guest} · ${dotted(payload.checkIn)} – ${dotted(payload.checkOut)}`;
}

/**
 * Kanal odası → bizim oda tipi ve pansiyon: önce fiyat planı (pansiyonu belirler),
 * yoksa kanal oda tipi (otelin varsayılan pansiyonu), iCal'de eşleşme kaydı.
 *
 * @param {object} context
 * @param {import('@hotelos/channel-sync-worker').NormalizedRoom} room
 * @returns {{ roomTypeId: string, boardType: string } | { error: string }}
 */
function resolveLine({ mappings, hotel }, room) {
  if (room.roomMappingId) {
    const mapping = mappings.find((row) => row.id === room.roomMappingId);
    return mapping ? { roomTypeId: mapping.roomTypeId, boardType: hotel.defaultBoardType } : { error: 'Takvimin oda tipi eşleşmesi kaldırılmış' };
  }
  if (room.externalRatePlanId) {
    for (const mapping of mappings) {
      const rate = mapping.rates.find((row) => row.externalRatePlanId === room.externalRatePlanId);
      if (rate) return { roomTypeId: mapping.roomTypeId, boardType: rate.boardType };
    }
  }
  if (room.externalRoomTypeId) {
    const mapping = mappings.find((row) => row.externalRoomTypeId === room.externalRoomTypeId);
    if (mapping) return { roomTypeId: mapping.roomTypeId, boardType: hotel.defaultBoardType };
  }
  return {
    error: `kanal oda tipi / fiyat planı eşleşmemiş (${room.externalRoomTypeId ?? '?'} / ${room.externalRatePlanId ?? '?'}); eşleştirmeyi tamamlayıp rezervasyonu elle açın`,
  };
}

/**
 * Oda tutarı: OTA'nın tutarı (elle fiyat, gerekçesi kanal) — tutar yoksa, sıfırsa
 * ya da otelin para biriminde değilse sistem fiyatı ve "doğrulanmalı".
 *
 * @param {object} context
 * @param {import('@hotelos/channel-sync-worker').NormalizedRoom} room
 * @returns {{ manual: { total: string, note: string } | null, review: string | null }}
 */
function priceFor({ payload, hotel, channel }, room) {
  if (!payload.priceKnown) {
    return { manual: null, review: 'iCal fiyat ve kişi sayısı taşımaz: tutarı ve kişi sayısını kanaldaki rezervasyonla güncelleyin' };
  }
  if (!room.amount || Number(room.amount) <= 0) return { manual: null, review: 'Kanal oda tutarı göndermedi; sistem fiyatı kullanıldı' };
  const currency = payload.currency ?? hotel.currency;
  if (currency !== hotel.currency) {
    return { manual: null, review: `Kanal tutarı ${room.amount} ${currency}; otelin para birimi ${hotel.currency} — sistem fiyatı kullanıldı, tutarı kontrol edin` };
  }
  const note = `${payload.otaName ?? channel.name} tutarı${payload.externalCode ? ` (${payload.externalCode})` : ''}`.slice(0, MAX_PRICE_NOTE_LENGTH);
  return { manual: { total: room.amount, note }, review: null };
}

/**
 * Rezervasyon notu: kanal, kod, ödeme kimde, misafirin notu.
 * @param {object} context
 */
function reservationNote({ payload, channel }) {
  const lines = [`Kanal: ${channel.name}${payload.otaName && payload.otaName !== channel.name ? ` / ${payload.otaName}` : ''}${payload.externalCode ? ` · ${payload.externalCode}` : ''}`];
  if (payload.paymentCollect === 'OTA') lines.push('Ödemeyi kanal aldı (misafirden tahsil edilmez; kanaldan alacak)');
  if (payload.paymentCollect === 'PROPERTY') lines.push('Ödeme otelde alınacak');
  if (payload.notes) lines.push(`Misafir notu: ${payload.notes}`);
  return lines.join('\n').slice(0, MAX_RESERVATION_NOTES_LENGTH);
}

/**
 * Bir oda: yoksa açılır, varsa (bekleyen / onaylı) güncellenir, misafir içerideyse
 * ya da çıkmışsa değişiklik elle işlenir.
 *
 * @param {object} context
 * @param {number} index
 * @param {import('@hotelos/channel-sync-worker').NormalizedRoom} room
 */
async function applyRoom(context, index, room) {
  const { hotelId, channel, booking, revision, payload, reservations, outcome } = context;
  const prefix = payload.rooms.length > 1 ? `${index + 1}. oda` : 'Oda';
  const line = resolveLine(context, room);
  if ('error' in line) {
    outcome.attention.push(`${prefix}: ${line.error}`);
    return;
  }
  const price = priceFor(context, room);
  if (price.review) outcome.review.push(payload.rooms.length > 1 ? `${prefix}: ${price.review}` : price.review);

  const latest = reservations.find((row) => row.channelRoomIndex === index) ?? null;
  const stay = { checkIn: dateValue(room.checkIn), checkOut: dateValue(room.checkOut) };
  try {
    // Hiç açılmamış ya da kanal otomasyonunun iptal ettiği oda: yeniden açılır.
    if (!latest || (latest.status === 'CANCELLED' && latest.cancelledBy?.startsWith(CHANNEL_ACTOR_PREFIX))) {
      const result = await createReservation(
        hotelId,
        {
          guestId: null,
          guest: {
            firstName: payload.guest.firstName ?? 'Kanal',
            lastName: payload.guest.lastName ?? 'misafiri',
            phone: payload.guest.phone,
            email: payload.guest.email,
            nationality: payload.guest.country,
          },
          forceNewGuest: true,
          roomTypeId: line.roomTypeId,
          adults: room.adults,
          children: room.children,
          boardType: line.boardType,
          ...stay,
          status: 'CONFIRMED',
          source: 'OTA',
          notes: reservationNote(context),
          requestId: `chb:${booking.id}:${index}:${revision.id.slice(0, 8)}`,
          waitlistId: null,
          roomId: null,
          manualTotal: price.manual?.total ?? null,
          priceNote: price.manual?.note ?? null,
          couponCode: null,
          channelBookingId: booking.id,
          channelRoomIndex: index,
        },
        { allowOverbooking: true, approvalAllowed: false, canOverridePrice: true, createdBy: `${CHANNEL_ACTOR_PREFIX}${channel.name}` },
      );
      outcome.codes.push(result.reservation.confirmationCode);
      if (result.overbooked) outcome.overbooked.push(result.reservation);
      return;
    }
    if (latest.status === 'CANCELLED') {
      outcome.attention.push(`${prefix} (${latest.confirmationCode}): bizde iptal edilmiş ama kanalda geçerli; rezervasyonu elle yeniden açın ya da kanalda iptal edin`);
      return;
    }
    if (!differs(latest, line, room, price)) return;
    if (!CANCELLABLE_STATUSES.includes(latest.status)) {
      const why = latest.status === 'CHECKED_IN' ? 'misafir içeride' : 'konaklama kapanmış';
      outcome.attention.push(`${prefix} (${latest.confirmationCode}): ${why}; kanaldaki değişiklik elle uygulanmalı`);
      return;
    }
    const result = await applyReservationUpdate(
      hotelId,
      latest.id,
      {
        ...stay,
        roomTypeId: line.roomTypeId,
        boardType: line.boardType,
        adults: room.adults,
        children: room.children,
        ...(price.manual ? { price: { mode: 'MANUAL', total: price.manual.total, note: price.manual.note } } : {}),
      },
      { canOverridePrice: true, allowOverbooking: true },
    );
    if (result.changed) outcome.codes.push(latest.confirmationCode);
    if (result.overbooked) outcome.overbooked.push(result.reservation);
  } catch (error) {
    // İş kuralı (kapasite, geçmiş tarih, elle fiyat kararı): elle işlenir. Geçici hata yeniden denenir.
    if (error instanceof AppError && error.statusCode < 500) {
      outcome.attention.push(`${prefix}${latest ? ` (${latest.confirmationCode})` : ''}: ${error.message}`);
      return;
    }
    throw error;
  }
}

/**
 * Kanaldaki hâl bizdekinden farklı mı (tarih, tip, pansiyon, kişi, tutar)?
 * @param {object} current
 * @param {{ roomTypeId: string, boardType: string }} line
 * @param {import('@hotelos/channel-sync-worker').NormalizedRoom} room
 * @param {{ manual: { total: string } | null }} price
 */
function differs(current, line, room, price) {
  if (dayText(current.checkIn) !== room.checkIn || dayText(current.checkOut) !== room.checkOut) return true;
  if (current.roomTypeId !== line.roomTypeId || current.boardType !== line.boardType) return true;
  if (current.adults !== room.adults || current.children !== room.children) return true;
  if (price.manual && (current.priceMode !== 'MANUAL' || Number(money(current.totalPrice)) !== Number(price.manual.total))) return true;
  return false;
}

/**
 * Rezervasyonları iptal eder (ceza uygulanmaz: kanalın kendi kuralı). İçerideki /
 * çıkmış misafirin konaklaması elle değerlendirilir.
 *
 * @param {object} context
 * @param {Array<{ id: string, status: string, confirmationCode: string }>} rows
 * @param {string} reason
 */
async function cancelAll(context, rows, reason) {
  const { hotelId, outcome } = context;
  // Oda başına en son kayıt: önceki iptaller tekrar ele alınmaz.
  const latestByRoom = new Map();
  for (const row of rows) if (!latestByRoom.has(row.channelRoomIndex)) latestByRoom.set(row.channelRoomIndex, row);
  for (const row of latestByRoom.values()) {
    if (row.status === 'CANCELLED' || row.status === 'NO_SHOW') continue;
    if (!CANCELLABLE_STATUSES.includes(row.status)) {
      outcome.attention.push(`${row.confirmationCode}: kanalda iptal edildi ama misafir ${row.status === 'CHECKED_IN' ? 'içeride' : 'çıkış yapmış'}; elle değerlendirin`);
      continue;
    }
    try {
      await cancelReservation(hotelId, row.id, { reason: reason.slice(0, 300), waiveFee: true });
      outcome.codes.push(row.confirmationCode);
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        outcome.attention.push(`${row.confirmationCode}: iptal edilemedi (${error.message})`);
        continue;
      }
      throw error;
    }
  }
}
