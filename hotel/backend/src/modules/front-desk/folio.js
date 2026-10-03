import { lockFolios } from '../../lib/locks.js';
import { folioBalance } from './rules.js';

/**
 * Konaklamaların folyo bakiyesi — çıkışın "hesap kapandı mı" sorusu (modül 6).
 *
 * Folyo modülü (15) folyoyu açar ve kalemleri yazar, ödeme modülü (17)
 * ödemeleri; bu dosya yalnızca okur. Sözleşme:
 *
 *   bakiye = Σ kalem toplamı − Σ (ödeme tutarı × kur)
 *
 * - Kalem toplamı (`FolioItem.total`) = tutar × adet + hariç vergiler.
 * - İptal edilen kalem silinmez; ters kaydı (eksi tutar) toplamı sıfırlar.
 *   Silinmiş kalem ve ödeme (`deletedAt`) sayılmaz.
 * - Başka folyoya birleştirilmiş folyo (`TRANSFERRED`) sayılmaz: kalemleri
 *   birleştiği folyoda.
 * - Ödemenin folyoya giren tutarı `folioAmount` (ödeme para biriminden kurla
 *   çevrilmiş, ödeme başına kuruşa yuvarlanmış). İade ve iptal kaydı eksidir.
 *   Yalnızca işlenmiş (`POSTED`) ödeme sayılır: onay bekleyen büyük ödeme
 *   misafirin borcunu kapatmaz (modül 17).
 * - Denormalize `Folio.balance` kolonu listeler içindir; para-kritik yol (çıkış)
 *   kalemlerden yeniden hesaplar.
 *
 * Konaklamanın hiç folyosu yoksa sonuçta yer almaz: işlenmiş kalem de ödeme de
 * yoktur. Çıkış bu durumda ödeneceği yalnızca işlenecek tutarlardan hesaplar
 * (`amountDue`).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string[]} reservationIds
 * @returns {Promise<Map<string, { folios: number, openFolios: number, charges: string, paid: string, balance: string }>>}
 */
export async function stayBalances(client, hotelId, reservationIds) {
  if (reservationIds.length === 0) return new Map();
  const rows = await client.$queryRaw`
    SELECT f."reservationId" AS "reservationId",
           COUNT(*)::int AS "folios",
           COUNT(*) FILTER (WHERE f."status" = 'OPEN')::int AS "openFolios",
           COALESCE(SUM(c."total"), 0)::text AS "charges",
           COALESCE(SUM(p."total"), 0)::text AS "paid"
    FROM "Folio" f
    LEFT JOIN LATERAL (
      SELECT SUM(i."total") AS "total"
      FROM "FolioItem" i
      WHERE i."folioId" = f."id" AND i."deletedAt" IS NULL
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pay."folioAmount") AS "total"
      FROM "Payment" pay
      WHERE pay."folioId" = f."id" AND pay."status" = 'POSTED' AND pay."deletedAt" IS NULL
    ) p ON TRUE
    WHERE f."hotelId" = ${hotelId}
      AND f."reservationId" = ANY(${reservationIds}::text[])
      AND f."deletedAt" IS NULL
      AND f."status" <> 'TRANSFERRED'
    GROUP BY f."reservationId"`;
  return new Map(
    rows.map((row) => [
      row.reservationId,
      { folios: row.folios, openFolios: row.openFolios, charges: row.charges, paid: row.paid, balance: folioBalance(row) },
    ]),
  );
}

/**
 * Konaklamanın folyolarını kilitler: çıkış bakiyeyi okurken aynı anda folyoya
 * kalem ya da ödeme yazan işlem beklesin (okunan bakiye commit edilmemiş bir
 * yazımı kaçırmasın). Rezervasyon kilidinden sonra çağrılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function lockStayFolios(tx, hotelId, reservationId) {
  const folios = await tx.folio.findMany({ where: { hotelId, reservationId }, select: { id: true } });
  await lockFolios(tx, hotelId, folios.map((folio) => folio.id));
}

/**
 * Konaklamada folyo hareketi var mı? Girişin geri alınabilmesi için hareket
 * olmamalı: geri alınan girişin kalemi sahipsiz kalırdı.
 *
 * Hareket: bu konaklamadan doğan kalemler (başka folyoya aktarılmış olsa da)
 * ve bu konaklama için resepsiyonda alınan ödemeler (reddedilen hariç).
 * **Girişin kendi işleri hareket sayılmaz:** erken giriş ücreti ve girişte
 * alınan teminat ödemesi; giriş geri alınınca folyo aktörü ikisini de ters
 * kayıtla düşer (ters kayıtları da sayılmaz). **Ön ödeme de sayılmaz:**
 * gelmeden önce alınmıştır, girişten bağımsız olarak rezervasyonundadır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function hasFolioActivity(client, hotelId, reservationId) {
  const [row] = await client.$queryRaw`
    SELECT (
      EXISTS (
        SELECT 1 FROM "FolioItem" i
        WHERE i."hotelId" = ${hotelId} AND i."reservationId" = ${reservationId} AND i."deletedAt" IS NULL
          AND i."source" <> 'EARLY_CHECK_IN'
          AND NOT (
            i."source" = 'REVERSAL'
            AND EXISTS (SELECT 1 FROM "FolioItem" o WHERE o."id" = i."reversalOfId" AND o."source" = 'EARLY_CHECK_IN')
          )
      )
      OR EXISTS (
        SELECT 1 FROM "Payment" pay
        WHERE pay."hotelId" = ${hotelId} AND pay."reservationId" = ${reservationId} AND pay."deletedAt" IS NULL
          AND pay."source" = 'DESK' AND pay."status" <> 'DECLINED'
      )
    ) AS "active"`;
  return Boolean(row?.active);
}
