import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import { soldNightSql } from '../rooms/sql.js';

/**
 * Gelir raporlarının SQL'leri (modül 23).
 *
 * Bütün okumalar **salt okunur** işlemde (`SET TRANSACTION READ ONLY`) ve
 * sorgu süre sınırıyla çalışır: rapor ekranı da MCP araçları da (ajan) aynı
 * yoldan geçer; yazma girişimi veritabanında reddedilir, uzun sorgu kesilir.
 * `REPORTING_DATABASE_URL` verilirse ayrı (tercihen yalnızca okuma yetkili)
 * bir veritabanı kullanıcısıyla bağlanılır.
 *
 * Sorgular gün × oda tipi × kaynak × para birimi toplamı döndürür (otel başına
 * en fazla birkaç bin satır); kovalar ve oranlar `rules.js`'te.
 *
 * Index'ler: gece `ReservationNight (hotelId, date)`, işlenen gelir
 * `FolioItem (hotelId, serviceDate)`, arıza `RoomBlock (hotelId, roomId, …)`,
 * kapanmış gün özeti `RevenueDayStat (hotelId, day, …)` (bkz. `stats.js`).
 */

/** Rapor sorgusunun en uzun süresi (ms): bir yıllık aralık için bol. */
export const REPORT_STATEMENT_TIMEOUT_MS = 20_000;
/** İşlemin sorgu süresinin üstündeki payı. */
const TRANSACTION_SLACK_MS = 5_000;

/** @type {PrismaClient | null} */
let reportingClient = null;

/** Rapor bağlantısı: ayrı adres verilmişse onunla, yoksa uygulamanınkiyle. */
function client() {
  const url = process.env.REPORTING_DATABASE_URL;
  if (!url) return prisma;
  reportingClient ??= new PrismaClient({ datasources: { db: { url } }, log: ['warn', 'error'] });
  return reportingClient;
}

/**
 * İşi salt okunur bir işlemde çalıştırır.
 * @template T
 * @param {(tx: Prisma.TransactionClient) => Promise<T>} work
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function readOnly(work, { timeoutMs = REPORT_STATEMENT_TIMEOUT_MS } = {}) {
  try {
    return await client().$transaction(
      async (tx) => {
        // İşlemin ilk ifadesi olmalı: bundan sonra INSERT / UPDATE / DELETE / DDL reddedilir.
        // REPEATABLE READ: işlemdeki bütün sorgular aynı anlık görüntüyü okur (özet turu arada
        // yazsa da özet işareti ile özet satırları ya da canlı satırlar birbirini tutar).
        await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
        return work(tx);
      },
      { timeout: timeoutMs + TRANSACTION_SLACK_MS },
    );
  } catch (error) {
    // Süre sınırı "beklenmeyen hata" değil: kullanıcı (ya da ajan) aralığı daraltabilir.
    if (isStatementTimeout(error)) throw new ReportTimeoutError();
    throw error;
  }
}

/** PostgreSQL `query_canceled` (statement_timeout). */
const STATEMENT_TIMEOUT_PG_CODE = '57014';

/** @param {unknown} error */
function isStatementTimeout(error) {
  const known = /** @type {{ meta?: { code?: string }, message?: string }} */ (error);
  if (String(known?.meta?.code ?? '') === STATEMENT_TIMEOUT_PG_CODE) return true;
  return /canceling statement due to statement timeout/i.test(typeof known?.message === 'string' ? known.message : '');
}

/** Rapor sorgusu süre sınırını aştı (503: geçici; aralık daraltılınca düzelir). */
export class ReportTimeoutError extends AppError {
  constructor() {
    super('Rapor süre sınırı içinde hesaplanamadı. Daha kısa bir tarih aralığıyla tekrar deneyin.', { statusCode: 503, code: 'REPORT_TIMEOUT' });
  }
}

/** Uygulama kapanırken ayrı rapor bağlantısını bırakır. */
export async function disconnectReporting() {
  await reportingClient?.$disconnect();
  reportingClient = null;
}

/**
 * Günlük satılabilir oda: o gece kayıtlı oda − o gece arızalı (envanterden
 * düşen) oda. Bugün ve sonrası için oda planı ve günlük durumla aynı (bugünkü
 * kayıt). Sonradan silinen oda silindiği güne kadar sayılır: tadilatta
 * kaldırılan odanın geçmiş satışı varken geçmiş doluluk %100'ü aşmasın,
 * oda silinince geçen yılın rakamları değişmesin. (Odanın kayıt tarihine
 * bakılmaz: sisteme sonradan girilen otelde geçmiş satış odadan eskidir.)
 *
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} from "YYYY-AA-GG"
 * @param {string} to "YYYY-AA-GG" (dahil)
 * @returns {Promise<Array<{ day: string, rooms: number, outOfOrder: number }>>}
 */
