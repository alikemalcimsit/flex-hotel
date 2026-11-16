import { Prisma } from '@prisma/client';
import { DESIGNER_COLUMNS } from '@hotelos/hotel-contracts';

/**
 * Rapor tasarımcısının kaynak kataloğu (modül 26): her kaynağın FROM / JOIN'i, taban koşulu ve sütunların SQL ifadesi.
 *
 * **Güvenlik:** SQL metni yalnız bu dosyadaki sabitlerden gelir; kullanıcı yalnız sütun anahtarı seçer (sözleşmedeki
 * katalogla doğrulanmış) ve değer yazar (değerler her zaman parametre). Anahtarın ifadesi burada yoksa sorgu kurulmaz.
 * Otelin saat dilimi de parametre olarak geçer (kayıt anı → otelin günü).
 *
 * Tarih sütunları günde (`date`), ay sütunları "YYYY-AA" metni; durum / tür sütunları kod olarak seçilir (etiketi
 * çıktıda sözleşmeden konur).
 */

const raw = Prisma.raw;

/** Kayıt anının otel günü. @param {string} column @param {string} timezone */
const localDay = (column, timezone) => Prisma.sql`(${raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date`;
/** Kayıt anının otel ayı. @param {string} column @param {string} timezone */
const localMonth = (column, timezone) => Prisma.sql`to_char(${raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM')`;
const fixed = (sql) => () => raw(sql);
const voided = (alias) => fixed(`CASE WHEN ${alias}."voidedAt" IS NULL THEN 'ACTIVE' ELSE 'VOIDED' END`);

/**
 * @typedef {{
 *   from: string,
 *   hotelColumn: string,
 *   where: string,
 *   columns: Record<string, (context: { timezone: string }) => Prisma.Sql>,
 * }} SourceSql
 */

