import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { APPROVAL_TYPE_LABELS, PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, paymentVoidError } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { needsLargePaymentApproval, voidLeavesRefundsCovered } from '../payments/rules.js';
import { getSpaAppointment } from './appointments.js';
import { recomputeSpaPaid, spaPaymentTotals } from './money.js';
import { spaPaymentIssue, spaTotal } from './rules.js';
import { dateOnly, lockSpaAppointments, money, prisma, spaContext, wallParts } from './shared.js';

/**
 * Spa kasası (modül 57): randevunun ödemesi, iadesi ve hatalı girişin iptali. Para kuralları modül 17 / 37 ile aynıdır
 * ve satırlar kasada **"Spa"** kaynağıyla görünür:
 *
 * - **Ödeme silinmez.** Hatalı giriş iptal kaydıyla (asıl satırın tersi), misafire geri verilen para iadeyle (eksi
 *   satır) düzeltilir; ikisi de dört göz onaylı.
 * - **Eşik:** otelin büyük ödeme eşiğine eşit / üstü tahsilat onaya gider; onaylanınca randevuya ve kasaya girer.
 * - **Sınır:** açık randevuda fiyatın (vergili) toplamına kadar ön ödeme; kapanmış randevuda kalan bakiye. İade: açıkta
 *   alınan ön ödeme, kapanmışta yalnız borcun üstündeki fazla.
 * - **Tekrar gönderim:** istek kimliği satırın anahtarıdır; aynı istek ikinci kez tahsil edilmez.
 * - Ödeme yazan her işlem **randevuyu kilitler**; alınan toplam ve bakiye aynı transaction'da satırlardan yeniden yazılır.
 */

export const SPA_PAYMENT_APPROVAL_TYPE = 'SPA_PAYMENT';