export function loadSellable(tx, hotelId, from, to) {
  return tx.$queryRaw`
    WITH days AS (
      SELECT d::date AS day FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
    ),
    rooms AS (
      SELECT COUNT(*)::int AS total FROM "Room" WHERE "hotelId" = ${hotelId} AND "deletedAt" IS NULL
    ),
    -- Aralıkta ya da sonra silinen odalar (az sayıda): silindikleri güne kadar sayılır.
    removed AS (
      SELECT "deletedAt" FROM "Room" WHERE "hotelId" = ${hotelId} AND "deletedAt" >= ${from}::timestamp
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS "day",
           rooms.total + (SELECT COUNT(*)::int FROM removed WHERE removed."deletedAt" >= days.day + 1) AS "rooms",
           (SELECT COUNT(DISTINCT b."roomId")::int
              FROM "RoomBlock" b
              JOIN "Room" r ON r."id" = b."roomId" AND (r."deletedAt" IS NULL OR r."deletedAt" >= days.day + 1)
             WHERE b."hotelId" = ${hotelId} AND b."deletedAt" IS NULL AND b."type" = 'OUT_OF_ORDER'
               AND date_trunc('day', b."startDate") <= days.day
               AND (b."endDate" IS NULL OR date_trunc('day', b."endDate") > days.day)) AS "outOfOrder"
    FROM days CROSS JOIN rooms
    ORDER BY days.day`;
}

/**
 * Satılan geceler ve rezervasyondaki brüt gece fiyatı: gün × oda tipi ×
 * kaynak × para birimi. Satılan gece tanımı oda planı ve günlük durumla ortak
 * (`soldNightSql`): iş günü ve sonrası eldeki, geçmiş gecede yalnızca
 * gerçekleşen konaklama (gelmeyen misafirin gecesi satılmış sayılmaz).
 *
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} from
 * @param {string} to
 * @param {string} businessDate "YYYY-AA-GG"
 * @returns {Promise<Array<{ day: string, roomTypeId: string, source: string, currency: string, sold: number, gross: Prisma.Decimal }>>}
 */
export function loadNights(tx, hotelId, from, to, businessDate) {
  return tx.$queryRaw`
    SELECT to_char(n."date", 'YYYY-MM-DD') AS "day",
           r."roomTypeId" AS "roomTypeId",
           r."source"::text AS "source",
           r."currency" AS "currency",
           COUNT(*)::int AS "sold",
           SUM(n."amount") AS "gross"
    FROM "ReservationNight" n
    JOIN "Reservation" r ON r."id" = n."reservationId"
    WHERE n."hotelId" = ${hotelId}
      AND r."hotelId" = ${hotelId}
      AND n."date" >= ${from}::timestamp
      AND n."date" < (${to}::date + 1)::timestamp
      AND n."deletedAt" IS NULL
      AND r."deletedAt" IS NULL
      AND ${soldNightSql(Prisma.sql`${businessDate}::timestamp`)}
    GROUP BY 1, 2, 3, 4`;
}

/**
 * Folyoya işlenen gelir (vergiler hariç), hizmet günü × oda tipi × kaynak ×
 * para birimi. Yalnızca iş gününden önceki günler (bugünün gecesi gece
 * çalışmasında işlenir).
 *
 * Sınıflar (iptal kaydı asıl kalemin kaynağıyla sınıflanır, iptal edildiği
 * güne düşer):
 * - `room`: gece oda ücretleri ve fiyat düzeltmeleri (`ROOM_NIGHT`), elle
 *   işlenen oda kalemleri ve oda indirimleri (`MANUAL`, vergi kategorisi oda).
 * - `discounts`: `room` içindeki indirimler (bilgi için ayrıca).
 * - `fees`: erken giriş / geç çıkış ücretleri.
 * - `cancellations`: iptal ve gelmeme (no-show) ücretleri.
 *
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} from
 * @param {string} to
 * @param {string} businessDate
 * @returns {Promise<Array<{ day: string, roomTypeId: string, source: string, currency: string, room: Prisma.Decimal | null, discounts: Prisma.Decimal | null, fees: Prisma.Decimal | null, cancellations: Prisma.Decimal | null }>>}
 */
