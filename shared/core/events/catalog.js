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
