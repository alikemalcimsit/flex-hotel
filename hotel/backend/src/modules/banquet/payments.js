import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { APPROVAL_TYPE_LABELS, PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, paymentVoidError } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockEvents } from '../../lib/locks.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { needsLargePaymentApproval, voidLeavesRefundsCovered } from '../payments/rules.js';
import { amountDue, eventPaymentIssue, eventPaymentState, eventRefundLimit } from './rules.js';
import { dateOnly, day, hotelContext, iso, money, prisma, recomputePaidTotal } from './shared.js';

/**
 * Etkinlik ödemesi (modül 37): depozito, ara ödeme, kalan, iade ve hatalı girişin iptali.
 *
 * Etkinliğin kendi hesabı vardır (konaklama folyosu yok): borç = etkinlik toplamı
 * (iptalde iptal bedeli), ödenen = bakiyeye girmiş satırların toplamı. Para kuralları
 * modül 17 ile aynıdır ve satırlar kasada "Etkinlik" kaynağıyla görünür:
 *
 * - **Ödeme silinmez.** Hatalı giriş iptal kaydıyla (asıl satırın tersi), müşteriye
 *   geri verilen para iadeyle (eksi satır) düzeltilir; ikisi de dört göz onaylı.
 * - **Eşik:** otelin büyük ödeme eşiğine eşit ya da büyük tahsilat onaya gider;
 *   onaylanınca bakiyeye ve kasaya girer, reddedilirse hiç işlenmez.
 * - **Tekrar gönderim:** istek kimliği (`requestId`) satırın anahtarıdır; aynı istek
 *   ikinci kez tahsil edilmez.
 * - Ödeme yazan her işlem **etkinliği kilitler**; ödenen toplam aynı transaction'da
 *   satırlardan yeniden hesaplanır.
 */

export const EVENT_PAYMENT_APPROVAL_TYPE = 'EVENT_PAYMENT';

export const EVENT_PAYMENT_SELECT = Object.freeze({
  id: true,
  eventId: true,
  kind: true,
  status: true,
  method: true,
  amount: true,
  currency: true,
  businessDate: true,
  reference: true,
  note: true,
  receivedBy: true,
  receivedAt: true,
  postedAt: true,
  approvalId: true,
  declinedAt: true,
  reversalOfId: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  voidApprovalId: true,
  voidRequestedAt: true,
  voidRequestedBy: true,
});

/** Kasada etkinlik ödemesinin dosyası (numara, ad, müşteri). */
export const EVENT_REF_SELECT = Object.freeze({ id: true, code: true, name: true, status: true, client: { select: { name: true } } });

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Kullanıcıya yazılan tutar: "55.000,00 TRY". @param {string} amount @param {string} currency */
const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;
/** @param {string} amount */
const unsigned = (amount) => toMoneyString(toDecimal(amount).abs());

/** @param {any} row */
export function toEventPaymentDto(row) {
  return {
    id: row.id,
    eventId: row.eventId,
    kind: row.kind,
    status: row.status,
    method: row.method,
    amount: money(row.amount),
    currency: row.currency,
    businessDate: day(row.businessDate),
    reference: row.reference,
    note: row.note,
    receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt),
    postedAt: iso(row.postedAt),
    approvalId: row.approvalId,
    declinedAt: iso(row.declinedAt),
    reversalOfId: row.reversalOfId,
    voided: Boolean(row.voidedAt),
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
    voidApprovalId: row.voidApprovalId,
    voidPending: Boolean(row.voidRequestedAt),
    voidRequestedBy: row.voidRequestedBy,
  };
}

/**
 * Etkinliğin ödeme özeti: işlenmiş net, bekleyen tahsilat / iade (tek gruplu sorgu).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} eventId
 */
export async function eventPaymentTotals(client, eventId) {
  const groups = await client.eventPayment.groupBy({
    by: ['status', 'kind'],
    where: { eventId, status: { in: ['POSTED', 'PENDING'] } },
    _sum: { amount: true },
  });
  return eventPaymentState(groups.map((group) => ({ status: group.status, kind: group.kind, amount: String(group._sum.amount ?? 0) })));
}

/**
 * Etkinlik ekranının "Ödemeler" sekmesi: satırlar (son alınan önce, imleçli) ve özet.
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ cursor?: string, limit: number }} query
 */
