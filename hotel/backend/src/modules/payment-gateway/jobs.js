import { PAYMENT_LINK_STALE_PROCESSING_MS } from '@hotelos/hotel-contracts';
import { startRecurringJobs } from '../../lib/recurring.js';
import { writeWithEvents } from '../../lib/write.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { postPendingPaidLinks, recoverLink } from './checkout.js';
import { logLinkEvent, prisma } from './shared.js';

/**
 * Sanal POS'un zamanlanmış işleri (modül 50).
 *
 * | İş                         | Sıklık | Neden |
 * |----------------------------|--------|-------|
 * | Takılan ödemeyi sonuçlandır | 5 dk   | Geri dönüşü gelmeyen "ödeme sürüyor" link sağlayıcıya sorulur |
 * | Süresi dolan link          | 15 dk  | Ödenmemiş, süresi geçmiş link "süresi doldu" olur |
 * | Folyoya yazılamayan ödeme   | 5 dk   | Alınmış ama yazılamamış ödeme (ör. açık folyo yoktu) yeniden yazılır |
 * | Takılan iade               | 15 dk  | 15 dakikadır "iade ediliyor"da kalan iade için zil (sağlayıcıda kontrol) |
 */

const BATCH = 100;

/** @param {Date} [now] */
export async function recoverStaleLinks(now = new Date(), logger = null) {
  const rows = await prisma.paymentLink.findMany({ where: { status: 'PROCESSING', startedAt: { lt: new Date(now.getTime() - PAYMENT_LINK_STALE_PROCESSING_MS) }, OR: [{ failureCode: null }, { NOT: { failureCode: 'UNVERIFIED' } }] }, select: { id: true }, take: BATCH });
  let settled = 0;
  for (const row of rows) {
    try {
      const outcome = await recoverLink(row.id);
      if (outcome !== 'PENDING' && outcome !== 'UNVERIFIED') settled += 1;
    } catch (error) {
      // Sağlayıcıya ulaşılamadı: sonraki tur.
      logger?.error?.({ err: error, linkId: row.id }, 'Sanal POS: takılan ödeme sorulamadı');
    }
  }
  return settled;
}

/** 15 dakikadır "iade ediliyor"da kalan iadeler için bir kez zil. @param {Date} [now] */
export async function alertStuckRefunds(now = new Date()) {
  const rows = await prisma.gatewayRefund.findMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, take: BATCH });
  for (const row of rows) {
    await writeWithEvents(async (tx, stage) => {
      await raiseStaffAlert(tx, stage, { hotelId: row.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'CRITICAL', title: 'Karta iade sonuçlanmadı', body: `${row.amount} iade 15 dakikadır sonuçlanmadı. Sağlayıcı panelinden iadenin yapılıp yapılmadığını kontrol edin; yeniden istemeyin.`, link: `/sanal-pos/linkler/${row.linkId}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'GatewayRefund', entityId: row.id, dedupeKey: `gateway-refund:${row.id}:stuck` });
    });
  }
  return rows.length;
}

/** @param {Date} [now] */
export async function expireLinks(now = new Date()) {
  const rows = await prisma.paymentLink.findMany({ where: { status: 'OPEN', expiresAt: { lte: now } }, take: BATCH });
  for (const row of rows) {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.paymentLink.updateMany({ where: { id: row.id, status: 'OPEN' }, data: { status: 'EXPIRED' } });
      if (count) await logLinkEvent(tx, stage, row, { kind: 'EXPIRED', ok: false, message: 'Süresi doldu (ödenmedi)', actor: 'payment-gateway', status: 'EXPIRED' });
    });
  }
  return rows.length;
}

/** @param {{ info: Function, error: Function }} logger */
export function startPaymentGatewayJobs(logger) {
  return startRecurringJobs(logger, [
    { name: 'gateway-recover', intervalMs: 5 * 60_000, run: () => recoverStaleLinks(new Date(), logger) },
    { name: 'gateway-post', intervalMs: 5 * 60_000, run: () => postPendingPaidLinks() },
    { name: 'gateway-refund-stuck', intervalMs: 15 * 60_000, run: () => alertStuckRefunds() },
    { name: 'gateway-expire', intervalMs: 15 * 60_000, run: () => expireLinks() },
  ]);
}
