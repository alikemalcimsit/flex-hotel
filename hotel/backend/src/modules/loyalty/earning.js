import { LEDGER_PAYMENT_METHODS, pointsForSpend, tierFor } from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { accountForGuest, expiryFor, hotelContext, loadLoyaltySettings, lockAccount, prisma, restoreLots, writeTransaction } from './shared.js';

/**
 * Puan kazanma (modül 56): folyo ve spa kasası kaynaklı. Her kaynak **hedefe eşitlenir**: hedef puan − bu kaynaktan yazılmış
 * (kazanma + geri alma) = fark. Folyo kapalıysa hedef uygun harcamanın puanı, açıksa (yeniden açıldı) 0. Aynı olay iki kez
 * gelirse fark 0 olur, yazılmaz. Fark eksiyse önce o kaynağın lotlarından, yetmezse FIFO diğerlerinden düşer.
 */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, guestId: string, target: number, sourceType: string, sourceId: string, spend: string, description: string,
 *   reservationId?: string | null, folioId?: string | null, settings: any, today: string, createAccount: boolean }} input
 */
async function reconcileEarning(tx, stage, input) {
  const account = await accountForGuest(tx, input.hotelId, input.guestId, { create: input.createAccount && input.target > 0, actor: 'loyalty-worker' });
  if (!account) return { posted: false, skipped: input.target > 0 ? 'Misafir sadakat üyesi değil (otomatik üyelik kapalı)' : 'Hesap yok' };
  if (account.status !== 'ACTIVE') return { posted: false, skipped: `${account.number} kapalı hesap` };
  await lockAccount(tx, account.id);
  const fresh = await tx.loyaltyAccount.findUnique({ where: { id: account.id } });
  const rows = await tx.loyaltyTransaction.findMany({ where: { accountId: account.id, sourceType: input.sourceType, sourceId: input.sourceId, kind: { in: ['EARN', 'EARN_REVERSAL'] } }, select: { id: true, points: true, remaining: true } });
  const written = rows.reduce((sum, row) => sum + row.points, 0);
  const diff = input.target - written;
  if (diff === 0) return { posted: false, skipped: 'Puan güncel', accountId: account.id };
  const sequence = rows.length + 1;
  const common = { hotelId: input.hotelId, account: fresh, sourceType: input.sourceType, sourceId: input.sourceId, sourceKey: `${input.sourceType}:${input.sourceId}#${sequence}`, reservationId: input.reservationId ?? null, folioId: input.folioId ?? null, settings: input.settings, today: input.today };
  if (diff > 0) {
    await writeTransaction(tx, stage, { ...common, kind: 'EARN', points: diff, amount: input.spend, description: input.description, expiresOn: expiryFor(input.settings, input.today) });
    return { posted: true, message: `${fresh.number}: +${diff} puan (${input.description})`, accountId: account.id };
  }
  // Geri alma: önce bu kaynağın kendi lotları, sonra FIFO.
  const own = rows.filter((row) => row.remaining > 0).map((row) => ({ lotId: row.id, points: 0, remaining: row.remaining }));
  let left = -diff;
  const consumed = [];
  for (const lot of own) {
    const take = Math.min(lot.remaining, left);
    if (take > 0) consumed.push({ lotId: lot.lotId, points: take });
    left -= take;
  }
  if (left > 0) {
    const others = await tx.loyaltyTransaction.findMany({ where: { accountId: account.id, remaining: { gt: 0 }, id: { notIn: own.map((lot) => lot.lotId) } }, orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], select: { id: true, remaining: true } });
    for (const lot of others) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining, left);
      consumed.push({ lotId: lot.id, points: take });
      left -= take;
    }
  }
  await writeTransaction(tx, stage, { ...common, kind: 'EARN_REVERSAL', points: diff, amount: '0', description: `${input.description} — geri alındı`, consumed });
  return { posted: true, message: `${fresh.number}: ${diff} puan geri alındı (${input.description})`, accountId: account.id };
}

/** @param {string} hotelId */
async function context(hotelId) {
  const [ctx, settings] = await Promise.all([hotelContext(hotelId), loadLoyaltySettings(prisma, hotelId)]);
  return { today: ctx.today, currency: ctx.currency, settings };
}

/**
 * Folyonun puanı: kapalıysa uygun harcamadan (vergi kalemleri hariç), açıksa 0. Acente / voucher ödemeli folyo ayara göre 0.
 * @param {string} hotelId @param {string} folioId
 */
