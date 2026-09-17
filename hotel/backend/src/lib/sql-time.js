import { Prisma } from '@prisma/client';

/**
 * Ham SQL'de zaman — oturumun saat diliminden bağımsız.
 *
 * Tablolardaki zaman sütunları saat dilimsiz (`timestamp(3)`) ve UTC duvar
 * saati tutar; Prisma'nın kendi sorguları da öyle yazar. Ham sorguda ise
 * `now()` ve JS `Date` parametresi saat dilimlidir: veritabanı oturumu UTC
 * değilse (başka sunucuya taşıma, `timezone` ayarı) karşılaştırmalar ve
 * yazılan değerler sessizce saatlerce kayardı — kuyruktaki bildirim erken ya
 * da geç gider, zil sırası bozulur. Bu yüzden ham sorgular yalnızca bu
 * yardımcıları kullanır.
 */

/** Şu an, UTC duvar saati (`timestamp`). */
export const SQL_NOW = Prisma.raw(`(now() AT TIME ZONE 'UTC')`);

/**
 * JS zamanını UTC duvar saati olarak verir. Metindeki "Z" `timestamp`
 * dönüşümünde yok sayılır; değer oturum ayarına bakılmadan aynı kalır.
 *
 * @param {Date} value
 */
export function sqlTimestamp(value) {
  return Prisma.sql`${value.toISOString()}::timestamp`;
}
