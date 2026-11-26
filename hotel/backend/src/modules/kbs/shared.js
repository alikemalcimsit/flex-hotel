import { maskIdNumber, kbsMissingFields, kbsMissingText } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * KBS'nin ortak parçaları (modül 58): ayar (satır yoksa kapalı ve varsayılanlar), kişinin bildirim kimliği, girişte zorunlu alan
 * denetimi. Parola hiçbir görünüme girmez (`hasPassword`).
 */

export { prisma };

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);

/** Kişinin KBS'nin istediği alanları (kart seçimi). */
export const KBS_PERSON_SELECT = Object.freeze({
  id: true,
  firstName: true,
  lastName: true,
  idType: true,
  idNumber: true,
  nationality: true,
  birthDate: true,
  gender: true,
  birthPlace: true,
  fatherName: true,
  motherName: true,
});

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 */
export async function loadKbsSettings(client, hotelId) {
  const row = await client.kbsSettings.findUnique({ where: { hotelId } });
  return {
    isEnabled: row?.isEnabled ?? false,
    provider: row?.provider ?? 'TEST',
    facilityCode: row?.facilityCode ?? null,
    username: row?.username ?? null,
    passwordSealed: row?.passwordSealed ?? null,
    sendCheckOut: row?.sendCheckOut ?? true,
    sendRoomChange: row?.sendRoomChange ?? true,
    requireGender: row?.requireGender ?? true,
    requireBirthDate: row?.requireBirthDate ?? true,
    requireParentNames: row?.requireParentNames ?? false,
    requireBirthPlace: row?.requireBirthPlace ?? false,
    citizenIdOnly: row?.citizenIdOnly ?? true,
    testBehavior: row?.testBehavior ?? 'ACCEPT',
    isDefault: !row,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

/** Ekrana giden ayar (parola yok). @param {Awaited<ReturnType<typeof loadKbsSettings>>} settings */
export function settingsView(settings) {
  const { passwordSealed, ...rest } = settings;
  return { ...rest, hasPassword: Boolean(passwordSealed) };
}

/** @param {{ firstName: string, lastName: string }} person */
export const fullName = (person) => `${person.firstName} ${person.lastName}`.trim();

/** Ekran için maskeli belge özeti. @param {{ idType?: string | null, idNumber?: string | null }} person */
export const documentMasked = (person) => (person.idNumber ? maskIdNumber(person.idNumber) : null);

/**
 * Girişte KBS zorunlu alanları: KBS açıkken rezervasyon sahibi ve belgeli yetişkin refakatçiler ayarın istediği alanlarla girilmeli.
 * @param {Awaited<ReturnType<typeof loadKbsSettings>>} settings
 * @param {Array<{ path: string, name: string, person: any }>} people `path`: formdaki alan öneki ("guest", "companions.0")
 */
export function assertKbsFields(settings, people) {
  if (!settings.isEnabled) return;
  /** @type {Record<string, string>} */
  const fields = {};
  const problems = [];
  for (const { path, name, person } of people) {
    const missing = kbsMissingFields(person, settings);
    if (missing.length === 0) continue;
    problems.push(`${name}: ${kbsMissingText(missing)}`);
    for (const field of missing) fields[`${path}.${field}`] = 'KBS bildirimi için zorunlu';
  }
  if (problems.length > 0) throw new ValidationError(`KBS bildirimi için eksik bilgi — ${problems.join('; ')}`, { fields });
}
