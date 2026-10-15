import { Prisma } from '@prisma/client';
import { MAX_STAY_NIGHTS } from '@hotelos/hotel-contracts';
import { INVENTORY_CONSUMING_STATUSES, STAYED_STATUSES } from '../rooms/rules.js';

/**
 * Acente priminin üretim sorguları (modül 35) — ham SQL, set tabanlı.
 *
 * ### Tanımlar (gelir raporuyla ortak)
 *
 * - **Gerçekleşen gece:** kuralın dönemine düşen, iş gününden önceki
 *   (`n.date < iş günü`) ve rezervasyonu konaklamış (`STAYED_STATUSES`:
 *   içeride / çıkmış) gece. İptal, gelmeyen ve henüz gelmemiş misafirin
 *   gecesi sayılmaz.
 * - **Vergisiz oda geliri:** folyoya işlenen oda kalemlerinin vergisiz tutarı
 *   (`netAmount`): gece oda ücretleri ve düzeltmeleri (`ROOM_NIGHT`), elle
 *   işlenen oda kalemleri / indirimleri (`MANUAL` + vergi kategorisi oda). Ters
 *   kayıt **asıl kalemin hizmet gününe** yazılır: dönemin gecesi dönem
 *   bittikten sonra iptal edilse de o dönemin cirosundan düşer (üretim
 *   tanımı; gelir raporu ters kaydı iptal günü gösterir).
 * - **Eldeki gece:** dönemin iş günü ve sonrasındaki, envanter tüketen
 *   (bekleyen / onaylı / içeride) rezervasyonun gecesi; tutarı rezervasyondaki
 *   gece fiyatıdır (vergiler dahil — çağıran ayırır).
 *
 * Rezervasyon süzgeci: acente, oda tipi süzgeci (boşsa hepsi), dönemle kesişen
 * konaklama. Giriş günü alt sınırı (`dönem başı − en uzun konaklama`) acente
 * index'inin (`Reservation_agency_stay_idx`: otel, acente, giriş) aralık
 * taramasına oturur; geçmişin tamamı taranmaz.
 *
 * ### Saat dilimi
 *
 * Tarihler metin olarak verilir ve SQL'de `::date` ile çevrilir; gece ve
 * hizmet günü kolonları saat dilimsiz olduğundan oturumun saat dilimi
 * sonuca karışmaz (bkz. `lib/sql-time.js`).
 */

/**
 * Sabit durum listesi → SQL değer listesi (yalnızca koddaki sabitler).
 * @param {readonly string[]} values
 */
function statusList(values) {
  for (const value of values) if (!/^[A-Z_]+$/.test(value)) throw new Error(`Geçersiz durum: ${value}`);
  return Prisma.raw(values.map((value) => `'${value}'`).join(', '));
}

const STAYED = statusList(STAYED_STATUSES);
const ON_THE_BOOKS = statusList(INVENTORY_CONSUMING_STATUSES);
const STAY_SPAN = Prisma.raw(String(MAX_STAY_NIGHTS));

/**
 * Kural tanımı (kayıtlı kural ya da formdaki önizleme).
 * @typedef {{ id: string, agencyId: string, startDate: string, endDate: string, roomTypeIds: string[] }} ProductionSpec
 */

/**
 * Kuralın rezervasyon süzgeci: `ru` takma adlı kural satırına bağlı `r`.
 * Durum koşulu çağırana bırakılır (gerçekleşen / eldeki farklı).
 */
const reservationJoin = (hotelId) => Prisma.sql`
  r."hotelId" = ${hotelId}
  AND r."agencyId" = ru."agencyId"
  AND r."deletedAt" IS NULL
  AND r."checkIn" >= (ru."startDate" - ${STAY_SPAN})::timestamp
  AND r."checkIn" < (ru."endDate" + 1)::timestamp
  AND r."checkOut" > ru."startDate"::timestamp
  AND (cardinality(ru."roomTypeIds") = 0 OR r."roomTypeId" = ANY(ru."roomTypeIds"))`;

/** Oda geliri sınıfı (gelir raporuyla aynı): `i` kalem, `o` ters kaydın asıl kalemi. */
const ROOM_CLASS = Prisma.sql`(
  COALESCE(o."source", i."source") = 'ROOM_NIGHT'
  OR (COALESCE(o."source", i."source") = 'MANUAL' AND i."taxCategory" = 'ROOM'))`;

