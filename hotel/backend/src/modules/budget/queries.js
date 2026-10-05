/**
 * Bütçe gerçekleşeninin SQL'leri (modül 27). Rapor modülünün salt okunur
 * işleminde çalışır (`reports/queries.js` → `readOnly`).
 *
 * Oda geliri, ek ücret, iptal geliri, satılan / satılabilir oda gelir
 * raporunun hesabından gelir (aynı tanımlar; rapor ile bütçe aynı ayın oda
 * gelirini hiçbir zaman farklı göstermez). Burada yalnızca raporun saymadığı
 * gelirler ve tahsilat var.
 *
 * Index'ler: `FolioItem (hotelId, serviceDate)`, `Payment (hotelId,
 * businessDate, postedAt, id)`.
 */

/**
 * Oda dışı gelir (vergiler hariç), ay × sınıf. Oda / ek ücret / iptal sınıfı
 * (rapordaki tanım) ve vergi kalemleri dışarıda; iptal kaydı asıl kalemin
 * kaynağıyla sınıflanır, iptal edildiği güne düşer. İndirim, vergi
 * kategorisinin gelirinden düşer (restoran indirimi restoran gelirinden).
 * Yalnızca kapanmış günler (iş gününden önce).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ year: number, businessDate: string, currency: string }} input
 * @returns {Promise<Array<{ month: number, item: string, amount: import('@prisma/client').Prisma.Decimal }>>}
 */
export function loadOtherRevenue(tx, hotelId, { year, businessDate, currency }) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return tx.$queryRaw`
    SELECT EXTRACT(MONTH FROM i."serviceDate")::int AS "month",
           c.item AS "item",
           SUM(i."netAmount") AS "amount"
    FROM "FolioItem" i
    LEFT JOIN "FolioItem" o ON o."id" = i."reversalOfId" AND o."hotelId" = ${hotelId}
    JOIN "Reservation" r ON r."id" = i."reservationId" AND r."hotelId" = ${hotelId} AND r."currency" = ${currency}
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(o."source", i."source") IN ('ROOM_NIGHT', 'EARLY_CHECK_IN', 'LATE_CHECK_OUT', 'CANCELLATION', 'NO_SHOW') THEN NULL
        WHEN COALESCE(o."source", i."source") = 'MANUAL' AND i."taxCategory" = 'ROOM' THEN NULL
        WHEN i."type" = 'TAX' THEN NULL
        WHEN i."type" = 'FNB' OR (i."type" = 'DISCOUNT' AND i."taxCategory" = 'FNB') THEN 'FNB_REVENUE'
        WHEN i."type" = 'MINIBAR' OR (i."type" = 'DISCOUNT' AND i."taxCategory" = 'MINIBAR') THEN 'MINIBAR_REVENUE'
        WHEN i."type" = 'LAUNDRY' OR (i."type" = 'DISCOUNT' AND i."taxCategory" = 'LAUNDRY') THEN 'LAUNDRY_REVENUE'
        ELSE 'OTHER_REVENUE'
      END AS item
    ) c
    WHERE i."hotelId" = ${hotelId}
      AND i."serviceDate" >= ${from}::date
      AND i."serviceDate" <= ${to}::date
      AND i."serviceDate" < ${businessDate}::date
      AND i."deletedAt" IS NULL
      AND c.item IS NOT NULL
    GROUP BY 1, 2`;
}

/**
 * Tahsilat (net: ödeme − iade ± iptal kaydı; folyonun para biriminde, kasa
 * görünümüyle aynı tanım), ay ay. Yalnızca işlenmiş (onay bekleyen ve
 * reddedilen değil) ve kapanmış günler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ year: number, businessDate: string }} input
 * @returns {Promise<Array<{ month: number, amount: import('@prisma/client').Prisma.Decimal }>>}
 */
export function loadCollections(tx, hotelId, { year, businessDate }) {
  return tx.$queryRaw`
    SELECT EXTRACT(MONTH FROM p."businessDate")::int AS "month",
           SUM(p."folioAmount") AS "amount"
    FROM "Payment" p
    WHERE p."hotelId" = ${hotelId}
      AND p."businessDate" >= ${`${year}-01-01`}::date
      AND p."businessDate" <= ${`${year}-12-31`}::date
      AND p."businessDate" < ${businessDate}::date
      AND p."status" = 'POSTED'
      AND p."deletedAt" IS NULL
    GROUP BY 1`;
}
