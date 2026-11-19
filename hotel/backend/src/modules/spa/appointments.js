import { currentActor, toDecimal } from '@hotelos/core';
import { SPA_ACTIVE_STATUSES, SPA_CLOSED_STATUSES, SPA_MAX_ADVANCE_DAYS, spaDaysBetween } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { MATCH_NOTHING, containsText, matchGuestIds, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { chargePostingStatus } from '../extras/posting-status.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { postSpaRoomCharge, spaPaymentTotals } from './money.js';
import { sendSpaNotification } from './notify.js';
import { spaBalance, spaFee, spaListPrice, spaPayableLimit, spaRefundLimit, spaRestoreBlock, spaTotal } from './rules.js';
import { loadBookableService, placeOnBoard, writeHolds } from './schedule.js';
import { SPA_STAY_STATUSES, adjustSeats, promoteWaitlist, resolveSpaCustomer } from './seats.js';
import { dayBounds, fullName, iso, loadSpaSettings, lockSpaAppointments, lockSpaSessions, money, nextSpaCode, prisma, sameVersion, spaContext, wallParts, wallToUtc } from './shared.js';

/**
 * Spa randevusu (modül 57): aç, yeniden planla, fiyatla, tamamla, iptal et / gelmedi işaretle, geri al, odaya yaz.
 *
 * - **Yerleştirme:** saat için terapist(ler) ve oda seçilir (personel isterse kendisi seçer); tutmalar `SpaHold`'a
 *   yazılır. Aynı saati iki kişi alırsa ikincisini EXCLUDE kısıtı reddeder; otomatik atamada iş baştan denenir
 *   (başka terapist / oda boşsa randevu yine açılır).
 * - **Borç:** açık randevunun borcu yoktur. Tamamlanınca fiyat, geç iptal / gelmedide bedel borç olur; oteldeki
 *   misafirde odaya yazılır (istenirse kasada ödenir), dışarıdan gelende kasada ödenir.
 * - **İyimser kilit:** her yazım `updatedAt` ile; randevu satırı işlem boyunca kilitlidir (grup dersinde önce seans).
 * - Tamamlanan randevunun tutmaları etkin kalır (saat gerçekten kullanıldı); iptal / gelmedide yer açılır.
 */

/** Personel, bugünün geçmiş saatine randevu yazabilir (gelen misafir sonradan girilir); önceki günlere yazamaz. */
const PAST_DAY_MESSAGE = 'Geçmiş güne randevu açılmaz.';
const SLOT_TAKEN_HINT = 'Bu saat az önce doldu; başka bir saat seçin.';
const SESSION_CLOSED_RESTORE = 'Seans kapanmış (yapıldı ya da iptal); kayıt geri alınamaz.';

const HOLD_SELECT = Object.freeze({ therapistId: true, roomId: true, active: true, therapist: { select: { name: true } }, room: { select: { name: true } } });

export const APPOINTMENT_SELECT = Object.freeze({
  id: true,
  code: true,
  serviceId: true,
  sessionId: true,
  serviceName: true,
  category: true,
  kind: true,
  startsAt: true,
  endsAt: true,
  busyUntil: true,
  guestCount: true,
  reservationId: true,
  guestId: true,
  customerName: true,
  customerPhone: true,
  roomNumber: true,
  status: true,
  source: true,
  therapistPreference: true,
  note: true,
  listPrice: true,
  price: true,
  priceReason: true,
  priceBy: true,
  feePct: true,
  feeWaivedBy: true,
  feeWaiveReason: true,
  amountDue: true,
  totalDue: true,
  paidTotal: true,
  roomChargeTotal: true,
  balance: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  completedBy: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  holds: { select: HOLD_SELECT },
  reservation: { select: { id: true, confirmationCode: true, status: true, room: { select: { number: true } } } },
  session: { select: { status: true, holds: { select: HOLD_SELECT } } },
});

/**
 * @param {any} row `APPOINTMENT_SELECT`
 * @param {{ timezone: string, taxes: any[], settings: any, now: Date }} view
 */
export function appointmentView(row, { timezone, taxes, settings, now }) {
  const start = wallParts(row.startsAt, timezone);
  const end = wallParts(row.endsAt, timezone);
  // Grup dersinde eğitmen ve salon seansın; birebirde randevunun kendi tutmaları (iptalde de kim atanmıştı görünür).
  const holds = row.sessionId ? (row.session?.holds ?? []) : row.holds;
  const price = money(row.price);
  const fee = row.status === 'BOOKED' ? spaFee({ price, startsAt: row.startsAt, at: now, outcome: 'CANCELLED', settings }) : null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    serviceId: row.serviceId,
    sessionId: row.sessionId,
    serviceName: row.serviceName,
    category: row.category,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    day: start.day,
    time: start.time,
    endTime: end.time,
    startsAtWall: start.wall,
    durationMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
    started: row.startsAt <= now,
    guestCount: row.guestCount,
    reservationId: row.reservationId,
    reservation: row.reservation ? { id: row.reservation.id, confirmationCode: row.reservation.confirmationCode, status: row.reservation.status, roomNumber: row.reservation.room?.number ?? null } : null,
    inHouse: row.reservation?.status === 'CHECKED_IN',
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    roomNumber: row.roomNumber,
    status: row.status,
    source: row.source,
    therapistPreference: row.therapistPreference,
    note: row.note,
    therapists: holds.filter((hold) => hold.therapistId).map((hold) => ({ id: hold.therapistId, name: hold.therapist?.name ?? '—' })),
    room: holds.filter((hold) => hold.roomId).map((hold) => ({ id: hold.roomId, name: hold.room?.name ?? '—' }))[0] ?? null,
    listPrice: money(row.listPrice),
    price,
    /** Misafirin ödeyeceği (hariç vergiler eklenmiş). */
    priceTotal: spaTotal(price, taxes),
    priceReason: row.priceReason,
    priceBy: row.priceBy,
    /** Şimdi iptal edilirse doğacak bedel (yalnız açık randevuda). */
    cancelFee: fee ? { pct: fee.pct, total: spaTotal(fee.amount, taxes), late: fee.late } : null,
    feePct: row.feePct === null ? null : money(row.feePct),
    feeWaivedBy: row.feeWaivedBy,
    feeWaiveReason: row.feeWaiveReason,
    amountDue: money(row.amountDue),
    totalDue: money(row.totalDue),
    paidTotal: money(row.paidTotal),
    roomChargeTotal: money(row.roomChargeTotal),
    balance: money(row.balance),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    completedAt: iso(row.completedAt),
    completedBy: row.completedBy,
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
  };
}