export const SPA_PAYMENT_SELECT = Object.freeze({
  id: true,
  appointmentId: true,
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

/** Kasada spa ödemesinin dosyası (numara, hizmet, misafir). */
export const SPA_REF_SELECT = Object.freeze({ id: true, code: true, serviceName: true, customerName: true, status: true });

/** @param {any} appointment `SPA_REF_SELECT` */
export const spaRef = (appointment) => ({ id: appointment.id, code: appointment.code, serviceName: appointment.serviceName, customerName: appointment.customerName, status: appointment.status });

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Kullanıcıya yazılan tutar: "2.500,00 TRY". @param {string} amount @param {string} currency */
const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;
/** @param {string} amount */
const unsigned = (amount) => toMoneyString(toDecimal(amount).abs());

const APPOINTMENT_MONEY_SELECT = Object.freeze({ id: true, code: true, serviceName: true, customerName: true, roomNumber: true, status: true, startsAt: true, price: true, totalDue: true, roomChargeTotal: true });

/** @param {any} row */
const paymentAudit = (row) => ({ kind: row.kind, status: row.status, method: row.method, amount: money(row.amount), currency: row.currency, reference: row.reference, approvalId: row.approvalId });

/**
 * Ödemenin randevusu (onay ekranının "aç" bağlantısı ödeme kimliğiyle gelir).
 * @param {string} hotelId @param {string} paymentId
 */
export async function findSpaPaymentAppointment(hotelId, paymentId) {
  const row = await prisma.spaPayment.findFirst({ where: { id: paymentId, hotelId }, select: { appointmentId: true } });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return { appointmentId: row.appointmentId };
}

/* ══════════════════ Tahsilat ve iade ══════════════════ */

/**
 * Tahsilat ya da iade. İade her zaman, eşik üstü tahsilat da onaya gider (`PENDING`); onaylanınca işlenir.
 *
 * @param {string} hotelId @param {string} appointmentId
 * @param {{ requestId: string, kind: 'PAYMENT' | 'REFUND', method: 'CASH' | 'CARD', amount: string, reference?: string | null, note?: string | null }} input
 */
export async function receiveSpaPayment(hotelId, appointmentId, input) {
  const context = await spaContext(hotelId);
  const { hotel, currency, today, taxes, timezone } = context;
  const actor = currentActor();
  const sourceKey = `spa:${input.requestId}`;
  let outcome;
  try {
    outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaAppointments(tx, hotelId, [appointmentId])).has(appointmentId)) throw new NotFoundError('Randevu bulunamadı');
      const existing = await tx.spaPayment.findFirst({ where: { hotelId, sourceKey }, select: { id: true, appointmentId: true } });
      if (existing) {
        if (existing.appointmentId !== appointmentId) throw new ConflictError('Bu istek başka bir randevunun ödemesinde kullanıldı; formu yenileyin.', 'DUPLICATE_REQUEST');
        return { paymentId: existing.id, created: false };
      }
      const appointment = await tx.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: APPOINTMENT_MONEY_SELECT });
      const state = await spaPaymentTotals(tx, appointmentId);
      const priceTotal = spaTotal(money(appointment.price), taxes);
      const issue = spaPaymentIssue({ kind: input.kind, amount: input.amount, status: appointment.status, priceTotal, totalDue: money(appointment.totalDue), roomChargeTotal: money(appointment.roomChargeTotal), state });
      if (issue) throw new ValidationError(issue.message, { field: 'amount', limit: issue.limit });

      const refund = input.kind === 'REFUND';
      const signed = refund ? toMoneyString(toDecimal(input.amount).negated()) : toMoneyString(input.amount);
      const pending = refund || needsLargePaymentApproval(input.amount, String(hotel.largePaymentThreshold ?? 0));
      const paymentId = randomUUID();
      let approvalId = null;
      if (pending) {
        const local = wallParts(appointment.startsAt, timezone);
        const label = `${appointment.code} · ${appointment.serviceName}`;
        ({ approvalId } = await requestApproval(tx, stage, {
          hotelId,
          type: SPA_PAYMENT_APPROVAL_TYPE,
          summary: `${refund ? 'Spa iadesi' : 'Büyük spa ödemesi'}: ${label} — ${priced(input.amount, currency)} ${PAYMENT_METHOD_LABELS[input.method]}`.slice(0, 200),
          reason: refund ? (input.note ?? 'Misafire iade') : `Tutar büyük ödeme eşiğine (${priced(money(hotel.largePaymentThreshold), hotel.currency)}) eşit ya da üstünde`,
          amount: toMoneyString(input.amount),
          currency,
          // Onay ekranı veriyi yorumlamadan gösterir: onaylayanın okuyacağı etiketlerle.
          data: {
            Randevu: label,
            Misafir: `${appointment.customerName}${appointment.roomNumber ? ` · oda ${appointment.roomNumber}` : ''}`,
            'Randevu saati': `${local.day.split('-').reverse().join('.')} ${local.time}`,
            Tür: PAYMENT_KIND_LABELS[input.kind],
            Yöntem: PAYMENT_METHOD_LABELS[input.method],
            Tutar: priced(input.amount, currency),
            ...(input.reference ? { Referans: input.reference } : {}),
            ...(input.note ? { Not: input.note } : {}),
            'Randevunun tutarı': priced(priceTotal, currency),
            'Şu an alınan': priced(state.postedNet, currency),
            Alan: actor,
          },
          entityType: 'SpaPayment',
          entityId: paymentId,
          requestedBy: actor,
        }));
      }

      const now = new Date();
      const created = await tx.spaPayment.create({
        data: {
          id: paymentId,
          hotelId,
          appointmentId,
          kind: input.kind,
          status: pending ? 'PENDING' : 'POSTED',
          method: input.method,
          amount: signed,
          currency,
          businessDate: dateOnly(today),
          reference: input.reference ?? null,
          note: input.note ?? null,
          sourceKey,
          receivedBy: actor,
          receivedAt: now,
          postedAt: pending ? null : now,
          approvalId,
        },
        select: SPA_PAYMENT_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: paymentId, action: 'CREATE', after: { appointment: appointment.code, ...paymentAudit(created) } });
      if (!pending) await recomputeSpaPaid(tx, appointmentId);
      await stage('spa.payment.changed', { hotelId, appointmentId, paymentId, change: pending ? 'PENDING' : 'RECEIVED' });
      return { paymentId, created: true };
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu ödeme az önce kaydedildi; ekranı yenileyin.' });
  }
  return { ...(await getSpaAppointment(hotelId, appointmentId)), paymentId: outcome.paymentId, created: outcome.created };
}

