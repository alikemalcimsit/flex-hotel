import { currentActor, currentCorrelationId } from '@hotelos/core';

/**
 * Denetim izi (audit) yazımı.
 *
 * Kritik detay: audit kaydı, değişikliğin **aynı transaction'ı içinde** yazılır.
 * Ayrı yazılsaydı, araya giren bir hata "değişiklik oldu ama izi yok" durumunu
 * bırakırdı — denetim izinin tek işi bu durumun olmamasıdır.
 *
 * Modül 10'un "kullanıcı audit listesi (kim, ne zaman, hangi kayıt, eski/yeni
 * değer)" ekranı bu tabloyu okuyacak.
 */

/** Audit kaydına yazılmayacak alanlar — gürültü. */
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'deletedAt']);

/**
 * İki sürüm arasında gerçekten değişen alanları bulur.
 * @param {Record<string, unknown> | null | undefined} before
 * @param {Record<string, unknown> | null | undefined} after
 * @returns {string[]}
 */
export function diffFields(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    // Değerler DTO'dan geliyor (Decimal → string, Date → ISO), bu yüzden
    // JSON karşılaştırması güvenli ve dizi/nesne alanları da kapsıyor.
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed.sort();
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   hotelId: string,
 *   entity: string,
 *   entityId: string,
 *   action: 'CREATE' | 'UPDATE' | 'DELETE',
 *   before?: Record<string, unknown> | null,
 *   after?: Record<string, unknown> | null,
 * }} entry
 * @returns {Promise<string[]>} değişen alan adları
 */
export async function recordAudit(tx, { hotelId, entity, entityId, action, before = null, after = null }) {
  const changedFields = action === 'UPDATE' ? diffFields(before, after) : [];

  await tx.auditLog.create({
    data: {
      hotelId,
      entity,
      entityId,
      action,
      actor: currentActor(),
      before: before ?? undefined,
      after: after ?? undefined,
      changedFields,
      correlationId: currentCorrelationId(),
    },
  });

  return changedFields;
}