/** Ekranların ortak bağlamı: saat dilimi, vergiler, politika, şimdi. @param {string} hotelId @param {Date} [now] */
export async function spaViewContext(hotelId, now = new Date()) {
  const [context, settings] = await Promise.all([spaContext(hotelId, now), loadSpaSettings(prisma, hotelId)]);
  return { ...context, settings };
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Randevu listesi (gün aralığı, başlangıç sırasıyla): durum, hizmet, terapist ve arama (numara, ad, oda) süzgeçleri;
 * "açık bakiyeler" görünümü kapanmış ama bakiyesi sıfır olmayanları verir. Üstte aralığın durum sayıları.
 *
 * @param {string} hotelId
 * @param {{ from: string, to: string, view: 'ALL' | 'OPEN_BALANCE', status?: string, serviceId?: string, therapistId?: string, search?: string, page: number, pageSize: number }} query
 */
export async function listSpaAppointments(hotelId, query) {
  const view = await spaViewContext(hotelId);
  const range = { gte: dayBounds(query.from, view.timezone).start, lt: dayBounds(query.to, view.timezone).end };
  /** @type {any[]} */
  const and = [];
  if (query.view === 'OPEN_BALANCE') and.push({ status: { in: SPA_CLOSED_STATUSES }, balance: { not: 0 } });
  if (query.serviceId) and.push({ serviceId: query.serviceId });
  if (query.therapistId) and.push({ OR: [{ holds: { some: { therapistId: query.therapistId } } }, { session: { holds: { some: { therapistId: query.therapistId } } } }] });
  if (query.search) {
    const text = query.search;
    and.push({ OR: [{ code: text.toUpperCase() }, { roomNumber: text }, { customerName: containsText(text) }] });
  }
  const scope = { hotelId, startsAt: range, AND: and };
  const where = query.status ? { ...scope, status: query.status } : scope;
  const [rows, total, groups] = await Promise.all([
    prisma.spaAppointment.findMany({ where, select: APPOINTMENT_SELECT, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.spaAppointment.count({ where }),
    prisma.spaAppointment.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
  ]);
  return {
    ...buildPage(rows.map((row) => appointmentView(row, view)), total, query),
    counts: Object.fromEntries(groups.map((group) => [group.status, group._count._all])),
    currency: view.currency,
  };
}

/** Randevu ekranında gösterilen en fazla ödeme satırı. */
const DETAIL_PAYMENT_LIMIT = 100;

/**
 * Randevunun ayrıntısı: kayıt, ödemeler (son alınan önce), odaya yazılanlar (folyoya işlenme durumuyla) ve hesap özeti.
 * @param {string} hotelId @param {string} appointmentId
 */
export async function getSpaAppointment(hotelId, appointmentId) {
  const view = await spaViewContext(hotelId);
  const [row, payments, charges, state] = await Promise.all([
    prisma.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: APPOINTMENT_SELECT }),
    prisma.spaPayment.findMany({ where: { hotelId, appointmentId }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: DETAIL_PAYMENT_LIMIT }),
    prisma.spaRoomCharge.findMany({ where: { hotelId, appointmentId }, orderBy: { chargedAt: 'desc' }, take: 20 }),
    spaPaymentTotals(prisma, appointmentId),
  ]);
  if (!row) throw new NotFoundError('Randevu bulunamadı');
  const posting = await chargePostingStatus(hotelId, charges.map((charge) => charge.eventId));
  const appointment = appointmentView(row, view);
  const totals = { status: row.status, priceTotal: appointment.priceTotal, totalDue: appointment.totalDue, roomChargeTotal: appointment.roomChargeTotal, state };
  return {
    appointment,
    currency: view.currency,
    payments: payments.map(paymentView),
    roomCharges: charges.map((charge) => ({
      id: charge.id,
      roomNumber: charge.roomNumber,
      guestName: charge.guestName,
      total: money(charge.total),
      chargedBy: charge.chargedBy,
      chargedAt: iso(charge.chargedAt),
      posting: posting.get(charge.eventId) ?? { status: 'PENDING' },
    })),
    summary: { ...state, payable: spaPayableLimit(totals), refundable: spaRefundLimit(totals), restoreBlock: restoreBlockOf(row, state) },
  };
}

/**
 * Kapanmış randevunun geri alınma engeli (ekran düğmeyi buna göre gösterir; son söz `restoreSpaAppointment`'ta).
 * @param {any} row @param {{ postedNet: string, pendingPayments: string, pendingRefunds: string }} state @returns {string | null}
 */
function restoreBlockOf(row, state) {
  if (!SPA_CLOSED_STATUSES.includes(row.status)) return null;
  const blocked = spaRestoreBlock({ status: row.status, roomChargeTotal: money(row.roomChargeTotal), state });
  if (blocked) return blocked;
  return row.sessionId && row.session?.status !== 'SCHEDULED' ? SESSION_CLOSED_RESTORE : null;
}

/** @param {any} row */
export function paymentView(row) {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    kind: row.kind,
    status: row.status,
    method: row.method,
    amount: money(row.amount),
    currency: row.currency,
    businessDate: row.businessDate.toISOString().slice(0, 10),
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

/** Randevu formunun misafir araması en fazla bu kadar konaklama döner. */
const STAY_RESULT_LIMIT = 20;

/**
 * Randevu formu için konaklama araması: oda numarası (birebir) ya da misafir adı / soyadı; içerideki ve gelecek
 * (ayrılışı geçmemiş) konaklamalar, içeridekiler önce.
 * @param {string} hotelId @param {{ search: string }} query
 */
export async function searchSpaStays(hotelId, { search }) {
  const { today } = await spaContext(hotelId);
  const and = [];
  for (const token of searchTokens(search)) {
    const [roomIds, guestIds] = await Promise.all([matchRoomIdsByNumber(prisma, hotelId, token), token.length >= 2 ? matchGuestIds(prisma, hotelId, token) : []]);
    const or = [...(roomIds.length ? [{ roomId: { in: roomIds } }] : []), ...(guestIds.length ? [{ guestId: { in: guestIds } }] : [])];
    and.push(or.length ? { OR: or } : MATCH_NOTHING);
  }
  const rows = await prisma.reservation.findMany({
    where: { hotelId, status: { in: ['CHECKED_IN', 'CONFIRMED'] }, checkOut: { gte: new Date(`${today}T00:00:00.000Z`) }, AND: and },
    orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    take: STAY_RESULT_LIMIT,
    select: { id: true, confirmationCode: true, status: true, checkIn: true, checkOut: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  });
  return {
    stays: rows
      .map((row) => ({
        id: row.id,
        confirmationCode: row.confirmationCode,
        status: row.status,
        roomNumber: row.room?.number ?? null,
        guestName: fullName(row.guest) ?? '—',
        checkIn: row.checkIn.toISOString().slice(0, 10),
        checkOut: row.checkOut.toISOString().slice(0, 10),
      }))
      .sort((a, b) => Number(b.status === 'CHECKED_IN') - Number(a.status === 'CHECKED_IN')),
  };
}

/* ══════════════════ Ortak ══════════════════ */

const LOCKED_SELECT = Object.freeze({ ...APPOINTMENT_SELECT });

/**
 * Randevuyu kilitler (grup dersinde önce seansı) ve güncel hâlini okur.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} appointmentId
 */
export async function lockedAppointment(tx, hotelId, appointmentId) {
  const seed = await tx.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: { sessionId: true } });
  if (!seed) throw new NotFoundError('Randevu bulunamadı');
  if (seed.sessionId) await lockSpaSessions(tx, hotelId, [seed.sessionId]);
  await lockSpaAppointments(tx, hotelId, [appointmentId]);
  return tx.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: LOCKED_SELECT });
}

