import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { buildIcal, classifyIcalEvent, closedRanges, normalizeIcalEvent, parseIcal } from '@hotelos/channel-sync-worker';
import { PERMISSIONS, icalUrlIssue } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { NotFoundError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getHotelSettings } from '../settings/service.js';
import { channelToday, closedDays, computeRoomTypeValues, horizonWindow } from './ari.js';
import { storeRevision } from './bookings.js';

/**
 * iCal kanalı (modül 33): Airbnb / Booking.com takvim senkronu.
 *
 * - **İçe aktarma:** kanalın takvimi düzenli okunur; yeni kayıt rezervasyon
 *   açar, tarihi değişen güncellenir, takvimden kalkan ve henüz gelinmemiş
 *   olan iptal edilir (karar: kullanıcı). Değişiklikler Channex'teki gibi
 *   revizyon olarak saklanır ve kanal aktörü işler.
 * - **Dışa aktarma:** kanal bizim takvimimizi okur: satılamayan (boş odası
 *   olmayan ya da stop-sale'deki) günler "dolu" görünür. Adres gizli bir
 *   belirteç taşır; kanal yaklaşık 1–3 saatte bir okur.
 *
 * Takvim adresi personelin girdiği bir adrestir: sunucunun iç ağına istek
 * attırılamaz (yalnızca https, özel ağa çözülen ad ve yönlendirme reddedilir),
 * boyutu ve süresi sınırlıdır.
 */

/** Aynı kanalın takvimleri en sık bu aralıkla okunur. */
export const ICAL_IMPORT_INTERVAL_MS = 15 * 60_000;
const ICAL_TIMEOUT_MS = 15_000;
const ICAL_MAX_BYTES = 2 * 1024 * 1024;
const ICAL_MAX_REDIRECTS = 3;
/**
 * Takvim birden boş gelirse (kanal geçici olarak boş döndü, adres değişti) bu
 * kadar ya da daha fazla gelecek rezervasyon toplu iptal edilmez; uyarı düşer.
 */
const ICAL_EMPTY_FEED_GUARD = 2;
/** Dışa aktarılan takvim bu süre önbellekte tutulur (kanal okumaları yoğun gelebilir). */
const EXPORT_CACHE_MS = 60_000;
/** Kanalın son okuma zamanı en sık bu aralıkla yazılır. */
const EXPORT_TOUCH_INTERVAL_MS = 5 * 60_000;

export class IcalFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IcalFetchError';
  }
}

/**
 * Özel / yerel ağ adresi mi (IPv4, IPv6, IPv4'e eşlenmiş IPv6)?
 * @param {string} address
 */
export function isPrivateAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const value = mapped ? mapped[1] : address;
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const lower = value.toLowerCase();
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') ||
    lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

/**
 * @param {Response} response
 * @param {number} limit
 */
