/**
 * Büyük tablolarda serbest metin araması.
 *
 * ### Neden ayrı yardımcı
 *
 * Prisma, `OR` içindeki ilişki filtresini ("misafirin adı şunu içeriyor")
 * her koşul için ayrı bir birleştirmeyle yazar; PostgreSQL de bu hâlde
 * tablonun tamamını birleştirip sonra süzer. 1,5 milyon bildirimde bir arama
 * dört saniye sürüyordu.
 *
 * Burada ilişkili kayıtlar **önce** kendi trigram index'leriyle bulunur
 * (misafir adı, onay kodu, oda numarası), liste sorgusu da bu kimliklerle
 * süzülür (`guestId IN (...)`). Metin alanlarının `ILIKE` araması da trigram
 * index'e oturur (`pg_trgm`, migration `20260919090000_scale_indexes`).
 *
 * ### Kısa kelime
 *
 * Trigram en az üç harf ister; iki harflik bir kelime milyonlarca satırı
 * tarardı. Kısa kelimeler yalnızca birebir eşleşen alanlarda (oda numarası)
 * aranır.
 */

/** Aramada dikkate alınan en fazla kelime. */
export const MAX_SEARCH_TOKENS = 3;

/** Metin içinde aranacak kelimenin en kısa uzunluğu. */
export const MIN_FUZZY_TOKEN_LENGTH = 3;

/**
 * Önceden bulunan ilişkili kayıt sayısının üst sınırı. Çok genel bir kelime
 * ("Ahmet") binlerce misafire uyar; liste zaten ilk sayfayı gösterir.
 */
const RELATED_MATCH_LIMIT = 500;

/** @param {string | undefined | null} search */
export function searchTokens(search) {
  return String(search ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
}

/** @param {string} token */
export const isFuzzyToken = (token) => token.length >= MIN_FUZZY_TOKEN_LENGTH;

/** @param {string} token */
export const containsText = (token) => ({ contains: token, mode: 'insensitive' });

/**
 * Adı ya da soyadı kelimeyi içeren misafirler.
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {string} token
 * @returns {Promise<string[]>}
 */
export async function matchGuestIds(client, hotelId, token) {
  const rows = await client.guest.findMany({
    where: { hotelId, OR: [{ firstName: containsText(token) }, { lastName: containsText(token) }] },
    select: { id: true },
    // Sıra açık yazılır: yazılmazsa Prisma kimliğe göre sıralar ve PostgreSQL
    // trigram index'i yerine bütün tabloyu kimlik sırasıyla tarar.
    orderBy: { updatedAt: 'desc' },
    take: RELATED_MATCH_LIMIT,
  });
  return rows.map((row) => row.id);
}

/**
 * Onay kodu kelimeyi içeren rezervasyonlar.
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {string} token
 * @param {object} [where] ek koşul (ör. pencere)
 * @returns {Promise<string[]>}
 */
export async function matchReservationIdsByCode(client, hotelId, token, where = {}) {
  const rows = await client.reservation.findMany({
    where: { hotelId, confirmationCode: containsText(token), ...where },
    select: { id: true },
    orderBy: { checkIn: 'desc' },
    take: RELATED_MATCH_LIMIT,
  });
  return rows.map((row) => row.id);
}

/**
 * Numarası birebir kelime olan odalar.
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 * @param {string} token
 * @returns {Promise<string[]>}
 */
export async function matchRoomIdsByNumber(client, hotelId, token) {
  const rows = await client.room.findMany({ where: { hotelId, number: token }, select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Hiçbir kayda uymayan koşul: kelimenin arandığı alan kalmadıysa liste boş döner.
 */
export const MATCH_NOTHING = Object.freeze({ id: { in: [] } });