export function loadPosted(tx, hotelId, from, to, businessDate) {
  return tx.$queryRaw`
    SELECT to_char(i."serviceDate", 'YYYY-MM-DD') AS "day",
           r."roomTypeId" AS "roomTypeId",
           r."source"::text AS "source",
           r."currency" AS "currency",
           SUM(i."netAmount") FILTER (WHERE c.cls = 'ROOM') AS "room",
           SUM(i."netAmount") FILTER (WHERE c.cls = 'ROOM' AND i."type" = 'DISCOUNT') AS "discounts",
           SUM(i."netAmount") FILTER (WHERE c.cls = 'FEE') AS "fees",
           SUM(i."netAmount") FILTER (WHERE c.cls = 'CANCEL') AS "cancellations"
    FROM "FolioItem" i
    LEFT JOIN "FolioItem" o ON o."id" = i."reversalOfId" AND o."hotelId" = ${hotelId}
    JOIN "Reservation" r ON r."id" = i."reservationId"
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(o."source", i."source") = 'ROOM_NIGHT' THEN 'ROOM'
        WHEN COALESCE(o."source", i."source") = 'MANUAL' AND i."taxCategory" = 'ROOM' THEN 'ROOM'
        WHEN COALESCE(o."source", i."source") IN ('EARLY_CHECK_IN', 'LATE_CHECK_OUT') THEN 'FEE'
        WHEN COALESCE(o."source", i."source") IN ('CANCELLATION', 'NO_SHOW') THEN 'CANCEL'
      END AS cls
    ) c
    WHERE i."hotelId" = ${hotelId}
      AND r."hotelId" = ${hotelId}
      AND i."serviceDate" >= ${from}::date
      AND i."serviceDate" <= ${to}::date
      AND i."serviceDate" < ${businessDate}::date
      AND i."deletedAt" IS NULL
      AND c.cls IS NOT NULL
    GROUP BY 1, 2, 3, 4`;
}

/**
 * Oda tipi adları (kırılım etiketleri; silinmişler de — geçmiş satış).
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @returns {Promise<Array<{ id: string, code: string, name: string }>>}
 */
export function loadRoomTypes(tx, hotelId) {
  return tx.$queryRaw`SELECT "id", "code", "name" FROM "RoomType" WHERE "hotelId" = ${hotelId}`;
}

/**
 * Oda kalemine uygulanan dahil vergi oranları (eldeki gelirden ayrılır).
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @returns {Promise<Array<{ rate: Prisma.Decimal, isIncluded: boolean, appliesTo: string[] }>>}
 */
export function loadTaxes(tx, hotelId) {
  return tx.$queryRaw`
    SELECT "rate", "isIncluded", "appliesTo"
    FROM "Tax"
    WHERE "hotelId" = ${hotelId} AND "deletedAt" IS NULL`;
}

/**
 * Otelin en eski satış / gelir günü (özetin geriye gideceği sınır).
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @returns {Promise<string | null>} "YYYY-AA-GG"
 */
export async function loadEarliestDay(tx, hotelId) {
  const [row] = await tx.$queryRaw`
    SELECT to_char(LEAST(
      (SELECT MIN("date") FROM "ReservationNight" WHERE "hotelId" = ${hotelId}),
      (SELECT MIN("serviceDate")::timestamp FROM "FolioItem" WHERE "hotelId" = ${hotelId})
    ), 'YYYY-MM-DD') AS "day"`;
  return row?.day ?? null;
}

/**
 * Özeti hesaplanmış günler.
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} from
 * @param {string} to
 * @returns {Promise<Set<string>>}
 */
export async function loadStatDays(tx, hotelId, from, to) {
  const rows = await tx.$queryRaw`
    SELECT to_char("day", 'YYYY-MM-DD') AS "day" FROM "RevenueStatDay"
    WHERE "hotelId" = ${hotelId} AND "day" >= ${from}::date AND "day" <= ${to}::date`;
  return new Set(rows.map((row) => row.day));
}

/**
 * Özet satırları (gün × oda tipi × kaynak × para birimi).
 * @param {Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} from
 * @param {string} to
 * @returns {Promise<Array<{ day: string, roomTypeId: string, source: string, currency: string, sold: number, room: Prisma.Decimal, discounts: Prisma.Decimal, fees: Prisma.Decimal, cancellations: Prisma.Decimal }>>}
 */
export function loadStats(tx, hotelId, from, to) {
  return tx.$queryRaw`
    SELECT to_char("day", 'YYYY-MM-DD') AS "day", "roomTypeId", "source"::text AS "source", "currency", "sold",
           "roomRevenue" AS "room", "discounts", "fees", "cancellations"
    FROM "RevenueDayStat"
    WHERE "hotelId" = ${hotelId} AND "day" >= ${from}::date AND "day" <= ${to}::date`;
}
