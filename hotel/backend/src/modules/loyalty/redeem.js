import { currentActor } from '@hotelos/core';
import { maxRedeemablePoints, pointsValue, tierFor } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { postCharge } from '../folios/service.js';
import { accountView } from './accounts.js';
import { hotelContext, loadLoyaltySettings, lockAccount, prisma, restoreLots, writeTransaction } from './shared.js';

/**
 * Puan kullanma (modül 56): konaklamanın açık folyosuna puan × puan değeri tutarında indirim kalemi.
 *
 * Akış: (1) hesap kilitli, sınırlar denetlenir, puan FIFO düşülür (REDEEM, kaynak anahtarı istek kimliği); (2) folyoya indirim
 * kalemi `postCharge` ile (istek kimliği aynı → çift gönderimde ikinci kalem açılmaz); (3) kalem kimliği harekete yazılır.
 * (2) başarısızsa puan iade edilir (REDEEM_REVERSAL). Aynı istek tekrar gelirse mevcut sonuç döner.
 */

/**
 * Rezervasyonun sadakat özeti: misafirin hesabı, açık folyolar ve her birinde kullanılabilecek en çok puan.
 * @param {string} hotelId @param {string} reservationId
 */
export async function reservationLoyalty(hotelId, reservationId) {
  const [ctx, settings] = await Promise.all([hotelContext(hotelId), loadLoyaltySettings(prisma, hotelId)]);
  const reservation = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, guestId: true, status: true, confirmationCode: true } });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  const [account, folios, redemptions] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { guestId: reservation.guestId }, include: { guest: { select: { firstName: true, lastName: true } } } }),
    prisma.folio.findMany({ where: { hotelId, reservationId, status: 'OPEN' }, select: { id: true, window: true, chargesTotal: true, currency: true }, orderBy: { window: 'asc' } }),
    prisma.loyaltyTransaction.findMany({ where: { hotelId, reservationId, kind: { in: ['REDEEM', 'REDEEM_REVERSAL', 'EARN', 'EARN_REVERSAL'] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, points: true, amount: true, description: true, createdAt: true, folioItemId: true } }),
  ]);
  const usable = account && account.status === 'ACTIVE' && settings.isEnabled;
  return {
    program: { isEnabled: settings.isEnabled, programName: settings.programName, pointValue: settings.pointValue, minRedeemPoints: settings.minRedeemPoints, maxRedeemPct: settings.maxRedeemPct, autoEnroll: settings.autoEnroll },
    currency: ctx.currency,
    guestId: reservation.guestId,
    account: account ? accountView(account, settings) : null,
    folios: folios.map((folio) => {
      const max = usable ? maxRedeemablePoints({ balance: Math.max(0, account.balance), chargesTotal: String(folio.chargesTotal), maxRedeemPct: settings.maxRedeemPct, pointValue: settings.pointValue }) : 0;
      return { id: folio.id, window: folio.window, chargesTotal: String(folio.chargesTotal), maxPoints: max >= settings.minRedeemPoints ? max : 0, maxAmount: pointsValue(max >= settings.minRedeemPoints ? max : 0, settings.pointValue) };
    }),
    history: redemptions.map((row) => ({ id: row.id, kind: row.kind, points: row.points, amount: String(row.amount), description: row.description, createdAt: row.createdAt.toISOString() })),
  };
}

/**
 * @param {string} hotelId @param {string} reservationId
 * @param {{ requestId: string, points: number, category: string, folioId?: string }} input
 */