/** @param {{ updatedAt: Date }} row @param {Date | null | undefined} expected */
function assertFresh(row, expected) {
  if (expected && !sameVersion(row.updatedAt, expected)) throw new StaleWriteError();
}

/** @param {any} row */
const auditOf = (row) => ({
  code: row.code,
  service: row.serviceName,
  startsAt: iso(row.startsAt),
  status: row.status,
  customer: row.customerName,
  room: row.roomNumber,
  price: money(row.price),
  amountDue: money(row.amountDue),
  totalDue: money(row.totalDue),
});

/** @param {'CANCELLED' | 'NO_SHOW'} outcome @param {string} serviceName */
const feeLabel = (outcome, serviceName) => `${outcome === 'NO_SHOW' ? 'Spa gelmedi bedeli' : 'Spa geç iptal bedeli'} · ${serviceName}`;

/* ══════════════════ Aç ══════════════════ */

/**
 * Randevu açar. Terapist / oda verilmediyse uygun olanlar atanır (tercih edilen cinsiyet gözetilir). Aynı istek
 * kimliğiyle ikinci gönderim yeni randevu açmaz.
 *
 * @param {string} hotelId
 * @param {{ requestId: string, serviceId: string, startsAt: string, reservationId: string | null, customerName?: string | null, customerPhone?: string | null, therapistIds?: string[] | null, roomId?: string | null, therapistPreference?: string | null, note?: string | null }} input
 * @param {{ source?: 'STAFF' | 'PORTAL', earliest?: Date | null, now?: Date, logger?: any }} [options]
 *   `earliest`: portalda en erken başlangıç (şimdi + ayardaki süre)
 */
