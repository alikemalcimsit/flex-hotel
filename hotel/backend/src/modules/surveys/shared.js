import { createHmac, timingSafeEqual } from 'node:crypto';
import { SURVEY_DEFAULT_SETTINGS, SURVEY_PATH, utcToZonedWallTime, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { resolveJwtSecret } from '../../lib/http-security.js';
import { getHotelSettings } from '../settings/service.js';

export { prisma };

/**
 * Anket ve memnuniyet (modül 55) — ortak yardımcılar.
 *
 * Bağlantı: `/misafir/a/<davet kimliği>.<imza>`. İmza sunucunun JWT sırrından **anket bağlamıyla** türetilen anahtarla
 * (portal 53 ve oda servisi 41'den ayrı) davet kimliği + rastgele değerin HMAC'i; sabit zamanlı karşılaştırılır.
 */

/** Zamanlanmış işin işlem kaydındaki adı. */
export const SURVEY_SYSTEM_ACTOR = 'sistem · anket';

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);

/**
 * Anket ayarı (satır yoksa varsayılanlar; `updatedAt` boş — ilk kayıt iyimser kilitsiz).
 * @param {any} client @param {string} hotelId
 */
export async function loadSurveySettings(client, hotelId) {
  const row = await client.surveySettings.findUnique({ where: { hotelId } });
  if (row) return row;
  return { hotelId, ...SURVEY_DEFAULT_SETTINGS, updatedBy: null, updatedAt: null };
}

/**
 * Otelin saat dilimi ve şimdinin otel saatindeki günü / saati (anket gerçek saate göre gider; gece kapanışına bağlı değil).
 * @param {string} hotelId @param {Date} [now]
 */
export async function surveyClock(hotelId, now = new Date()) {
  const hotel = await getHotelSettings(hotelId);
  const wall = /** @type {string} */ (utcToZonedWallTime(now, hotel.timezone));
  return { hotel, timezone: hotel.timezone, today: wall.slice(0, 10), hour: Number(wall.slice(11, 13)), now };
}

/**
 * Otelin yerel gününün başladığı an (UTC).
 * @param {string} day "YYYY-MM-DD" @param {string} timezone
 */
export const dayStart = (day, timezone) => /** @type {Date} */ (zonedWallTimeToUtc(`${day}T00:00`, timezone));

/**
 * Bir anın otel saatindeki günü.
 * @param {Date} value @param {string} timezone
 */
export const localDay = (value, timezone) => /** @type {string} */ (utcToZonedWallTime(value, timezone)).slice(0, 10);

/** Misafirin adı + soyadının baş harfi ("Ayşe Y."). @param {{ firstName?: string | null, lastName?: string | null } | null | undefined} guest */
export const shortGuestName = (guest) => {
  const first = guest?.firstName?.trim() ?? '';
  const last = guest?.lastName?.trim() ?? '';
  return [first, last ? `${last[0]}.` : ''].filter(Boolean).join(' ') || null;
};

/** @param {{ firstName?: string | null, lastName?: string | null } | null | undefined} guest */
export const fullGuestName = (guest) => [guest?.firstName, guest?.lastName].filter(Boolean).join(' ').trim() || null;

/* ══════════════════ İmzalı bağlantı ══════════════════ */

let signingKey = null;
function linkKey() {
  signingKey ??= createHmac('sha256', resolveJwtSecret({ warn: () => {} })).update('hotelos:survey-link:v1').digest();
  return signingKey;
}

/** @param {string} invitationId @param {string} nonce */
const signature = (invitationId, nonce) => createHmac('sha256', linkKey()).update(`${invitationId}.${nonce}`).digest('base64url');

/** @param {{ id: string, nonce: string }} invitation */
export const surveyToken = (invitation) => `${invitation.id}.${signature(invitation.id, invitation.nonce)}`;
/** @param {{ id: string, nonce: string }} invitation */
export const surveyPath = (invitation) => `${SURVEY_PATH}/${surveyToken(invitation)}`;

/**
 * Belirtecin imzası doğru mu (sabit zamanlı). Davet satırı çağıranın okuduğu.
 * @param {{ id: string, nonce: string }} invitation @param {string} given imza kısmı
 */
export function signatureMatches(invitation, given) {
  const expected = Buffer.from(signature(invitation.id, invitation.nonce));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Bağlantının tam adresi: taban misafir portalı ayarındaki adres (otelin herkese açık adresi); yoksa yalnız yol.
 * @param {string | null | undefined} base @param {string} path
 */
export const absoluteUrl = (base, path) => (base ? `${base.replace(/\/+$/, '')}${path}` : null);

/** Otelin herkese açık adresi (misafir portalı ayarı). @param {string} hotelId */
export async function publicBaseUrl(hotelId) {
  const row = await prisma.guestPortalSettings.findUnique({ where: { hotelId }, select: { publicBaseUrl: true } });
  return row?.publicBaseUrl ?? null;
}
