import { BaseWorker } from '@hotelos/actor-kit';
import { CHANNEL_SYNC_WORKER_NAME, channelSyncWorkerManifest } from './manifest.js';

/** Envanter / fiyat olayında kanalın yeniden hesaplanacak penceresi. */
const BOOKING_EVENT = 'channel.booking.received';
const ACTOR_SETTING_EVENT = 'actor.setting.changed';

/** Konaklama gövdesi taşıyan olaylar: etkilenen geceler giriş (dahil) – çıkış (hariç). */
const STAY_EVENTS = new Set([
  'reservation.created',
  'reservation.cancelled',
  'reservation.no_show',
  'reservation.reinstated',
  'guest.checked_in',
  'guest.check_in_reverted',
  'guest.check_out_reverted',
]);

/** "2027-06-01T00:00:00.000Z" → "2027-06-01" */
const dayOf = (value) => (value ? String(value).slice(0, 10) : null);

/** "2027-06-01" + 1 gün */
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Olayın etkilediği gün penceresi (`to` hariç; `null` = kanalın ufkunun sonu).
 * Pencere bilinmiyorsa (`null`) kanalın bütün ufku yeniden hesaplanır — fark
 * gönderildiği için yalnızca gerçekten değişen günler kanala gider.
 *
 * - Rezervasyon açıldı / iptal / gelmedi / geri alındı, giriş ve geri almalar: konaklamanın geceleri.
 * - Çıkış: çıkış gününden sonrası (erken çıkışta bırakılan geceler).
 * - Arıza bloğu: bloğun günleri.
 * - Oda atama / kaldırma: rezervasyonun geceleri (gövdede tarih yok; servis rezervasyondan okur).
 * - Düzenleme, oda envanteri: eski hâl gövdede yok → bütün ufuk.
 * - Fiyat: gövdedeki aralık (iki uç dahil) ya da bütün ufuk.
 *
 * @param {string} eventName
 * @param {Record<string, any>} payload
 * @returns {{ from: string, to: string | null } | { reservationId: string } | null}
 */
export function affectedWindow(eventName, payload) {
  if ((eventName === 'room.assigned' || eventName === 'room.unassigned') && payload.reservationId) {
    return { reservationId: payload.reservationId };
  }
  if (STAY_EVENTS.has(eventName)) {
    const from = dayOf(payload.checkIn);
    const to = dayOf(payload.checkOut);
    return from && to && to > from ? { from, to } : null;
  }
  if (eventName === 'guest.checked_out') {
    const from = dayOf(payload.checkOut);
    return from ? { from, to: null } : null;
  }
  if (eventName === 'room.blocked') {
    const from = dayOf(payload.startDate);
    return from ? { from, to: dayOf(payload.endDate) } : null;
  }
  if (eventName === 'rate.changed') {
    if (!payload.from) return null;
    return { from: payload.from, to: payload.to ? nextDay(payload.to) : null };
  }
  return null;
}

/**
 * Kanal aktörü. Servisi dışarıdan alır (veritabanı bilmez; sahte servisle test edilir).
 */
class ChannelSyncWorker extends BaseWorker {
  #service;

