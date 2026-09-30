import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalSelfDecisionError } from './approvals.js';
import {
  FOLIO_MAX_QUANTITY,
  chargePreviewSchema,
  folioActionError,
  folioDisplayName,
  folioItemActionError,
  folioRoutesSchema,
  folioTaxCategory,
  mergeFoliosSchema,
  postChargeSchema,
  splitFolioSchema,
  transferItemsSchema,
  voidRequestSchema,
} from './folios.js';

const ID = '6f1c1f1e-2b8a-4c1e-9a8e-1a2b3c4d5e6f';
const ID2 = '7a2d2e2f-3c9b-4d2f-8b9f-2b3c4d5e6f70';

const charge = (overrides = {}) => ({
  requestId: ID,
  type: 'MINIBAR',
  description: 'Su',
  amount: '45,50',
  quantity: 2,
  ...overrides,
});

describe('postChargeSchema', () => {
  it('virgüllü tutarı normalleştirir, adedi varsayılan 1 yapar', () => {
    const parsed = postChargeSchema.parse(charge({ quantity: undefined }));
    assert.equal(parsed.amount, '45.5');
    assert.equal(parsed.quantity, 1);
  });

  it('sıfır, eksi, üç ondalık ve binlik ayırıcı reddedilir', () => {
    for (const amount of ['0', '-5', '1.234', '1.250,00', 'abc', '']) {
      assert.equal(postChargeSchema.safeParse(charge({ amount })).success, false, amount);
    }
  });

  it('üst sınırı aşan tutar ve adet reddedilir', () => {
    assert.equal(postChargeSchema.safeParse(charge({ amount: '1000000.01' })).success, false);
    assert.equal(postChargeSchema.safeParse(charge({ quantity: FOLIO_MAX_QUANTITY + 1 })).success, false);
    assert.equal(postChargeSchema.safeParse(charge({ quantity: 1.5 })).success, false);
  });

  it('oda ücreti ve vergi tipi elle işlenmez', () => {
    assert.equal(postChargeSchema.safeParse(charge({ type: 'ROOM' })).success, false);
    assert.equal(postChargeSchema.safeParse(charge({ type: 'TAX' })).success, false);
  });

  it('indirim gelir türü ister; diğer tiplerde gelir türü verilmez', () => {
    assert.equal(postChargeSchema.safeParse(charge({ type: 'DISCOUNT' })).success, false);
    assert.equal(postChargeSchema.safeParse(charge({ type: 'DISCOUNT', discountCategory: 'ROOM' })).success, true);
    assert.equal(postChargeSchema.safeParse(charge({ discountCategory: 'ROOM' })).success, false);
  });

  it('açıklama kırpılır; çok kısa ya da uzun açıklama reddedilir', () => {
    assert.equal(postChargeSchema.parse(charge({ description: '  Kola  ' })).description, 'Kola');
    assert.equal(postChargeSchema.safeParse(charge({ description: ' a ' })).success, false);
    assert.equal(postChargeSchema.safeParse(charge({ description: 'x'.repeat(201) })).success, false);
  });

  it('istek kimliği zorunlu; önizleme istemez', () => {
    assert.equal(postChargeSchema.safeParse(charge({ requestId: undefined })).success, false);
    assert.equal(chargePreviewSchema.safeParse({ type: 'SPA', amount: '100' }).success, true);
  });
});

describe('liste şemaları', () => {
  it('aktarma: en az bir kalem, tekrar yok', () => {
    assert.equal(transferItemsSchema.safeParse({ itemIds: [], targetFolioId: ID }).success, false);
    assert.equal(transferItemsSchema.safeParse({ itemIds: [ID, ID], targetFolioId: ID2 }).success, false);
    assert.equal(transferItemsSchema.safeParse({ itemIds: [ID], targetFolioId: ID2 }).success, true);
  });

  it('bölme: kalemsiz bölme boş folyo açar; ödeyen adı boşsa null', () => {
    const parsed = splitFolioSchema.parse({ payerName: '   ' });
    assert.deepEqual(parsed.itemIds, []);
    assert.equal(parsed.payerName, null);
    assert.deepEqual(parsed.routeTypes, []);
    assert.equal(splitFolioSchema.safeParse({ routeTypes: ['ROOM', 'ROOM'] }).success, false);
    assert.equal(splitFolioSchema.safeParse({ routeTypes: ['DISCOUNT'] }).success, false);
  });

  it('birleştirme en az bir kaynak ister', () => {
    assert.equal(mergeFoliosSchema.safeParse({ sourceFolioIds: [] }).success, false);
    assert.equal(mergeFoliosSchema.safeParse({ sourceFolioIds: [ID] }).success, true);
  });

  it('yönlendirme: tip başına bir satır; null yönlendirmeyi kaldırır', () => {
    assert.equal(folioRoutesSchema.safeParse({ routes: [{ type: 'ROOM', folioId: null }] }).success, true);
    assert.equal(
      folioRoutesSchema.safeParse({ routes: [{ type: 'ROOM', folioId: ID }, { type: 'ROOM', folioId: null }] }).success,
      false,
    );
  });

  it('iptal gerekçesi zorunlu', () => {
    assert.equal(voidRequestSchema.safeParse({ reason: ' x ' }).success, false);
    assert.equal(voidRequestSchema.safeParse({ reason: 'Yanlış odaya işlendi' }).success, true);
  });
});