export async function createSpaAppointment(hotelId, input, { source = 'STAFF', earliest = null, now = new Date(), logger = console } = {}) {
  const [context, settings] = await Promise.all([spaContext(hotelId, now), loadSpaSettings(prisma, hotelId)]);
  const startsAt = wallToUtc(input.startsAt, context.timezone);
  const localDay = input.startsAt.slice(0, 10);
  if (localDay < context.today) throw new ValidationError(PAST_DAY_MESSAGE, { field: 'startsAt' });
  if (earliest && startsAt < earliest) throw new ValidationError('Bu saat için artık randevu alınamıyor; daha ileri bir saat seçin.', { field: 'startsAt' });
  if (spaDaysBetween(context.today, localDay) > SPA_MAX_ADVANCE_DAYS) throw new ValidationError(`Randevu en fazla ${SPA_MAX_ADVANCE_DAYS} gün ileriye açılır.`, { field: 'startsAt' });

  const requestKey = `${source === 'PORTAL' ? 'portal' : 'staff'}:${input.requestId}`;
  const automatic = !input.therapistIds && !input.roomId;
  const actor = currentActor();
  /** @type {{ id: string, created: boolean }} */
  let outcome;
  for (let attempt = 1; ; attempt += 1) {
    try {
      outcome = await writeWithEvents(async (tx, stage) => {
        const existing = await tx.spaAppointment.findFirst({ where: { hotelId, requestKey }, select: { id: true } });
        if (existing) return { id: existing.id, created: false };
        const service = await loadBookableService(tx, hotelId, input.serviceId);
        if (source === 'PORTAL' && !service.portalBookable) throw new NotFoundError('Hizmet bulunamadı');
        if (input.therapistIds && input.therapistIds.length !== service.therapistCount) {
          throw new ValidationError(service.therapistCount === 0 ? 'Bu hizmet terapist gerektirmez.' : `Bu hizmet için ${service.therapistCount} terapist seçin (boş bırakırsanız otomatik atanır).`, { field: 'therapistIds' });
        }
        if (input.roomId && !service.requiresRoom) throw new ValidationError('Bu hizmet oda gerektirmez.', { field: 'roomId' });
        const customer = await resolveSpaCustomer(tx, hotelId, input);
        const place = await placeOnBoard(tx, hotelId, { service, startsAt, timezone: context.timezone, settings, therapistIds: input.therapistIds ?? null, roomId: input.roomId ?? null, gender: input.therapistPreference ?? null });
        const listPrice = spaListPrice(money(service.price), service.guestCount);
        const row = await tx.spaAppointment.create({
          data: {
            hotelId,
            code: await nextSpaCode(tx, hotelId, Number(localDay.slice(0, 4))),
            serviceId: service.id,
            serviceName: service.name,
            category: service.category,
            kind: 'PRIVATE',
            startsAt,
            endsAt: place.endsAt,
            busyUntil: place.busyUntil,
            guestCount: service.guestCount,
            ...customer,
            status: 'BOOKED',
            source,
            therapistPreference: input.therapistPreference ?? null,
            note: input.note ?? null,
            listPrice,
            price: listPrice,
            requestKey,
            createdBy: actor,
          },
          select: APPOINTMENT_SELECT,
        });
        await writeHolds(tx, hotelId, { appointmentId: row.id, therapistIds: place.therapistIds, roomId: place.roomId, startsAt, busyUntil: place.busyUntil });
        await recordAudit(tx, { hotelId, entity: 'SpaAppointment', entityId: row.id, action: 'CREATE', after: { ...auditOf(row), source, therapistIds: place.therapistIds, roomId: place.roomId } });
        await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: null, change: 'BOOKED', source });
        if (source === 'PORTAL') {
          const local = wallParts(startsAt, context.timezone);
          await raiseStaffAlert(tx, stage, {
            hotelId,
            kind: 'SPA',
            severity: 'INFO',
            title: `Portaldan randevu: ${service.name} · ${local.day.split('-').reverse().join('.')} ${local.time}`.slice(0, 200),
            body: `${customer.customerName}${customer.roomNumber ? ` · oda ${customer.roomNumber}` : ''} · ${row.code}`,
            link: `/spa/randevular/${row.id}`,
            permission: PERMISSIONS.SPA_BOOK,
            entityType: 'SpaAppointment',
            entityId: row.id,
            dedupeKey: `spa-booked:${row.id}`,
          });
        }
        return { id: row.id, created: true };
      });
      break;
    } catch (error) {
      const mapped = mapError(error, 'Bu randevu az önce kaydedildi; ekranı yenileyin.');
      // Aynı istek aynı anda iki kez geldi: ilki kazandı, onu döndür.
      if (mapped.code === 'DUPLICATE') {
        const existing = await prisma.spaAppointment.findFirst({ where: { hotelId, requestKey }, select: { id: true } });
        if (existing) {
          outcome = { id: existing.id, created: false };
          break;
        }
      }
      // Otomatik atamada yarış: seçilen terapisti / odayı başkası aldı; başka uygun olan varsa onunla açılır.
      if (automatic && attempt < 3 && mapped.code === 'SPA_SLOT_TAKEN' && mapped.details?.constraint) continue;
      if (mapped.code === 'SPA_SLOT_TAKEN' && mapped.details?.constraint) throw new ConflictError(SLOT_TAKEN_HINT, 'SPA_SLOT_TAKEN', { field: 'startsAt' });
      throw mapped;
    }
  }
  if (outcome.created) await sendSpaNotification(hotelId, outcome.id, 'SPA_BOOKED', logger);
  return { ...(await getSpaAppointment(hotelId, outcome.id)), created: outcome.created };
}

/** Veritabanı hatasını tipli hataya çevirir (fırlatmadan). @param {unknown} error @param {string} [uniqueMessage] @returns {any} */
function mapError(error, uniqueMessage) {
  try {
    rethrowPrismaError(error, uniqueMessage ? { uniqueMessage } : undefined);
  } catch (mapped) {
    return mapped;
  }
  return error;
}

/* ══════════════════ Yeniden planla / düzenle ══════════════════ */

/**
 * Açık randevuyu düzenler: saat, terapist(ler), oda, not, tercih; dışarıdan gelenin adı / telefonu. Gönderilmeyen
 * alan değişmez. Saat değişir ve terapist / oda gönderilmezse **aynı** terapist ve oda yeni saatte denenir (dolularsa
 * hata; `null` gönderilirse otomatik atanır). Grup dersi kaydında yalnız not ve ad değişir (saat seansındır).
 *
 * @param {string} hotelId @param {string} appointmentId
 * @param {{ expectedUpdatedAt: Date, startsAt?: string, therapistIds?: string[] | null, roomId?: string | null, therapistPreference?: string | null, note?: string | null, customerName?: string, customerPhone?: string | null }} input
 * @param {{ now?: Date, logger?: any }} [options]
 */
