import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROMOTION_SOURCES,
  PROMOTION_SOURCES,
  RESERVATION_SOURCES,
  couponCodeField,
  createCouponsSchema,
  createPromotionSchema,
  createReservationSchema,
  normalizeCouponCode,
  promotionReportQuerySchema,
  reservationUpdatePreviewSchema,
  updateReservationSchema,
} from './index.js';

const base = { name: 'Erken Rezervasyon', discountType: 'PERCENT', discountValue: '15', sources: ['UI'] };
const issuesOf = (schema, value) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};
const has = (issues, path) => issues.some((line) => line.startsWith(`${path}:`));

describe('promosyon şeması', () => {
  it('satış kanalları rezervasyon kaynakları eksi acente; varsayılanlar doğrudan satış (OTA yok)', () => {
    assert.deepEqual(PROMOTION_SOURCES, RESERVATION_SOURCES.filter((source) => source !== 'AGENCY').sort((a, b) => PROMOTION_SOURCES.indexOf(a) - PROMOTION_SOURCES.indexOf(b)));
    assert.ok(!DEFAULT_PROMOTION_SOURCES.includes('OTA'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, sources: ['AGENCY'] }), 'sources.0'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, sources: [] }), 'sources'));
  });

  it('boş metin "yok" demektir; virgüllü ondalık kabul edilir; tür kullanılmayan alanları boşaltır', () => {
    const parsed = createPromotionSchema.parse({ ...base, discountValue: '12,5', minNights: '', bookFrom: '', stayNights: '3', payNights: '2' });
    assert.equal(parsed.discountValue, '12.5');
    assert.equal(parsed.minNights, null);
    assert.equal(parsed.bookFrom, null);
    assert.deepEqual([parsed.stayNights, parsed.payNights], [null, null], 'yüzdede gece sayıları boşalır');
    const free = createPromotionSchema.parse({ ...base, discountType: 'FREE_NIGHTS', discountValue: '20', stayNights: 3, payNights: 2 });
    assert.equal(free.discountValue, null, '"X kal Y öde"de tutar boşalır');
  });

  it('indirim türüne göre aralık: yüzde (0, 100], tutar > 0, ödenen gece < kalınan gece', () => {
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountValue: '0' }), 'discountValue'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountValue: '100.01' }), 'discountValue'));
    assert.deepEqual(issuesOf(createPromotionSchema, { ...base, discountValue: '100' }), []);
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountValue: '' }), 'discountValue'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountType: 'AMOUNT', discountValue: '0' }), 'discountValue'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountType: 'AMOUNT', discountValue: '1.234' }), 'discountValue'), 'en fazla iki ondalık');
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountType: 'FREE_NIGHTS', stayNights: 3, payNights: 3 }), 'payNights'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, discountType: 'FREE_NIGHTS', stayNights: null, payNights: 2 }), 'stayNights'));
  });

  it('"X kal Y öde" hiç uygulanamayacak kurallar reddedilir (en fazla gece < X, dönem X geceden kısa)', () => {
    const free = { ...base, discountType: 'FREE_NIGHTS', stayNights: 7, payNights: 6 };
    assert.ok(has(issuesOf(createPromotionSchema, { ...free, maxNights: 5 }), 'maxNights'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...free, stayFrom: '2027-06-01', stayTo: '2027-06-05' }), 'stayTo'));
    assert.deepEqual(issuesOf(createPromotionSchema, { ...free, stayFrom: '2027-06-01', stayTo: '2027-06-07' }), [], '7 gecelik dönem yeter (iki uç dahil)');
  });

  it('dönemler ve sınırlar tutarlı: bitiş ≥ başlangıç, en fazla ≥ en az, son dakika ≥ erken gün', () => {
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, bookFrom: '2027-03-01', bookTo: '2027-02-01' }), 'bookTo'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, stayFrom: '2027-03-01', stayTo: '2030-12-31' }), 'stayTo'), '1100 günden uzun');
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, minNights: 5, maxNights: 3 }), 'maxNights'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, minLeadDays: 30, maxLeadDays: 7 }), 'maxLeadDays'));
    assert.ok(has(issuesOf(createPromotionSchema, { ...base, name: ' X ' }), 'name'));
  });

  it('kullanım raporu dönemi en fazla 1100 gün; bitiş başlangıçtan önce olamaz', () => {
    assert.ok(has(issuesOf(promotionReportQuerySchema, { from: '2027-02-01', to: '2027-01-01' }), 'to'));
    assert.ok(has(issuesOf(promotionReportQuerySchema, { from: '2024-01-01', to: '2027-12-31' }), 'to'));
    assert.equal(promotionReportQuerySchema.parse({ from: '2027-01-01', to: '2027-01-31' }).basis, 'BOOKED');
  });
});

