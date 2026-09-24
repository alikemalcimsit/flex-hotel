import { isKnownEvent } from '@hotelos/core';

/**
 * Aktör bildirgesi (manifest).
 *
 * Her aktör ne dinlediğini, ne yayınladığını ve hangi işleri onaya
 * götürdüğünü önceden beyan eder. Sebebi tek: modül 12'nin yönetim paneli
 * "bu aktör kapatılırsa ne durur" sorusunu koda bakmadan cevaplayabilsin.
 * Beyan edilmemiş bir event'i dinlemek ya da yayınlamak hata sayılır.
 */

/** @typedef {'worker' | 'agent'} ActorType */

/**
 * @param {{
 *   name: string,
 *   title?: string,
 *   packageName?: string | null,
 *   type?: ActorType,
 *   description: string,
 *   subscribes?: string[],
 *   publishes?: string[],
 *   requiresApproval?: string[],
 *   retry?: { attempts?: number, backoffMs?: number },
 *   fallbackModule?: string,
 *   background?: { maxConcurrent: number, maxQueued: number, onOverflow?: 'fallback' | 'skip' } | null,
 * }} definition
 */
export function defineActor(definition) {
  const {
    name,
    title,
    packageName = null,
    type = 'worker',
    description,
    subscribes = [],
    publishes = [],
    requiresApproval = [],
    retry = {},
    fallbackModule,
    background = null,
  } = definition;

  if (!name) throw new Error('Aktörün adı olmalı');
  if (!description) throw new Error(`"${name}" aktörünün açıklaması olmalı (yönetim panelinde gösterilecek)`);

  for (const action of requiresApproval) {
    if (typeof action !== 'string' || action.trim() === '') {
      throw new Error(`"${name}" aktörünün onay gerektiren iş adı boş olamaz (requiresApproval)`);
    }
  }

  if (background) {
    for (const key of ['maxConcurrent', 'maxQueued']) {
      if (!Number.isInteger(background[key]) || background[key] < 1) {
        throw new Error(`"${name}" aktörünün arka plan ayarında ${key} pozitif tam sayı olmalı`);
      }
    }
    if (background.onOverflow && !['fallback', 'skip'].includes(background.onOverflow)) {
      throw new Error(`"${name}" aktörünün arka plan taşma davranışı "fallback" ya da "skip" olmalı`);
    }
  }

  for (const eventName of [...subscribes, ...publishes]) {
    if (!isKnownEvent(eventName)) {
      throw new Error(
        `"${name}" aktörü katalogda olmayan "${eventName}" event'ine bağlanıyor. ` +
          'Önce shared/core/events/catalog.js içinde tanımlayın.',
      );
    }
  }

  return Object.freeze({
    name,
    /** Panelde görünen kısa Türkçe ad ("Oda aktörü"); verilmezse teknik ad. */
    title: title?.trim() || name,
    /** Aktörün kodunun bulunduğu paket (`@hotelos/room-worker`); panelde "paket" sütunu. */
    packageName,
    type,
    description,
    subscribes: Object.freeze([...subscribes]),
    publishes: Object.freeze([...publishes]),
    requiresApproval: Object.freeze([...requiresApproval]),
    retry: Object.freeze({ attempts: retry.attempts ?? 3, backoffMs: retry.backoffMs ?? 500 }),
    /** Aktör kapalıyken düşen manuel görevin hangi modüle ait sayılacağı. */
    fallbackModule: fallbackModule ?? name,
    /**
     * Arka planda çalışma (modül 8). Verilmezse olay yayıncısı işleyicinin
     * bitmesini bekler (oda atama gibi kısa, veritabanı içi işler için doğru).
     * Verilirse olay sıraya alınır ve yayıncı hemen döner: model çağrısı ya da
     * dış API gibi saniyeler süren iş, webhook'u ve personelin "gönder"
     * isteğini bekletmesin. En fazla `maxConcurrent` iş aynı anda çalışır,
     * `maxQueued` kadarı sırada bekler; taşan iş `onOverflow`'a göre personele
     * düşer (`fallback`, varsayılan) ya da atlanır (`skip`: iş başka bir yoldan
     * tekrar yapılıyorsa, ör. bekleyen mesajları gönderen zamanlanmış iş).
     */
    background: background
      ? Object.freeze({
          maxConcurrent: background.maxConcurrent,
          maxQueued: background.maxQueued,
          onOverflow: background.onOverflow ?? 'fallback',
        })
      : null,
  });
}
