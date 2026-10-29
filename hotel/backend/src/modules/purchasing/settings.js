import { recordAudit } from '../../lib/audit.js';
import { StaleWriteError, rethrowPrismaError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { loadPurchaseSettings, prisma } from './shared.js';

/**
 * Satın alma politikası (modül 45): sipariş onay eşiği (KDV dahil; 0 = onay yok) ve tekliflerde
 * varsayılan KDV oranı. Otel başına tek satır; sürüm damgasıyla tek ifadede güncellenir.
 */

/** @param {string} hotelId */
export function getPurchaseSettings(hotelId) {
  return loadPurchaseSettings(prisma, hotelId);
}

/**
 * @param {string} hotelId
 * @param {{ expectedUpdatedAt?: Date | null, orderApprovalAmount: string, defaultTaxRatePct: string }} input
 */
export async function updatePurchaseSettings(hotelId, input) {
  try {
    await writeWithEvents(async (tx) => {
      const before = await loadPurchaseSettings(tx, hotelId);
      const data = { orderApprovalAmount: input.orderApprovalAmount, defaultTaxRatePct: input.defaultTaxRatePct };
      if (before.updatedAt === null) {
        // İlk kayıt: aynı anda iki kişi kaydederse ikincisi birincil anahtardan düşer (çakışma).
        if (input.expectedUpdatedAt) throw new StaleWriteError();
        await tx.purchaseSettings.create({ data: { hotelId, ...data } });
      } else {
        if (!input.expectedUpdatedAt) throw new StaleWriteError();
        const { count } = await tx.purchaseSettings.updateMany({ where: { hotelId, updatedAt: input.expectedUpdatedAt }, data });
        if (count === 0) throw new StaleWriteError();
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseSettings',
        entityId: hotelId,
        action: before.updatedAt === null ? 'CREATE' : 'UPDATE',
        before: { orderApprovalAmount: before.orderApprovalAmount, defaultTaxRatePct: before.defaultTaxRatePct },
        after: data,
      });
    });
    return getPurchaseSettings(hotelId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}