  /**
   * @param {{
   *   isSyncTarget: (hotelId: string) => boolean,
   *   markDirty: (hotelId: string, window: { from: string, to: string | null } | { reservationId: string } | null, reason: string) => Promise<{ channels: number, window?: { from: string, to: string | null } | null }>,
   *   requestFullSync: (hotelId: string, reason: string) => Promise<{ channels: number }>,
   *   processBookingRevision: (hotelId: string, revisionId: string) => Promise<{ message: string, meta?: object }>,
   *   markRevisionForStaff: (hotelId: string, revisionId: string, reason: string) => Promise<void>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    const markDirty = async (payload, envelope) => {
      const hint = affectedWindow(envelope.name, payload);
      const marked = await service.markDirty(payload.hotelId, hint, envelope.name);
      const { channels } = marked;
      if (channels === 0) return { message: 'Senkronda kanal yok; gönderilecek bir şey yok' };
      const window = marked.window !== undefined ? marked.window : hint;
      const range = window?.from ? `${window.from}${window.to ? ` – ${window.to}` : ' ve sonrası'}` : 'bütün dönem';
      return { message: `${channels} kanal güncellenecek (${range})`, meta: { channels, window } };
    };

    const handlers = Object.fromEntries(
      channelSyncWorkerManifest.subscribes
        .filter((name) => name !== BOOKING_EVENT && name !== ACTOR_SETTING_EVENT)
        .map((name) => [name, markDirty]),
    );

    handlers[ACTOR_SETTING_EVENT] = async (payload) => {
      const { channels } = await service.requestFullSync(payload.hotelId, 'Kanal aktörü yeniden açıldı');
      return { message: channels ? `Aktör açıldı: ${channels} kanal için tam eşitleme istendi` : 'Aktör açıldı; senkronda kanal yok' };
    };

    handlers[BOOKING_EVENT] = async (payload) => {
      const result = await service.processBookingRevision(payload.hotelId, payload.revisionId);
      return { message: result.message, meta: { bookingId: payload.bookingId, revisionId: payload.revisionId, ...(result.meta ?? {}) } };
    };

    super(channelSyncWorkerManifest, handlers, deps);
    this.#service = service;
  }

  /**
   * Kanalı olmayan otelin envanter olayı sıraya girmez, iz bırakmaz. Aktör
   * ayarı olayı yalnızca bu aktör açıldığında ilgilendirir.
   * @param {string} eventName
   * @param {Record<string, any>} payload
   */
  accepts(eventName, payload) {
    if (eventName === BOOKING_EVENT) return true;
    if (eventName === ACTOR_SETTING_EVENT) return payload.actorName === CHANNEL_SYNC_WORKER_NAME && payload.enabled === true;
    return this.#service.isSyncTarget(payload.hotelId);
  }

  /**
   * Gelen rezervasyon personele düştü (aktör kapalı ya da iş tekrar denemelere
   * rağmen yapılamadı): kanal kaydı "elle işlenmeli" olur — ekranda "sırada"
   * kalıp hiç işlenmeyecekmiş gibi beklemesin.
   * @param {Record<string, any>} payload
   * @param {{ name: string }} envelope
   * @param {string} reason
   */
  async afterFallback(payload, envelope, reason) {
    if (envelope.name !== BOOKING_EVENT) return;
    await this.#service.markRevisionForStaff(payload.hotelId, payload.revisionId, reason);
  }

  /** Kapalıyken gönderim tetikleyicileri atlanır (açılınca tam eşitleme); gelen rezervasyon atlanmaz. */
  skipWhenDisabled(eventName) {
    return eventName !== BOOKING_EVENT;
  }

  /**
   * @param {string} eventName
   * @param {Record<string, any>} payload
   */
  describeFallback(eventName, payload) {
    if (eventName === BOOKING_EVENT) return 'Kanaldan gelen rezervasyon elle işlenecek (Kanal yönetimi → Rezervasyonlar)';
    if (eventName === ACTOR_SETTING_EVENT) return 'Kanallarda tam eşitleme istenecek';
    if (channelSyncWorkerManifest.subscribes.includes(eventName)) return 'Kanallara müsaitlik / fiyat değişikliği gönderilecek';
    return super.describeFallback(eventName, payload);
  }
}

/**
 * @param {ConstructorParameters<typeof ChannelSyncWorker>[0]} service
 * @param {object} deps
 */
export function createChannelSyncWorker(service, deps) {
  return new ChannelSyncWorker(service, deps);
}

export { CHANNEL_SYNC_WORKER_NAME, channelSyncWorkerManifest };
export * from './ari.js';
export * from './ical.js';
export * from './channex.js';
export * from './normalize.js';
