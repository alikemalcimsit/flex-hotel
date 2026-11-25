import { foldMrzName, mrzIdentity, sameMrzName } from '@hotelos/hotel-contracts';

/**
 * Kimlik taramasının saf kısmı (modül 59): okunanla kayıttakinin karşılaştırılması, personelin alan alan seçimi
 * ve "kimlikten okundu" iddiasının geçerliliği. Ekranlar (giriş, refakatçi, misafir kartı) aynı kuralı kullanır;
 * sunucu da aynı alanları MRZ'ye göre yeniden denetler.
 */

/** Karşılaştırılan alanlar (sıra ekrandaki sıradır). */
export const SCAN_FIELDS = Object.freeze(['lastName', 'firstName', 'idType', 'idNumber', 'nationality', 'birthDate']);
/** "Kimlikten okundu" işaretinin dayandığı alanlar: hepsi okunandan alınmalı. */
export const IDENTITY_KEYS = Object.freeze(['idType', 'idNumber', 'nationality', 'birthDate']);

const blank = (value) => value === undefined || value === null || value === '';
const norm = (value) => (blank(value) ? '' : String(value).trim().toLocaleUpperCase('tr'));

/**
 * @typedef {{ firstName?: string, lastName?: string, idType?: string, idNumber?: string, nationality?: string, birthDate?: string }} PersonValues
 * @typedef {{ key: string, current: string, read: string, same: boolean, choice: 'read' | 'current' }} ScanRow
 */

/**
 * Okunan MRZ ile kayıttaki (formdaki) değerleri karşılaştırır.
 *
 * - Kimlik alanları (tür, numara, uyruk, doğum tarihi) sağlama haneleriyle doğrulanır: varsayılan belgedeki.
 * - Adın sağlaması yoktur ve OCR adı bozabilir (dolgu '<' iki ad arasında "<L" okunur): kayıtta ad varsa
 *   varsayılan kayıttaki, fark işaretlenir, personel belgedekini seçer. Kayıt boşsa (yeni refakatçi) belgedeki.
 *   Türkçe harf farkı fark sayılmaz (MRZ'de Ç/Ş/Ğ/İ/Ö/Ü yoktur — "Öztürk" "Ozturk"a dönmesin).
 *
 * @param {PersonValues} current
 * @param {import('@hotelos/hotel-contracts').ParsedMrz} mrz
 * @returns {ScanRow[]}
 */
export function compareScan(current, mrz) {
  const read = mrzIdentity(mrz);
  const sameName = Boolean(current.firstName && current.lastName && sameMrzName({ firstName: current.firstName, lastName: current.lastName }, mrz));
  return SCAN_FIELDS.map((key) => {
    const currentValue = blank(current[key]) ? '' : String(current[key]);
    const readValue = blank(read[key]) ? '' : String(read[key]);
    const isName = key === 'firstName' || key === 'lastName';
    // Ad alanı tek başına da Türkçe harf farkı yok sayılarak karşılaştırılır (soyad aynı, ad farklı olabilir).
    const same = isName ? sameName || (Boolean(readValue) && foldMrzName(currentValue) === foldMrzName(readValue)) : norm(currentValue) === norm(readValue);
    // Okunan boşsa (ör. uyruk tanınmadı) kayıttaki kalır.
    const choice = isName ? (currentValue || !readValue ? 'current' : 'read') : readValue ? 'read' : 'current';
    return { key, current: currentValue, read: readValue, same, choice };
  });
}

/**
 * Seçimi uygular: kişinin yeni değerleri ve okuma iddiası. Kimlik alanlarından biri bile kayıttakinden seçildiyse
 * (ve okunandan farklıysa) kimlik "elle girilmiş" sayılır — okuma gönderilmez, sunucu da kabul etmezdi.
 *
 * @param {ScanRow[]} rows
 * @param {string} mrzText okunan satırlar (sunucuya gider)
 * @param {'STAFF_SCAN' | 'ONLINE_PHOTO'} via
 * @returns {{ values: PersonValues, documentRead: { mrz: string, via: string } | null, nameChanged: boolean }}
 */
export function applyScan(rows, mrzText, via) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const row of rows) values[row.key] = row.choice === 'read' ? row.read : row.current;
  const identityFromDocument = rows
    .filter((row) => IDENTITY_KEYS.includes(row.key))
    .every((row) => row.choice === 'read' || norm(row.current) === norm(row.read));
  const nameChanged = rows.some((row) => (row.key === 'firstName' || row.key === 'lastName') && row.choice === 'read' && !row.same);
  return { values, documentRead: identityFromDocument ? { mrz: mrzText, via } : null, nameChanged };
}

/**
 * Formdaki kimlik hâlâ okunanla aynı mı? Personel okumadan sonra bir alanı elle değiştirirse okuma düşer.
 * @param {PersonValues} identity formdaki kimlik @param {PersonValues | null} snapshot okumadan sonra yazılan
 */
export function stillFromDocument(identity, snapshot) {
  if (!snapshot) return false;
  return IDENTITY_KEYS.every((key) => norm(identity[key]) === norm(snapshot[key]));
}

/**
 * Doğum tarihine göre (otelin bugünü) reşit değil mi? Refakatçi formunda "çocuk" önerisi için.
 * @param {string | null | undefined} birthDate @param {string} today @param {number} [adultAge]
 */
export function isMinor(birthDate, today, adultAge = 18) {
  if (!birthDate || !today) return false;
  const [y, m, d] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age < adultAge;
}
