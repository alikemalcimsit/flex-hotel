import { toIsoDay } from '@hotelos/core';
import { normalizeIdNumber, verifyMrzIdentity } from '@hotelos/hotel-contracts';
import { ValidationError } from './errors.js';

/**
 * "Kimlikten okundu" işareti (modül 59) — misafir kartının kimliğini yazan her yer (giriş, refakatçi, CRM kartı)
 * buradan geçer.
 *
 * - Belge okuması geldiyse: MRZ sunucuda yeniden ayrıştırılır ve sağlanır; yazılacak kimlik okunanla aynı değilse
 *   istek reddedilir (personel okunanı değiştirdiyse okumayı kaldırıp elle girmeli). Tutarsa işaret yazılır.
 * - Okuma yoksa ve kimlik değişiyorsa işaret silinir (artık elle girilmiş bir kimlik).
 * - Kimlik aynı kalıyorsa işarete dokunulmaz.
 *
 * MRZ metni hiçbir yere yazılmaz (denetim izine de).
 */

/** @param {Date | string | null | undefined} value */
const dayOf = (value) => (value ? (value instanceof Date ? toIsoDay(value) : String(value).slice(0, 10)) : null);

/**
 * @typedef {{ idType?: string | null, idNumber?: string | null, nationality?: string | null, birthDate?: Date | string | null }} IdentityLike
 */

/** @param {IdentityLike | null | undefined} a @param {IdentityLike | null | undefined} b */
export function sameIdentity(a, b) {
  return (
    (a?.idType ?? null) === (b?.idType ?? null) &&
    (normalizeIdNumber(a?.idNumber) || null) === (normalizeIdNumber(b?.idNumber) || null) &&
    (a?.nationality ?? null) === (b?.nationality ?? null) &&
    dayOf(a?.birthDate) === dayOf(b?.birthDate)
  );
}

/**
 * Kartın okuma alanları (`Guest.idReadAt / idReadBy / idReadVia`) için yazılacak değerler.
 *
 * @param {{
 *   current: IdentityLike | null,
 *   next: IdentityLike,
 *   documentRead?: { mrz: string, via: 'STAFF_SCAN' | 'ONLINE_PHOTO' } | null,
 *   today: string,
 *   actor: string,
 *   now: Date,
 *   field: string,
 * }} args `next` kaydedilecek kimlik (boş bırakılan doğum tarihi yerine kayıtlı olan), `field` hata yolu
 * @returns {{ idReadAt?: Date | null, idReadBy?: string | null, idReadVia?: string | null }}
 */
export function identityReadFields({ current, next, documentRead, today, actor, now, field }) {
  if (documentRead) {
    const result = verifyMrzIdentity(
      documentRead.mrz,
      { idType: next.idType ?? null, idNumber: next.idNumber ?? null, nationality: next.nationality ?? null, birthDate: dayOf(next.birthDate) },
      { today },
    );
    if (!result.ok) throw new ValidationError(result.reason, { field });
    return { idReadAt: now, idReadBy: actor, idReadVia: documentRead.via };
  }
  if (current && sameIdentity(current, next)) return {};
  return { idReadAt: null, idReadBy: null, idReadVia: null };
}