describe('folioActionError', () => {
  it('kapalı ve birleştirilmiş folyoya işlem yapılmaz', () => {
    assert.match(folioActionError({ status: 'CLOSED' }, 'post'), /kapalı/);
    assert.match(folioActionError({ status: 'TRANSFERRED' }, 'post'), /birleştirilmiş/);
    assert.equal(folioActionError({ status: 'OPEN' }, 'post'), null);
  });

  it('kapatma: bakiye sıfır, bekleyen iptal yok, içerideki son açık folyo değil', () => {
    const open = { status: 'OPEN' };
    assert.match(folioActionError(open, 'close', { balanceZero: false }), /Bakiye/);
    assert.match(folioActionError(open, 'close', { balanceZero: true, pendingVoids: 1 }), /onay bekleyen/);
    assert.match(folioActionError(open, 'close', { balanceZero: true, lastOpenOfInHouseStay: true }), /son açık/);
    assert.equal(folioActionError(open, 'close', { balanceZero: true }), null);
    // Hem bakiye hem son açık folyo: önce yapısal engel söylenir.
    assert.match(folioActionError(open, 'close', { balanceZero: false, lastOpenOfInHouseStay: true }), /son açık/);
  });

  it('yalnızca kapanmış folyo yeniden açılır', () => {
    assert.equal(folioActionError({ status: 'CLOSED' }, 'reopen'), null);
    assert.ok(folioActionError({ status: 'OPEN' }, 'reopen'));
    assert.ok(folioActionError({ status: 'TRANSFERRED' }, 'reopen'));
  });
});

describe('folioItemActionError', () => {
  it('ters kayıt, iptal edilmiş ve onay bekleyen kalem', () => {
    assert.ok(folioItemActionError({ source: 'REVERSAL' }, 'void'));
    assert.ok(folioItemActionError({ source: 'MANUAL', voidedAt: new Date() }, 'transfer'));
    assert.match(folioItemActionError({ source: 'MANUAL', voidPending: true }, 'void'), /zaten bekliyor/);
    assert.match(folioItemActionError({ source: 'MANUAL', voidPending: true }, 'transfer'), /taşınamaz/);
    assert.equal(folioItemActionError({ source: 'ROOM_NIGHT' }, 'void'), null);
  });
});

describe('yardımcılar', () => {
  it('vergi kategorisi: indirim seçilen gelirin, diğerleri kendi tipinin', () => {
    assert.equal(folioTaxCategory('DISCOUNT', 'ROOM'), 'ROOM');
    assert.equal(folioTaxCategory('MINIBAR', null), 'MINIBAR');
    assert.equal(folioTaxCategory('TAX', null), null);
  });

  it('folyo adı', () => {
    assert.equal(folioDisplayName({ window: 1, payerName: null }), 'Folyo 1');
    assert.equal(folioDisplayName({ window: 2, payerName: 'ABC Ltd.' }), 'Folyo 2 · ABC Ltd.');
  });

  it('dört göz: kalem iptalini isteyen onaylayamaz, reddedip geri çekebilir (büyük/küçük harf fark etmez)', () => {
    const approval = { type: 'FOLIO_VOID', requestedBy: 'Resepsiyon@Otel.com' };
    assert.ok(approvalSelfDecisionError(approval, 'resepsiyon@otel.com'));
    assert.equal(approvalSelfDecisionError(approval, 'resepsiyon@otel.com', 'DENIED'), null);
    assert.equal(approvalSelfDecisionError(approval, 'mudur@otel.com'), null);
    assert.equal(approvalSelfDecisionError({ type: 'OVERBOOKING', requestedBy: 'a@b.co' }, 'a@b.co'), null);
  });
});
