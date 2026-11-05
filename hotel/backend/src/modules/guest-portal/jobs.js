import { runWithContext } from '@hotelos/core';
import { randomUUID } from 'node:crypto';
import { eventBus } from '../../lib/events.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { purgeExpiredDocuments } from './documents.js';
import { runInviteJob } from './invites.js';
import { onStayCheckInChanged, syncArrivalDate } from './service.js';
import { PORTAL_SYSTEM_ACTOR } from './shared.js';

/**
 * Misafir portalının zamanlanmış işleri (yalnızca sunucu sürecinde) ve olay abonelikleri (modül 53).
 *
 * | İş                          | Sıklık | Neden |
 * |-----------------------------|--------|-------|
 * | Online check-in davetleri   | 30 dk  | Girişten N gün önce; gün dönünce yeni günün varışları sıraya girer |
 * | Belge fotoğraflarının silinmesi | 1 sa | KVKK: saklama süresi dolan kimlik fotoğrafı ve gönderime bağlanmamış yükleme |
 */
const INVITE_INTERVAL_MS = 30 * 60_000;
const PURGE_INTERVAL_MS = 60 * 60_000;
/** Bir silme işinin en fazla tur sayısı (her tur 200 belge). */
const MAX_PURGE_ROUNDS = 25;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startGuestPortalJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'guest-portal-invites',
      intervalMs: INVITE_INTERVAL_MS,
      run: async () => {
        const invited = await runInviteJob(logger);
        if (invited > 0) logger.info({ invited }, 'Online check-in davetleri sıraya alındı');
      },
    },
    {
      name: 'online-checkin-document-purge',
      intervalMs: PURGE_INTERVAL_MS,
      run: () =>
        runWithContext({ correlationId: randomUUID(), actor: PORTAL_SYSTEM_ACTOR }, async () => {
          let purged = 0;
          for (let round = 0; round < MAX_PURGE_ROUNDS; round += 1) {
            const result = await purgeExpiredDocuments(new Date(), logger);
            purged += result.purged;
            if (result.purged === 0) break;
          }
          if (purged > 0) logger.info({ purged }, 'Saklama süresi dolan online check-in belgeleri silindi');
        }),
    },
  ]);
}

let unsubscribers = [];

/** Giriş (modül 6) olayları: online check-in tamamlanır, geri alınırsa onaylıya döner; tarih değişince giriş günü eşitlenir. */
export function registerGuestPortalSubscribers() {
  stopGuestPortalSubscribers();
  const handle = (kind) => (payload, envelope) =>
    runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: 'system' }, () => onStayCheckInChanged(payload, kind));
  unsubscribers = [
    eventBus.subscribe('guest.checked_in', 'guest-portal:checked-in', handle('COMPLETED')),
    eventBus.subscribe('guest.check_in_reverted', 'guest-portal:check-in-reverted', handle('REVERTED')),
    eventBus.subscribe('reservation.updated', 'guest-portal:arrival-date', (payload) => syncArrivalDate(payload)),
  ];
  return stopGuestPortalSubscribers;
}

export function stopGuestPortalSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
