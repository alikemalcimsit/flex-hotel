import { Prisma } from '@prisma/client';
import { guestImportRowSchema, internationalPhone } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { PHONE_MATCH_DIGITS, normalizeEmail, phoneMatchKey, phoneMatchScore } from '../messaging/rules.js';
import { storablePhone } from '../reservations/guests.js';

/**
 * Misafir listesi içe aktarma (modül 26). Sistemde aynı kişi (belge no, e-posta ya da telefon) varsa satır **atlanır**
 * ve raporlanır — mevcut karta dokunulmaz (kullanıcı kararı); dosyada tekrarlanan kişi bir kez açılır.
 *
 * Eşleşme rezervasyondaki misafir aramasıyla aynı kuralla: e-posta küçük harf (`normalizeEmail`), telefon son
 * `PHONE_MATCH_DIGITS` hane anahtarıyla aday bulunur ve `phoneMatchScore` ile doğrulanır ("0532…" = "+90 532…").
 */

/** @param {{ firstName: string, lastName: string }} guest */
const nameOf = (guest) => `${guest.firstName} ${guest.lastName}`;

/** Satırın dosya içi eşleşme anahtarları. @param {{ idNumber: string | null, email: string | null, international: string | null }} row */
const keysOf = (row) => [row.idNumber && `id:${row.idNumber}`, row.email && `email:${row.email}`, row.international && `phone:${row.international}`].filter(Boolean);
const KEY_LABELS = Object.freeze({ id: 'belge no', email: 'e-posta', phone: 'telefon' });

/**
 * Sistemdeki aday kartlar (belge no, e-posta ya da telefonun son haneleri).
 * @param {string} hotelId @param {any[]} rows
 */
async function existingCandidates(hotelId, rows) {
  const ids = [...new Set(rows.map((row) => row.idNumber).filter(Boolean))];
  const emails = [...new Set(rows.map((row) => row.email).filter(Boolean))];
  const phoneKeys = [...new Set(rows.map((row) => row.international && phoneMatchKey(row.international)).filter(Boolean))];
  if (ids.length + emails.length + phoneKeys.length === 0) return [];
  // Telefon ifadesi `Guest_phone_match_idx` ile birebir aynı (sayı sabit yazılır).
  return prisma.$queryRaw`
    SELECT "firstName", "lastName", "idNumber", lower("email") AS "email", "phone" FROM "Guest"
    WHERE "hotelId" = ${hotelId} AND "deletedAt" IS NULL
      AND ("idNumber" = ANY(${ids}::text[])
        OR lower("email") = ANY(${emails}::text[])
        OR ("phone" IS NOT NULL AND right(regexp_replace("phone", '[^0-9]', '', 'g'), ${Prisma.raw(String(PHONE_MATCH_DIGITS))}) = ANY(${phoneKeys}::text[])))`;
}

/**
 * Satırları denetler: hata, mevcut kart (atla), dosyada tekrar (atla), yazılacak.
 * @param {string} hotelId @param {Array<Record<string, unknown>>} rows
 */
export async function checkGuests(hotelId, rows) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { phoneCountryCode: true } });
  const countryCode = hotel.phoneCountryCode;
  const parsed = rows.map((raw) => {
    const result = guestImportRowSchema.safeParse(raw);
    if (!result.success) return { errors: result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ''), message: issue.message })) };
    const { phone, email } = result.data;
    const data = {
      ...result.data,
      email: email ? (normalizeEmail(email) ?? email) : null,
      phone: phone ? storablePhone(phone, countryCode) : null,
      international: phone ? internationalPhone(phone, countryCode) : null,
    };
    return { data };
  });

  const candidates = await existingCandidates(hotelId, parsed.filter((entry) => entry.data).map((entry) => entry.data));
  /** Satırın eşleştiği mevcut kart ve neyle eşleştiği. @param {any} row */
  const existingMatch = (row) => {
    for (const guest of candidates) {
      if (row.idNumber && guest.idNumber === row.idNumber) return { guest, by: 'id' };
      if (row.email && guest.email === row.email) return { guest, by: 'email' };
      if (row.international && guest.phone && phoneMatchScore(guest.phone, row.international, countryCode) > 0) return { guest, by: 'phone' };
    }
    return null;
  };

  const seen = new Map();
  return parsed.map((entry, index) => {
    if (!entry.data) return { index, status: 'ERROR', errors: dedupeErrors(entry.errors), note: null, preview: null, data: null };
    const row = entry.data;
    const preview = { name: nameOf(row), phone: row.phone, email: row.email, nationality: row.nationality };
    const match = existingMatch(row);
    if (match) return { index, status: 'SKIP', errors: [], note: `Zaten kayıtlı: ${nameOf(match.guest)} (${KEY_LABELS[match.by]} eşleşti)`, preview, data: null };
    const keys = keysOf(row);
    const repeat = keys.find((key) => seen.has(key));
    if (repeat) return { index, status: 'SKIP', errors: [], note: `Dosyada ${seen.get(repeat) + 2}. satırda zaten var`, preview, data: null };
    for (const key of keys) seen.set(key, index);
    return { index, status: 'OK', errors: [], note: null, preview, data: row };
  });
}

/** Aynı alana birden çok mesaj gelirse ilki. @param {{ field: string, message: string }[]} errors */
export function dedupeErrors(errors) {
  const fields = new Set();
  return errors.filter((error) => !fields.has(error.field) && fields.add(error.field));
}

/**
 * Yazılacak satırlar → misafir kartları.
 * @param {any} tx @param {string} hotelId @param {any[]} rows `checkGuests` OK satırlarının verisi
 */
export async function writeGuests(tx, hotelId, rows) {
  const result = await tx.guest.createMany({
    data: rows.map((row) => ({
      hotelId,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      nationality: row.nationality,
      idType: row.idType ?? (row.idNumber ? 'OTHER' : null),
      idNumber: row.idNumber,
      birthDate: row.birthDate ? new Date(`${row.birthDate}T00:00:00.000Z`) : null,
      notes: row.notes,
      tags: row.tags,
    })),
  });
  return result.count;
}