async function readLimited(response, limit) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new IcalFetchError(`Takvim ${Math.round(limit / 1024 / 1024)} MB'tan büyük`);
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new IcalFetchError(`Takvim ${Math.round(limit / 1024 / 1024)} MB'tan büyük`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/**
 * Takvimi güvenli okur: her adımda (yönlendirme dahil) adres denetlenir ve
 * adın özel ağa çözülmediği doğrulanır.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, resolve?: (host: string) => Promise<Array<{ address: string }>> }} [options]
 * @returns {Promise<string>}
 */
export async function fetchCalendar(url, { fetchImpl, resolve = (host) => lookup(host, { all: true }) } = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  let current = url;
  for (let hop = 0; hop <= ICAL_MAX_REDIRECTS; hop += 1) {
    const issue = icalUrlIssue(current);
    if (issue) throw new IcalFetchError(issue);
    const { hostname } = new URL(current);
    let addresses;
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new IcalFetchError(`Takvim adresi çözülemedi (${hostname})`);
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new IcalFetchError('Takvim adresi özel ağa çıkıyor; herkese açık bir adres olmalı');
    }
    let response;
    try {
      response = await doFetch(current, {
        redirect: 'manual',
        headers: { accept: 'text/calendar, text/plain;q=0.9' },
        signal: AbortSignal.timeout(ICAL_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new IcalFetchError(timedOut ? `Takvim ${ICAL_TIMEOUT_MS / 1000} saniyede gelmedi` : `Takvime bağlanılamadı: ${error?.message ?? error}`);
    }
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new IcalFetchError(`Takvim okunamadı (HTTP ${response.status})`);
    return readLimited(response, ICAL_MAX_BYTES);
  }
  throw new IcalFetchError('Takvim adresi çok fazla yönlendirme yaptı');
}

/* ══════════════════ İçe aktarma ══════════════════ */

/**
 * Bir iCal kanalının bütün takvimlerini okur; farkları revizyon olarak saklar.
 *
 * @param {string} channelId
 * @param {{ trigger?: 'SCHEDULE' | 'MANUAL', now?: Date, fetchImpl?: typeof fetch, resolve?: Function }} [options]
 * @returns {Promise<{ skipped?: boolean, changes: number, errors: number }>}
 */
export async function importIcalChannel(channelId, { trigger = 'SCHEDULE', now = new Date(), fetchImpl, resolve } = {}) {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, type: 'ICAL', status: 'ACTIVE' },
    select: { id: true, hotelId: true, name: true, provider: true },
  });
  if (!channel) return { skipped: true, changes: 0, errors: 0 };
  const hotel = await getHotelSettings(channel.hotelId);
  const today = channelToday(hotel);
  const startedAt = Date.now();
  const mappings = await prisma.channelRoomMapping.findMany({
    where: { channelId, icalImportUrl: { not: null } },
    select: { id: true, icalImportUrl: true, roomType: { select: { name: true } } },
  });

  const report = [];
  const warnings = [];
  let changes = 0;
  let errors = 0;
  for (const mapping of mappings) {
    const row = { roomType: mapping.roomType.name, new: 0, modified: 0, cancelled: 0, closed: 0, invalid: 0, error: null };
    try {
      const text = await fetchCalendar(mapping.icalImportUrl, { fetchImpl, resolve });
      const { events, invalid } = parseIcal(text);
      row.invalid = invalid;
      const current = events.filter((event) => event.end > today);
      const reservations = current.filter((event) => classifyIcalEvent(event, channel.provider) === 'RESERVATION');
      row.closed = current.filter((event) => classifyIcalEvent(event, channel.provider) === 'CLOSED').length;

      const prefix = `${mapping.id}:`;
      // Bitmemiş kayıtlar (iptal edilmişler de: takvimde yeniden görünebilir) ve en son revizyonları.
      const existing = await prisma.channelBooking.findMany({
        where: { channelId, externalBookingId: { startsWith: prefix }, OR: [{ checkOut: null }, { checkOut: { gt: new Date(`${today}T00:00:00.000Z`) } }] },
        select: {
          externalBookingId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          revisions: { select: { externalRevisionId: true }, orderBy: [{ occurredAt: 'desc' }, { receivedAt: 'desc' }], take: 1 },
        },
      });
      const known = new Map(existing.map((booking) => [booking.externalBookingId.slice(prefix.length), booking]));
      const seen = new Set();
      for (const event of reservations) {
        seen.add(event.uid);
        const booking = known.get(event.uid);
        const moved = booking && (booking.checkIn?.toISOString().slice(0, 10) !== event.start || booking.checkOut?.toISOString().slice(0, 10) !== event.end);
        // Yeni; iptal edilmişken yeniden görünen (yeniden açılır); tarihi değişen.
        const kind = !booking || booking.status === 'CANCELLED' ? 'NEW' : moved ? 'MODIFIED' : null;
        if (!kind) continue;
        const previousRevisionId = booking?.revisions[0]?.externalRevisionId ?? null;
        if (await storeRevision(channel, normalizeIcalEvent({ mappingId: mapping.id, provider: channel.provider, event, kind, previousRevisionId, now }))) {
          row[kind === 'NEW' ? 'new' : 'modified'] += 1;
        }
      }
      // Takvimden kalkan, henüz gelinmemiş rezervasyonlar iptal (geçmiş kayıtlar takvimden zaten düşer).
      const gone = [...known.entries()].filter(
        ([uid, booking]) => booking.status === 'ACTIVE' && !seen.has(uid) && booking.checkIn && booking.checkIn.toISOString().slice(0, 10) >= today,
      );
      if (reservations.length === 0 && gone.length >= ICAL_EMPTY_FEED_GUARD) {
        warnings.push(`${mapping.roomType.name}: takvim boş geldi; ${gone.length} gelecek rezervasyon iptal edilmedi (adres değişmiş olabilir)`);
      } else {
        for (const [uid, booking] of gone) {
          const event = { uid, start: booking.checkIn.toISOString().slice(0, 10), end: booking.checkOut.toISOString().slice(0, 10) };
          const previousRevisionId = booking.revisions[0]?.externalRevisionId ?? null;
          if (await storeRevision(channel, normalizeIcalEvent({ mappingId: mapping.id, provider: channel.provider, event, kind: 'CANCELLED', previousRevisionId, now }))) {
            row.cancelled += 1;
          }
        }
      }
      await prisma.channelRoomMapping.update({ where: { id: mapping.id }, data: { lastImportAt: now, lastImportError: null } });
    } catch (error) {
      errors += 1;
      row.error = String(error?.message ?? error).slice(0, 300);
      await prisma.channelRoomMapping.update({ where: { id: mapping.id }, data: { lastImportError: row.error } });
    }
    changes += row.new + row.modified + row.cancelled;
    report.push(row);
  }

  await writeWithEvents(async (tx, stage) => {
    await tx.channelState.update({ where: { channelId }, data: { lastIcalImportAt: now } });
    if (changes === 0 && errors === 0 && warnings.length === 0) return;
    const status = errors === mappings.length && mappings.length > 0 ? 'FAILED' : errors || warnings.length ? 'PARTIAL' : 'SUCCESS';
    const parts = [];
    const total = (key) => report.reduce((sum, row) => sum + row[key], 0);
    if (total('new')) parts.push(`${total('new')} yeni`);
    if (total('modified')) parts.push(`${total('modified')} değişiklik`);
    if (total('cancelled')) parts.push(`${total('cancelled')} iptal`);
    if (errors) parts.push(`${errors} takvim okunamadı`);
    if (warnings.length) parts.push('toplu iptal durduruldu');
    const log = await tx.channelSyncLog.create({
      data: {
        hotelId: channel.hotelId,
        channelId,
        kind: 'ICAL_IMPORT',
        status,
        trigger,
        summary: `Takvim okundu — ${parts.join(', ') || 'değişiklik yok'}`,
        details: { calendars: report, warnings },
        error: report.find((row) => row.error)?.error ?? null,
        durationMs: Date.now() - startedAt,
      },
      select: { id: true },
    });
    await tx.channelState.update({
      where: { channelId },
      data: {
        lastSyncAt: now,
        lastSyncStatus: status,
        ...(errors ? { lastError: report.find((row) => row.error)?.error ?? null, lastErrorAt: now } : { lastError: null, lastErrorAt: null }),
      },
    });
    if (warnings.length) {
      await raiseStaffAlert(tx, stage, {
        hotelId: channel.hotelId,
        kind: 'CHANNEL_SYNC',
        severity: 'WARNING',
        title: `${channel.name}: takvim boş geldi`,
        body: warnings.join(' · ').slice(0, 500),
        link: `/kanallar/${channelId}/log`,
        permission: PERMISSIONS.CHANNEL_MANAGER_MANAGE,
        entityType: 'Channel',
        entityId: channelId,
        dedupeKey: `channel-ical-empty:${channelId}`,
      });
    }
    await stage('channel.synced', { hotelId: channel.hotelId, channelId, logId: log.id, kind: 'ICAL_IMPORT', status });
  });
  return { changes, errors };
}