export async function updateSpaAppointment(hotelId, appointmentId, input, { now = new Date(), logger = console } = {}) {
  const [context, settings] = await Promise.all([spaContext(hotelId, now), loadSpaSettings(prisma, hotelId)]);
  let moved = false;
  try {
    await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      assertFresh(row, input.expectedUpdatedAt);
      if (!SPA_ACTIVE_STATUSES.includes(row.status)) throw new ConflictError('Yalnız açık randevu düzenlenir.', 'SPA_NOT_OPEN');
      const placing = input.startsAt !== undefined || input.therapistIds !== undefined || input.roomId !== undefined;
      /** @type {any} */
      const data = {};
      if (input.note !== undefined) data.note = input.note;
      if (input.therapistPreference !== undefined) data.therapistPreference = input.therapistPreference;
      if (input.customerName !== undefined || input.customerPhone !== undefined) {
        if (row.reservationId) throw new ValidationError('Konaklamaya bağlı randevuda ad ve telefon misafir kartından gelir.', { field: 'customerName' });
        if (input.customerName !== undefined) data.customerName = input.customerName;
        if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone;
      }
      let placement = null;
      if (placing) {
        if (row.sessionId) throw new ValidationError('Grup dersi kaydının saati seansa bağlıdır; seansı düzenleyin.', { field: 'startsAt' });
        const startsAt = input.startsAt !== undefined ? wallToUtc(input.startsAt, context.timezone) : row.startsAt;
        const timeChanged = startsAt.getTime() !== row.startsAt.getTime();
        if (timeChanged && input.startsAt.slice(0, 10) < context.today) throw new ValidationError(PAST_DAY_MESSAGE, { field: 'startsAt' });
        if (timeChanged && spaDaysBetween(context.today, input.startsAt.slice(0, 10)) > SPA_MAX_ADVANCE_DAYS) throw new ValidationError(`Randevu en fazla ${SPA_MAX_ADVANCE_DAYS} gün ileriye açılır.`, { field: 'startsAt' });
        const current = row.holds.filter((hold) => hold.active);
        const currentTherapists = current.filter((hold) => hold.therapistId).map((hold) => hold.therapistId);
        const currentRoom = current.find((hold) => hold.roomId)?.roomId ?? null;
        // Randevu kendi kopyasını taşır: süre ve ara açıldığı andaki hizmetten.
        const service = {
          id: row.serviceId,
          therapistCount: currentTherapists.length,
          requiresRoom: Boolean(currentRoom),
          durationMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
          bufferMinutes: Math.round((row.busyUntil.getTime() - row.endsAt.getTime()) / 60_000),
        };
        const therapistIds = input.therapistIds === undefined ? currentTherapists : input.therapistIds;
        if (therapistIds && therapistIds.length !== service.therapistCount) throw new ValidationError(`Bu randevu için ${service.therapistCount} terapist seçin.`, { field: 'therapistIds' });
        if (input.roomId && !service.requiresRoom) throw new ValidationError('Bu randevu oda tutmuyor.', { field: 'roomId' });
        placement = await placeOnBoard(tx, hotelId, {
          service,
          startsAt,
          timezone: context.timezone,
          settings,
          therapistIds: therapistIds?.length ? therapistIds : null,
          roomId: input.roomId === undefined ? currentRoom : input.roomId,
          gender: (input.therapistPreference !== undefined ? input.therapistPreference : row.therapistPreference) ?? null,
          ignoreAppointmentId: row.id,
          onGrid: startsAt.getTime() !== row.startsAt.getTime(),
        });
        // Önce eski tutmalar kalkar, sonra yenileri yazılır (aynı ifade içinde kendisiyle çakışmasın).
        await tx.spaHold.deleteMany({ where: { appointmentId: row.id } });
        await writeHolds(tx, hotelId, { appointmentId: row.id, therapistIds: placement.therapistIds, roomId: placement.roomId, startsAt, busyUntil: placement.busyUntil });
        if (timeChanged) {
          Object.assign(data, { startsAt, endsAt: placement.endsAt, busyUntil: placement.busyUntil, reminderSentAt: null });
          moved = true;
        }
      }
      // `updatedAt` her düzenlemede ilerler (yalnız tutmalar değişse de ekranın sürümü eskisin).
      const updated = await tx.spaAppointment.update({ where: { id: row.id }, data: { ...data, updatedAt: new Date() }, select: APPOINTMENT_SELECT });
      await recordAudit(tx, {
        hotelId,
        entity: 'SpaAppointment',
        entityId: row.id,
        action: 'UPDATE',
        before: { startsAt: iso(row.startsAt), therapistIds: row.holds.filter((hold) => hold.active && hold.therapistId).map((hold) => hold.therapistId), roomId: row.holds.find((hold) => hold.active && hold.roomId)?.roomId ?? null, note: row.note, customer: row.customerName },
        after: { startsAt: iso(updated.startsAt), therapistIds: placement?.therapistIds, roomId: placement?.roomId, note: updated.note, customer: updated.customerName },
      });
      await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: 'UPDATED', source: row.source });
    });
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.code === 'SPA_SLOT_TAKEN' && mapped.details?.constraint) throw new ConflictError(SLOT_TAKEN_HINT, 'SPA_SLOT_TAKEN', { field: 'startsAt' });
    throw mapped;
  }
  // Saat değişti: misafire yeni saatle onay (aynı randevunun yeni saati ayrı bildirim sayılır).
  if (moved) await sendSpaNotification(hotelId, appointmentId, 'SPA_BOOKED', logger);
  return getSpaAppointment(hotelId, appointmentId);
}

/**
 * Fiyatı elle belirler: gerekçeli, yetkili (`spa.supervise`). Açık randevuda ikram, paket, VIP indirimi. Tamamlanmış
 * ve **kasada** kapanan randevuda sonradan düzeltme (şikâyet telafisi, yanlış fiyat): borç yeni fiyattan yeniden
 * hesaplanır; alınan para borcu aşarsa fazlası iadeyle (onaylı) geri verilir, borç artarsa kalan kasada alınır.
 * Odaya yazılmış ücret folyodan düzeltilir; iptal / gelmedi bedeli bedel silmeyle.
 *
 * @param {string} hotelId @param {string} appointmentId @param {{ expectedUpdatedAt: Date, price: string, reason: string }} input
 */
export async function priceSpaAppointment(hotelId, appointmentId, input) {
  const { taxes } = await spaContext(hotelId);
  try {
    await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      assertFresh(row, input.expectedUpdatedAt);
      const completed = row.status === 'COMPLETED';
      if (row.status !== 'BOOKED' && !completed) throw new ConflictError('İptal / gelmedi bedeli fiyatla değil, bedeli silerek düzeltilir; yedek listedeki kaydın fiyatı asıla geçince değişir.', 'SPA_NOT_OPEN');
      if (completed && !toDecimal(money(row.roomChargeTotal)).isZero()) throw new ConflictError('Ücret odaya yazılmış; düzeltme folyodan yapılır.', 'SPA_ROOM_CHARGED');
      const actor = currentActor();
      /** @type {Record<string, any>} */
      const data = { price: input.price, priceReason: input.reason, priceBy: actor };
      if (completed) {
        data.amountDue = money(input.price);
        data.totalDue = spaTotal(data.amountDue, taxes);
        data.balance = spaBalance({ totalDue: data.totalDue, paidTotal: money(row.paidTotal), roomChargeTotal: '0' });
      }
      await tx.spaAppointment.update({ where: { id: row.id }, data });
      await recordAudit(tx, {
        hotelId,
        entity: 'SpaAppointment',
        entityId: row.id,
        action: 'UPDATE',
        before: { price: money(row.price), ...(completed ? { totalDue: money(row.totalDue) } : {}) },
        after: { price: money(input.price), listPrice: money(row.listPrice), ...(completed ? { totalDue: data.totalDue, afterCompletion: true } : {}), reason: input.reason, by: actor },
      });
      await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: 'PRICED', source: row.source });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ Tamamla ══════════════════ */

