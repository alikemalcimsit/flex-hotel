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
 *   type?: ActorType,
 *   description: string,
 *   subscribes?: string[],
 *   publishes?: string[],
 *   requiresApproval?: string[],
 *   retry?: { attempts?: number, backoffMs?: number },
 *   fallbackModule?: string,
 * }} definition
 */
export function defineActor(definition) {
  const {
    name,
    type = 'worker',
    description,
    subscribes = [],
    publishes = [],
    requiresApproval = [],
    retry = {},
    fallbackModule,
  } = definition;

  if (!name) throw new Error('Aktörün adı olmalı');
  if (!description) throw new Error(`"${name}" aktörünün açıklaması olmalı (yönetim panelinde gösterilecek)`);

  for (const action of requiresApproval) {
    if (typeof action !== 'string' || action.trim() === '') {
      throw new Error(`"${name}" aktörünün onay gerektiren iş adı boş olamaz (requiresApproval)`);
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
    type,
    description,
    subscribes: Object.freeze([...subscribes]),
    publishes: Object.freeze([...publishes]),
    requiresApproval: Object.freeze([...requiresApproval]),
    retry: Object.freeze({ attempts: retry.attempts ?? 3, backoffMs: retry.backoffMs ?? 500 }),
    /** Aktör kapalıyken düşen manuel görevin hangi modüle ait sayılacağı. */
    fallbackModule: fallbackModule ?? name,
  });
}