/**
 * Kurallar SQL'e tek JSON parametresiyle gider (kayıtlı ya da kaydedilmemiş).
 * @param {ProductionSpec[]} specs
 */
const rulesSource = (specs) => Prisma.sql`
  jsonb_to_recordset(${JSON.stringify(
    specs.map((spec) => ({ id: spec.id, agencyId: spec.agencyId, startDate: spec.startDate, endDate: spec.endDate, roomTypeIds: spec.roomTypeIds ?? [] })),
  )}::jsonb) AS ru("id" text, "agencyId" text, "startDate" date, "endDate" date, "roomTypeIds" text[])`;

/**
 * Kural başına üretim toplamları: gerçekleşen gece, vergisiz oda geliri ve
 * (istenirse) eldeki gece / brüt tutar. Tek sorgu, kural sayısından bağımsız
 * (N+1 yok): ilerleme işi otelin bütün yürürlükteki kurallarını, liste
 * sayfası yalnızca sayfadakileri verir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {ProductionSpec[]} specs
 * @param {string} businessDate "YYYY-AA-GG"
 * @param {{ onTheBooks?: boolean }} [options]
 * @returns {Promise<Map<string, { nights: number, revenue: string, onBooksNights: number, onBooksGross: string }>>}
 */
export async function loadProductionTotals(client, hotelId, specs, businessDate, { onTheBooks = false } = {}) {
  if (specs.length === 0) return new Map();
  const otb = onTheBooks
    ? Prisma.sql`,
      booked AS (
        SELECT ru."id" AS "ruleId", count(*)::int AS "nights", COALESCE(sum(n."amount"), 0) AS "gross"
        FROM rules ru
        JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${ON_THE_BOOKS})
        JOIN "ReservationNight" n ON n."reservationId" = r."id"
        WHERE n."deletedAt" IS NULL
          AND n."date" >= GREATEST(ru."startDate", ${businessDate}::date)::timestamp
          AND n."date" < (ru."endDate" + 1)::timestamp
        GROUP BY ru."id")`
    : Prisma.empty;

  const rows = await client.$queryRaw`
    WITH rules AS (SELECT * FROM ${rulesSource(specs)}),
    stayed AS (
      SELECT ru."id" AS "ruleId", count(*)::int AS "nights"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
      JOIN "ReservationNight" n ON n."reservationId" = r."id"
      WHERE n."deletedAt" IS NULL
        AND n."date" >= ru."startDate"::timestamp
        AND n."date" < (ru."endDate" + 1)::timestamp
        AND n."date" < ${businessDate}::date::timestamp
      GROUP BY ru."id"
    ),
    posted AS (
      SELECT ru."id" AS "ruleId", COALESCE(sum(i."netAmount"), 0) AS "revenue"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
      JOIN "FolioItem" i ON i."reservationId" = r."id" AND i."hotelId" = ${hotelId} AND i."deletedAt" IS NULL
      LEFT JOIN "FolioItem" o ON o."id" = i."reversalOfId" AND o."hotelId" = ${hotelId}
      WHERE ${ROOM_CLASS}
        AND COALESCE(o."serviceDate", i."serviceDate") >= ru."startDate"
        AND COALESCE(o."serviceDate", i."serviceDate") <= ru."endDate"
        AND COALESCE(o."serviceDate", i."serviceDate") < ${businessDate}::date
      GROUP BY ru."id"
    )${otb}
    SELECT ru."id" AS "ruleId",
           COALESCE(stayed."nights", 0)::int AS "nights",
           COALESCE(posted."revenue", 0)::text AS "revenue"
           ${onTheBooks ? Prisma.sql`, COALESCE(booked."nights", 0)::int AS "onBooksNights", COALESCE(booked."gross", 0)::text AS "onBooksGross"` : Prisma.empty}
    FROM rules ru
    LEFT JOIN stayed ON stayed."ruleId" = ru."id"
    LEFT JOIN posted ON posted."ruleId" = ru."id"
    ${onTheBooks ? Prisma.sql`LEFT JOIN booked ON booked."ruleId" = ru."id"` : Prisma.empty}`;

  return new Map(
    /** @type {any[]} */ (rows).map((row) => [
      row.ruleId,
      { nights: row.nights, revenue: row.revenue, onBooksNights: row.onBooksNights ?? 0, onBooksGross: row.onBooksGross ?? '0' },
    ]),
  );
}