export async function listEventPayments(hotelId, eventId, query) {
  const event = await prisma.event.findFirst({ where: { id: eventId, hotelId }, select: { id: true, status: true, currency: true, grandTotal: true, cancellationFee: true } });
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  const cursor = parseCursor(query.cursor);
  const [rows, state] = await Promise.all([
    prisma.eventPayment.findMany({
      where: { hotelId, eventId, ...(cursor ? olderThan('receivedAt', cursor) : {}) },
      select: EVENT_PAYMENT_SELECT,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    eventPaymentTotals(prisma, eventId),
  ]);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const due = amountDue({ status: event.status, grandTotal: String(event.grandTotal), cancellationFee: event.cancellationFee === null ? null : String(event.cancellationFee) });
  return {
    payments: page.map(toEventPaymentDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.receivedAt, id: last.id }) : null,
    currency: event.currency,
    summary: {
      amountDue: due,
      ...state,
      balance: toMoneyString(toDecimal(due).minus(toDecimal(state.postedNet))),
      refundable: eventRefundLimit({ status: event.status, amountDue: due, state }),
    },
  };
}

/**
 * Ödemenin etkinliği (onay ekranının "aç" bağlantısı ödeme kimliğiyle gelir).
 * @param {string} hotelId
 * @param {string} paymentId
 */
export async function findPaymentEvent(hotelId, paymentId) {
  const row = await prisma.eventPayment.findFirst({ where: { id: paymentId, hotelId }, select: { eventId: true } });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return { eventId: row.eventId };
}

/** @param {string} hotelId @param {string} paymentId */
async function readPayment(hotelId, paymentId) {
  const row = await prisma.eventPayment.findFirst({ where: { id: paymentId, hotelId }, select: EVENT_PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return toEventPaymentDto(row);
}

/** @param {any} row */
const paymentAudit = (row) => ({
  kind: row.kind,
  status: row.status,
  method: row.method,
  amount: money(row.amount),
  currency: row.currency,
  businessDate: day(row.businessDate),
  reference: row.reference,
  approvalId: row.approvalId,
});

/* ══════════════════ Tahsilat ve iade ══════════════════ */

/**
 * Tahsilat ya da iade. İade her zaman, eşik üstü tahsilat da onaya gider (`PENDING`);
 * onaylanınca işlenir. Aynı istek kimliğiyle ikinci gönderim yeni satır açmaz.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ requestId: string, kind: 'PAYMENT' | 'REFUND', method: string, amount: string, reference?: string | null, note?: string | null }} input
 * @returns {Promise<{ payment: ReturnType<typeof toEventPaymentDto>, created: boolean }>}
 */
export async function receiveEventPayment(hotelId, eventId, input) {
  const { hotel, today } = await hotelContext(hotelId);
  const actor = currentActor();
  const sourceKey = `event:${input.requestId}`;
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockEvents(tx, hotelId, [eventId])).has(eventId)) throw new NotFoundError('Etkinlik bulunamadı');
      const existing = await tx.eventPayment.findFirst({ where: { hotelId, sourceKey }, select: { id: true, eventId: true } });
      if (existing) {
        if (existing.eventId !== eventId) throw new ConflictError('Bu istek başka bir etkinliğin ödemesinde kullanıldı; formu yenileyin.', 'DUPLICATE_REQUEST');
        return { paymentId: existing.id, created: false };
      }
      const event = await tx.event.findFirst({
        where: { id: eventId, hotelId },
        select: { id: true, code: true, name: true, status: true, currency: true, grandTotal: true, cancellationFee: true, client: { select: { name: true } } },
      });
      const due = amountDue({ status: event.status, grandTotal: String(event.grandTotal), cancellationFee: event.cancellationFee === null ? null : String(event.cancellationFee) });
      const state = await eventPaymentTotals(tx, eventId);
      const issue = eventPaymentIssue({ kind: input.kind, status: event.status, amount: input.amount, amountDue: due, state });
      if (issue) throw new ValidationError(issue.message, { field: 'amount', limit: issue.limit });

      const refund = input.kind === 'REFUND';
      const signed = refund ? toMoneyString(toDecimal(input.amount).negated()) : toMoneyString(input.amount);
      const pending = refund || needsLargePaymentApproval(input.amount, String(hotel.largePaymentThreshold ?? 0));
      const paymentId = randomUUID();
      let approvalId = null;
      if (pending) {
        const what = refund ? 'Etkinlik iadesi' : 'Büyük etkinlik ödemesi';
        const paidAfter = toMoneyString(toDecimal(state.postedNet).plus(toDecimal(signed)));
        ({ approvalId } = await requestApproval(tx, stage, {
          hotelId,
          type: EVENT_PAYMENT_APPROVAL_TYPE,
          summary: `${what}: ${event.code} · ${event.name} — ${priced(input.amount, event.currency)} ${PAYMENT_METHOD_LABELS[input.method]}`.slice(0, 200),
          reason: refund
            ? (input.note ?? 'Müşteriye iade')
            : `Tutar büyük ödeme eşiğine (${priced(money(hotel.largePaymentThreshold), hotel.currency)}) eşit ya da üstünde`,
          amount: toMoneyString(input.amount),
          currency: event.currency,
          // Onay ekranı veriyi yorumlamadan gösterir: onaylayanın okuyacağı etiketlerle.
          data: {
            Etkinlik: `${event.code} · ${event.name}`,
            Müşteri: event.client.name,
            Tür: PAYMENT_KIND_LABELS[input.kind],
            Yöntem: PAYMENT_METHOD_LABELS[input.method],
            Tutar: priced(input.amount, event.currency),
            ...(input.reference ? { Referans: input.reference } : {}),
            ...(input.note ? { Not: input.note } : {}),
            [event.status === 'CANCELLED' ? 'İptal bedeli' : 'Etkinlik tutarı']: priced(due, event.currency),
            'Şu an ödenen': priced(state.postedNet, event.currency),
            'Onaylanınca ödenen': priced(paidAfter, event.currency),
            Alan: actor,
          },
          entityType: 'EventPayment',
          entityId: paymentId,
          requestedBy: actor,
        }));
      }

      const now = new Date();
      const created = await tx.eventPayment.create({
        data: {
          id: paymentId,
          hotelId,
          eventId,
          kind: input.kind,
          status: pending ? 'PENDING' : 'POSTED',
          method: input.method,
          amount: signed,
          currency: event.currency,
          businessDate: dateOnly(today),
          reference: input.reference ?? null,
          note: input.note ?? null,
          sourceKey,
          receivedBy: actor,
          receivedAt: now,
          postedAt: pending ? null : now,
          approvalId,
        },
        select: EVENT_PAYMENT_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'EventPayment', entityId: paymentId, action: 'CREATE', after: { event: event.code, ...paymentAudit(created) } });
      if (!pending) await recomputePaidTotal(tx, eventId);
      await stage('banquet.payment.changed', { hotelId, eventId, paymentId, change: pending ? 'PENDING' : 'RECEIVED' });
      return { paymentId, created: true };
    });
    return { payment: await readPayment(hotelId, outcome.paymentId), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Hatalı girişin iptali (yanlış tutar, çift giriş): onaya gider; onaylanınca asıl
 * satırın tersi işlenir. Müşteriye para geri verilecekse bu değil iadedir. İade
 * edilmiş paranın tahsilatı iptal edilemez (iade karşılıksız kalırdı).
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string} paymentId
 * @param {{ reason: string }} input
 * @returns {Promise<{ approvalId: string, payment: ReturnType<typeof toEventPaymentDto> }>}
 */
