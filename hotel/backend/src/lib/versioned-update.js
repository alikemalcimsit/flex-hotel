import { NotFoundError, StaleWriteError } from './errors.js';

/**
 * Optimistic lock'lu güncelleme. Kayıt yoksa 404, sürüm eskiyse 409 döner —
 * ikisini ayırt etmek önemli: kullanıcıya "silinmiş" ile "başkası değiştirdi"
 * farklı şeyler söyler.
 *
 * `identity` kaydı bulan filtredir. Otel için `{ id }`, otele bağlı kayıtlar
 * için `{ id, hotelId }` verilir — `Hotel` tablosunda `hotelId` kolonu yok.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} model Prisma model erişim adı (ör. 'roomType')
 * @param {Record<string, unknown>} identity
 * @param {Date} expectedUpdatedAt
 * @param {Record<string, unknown>} data
 * @param {string} notFoundMessage
 */
export async function updateWithVersionCheck(tx, model, identity, expectedUpdatedAt, data, notFoundMessage) {
  const result = await tx[model].updateMany({ where: { ...identity, updatedAt: expectedUpdatedAt }, data });

  if (result.count === 0) {
    const exists = await tx[model].findFirst({ where: identity, select: { id: true } });
    if (!exists) throw new NotFoundError(notFoundMessage);
    throw new StaleWriteError();
  }
}
