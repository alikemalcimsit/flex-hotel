import { Prisma } from '@prisma/client';
import { STAYED_STATUSES } from '../rooms/rules.js';

/**
 * Tahminin SQL'leri (modül 25). Rapor modülünün salt okunur işleminde
 * çalışır (`reports/queries.js` → `readOnly`).
 *
 * ### "O gün kala eldeki" nasıl bulunur
 *
 * Geçmişteki bir an (`asOf`) için bir gecenin eldeki sayılması: rezervasyon o
 * andan önce açılmış, o anda iptal edilmemiş ve "gelmedi" işaretlenmemiş.
 * Rezervasyon açılış anı esas alınır (gece satırının değil: rezervasyon
 * düzenlenince geceleri yeniden yazılır, gece satırının tarihi "sonradan
 * satıldı" gibi görünürdü). Bilinen sapma: sonradan uzatılan konaklamanın
 * eklenen gecesi açılış anından beri eldeymiş sayılır (pickup bir miktar az
 * görünür). Erken çıkışta / tarih değişiminde silinen geceler ne eldekinde ne
 * gerçekleşende vardır — oranı bozmaz.
 *
 * Index: `ReservationNight (hotelId, date)` — nokta başına bir günün
 * geceleri; `Reservation (hotelId, createdAt, id)` — ilk kayıt.
 */

const STAYED = Prisma.raw(STAYED_STATUSES.map((status) => `'${status}'`).join(', '));

/**
 * Otelin ilk rezervasyon kaydının anı: bundan önceki "o gün kala" anlarında
 * sistemde kayıt yoktu, karşılaştırma yapılamaz.
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @returns {Promise<Date | null>}
 */
export async function loadDataStart(tx, hotelId) {
  const [row] = await tx.$queryRaw`SELECT MIN("createdAt") AS "start" FROM "Reservation" WHERE "hotelId" = ${hotelId}`;
  return row?.start ?? null;
}

/**
 * Karşılaştırma noktaları: her (gün, an) için o anda eldeki gece ve günün
 * gerçekleşen gecesi (içeride / çıkmış konaklama — gelir raporunun geçmiş gün
 * tanımı).
 *
 * İptal / gelmedi anı boşsa (eski kayıt) son güncelleme anı alınır.
 *
 * Yalnızca otelin para birimindeki rezervasyonlar (eldeki gece de öyle sayılır:
 * gelir raporu başka birimi karıştırmaz — oran aynı kümeden çıkmalı).
 *
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} currency otelin para birimi
 * @param {Array<{ day: string, asOf: Date }>} points
 * @returns {Promise<Array<{ onBooks: number, final: number }>>} `points` sırasıyla
 */
export async function loadPickupPoints(tx, hotelId, currency, points) {
  if (points.length === 0) return [];
  const days = points.map((point) => point.day);
  const moments = points.map((point) => point.asOf.toISOString());
  const rows = await tx.$queryRaw`
    WITH points AS (
      SELECT p.day::date AS "day", p.as_of::timestamp AS "asOf", p.position::int AS "position"
      FROM unnest(${days}::text[], ${moments}::text[]) WITH ORDINALITY AS p(day, as_of, position)
    ),
    nights AS (
      SELECT n."date"::date AS "day",
             r."createdAt" AS "bookedAt",
             COALESCE(r."cancelledAt", CASE WHEN r."status" = 'CANCELLED' THEN r."updatedAt" END) AS "cancelledAt",
             COALESCE(r."noShowAt", CASE WHEN r."status" = 'NO_SHOW' THEN r."updatedAt" END) AS "noShowAt",
             r."status" IN (${STAYED}) AS "stayed"
      FROM "ReservationNight" n
      JOIN "Reservation" r ON r."id" = n."reservationId" AND r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL
        AND r."currency" = ${currency}
      WHERE n."hotelId" = ${hotelId}
        AND n."deletedAt" IS NULL
        AND n."date" IN (SELECT DISTINCT points."day"::timestamp FROM points)
    )
    SELECT points."position" AS "position",
           COUNT(nights."day") FILTER (
             WHERE nights."bookedAt" <= points."asOf"
               AND (nights."cancelledAt" IS NULL OR nights."cancelledAt" > points."asOf")
               AND (nights."noShowAt" IS NULL OR nights."noShowAt" > points."asOf")
           )::int AS "onBooks",
           COUNT(nights."day") FILTER (WHERE nights."stayed")::int AS "final"
    FROM points
    LEFT JOIN nights ON nights."day" = points."day"
    GROUP BY points."position"`;
  const byPosition = new Map(rows.map((row) => [row.position, row]));
  return points.map((_, index) => {
    const row = byPosition.get(index + 1);
    return { onBooks: row?.onBooks ?? 0, final: row?.final ?? 0 };
  });
}
