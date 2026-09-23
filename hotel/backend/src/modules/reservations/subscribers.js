import { INVENTORY_RELEASING_EVENTS, runWithContext } from '@hotelos/core';
import { createGroupReservationSchema, createReservationSchema } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { eventBus } from '../../lib/events.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { APPROVAL_REQUEST_KEY, createGroupReservation, createReservation } from './service.js';
import { refreshWaitlist } from './waitlist.js';

/**
 * Rezervasyon modülünün olay dinleyicileri (modül 4).
 *
 * 1. **Kapasite aşımı onayı** (`approval.granted` / `denied` / `expired`,
 *    tür `OVERBOOKING`): onaylanınca saklanan istek aynı istek kimliğiyle
 *    kapasite aşılarak açılır; isteyen personelin ziline sonuç düşer. Aynı
 *    haber iki kez gelse de istek kimliği ikinci rezervasyonu engeller.
 * 2. **Bekleme listesi**: envanteri artırabilen her olaydan sonra otelin açık
 *    kayıtları taranır. Aynı otelde art arda gelen olaylar tek taramada
 *    birleşir (yoğun saatte her iptal için ayrı tarama yapılmaz).
 */

/** Olaydan sonra taramanın beklemesi (art arda gelen olaylar birleşsin). */
const WAITLIST_REFRESH_DEBOUNCE_MS = 2_000;

let logger = { warn: () => {}, error: () => {} };

/** @param {{ warn: Function, error: Function }} next */
export function setReservationSubscriberLogger(next) {
  logger = next;
}

/* ══════════════════ Kapasite aşımı onayı ══════════════════ */

/**
 * İsteyen personelin ziline sonuç (kişi bulunamazsa rezervasyon yetkilisine).
 * @param {string} hotelId
 * @param {string} requester e-posta
 * @param {{ title: string, body: string | null, link: string | null, severity: 'INFO' | 'WARNING' | 'CRITICAL', approvalId: string }} alert
 */
async function alertRequester(hotelId, requester, alert) {
  const staff = requester?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, requester.toLowerCase()) : null;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      link: alert.link,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.RESERVATIONS_MANAGE,
      entityType: 'Approval',
      entityId: alert.approvalId,
      dedupeKey: `approval-decided:${alert.approvalId}`,
    }),
  );
}

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export async function onOverbookingDecision(payload, envelope) {
  if (payload.type !== 'OVERBOOKING') return { handled: false };
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId: payload.hotelId },
    select: { id: true, summary: true, data: true, requestedBy: true, note: true, status: true },
  });
  if (!approval) return { handled: false };
  const request = /** @type {any} */ (approval.data)?.[APPROVAL_REQUEST_KEY];

  if (envelope.name !== 'approval.granted') {
    const denied = envelope.name === 'approval.denied';
    await alertRequester(payload.hotelId, approval.requestedBy, {
      title: denied ? `Kapasite aşımı reddedildi: ${approval.summary}` : `Kapasite aşımı onayı süresi doldu: ${approval.summary}`,
      body: denied ? `Gerekçe: ${approval.note ?? '—'}. Rezervasyon açılmadı.` : 'Kimse karar vermedi; rezervasyon açılmadı.',
      link: `/onaylar/gecmis?onay=${approval.id}`,
      severity: 'WARNING',
      approvalId: approval.id,
    });
    return { handled: true, created: false };
  }

  const schema = request?.kind === 'group' ? createGroupReservationSchema : createReservationSchema;
  const parsed = schema.safeParse(request?.input);
  if (!parsed.success) {
    logger.error?.({ approvalId: approval.id, issues: parsed.error.issues }, 'Onaylanan rezervasyon isteği okunamadı');
    await alertRequester(payload.hotelId, approval.requestedBy, {
      title: `Onaylandı ama rezervasyon açılamadı: ${approval.summary}`,
      body: 'Saklanan istek okunamadı; rezervasyonu elle açın.',
      link: `/onaylar/gecmis?onay=${approval.id}`,
      severity: 'CRITICAL',
      approvalId: approval.id,
    });
    return { handled: true, created: false };
  }

  const create = request.kind === 'group' ? createGroupReservation : createReservation;
  try {
    // Denetim izinde aktör onaylayan kişi; rezervasyonu açan isteyen personel.
    const result = await runWithContext(
      { correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' },
      () =>
        create(payload.hotelId, parsed.data, {
          allowOverbooking: true,
          approvalAllowed: false,
          createdBy: request.createdBy ?? approval.requestedBy,
          canOverridePrice: Boolean(request.canOverridePrice),
        }),
    );
    const reservation = result.reservation;
    await alertRequester(payload.hotelId, approval.requestedBy, {
      title: `Kapasite aşımı onaylandı, rezervasyon açıldı: ${reservation?.confirmationCode ?? ''}`.trim(),
      body: approval.summary,
      link: reservation ? `/rezervasyonlar/${reservation.id}` : null,
      severity: 'INFO',
      approvalId: approval.id,
    });
    return { handled: true, created: true, reservationId: reservation?.id ?? null };
  } catch (error) {
    logger.warn?.({ err: error, approvalId: approval.id }, 'Onaylanan rezervasyon açılamadı');
    await alertRequester(payload.hotelId, approval.requestedBy, {
      title: `Onaylandı ama rezervasyon açılamadı: ${approval.summary}`,
      body: error?.message ?? 'Bilinmeyen hata',
      link: `/onaylar/gecmis?onay=${approval.id}`,
      severity: 'CRITICAL',
      approvalId: approval.id,
    });
    return { handled: true, created: false };
  }
}

/* ══════════════════ Bekleme listesi taraması ══════════════════ */

/** @type {Map<string, { timer: NodeJS.Timeout | null, running: boolean, again: boolean }>} */
const refreshes = new Map();

/**
 * Otelin bekleme listesi taramasını birleştirerek planlar. Tarama sürerken
 * yeni olay gelirse bittikten sonra bir kez daha çalışır (arada açılan yer
 * kaçmaz).
 * @param {string} hotelId
 */
export function scheduleWaitlistRefresh(hotelId) {
  const state = refreshes.get(hotelId) ?? { timer: null, running: false, again: false };
  refreshes.set(hotelId, state);
  if (state.running) {
    state.again = true;
    return;
  }
  if (state.timer) return;
  state.timer = setTimeout(() => runRefresh(hotelId), WAITLIST_REFRESH_DEBOUNCE_MS);
  state.timer.unref?.();
}

/** @param {string} hotelId */
async function runRefresh(hotelId) {
  const state = refreshes.get(hotelId);
  if (!state) return;
  state.timer = null;
  state.running = true;
  try {
    await refreshWaitlist(hotelId);
  } catch (error) {
    logger.error?.({ err: error, hotelId }, 'Bekleme listesi taranamadı');
  } finally {
    state.running = false;
    if (state.again) {
      state.again = false;
      scheduleWaitlistRefresh(hotelId);
    } else {
      refreshes.delete(hotelId);
    }
  }
}

/* ══════════════════ Kayıt ══════════════════ */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerReservationSubscribers() {
  stopReservationSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'reservations:overbooking-approval', (payload, envelope) =>
      onOverbookingDecision(payload, envelope),
    ),
    eventBus.subscribeMany([...INVENTORY_RELEASING_EVENTS], 'reservations:waitlist-refresh', (payload) => {
      if (payload?.hotelId) scheduleWaitlistRefresh(payload.hotelId);
    }),
  ];
  return stopReservationSubscribers;
}

export function stopReservationSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  for (const state of refreshes.values()) if (state.timer) clearTimeout(state.timer);
  refreshes.clear();
}