export async function redeemPoints(hotelId, reservationId, input) {
  const [ctx, settings] = await Promise.all([hotelContext(hotelId), loadLoyaltySettings(prisma, hotelId)]);
  const sourceKey = `REDEEM:${input.requestId}`;
  const done = await prisma.loyaltyTransaction.findFirst({ where: { hotelId, sourceKey }, select: { id: true, folioItemId: true } });
  if (done?.folioItemId) return { ...(await reservationLoyalty(hotelId, reservationId)), redemptionId: done.id, created: false };
  if (!settings.isEnabled) throw new ConflictError('Sadakat programı kapalı', 'LOYALTY_DISABLED');
  const reservation = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, guestId: true, confirmationCode: true } });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  const folio = await prisma.folio.findFirst({ where: { hotelId, reservationId, status: 'OPEN', ...(input.folioId ? { id: input.folioId } : {}) }, orderBy: { window: 'asc' }, select: { id: true, chargesTotal: true, window: true } });
  if (!folio) throw new ConflictError('Konaklamanın açık folyosu yok; puan girişten sonra (folyo açıkken) kullanılır', 'LOYALTY_NO_OPEN_FOLIO');
  if (input.points < settings.minRedeemPoints) throw new ValidationError(`En az ${settings.minRedeemPoints} puan kullanılır`, { fields: { points: `En az ${settings.minRedeemPoints}` } });
  const amount = pointsValue(input.points, settings.pointValue);
  let redemptionId = done?.id ?? null;
  if (!redemptionId) {
    redemptionId = await writeWithEvents(async (tx, stage) => {
      const account = await tx.loyaltyAccount.findUnique({ where: { guestId: reservation.guestId } });
      if (!account || account.status !== 'ACTIVE') throw new ConflictError('Misafir sadakat üyesi değil', 'LOYALTY_NOT_MEMBER');
      await lockAccount(tx, account.id);
      const fresh = await tx.loyaltyAccount.findUnique({ where: { id: account.id } });
      const max = maxRedeemablePoints({ balance: Math.max(0, fresh.balance), chargesTotal: String(folio.chargesTotal), maxRedeemPct: settings.maxRedeemPct, pointValue: settings.pointValue });
      if (input.points > fresh.balance) throw new ConflictError(`Bakiye yetersiz: ${fresh.balance} puan var`, 'LOYALTY_BALANCE');
      if (input.points > max) throw new ConflictError(`Bu folyoda en çok ${max} puan kullanılır (harcamanın %${settings.maxRedeemPct}'i)`, 'LOYALTY_LIMIT');
      const result = await writeTransaction(tx, stage, {
        hotelId,
        account: fresh,
        kind: 'REDEEM',
        points: -input.points,
        consume: true,
        sourceType: 'REDEMPTION',
        sourceId: input.requestId,
        sourceKey,
        description: `${settings.programName}: ${input.points} puan indirim (${reservation.confirmationCode})`,
        amount,
        reservationId,
        folioId: folio.id,
        settings,
        today: ctx.today,
      });
      return result.id;
    });
  }
  try {
    const posted = await postCharge(hotelId, folio.id, {
      requestId: input.requestId,
      type: 'DISCOUNT',
      discountCategory: input.category,
      description: `${settings.programName} puan indirimi (${input.points} puan)`,
      amount,
      quantity: 1,
    });
    await prisma.loyaltyTransaction.update({ where: { id: redemptionId }, data: { folioItemId: posted.item.id } });
  } catch (error) {
    // Kalem yazılamadı: puan iade (hareket iz olarak kalır).
    await refundRedemption(hotelId, redemptionId, `Folyoya yazılamadı: ${/** @type {Error} */ (error).message}`.slice(0, 200), ctx.today, settings);
    throw error;
  }
  return { ...(await reservationLoyalty(hotelId, reservationId)), redemptionId, created: true };
}

/** @param {string} hotelId @param {string} redemptionId @param {string} note @param {string} today @param {any} settings */
async function refundRedemption(hotelId, redemptionId, note, today, settings) {
  const redemption = await prisma.loyaltyTransaction.findFirst({ where: { id: redemptionId, hotelId }, select: { id: true, accountId: true, points: true, consumed: true, amount: true, reservationId: true, folioId: true, description: true } });
  if (!redemption) return;
  await writeWithEvents(async (tx, stage) => {
    await lockAccount(tx, redemption.accountId);
    const account = await tx.loyaltyAccount.findUnique({ where: { id: redemption.accountId } });
    const result = await writeTransaction(tx, stage, { hotelId, account, kind: 'REDEEM_REVERSAL', points: -redemption.points, sourceType: 'REDEMPTION', sourceId: redemption.id, sourceKey: `REDEEM_REVERSAL:${redemption.id}`, description: `İade: ${redemption.description} — ${note}`, amount: String(redemption.amount), reservationId: redemption.reservationId, folioId: redemption.folioId, settings, today });
    if (!result.created) return;
    await restoreLots(tx, /** @type {any} */ (redemption.consumed));
    await tx.loyaltyTransaction.update({ where: { id: /** @type {string} */ (result.id) }, data: { remaining: 0 } });
  });
}

export { currentActor, tierFor };