/**
 * Okuma zamanı gelmiş iCal kanalları (zamanlanmış iş).
 * @param {{ now?: Date, logger?: { warn: Function } }} [options]
 */
export async function importDueIcalChannels({ now = new Date(), logger } = {}) {
  const due = await prisma.channelState.findMany({
    where: {
      channel: { type: 'ICAL', status: 'ACTIVE', deletedAt: null },
      OR: [{ lastIcalImportAt: null }, { lastIcalImportAt: { lte: new Date(now.getTime() - ICAL_IMPORT_INTERVAL_MS) } }],
    },
    select: { channelId: true },
    orderBy: [{ lastIcalImportAt: { sort: 'asc', nulls: 'first' } }],
  });
  for (const state of due) {
    try {
      await importIcalChannel(state.channelId, { now });
    } catch (error) {
      logger?.warn?.({ err: error, channelId: state.channelId }, 'iCal takvimi okunamadı');
    }
  }
  return due.length;
}

/* ══════════════════ Dışa aktarma ══════════════════ */

/** @type {Map<string, { text: string, expiresAt: number }>} */
const exportCache = new Map();

/** Kanal ayarı / eşleştirmesi değişince belirtecin önbelleği atılır. */
export function forgetIcalExports() {
  exportCache.clear();
}

/**
 * Kanalın okuyacağı takvim: satılamayan günler.
 *
 * @param {string} token
 * @param {{ now?: Date }} [options]
 * @returns {Promise<string>}
 */
export async function exportIcalCalendar(token, { now = new Date() } = {}) {
  const cached = exportCache.get(token);
  if (cached && cached.expiresAt > now.getTime()) return cached.text;

  const mapping = await prisma.channelRoomMapping.findFirst({
    where: { exportToken: token, channel: { type: 'ICAL', status: 'ACTIVE', deletedAt: null } },
    select: {
      id: true,
      hotelId: true,
      roomTypeId: true,
      lastExportAt: true,
      roomType: { select: { name: true } },
      channel: { select: { id: true, name: true, horizonDays: true, priceMarkupPercent: true } },
    },
  });
  // Belirteç yanlış, kanal silinmiş ya da senkronda değil: takvim yok (ne olduğu söylenmez).
  if (!mapping) throw new NotFoundError('Takvim bulunamadı');

  const hotel = await getHotelSettings(mapping.hotelId);
  const window = horizonWindow(channelToday(hotel), mapping.channel.horizonDays);
  const values = await computeRoomTypeValues({ hotelId: mapping.hotelId, channel: mapping.channel, rooms: [{ id: mapping.id, roomTypeId: mapping.roomTypeId, externalRoomTypeId: null, rates: [] }], window });
  const text = buildIcal({
    calendarName: `${hotel.name} — ${mapping.roomType.name}`,
    key: mapping.id.slice(0, 8),
    ranges: closedRanges(closedDays(values, mapping.roomTypeId)),
    summary: 'Dolu',
    now,
  });
  exportCache.set(token, { text, expiresAt: now.getTime() + EXPORT_CACHE_MS });
  if (!mapping.lastExportAt || now.getTime() - mapping.lastExportAt.getTime() > EXPORT_TOUCH_INTERVAL_MS) {
    await prisma.channelRoomMapping.update({ where: { id: mapping.id }, data: { lastExportAt: now } });
  }
  return text;
}
