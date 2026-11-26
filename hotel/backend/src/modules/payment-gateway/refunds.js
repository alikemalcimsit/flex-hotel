import { currentActor, runWithContext } from '@hotelos/core';
import { refundableOnLink } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { recordGatewayRefundInTx } from '../payments/service.js';
import { getPaymentLink } from './links.js';
import { gatewayProviderFor } from './providers/index.js';
import { loadGatewaySettings, logLinkEvent, money, prisma, providerContext } from './shared.js';

/**
 * Karta iade (modül 50): istek her zaman ikinci bir yetkilinin onayına gider (`GATEWAY_REFUND`). Onaylanınca sağlayıcıdan iade
 * edilir, başarılıysa folyoya eksi `VIRTUAL_POS` ödemesi yazılır. Sağlayıcı reddederse para hareketi yok, zil çalar.
 */

/** @param {string} linkId */
async function pendingRefundTotal(tx, linkId) {
  const rows = await tx.gatewayRefund.findMany({ where: { linkId, status: { in: ['PENDING_APPROVAL', 'PROCESSING'] } }, select: { amount: true } });
  return money(rows.reduce((sum, row) => sum + Number(row.amount), 0));
}

/** @param {string} hotelId @param {string} linkId @param {{ requestId: string, amount: string, reason: string }} input */
export async function requestGatewayRefund(hotelId, linkId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (await tx.gatewayRefund.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } })) return;
    await tx.$executeRaw`SELECT "id" FROM "PaymentLink" WHERE "id" = ${linkId} AND "hotelId" = ${hotelId} FOR UPDATE`;
    const link = await tx.paymentLink.findFirst({ where: { id: linkId, hotelId } });
    if (!link) throw new NotFoundError('Ödeme linki bulunamadı');
    if (link.status !== 'PAID') throw new ConflictError('Yalnız ödenmiş linkten iade yapılır', 'LINK_STATE');
    const limit = refundableOnLink({ paidAmount: money(link.paidAmount), refundedAmount: money(link.refundedAmount), pendingRefunds: await pendingRefundTotal(tx, link.id) });
    if (Number(input.amount) > Number(limit)) throw new ValidationError(`En çok ${limit} ${link.currency} iade edilebilir (ödenen, iade edilen ve onay bekleyenler düşülmüş)`, { field: 'amount', refundable: limit });
    const refund = await tx.gatewayRefund.create({ data: { hotelId, linkId: link.id, requestId: input.requestId, amount: input.amount, reason: input.reason, requestedBy: actor } });
    const { approvalId } = await requestApproval(tx, stage, {
      hotelId,
      type: 'GATEWAY_REFUND',
      summary: `Karta iade: ${input.amount} ${link.currency} — ${link.description ?? ''}`.slice(0, 200),
      reason: input.reason,
      amount: input.amount,
      currency: link.currency,
      data: { Link: link.description ?? link.id, Ödenen: `${money(link.paidAmount)} ${link.currency}`, Kart: `${link.cardBrand ?? ''} •••• ${link.cardLast4 ?? '—'}`, 'Daha önce iade': `${money(link.refundedAmount)} ${link.currency}`, İsteyen: actor },
      entityType: 'GatewayRefund',
      entityId: refund.id,
      requestedBy: actor,
    });
    await tx.gatewayRefund.update({ where: { id: refund.id }, data: { approvalId } });
    await logLinkEvent(tx, stage, link, { kind: 'REFUND_REQUESTED', ok: true, message: `${input.amount} ${link.currency} iade onaya gitti: ${input.reason}`, actor });
  });
  return getPaymentLink(hotelId, linkId);
}

/**
 * Onay sonucu (servis dinleyicisi). Aynı haber iki kez gelse de bir kez uygulanır.
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload @param {{ name: string }} envelope
 */