/**
 * Randevuyu tamamlar (randevu kilitliyken): fiyat borç olur; `settle = ROOM` ise aynı işlemde odaya yazılır.
 * Grup dersi kaydında "katıldı" demektir. Seansın toplu tamamlanması da bunu kullanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, row: any, settle: 'ROOM' | 'DESK', taxes: any[], today: string, now: Date }} input
 */
export async function completeLocked(tx, stage, { hotelId, row, settle, taxes, today, now }) {
  if (row.status !== 'BOOKED') throw new ConflictError('Yalnız açık randevu tamamlanır.', 'SPA_NOT_OPEN');
  if (row.startsAt > now) throw new ConflictError('Randevu henüz başlamadı; saati gelince tamamlanır.', 'SPA_NOT_STARTED');
  const state = await spaPaymentTotals(tx, row.id);
  const amountDue = money(row.price);
  const totalDue = spaTotal(amountDue, taxes);
  const actor = currentActor();
  const updated = await tx.spaAppointment.update({
    where: { id: row.id },
    data: { status: 'COMPLETED', completedAt: now, completedBy: actor, amountDue, totalDue, paidTotal: state.postedNet, balance: spaBalance({ totalDue, paidTotal: state.postedNet, roomChargeTotal: '0' }) },
    select: APPOINTMENT_SELECT,
  });
  await recordAudit(tx, { hotelId, entity: 'SpaAppointment', entityId: row.id, action: 'UPDATE', before: { status: row.status }, after: { ...auditOf(updated), settle, completedBy: actor } });
  if (settle === 'ROOM' && !toDecimal(amountDue).isZero()) {
    await postSpaRoomCharge(tx, stage, { hotelId, today, appointment: updated, label: `Spa · ${row.serviceName}`, sourceKey: `complete:${row.id}`, state });
  }
  await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: 'COMPLETED', source: row.source });
}

/**
 * @param {string} hotelId @param {string} appointmentId @param {{ expectedUpdatedAt: Date, settle: 'ROOM' | 'DESK' }} input
 * @param {{ now?: Date }} [options]
 */
export async function completeSpaAppointment(hotelId, appointmentId, input, { now = new Date() } = {}) {
  const context = await spaContext(hotelId, now);
  try {
    await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      assertFresh(row, input.expectedUpdatedAt);
      await completeLocked(tx, stage, { hotelId, row, settle: input.settle, taxes: context.taxes, today: context.today, now });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ İptal / gelmedi ══════════════════ */

/**
 * Randevuyu kapatır (randevu — grup dersinde seans da — kilitliyken): yer açılır, bedel hesaplanır; misafir içerideyse
 * ve kasada ödeme alınmamışsa bedel odaya yazılır. Grup dersinde açılan yere yedek liste geçer.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, row: any, outcome: 'CANCELLED' | 'NO_SHOW', reason: string, waiveFee?: boolean, waiveReason?: string | null, free?: boolean, settings: any, taxes: any[], today: string, now: Date }} input
 *   `free`: bedelsiz kapanış (seans iptali, konaklamanın iptali — misafirin kusuru değil)
 * @returns {Promise<{ promoted: string[] }>}
 */
export async function closeLocked(tx, stage, { hotelId, row, outcome, reason, waiveFee = false, waiveReason = null, free = false, settings, taxes, today, now }) {
  if (!SPA_ACTIVE_STATUSES.includes(row.status)) throw new ConflictError('Yalnız açık randevu iptal edilir / gelmedi işaretlenir.', 'SPA_NOT_OPEN');
  if (outcome === 'NO_SHOW' && (row.status !== 'BOOKED' || row.startsAt > now)) throw new ConflictError('Gelmedi, randevunun saati gelince işaretlenir; daha önce iptal edin.', 'SPA_NOT_STARTED');
  const waitlisted = row.status === 'WAITLISTED';
  const fee = waitlisted || free ? { pct: '0', amount: '0.00', late: false } : spaFee({ price: money(row.price), startsAt: row.startsAt, at: now, outcome, settings });
  const charged = waiveFee ? '0.00' : fee.amount;
  const waived = waiveFee && !toDecimal(fee.amount).isZero();
  const state = await spaPaymentTotals(tx, row.id);
  const totalDue = spaTotal(charged, taxes);
  const actor = currentActor();
  const updated = await tx.spaAppointment.update({
    where: { id: row.id },
    data: {
      status: outcome,
      cancelledAt: now,
      cancelledBy: actor,
      cancelReason: reason,
      feePct: fee.pct,
      feeWaivedBy: waived ? actor : null,
      feeWaiveReason: waived ? waiveReason : null,
      amountDue: charged,
      totalDue,
      paidTotal: state.postedNet,
      balance: spaBalance({ totalDue, paidTotal: state.postedNet, roomChargeTotal: '0' }),
    },
    select: APPOINTMENT_SELECT,
  });
  await tx.spaHold.updateMany({ where: { appointmentId: row.id }, data: { active: false } });
  await recordAudit(tx, {
    hotelId,
    entity: 'SpaAppointment',
    entityId: row.id,
    action: 'UPDATE',
    before: { status: row.status },
    after: { ...auditOf(updated), reason, feePct: fee.pct, fee: fee.amount, waived, waiveReason: waived ? waiveReason : null, by: actor },
  });

  // Bedel: içerideki misafirde ve kasada ödeme yokken odaya; değilse bakiye olarak kalır (kasada alınır / ön ödemeden düşer).
  const noDeskMoney = toDecimal(state.postedNet).isZero() && toDecimal(state.pendingPayments).isZero() && toDecimal(state.pendingRefunds).isZero();
  if (!toDecimal(charged).isZero() && updated.reservation?.status === 'CHECKED_IN' && noDeskMoney) {
    await postSpaRoomCharge(tx, stage, { hotelId, today, appointment: updated, label: feeLabel(outcome, row.serviceName), sourceKey: `fee:${row.id}`, state });
  }

  let promoted = [];
  if (row.sessionId) {
    await adjustSeats(tx, row.sessionId, waitlisted ? { waitlisted: -row.guestCount } : { booked: -row.guestCount });
    if (!waitlisted) promoted = await promoteWaitlist(tx, stage, { hotelId, sessionId: row.sessionId });
  }
  await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: outcome, source: row.source });
  return { promoted };
}

