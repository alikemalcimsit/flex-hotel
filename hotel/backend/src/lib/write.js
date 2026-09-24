import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../db.js';
import { isRetryableTransactionError } from './errors.js';
import { dispatchStaged, stageEvent } from './events.js';

/** Kilitlenme / yazma çatışmasında işin en fazla kaç kez baştan yapılacağı. */
const MAX_TRANSACTION_ATTEMPTS = 3;

/** Yeniden denemeden önceki bekleme (ms): çakışan işlem bitsin; eşzamanlılar aynı anda dönmesin. */
const RETRY_BASE_DELAY_MS = 40;

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
 * Kilitlenme (deadlock) ya da yazma çatışmasında veritabanı işlemi geri alır;
 * iş bir kaç kez baştan çalıştırılır. Bu yüzden `work` transaction dışına yan
 * etki bırakmamalı (e-posta göndermek, önbelleğe yazmak gibi) — yalnızca `tx`
 * ve `stage` kullanır. Commit'ten sonra yapılacak süreç içi iş (ör. canlı
 * akışa "yeni satır" haberi) `afterCommit` ile bırakılır: yalnızca başarılı
 * denemenin kancaları, olaylar dağıtıldıktan sonra çalışır; hata fırlatmamalı.
 *
 * @template T
 * @param {(
 *   tx: import('@prisma/client').Prisma.TransactionClient,
 *   stage: (name: string, payload: object) => Promise<void>,
 *   afterCommit: (fn: () => void) => void,
 * ) => Promise<T>} work
 * @param {{ timeout?: number, maxWait?: number }} [options]
 * @returns {Promise<T>}
 */
export async function writeWithEvents(work, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const staged = [];
    const committed = [];
    try {
      const result = await prisma.$transaction(async (tx) => {
        const stage = async (name, payload) => {
          staged.push(await stageEvent(tx, name, payload));
        };
        return work(tx, stage, (fn) => committed.push(fn));
      }, options);

      await dispatchStaged(staged);
      for (const fn of committed) fn();
      return result;
    } catch (error) {
      if (attempt >= MAX_TRANSACTION_ATTEMPTS || !isRetryableTransactionError(error)) throw error;
      await delay(RETRY_BASE_DELAY_MS * attempt + Math.floor(Math.random() * RETRY_BASE_DELAY_MS));
    }
  }
}
