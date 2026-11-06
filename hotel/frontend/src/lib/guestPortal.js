import { GUEST_PORTAL_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Misafir portalı ve online check-in (modül 53) — personel ekranları: sorgu anahtarları ve canlı tazeleme.
 * Hepsi `guest-portal` kökünde: canlı haber tek anahtarla bütün online check-in ekranlarını ve giriş penceresinin
 * ön dolumunu yeniler.
 */
export const guestPortalKeys = Object.freeze({
  all: ['guest-portal'],
  list: (params) => ['guest-portal', 'online-checkins', params],
  detail: (id) => ['guest-portal', 'online-checkin', id],
  byReservation: (reservationId) => ['guest-portal', 'by-reservation', reservationId],
  link: (reservationId) => ['guest-portal', 'link', reservationId],
  settings: ['guest-portal', 'settings'],
});

export function useGuestPortalLive() {
  return useLiveChannel(GUEST_PORTAL_CHANNEL, { minIntervalMs: 1_000, queryKeys: [guestPortalKeys.all] });
}

/** Belgenin yetkili API yolu (görüntü `useProtectedImage` ile okunur). @param {string} onlineCheckinId @param {string} documentId @param {'full' | 'thumb'} size */
export const documentPath = (onlineCheckinId, documentId, size) => `/guest-portal/online-checkins/${onlineCheckinId}/documents/${documentId}?size=${size}`;
/** @param {string} onlineCheckinId */
export const signaturePath = (onlineCheckinId) => `/guest-portal/online-checkins/${onlineCheckinId}/signature`;

/** Kişi sırası → etiket (0 rezervasyon sahibi). @param {number | null} person @param {{ guest: any, companions: any[] }} detail */
export function personLabel(person, detail) {
  if (person === 0 || person === null) return `${detail.guest?.firstName ?? ''} ${detail.guest?.lastName ?? ''}`.trim() || 'Rezervasyon sahibi';
  const companion = detail.companions?.[person - 1];
  return companion ? `${companion.firstName} ${companion.lastName}`.trim() : `Kişi ${person + 1}`;
}
