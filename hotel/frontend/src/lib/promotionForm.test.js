import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROMOTION_SOURCES, PROMOTION_SOURCES, createPromotionSchema, updatePromotionSchema } from '@hotelos/hotel-contracts';
import { EMPTY_PROMOTION_FORM, describeRule, discountPhrase, formOf, payloadOf, toggle } from './promotionForm.js';

const STD = '11111111-1111-4111-8111-111111111111';
const DLX = '22222222-2222-4222-8222-222222222222';
const context = { currency: 'TRY', roomTypeName: (id) => ({ [STD]: 'Standart', [DLX]: 'Deluxe' })[id] ?? '?', boardLabel: (board) => board };

const server = {
  id: 'p1',
  name: 'Erken Rezervasyon',
  notes: null,
  requiresCoupon: false,
  discountType: 'PERCENT',
  discountValue: '15.00',
  stayNights: null,
  payNights: null,
  bookFrom: '2027-01-01',
  bookTo: '2027-03-31',
  stayFrom: '2027-06-01',
  stayTo: '2027-09-30',
  minNights: 3,
  maxNights: null,
  minLeadDays: 60,
  maxLeadDays: null,
  roomTypeIds: [STD],
  boardTypes: ['AI', 'BB'],
  sources: ['PHONE', 'UI'],
  updatedAt: '2027-01-01T10:00:00.000Z',
};

describe('promosyon formu ↔ sunucu', () => {
  it('boş form doğrudan satış kanallarıyla başlar; her açılışta yeni liste (paylaşılan dizi değişmez)', () => {
    const a = formOf(null);
    a.sources.push('OTA');
    assert.deepEqual(formOf(null).sources, [...DEFAULT_PROMOTION_SOURCES]);
    assert.equal(EMPTY_PROMOTION_FORM.discountType, 'PERCENT');
  });

  it('sunucudaki promosyon forma Türkçe yazımla gelir; gövde sözleşmeden geçer ve aynı kuralı verir', () => {
    const form = formOf(server);
    assert.equal(form.discountValue, '15');
    assert.equal(form.minNights, '3');
    assert.equal(form.maxNights, '');
    const payload = payloadOf(form, server.updatedAt);
    assert.deepEqual(payload.boardTypes, ['BB', 'AI'], 'katalog sırası');
    assert.deepEqual(payload.sources, ['UI', 'PHONE'], 'katalog sırası');
    const parsed = updatePromotionSchema.parse(payload);
    assert.equal(parsed.discountValue, '15');
    assert.equal(parsed.minNights, 3);
    assert.equal(parsed.maxNights, null);
    assert.equal(parsed.minLeadDays, 60);
    assert.equal(parsed.bookFrom.toISOString().slice(0, 10), '2027-01-01');
  });

  it('tür değişince kullanılmayan alanlar boş gider: "X kal Y öde"de tutar, yüzdede gece sayıları', () => {
    const freeNights = payloadOf({ ...formOf(null), name: 'Üç kal iki öde', discountType: 'FREE_NIGHTS', discountValue: '20', stayNights: '3', payNights: '2' });
    assert.deepEqual([freeNights.discountValue, freeNights.stayNights, freeNights.payNights], ['', '3', '2']);
    const parsed = createPromotionSchema.parse(freeNights);
    assert.deepEqual([parsed.discountValue, parsed.stayNights, parsed.payNights], [null, 3, 2]);

    const percent = payloadOf({ ...formOf(null), name: 'Yüzde', discountType: 'PERCENT', discountValue: '12,5', stayNights: '3', payNights: '2' });
    assert.deepEqual([percent.stayNights, percent.payNights], ['', '']);
    assert.equal(createPromotionSchema.parse(percent).discountValue, '12.5');
  });

  it('sözleşme formun hatalarını alanına bağlar', () => {
    const bad = createPromotionSchema.safeParse(payloadOf({ ...formOf(null), name: 'X', discountType: 'FREE_NIGHTS', stayNights: '3', payNights: '3', sources: [] }));
    assert.equal(bad.success, false);
    const paths = bad.error.issues.map((issue) => issue.path.join('.'));
    assert.ok(paths.includes('name'));
    assert.ok(paths.includes('payNights'));
    assert.ok(paths.includes('sources'));
  });
});

describe('kuralın okunur hâli', () => {
  it('indirim ve koşullar ayrı satırlar', () => {
    const { headline, conditions } = describeRule(server, context);
    assert.equal(headline, '%15');
    assert.deepEqual(conditions, [
      'Koşulu tutan satışa kendiliğinden uygulanır',
      'Rezervasyon 01.01.2027 – 31.03.2027 arasında yapılırsa',
      'İndirim 01.06.2027 – 30.09.2027 gecelerine',
      'En az 3 gece konaklamada',
      'Girişe en az 60 gün kala (erken rezervasyon)',
      'Oda tipi: Standart',
      'Pansiyon: AI, BB',
      'Kanal: Resepsiyon (yüz yüze), Telefon',
    ]);
  });

  it('indirim adı: yüzde, tutar, "X kal Y öde"; eksik değerde genel ad', () => {
    assert.equal(discountPhrase({ discountType: 'PERCENT', discountValue: '12.50' }, 'TRY'), '%12,5');
    assert.equal(discountPhrase({ discountType: 'AMOUNT', discountValue: '500' }, 'TRY'), '500 TRY indirim');
    assert.equal(discountPhrase({ discountType: 'AMOUNT', discountValue: '250,5' }, 'EUR'), '250,50 EUR indirim');
    assert.equal(discountPhrase({ discountType: 'FREE_NIGHTS', stayNights: 3, payNights: 2 }, 'TRY'), '3 gece kal 2 gece öde');
    assert.equal(discountPhrase({ discountType: 'PERCENT', discountValue: '' }, 'TRY'), 'yüzde indirim');
  });

  it('kupon, gece aralığı, son dakika, bütün kanallar', () => {
    const rule = { ...formOf(null), requiresCoupon: true, minNights: '2', maxNights: '7', maxLeadDays: '0', sources: [...PROMOTION_SOURCES] };
    const { conditions } = describeRule(rule, context);
    assert.deepEqual(conditions, [
      'Kupon kodu girilince uygulanır',
      '2–7 gece konaklamada',
      'Yalnızca giriş günü yapılan rezervasyonda (son dakika)',
      'Bütün kanallar (acente hariç)',
    ]);
    assert.ok(describeRule({ ...rule, sources: [] }, context).conditions.includes('Satış kanalı seçilmedi'));
  });

  it('açık uçlu dönemler doğal okunur; varsayılan kanallar tek satır', () => {
    const { conditions } = describeRule({ ...formOf(null), bookFrom: '2027-01-01', stayTo: '2027-09-30' }, context);
    assert.deepEqual(conditions, [
      'Koşulu tutan satışa kendiliğinden uygulanır',
      'Rezervasyon 01.01.2027 ve sonrasında yapılırsa',
      'İndirim 30.09.2027 ve önceki gecelere',
      'Doğrudan satış kanalları (OTA ve acente hariç)',
    ]);
    assert.ok(describeRule({ ...formOf(null), bookTo: '2027-03-31' }, context).conditions.includes('Rezervasyon en geç 31.03.2027 tarihinde yapılırsa'));
  });

  it('aç / kapa', () => {
    assert.deepEqual(toggle(['BB'], 'AI'), ['BB', 'AI']);
    assert.deepEqual(toggle(['BB', 'AI'], 'BB'), ['AI']);
  });
});
