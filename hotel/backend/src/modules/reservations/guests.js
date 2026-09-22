import { Prisma } from '@prisma/client';
import { GUEST_SEARCH_LIMIT, internationalPhone } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { containsText, isFuzzyToken, searchTokens } from '../../lib/search.js';
import { normalizeEmail, PHONE_MATCH_DIGITS, phoneMatchKey, phoneMatchScore } from '../messaging/rules.js';
import { sameGuestName } from './rules.js';

/**
 * Rezervasyonun misafir tarafı (modül 4): arama ve "yeni mi, var olan mı".
 *
 * Misafir kartı bir kez açılır ve yıllarca birikir (CRM, modül 22). Aynı
 * kişi için ikinci kart açmak geçmişi böler; yanlış karta bağlamak ise
 * başkasının geçmişini miras bırakır. Kural:
 *
 * - Telefon ya da e-posta bir kartla eşleşiyor **ve** ad soyad aynıysa o kart
 *   kullanılır (sessizce).
 * - Eşleşiyor ama ad farklıysa (aile, şirket telefonu) personele sorulur
 *   (`GUEST_MATCH`, aday kartlarla); personel var olanı seçer ya da "yine de
 *   yeni kart" der (`forceNewGuest`).
 * - Eşleşme yoksa yeni kart açılır.
 *
 * Telefon eşleşmesi mesajlaşma modülünün kuralıyla aynıdır (`phoneMatchScore`):
 * kartta ülke kodsuz yazılmış numara otelin ülke koduyla tamamlanır.
 */

/** Telefonun son rakamlarıyla bulunan en fazla aday kart. */
const PHONE_CANDIDATES_LIMIT = 20;
/** Eşleşme çakışmasında personele gösterilen en fazla kart. */
const MATCH_CANDIDATES_SHOWN = 5;

const GUEST_SELECT = Object.freeze({
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  nationality: true,
});

/** @param {{ firstName: string, lastName: string }} guest */
export const guestFullName = (guest) => `${guest.firstName} ${guest.lastName}`.trim();

/**
 * Telefonu kayıt biçimine çevirir: ülke koduyla, başında "+". Çözülemeyen
 * numara (kısa, yabancı biçim) yazıldığı gibi saklanır.
 *
 * @param {string | null | undefined} phone
 * @param {string} countryCode
 */
export function storablePhone(phone, countryCode) {
  if (!phone) return null;
  const international = internationalPhone(phone, countryCode);
  return international ? `+${international}` : phone.trim();
}

/**
 * Telefonu ya da e-postası tutan kartlar (en yeni önce).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {{ phone?: string | null, email?: string | null }} contact
 * @param {string} countryCode
 */
export async function findGuestsByContact(client, hotelId, { phone, email }, countryCode) {
  const found = new Map();
  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (normalizedEmail) {
    // İfade `Guest_hotelId_email_lower_idx` ile birebir aynı.
    const rows = await client.$queryRaw`
      SELECT "id", "firstName", "lastName", "phone", "email", "nationality" FROM "Guest"
      WHERE "hotelId" = ${hotelId} AND "email" IS NOT NULL AND "deletedAt" IS NULL AND lower("email") = ${normalizedEmail}
      ORDER BY "updatedAt" DESC
      LIMIT ${PHONE_CANDIDATES_LIMIT}`;
    for (const row of rows) found.set(row.id, row);
  }
  const international = phone ? internationalPhone(phone, countryCode) : null;
  const key = international ? phoneMatchKey(international) : null;
  if (key) {
    // İfade `Guest_phone_match_idx` ile birebir aynı (sayı sabit yazılır).
    const rows = await client.$queryRaw`
      SELECT "id", "firstName", "lastName", "phone", "email", "nationality" FROM "Guest"
      WHERE "hotelId" = ${hotelId} AND "phone" IS NOT NULL AND "deletedAt" IS NULL
        AND right(regexp_replace("phone", '[^0-9]', '', 'g'), ${Prisma.raw(String(PHONE_MATCH_DIGITS))}) = ${key}
      ORDER BY "updatedAt" DESC
      LIMIT ${PHONE_CANDIDATES_LIMIT}`;
    for (const row of rows) {
      if (phoneMatchScore(row.phone, international, countryCode) > 0) found.set(row.id, row);
    }
  }
  return [...found.values()];
}

/**
 * Rezervasyonun misafirini belirler; gerekirse kart açar (çağıranın
 * transaction'ında).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ guestId?: string | null, guest?: { firstName: string, lastName: string, phone?: string | null, email?: string | null, nationality?: string | null } | null, forceNewGuest?: boolean }} input
 * @param {{ phoneCountryCode: string }} hotel
 * @returns {Promise<{ guest: { id: string, firstName: string, lastName: string }, created: boolean }>}
 */