/**
 * Hak edişin rezervasyon dökümünü **veritabanının içinde** yazar: dönemdeki
 * gerçekleşen gece ve vergisiz oda geliri, rezervasyon başına. Geliri olup
 * gecesi olmayan satır da yazılır (ör. dönemin ilk günü çıkışta işlenen oda
 * indirimi): ciro onunla tutar.
 *
 * Satırlar uygulamaya taşınıp geri yazılmaz (`INSERT … SELECT`): büyük tur
 * operatörünün bir yıllık dökümü (on binlerce satır) tek ifadede yazılır.
 * Toplamlar çağıranın yazdıktan sonraki tek toplama sorgusundan gelir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {ProductionSpec} spec
 * @param {string} businessDate
 * @returns {Promise<number>} yazılan satır
 */
export function insertProductionLines(client, hotelId, bonusId, spec, businessDate) {
  return client.$executeRaw`
    INSERT INTO "AgencyBonusLine" ("id", "hotelId", "bonusId", "reservationId", "nights", "revenue")
    SELECT gen_random_uuid()::text, ${hotelId}, ${bonusId}, lines."reservationId", lines."nights", lines."revenue"
    FROM (${productionLinesSql(hotelId, spec, businessDate)}) AS lines`;
}

/**
 * Yazılmış dökümün toplamları (gece, ciro, satır).
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} bonusId
 * @returns {Promise<{ nights: number, revenue: string, lines: number }>}
 */
export async function sumProductionLines(client, bonusId) {
  const [row] = await client.$queryRaw`
    SELECT COALESCE(sum("nights"), 0)::int AS "nights", COALESCE(sum("revenue"), 0)::text AS "revenue", count(*)::int AS "lines"
    FROM "AgencyBonusLine"
    WHERE "bonusId" = ${bonusId}`;
  return row;
}

/**
 * Döküm sorgusu (rezervasyon başına gece ve ciro).
 * @param {string} hotelId
 * @param {ProductionSpec} spec
 * @param {string} businessDate
 */
function productionLinesSql(hotelId, spec, businessDate) {
  return Prisma.sql`
    WITH rules AS (SELECT * FROM ${rulesSource([spec])}),
    stays AS (
      SELECT r."id"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
    ),
    stayed AS (
      SELECT n."reservationId" AS "id", count(*)::int AS "nights"
      FROM stays s
      CROSS JOIN rules ru
      JOIN "ReservationNight" n ON n."reservationId" = s."id"
      WHERE n."deletedAt" IS NULL
        AND n."date" >= ru."startDate"::timestamp
        AND n."date" < (ru."endDate" + 1)::timestamp
        AND n."date" < ${businessDate}::date::timestamp
      GROUP BY n."reservationId"
    ),
    posted AS (
      SELECT i."reservationId" AS "id", sum(i."netAmount") AS "revenue"
      FROM stays s
      CROSS JOIN rules ru
      JOIN "FolioItem" i ON i."reservationId" = s."id" AND i."hotelId" = ${hotelId} AND i."deletedAt" IS NULL
      LEFT JOIN "FolioItem" o ON o."id" = i."reversalOfId" AND o."hotelId" = ${hotelId}
      WHERE ${ROOM_CLASS}
        AND COALESCE(o."serviceDate", i."serviceDate") >= ru."startDate"
        AND COALESCE(o."serviceDate", i."serviceDate") <= ru."endDate"
        AND COALESCE(o."serviceDate", i."serviceDate") < ${businessDate}::date
      GROUP BY i."reservationId"
    )
    SELECT COALESCE(stayed."id", posted."id") AS "reservationId",
           COALESCE(stayed."nights", 0)::int AS "nights",
           COALESCE(posted."revenue", 0) AS "revenue"
    FROM stayed
    FULL JOIN posted ON posted."id" = stayed."id"
    WHERE COALESCE(stayed."nights", 0) > 0 OR COALESCE(posted."revenue", 0) <> 0`;
}

