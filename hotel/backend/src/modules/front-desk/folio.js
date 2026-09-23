import { folioBalance } from './rules.js';

/**
 * Konaklamaların folyo bakiyesi — çıkışın "hesap kapandı mı" sorusu (modül 6).
 *
 * Folyo modülü (15) folyoyu açar, kalemleri ve ödemeleri (modül 17) yazar; bu
 * dosya yalnızca okur. Sözleşme:
 *
 *   bakiye = Σ(kalem tutarı × adet) − Σ(ödeme tutarı × kur)
 *
 * - Silinmiş kalem ve ödeme (`deletedAt`) sayılmaz; iptal edilen kalem ya
 *   silinir ya da eksi tutarlı kalemle düzeltilir.
 * - Başka folyoya aktarılmış folyo (`TRANSFERRED`) sayılmaz: bakiyesi aktarıldığı folyoda.
 * - Ödemenin `exchangeRate`'i ödeme para biriminden folyo para birimine çevirir;
 *   boşsa ödeme folyo para birimindedir.
 * - Denormalize `Folio.balance` kolonuna güvenilmez: tek doğru kaynak kalemler ve ödemeler.
 *
 * Konaklamanın hiç folyosu yoksa sonuçta yer almaz: bakiye **bilinmiyor**
 * demektir (sıfır değil). Çıkış bu durumda bakiye denetimi yapamadığını söyler.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string[]} reservationIds
 * @returns {Promise<Map<string, { folios: number, charges: string, paid: string, balance: string }>>}
 */
export async function stayBalances(client, hotelId, reservationIds) {
  if (reservationIds.length === 0) return new Map();
  const rows = await client.$queryRaw`
    SELECT f."reservationId" AS "reservationId",
           COUNT(*)::int AS "folios",
           COALESCE(SUM(c."total"), 0)::text AS "charges",
           COALESCE(SUM(p."total"), 0)::text AS "paid"
    FROM "Folio" f
    LEFT JOIN LATERAL (
      SELECT SUM(i."amount" * i."quantity") AS "total"
      FROM "FolioItem" i
      WHERE i."folioId" = f."id" AND i."deletedAt" IS NULL
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pay."amount" * COALESCE(pay."exchangeRate", 1)) AS "total"
      FROM "Payment" pay
      WHERE pay."folioId" = f."id" AND pay."deletedAt" IS NULL
    ) p ON TRUE
    WHERE f."hotelId" = ${hotelId}
      AND f."reservationId" = ANY(${reservationIds}::text[])
      AND f."deletedAt" IS NULL
      AND f."status" <> 'TRANSFERRED'
    GROUP BY f."reservationId"`;
  return new Map(
    rows.map((row) => [
      row.reservationId,
      { folios: row.folios, charges: row.charges, paid: row.paid, balance: folioBalance(row) },
    ]),
  );
}

/**
 * Konaklamaya folyoda bir hareket (kalem ya da ödeme) işlenmiş mi? Girişin
 * geri alınabilmesi için hareket olmamalı: geri alınan girişin kalemi
 * sahipsiz kalırdı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function hasFolioActivity(client, hotelId, reservationId) {
  const [row] = await client.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM "Folio" f
      WHERE f."hotelId" = ${hotelId} AND f."reservationId" = ${reservationId} AND f."deletedAt" IS NULL
        AND (
          EXISTS (SELECT 1 FROM "FolioItem" i WHERE i."folioId" = f."id" AND i."deletedAt" IS NULL)
          OR EXISTS (SELECT 1 FROM "Payment" pay WHERE pay."folioId" = f."id" AND pay."deletedAt" IS NULL)
        )
    ) AS "active"`;
  return Boolean(row?.active);
}
