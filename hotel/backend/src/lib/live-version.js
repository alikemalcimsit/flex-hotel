import {
  APPROVAL_EVENTS,
  LIVE_VIEW_EVENTS,
  MESSAGING_CHANGED_EVENTS,
  REQUESTS_CHANGED_EVENTS,
  SETTINGS_CHANGED_EVENTS,
} from '@hotelos/core';
import { eventBus } from './events.js';

/**
 * Otel başına "canlı görünüm" sürümleri: canlı ekranların okuma önbelleğinin
 * anahtarı (bkz. `read-cache.js`).
 *
 * Her kapsam kendi event'leriyle artar. Event'ler commit'ten **sonra**
 * dağıtıldığı için artış, yazma kalıcı olduktan sonra olur: eski sürümle
 * hesaplanmış cevap yeni sürümle bir daha okunmaz.
 *
 * Kapsamlar birbirini de etkiler: gelen kutusu satırı oda numarası gösterir,
 * bu yüzden envanter değişikliği mesaj ve istek sürümünü de artırır.
 */

export const LIVE_SCOPES = Object.freeze({
  INVENTORY: 'inventory',
  MESSAGING: 'messaging',
  REQUESTS: 'requests',
  APPROVALS: 'approvals',
});

const SCOPE_EVENTS = Object.freeze({
  // Oda tipi adı gibi ayarlar da ızgarada görünür.
  [LIVE_SCOPES.INVENTORY]: [...LIVE_VIEW_EVENTS, ...SETTINGS_CHANGED_EVENTS],
  [LIVE_SCOPES.MESSAGING]: [...MESSAGING_CHANGED_EVENTS, ...REQUESTS_CHANGED_EVENTS, ...LIVE_VIEW_EVENTS],
  [LIVE_SCOPES.REQUESTS]: [...REQUESTS_CHANGED_EVENTS, ...LIVE_VIEW_EVENTS],
  [LIVE_SCOPES.APPROVALS]: [...APPROVAL_EVENTS],
});

/** @type {Map<string, number>} `${scope}:${hotelId}` → sürüm */
const versions = new Map();

/**
 * @param {string} scope `LIVE_SCOPES` içinden
 * @param {string} hotelId
 */
export function liveVersion(scope, hotelId) {
  return versions.get(`${scope}:${hotelId}`) ?? 0;
}

/**
 * @param {string} scope
 * @param {string} hotelId
 */
export function bumpLiveVersion(scope, hotelId) {
  const key = `${scope}:${hotelId}`;
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * Sürüm takibini kurar (idempotent). Modül yüklenirken bir kez çağrılır:
 * servisler sunucu dışında (betik, test) kullanıldığında da sürüm doğru artmalı.
 */
export function registerLiveVersionTracking() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = Object.entries(SCOPE_EVENTS).map(([scope, events]) =>
    eventBus.subscribeMany([...new Set(events)], `live-version:${scope}`, (payload) => {
      if (payload?.hotelId) bumpLiveVersion(scope, payload.hotelId);
    }),
  );
}

registerLiveVersionTracking();