/** @type {Record<string, SourceSql>} */
const SOURCES = {
  RESERVATIONS: {
    from: `"Reservation" r
      JOIN "Guest" g ON g."id" = r."guestId"
      JOIN "RoomType" rt ON rt."id" = r."roomTypeId"
      LEFT JOIN "Room" rm ON rm."id" = r."roomId"
      LEFT JOIN "Agency" ag ON ag."id" = r."agencyId"`,
    hotelColumn: 'r."hotelId"',
    where: 'r."deletedAt" IS NULL',
    columns: {
      confirmationCode: fixed('r."confirmationCode"'),
      status: fixed('r."status"::text'),
      source: fixed('r."source"::text'),
      guestName: fixed(`(g."firstName" || ' ' || g."lastName")`),
      roomTypeName: fixed('rt."name"'),
      roomNumber: fixed('rm."number"'),
      agencyName: fixed('ag."name"'),
      boardType: fixed('r."boardType"::text'),
      checkIn: fixed('r."checkIn"::date'),
      checkOut: fixed('r."checkOut"::date'),
      checkInMonth: fixed(`to_char(r."checkIn", 'YYYY-MM')`),
      nights: fixed('(r."checkOut"::date - r."checkIn"::date)'),
      adults: fixed('r."adults"'),
      children: fixed('r."children"'),
      totalPrice: fixed('r."totalPrice"'),
      discountTotal: fixed('r."discountTotal"'),
      currency: fixed('r."currency"'),
      createdAt: ({ timezone }) => localDay('r."createdAt"', timezone),
      createdMonth: ({ timezone }) => localMonth('r."createdAt"', timezone),
      cancelledAt: ({ timezone }) => localDay('r."cancelledAt"', timezone),
      cancellationFee: fixed('r."cancellationFee"'),
    },
  },
  FOLIO_ITEMS: {
    from: `"FolioItem" fi
      JOIN "Folio" f ON f."id" = fi."folioId"
      JOIN "Guest" g ON g."id" = f."guestId"
      JOIN "Reservation" r ON r."id" = fi."reservationId"
      LEFT JOIN "Room" rm ON rm."id" = r."roomId"`,
    hotelColumn: 'fi."hotelId"',
    where: 'fi."deletedAt" IS NULL',
    columns: {
      serviceDate: fixed('fi."serviceDate"'),
      serviceMonth: fixed(`to_char(fi."serviceDate", 'YYYY-MM')`),
      type: fixed('fi."type"::text'),
      source: fixed('fi."source"::text'),
      description: fixed('fi."description"'),
      quantity: fixed('fi."quantity"'),
      netAmount: fixed('fi."netAmount"'),
      taxAmount: fixed('fi."taxAmount"'),
      total: fixed('fi."total"'),
      state: voided('fi'),
      guestName: fixed(`(g."firstName" || ' ' || g."lastName")`),
      confirmationCode: fixed('r."confirmationCode"'),
      roomNumber: fixed('rm."number"'),
      currency: fixed('f."currency"'),
      postedBy: fixed('fi."postedBy"'),
    },
  },
  GUESTS: {
    from: '"Guest" g',
    hotelColumn: 'g."hotelId"',
    where: 'g."deletedAt" IS NULL',
    columns: {
      firstName: fixed('g."firstName"'),
      lastName: fixed('g."lastName"'),
      nationality: fixed('g."nationality"'),
      phone: fixed('g."phone"'),
      email: fixed('g."email"'),
      idType: fixed('g."idType"::text'),
      birthDate: fixed('g."birthDate"::date'),
      tags: fixed(`array_to_string(g."tags", ', ')`),
      stayCount: fixed(`(SELECT count(*) FROM "Reservation" s WHERE s."guestId" = g."id" AND s."deletedAt" IS NULL AND s."status" IN ('CHECKED_IN', 'CHECKED_OUT'))::int`),
      lastStay: fixed(`(SELECT max(s."checkOut")::date FROM "Reservation" s WHERE s."guestId" = g."id" AND s."deletedAt" IS NULL AND s."status" = 'CHECKED_OUT')`),
      createdAt: ({ timezone }) => localDay('g."createdAt"', timezone),
      createdMonth: ({ timezone }) => localMonth('g."createdAt"', timezone),
    },
  },
  PAYMENTS: {
    from: `"Payment" p
      JOIN "Folio" f ON f."id" = p."folioId"
      JOIN "Guest" g ON g."id" = f."guestId"
      JOIN "Reservation" r ON r."id" = p."reservationId"`,
    hotelColumn: 'p."hotelId"',
    where: 'p."deletedAt" IS NULL',
    columns: {
      businessDate: fixed('p."businessDate"'),
      businessMonth: fixed(`to_char(p."businessDate", 'YYYY-MM')`),
      kind: fixed('p."kind"::text'),
      status: fixed('p."status"::text'),
      method: fixed('p."method"::text'),
      source: fixed('p."source"::text'),
      amount: fixed('p."amount"'),
      currency: fixed('p."currency"'),
      folioAmount: fixed('p."folioAmount"'),
      state: voided('p'),
      guestName: fixed(`(g."firstName" || ' ' || g."lastName")`),
      confirmationCode: fixed('r."confirmationCode"'),
      reference: fixed('p."reference"'),
      receivedBy: fixed('p."receivedBy"'),
    },
  },
};

// Sözleşmedeki her sütunun burada ifadesi olmalı (katalog ile SQL ayrışmasın — modül yüklenirken denetlenir).
for (const [source, columns] of Object.entries(DESIGNER_COLUMNS)) {
  for (const column of columns) {
    if (!SOURCES[source]?.columns[column.key]) throw new Error(`Rapor tasarımcısı: ${source}.${column.key} için SQL ifadesi yok`);
  }
}

/**
 * Kaynağın SQL parçaları.
 * @param {string} source
 */
export function sourceSql(source) {
  const sql = SOURCES[source];
  if (!sql) throw new Error(`Bilinmeyen kaynak: ${source}`);
  return sql;
}

/**
 * Sütunun SQL ifadesi.
 * @param {string} source @param {string} key @param {{ timezone: string }} context
 * @returns {Prisma.Sql}
 */
export function columnSql(source, key, context) {
  const expression = SOURCES[source]?.columns[key];
  if (!expression) throw new Error(`Bilinmeyen sütun: ${source}.${key}`);
  return expression(context);
}
