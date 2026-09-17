import { useSyncExternalStore } from 'react';

/**
 * Ekranda akan saat: "3 dk önce", "12 dk kaldı" gibi metinler için.
 *
 * Listedeki her satır kendi zamanlayıcısını kurarsa 100 satırlık listede 100
 * zamanlayıcı olur. Burada aynı aralığı isteyen bütün bileşenler tek
 * zamanlayıcıyı paylaşır; son bileşen ayrılınca zamanlayıcı durur.
 *
 * `subscribe` aralık başına tek ve sabit fonksiyondur: React her çizimde yeni
 * fonksiyon görürse aboneliği söküp yeniden kurar; kurulum da saati
 * güncellediği için sonsuz çizim döngüsü oluşurdu.
 */

/**
 * @typedef {{
 *   now: number,
 *   listeners: Set<() => void>,
 *   timer: ReturnType<typeof setInterval> | null,
 *   subscribe: (listener: () => void) => () => void,
 *   getSnapshot: () => number,
 * }} Clock
 */

/** @type {Map<number, Clock>} */
const clocks = new Map();

/** @param {number} intervalMs */
function clockFor(intervalMs) {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;

  /** @type {Clock} */
  const clock = {
    now: Date.now(),
    listeners: new Set(),
    timer: null,
    subscribe(listener) {
      clock.listeners.add(listener);
      if (clock.timer === null) {
        // Saat bir süre durmuşsa ilk abonede tazelenir; hemen ardından gelen
        // abonelikler değeri değiştirmez (çizim tetiklemez).
        if (Date.now() - clock.now >= intervalMs) clock.now = Date.now();
        clock.timer = setInterval(() => {
          clock.now = Date.now();
          for (const notify of clock.listeners) notify();
        }, intervalMs);
      }
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size === 0 && clock.timer !== null) {
          clearInterval(clock.timer);
          clock.timer = null;
        }
      };
    },
    getSnapshot: () => clock.now,
  };
  clocks.set(intervalMs, clock);
  return clock;
}

/**
 * @param {number} intervalMs Tazelenme aralığı
 * @returns {number} epoch ms
 */
export function useNow(intervalMs) {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