/**
 * Gerçekleşmiş ama oda ücreti folyoya hiç işlenmemiş geceler (ücretli gece;
 * ikram gece işlenmez). Ciro eksik olabilir: hak edişte uyarı olarak görünür.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {ProductionSpec} spec
 * @param {string} businessDate
 * @returns {Promise<number>}
 */
export async function countMissingPostings(client, hotelId, spec, businessDate) {
  const [row] = await client.$queryRaw`
    WITH rules AS (SELECT * FROM ${rulesSource([spec])})
    SELECT count(*)::int AS "missing"
    FROM rules ru
    JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
    JOIN "ReservationNight" n ON n."reservationId" = r."id"
    WHERE n."deletedAt" IS NULL
      AND n."amount" > 0
      AND n."date" >= ru."startDate"::timestamp
      AND n."date" < (ru."endDate" + 1)::timestamp
      AND n."date" < ${businessDate}::date::timestamp
      AND NOT EXISTS (
        SELECT 1 FROM "FolioItem" i
        WHERE i."reservationId" = n."reservationId"
          AND i."source" = 'ROOM_NIGHT'
          AND i."serviceDate" = n."date"::date
          AND i."reversalOfId" IS NULL
          AND i."deletedAt" IS NULL)`;
  return row?.missing ?? 0;
}

/**
 * Aylık kırılım (kural ekranındaki grafik): her ay gerçekleşen gece, vergisiz
 * oda geliri, eldeki gece ve eldeki brüt tutar.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {ProductionSpec} spec
 * @param {string} businessDate
 * @returns {Promise<Array<{ month: string, nights: number, revenue: string, onBooksNights: number, onBooksGross: string }>>}
 */
export function loadMonthlyProduction(client, hotelId, spec, businessDate) {
  return client.$queryRaw`
    WITH rules AS (SELECT * FROM ${rulesSource([spec])}),
    stayed AS (
      SELECT to_char(n."date", 'YYYY-MM') AS "month", count(*)::int AS "nights"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
      JOIN "ReservationNight" n ON n."reservationId" = r."id"
      WHERE n."deletedAt" IS NULL
        AND n."date" >= ru."startDate"::timestamp
        AND n."date" < (ru."endDate" + 1)::timestamp
        AND n."date" < ${businessDate}::date::timestamp
      GROUP BY 1
    ),
    posted AS (
      SELECT to_char(COALESCE(o."serviceDate", i."serviceDate"), 'YYYY-MM') AS "month", sum(i."netAmount") AS "revenue"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${STAYED})
      JOIN "FolioItem" i ON i."reservationId" = r."id" AND i."hotelId" = ${hotelId} AND i."deletedAt" IS NULL
      LEFT JOIN "FolioItem" o ON o."id" = i."reversalOfId" AND o."hotelId" = ${hotelId}
      WHERE ${ROOM_CLASS}
        AND COALESCE(o."serviceDate", i."serviceDate") >= ru."startDate"
        AND COALESCE(o."serviceDate", i."serviceDate") <= ru."endDate"
        AND COALESCE(o."serviceDate", i."serviceDate") < ${businessDate}::date
      GROUP BY 1
    ),
    booked AS (
      SELECT to_char(n."date", 'YYYY-MM') AS "month", count(*)::int AS "nights", sum(n."amount") AS "gross"
      FROM rules ru
      JOIN "Reservation" r ON ${reservationJoin(hotelId)} AND r."status" IN (${ON_THE_BOOKS})
      JOIN "ReservationNight" n ON n."reservationId" = r."id"
      WHERE n."deletedAt" IS NULL
        AND n."date" >= GREATEST(ru."startDate", ${businessDate}::date)::timestamp
        AND n."date" < (ru."endDate" + 1)::timestamp
      GROUP BY 1
    ),
    months AS (SELECT "month" FROM stayed UNION SELECT "month" FROM posted UNION SELECT "month" FROM booked)
    SELECT m."month",
           COALESCE(stayed."nights", 0)::int AS "nights",
           COALESCE(posted."revenue", 0)::text AS "revenue",
           COALESCE(booked."nights", 0)::int AS "onBooksNights",
           COALESCE(booked."gross", 0)::text AS "onBooksGross"
    FROM months m
    LEFT JOIN stayed ON stayed."month" = m."month"
    LEFT JOIN posted ON posted."month" = m."month"
    LEFT JOIN booked ON booked."month" = m."month"
    ORDER BY m."month"`;
}