/**
 * İptal ya da gelmedi. Bedel ayardan hesaplanır (yedek listedeki kayıt bedelsizdir); `waiveFee` yetkili işidir
 * (route `spa.supervise` arar). Portaldan iptalde `reservationId` randevunun o konaklamaya ait olduğunu doğrular.
 *
 * @param {string} hotelId @param {string} appointmentId
 * @param {{ expectedUpdatedAt?: Date, reason: string, waiveFee?: boolean, waiveReason?: string | null }} input
 * @param {{ outcome: 'CANCELLED' | 'NO_SHOW', source?: 'STAFF' | 'PORTAL', reservationId?: string, now?: Date, logger?: any }} options
 */
export async function closeSpaAppointment(hotelId, appointmentId, input, { outcome, source = 'STAFF', reservationId, now = new Date(), logger = console }) {
  const view = await spaViewContext(hotelId, now);
  let promoted = [];
  try {
    promoted = await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      if (reservationId && row.reservationId !== reservationId) throw new NotFoundError('Randevu bulunamadı');
      assertFresh(row, input.expectedUpdatedAt);
      if (source === 'PORTAL' && row.startsAt <= now) throw new ConflictError('Saati gelmiş randevu portaldan iptal edilemez; lütfen spa resepsiyonunu arayın.', 'SPA_STARTED');
      const result = await closeLocked(tx, stage, { hotelId, row, outcome, reason: input.reason, waiveFee: input.waiveFee, waiveReason: input.waiveReason, settings: view.settings, taxes: view.taxes, today: view.today, now });
      if (source === 'PORTAL') {
        const local = wallParts(row.startsAt, view.timezone);
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'SPA',
          severity: 'INFO',
          title: `Portaldan iptal: ${row.serviceName} · ${local.day.split('-').reverse().join('.')} ${local.time}`.slice(0, 200),
          body: `${row.customerName}${row.roomNumber ? ` · oda ${row.roomNumber}` : ''} · ${row.code}`,
          link: `/spa/randevular/${row.id}`,
          permission: PERMISSIONS.SPA_BOOK,
          entityType: 'SpaAppointment',
          entityId: row.id,
          dedupeKey: `spa-cancelled:${row.id}`,
        });
      }
      return result.promoted;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  for (const id of promoted) await sendSpaNotification(hotelId, id, 'SPA_BOOKED', logger);
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ Geri al ══════════════════ */

/**
 * Yanlışlıkla kapatılan randevuyu yeniden açar: para hareketi olmamışsa (odaya yazılmamış; tamamlanan / gelmedide
 * ödeme alınmamış) ve yeri hâlâ boşsa. Birebirde tutmalar yeniden etkinleşir (saat bu arada dolduysa reddedilir);
 * grup dersinde kontenjanda yer olmalı.
 *
 * @param {string} hotelId @param {string} appointmentId @param {{ expectedUpdatedAt: Date }} input
 */
export async function restoreSpaAppointment(hotelId, appointmentId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      assertFresh(row, input.expectedUpdatedAt);
      const state = await spaPaymentTotals(tx, row.id);
      const blocked = spaRestoreBlock({ status: row.status, roomChargeTotal: money(row.roomChargeTotal), state });
      if (blocked) throw new ConflictError(blocked, 'SPA_RESTORE');
      if (row.sessionId) {
        if (row.session?.status !== 'SCHEDULED') throw new ConflictError(SESSION_CLOSED_RESTORE, 'SPA_RESTORE');
        if (row.status !== 'COMPLETED') {
          const session = await tx.spaSession.findFirst({ where: { id: row.sessionId }, select: { capacity: true, bookedCount: true } });
          if (session.bookedCount + row.guestCount > session.capacity) throw new ConflictError('Derste yer kalmadı; kayıt geri alınamaz (yedek listeye yeni kayıt açın).', 'SPA_SESSION_FULL');
          await adjustSeats(tx, row.sessionId, { booked: row.guestCount });
        }
      } else if (row.status !== 'COMPLETED') {
        // Yer bu arada dolduysa EXCLUDE kısıtı reddeder.
        await tx.spaHold.updateMany({ where: { appointmentId: row.id }, data: { active: true } });
      }
      await tx.spaAppointment.update({
        where: { id: row.id },
        data: {
          status: 'BOOKED',
          completedAt: null,
          completedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          feePct: null,
          feeWaivedBy: null,
          feeWaiveReason: null,
          amountDue: 0,
          totalDue: 0,
          paidTotal: state.postedNet,
          balance: spaBalance({ totalDue: '0', paidTotal: state.postedNet, roomChargeTotal: '0' }),
        },
      });
      await recordAudit(tx, { hotelId, entity: 'SpaAppointment', entityId: row.id, action: 'UPDATE', before: { status: row.status, amountDue: money(row.amountDue) }, after: { status: 'BOOKED', restoredBy: currentActor() } });
      await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: 'RESTORED', source: row.source });
    });
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.code === 'SPA_SLOT_TAKEN' && mapped.details?.constraint) throw new ConflictError('Randevunun saati bu arada başka bir kayda verildi; geri alınamaz. Yeni bir randevu açın.', 'SPA_SLOT_TAKEN');
    throw mapped;
  }
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ Odaya yaz ══════════════════ */

/**
 * Kapanmış randevunun borcunu sonradan odaya yazar (tamamlarken "kasada ödenecek" denmiş, misafir odaya yazdırmak
 * istemiş). Aynı istek kimliği ikinci kez yazmaz.
 *
 * @param {string} hotelId @param {string} appointmentId @param {{ requestId: string, expectedUpdatedAt: Date }} input
 */
