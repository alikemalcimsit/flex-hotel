import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DELIVERY_ACTIVE_STATUSES,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  cancelDeliveryOrderSchema,
  createDeliveryOrderSchema,
  deliverDeliveryOrderSchema,
  deliveryDurations,
  deliveryNumber,
  deliveryTransitionError,
} from './delivery.js';
import { DELIVERY_POLICY_LIMITS, POS_OUTLET_KINDS, updatePosSettingsSchema } from './pos.js';

/**
 * Paket servis (modül 42) sözleşmesi: durum geçişleri, numara, süreler ve şemalar (bozuk para yalnız kapıda nakitte, ön ödeme, kurye).
 */

const UUID = '6f1f1f1f-1111-4111-8111-111111111111';
const baseOrder = {
  requestId: UUID,
  outletId: UUID,
  source: 'PHONE',
  customerName: 'Ayşe Yılmaz',
  phone: '0532 111 22 33',
  address: 'Atatürk Cad. No 12 D 4, Konyaaltı',
  lines: [{ menuItemId: UUID, quantity: 2 }],
  doorMethod: 'CASH',
};

describe('durumlar', () => {
  it('her durumun etiketi var; açık durumlar teslim / iptal dışı', () => {
    assert.ok(DELIVERY_STATUSES.every((status) => DELIVERY_STATUS_LABELS[status]));
    assert.deepEqual(DELIVERY_ACTIVE_STATUSES, ['RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY']);
    assert.ok(POS_OUTLET_KINDS.includes('DELIVERY'));
  });

  it('mutfak adımları atlanabilir; yoldan hazıra geri; geriye ve bitmişten geçiş yok', () => {
    assert.equal(deliveryTransitionError('RECEIVED', 'READY'), null);
    assert.equal(deliveryTransitionError('PREPARING', 'ON_THE_WAY'), null);
    assert.equal(deliveryTransitionError('ON_THE_WAY', 'READY'), null);
    assert.match(deliveryTransitionError('READY', 'PREPARING'), /geçişi yapılamaz/);
    assert.match(deliveryTransitionError('DELIVERED', 'READY'), /teslim edildi; değiştirilemez/);
    assert.match(deliveryTransitionError('READY', 'READY'), /zaten/);
  });
});

describe('numara ve süreler', () => {
  it('PS-yıl-sıra', () => {
    assert.equal(deliveryNumber(2026, 42), 'PS-2026-000042');
  });

  it('mutfak, bekleme, yol, toplam ve zamanında mı', () => {
    const at = (minute) => new Date(Date.UTC(2026, 10, 16, 18, minute));
    const durations = deliveryDurations({ createdAt: at(0), readyAt: at(15), dispatchedAt: at(20), deliveredAt: at(41), dueAt: at(45) });
    assert.deepEqual(durations, { kitchen: 15, waiting: 5, transit: 21, total: 41, onTime: true });
    assert.equal(deliveryDurations({ createdAt: at(0), readyAt: null, dispatchedAt: null, deliveredAt: null, dueAt: at(45) }).onTime, null);
  });
});

describe('şemalar', () => {
  it('sipariş: varsayılanlar; ön ödeme listesi boş', () => {
    const parsed = createDeliveryOrderSchema.parse(baseOrder);
    assert.deepEqual(parsed.prepayments, []);
    assert.equal(parsed.changeFor, null);
    assert.equal(parsed.addressNote, null);
  });

  it('bozuk para yalnız kapıda nakitte; kartta ön ödeme referansı zorunlu', () => {
    const card = createDeliveryOrderSchema.safeParse({ ...baseOrder, doorMethod: 'CARD', changeFor: '500' });
    assert.equal(card.success, false);
    assert.deepEqual(card.error.issues[0].path, ['changeFor']);
    const prepaid = createDeliveryOrderSchema.safeParse({ ...baseOrder, doorMethod: null, prepayments: [{ method: 'CARD', amount: '300' }] });
    assert.equal(prepaid.success, false);
    assert.deepEqual(prepaid.error.issues[0].path, ['prepayments', 0, 'reference']);
  });

  it('telefon rakamsız ya da kısa olamaz; adres boş olamaz', () => {
    assert.equal(createDeliveryOrderSchema.safeParse({ ...baseOrder, phone: 'yok' }).success, false);
    assert.equal(createDeliveryOrderSchema.safeParse({ ...baseOrder, address: '  ' }).success, false);
  });

  it('teslim ve iptal', () => {
    assert.deepEqual(deliverDeliveryOrderSchema.parse({ requestId: UUID, expectedUpdatedAt: '2026-11-16T10:00:00.000Z' }).payments, []);
    assert.equal(cancelDeliveryOrderSchema.safeParse({ expectedUpdatedAt: '2026-11-16T10:00:00.000Z', reason: 'x' }).success, false);
  });

  it('politika: paket ücreti, en az tutar, hedef süre sınırlı', () => {
    const ok = updatePosSettingsSchema.parse({ adjustmentApprovalAmount: '1000', cashVarianceAlert: '100', deliveryFee: '25', deliveryMinOrder: '150', deliveryOrderMinutes: 45 });
    assert.equal(ok.deliveryFee, '25');
    const tooLong = updatePosSettingsSchema.safeParse({ adjustmentApprovalAmount: '1000', cashVarianceAlert: '100', deliveryOrderMinutes: DELIVERY_POLICY_LIMITS.deliveryOrderMinutes.max + 1 });
    assert.equal(tooLong.success, false);
  });
});
