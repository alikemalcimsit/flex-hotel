import { InMemoryEventBus, INVENTORY_CHANGED_EVENTS, SETTINGS_CHANGED_EVENTS } from '@hotelos/core';
import { prismaUnfiltered } from '../db.js';
import { cache, invalidateHotelSettings } from './cache.js';

/**
 * Uygulamanın event bus'ı ve kalıcılığı.
 *
 * `shared/core` altyapıdan bağımsız kalsın diye Prisma'yı bilmiyor; buraya
 * kadar gelen bağlantı noktası burası.
 *
 * Bus, sunucu kurulmadan önce import edilebildiği için logger sonradan
 * takılıyor (`setEventLogger`). Öncesinde yayınlanan bir event'in log'u
 * kaybolmasın diye başlangıçta konsola düşen bir yedek var.
 */

let logger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** @param {{ info: Function, warn: Function, error: Function }} next */
export function setEventLogger(next) {
  logger = next;
}

const proxyLogger = {
  info: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
};

export const eventBus = new InMemoryEventBus({
  logger: proxyLogger,
  persist: async (envelope) => {
    const hotelId = envelope.payload?.hotelId;
    if (!hotelId) {
      throw new Error(`"${envelope.name}" event'i hotelId içermiyor; EventLog'a yazılamaz.`);
    }

    // Soft-delete extension'ı atlanıyor: event log'u ham, dokunulmamış kalmalı.
    await prismaUnfiltered.eventLog.create({
      data: {
        id: envelope.id,
        hotelId,
        name: envelope.name,
        version: envelope.version,
        payload: envelope.payload,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId ?? null,
        hop: envelope.hop,
        actor: envelope.actor,
        occurredAt: envelope.occurredAt,
        publishedAt: new Date(),
      },
    });
  },
});

/**
 * Transactional outbox — 1. adım: event'i iş verisiyle **aynı transaction'da**
 * kaydet, ama henüz dağıtma.
 *
 * Neden: event'i transaction dışında yayınlarsak iki kötü ihtimal var —
 * transaction geri alınırsa "olmayan bir değişikliğin event'i" kalır, ya da
 * event yazılamazsa "izi olmayan bir değişiklik" olur. Aynı transaction'a
 * yazmak ikisini de imkânsız kılıyor. Dinleyiciler commit sonrası çalışır,
 * çünkü commit'ten önce çalışsalardı henüz görünmeyen veriyi okurlardı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} name
 * @param {object} payload
 * @returns {Promise<object>} dağıtılmayı bekleyen zarf
 */
export async function stageEvent(tx, name, payload) {
  const envelope = eventBus.createEnvelope(name, payload);

  await tx.eventLog.create({
    data: {
      id: envelope.id,
      hotelId: envelope.payload.hotelId,
      name: envelope.name,
      version: envelope.version,
      payload: envelope.payload,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId ?? null,
      hop: envelope.hop,
      actor: envelope.actor,
      occurredAt: envelope.occurredAt,
      publishedAt: null,
    },
  });

  return envelope;
}

/**
 * Transactional outbox — 2. adım: commit sonrası dağıt ve yayınlandı olarak
 * işaretle.
 *
 * Dağıtım başarısız olsa bile `publishedAt` boş kalır; bu satırlar ileride
 * bir "outbox tarayıcı" ile yeniden denenebilir (modül 10/12 ile gelecek).
 *
 * @param {object[]} envelopes
 */
export async function dispatchStaged(envelopes) {
  for (const envelope of envelopes) {
    try {
      await eventBus.dispatch(envelope);
      await prismaUnfiltered.eventLog.update({
        where: { id: envelope.id },
        data: { publishedAt: new Date() },
      });
    } catch (error) {
      logger.error({ err: error, event: envelope.name, id: envelope.id }, 'Event dağıtılamadı; publishedAt boş kaldı');
    }
  }
}

/**
 * Cache geçersiz kılma artık event üzerinden.
 *
 * Neden doğrudan çağrı değil: yazma işlemi "cache'i de temizle" sorumluluğunu
 * taşımamalı. Bugün tek dinleyici bu; yarın çok örnekli (multi-instance)
 * kuruluma geçildiğinde aynı event kuyruğa taşınıp diğer örneklerin cache'ini
 * de temizleyecek — servis kodunda tek satır değişmeden.
 */
/** @type {Array<() => void>} */
let coreUnsubscribers = [];

/**
 * Çekirdek dinleyicileri kurar.
 *
 * İdempotent olması şart: `buildApp()` birden fazla kez çağrılabiliyor
 * (testler, gelecekte çok kiracılı kurulum). Eski abonelikler kaldırılmazsa
 * aynı event iki dinleyiciye gider — cache iki kez temizlenir (zararsız) ama
 * aynı desendeki aktörler işi iki kez yapar (zararlı).
 */
export function registerCoreSubscribers() {
  for (const unsubscribe of coreUnsubscribers) unsubscribe();

  coreUnsubscribers = [
    eventBus.subscribeMany(SETTINGS_CHANGED_EVENTS, 'settings-cache', (payload) => {
      invalidateHotelSettings(payload.hotelId);
    }),

    // Envanter değişince oda listesi cache'i tazelenir. Müsaitlik hesabının
    // kendisi cache'lenmiyor (her tarih penceresi ayrı sonuç, çok değişken) —
    // yalnızca sabit girdisi olan oda listesi tutuluyor.
    eventBus.subscribeMany(INVENTORY_CHANGED_EVENTS, 'inventory-cache', (payload) => {
      cache.invalidatePrefix(`inventory:${payload.hotelId}:`);
    }),
  ];
}