export async function chargeSpaAppointmentToRoom(hotelId, appointmentId, input) {
  const context = await spaContext(hotelId);
  const sourceKey = `room:${input.requestId}`;
  try {
    await writeWithEvents(async (tx, stage) => {
      const row = await lockedAppointment(tx, hotelId, appointmentId);
      const replay = await tx.spaRoomCharge.findFirst({ where: { hotelId, sourceKey }, select: { appointmentId: true } });
      if (replay) {
        if (replay.appointmentId !== appointmentId) throw new ConflictError('Bu istek başka bir randevuda kullanıldı; ekranı yenileyin.', 'DUPLICATE_REQUEST');
        return;
      }
      assertFresh(row, input.expectedUpdatedAt);
      const label = row.status === 'COMPLETED' ? `Spa · ${row.serviceName}` : feeLabel(row.status, row.serviceName);
      await postSpaRoomCharge(tx, stage, { hotelId, today: context.today, appointment: row, label, sourceKey });
      await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId: row.sessionId, change: 'CHARGED', source: row.source });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu tutar odaya az önce yazıldı; ekranı yenileyin.' });
  }
  return getSpaAppointment(hotelId, appointmentId);
}

/* ══════════════════ Konaklama olayları ══════════════════ */

/** Konaklama kapanınca bir seferde işlenen en fazla randevu (bir konaklamanın açık randevusu birkaç tanedir). */
const STAY_APPOINTMENT_LIMIT = 50;

/**
 * Konaklama iptal oldu / misafir gelmedi: ileri tarihli açık spa randevuları **bedelsiz** kapanır (misafir otele
 * hiç gelmiyor; randevu sahipsiz yer tutmasın) ve spa'ya zil düşer.
 *
 * @param {string} hotelId @param {string} reservationId @param {{ reason: string, now?: Date, logger?: any }} options
 * @returns {Promise<number>} kapanan randevu
 */
export async function releaseStayAppointments(hotelId, reservationId, { reason, now = new Date(), logger = console }) {
  const open = await prisma.spaAppointment.findMany({
    where: { hotelId, reservationId, status: { in: SPA_ACTIVE_STATUSES }, startsAt: { gt: now } },
    select: { id: true },
    orderBy: { startsAt: 'asc' },
    take: STAY_APPOINTMENT_LIMIT,
  });
  if (!open.length) return 0;
  const view = await spaViewContext(hotelId, now);
  let closed = 0;
  for (const { id } of open) {
    try {
      const promoted = await writeWithEvents(async (tx, stage) => {
        const row = await lockedAppointment(tx, hotelId, id);
        if (!SPA_ACTIVE_STATUSES.includes(row.status)) return [];
        const result = await closeLocked(tx, stage, { hotelId, row, outcome: 'CANCELLED', reason, free: true, settings: view.settings, taxes: view.taxes, today: view.today, now });
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'SPA',
          severity: 'INFO',
          title: `Konaklama kapandı, spa randevusu iptal edildi: ${row.customerName} · ${row.serviceName}`.slice(0, 200),
          body: `${row.code} · ${reason}. Yer açıldı; bedel alınmadı.`,
          link: `/spa/randevular/${row.id}`,
          permission: PERMISSIONS.SPA_BOOK,
          entityType: 'SpaAppointment',
          entityId: row.id,
          dedupeKey: `spa-stay-released:${row.id}`,
        });
        return result.promoted;
      });
      closed += 1;
      for (const promotedId of promoted) await sendSpaNotification(hotelId, promotedId, 'SPA_BOOKED', logger);
    } catch (error) {
      logger.error?.({ err: error, hotelId, appointmentId: id }, 'Konaklaması kapanan spa randevusu iptal edilemedi');
    }
  }
  return closed;
}

/**
 * Misafir çıkış yaptı: ödenmemiş spa borcu ya da ileri tarihli randevusu varsa spa'ya zil (borç kasada tahsil
 * edilecek; ileri tarihli randevuya dışarıdan gelen gibi gelebilir ya da iptal edilir). Randevulara dokunulmaz.
 *
 * @param {string} hotelId @param {string} reservationId @param {{ now?: Date }} [options]
 */
export async function alertStayCheckout(hotelId, reservationId, { now = new Date() } = {}) {
  const [unsettled, upcoming] = await Promise.all([
    prisma.spaAppointment.findMany({ where: { hotelId, reservationId, status: { in: SPA_CLOSED_STATUSES }, balance: { gt: 0 } }, select: { id: true, code: true, customerName: true, balance: true }, take: 10 }),
    prisma.spaAppointment.findMany({ where: { hotelId, reservationId, status: { in: SPA_ACTIVE_STATUSES }, startsAt: { gt: now } }, select: { id: true, code: true, customerName: true }, take: 10 }),
  ]);
  if (!unsettled.length && !upcoming.length) return { alerted: false };
  const name = unsettled[0]?.customerName ?? upcoming[0]?.customerName;
  const parts = [];
  if (unsettled.length) parts.push(`ödenmemiş spa borcu: ${unsettled.map((row) => `${row.code} (${money(row.balance)})`).join(', ')}`);
  if (upcoming.length) parts.push(`ileri tarihli randevu: ${upcoming.map((row) => row.code).join(', ')}`);
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'SPA',
      severity: unsettled.length ? 'WARNING' : 'INFO',
      title: `Çıkış yapan misafirin spa kaydı açık: ${name}`.slice(0, 200),
      body: `${parts.join('; ')}. Borç spa kasasında tahsil edilir; ileri tarihli randevuyu misafirle teyit edin ya da iptal edin.`.slice(0, 500),
      link: `/spa/randevular/${(unsettled[0] ?? upcoming[0]).id}`,
      permission: PERMISSIONS.SPA_BOOK,
      entityType: 'Reservation',
      entityId: reservationId,
      dedupeKey: `spa-checkout:${reservationId}`,
    }),
  );
  return { alerted: true };
}

export { SPA_STAY_STATUSES };
