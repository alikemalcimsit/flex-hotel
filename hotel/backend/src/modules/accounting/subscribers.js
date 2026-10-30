import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { openPartnerAccount, syncPartnerAccount } from './shared.js';
import { onAccountingApprovalDecision } from './vouchers.js';

/**
 * Ön muhasebenin süreç içi dinleyicileri (modül 47):
 * - Eşik üstü ödeme fişinin dört göz kararı (onay kuyruğu): fiş işlenir ya da reddedilir.
 * - Bağlı kart değişince cari eşitlenir: acente / tedarikçi / etkinlik müşterisinin ünvanı, vergi ve iletişim
 *   bilgisi (ve acente / tedarikçi vadesi) cariye yansır. Yeni acente ve tedarikçinin carisi ilk kayıtta açılır.
 *
 * Otomatik muhasebe kayıtları burada değil, muhasebe aktöründe (`accounting-worker`): kapatılabilir, hatası
 * manuel göreve düşer, panelde izlenir.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** Bağlı kart eşitlemesi: değişikliği yapanın zincirinde, sistem adına. Hata olay dağıtıcısının günlüğüne düşer. @param {(payload: any) => Promise<unknown>} work */
const asSystem = (work) => (payload, envelope) => runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: 'system' }, () => work(payload));

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerAccountingSubscribers() {
  stopAccountingSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'accounting:approval-decision', (payload, envelope) => onAccountingApprovalDecision(payload, envelope)),
    eventBus.subscribe(
      'agency.changed',
      'accounting:agency-sync',
      asSystem((payload) => (payload.change === 'CREATED' ? openPartnerAccount(payload.hotelId, { agencyId: payload.agencyId }) : syncPartnerAccount(payload.hotelId, { agencyId: payload.agencyId }))),
    ),
    eventBus.subscribe(
      'purchase.supplier.changed',
      'accounting:supplier-sync',
      asSystem((payload) => (payload.change === 'CREATED' ? openPartnerAccount(payload.hotelId, { supplierId: payload.supplierId }) : syncPartnerAccount(payload.hotelId, { supplierId: payload.supplierId }))),
    ),
    eventBus.subscribe('banquet.client.changed', 'accounting:client-sync', asSystem((payload) => syncPartnerAccount(payload.hotelId, { eventClientId: payload.clientId }))),
  ];
  return stopAccountingSubscribers;
}

export function stopAccountingSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
