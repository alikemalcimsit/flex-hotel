import { isCitizenById, kbsExtraFields } from '@hotelos/hotel-contracts';

/**
 * KBS (modül 58) saf yardımcıları: durum rozet tonu, oda metni, girişte kişinin zorunlu ek alanları, ek alanların
 * form ↔ gövde çevirisi. Sorgu / canlı kanal içermez; node testiyle denenir (`kbsFormat.test.js`).
 */

/** KBS ek alanları (belgenin üç alanı ve doğum tarihi dışında; doğum tarihi kimlik alanlarında). */
export const KBS_EXTRA_KEYS = Object.freeze(['gender', 'fatherName', 'motherName', 'birthPlace']);

/** Boş ek alanlar (form başlangıcı). */
export const EMPTY_KBS_EXTRAS = Object.freeze({ gender: '', fatherName: '', motherName: '', birthPlace: '' });

const STATE_TONES = Object.freeze({
  PENDING: 'info',
  SENDING: 'sky',
  SENT: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  MANUAL: 'violet',
});

/** Bildirim durumunun rozet tonu. @param {string | null | undefined} state */
export const kbsStateTone = (state) => STATE_TONES[state] ?? 'neutral';

/**
 * Oda metni: oda değişikliğinde "101 → 103", yoksa oda no ya da "—".
 * @param {{ roomNumber?: string | null, previousRoomNumber?: string | null }} notification
 */
export function kbsRoomText({ roomNumber, previousRoomNumber }) {
  if (previousRoomNumber && roomNumber && previousRoomNumber !== roomNumber) return `${previousRoomNumber} → ${roomNumber}`;
  return roomNumber || '—';
}

/**
 * Girişte bu kişi için KBS'nin zorunlu kıldığı ek alanlar (ayara göre). TC vatandaşı TC kimlikle bildiriliyorsa ve
 * `citizenIdOnly` açıksa ek alan istenmez.
 * @param {{ idType?: string | null, nationality?: string | null }} person
 * @param {{ isEnabled: boolean, citizenIdOnly: boolean, requireGender: boolean, requireBirthDate: boolean, requireParentNames: boolean, requireBirthPlace: boolean } | null | undefined} kbs
 * @returns {string[]}
 */
export function kbsRequiredExtras(person, kbs) {
  if (!kbs?.isEnabled) return [];
  if (kbs.citizenIdOnly && isCitizenById(person)) return [];
  return kbsExtraFields(kbs);
}

/** Sunucudaki kişi → ek alan formu (boşlar ''). @param {Partial<Record<string, string | null>> | null | undefined} person */
export const kbsExtrasForm = (person) => Object.fromEntries(KBS_EXTRA_KEYS.map((key) => [key, person?.[key] ?? '']));

/** Ek alan formu → istek gövdesi (boş bırakılan null). @param {Record<string, string>} form */
export const kbsExtrasBody = (form) => Object.fromEntries(KBS_EXTRA_KEYS.map((key) => [key, String(form?.[key] ?? '').trim() || null]));
