import { z } from 'zod';

/**
 * Event kataloğu.
 *
 * Bir event'in adı ve gövdesi burada tanımlanmadan yayınlanamaz. Sebep:
 * event'ler modüller arası sözleşmedir — yayınlayan ile dinleyen farklı
 * zamanlarda, farklı kişiler tarafından yazılıyor. Şemasız event, iki hafta
 * sonra "bu alan neden yok" tartışmasıdır.
 *
 * `version` alanı ileriye dönük: gövde değişince eski sürüm bir süre
 * desteklenebilsin diye zarf sürümü taşıyor.
 */

const hotelScoped = z.object({ hotelId: z.string().uuid() });

/** Ayar kayıtlarının ortak kimlik gövdesi. */
const settingsEntity = hotelScoped.extend({
  id: z.string().uuid(),
  label: z.string().min(1),
});

/**
 * Event gövdeleri JSON olarak saklandığı için tarihler ISO metne indirgenir.
 * Date da kabul edilir; yayıncı her seferinde elle çevirmek zorunda kalmasın.
 */
const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value))
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'geçersiz tarih' });

export const EVENT_CATALOG = Object.freeze({
  'settings.hotel.updated': hotelScoped.extend({
    /** Değişen alan adları — dinleyen taraf neyin değiştiğine göre karar verebilsin. */
    changedFields: z.array(z.string()).default([]),
  }),

  'settings.roomType.created': settingsEntity,
  'settings.roomType.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.roomType.deleted': settingsEntity,

  'settings.tax.created': settingsEntity,
  'settings.tax.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.tax.deleted': settingsEntity,

  'settings.season.created': settingsEntity,
  'settings.season.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.season.deleted': settingsEntity,

  /* ── Oda envanteri (modül 3) ── */

  'inventory.room.created': settingsEntity.extend({ roomTypeId: z.string().uuid() }),
  'inventory.room.updated': settingsEntity.extend({
    roomTypeId: z.string().uuid(),
    changedFields: z.array(z.string()).default([]),
  }),
  'inventory.room.deleted': settingsEntity.extend({ roomTypeId: z.string().uuid() }),

  'room.assigned': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    /** Aktör mü yoksa personel mi attı — Activity Feed'de ayırt edilsin. */
    assignedBy: z.enum(['manual', 'auto']).default('manual'),
  }),
  'room.unassigned': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
    roomNumber: z.string(),
  }),
  /**
   * Odanın iki bağımsız durumundan biri değişti.
   *
   * `field` hangisi olduğunu söyler: `occupancy` (Boş/Dolu — yalnızca giriş ve
   * çıkış değiştirir) ya da `housekeeping` (Kirli/Temizleniyor/Temiz/Kontrol
   * edildi). Çıkışta ikisi birden değiştiği için iki ayrı event yayınlanır.
   */
  'room.status.changed': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    field: z.enum(['occupancy', 'housekeeping']),
    from: z.string(),
    to: z.string(),
  }),
  /**
   * Oda tarih aralığıyla arızalı ya da hizmet dışı işaretlendi.
   * `OUT_OF_ORDER` envanterden düşer; `OUT_OF_SERVICE` satışta kalır ama atanmaz.
   */
  'room.blocked': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    blockId: z.string().uuid(),
    type: z.enum(['OUT_OF_ORDER', 'OUT_OF_SERVICE']),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    reason: z.string(),
  }),
  /**
   * Blok kaldırıldı. `CANCELLED`: henüz başlamamıştı, kayıt silindi.
   * `ENDED`: sürüyordu, bitişi bugüne çekildi (geçmiş günler değişmez).
   */
  'room.unblocked': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    blockId: z.string().uuid(),
    mode: z.enum(['CANCELLED', 'ENDED']),
  }),

  /* ── Modül 4 ve 6'nın yayınlayacağı event'ler ──
     Henüz yayıncıları yok (Ali Kemal'de) ama room-worker bunları dinliyor.
     Sözleşmeyi şimdiden yazmak, iki taraf buluştuğunda uyuşmazlık çıkmasını
     engelliyor — event kataloğunun asıl varlık sebebi bu. */

  'reservation.created': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomTypeId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    /** Rezervasyon oluşturulurken oda zaten atandıysa aktör tekrar atamaz. */
    roomId: z.string().uuid().nullable().default(null),
  }),

  'guest.checked_in': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
  }),

  'guest.checked_out': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
  }),
});

/** @typedef {keyof typeof EVENT_CATALOG} EventName */

/**
 * Event adının katalogda olup olmadığını söyler.
 * @param {string} name
 */
export function isKnownEvent(name) {
  return Object.hasOwn(EVENT_CATALOG, name);
}

/**
 * Gövdeyi katalogdaki şemaya göre doğrular.
 * @param {string} name
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function validatePayload(name, payload) {
  const schema = EVENT_CATALOG[name];
  if (!schema) {
    throw new Error(`Bilinmeyen event: "${name}". Önce shared/core/events/catalog.js içinde tanımlayın.`);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new Error(`"${name}" event gövdesi geçersiz — ${detail}`);
  }
  return result.data;
}

/** Cache invalidation gibi toplu dinlemeler için: ayar değişikliği event'leri. */
export const SETTINGS_CHANGED_EVENTS = Object.freeze(
  Object.keys(EVENT_CATALOG).filter((name) => name.startsWith('settings.')),
);

/**
 * Müsaitliği etkileyen her şey: oda eklenmesi, atanması, arıza kaydı ve
 * misafir giriş-çıkışı. Canlı güncellenen ekranlar (modül 5 oda planı, socket
 * yayını) bu listeyi dinleyerek yeniden hesaplar. Müsaitliğin kendisi
 * cache'lenmez — bkz. `hotel/backend/src/modules/rooms/service.js`.
 */
export const INVENTORY_CHANGED_EVENTS = Object.freeze([
  'inventory.room.created',
  'inventory.room.updated',
  'inventory.room.deleted',
  'room.assigned',
  'room.unassigned',
  'room.blocked',
  'room.unblocked',
  'reservation.created',
  'guest.checked_in',
  'guest.checked_out',
]);
