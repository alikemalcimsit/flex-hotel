import { rangesOverlapClosed } from '@hotelos/core';
import { ValidationError } from '../../lib/errors.js';
import { BOARD_TYPE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Fiyatlandırma kuralları (modül 28) — veritabanı bilmez. Çakışma kontrolü
 * burada kullanıcıya *hangi* planla çakıştığını söyler; garantiyi veritabanındaki
 * `RatePlan_no_overlap` EXCLUDE kısıtı verir (eşzamanlılık).
 */

/**
 * Aynı oda tipi + pansiyon için dönemi aday planla çakışan bir plan varsa reddeder.
 * `existing` zaten aynı kapsama (oda tipi + pansiyon) süzülmüş satırlardır.
 *
 * @param {Array<{ id: string, name: string, boardType: string, startDate: Date | string, endDate: Date | string }>} existing
 * @param {{ id?: string, boardType: string, startDate: Date | string, endDate: Date | string }} candidate
 */
export function assertNoRatePlanOverlap(existing, candidate) {
  const clash = existing.find((plan) => plan.id !== candidate.id && rangesOverlapClosed(plan, candidate));
  if (clash) {
    const board = BOARD_TYPE_LABELS[candidate.boardType] ?? candidate.boardType;
    throw new ValidationError(
      `Bu tarih aralığı "${clash.name}" planıyla çakışıyor (${board}). Aynı oda tipi + pansiyonda bir geceye tek plan düşebilir.`,
      { conflictingRatePlanId: clash.id, conflictingRatePlanName: clash.name },
    );
  }
}
