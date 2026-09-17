import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * İstek/olay bağlamı.
 *
 * Neden AsyncLocalStorage: `correlationId`'yi her fonksiyon imzasından
 * geçirmek, 60+ modüllük bir sistemde her servis çağrısını kirletir ve biri
 * mutlaka unutur. Bağlam çağrı ağacında kendiliğinden taşınsın istiyoruz.
 *
 * Modül 10 (Activity Feed) "bir rezervasyonun tüm zincirini tek tıkla gör"
 * diyor; o zincirin tutkalı buradaki `correlationId`.
 */

/** @type {AsyncLocalStorage<{ correlationId: string, causationId?: string, actor: string }>} */
const storage = new AsyncLocalStorage();

/**
 * Verilen bağlamda bir işi çalıştırır.
 * @template T
 * @param {{ correlationId?: string, causationId?: string, actor?: string }} context
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithContext(context, fn) {
  return storage.run(
    {
      correlationId: context.correlationId ?? randomUUID(),
      causationId: context.causationId,
      actor: context.actor ?? 'system',
    },
    fn,
  );
}

/**
 * Bağlamı geri kalan async akış için kurar (callback sarmalamadan).
 *
 * Fastify hook'ları gövdeyi saramadığı için `run` yerine bu gerekiyor:
 * `onRequest` hook'unda çağrıldığında, aynı isteğin sonraki tüm hook ve
 * handler'ları bu bağlamı görür.
 *
 * @param {{ correlationId?: string, causationId?: string, actor?: string }} context
 * @returns {{ correlationId: string, causationId?: string, actor: string }}
 */
export function enterContext(context) {
  const store = {
    correlationId: context.correlationId ?? randomUUID(),
    causationId: context.causationId,
    actor: context.actor ?? 'system',
  };
  storage.enterWith(store);
  return store;
}

/** @returns {{ correlationId: string, causationId?: string, actor: string } | undefined} */
export function getContext() {
  return storage.getStore();
}

/**
 * Bağlam yoksa yeni bir correlationId üretir — zincirsiz kalmaktansa
 * tek adımlık bir zincir başlatmak yeğdir.
 * @returns {string}
 */
export function currentCorrelationId() {
  return storage.getStore()?.correlationId ?? randomUUID();
}

/** @returns {string} */
export function currentActor() {
  return storage.getStore()?.actor ?? 'system';
}
