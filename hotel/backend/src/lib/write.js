import { prisma } from '../db.js';
import { dispatchStaged, stageEvent } from './events.js';

/**
 * Yazma işlemlerinin ortak kalıbı: transaction + commit sonrası event dağıtımı.
 *
 * Verilen iş, veriyi değiştirir, denetim izi bırakır ve `stage()` ile event'leri
 * outbox'a yazar — hepsi tek transaction'da. Transaction geri alınırsa hiçbiri
 * kalmaz. Commit sonrası event'ler dinleyicilere dağıtılır; dağıtım hatası
 * çağıranı etkilemez, çünkü değişiklik zaten kalıcıdır ve event satırı
 * `publishedAt = null` olarak durur (ileride yeniden denenebilir).
 *
 * Dinleyiciler commit'ten önce çalıştırılmaz: henüz görünmeyen veriyi okurlardı.
 *
 * @template T
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient, stage: (name: string, payload: object) => Promise<void>) => Promise<T>} work
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<T>}
 */
export async function writeWithEvents(work, options = {}) {
  const staged = [];

  const result = await prisma.$transaction(async (tx) => {
    const stage = async (name, payload) => {
      staged.push(await stageEvent(tx, name, payload));
    };
    return work(tx, stage);
  }, options);

  await dispatchStaged(staged);
  return result;
}
