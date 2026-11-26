import { randomUUID } from 'node:crypto';
import { WEBHOOK_SOURCE_EVENTS, buildWebhookEnvelope, toWebhookEvent } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { cache } from '../../lib/cache.js';
import { eventBus } from '../../lib/events.js';
import { kickWebhookSender } from './sender.js';
import { SUBSCRIPTIONS_CACHE_TTL_MS, subscriptionsCacheKey } from './shared.js';

/**
 * İş olayı → webhook teslimatı (modül 61).
 *
 * Dinleyici olay commit edildikten sonra çalışır (`writeWithEvents`) ve yalnız **kuyruğa yazar**: gönderim ayrı
 * (`sender.js`), isteği yapan personel alıcının cevabını beklemez. Aynı olay outbox'tan yeniden dağıtılırsa
 * (`lib/outbox.js`) `(subscriptionId, eventId)` tekilliği ikinci teslimatı yazmaz.
 *
 * Otelin açık abonelikleri 30 sn önbellekte: çoğu otelde abonelik yoktur ve her rezervasyon / ödeme olayında sorgu
 * atılmamalı. Abonelik değişince önbellek hemen silinir (`shared.js`).
 */

const SUBSCRIBER = 'webhook-outbox';

/**
 * Otelin olay alan abonelikleri (abonelik ve uygulaması açık, silinmemiş).
 * @param {string} hotelId
 * @returns {Promise<Array<{ id: string, events: string[] }>>}
 */
export function activeSubscriptions(hotelId) {
  return cache.getOrSet(
    subscriptionsCacheKey(hotelId),
    () =>
      prismaUnfiltered.webhookSubscription.findMany({
        where: { hotelId, status: 'ACTIVE', deletedAt: null, client: { status: 'ACTIVE', deletedAt: null } },
        select: { id: true, events: true },
      }),
    SUBSCRIPTIONS_CACHE_TTL_MS,
  );
}

/**
 * Olayı isteyen aboneliklere teslimat yazar.
 * @param {string} sourceName iç olay adı
 * @param {Record<string, any>} payload
 * @param {{ id: string, occurredAt: Date | string }} envelope
 * @returns {Promise<number>} yazılan teslimat
 */
export async function enqueueWebhookEvent(sourceName, payload, envelope) {
  const hotelId = payload?.hotelId;
  if (!hotelId) return 0;
  const event = toWebhookEvent(sourceName, payload);
  if (!event) return 0;
  const subscriptions = (await activeSubscriptions(hotelId)).filter((subscription) => subscription.events.includes(event.type));
  if (subscriptions.length === 0) return 0;

  const body = buildWebhookEnvelope({ eventId: envelope.id, type: event.type, occurredAt: envelope.occurredAt, hotelId, data: event.data });
  const now = new Date();
  const { count } = await prismaUnfiltered.webhookDelivery.createMany({
    data: subscriptions.map((subscription) => ({
      id: randomUUID(),
      hotelId,
      subscriptionId: subscription.id,
      eventId: envelope.id,
      eventType: event.type,
      payload: body,
      status: 'PENDING',
      nextAttemptAt: now,
    })),
    skipDuplicates: true,
  });
  if (count > 0) kickWebhookSender();
  return count;
}

/** @type {(() => void) | null} */
let unsubscribe = null;

export function stopWebhookSubscribers() {
  unsubscribe?.();
  unsubscribe = null;
}

/** Uygulama kurulurken (app.js); yeniden kurulursa önceki kayıt bırakılır (testler birden çok uygulama açar). */
export function registerWebhookSubscribers() {
  stopWebhookSubscribers();
  unsubscribe = eventBus.subscribeMany([...WEBHOOK_SOURCE_EVENTS], SUBSCRIBER, (payload, envelope) => enqueueWebhookEvent(envelope.name, payload, envelope));
  return stopWebhookSubscribers;
}
