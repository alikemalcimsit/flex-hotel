import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOST_ITEM_PHOTO_BODY_LIMIT,
  lostItemActionError,
  lostItemExpired,
  lostItemExpiryCutoff,
  lostItemFoundAtError,
  lostItemInputSchema,
  lostItemListQuerySchema,
  lostItemRetainUntil,
  lostItemReturnError,
  lostItemReturnSchema,
  lostItemSettingsSchema,
} from './lost-items.js';

const REQUEST_ID = '6f1c1d3e-8b7a-4a52-9a4e-1c2b3d4e5f60';
const ROOM_ID = '0b9b8a7c-6d5e-4f3a-8b2c-1d0e9f8a7b6c';
const settings = { retentionDays: 90, valuableRetentionDays: 365 };

describe('lostItemInputSchema', () => {
  const base = {
    requestId: REQUEST_ID,
    description: '  Siyah deri cüzdan  ',
    category: 'DOCUMENTS',
    foundAt: '2026-10-10T09:30:00.000Z',
    foundByName: 'Ayşe K.',
    storageLocation: 'Kasa',
  };

  it('odayla ya da yazılı yerle kabul eder; metni kırpar, değerli varsayılanı hayır', () => {
    const parsed = lostItemInputSchema.parse({ ...base, roomId: ROOM_ID });
    assert.equal(parsed.description, 'Siyah deri cüzdan');
    assert.equal(parsed.valuable, false);
    assert.ok(parsed.foundAt instanceof Date);
    assert.equal(lostItemInputSchema.parse({ ...base, locationText: 'Lobi' }).locationText, 'Lobi');
  });

  it('yeri olmayanı, kısa açıklamayı ve bilinmeyen kategoriyi reddeder', () => {
    const missingPlace = lostItemInputSchema.safeParse(base);
    assert.equal(missingPlace.success, false);
    assert.deepEqual(missingPlace.error.issues[0].path, ['locationText']);
    assert.equal(lostItemInputSchema.safeParse({ ...base, roomId: ROOM_ID, description: 'ab' }).success, false);
    assert.equal(lostItemInputSchema.safeParse({ ...base, roomId: ROOM_ID, category: 'CAR' }).success, false);
    assert.equal(lostItemInputSchema.safeParse({ ...base, roomId: ROOM_ID, foundAt: 'dün' }).success, false);
  });
});

describe('lostItemReturnSchema', () => {
  const stamp = '2026-10-10T10:00:00.000Z';

  it('elden teslimde teslim alan zorunlu', () => {
    assert.equal(lostItemReturnSchema.safeParse({ expectedUpdatedAt: stamp, method: 'IN_PERSON' }).success, false);
    assert.equal(lostItemReturnSchema.safeParse({ expectedUpdatedAt: stamp, method: 'IN_PERSON', receiverName: 'Ali Veli' }).success, true);
  });

  it('kargoda firma, takip no, adres ve ödeyen zorunlu; ücret virgüllü yazılabilir', () => {
    const missing = lostItemReturnSchema.safeParse({ expectedUpdatedAt: stamp, method: 'SHIPPED' });
    assert.deepEqual(missing.error.issues.map((issue) => issue.path[0]).sort(), ['carrier', 'shippingAddress', 'shippingPayer', 'trackingNumber']);
    const parsed = lostItemReturnSchema.parse({
      expectedUpdatedAt: stamp,
      method: 'SHIPPED',
      carrier: 'Yurtiçi',
      trackingNumber: '123456789',
      shippingAddress: 'Atatürk Cad. No: 5, Çankaya / Ankara',
      shippingCost: '120,50',
      shippingPayer: 'GUEST',
    });
    assert.equal(parsed.shippingCost, '120.5');
    assert.equal(lostItemReturnSchema.safeParse({ ...parsed, expectedUpdatedAt: stamp, shippingCost: '-5' }).success, false);
  });
});