export async function applyGatewayRefundDecision(payload, envelope) {
  if (payload.type !== 'GATEWAY_REFUND') return { handled: false };
  const refund = await prismaUnfiltered.gatewayRefund.findFirst({ where: { hotelId: payload.hotelId, approvalId: payload.approvalId } });
  if (!refund) return { handled: false };
  const decidedBy = payload.decidedBy ?? 'system';
  if (envelope.name !== 'approval.granted') {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.gatewayRefund.updateMany({ where: { id: refund.id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED', decidedBy } });
      const link = await tx.paymentLink.findUnique({ where: { id: refund.linkId } });
      if (count) await logLinkEvent(tx, stage, link, { kind: 'REFUND_REJECTED', ok: false, message: envelope.name === 'approval.denied' ? 'İade onaylanmadı' : 'İade onayının süresi doldu', actor: decidedBy });
    });
    return { handled: true, applied: false };
  }
  const { count } = await prisma.gatewayRefund.updateMany({ where: { id: refund.id, status: 'PENDING_APPROVAL' }, data: { status: 'PROCESSING', decidedBy } });
  if (count === 0) return { handled: true, applied: false };
  return runWithContext({ correlationId: `refund:${refund.id}`, actor: decidedBy }, () => executeRefund(refund.id, decidedBy));
}

/** Sağlayıcıdan iade ve folyoya yazım. @param {string} refundId @param {string} decidedBy */
async function executeRefund(refundId, decidedBy) {
  const refund = await prisma.gatewayRefund.findUnique({ where: { id: refundId }, include: { link: true } });
  const { link } = refund;
  const settings = await loadGatewaySettings(prisma, link.hotelId);
  let ref;
  try {
    const provider = gatewayProviderFor(link.provider);
    const result = await provider.refund(providerContext(link.hotelId, { ...settings, environment: link.environment }), {
      items: /** @type {any[]} */ (link.providerItems),
      amount: money(refund.amount),
      currency: link.currency,
      conversationId: `refund:${refund.id}`,
    });
    ref = result.ref;
  } catch (error) {
    // Zaman aşımı / ağ hatasında iade sağlayıcıda yapılmış olabilir: personel yeniden istemeden önce panelden bakmalı.
    const uncertain = Boolean(/** @type {any} */ (error).retryable);
    const message = (uncertain ? `Sonuç belirsiz (${/** @type {Error} */ (error).message}). İade sağlayıcıda yapılmış olabilir; yeniden istemeden önce panelden kontrol edin.` : /** @type {Error} */ (error).message).slice(0, 300);
    await writeWithEvents(async (tx, stage) => {
      await tx.gatewayRefund.update({ where: { id: refund.id }, data: { status: 'FAILED', failureMessage: message } });
      await logLinkEvent(tx, stage, link, { kind: 'REFUND_FAILED', ok: false, code: /** @type {any} */ (error).code ?? null, message, actor: decidedBy });
      await raiseStaffAlert(tx, stage, { hotelId: link.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'WARNING', title: `Karta iade başarısız: ${money(refund.amount)} ${link.currency}`, body: uncertain ? message : `${message} Para hareketi yok; gerekirse yeniden isteyin.`, link: `/sanal-pos/linkler/${link.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'GatewayRefund', entityId: refund.id, dedupeKey: `gateway-refund:${refund.id}:failed` });
    });
    return { handled: true, applied: false };
  }
  try {
    await writeWithEvents(async (tx, stage) => {
      const paymentId = await recordGatewayRefundInTx(tx, stage, { hotelId: link.hotelId, paymentId: link.paymentId, refundId: refund.id, approvalId: refund.approvalId, amount: money(refund.amount), reference: String(ref).slice(0, 60), note: `Sanal POS iadesi: ${refund.reason}`, decidedBy });
      await tx.gatewayRefund.update({ where: { id: refund.id }, data: { status: 'DONE', providerRefundId: ref, paymentId } });
      await tx.paymentLink.update({ where: { id: link.id }, data: { refundedAmount: { increment: refund.amount } } });
      await logLinkEvent(tx, stage, link, { kind: 'REFUNDED', ok: true, message: `${money(refund.amount)} ${link.currency} karta iade edildi (${ref})`, actor: decidedBy });
    });
  } catch (error) {
    // Para karta döndü ama folyoya yazılamadı: kayıt elle düzeltilmeli.
    await writeWithEvents(async (tx, stage) => {
      await tx.gatewayRefund.update({ where: { id: refund.id }, data: { status: 'DONE', providerRefundId: ref, failureMessage: `Folyoya yazılamadı: ${/** @type {Error} */ (error).message}`.slice(0, 300) } });
      await tx.paymentLink.update({ where: { id: link.id }, data: { refundedAmount: { increment: refund.amount } } });
      await logLinkEvent(tx, stage, link, { kind: 'REFUNDED', ok: false, code: 'FOLIO_NOT_UPDATED', message: `Karta iade edildi (${ref}) ama folyoya yazılamadı: ${/** @type {Error} */ (error).message}`, actor: decidedBy });
      await raiseStaffAlert(tx, stage, { hotelId: link.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'CRITICAL', title: 'İade folyoya yazılamadı', body: `${money(refund.amount)} ${link.currency} karta iade edildi; folyoya eksi ödemeyi elle girin (${/** @type {Error} */ (error).message}).`, link: `/sanal-pos/linkler/${link.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'GatewayRefund', entityId: refund.id, dedupeKey: `gateway-refund:${refund.id}:folio` });
    });
  }
  return { handled: true, applied: true };
}
