import { MAX_PAGE_SIZE } from '@hotelos/hotel-contracts';

/**
 * Sayfalama yardımcıları (sunucu tarafı).
 *
 * Şemanın kendisi `@hotelos/hotel-contracts` içinde — tarayıcı da aynı
 * sınırları biliyor. Burada yalnızca Prisma'ya çevirme ve zarflama var.
 *
 * Neden offset: ayar tabloları (oda tipi, vergi, sezon) sınırlı kardinalitede —
 * en büyük zincir otelde bile birkaç yüz satır. Offset burada güvenli ve
 * kullanıcıya sayfa numarası verebiliyor. Rezervasyon / misafir / folyo kalemi
 * gibi milyonlara çıkabilen tablolarda derin offset yavaşlar; oralarda
 * cursor tabanlı sayfalama kullanılacak (modül 4 ve 22).
 */

export { MAX_PAGE_SIZE };

/**
 * @param {{ page: number, pageSize: number }} params
 * @returns {{ skip: number, take: number }}
 */
export function toSkipTake({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Prisma sonucunu standart sayfa zarfına sarar.
 * @template T
 * @param {T[]} items
 * @param {number} total
 * @param {{ page: number, pageSize: number }} params
 */
export function buildPage(items, total, { page, pageSize }) {
  return {
    items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}
