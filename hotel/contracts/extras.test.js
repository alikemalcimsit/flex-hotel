import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAUNDRY_MAX_DUE_DAYS,
  laundryDueAtError,
  laundryItemInputSchema,
  laundryOrderSchema,
  laundryOverdue,
  laundrySettingsSchema,
  laundryStatusSchema,
  laundryTransitionError,
  minibarConsumptionSchema,
  minibarItemInputSchema,
} from './extras.js';

const ID = '6f1c1f1e-2b8a-4c1e-9a8e-1a2b3c4d5e6f';
const ID2 = '7a2d2e2f-3c9b-4d2f-8b9f-2b3c4d5e6f70';

const slip = (overrides = {}) => ({
  requestId: ID,
  roomId: ID,
  chargeTo: 'IN_HOUSE',
  reservationId: ID2,
  lines: [{ itemId: ID, quantity: 2 }],
  ...overrides,
});

describe('minibar fişi', () => {
  it('odadaki misafire yazılan fiş konaklama ister; aynı ürün iki satırda olamaz', () => {
    assert.equal(minibarConsumptionSchema.safeParse(slip()).success, true);
    assert.equal(minibarConsumptionSchema.safeParse(slip({ reservationId: null })).success, false);
    assert.equal(
      minibarConsumptionSchema.safeParse(slip({ lines: [{ itemId: ID, quantity: 1 }, { itemId: ID, quantity: 1 }] })).success,
      false,
    );
  });

  it('kayıp gerekçe ister ve konaklamaya yazılmaz', () => {
    assert.equal(minibarConsumptionSchema.safeParse(slip({ chargeTo: 'NONE', reservationId: null })).success, false);
    assert.equal(minibarConsumptionSchema.safeParse(slip({ chargeTo: 'NONE', reservationId: null, lossReason: 'Boş odada eksik' })).success, true);
    assert.equal(minibarConsumptionSchema.safeParse(slip({ chargeTo: 'NONE', lossReason: 'Boş odada eksik' })).success, false);
  });

  it('adet 1-99, satır en az bir', () => {
    for (const quantity of [0, 100, 1.5]) {
      assert.equal(minibarConsumptionSchema.safeParse(slip({ lines: [{ itemId: ID, quantity }] })).success, false, String(quantity));
    }
    assert.equal(minibarConsumptionSchema.safeParse(slip({ lines: [] })).success, false);
  });
});

describe('fiyat listesi', () => {
  it('kod büyük harfe, fiyat virgüllü olabilir; sıfır / çok yüksek fiyat reddedilir', () => {
    const parsed = minibarItemInputSchema.parse({ code: 'su-05', name: 'Su 0,5 L', category: 'DRINK', price: '45,50' });
    assert.equal(parsed.code, 'SU-05');
    assert.equal(parsed.price, '45.5');
    assert.equal(parsed.parLevel, 1);
    for (const price of ['0', '-1', '100001', '1.234']) {
      assert.equal(laundryItemInputSchema.safeParse({ code: 'G1', name: 'Gömlek', service: 'WASH', price }).success, false, price);
    }
    assert.equal(minibarItemInputSchema.safeParse({ code: 'A B', name: 'Su', category: 'DRINK', price: '45' }).success, false);
  });

  it('ekspres farkı 0-300, en fazla 2 ondalık; sürüm damgası zorunlu', () => {
    const expectedUpdatedAt = '2026-10-05T09:00:00.000Z';
    assert.equal(laundrySettingsSchema.parse({ expressPct: '50', expectedUpdatedAt }).expressPct, '50');
    assert.equal(laundrySettingsSchema.safeParse({ expressPct: '301', expectedUpdatedAt }).success, false);
    assert.equal(laundrySettingsSchema.safeParse({ expressPct: '12.345', expectedUpdatedAt }).success, false);
    assert.equal(laundrySettingsSchema.safeParse({ expressPct: '50' }).success, false, 'sürümsüz kayıt ezebilirdi');
  });
});

describe('çamaşır siparişi', () => {
  it('sipariş konaklama, teslim zamanı ve en az bir parça ister', () => {
    const order = { requestId: ID, roomId: ID, reservationId: ID2, dueAt: '2026-10-05T15:00:00Z', lines: [{ itemId: ID, quantity: 3 }] };
    assert.equal(laundryOrderSchema.parse(order).express, false);
    assert.equal(laundryOrderSchema.safeParse({ ...order, reservationId: undefined }).success, false);
    assert.equal(laundryOrderSchema.safeParse({ ...order, dueAt: 'yarın' }).success, false);
  });

  it('teslim zamanı şimdiden sonra ve en fazla birkaç gün içinde', () => {
    const now = new Date('2026-10-04T10:00:00Z');
    assert.equal(laundryDueAtError(new Date('2026-10-04T14:00:00Z'), now), null);
    assert.match(laundryDueAtError(new Date('2026-10-04T09:00:00Z'), now), /şimdiden sonra/);
    assert.match(laundryDueAtError(new Date(now.getTime() + (LAUNDRY_MAX_DUE_DAYS + 1) * 86400000), now), /en fazla/);
  });

  it('durum ileri atlanabilir, geri dönülmez; teslim / iptal son durumdur', () => {
    assert.equal(laundryTransitionError('RECEIVED', 'IN_PROCESS'), null);
    assert.equal(laundryTransitionError('RECEIVED', 'DELIVERED'), null, 'ütü hemen biter');
    assert.equal(laundryTransitionError('READY', 'CANCELLED'), null);
    assert.match(laundryTransitionError('READY', 'IN_PROCESS'), /geri alınamaz/);
    assert.match(laundryTransitionError('DELIVERED', 'CANCELLED'), /Teslim edilmiş/);
    assert.match(laundryTransitionError('CANCELLED', 'READY'), /İptal edilmiş/);
    assert.match(laundryTransitionError('READY', 'READY'), /zaten/);
  });

  it('iptal gerekçe ister; gecikme yalnızca açık siparişte', () => {
    const at = '2026-10-04T10:00:00Z';
    assert.equal(laundryStatusSchema.safeParse({ expectedUpdatedAt: at, status: 'CANCELLED' }).success, false);
    assert.equal(laundryStatusSchema.safeParse({ expectedUpdatedAt: at, status: 'CANCELLED', reason: 'Misafir vazgeçti' }).success, true);
    assert.equal(laundryStatusSchema.safeParse({ expectedUpdatedAt: at, status: 'RECEIVED' }).success, false);
    const now = new Date('2026-10-04T12:00:00Z');
    assert.equal(laundryOverdue({ status: 'READY', dueAt: '2026-10-04T11:00:00Z' }, now), true);
    assert.equal(laundryOverdue({ status: 'DELIVERED', dueAt: '2026-10-04T11:00:00Z' }, now), false);
  });
});