describe('lostItemSettingsSchema / lostItemListQuerySchema', () => {
  it('değerli eşya süresi normalden kısa olamaz; sınırlar uygulanır; sürüm damgası zorunlu', () => {
    const expectedUpdatedAt = '2026-10-05T09:00:00.000Z';
    assert.equal(lostItemSettingsSchema.safeParse({ expectedUpdatedAt, retentionDays: 90, valuableRetentionDays: 30 }).success, false);
    assert.equal(lostItemSettingsSchema.safeParse({ expectedUpdatedAt, retentionDays: 3, valuableRetentionDays: 30 }).success, false);
    const parsed = lostItemSettingsSchema.parse({ expectedUpdatedAt, retentionDays: '60', valuableRetentionDays: '60' });
    assert.deepEqual([parsed.retentionDays, parsed.valuableRetentionDays, parsed.expectedUpdatedAt.toISOString()], [60, 60, expectedUpdatedAt]);
    assert.equal(lostItemSettingsSchema.safeParse({ retentionDays: 60, valuableRetentionDays: 60 }).success, false, 'sürümsüz kayıt ezebilirdi');
  });

  it('tarih aralığı ters olamaz; "valuable=false" hayır okunur', () => {
    assert.equal(lostItemListQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success, false);
    const parsed = lostItemListQuerySchema.parse({ valuable: 'false' });
    assert.equal(parsed.valuable, false);
    assert.equal(parsed.view, 'OPEN');
  });
});

describe('saklama süresi', () => {
  it('son gün: bulunduğu gün + süre (değerli ayrı)', () => {
    assert.equal(lostItemRetainUntil({ businessDate: '2026-01-01', valuable: false }, settings), '2026-04-01');
    assert.equal(lostItemRetainUntil({ businessDate: '2026-01-01', valuable: true }, settings), '2027-01-01');
  });

  it('son gün geçince dolar; kapanmış eşyanın süresi dolmaz', () => {
    const item = { status: 'STORED', businessDate: '2026-01-01', valuable: false };
    assert.equal(lostItemExpired(item, settings, '2026-04-01'), false);
    assert.equal(lostItemExpired(item, settings, '2026-04-02'), true);
    assert.equal(lostItemExpired({ ...item, status: 'RETURNED' }, settings, '2027-01-01'), false);
  });

  it('liste eşiği aynı cevabı verir: bulunduğu gün eşikten önceyse dolmuş', () => {
    for (const today of ['2026-04-01', '2026-04-02', '2026-12-31']) {
      const cutoff = lostItemExpiryCutoff(today, settings.retentionDays);
      assert.equal('2026-01-01' < cutoff, lostItemExpired({ status: 'STORED', businessDate: '2026-01-01', valuable: false }, settings, today), today);
    }
  });
});

describe('kurallar', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  it('bulunma zamanı ileride ya da çok eskide olamaz (birkaç dakikalık saat farkı tolere edilir)', () => {
    assert.equal(lostItemFoundAtError(new Date('2026-10-10T12:03:00.000Z'), now), null);
    assert.match(lostItemFoundAtError(new Date('2026-10-10T13:00:00.000Z'), now), /ileride/);
    assert.match(lostItemFoundAtError(new Date('2026-08-01T12:00:00.000Z'), now), /en fazla 30 gün/);
  });

  it('kapanmış kayıt değişmez; not her durumda yazılır; eşleşmesiz eşyada eşleşme kaldırılmaz', () => {
    assert.equal(lostItemActionError('STORED', 'EDIT'), null);
    assert.match(lostItemActionError('RETURNED', 'MATCH'), /teslim edilmiş/);
    assert.match(lostItemActionError('DISPOSED', 'PHOTO'), /kapatılmış/);
    assert.equal(lostItemActionError('DISPOSED', 'CONTACT'), null);
    assert.match(lostItemActionError('STORED', 'UNMATCH'), /eşleşmemiş/);
    assert.equal(lostItemActionError('MATCHED', 'UNMATCH'), null);
  });

  it('değerli eşya elden kimlik görülmeden verilmez; kargoda kimlik sorulmaz', () => {
    assert.match(lostItemReturnError({ valuable: true }, { method: 'IN_PERSON', receiverIdChecked: false }), /kimliği/);
    assert.equal(lostItemReturnError({ valuable: true }, { method: 'IN_PERSON', receiverIdChecked: true }), null);
    assert.equal(lostItemReturnError({ valuable: true }, { method: 'SHIPPED' }), null);
    assert.equal(lostItemReturnError({ valuable: false }, { method: 'IN_PERSON', receiverIdChecked: false }), null);
  });

  it('fotoğraf gövde sınırı iki base64 dosyayı karşılar', () => {
    assert.ok(LOST_ITEM_PHOTO_BODY_LIMIT > ((1_500_000 + 150_000) * 4) / 3);
  });
});
