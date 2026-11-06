import { toIsoDay } from '@hotelos/core';
import { GUEST_PORTAL_DEFAULT_SETTINGS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { getHotelSettings } from '../settings/service.js';

export { prisma };

/** Sistemin (zamanlanmış işin) işlem kaydındaki adı. */
export const PORTAL_SYSTEM_ACTOR = 'sistem · misafir portalı';

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);

/**
 * Portal ayarı (satır yoksa varsayılanlar; `updatedAt` boş — ilk kayıt iyimser kilitsiz).
 * @param {any} client @param {string} hotelId
 */
export async function loadPortalSettings(client, hotelId) {
  const row = await client.guestPortalSettings.findUnique({ where: { hotelId } });
  if (row) return row;
  return { hotelId, ...GUEST_PORTAL_DEFAULT_SETTINGS, publicBaseUrl: null, texts: {}, updatedBy: null, updatedAt: null };
}

/**
 * Otelin portal için gereken bilgisi ve bugünü (gün metni).
 * @param {string} hotelId
 */
export async function portalContext(hotelId) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  return { hotel, today: toIsoDay(businessDate), businessDate };
}

/**
 * Bağlantının tam adresi (taban ayarda; yoksa yalnız yol).
 * @param {string | null | undefined} base @param {string} path
 */
export const absoluteUrl = (base, path) => (base ? `${base.replace(/\/+$/, '')}${path}` : null);

/** Misafirin adı + soyadının baş harfi ("Ayşe Y."): bağlantı ele geçse de tam ad görünmesin. @param {{ firstName?: string | null, lastName?: string | null } | null} guest */
export const shortGuestName = (guest) => {
  const first = guest?.firstName?.trim() ?? '';
  const last = guest?.lastName?.trim() ?? '';
  return [first, last ? `${last[0]}.` : ''].filter(Boolean).join(' ') || null;
};