export async function requestEventPaymentVoid(hotelId, eventId, paymentId, { reason }) {
  const actor = currentActor();
  let approvalId;
  try {
    approvalId = await writeWithEvents(async (tx, stage) => {
      if (!(await lockEvents(tx, hotelId, [eventId])).has(eventId)) throw new NotFoundError('Etkinlik bulunamadı');
      const payment = await tx.eventPayment.findFirst({ where: { id: paymentId, eventId, hotelId }, select: EVENT_PAYMENT_SELECT });
      if (!payment) throw new NotFoundError('Ödeme bulunamadı');
      const blocked = paymentVoidError({ ...payment, voidPending: Boolean(payment.voidRequestedAt) });
      if (blocked) throw new ConflictError(blocked, 'PAYMENT_RULE');
      if (payment.kind === 'PAYMENT') {
        const state = await eventPaymentTotals(tx, eventId);
        if (!voidLeavesRefundsCovered({ postedNet: state.postedNet, pendingRefunds: state.pendingRefunds, paymentFolioAmount: money(payment.amount) })) {
          throw new ConflictError('Bu ödemeden iade yapılmış ya da iade bekliyor; iptal edilirse iade edilen para karşılıksız kalır. Önce iadeyi düzeltin.', 'PAYMENT_RULE');
        }
      }
      const event = await tx.event.findFirst({ where: { id: eventId }, select: { code: true, name: true, client: { select: { name: true } } } });
      const what = `${PAYMENT_KIND_LABELS[payment.kind]} ${priced(unsigned(money(payment.amount)), payment.currency)} ${PAYMENT_METHOD_LABELS[payment.method]}`;
      const { approvalId: id } = await requestApproval(tx, stage, {
        hotelId,
        type: EVENT_PAYMENT_APPROVAL_TYPE,
        summary: `Etkinlik ödemesi iptali: ${event.code} · ${event.name} — ${what}`.slice(0, 200),
        reason,
        amount: unsigned(money(payment.amount)),
        currency: payment.currency,
        data: {
          Etkinlik: `${event.code} · ${event.name}`,
          Müşteri: event.client.name,
          Satır: what,
          ...(payment.reference ? { Referans: payment.reference } : {}),
          Alan: payment.receivedBy,
          'Alındığı an': payment.receivedAt.toISOString(),
          'Kasa günü': day(payment.businessDate),
        },
        entityType: 'EventPayment',
        entityId: payment.id,
        requestedBy: actor,
      });
      await tx.eventPayment.update({
        where: { id: payment.id },
        data: { voidApprovalId: id, voidRequestedAt: new Date(), voidRequestedBy: actor, voidReason: reason },
      });
      await recordAudit(tx, { hotelId, entity: 'EventPayment', entityId: payment.id, action: 'UPDATE', before: { voidPending: false }, after: { voidPending: true, approvalId: id, reason } });
      await stage('banquet.payment.changed', { hotelId, eventId, paymentId, change: 'VOID_REQUESTED' });
      return id;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return { approvalId, payment: await readPayment(hotelId, paymentId) };
}

/* ══════════════════ Onay sonucu ══════════════════ */

/**
 * Onay kuyruğunun sonucu (servis dinleyicisi). Satıra bakılarak hangi istek olduğu
 * anlaşılır: iptal onayı mı (`voidApprovalId`), bekleyen tahsilat / iade mi
 * (`approvalId` + `PENDING`). Aynı haber iki kez gelse de bir kez uygulanır
 * (eşleşmeyen satıra dokunulmaz). İsteyenin ziline sonuç düşer.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload
 * @param {{ name: string }} envelope
 * @returns {Promise<{ handled: boolean, applied?: boolean }>}
 */
export async function applyEventPaymentDecision(payload, envelope) {
  if (payload.type !== EVENT_PAYMENT_APPROVAL_TYPE) return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const seed = await prisma.eventPayment.findFirst({ where: { id: approval.entityId, hotelId }, select: { eventId: true } });
  if (!seed) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';
  const { today } = await hotelContext(hotelId);

  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockEvents(tx, hotelId, [seed.eventId]);
    const payment = await tx.eventPayment.findFirst({ where: { id: approval.entityId, hotelId }, select: EVENT_PAYMENT_SELECT });
    if (payment.voidApprovalId === approval.id && payment.voidRequestedAt) {
      return applyVoid(tx, stage, { hotelId, approval, payment, granted, outcomeName, today });
    }
    if (payment.approvalId === approval.id && payment.status === 'PENDING') {
      return applyPending(tx, stage, { hotelId, approval, payment, granted, outcomeName, today });
    }
    return { stale: true };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, granted ? 'GRANTED' : envelope.name, seed.eventId);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Bekleyen tahsilat / iade kararı (etkinlik kilitli). Onaylanınca onay gününün
 * kasasına işlenir.
 * @param {any} tx
 * @param {any} stage
 * @param {{ hotelId: string, approval: any, payment: any, granted: boolean, outcomeName: string, today: string }} input
 */
async function applyPending(tx, stage, { hotelId, approval, payment, granted, outcomeName, today }) {
  if (granted) {
    const now = new Date();
    const updated = await tx.eventPayment.update({
      where: { id: payment.id },
      data: { status: 'POSTED', postedAt: now, businessDate: dateOnly(today) },
      select: EVENT_PAYMENT_SELECT,
    });
    await recomputePaidTotal(tx, payment.eventId);
    await recordAudit(tx, {
      hotelId,
      entity: 'EventPayment',
      entityId: payment.id,
      action: 'UPDATE',
      before: { status: 'PENDING' },
      after: { ...paymentAudit(updated), approvalId: approval.id, decidedBy: approval.decidedBy },
    });
    await stage('banquet.payment.changed', { hotelId, eventId: payment.eventId, paymentId: payment.id, change: 'POSTED' });
    return { applied: true };
  }
  await tx.eventPayment.update({ where: { id: payment.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
  await recordAudit(tx, {
    hotelId,
    entity: 'EventPayment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { status: 'PENDING' },
    after: { status: 'DECLINED', outcome: outcomeName, approvalId: approval.id },
  });
  await stage('banquet.payment.changed', { hotelId, eventId: payment.eventId, paymentId: payment.id, change: 'DECLINED' });
  return { applied: false };
}

/**
 * İptal kararı (etkinlik kilitli): onaylandıysa ters satır yazılır (aynı yöntem,
 * asıl satırı alan kişinin kasasına — para onun çekmecesindeydi).
 * @param {any} tx
 * @param {any} stage
 * @param {{ hotelId: string, approval: any, payment: any, granted: boolean, outcomeName: string, today: string }} input
 */
async function applyVoid(tx, stage, { hotelId, approval, payment, granted, outcomeName, today }) {
  if (granted && payment.status === 'POSTED' && !payment.voidedAt) {
    const now = new Date();
    const voidedBy = approval.decidedBy ?? currentActor();
    const reason = payment.voidReason ?? 'Onaylı iptal';
    const reversal = await tx.eventPayment.create({
      data: {
        hotelId,
        eventId: payment.eventId,
        kind: 'REVERSAL',
        status: 'POSTED',
        method: payment.method,
        amount: toMoneyString(toDecimal(money(payment.amount)).negated()),
        currency: payment.currency,
        businessDate: dateOnly(today),
        reference: payment.reference,
        note: reason.slice(0, 300),
        sourceKey: `event-void:${payment.id}`,
        receivedBy: payment.receivedBy,
        receivedAt: now,
        postedAt: now,
        approvalId: approval.id,
        reversalOfId: payment.id,
      },
      select: { id: true },
    });
    await tx.eventPayment.update({
      where: { id: payment.id },
      data: { voidedAt: now, voidedBy, voidReason: reason, voidRequestedAt: null, voidRequestedBy: null },
    });
    await recomputePaidTotal(tx, payment.eventId);
    await recordAudit(tx, {
      hotelId,
      entity: 'EventPayment',
      entityId: payment.id,
      action: 'UPDATE',
      before: { voided: false },
      after: { voided: true, reversalId: reversal.id, approvalId: approval.id, reason, voidedBy },
    });
    await stage('banquet.payment.changed', { hotelId, eventId: payment.eventId, paymentId: payment.id, change: 'VOIDED' });
    return { applied: true };
  }
  await tx.eventPayment.update({ where: { id: payment.id }, data: { voidRequestedAt: null, voidRequestedBy: null, voidReason: null } });
  await recordAudit(tx, {
    hotelId,
    entity: 'EventPayment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { voidPending: true },
    after: { voidPending: false, outcome: granted ? 'NOT_POSTED' : outcomeName, approvalId: approval.id },
  });
  await stage('banquet.payment.changed', { hotelId, eventId: payment.eventId, paymentId: payment.id, change: 'VOID_DECLINED' });
  return { applied: false };
}

/**
 * İsteyen personelin ziline sonuç (kişi bulunamazsa etkinlik ödeme yetkilisine).
 * @param {string} hotelId
 * @param {{ id: string, type: string, requestedBy: string, note: string | null, summary: string }} approval
 * @param {string} outcome
 * @param {string} eventId
 */
async function alertRequester(hotelId, approval, outcome, eventId) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const titles = {
    GRANTED: `${label} onaylandı: ${approval.summary}`,
    'approval.denied': `${label} reddedildi: ${approval.summary}`,
    'approval.expired': `${label} onayının süresi doldu: ${approval.summary}`,
  };
  const body =
    outcome === 'approval.denied'
      ? `Gerekçe: ${approval.note ?? '—'}. İşlem uygulanmadı; para alındıysa müşteriye geri verin ya da doğru tutarla yeniden girin.`
      : outcome === 'approval.expired'
        ? 'İşlem uygulanmadı. Gerekiyorsa yeniden girin.'
        : null;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: outcome === 'GRANTED' ? 'INFO' : 'WARNING',
      title: (titles[outcome] ?? approval.summary).slice(0, 200),
      body,
      link: `/etkinlikler/${eventId}?sekme=odemeler`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.BANQUET_PAYMENT,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}