export async function resolveGuest(tx, hotelId, input, hotel) {
  if (input.guestId) {
    const guest = await tx.guest.findFirst({ where: { id: input.guestId, hotelId }, select: GUEST_SELECT });
    if (!guest) throw new NotFoundError('Seçilen misafir kartı bulunamadı');
    return { guest, created: false };
  }

  const data = input.guest;
  const candidates = await findGuestsByContact(tx, hotelId, data, hotel.phoneCountryCode);
  const same = candidates.find((candidate) => sameGuestName(candidate, data));
  if (same) return { guest: same, created: false };

  if (candidates.length > 0 && !input.forceNewGuest) {
    throw new ConflictError(
      'Bu telefon ya da e-posta başka ada kayıtlı bir misafir kartında var. Aynı kişiyse o kartı seçin; ' +
        'farklı kişiyse (aile, şirket telefonu) yeni kart açmayı onaylayın.',
      'GUEST_MATCH',
      { candidates: candidates.slice(0, MATCH_CANDIDATES_SHOWN).map(toGuestDto) },
    );
  }

  const created = await tx.guest.create({
    data: {
      hotelId,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: storablePhone(data.phone, hotel.phoneCountryCode),
      email: data.email ? normalizeEmail(data.email) ?? data.email : null,
      nationality: data.nationality ?? null,
    },
    select: GUEST_SELECT,
  });
  await recordAudit(tx, { hotelId, entity: 'Guest', entityId: created.id, action: 'CREATE', after: toGuestDto(created) });
  return { guest: created, created: true };
}

/** @param {{ id: string, firstName: string, lastName: string, phone: string | null, email: string | null, nationality?: string | null }} row */
export function toGuestDto(row) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    name: guestFullName(row),
    phone: row.phone,
    email: row.email,
    nationality: row.nationality ?? null,
  };
}

/**
 * Formdaki misafir araması: ad soyad (trigram), telefon (son rakamlar) ya da
 * e-posta. Her kartın son konaklaması ve toplam konaklama sayısı tek sorguda
 * gelir (kart başına ayrı sorgu yok).
 *
 * @param {string} hotelId
 * @param {string} query en az 2 karakter
 * @param {{ phoneCountryCode: string }} hotel
 */
export async function searchGuests(hotelId, query, hotel) {
  const text = query.trim();
  const digits = text.replace(/\D/g, '');
  let rows;

  if (text.includes('@')) {
    // Tam adres (ifade index'i). Adresin bir parçasıyla arama index'e oturmaz;
    // büyük misafir tablosunda her tuşta tabloyu taramak istemiyoruz.
    rows = (await findGuestsByContact(prisma, hotelId, { email: text }, hotel.phoneCountryCode)).slice(0, GUEST_SEARCH_LIMIT);
  } else if (digits.length >= PHONE_MATCH_DIGITS && digits.length >= text.replace(/[\s()+-]/g, '').length) {
    rows = (await findGuestsByContact(prisma, hotelId, { phone: text }, hotel.phoneCountryCode)).slice(0, GUEST_SEARCH_LIMIT);
  } else {
    // Her kelime ad ya da soyadda geçmeli ("ayşe yıl" → Ayşe Yılmaz). Üç
    // harften kısa kelime trigram index'ine oturmaz; aramaya katılmaz.
    const tokens = searchTokens(text).filter(isFuzzyToken);
    if (tokens.length === 0) return [];
    rows = await prisma.guest.findMany({
      where: {
        hotelId,
        AND: tokens.map((token) => ({ OR: [{ firstName: containsText(token) }, { lastName: containsText(token) }] })),
      },
      select: GUEST_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: GUEST_SEARCH_LIMIT,
    });
  }
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  // Kart başına son konaklama ve konaklama sayısı: tek sorgu
  // (`Reservation_hotelId_guestId_checkIn_idx`).
  const stays = await prisma.$queryRaw`
    SELECT DISTINCT ON (r."guestId") r."guestId", r."checkIn", r."checkOut", r."status"::text AS "status",
           r."confirmationCode", count(*) OVER (PARTITION BY r."guestId") AS "stayCount"
    FROM "Reservation" r
    WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL AND r."guestId" = ANY(${ids}::text[])
    ORDER BY r."guestId", r."checkIn" DESC`;
  const byGuest = new Map(stays.map((row) => [row.guestId, row]));

  return rows.map((row) => {
    const stay = byGuest.get(row.id);
    return {
      ...toGuestDto(row),
      stayCount: stay ? Number(stay.stayCount) : 0,
      lastStay: stay
        ? {
            checkIn: stay.checkIn.toISOString(),
            checkOut: stay.checkOut.toISOString(),
            status: stay.status,
            confirmationCode: stay.confirmationCode,
          }
        : null,
    };
  });
}
