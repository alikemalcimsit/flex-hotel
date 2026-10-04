import { Prisma } from '@prisma/client';
import { INVENTORY_CONSUMING_STATUSES, STAYED_STATUSES } from './rules.js';

/**
 * Oda / gece tanımlarının ham SQL karşılıkları. Kurallar `rules.js`'te; burada
 * yalnızca aynı kuralın sorgu hali (iki yer ayrışmasın diye listeler oradan).
 */

/** Sabit durum listesi → SQL değer listesi (yalnızca koddaki sabitler; dışarıdan girdi değil). */
function statusList(values) {
  for (const value of values) if (!/^[A-Z_]+$/.test(value)) throw new Error(`Geçersiz durum: ${value}`);
  return Prisma.raw(values.map((value) => `'${value}'`).join(', '));
}

const ON_THE_BOOKS = statusList(INVENTORY_CONSUMING_STATUSES);
const STAYED = statusList(STAYED_STATUSES);

/**
 * `countsSoldNight`'ın SQL karşılığı: gece satılmış (dolu) mu. Sorguda
 * takma adlar `r` = "Reservation", `n` = "ReservationNight" olmalı.
 *
 * @param {Prisma.Sql} businessDay iş gününün başlangıcı (`timestamp`), ör. `sqlTimestamp(businessDate)`
 * @returns {Prisma.Sql}
 */
export function soldNightSql(businessDay) {
  return Prisma.sql`(
    (n."date" >= ${businessDay} AND r."status" IN (${ON_THE_BOOKS}))
    OR (n."date" < ${businessDay} AND r."status" IN (${STAYED})))`;
}