/**
 * Hatalı girişin iptali (yanlış tutar, yanlış yöntem, çift giriş): onaya gider; onaylanınca asıl satırın tersi işlenir.
 * Misafire para geri verilecekse bu değil iadedir. İade edilmiş paranın tahsilatı iptal edilemez.
 *
 * @param {string} hotelId @param {string} appointmentId @param {string} paymentId @param {{ reason: string }} input
 */
export async function requestSpaPaymentVoid(hotelId, appointmentId, paymentId, { reason }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaAppointments(tx, hotelId, [appointmentId])).has(appointmentId)) throw new NotFoundError('Randevu bulunamadı');
      const payment = await tx.spaPayment.findFirst({ where: { id: paymentId, appointmentId, hotelId }, select: SPA_PAYMENT_SELECT });
      if (!payment) throw new NotFoundError('Ödeme bulunamadı');
      const blocked = paymentVoidError({ ...payment, voidPending: Boolean(payment.voidRequestedAt) });
      if (blocked) throw new ConflictError(blocked, 'PAYMENT_RULE');
      if (payment.kind === 'PAYMENT') {
        const state = await spaPaymentTotals(tx, appointmentId);
        if (!voidLeavesRefundsCovered({ postedNet: state.postedNet, pendingRefunds: state.pendingRefunds, paymentFolioAmount: money(payment.amount) })) {
          throw new ConflictError('Bu ödemeden iade yapılmış ya da iade bekliyor; iptal edilirse iade edilen para karşılıksız kalır. Önce iadeyi düzeltin.', 'PAYMENT_RULE');
        }
      }
      const appointment = await tx.spaAppointment.findFirst({ where: { id: appointmentId }, select: APPOINTMENT_MONEY_SELECT });
      const label = `${appointment.code} · ${appointment.serviceName}`;
      const what = `${PAYMENT_KIND_LABELS[payment.kind]} ${priced(unsigned(money(payment.amount)), payment.currency)} ${PAYMENT_METHOD_LABELS[payment.method]}`;
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: SPA_PAYMENT_APPROVAL_TYPE,
        summary: `Spa ödemesi iptali: ${label} — ${what}`.slice(0, 200),
        reason,
        amount: unsigned(money(payment.amount)),
        currency: payment.currency,
        data: {
          Randevu: label,
          Misafir: `${appointment.customerName}${appointment.roomNumber ? ` · oda ${appointment.roomNumber}` : ''}`,
          Satır: what,
          ...(payment.reference ? { Referans: payment.reference } : {}),
          Alan: payment.receivedBy,
          'Alındığı an': payment.receivedAt.toISOString(),
          'Kasa günü': payment.businessDate.toISOString().slice(0, 10),
          İsteyen: actor,
        },
        entityType: 'SpaPayment',
        entityId: payment.id,
        requestedBy: actor,
      });
      await tx.spaPayment.update({ where: { id: payment.id }, data: { voidApprovalId: approvalId, voidRequestedAt: new Date(), voidRequestedBy: actor, voidReason: reason } });
      await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: payment.id, action: 'UPDATE', before: { voidPending: false }, after: { voidPending: true, approvalId, reason } });
      await stage('spa.payment.changed', { hotelId, appointmentId, paymentId, change: 'VOID_REQUESTED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ Onay sonucu ══════════════════ */

/**
 * Onay kuyruğunun sonucu (servis dinleyicisi). Satıra bakılarak hangi istek olduğu anlaşılır: iptal onayı mı
 * (`voidApprovalId`), bekleyen tahsilat / iade mi (`approvalId` + `PENDING`). Aynı haber iki kez gelse de bir kez
 * uygulanır. İsteyenin ziline sonuç düşer.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload @param {{ name: string }} envelope
 * @returns {Promise<{ handled: boolean, applied?: boolean }>}
 */
export async function applySpaPaymentDecision(payload, envelope) {
  if (payload.type !== SPA_PAYMENT_APPROVAL_TYPE) return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const seed = await prisma.spaPayment.findFirst({ where: { id: approval.entityId, hotelId }, select: { appointmentId: true } });
  if (!seed) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';
  const { today, taxes } = await spaContext(hotelId);

  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockSpaAppointments(tx, hotelId, [seed.appointmentId]);
    const payment = await tx.spaPayment.findFirst({ where: { id: approval.entityId, hotelId }, select: SPA_PAYMENT_SELECT });
    const input = { hotelId, approval, payment, granted, outcomeName, today, taxes };
    if (payment.voidApprovalId === approval.id && payment.voidRequestedAt) return applyVoid(tx, stage, input);
    if (payment.approvalId === approval.id && payment.status === 'PENDING') return applyPending(tx, stage, input);
    return { stale: true };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, granted ? (outcome.applied ? 'GRANTED' : 'FAILED') : envelope.name, seed.appointmentId, outcome.failure ?? null);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Bekleyen tahsilat / iade kararı (randevu kilitli). Onaylansa da tutar artık sınırı aşıyorsa (randevu bu arada
 * kapandı, başka ödeme alındı, odaya yazıldı) işlenmez: reddedilmiş sayılır, sebebi isteyene yazılır.
 * @param {any} tx @param {Function} stage @param {any} input
 */
async function applyPending(tx, stage, { hotelId, approval, payment, granted, outcomeName, today, taxes }) {
  let failure = null;
  if (granted) {
    const [appointment, state] = await Promise.all([tx.spaAppointment.findFirst({ where: { id: payment.appointmentId }, select: APPOINTMENT_MONEY_SELECT }), spaPaymentTotals(tx, payment.appointmentId)]);
    // Sınır, bu satır yokmuş gibi yeniden hesaplanır (kendisi bekleyenlerin içinde).
    const amount = unsigned(money(payment.amount));
    const without = payment.kind === 'REFUND' ? { ...state, pendingRefunds: toMoneyString(toDecimal(state.pendingRefunds).plus(toDecimal(amount))) } : { ...state, pendingPayments: toMoneyString(toDecimal(state.pendingPayments).minus(toDecimal(amount))) };
    const issue = spaPaymentIssue({ kind: payment.kind, amount, status: appointment.status, priceTotal: spaTotal(money(appointment.price), taxes), totalDue: money(appointment.totalDue), roomChargeTotal: money(appointment.roomChargeTotal), state: without });
    if (issue) failure = `${issue.message} İşlem uygulanmadı.`;
  }
  if (granted && !failure) {
    const now = new Date();
    const updated = await tx.spaPayment.update({ where: { id: payment.id }, data: { status: 'POSTED', postedAt: now, businessDate: dateOnly(today) }, select: SPA_PAYMENT_SELECT });
    await recomputeSpaPaid(tx, payment.appointmentId);
    await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: payment.id, action: 'UPDATE', before: { status: 'PENDING' }, after: { ...paymentAudit(updated), decidedBy: approval.decidedBy } });
    await stage('spa.payment.changed', { hotelId, appointmentId: payment.appointmentId, paymentId: payment.id, change: 'POSTED' });
    return { applied: true };
  }
  await tx.spaPayment.update({ where: { id: payment.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
  await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: payment.id, action: 'UPDATE', before: { status: 'PENDING' }, after: { status: 'DECLINED', outcome: granted ? failure : outcomeName, approvalId: approval.id } });
  await stage('spa.payment.changed', { hotelId, appointmentId: payment.appointmentId, paymentId: payment.id, change: 'DECLINED' });
  return { applied: false, failure };
}

/**
 * İptal kararı (randevu kilitli): onaylandıysa ters satır yazılır (aynı yöntem, asıl satırı alan kişinin kasasına).
 * @param {any} tx @param {Function} stage @param {any} input
 */
async function applyVoid(tx, stage, { hotelId, approval, payment, granted, outcomeName, today }) {
  let failure = null;
  if (granted) {
    if (payment.status !== 'POSTED' || payment.voidedAt) failure = 'Ödeme işlenmiş değil ya da zaten iptal edilmiş; iptal uygulanmadı.';
    else if (payment.kind === 'PAYMENT') {
      const state = await spaPaymentTotals(tx, payment.appointmentId);
      if (!voidLeavesRefundsCovered({ postedNet: state.postedNet, pendingRefunds: state.pendingRefunds, paymentFolioAmount: money(payment.amount) })) failure = 'Bu ödemeden bu arada iade yapıldı; iptal uygulanmadı.';
    }
  }
  if (granted && !failure) {
    const now = new Date();
    const voidedBy = approval.decidedBy ?? currentActor();
    const reason = payment.voidReason ?? 'Onaylı iptal';
    const reversal = await tx.spaPayment.create({
      data: {
        hotelId,
        appointmentId: payment.appointmentId,
        kind: 'REVERSAL',
        status: 'POSTED',
        method: payment.method,
        amount: toMoneyString(toDecimal(money(payment.amount)).negated()),
        currency: payment.currency,
        businessDate: dateOnly(today),
        reference: payment.reference,
        note: reason.slice(0, 200),
        sourceKey: `spa-void:${payment.id}`,
        receivedBy: payment.receivedBy,
        receivedAt: now,
        postedAt: now,
        approvalId: approval.id,
        reversalOfId: payment.id,
      },
      select: { id: true },
    });
    await tx.spaPayment.update({ where: { id: payment.id }, data: { voidedAt: now, voidedBy, voidReason: reason, voidRequestedAt: null, voidRequestedBy: null } });
    await recomputeSpaPaid(tx, payment.appointmentId);
    await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: payment.id, action: 'UPDATE', before: { voided: false }, after: { voided: true, reversalId: reversal.id, approvalId: approval.id, reason, voidedBy } });
    await stage('spa.payment.changed', { hotelId, appointmentId: payment.appointmentId, paymentId: payment.id, change: 'VOIDED' });
    return { applied: true };
  }
  await tx.spaPayment.update({ where: { id: payment.id }, data: { voidRequestedAt: null, voidRequestedBy: null, voidReason: null } });
  await recordAudit(tx, { hotelId, entity: 'SpaPayment', entityId: payment.id, action: 'UPDATE', before: { voidPending: true }, after: { voidPending: false, outcome: granted ? failure : outcomeName, approvalId: approval.id } });
  await stage('spa.payment.changed', { hotelId, appointmentId: payment.appointmentId, paymentId: payment.id, change: 'VOID_DECLINED' });
  return { applied: false, failure };
}

/**
 * İsteyen personelin ziline sonuç (kişi bulunamazsa spa kasası yetkilisine).
 * @param {string} hotelId @param {{ id: string, type: string, requestedBy: string, note: string | null, summary: string }} approval
 * @param {string} outcome @param {string} appointmentId @param {string | null} failure
 */
async function alertRequester(hotelId, approval, outcome, appointmentId, failure) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const titles = {
    GRANTED: `${label} onaylandı: ${approval.summary}`,
    FAILED: `${label} onaylandı ama uygulanamadı: ${approval.summary}`,
    'approval.denied': `${label} reddedildi: ${approval.summary}`,
    'approval.expired': `${label} onayının süresi doldu: ${approval.summary}`,
  };
  const body =
    outcome === 'FAILED'
      ? failure
      : outcome === 'approval.denied'
        ? `Gerekçe: ${approval.note ?? '—'}. İşlem uygulanmadı; para alındıysa misafire geri verin ya da doğru tutarla yeniden girin.`
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
      link: `/spa/randevular/${appointmentId}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.SPA_PAYMENT,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}