describe('kupon kodu', () => {
  it('boşluklar atılır, büyük harf (Türkçe "i" sorunu olmadan), harf / rakam / tire, 4–30 karakter', () => {
    assert.equal(normalizeCouponCode(' yaz 2027 '), 'YAZ2027');
    assert.equal(normalizeCouponCode('istanbul'), 'ISTANBUL', 'İngilizce büyük harf: "i" → "I"');
    assert.equal(couponCodeField.parse('sadik-k7qx'), 'SADIK-K7QX');
    assert.equal(couponCodeField.safeParse('AB1').success, false, 'en az 4');
    assert.equal(couponCodeField.safeParse('-YAZ27').success, false, 'tireyle başlamaz');
    assert.equal(couponCodeField.safeParse('YAZ_27').success, false, 'alt çizgi yok');
    assert.equal(couponCodeField.safeParse('A'.repeat(31)).success, false, 'en fazla 30');
  });

  it('üretim: adet 1–5000, önek harf / rakam (en fazla 10), kullanım boş = sınırsız', () => {
    const generated = createCouponsSchema.parse({ mode: 'GENERATE', count: '200', prefix: 'yaz', maxUses: '' });
    assert.deepEqual([generated.count, generated.prefix, generated.maxUses], [200, 'YAZ', null]);
    assert.equal(createCouponsSchema.parse({ mode: 'GENERATE', count: 1, prefix: '', maxUses: 1 }).prefix, null);
    assert.equal(createCouponsSchema.safeParse({ mode: 'GENERATE', count: 5001, maxUses: 1 }).success, false);
    assert.equal(createCouponsSchema.safeParse({ mode: 'GENERATE', count: 10, prefix: 'YAZ-', maxUses: 1 }).success, false);
    assert.equal(createCouponsSchema.safeParse({ mode: 'GENERATE', count: 10, maxUses: 0 }).success, false);
    assert.equal(createCouponsSchema.parse({ mode: 'CUSTOM', code: 'hosgeldin', maxUses: null }).code, 'HOSGELDIN');
  });
});

describe('rezervasyonda kupon', () => {
  const reservation = {
    guestId: '11111111-1111-4111-8111-111111111111',
    roomTypeId: '22222222-2222-4222-8222-222222222222',
    adults: 2,
    boardType: 'BB',
    checkIn: '2027-06-01',
    checkOut: '2027-06-04',
    requestId: '33333333-3333-4333-8333-333333333333',
  };

  it('boş kupon "yok"; acente satışında ve elle fiyatta kupon reddedilir', () => {
    assert.equal(createReservationSchema.parse({ ...reservation, couponCode: '  ' }).couponCode, null);
    assert.equal(createReservationSchema.parse({ ...reservation, couponCode: 'yaz2027' }).couponCode, 'YAZ2027');
    assert.ok(has(issuesOf(createReservationSchema, { ...reservation, source: 'AGENCY', agencyId: '44444444-4444-4444-8444-444444444444', couponCode: 'YAZ2027' }), 'couponCode'));
    assert.ok(has(issuesOf(createReservationSchema, { ...reservation, manualTotal: '1000', priceNote: 'Kurumsal', couponCode: 'YAZ2027' }), 'couponCode'));
  });

  it('düzenleme: kupon ekle / indirimi kaldır; acenteyle ya da elle fiyatla kupon olmaz; önizleme sürüm istemez', () => {
    const version = { expectedUpdatedAt: '2027-01-01T00:00:00.000Z' };
    assert.equal(updateReservationSchema.parse({ ...version, discount: { mode: 'COUPON', code: 'yaz2027' } }).discount.code, 'YAZ2027');
    assert.equal(updateReservationSchema.parse({ ...version, discount: { mode: 'REMOVE' } }).discount.mode, 'REMOVE');
    assert.ok(has(issuesOf(updateReservationSchema, { ...version, agencyId: '44444444-4444-4444-8444-444444444444', discount: { mode: 'COUPON', code: 'YAZ2027' } }), 'discount.code'));
    assert.ok(has(issuesOf(updateReservationSchema, { ...version, price: { mode: 'MANUAL', total: '900', note: 'x' }, discount: { mode: 'COUPON', code: 'YAZ2027' } }), 'discount.code'));
    assert.ok(has(issuesOf(updateReservationSchema, { discount: { mode: 'REMOVE' } }), 'expectedUpdatedAt'));
    assert.equal(reservationUpdatePreviewSchema.safeParse({ checkOut: '2027-06-05', discount: { mode: 'REMOVE' } }).success, true);
  });
});
