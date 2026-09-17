import { GUEST_REQUEST_CATEGORY_LABELS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { eventBus } from '../../lib/events.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { kickDispatcher } from './dispatcher.js';
import { raiseStaffAlert } from './staff-alerts.js';

/**
 * Bildirim merkezinin olay dinleyicileri (modül 9).
 *
 * - Yeni misafir mesajı → konuşmanın sahibine (yoksa mesaj görenlere) uyarı.
 *   AI asistanı yanıtlıyorsa personel rahatsız edilmez.
 * - Acil istek → isteğin sahibine (yoksa istek yönetenlere) uyarı.
 * - Kuyruğa bildirim girdi → gönderici tetiklenir (beklenmeden).
 *
 * Dinleyiciler olay dağıtımında beklenir; her biri en fazla iki küçük sorgu.
 */

/** Uyarıdaki mesaj alıntısı. */
const PREVIEW_LENGTH = 140;

/** @param {{ guestId: string | null, mode: string, conversationId: string, hotelId: string }} payload */
async function onGuestMessage(payload) {
  if (payload.mode === 'AI') return;
  const conversation = await prisma.conversation.findFirst({
    where: { id: payload.conversationId, hotelId: payload.hotelId },
    select: {
      id: true,
      displayName: true,
      externalId: true,
      assignedToId: true,
      awaitingReplySince: true,
      lastMessagePreview: true,
      status: true,
      guest: { select: { firstName: true, lastName: true } },
    },
  });
  // Bu arada cevaplandıysa uyarı gereksiz.
  if (!conversation?.awaitingReplySince) return;

  const name = conversation.guest
    ? `${conversation.guest.firstName} ${conversation.guest.lastName}`.trim()
    : conversation.displayName || conversation.externalId;
  const preview = conversation.lastMessagePreview ?? '';

  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId: payload.hotelId,
      kind: 'GUEST_MESSAGE',
      severity: 'INFO',
      title: `${name} yazdı`,
      body: preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH - 1)}…` : preview,
      link: `/mesajlar/${conversation.id}`,
      userId: conversation.assignedToId,
      permission: conversation.assignedToId ? null : PERMISSIONS.MESSAGES_VIEW,
      entityType: 'Conversation',
      entityId: conversation.id,
      // Aynı cevapsız mesaj dizisi tek uyarı; cevap verilip yeniden yazılınca yeni uyarı.
      dedupeKey: `guest-message:${conversation.id}:${conversation.awaitingReplySince.getTime()}`,
    }),
  );
}

/** @param {{ hotelId: string, requestId: string, priority: string }} payload */
async function onRequestCreated(payload) {
  if (payload.priority !== 'URGENT') return;
  const request = await prisma.guestRequest.findFirst({
    where: { id: payload.requestId, hotelId: payload.hotelId },
    select: { id: true, title: true, category: true, assignedToId: true, room: { select: { number: true } } },
  });
  if (!request) return;

  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId: payload.hotelId,
      kind: 'URGENT_REQUEST',
      severity: 'CRITICAL',
      title: `Acil istek: ${request.title}`,
      body: [request.room ? `Oda ${request.room.number}` : null, GUEST_REQUEST_CATEGORY_LABELS[request.category]]
        .filter(Boolean)
        .join(' · '),
      link: `/istekler?istek=${request.id}`,
      userId: request.assignedToId,
      permission: request.assignedToId ? null : PERMISSIONS.REQUESTS_MANAGE,
      entityType: 'GuestRequest',
      entityId: request.id,
      dedupeKey: `urgent-request:${request.id}`,
    }),
  );
}

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * Dinleyicileri kurar (idempotent).
 * @returns {() => void}
 */
export function registerNotificationSubscribers() {
  stopNotificationSubscribers();
  unsubscribers = [
    eventBus.subscribe('guest.message.received', 'staff-alerts:guest-message', onGuestMessage),
    eventBus.subscribe('guest.request.created', 'staff-alerts:urgent-request', onRequestCreated),
    // Beklenmez: gönderim olay dağıtımını ve HTTP isteğini tutmamalı.
    eventBus.subscribe('notification.send.requested', 'notification-dispatcher', () => {
      kickDispatcher();
    }),
  ];
  return stopNotificationSubscribers;
}

export function stopNotificationSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
