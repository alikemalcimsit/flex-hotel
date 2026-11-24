import { currentActor, toMoneyString } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import { lockReservations } from '../../lib/locks.js';
import { spaBalance, spaPaymentState, spaRoomChargeBlock, SPA_TAX_CATEGORY } from './rules.js';
import { dateOnly, fullName, money } from './shared.js';

/**
 * Randevunun hesabı (modül 57): ödeme toplamı, bakiyenin yeniden yazılması ve odaya yazma. Randevu satırı
 * kilitliyken çağrılır; toplamlar aynı transaction'da satırlardan yeniden hesaplanır (ayrı sayaç tutulmaz).
 */

/**
 * Ödeme özeti: işlenmiş net, bekleyen tahsilat / iade (tek gruplu sorgu).
 * @param {import('@prisma/client').Prisma.TransactionClient | any} client @param {string} appointmentId
 */
export async function spaPaymentTotals(client, appointmentId) {
  const groups = await client.spaPayment.groupBy({ by: ['status', 'kind'], where: { appointmentId, status: { in: ['POSTED', 'PENDING'] } }, _sum: { amount: true } });
  return spaPaymentState(groups.map((group) => ({ status: group.status, kind: group.kind, amount: String(group._sum.amount ?? 0) })));
}

/**
 * Kasada alınan toplamı ve bakiyeyi satırlardan yeniden yazar (randevunun sürümünü ilerletmeden).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} appointmentId
 */
export async function recomputeSpaPaid(tx, appointmentId) {
  const [state, row] = await Promise.all([spaPaymentTotals(tx, appointmentId), tx.spaAppointment.findFirst({ where: { id: appointmentId }, select: { totalDue: true, roomChargeTotal: true } })]);
  const paidTotal = state.postedNet;
  const balance = spaBalance({ totalDue: money(row.totalDue), paidTotal, roomChargeTotal: money(row.roomChargeTotal) });
  // Ham ifade: `updatedAt` ilerlemez — tahsilat (ve başkasının verdiği onay) randevu ekranı açık personelin sürümünü
  // eskitmesin; randevunun kendisi değişmedi.
  await tx.$executeRaw`UPDATE "SpaAppointment" SET "paidTotal" = ${paidTotal}::numeric, "balance" = ${balance}::numeric WHERE "id" = ${appointmentId}`;
  return state;
}

/**
 * Borcu içerideki misafirin oda hesabına yazar (randevu kilitliyken): folyo aktörüne `spa.charged` olayı gider,
 * kalemi o yazar (olay iki kez gelse de tek yazılır). Folyoya **esas tutar** gider; folyonun vergi motoruyla toplamı
 * randevunun `totalDue`'suna eşittir. Randevu ya odaya ya kasaya kapanır (`spaRoomChargeBlock`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, today: string, appointment: { id: string, code: string, status: string, reservationId: string | null, amountDue: any, totalDue: any, roomChargeTotal: any, paidTotal: any }, label: string, sourceKey: string, state?: { postedNet: string, pendingPayments: string, pendingRefunds: string } }} input
 * @returns {Promise<{ chargeId: string, eventId: string }>}
 */
export async function postSpaRoomCharge(tx, stage, { hotelId, today, appointment, label, sourceKey, state = null }) {
  const totals = state ?? (await spaPaymentTotals(tx, appointment.id));
  const blocked = spaRoomChargeBlock({ status: appointment.status, amountDue: money(appointment.amountDue), roomChargeTotal: money(appointment.roomChargeTotal), state: totals });
  if (blocked) throw new ConflictError(blocked, 'SPA_ROOM_CHARGE');
  if (!appointment.reservationId) throw new ValidationError('Dışarıdan gelen misafirin oda hesabı yok; ödemeyi spa kasasında alın.', { field: 'settle' });

  await lockReservations(tx, hotelId, [appointment.reservationId]);
  const stay = await tx.reservation.findFirst({
    where: { id: appointment.reservationId, hotelId },
    select: { id: true, status: true, confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  });
  if (!stay || stay.status !== 'CHECKED_IN' || !stay.room) {
    throw new ValidationError('Misafir içeride değil (giriş yapmamış ya da çıkış yapmış); odaya yazılamaz. Ödemeyi spa kasasında alın.', { field: 'settle' });
  }

  const amount = money(appointment.amountDue);
  const total = money(appointment.totalDue);
  const event = await stage('spa.charged', {
    hotelId,
    reservationId: stay.id,
    roomId: null,
    reference: appointment.code,
    items: [{ description: label.slice(0, 200), unitPrice: amount, quantity: 1, taxCategory: SPA_TAX_CATEGORY }],
  });
  const guestName = fullName(stay.guest) ?? '—';
  const charge = await tx.spaRoomCharge.create({
    data: { hotelId, appointmentId: appointment.id, reservationId: stay.id, roomNumber: stay.room.number, guestName, amount, total, eventId: event.id, sourceKey, chargedBy: currentActor(), businessDate: dateOnly(today) },
    select: { id: true },
  });
  await tx.spaAppointment.update({
    where: { id: appointment.id },
    data: { roomChargeTotal: total, balance: spaBalance({ totalDue: total, paidTotal: toMoneyString(totals.postedNet), roomChargeTotal: total }) },
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'SpaRoomCharge',
    entityId: charge.id,
    action: 'CREATE',
    after: { appointment: appointment.code, room: stay.room.number, guest: guestName, reservation: stay.confirmationCode, amount, total, eventId: event.id },
  });
  return { chargeId: charge.id, eventId: event.id };
}
