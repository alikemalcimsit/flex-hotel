import { toIsoDay, toMoneyString } from '@hotelos/core';
import { SPA_DEFAULT_SETTINGS, spaTimeOfMinute, utcToZonedWallTime, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ValidationError } from '../../lib/errors.js';
import { getActiveTaxes, getHotelSettings } from '../settings/service.js';

export { prisma };

/**
 * Spa ve spor salonu (modül 57) — servislerin ortak parçaları: biçimler, ayar, saat çevirimi, numara serisi, satır
 * kilitleri.
 *
 * **Kilit sırası:** seans → randevu → rezervasyon (odaya yazarken yalnız okunur; folyoya kalemi aktör yazar).
 * Terapist / oda satırı kilitlenmez: çakışmayı `SpaHold`'un EXCLUDE kısıtı keser.
 */

/** Zamanlanmış işin ve olay dinleyicilerinin işlem kaydındaki adı. */
export const SPA_SYSTEM_ACTOR = 'sistem · spa';
/** Misafirin portaldan yaptığı işlemin işlem kaydındaki adı. */
export const SPA_GUEST_ACTOR = 'misafir · portal';

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
export const money = (value) => toMoneyString(String(value ?? 0));
/** "YYYY-AA-GG" → @db.Date değeri. @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);

const MINUTE_MS = 60_000;
export const minutesAfter = (value, minutes) => new Date(value.getTime() + minutes * MINUTE_MS);

/**
 * Otelin saat dilimi, para birimi, vergileri ve şimdinin otel saatindeki günü (iş günü = otelin takvim günü).
 * @param {string} hotelId @param {Date} [now]
 */
export async function spaContext(hotelId, now = new Date()) {
  const [hotel, taxes] = await Promise.all([getHotelSettings(hotelId), getActiveTaxes(hotelId)]);
  const wall = /** @type {string} */ (utcToZonedWallTime(now, hotel.timezone));
  return { hotel, timezone: hotel.timezone, currency: hotel.currency, taxes, now, today: wall.slice(0, 10), wallNow: wall };
}

/**
 * Otel saatindeki duvar saati → gerçek an. Geçersizse alan hatası.
 * @param {string} wall "YYYY-MM-DDTHH:mm" @param {string} timezone @param {string} [field]
 */
export function wallToUtc(wall, timezone, field = 'startsAt') {
  const value = zonedWallTimeToUtc(wall, timezone);
  if (!value) throw new ValidationError('Gün ve saat geçersiz', { field });
  return value;
}

/** Gerçek an → otel saatindeki gün ve saat. @param {Date} value @param {string} timezone */
export function wallParts(value, timezone) {
  const wall = /** @type {string} */ (utcToZonedWallTime(value, timezone));
  return { wall, day: wall.slice(0, 10), time: wall.slice(11, 16), minute: Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16)) };
}

/** Otelin yerel gününün başladığı ve bittiği an (UTC). @param {string} localDay @param {string} timezone */
export function dayBounds(localDay, timezone) {
  const start = /** @type {Date} */ (zonedWallTimeToUtc(`${localDay}T00:00`, timezone));
  const next = new Date(Date.parse(`${localDay}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const end = /** @type {Date} */ (zonedWallTimeToUtc(`${next}T00:00`, timezone));
  return { start, end };
}

/**
 * Spa ayarı (satır yoksa sözleşmedeki varsayılanlar; `updatedAt` boş — ilk kayıt iyimser kilitsiz).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 */
export async function loadSpaSettings(client, hotelId) {
  const row = await client.spaSettings.findUnique({ where: { hotelId } });
  const source = row ?? SPA_DEFAULT_SETTINGS;
  return {
    openMinute: source.openMinute,
    closeMinute: source.closeMinute,
    slotMinutes: source.slotMinutes,
    freeCancelHours: source.freeCancelHours,
    lateCancelFeePct: money(source.lateCancelFeePct),
    noShowFeePct: money(source.noShowFeePct),
    portalEnabled: source.portalEnabled,
    portalLeadMinutes: source.portalLeadMinutes,
    portalMaxActive: source.portalMaxActive,
    reminderHours: source.reminderHours,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

/** @param {Awaited<ReturnType<typeof loadSpaSettings>>} settings */
export const settingsView = (settings) => ({ ...settings, openTime: spaTimeOfMinute(settings.openMinute), closeTime: spaTimeOfMinute(settings.closeMinute) });

/**
 * Sıradaki randevu numarası (otel × yıl): tek ifadede artırılır, kilit gerekmez.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {number} year
 */
export async function nextSpaCode(tx, hotelId, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "SpaSequence" ("hotelId", "year", "last") VALUES (${hotelId}, ${year}, 1)
    ON CONFLICT ("hotelId", "year") DO UPDATE SET "last" = "SpaSequence"."last" + 1
    RETURNING "last"`;
  return `SPA-${year}-${String(row.last).padStart(5, '0')}`;
}

/**
 * Satır kilidi (`FOR UPDATE`), kimlik sırasıyla. Bu tablolarda soft-delete yok.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {'SpaAppointment' | 'SpaSession'} table
 * @param {string} hotelId @param {string[]} ids @returns {Promise<Set<string>>}
 */
async function lockRows(tx, table, hotelId, ids) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  if (!unique.length) return new Set();
  // Tablo adı yalnız bu dosyadaki sabitlerden gelir; değerler parametreli.
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::text[]) AND "hotelId" = $2 ORDER BY id FOR UPDATE`, unique, hotelId);
  return new Set(/** @type {Array<{ id: string }>} */ (rows).map((row) => row.id));
}

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string[]} ids */
export const lockSpaAppointments = (tx, hotelId, ids) => lockRows(tx, 'SpaAppointment', hotelId, ids);
/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string[]} ids */
export const lockSpaSessions = (tx, hotelId, ids) => lockRows(tx, 'SpaSession', hotelId, ids);

/** Misafirin adı soyadı. @param {{ firstName?: string | null, lastName?: string | null } | null | undefined} guest */
export const fullName = (guest) => [guest?.firstName, guest?.lastName].filter(Boolean).join(' ').trim() || null;

/** İyimser kilit: istemcinin gördüğü sürüm satırınkiyle aynı mı? @param {Date} actual @param {Date} expected */
export const sameVersion = (actual, expected) => actual.getTime() === expected.getTime();