export async function syncFolioPoints(hotelId, folioId) {
  const { today, currency, settings } = await context(hotelId);
  const folio = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { id: true, status: true, reservationId: true, reservation: { select: { guestId: true, confirmationCode: true } } } });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  const anyWritten = await prisma.loyaltyTransaction.findFirst({ where: { hotelId, sourceType: 'FOLIO', sourceId: folioId }, select: { id: true } });
  if (!settings.isEnabled && !anyWritten) return { posted: false, skipped: 'Sadakat programı kapalı' };
  let spend = '0.00';
  let target = 0;
  let reason = 'folyo açık';
  if (folio.status === 'CLOSED' && settings.isEnabled) {
    const [sum, ledgerPaid] = await Promise.all([
      prisma.folioItem.aggregate({ where: { folioId, hotelId, deletedAt: null, type: { not: 'TAX' } }, _sum: { total: true } }),
      settings.excludeLedgerPaid ? prisma.payment.findFirst({ where: { folioId, hotelId, status: 'POSTED', method: { in: [...LEDGER_PAYMENT_METHODS] }, kind: 'PAYMENT' }, select: { id: true } }) : null,
    ]);
    spend = String(sum._sum.total ?? '0');
    if (ledgerPaid) reason = 'acente / cari ödemeli folyo puan kazanmaz';
    else {
      const account = await prisma.loyaltyAccount.findUnique({ where: { guestId: folio.reservation.guestId }, select: { qualifyingPoints: true } });
      const multiplier = tierFor(settings.tiers, account?.qualifyingPoints ?? 0).current.multiplier;
      target = pointsForSpend({ spend, spendPerPoint: settings.spendPerPoint, multiplier });
    }
  }
  return writeWithEvents((tx, stage) =>
    reconcileEarning(tx, stage, {
      hotelId,
      guestId: folio.reservation.guestId,
      target,
      sourceType: 'FOLIO',
      sourceId: folioId,
      spend,
      description: `Konaklama ${folio.reservation.confirmationCode} folyosu (${spend} ${currency}${target === 0 ? `; ${reason}` : ''})`,
      reservationId: folio.reservationId,
      folioId,
      settings,
      today,
      createAccount: settings.autoEnroll,
    }),
  );
}

/**
 * Spa kasasında ödenen tamamlanmış randevunun puanı (misafir kartı olan randevuda; odaya yazılan pay folyodan kazanılır).
 * @param {string} hotelId @param {string} appointmentId
 */
export async function syncSpaPoints(hotelId, appointmentId) {
  const { today, currency, settings } = await context(hotelId);
  const appointment = await prisma.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: { id: true, code: true, serviceName: true, status: true, guestId: true, paidTotal: true, reservationId: true } });
  if (!appointment) throw new NotFoundError('Spa randevusu bulunamadı');
  if (!appointment.guestId) return { posted: false, skipped: 'Randevu bir misafir kartına bağlı değil' };
  const anyWritten = await prisma.loyaltyTransaction.findFirst({ where: { hotelId, sourceType: 'SPA', sourceId: appointmentId }, select: { id: true } });
  if ((!settings.isEnabled || !settings.earnOnSpa) && !anyWritten) return { posted: false, skipped: 'Spa harcaması puan kazanmıyor (ayar)' };
  const spend = String(appointment.paidTotal ?? '0');
  let target = 0;
  if (appointment.status === 'COMPLETED' && settings.isEnabled && settings.earnOnSpa) {
    const account = await prisma.loyaltyAccount.findUnique({ where: { guestId: appointment.guestId }, select: { qualifyingPoints: true } });
    target = pointsForSpend({ spend, spendPerPoint: settings.spendPerPoint, multiplier: tierFor(settings.tiers, account?.qualifyingPoints ?? 0).current.multiplier });
  }
  return writeWithEvents((tx, stage) =>
    reconcileEarning(tx, stage, {
      hotelId,
      guestId: appointment.guestId,
      target,
      sourceType: 'SPA',
      sourceId: appointmentId,
      spend,
      description: `Spa ${appointment.code} ${appointment.serviceName} (${spend} ${currency})`,
      reservationId: appointment.reservationId,
      settings,
      today,
      createAccount: settings.autoEnroll,
    }),
  );
}

/**
 * Folyo kalemi iptal edildi: kalem bir puan harcamasıysa puan iade edilir.
 * @param {string} hotelId @param {string} itemId
 */
export async function onFolioItemVoided(hotelId, itemId) {
  const redemption = await prisma.loyaltyTransaction.findFirst({ where: { hotelId, kind: 'REDEEM', folioItemId: itemId }, select: { id: true, accountId: true, points: true, amount: true, consumed: true, folioId: true, reservationId: true, description: true } });
  if (!redemption) return { posted: false, skipped: 'Puan harcaması değil' };
  const { today, settings } = await context(hotelId);
  return writeWithEvents(async (tx, stage) => {
    await lockAccount(tx, redemption.accountId);
    const account = await tx.loyaltyAccount.findUnique({ where: { id: redemption.accountId } });
    const result = await writeTransaction(tx, stage, {
      hotelId,
      account,
      kind: 'REDEEM_REVERSAL',
      points: -redemption.points,
      sourceType: 'FOLIO_ITEM',
      sourceId: itemId,
      sourceKey: `REDEEM_REVERSAL:${redemption.id}`,
      description: `İade: ${redemption.description} (folyo kalemi iptal edildi)`,
      amount: String(redemption.amount),
      reservationId: redemption.reservationId,
      folioId: redemption.folioId,
      folioItemId: itemId,
      settings,
      today,
    });
    if (!result.created) return { posted: false, skipped: 'Zaten iade edilmiş' };
    await restoreLots(tx, /** @type {any} */ (redemption.consumed));
    // İade artı hareket ama lot açmaz (puan eski lotlarına döndü): yazıcı lot açtı, kapat.
    await tx.loyaltyTransaction.update({ where: { id: /** @type {string} */ (result.id) }, data: { remaining: 0 } });
    return { posted: true, message: `${account.number}: ${-redemption.points} puan iade edildi` };
  });
}
