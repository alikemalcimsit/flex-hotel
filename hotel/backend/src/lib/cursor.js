import { ValidationError } from './errors.js';

/**
 * İmleçli sayfalama (zaman + kimlik).
 *
 * Milyonlara çıkabilen, sürekli yeni kayıt eklenen listelerde (konuşmalar,
 * bildirim geçmişi, personel uyarıları) sayfa numarası yerine "şu kayıttan
 * daha eskisi" istenir: yeni kayıt gelip liste kaysa bile aynı satır iki kez
 * görünmez, derin sayfada `OFFSET` yavaşlaması olmaz.
 */

const CURSOR_SEPARATOR = '|';

/**
 * @param {{ at: Date, id: string }} position sıralama anahtarı (zaman + kimlik)
 * @returns {string}
 */
export function encodeCursor({ at, id }) {
  return Buffer.from(`${at.toISOString()}${CURSOR_SEPARATOR}${id}`, 'utf8').toString('base64url');
}

/**
 * Bozuk ya da elle değiştirilmiş imleç `null` döner; çağıran bunu doğrulama
 * hatasına çevirir (500 değil).
 *
 * @param {string | undefined | null} value
 * @returns {{ at: Date, id: string } | null}
 */
export function decodeCursor(value) {
  if (!value) return null;
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0) return null;
  const at = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/**
 * "Bu konumdan daha eski" filtresi — (zaman, kimlik) azalan sırası için.
 * Aynı milisaniyede yazılmış iki kayıt kimlikle ayrılır.
 *
 * Baştaki `zaman <= imleç` koşulu mantıken gereksiz ama şart: PostgreSQL
 * yalnızca `OR` görünce index taramasını imleçten başlatamıyor, 10 000.
 * kayıttaki sayfa için önceki 10 000 kaydı baştan okuyordu (sayfa numarasıyla
 * aynı yavaşlık). Bu koşul taramayı doğrudan imlecin olduğu yere götürür.
 *
 * @param {string} timeField
 * @param {{ at: Date, id: string }} cursor
 */
export function olderThan(timeField, cursor) {
  return {
    AND: [
      { [timeField]: { lte: cursor.at } },
      { OR: [{ [timeField]: { lt: cursor.at } }, { [timeField]: cursor.at, id: { lt: cursor.id } }] },
    ],
  };
}

/**
 * "Bu konumdan daha yeni" — (zaman, kimlik) artan sırası için. Bekleyenler
 * eskiden yeniye listelenir: en uzun bekleyen en üstte. `>=` koşulu index
 * taramasını imleçten başlatır (bkz. `olderThan`).
 *
 * @param {string} timeField
 * @param {{ at: Date, id: string }} cursor
 */
export function newerThan(timeField, cursor) {
  return {
    AND: [
      { [timeField]: { gte: cursor.at } },
      { OR: [{ [timeField]: { gt: cursor.at } }, { [timeField]: cursor.at, id: { gt: cursor.id } }] },
    ],
  };
}

/**
 * Sorgu dizesindeki imleci çözer; bozuksa doğrulama hatası (500 değil).
 *
 * @param {string | undefined} raw
 * @param {string} field
 * @returns {{ at: Date, id: string } | null}
 */
export function parseCursor(raw, field = 'cursor') {
  if (!raw) return null;
  const cursor = decodeCursor(raw);
  if (!cursor) throw new ValidationError('Sayfalama imleci geçersiz; listeyi yenileyin.', { field });
  return cursor;
}
