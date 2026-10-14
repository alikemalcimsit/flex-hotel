import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COUPON_CODE_ALPHABET, COUPON_RANDOM_LENGTH } from '@hotelos/hotel-contracts';
import { applyOffer, bestOffer, discountLabel, discountNights, evaluatePromotion, generateCouponCode, planOffer, promotionIssue, toTerms } from './rules.js';

const STD = 'type-std';
const DLX = 'type-dlx';

/** @returns {import('./rules.js').PromotionTerms} */
const terms = (overrides = {}) => ({
  id: overrides.id ?? 'promo-1',
  name: 'Promosyon',
  requiresCoupon: false,
  discountType: 'PERCENT',
  discountValue: '10.00',
  stayNights: null,
  payNights: null,
  bookFrom: null,
  bookTo: null,
  stayFrom: null,
  stayTo: null,
  minNights: null,
  maxNights: null,
  minLeadDays: null,
  maxLeadDays: null,
  roomTypeIds: [],
  boardTypes: [],
  sources: ['UI', 'PHONE', 'EMAIL', 'WEBCHAT', 'WHATSAPP', 'WIDGET'],
  ...overrides,
});

/** "2027-06-01"den başlayarak n gece. */
const daysFrom = (start, count) =>
  Array.from({ length: count }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));

/** @returns {import('./rules.js').Sale} */
const sale = (overrides = {}) => {
  const checkIn = overrides.checkIn ?? '2027-06-01';
  return {
    bookedOn: '2027-03-01',
    checkIn,
    days: overrides.days ?? daysFrom(checkIn, overrides.nights ?? 3),
    roomTypeId: STD,
    boardType: 'BB',
    source: 'UI',
    ...overrides,
  };
};

const grossNights = (start, prices) => prices.map((gross, index) => ({ date: daysFrom(start, prices.length)[index], gross }));

describe('promosyon koşulları', () => {
  it('kanal, oda tipi ve pansiyon kapsamı', () => {
    assert.equal(promotionIssue(terms(), sale()), null);
    assert.equal(promotionIssue(terms(), sale({ source: 'OTA' }))?.code, 'PROMO_SOURCE');
    assert.equal(promotionIssue(terms({ roomTypeIds: [DLX] }), sale())?.code, 'PROMO_ROOM_TYPE');
    assert.equal(promotionIssue(terms({ roomTypeIds: [DLX, STD] }), sale()), null);
    assert.equal(promotionIssue(terms({ boardTypes: ['AI'] }), sale())?.code, 'PROMO_BOARD');
    assert.equal(promotionIssue(terms({ boardTypes: ['AI', 'BB'] }), sale()), null);
  });

  it('rezervasyon (satış) dönemi iki uç dahil', () => {
    const window = terms({ bookFrom: '2027-01-01', bookTo: '2027-03-01' });
    assert.equal(promotionIssue(window, sale({ bookedOn: '2027-03-01' })), null, 'son gün dahil');
    assert.equal(promotionIssue(window, sale({ bookedOn: '2027-01-01' })), null, 'ilk gün dahil');
    assert.equal(promotionIssue(window, sale({ bookedOn: '2027-03-02' }))?.code, 'PROMO_BOOKING_WINDOW');
    assert.equal(promotionIssue(window, sale({ bookedOn: '2026-12-31' }))?.code, 'PROMO_BOOKING_WINDOW');
    assert.match(promotionIssue(window, sale({ bookedOn: '2027-03-02' }))?.message ?? '', /01\.01\.2027 – 01\.03\.2027/);
  });

  it('en az / en fazla gece', () => {
    assert.equal(promotionIssue(terms({ minNights: 3 }), sale({ nights: 2 }))?.code, 'PROMO_MIN_NIGHTS');
    assert.match(promotionIssue(terms({ minNights: 3 }), sale({ nights: 2 }))?.message ?? '', /En az 3 gece .*2 gece/);
    assert.equal(promotionIssue(terms({ minNights: 3 }), sale({ nights: 3 })), null);
    assert.equal(promotionIssue(terms({ maxNights: 5 }), sale({ nights: 6 }))?.code, 'PROMO_MAX_NIGHTS');
  });

  it('erken rezervasyon: girişe en az N gün kala; son dakika: en fazla N gün kala', () => {
    const early = terms({ minLeadDays: 60 });
    // 1 Haziran girişi için 60 gün öncesi 2 Nisan.
    assert.equal(promotionIssue(early, sale({ bookedOn: '2027-04-02' })), null);
    assert.equal(promotionIssue(early, sale({ bookedOn: '2027-04-03' }))?.code, 'PROMO_LEAD_MIN');
    assert.match(promotionIssue(early, sale({ bookedOn: '2027-04-03' }))?.message ?? '', /girişe 59 gün var/);
    const lastMinute = terms({ maxLeadDays: 7 });
    assert.equal(promotionIssue(lastMinute, sale({ bookedOn: '2027-05-25' })), null);
    assert.equal(promotionIssue(lastMinute, sale({ bookedOn: '2027-05-24' }))?.code, 'PROMO_LEAD_MAX');
    assert.equal(promotionIssue(terms({ maxLeadDays: 0 }), sale({ bookedOn: '2027-06-01' })), null, 'aynı gün giriş');
  });

  it('konaklama dönemi: en az bir gece dönemde olmalı', () => {
    const summer = terms({ stayFrom: '2027-06-03', stayTo: '2027-09-30' });
    assert.equal(promotionIssue(summer, sale({ nights: 2 }))?.code, 'PROMO_STAY_WINDOW', '1–2 Haziran gecelerinin hiçbiri dönemde değil');
    assert.equal(promotionIssue(summer, sale({ nights: 3 })), null, '3 Haziran gecesi dönemde');
  });

  it('"X kal Y öde": dönemdeki gece sayısı X\'ten az ise uymaz (toplam gece yetse bile)', () => {
    const free = terms({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 2, stayFrom: '2027-06-02' });
    assert.equal(promotionIssue(free, sale({ nights: 3 }))?.code, 'PROMO_FREE_NIGHTS', '3 gecenin 2si dönemde');
    assert.equal(promotionIssue(free, sale({ nights: 4 })), null);
  });
});

describe('gece gece indirim', () => {
  it('yüzde: her dönem gecesine, kuruşa yuvarlanarak; dönem dışı gece tam fiyat', () => {
    const percent = terms({ discountValue: '15.00', stayFrom: '2027-06-02' });
    const result = discountNights(percent, grossNights('2027-06-01', ['1234.55', '1234.55', '999.99']));
    assert.deepEqual(result.discounts, ['0.00', '185.18', '150.00']);
    assert.equal(result.total, '335.18');
  });

  it('yüzde 100 geceyi tamamen düşer', () => {
    const result = discountNights(terms({ discountValue: '100.00' }), grossNights('2027-06-01', ['1500.00', '1499.99']));
    assert.deepEqual(result.discounts, ['1500.00', '1499.99']);
  });

  it('tutar: dönem gecelerine fiyatları oranında, kuruş kalanı tarih sırasıyla; toplam tam tutar', () => {
    const amount = terms({ discountType: 'AMOUNT', discountValue: '500.00' });
    const even = discountNights(amount, grossNights('2027-06-01', ['1000.00', '1000.00', '1000.00']));
    assert.deepEqual(even.discounts, ['166.67', '166.67', '166.66']);
    assert.equal(even.total, '500.00');
    const weighted = discountNights(amount, grossNights('2027-06-01', ['3000.00', '1000.00']));
    assert.deepEqual(weighted.discounts, ['375.00', '125.00'], 'fiyatı yüksek gece daha çok indirim alır');
  });

  it('tutar dönemdeki gecelerin toplamını aşamaz', () => {
    const result = discountNights(terms({ discountType: 'AMOUNT', discountValue: '5000.00', stayTo: '2027-06-01' }), grossNights('2027-06-01', ['800.00', '900.00']));
    assert.deepEqual(result.discounts, ['800.00', '0.00']);
  });

  it('"3 kal 2 öde": en ucuz gece bedava; 7 gecede 2 gece', () => {
    const free = terms({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 2 });
    assert.deepEqual(discountNights(free, grossNights('2027-06-01', ['1200.00', '1000.00', '1100.00'])).discounts, ['0.00', '1000.00', '0.00']);
    const week = discountNights(free, grossNights('2027-06-01', ['900.00', '1000.00', '800.00', '1000.00', '1000.00', '1000.00', '1000.00']));
    assert.deepEqual(week.discounts, ['900.00', '0.00', '800.00', '0.00', '0.00', '0.00', '0.00']);
    assert.equal(week.total, '1700.00');
  });

  it('"X kal Y öde" eşit fiyatta konaklamanın sonundaki gece(ler) bedava', () => {
    const free = terms({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 4, payNights: 2 });
    const result = discountNights(free, grossNights('2027-06-01', ['1000.00', '1000.00', '1000.00', '1000.00', '1000.00']));
    assert.deepEqual(result.discounts, ['0.00', '0.00', '0.00', '1000.00', '1000.00']);
  });

  it('her gecede 0 ≤ indirim ≤ fiyat ve toplam = indirimlerin toplamı (rastgele örnekler)', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const kinds = [
      () => terms({ discountValue: (random() * 100).toFixed(2) || '1' }),
      () => terms({ discountType: 'AMOUNT', discountValue: (1 + random() * 20000).toFixed(2) }),
      () => {
        const stay = 2 + Math.floor(random() * 6);
        return terms({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: stay, payNights: 1 + Math.floor(random() * (stay - 1)) });
      },
    ];
    for (let round = 0; round < 300; round += 1) {
      const count = 1 + Math.floor(random() * 14);
      const prices = Array.from({ length: count }, () => (random() < 0.1 ? '0.00' : (random() * 5000).toFixed(2)));
      const promo = kinds[round % kinds.length]();
      const result = discountNights(promo, grossNights('2027-06-01', prices));
      let cents = 0;
      result.discounts.forEach((discount, index) => {
        assert.ok(Number(discount) >= 0, 'eksi indirim yok');
        assert.ok(Math.round(Number(discount) * 100) <= Math.round(Number(prices[index]) * 100), 'indirim fiyatı aşmaz');
        cents += Math.round(Number(discount) * 100);
      });
      assert.equal(Math.round(Number(result.total) * 100), cents);
    }
  });
});

describe('teklif', () => {
  const nights = grossNights('2027-06-01', ['1000.00', '1000.00', '1000.00']);

  it('uyan otomatik promosyonlardan en çok indirimi veren seçilir; uymayan sayılmaz', () => {
    const ten = terms({ id: 'a', name: 'On' });
    const twenty = terms({ id: 'b', name: 'Yirmi', discountValue: '20.00', minNights: 5 });
    const fifteen = terms({ id: 'c', name: 'On beş', discountValue: '15.00' });
    const { offer, coupon } = planOffer({ autos: [ten, twenty, fifteen], coupon: null, sale: sale(), nights });
    assert.equal(offer?.terms.id, 'c', '%20 en az 5 gece istiyor');
    assert.equal(offer?.total, '450.00');
    assert.equal(coupon, null);
  });

  it('eşit indirimde ada göre (her seferinde aynı sonuç)', () => {
    const a = terms({ id: 'z', name: 'Bahar' });
    const b = terms({ id: 'y', name: 'Akdeniz' });
    assert.equal(planOffer({ autos: [a, b], coupon: null, sale: sale(), nights }).offer?.terms.name, 'Akdeniz');
  });

  it('kupon daha avantajlıysa uygulanır', () => {
    const auto = terms({ id: 'auto', name: 'Erken', discountValue: '10.00' });
    const couponTerms = terms({ id: 'cp', name: 'Kupon', requiresCoupon: true, discountType: 'AMOUNT', discountValue: '500.00' });
    const result = planOffer({ autos: [auto], coupon: { id: 'coupon-1', code: 'YAZ2027', terms: couponTerms, issue: null }, sale: sale(), nights });
    assert.equal(result.offer?.couponId, 'coupon-1');
    assert.equal(result.coupon?.status, 'APPLIED');
    assert.equal(result.offer?.total, '500.00');
  });

  it('kupon eşit ya da daha az indirim veriyorsa kullanılmaz (hakkı harcanmaz)', () => {
    const auto = terms({ id: 'auto', name: 'Erken', discountValue: '10.00' });
    const equal = terms({ id: 'cp', name: 'Kupon', requiresCoupon: true, discountType: 'AMOUNT', discountValue: '300.00' });
    const result = planOffer({ autos: [auto], coupon: { id: 'coupon-1', code: 'YAZ2027', terms: equal, issue: null }, sale: sale(), nights });
    assert.equal(result.offer?.couponId, null);
    assert.equal(result.offer?.terms.id, 'auto');
    assert.equal(result.coupon?.status, 'NOT_BETTER');
    assert.match(result.coupon?.issue?.message ?? '', /"Erken" promosyonu daha avantajlı/);
  });

  it('kupon bu konaklamaya uymuyorsa ya da geçersizse otomatik promosyon kalır', () => {
    const auto = terms({ id: 'auto', name: 'Erken' });
    const longStay = terms({ id: 'cp', name: 'Uzun', requiresCoupon: true, discountValue: '30.00', minNights: 7 });
    const notApplicable = planOffer({ autos: [auto], coupon: { id: 'c1', code: 'UZUN7', terms: longStay, issue: null }, sale: sale(), nights });
    assert.equal(notApplicable.coupon?.status, 'NOT_APPLICABLE');
    assert.equal(notApplicable.coupon?.issue?.code, 'PROMO_MIN_NIGHTS');
    assert.equal(notApplicable.offer?.terms.id, 'auto');

    const invalid = planOffer({ autos: [], coupon: { id: 'c2', code: 'BITTI', terms: null, issue: { code: 'COUPON_USED_UP', message: 'dolmuş' } }, sale: sale(), nights });
    assert.equal(invalid.coupon?.status, 'INVALID');
    assert.equal(invalid.offer, null);
  });

  it('bestOffer boş listede null', () => {
    assert.equal(bestOffer([]), null);
  });

  it('sıfır fiyatlı gecelerde indirim doğmaz', () => {
    assert.equal(evaluatePromotion(terms(), sale({ nights: 2 }), grossNights('2027-06-01', ['0.00', '0.00'])).issue?.code, 'PROMO_NO_DISCOUNT');
  });

  it('teklif gecelere yazılır: tutar = liste fiyatı − indirim; teklif yoksa indirim sıfır', () => {
    const offer = planOffer({ autos: [terms({ discountValue: '15.00' })], coupon: null, sale: sale(), nights }).offer;
    const written = applyOffer(nights.map((night) => ({ date: night.date, amount: night.gross, baseRate: '1000.00' })), offer);
    assert.deepEqual(written.map((night) => [night.amount, night.discount, night.baseRate]), [
      ['850.00', '150.00', '1000.00'],
      ['850.00', '150.00', '1000.00'],
      ['850.00', '150.00', '1000.00'],
    ]);
    assert.deepEqual(applyOffer([{ date: '2027-06-01', amount: '10.00' }], null), [{ date: '2027-06-01', amount: '10.00', discount: '0.00' }]);
  });
});

describe('kısalma: kopyadaki koşullar yeniden denetlenir', () => {
  it('"7 kal 6 öde" ile gelen misafir 3 gece kalırsa bedava gece kalkar; yüzde indirim en az gece şartı bozulursa kalkar', () => {
    const week = terms({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 7, payNights: 6 });
    const full = evaluatePromotion(week, sale({ nights: 7 }), grossNights('2027-06-01', Array(7).fill('1000.00')));
    assert.equal(full.total, '1000.00');
    const shortened = evaluatePromotion(week, sale({ nights: 3 }), grossNights('2027-06-01', Array(3).fill('1000.00')));
    assert.equal(shortened.issue?.code, 'PROMO_FREE_NIGHTS');

    const longStay = terms({ discountValue: '20.00', minNights: 5 });
    assert.equal(evaluatePromotion(longStay, sale({ nights: 4 }), grossNights('2027-06-01', Array(4).fill('1000.00'))).issue?.code, 'PROMO_MIN_NIGHTS');
  });

  it('erken rezervasyon günü kopyadaki satış gününe göre: giriş öne alınınca şart bozulabilir', () => {
    const early = terms({ minLeadDays: 60 });
    assert.equal(promotionIssue(early, sale({ bookedOn: '2027-03-01', checkIn: '2027-06-01' })), null);
    assert.equal(promotionIssue(early, sale({ bookedOn: '2027-03-01', checkIn: '2027-04-15' }))?.code, 'PROMO_LEAD_MIN');
  });
});

describe('kopya ve etiket', () => {
  it('veritabanı satırından koşullar: tarihler gün, tutar metin', () => {
    const copy = toTerms({
      id: 'p',
      name: 'Yaz',
      requiresCoupon: true,
      discountType: 'AMOUNT',
      discountValue: '250.5',
      bookFrom: new Date('2027-01-01T00:00:00Z'),
      bookTo: null,
      stayFrom: new Date('2027-06-01T00:00:00Z'),
      stayTo: new Date('2027-09-30T00:00:00Z'),
      roomTypeIds: [STD],
      boardTypes: ['BB'],
      sources: ['UI'],
    });
    assert.equal(copy.discountValue, '250.50');
    assert.equal(copy.bookFrom, '2027-01-01');
    assert.equal(copy.stayTo, '2027-09-30');
    assert.equal(copy.stayNights, null);
    assert.deepEqual(copy.roomTypeIds, [STD]);
  });

  it('indirim etiketi', () => {
    assert.equal(discountLabel(terms({ discountValue: '15.00' }), 'TRY'), '%15');
    assert.equal(discountLabel(terms({ discountValue: '12.50' }), 'TRY'), '%12,5');
    assert.equal(discountLabel(terms({ discountType: 'FREE_NIGHTS', stayNights: 3, payNights: 2 }), 'TRY'), '3 gece kal 2 gece öde');
    assert.equal(discountLabel(terms({ discountType: 'AMOUNT', discountValue: '500' }), 'EUR'), '500 EUR');
    assert.equal(discountLabel(terms({ discountType: 'AMOUNT', discountValue: '750.5' }), 'TRY'), '750,50 TRY');
  });
});

describe('kupon kodu', () => {
  it('önek + tire + karışmayan harflerden rastgele kısım; önek yoksa yalnızca rastgele kısım', () => {
    let counter = 0;
    const bytes = (size) => Uint8Array.from({ length: size }, () => counter++ % 256);
    const withPrefix = generateCouponCode('YAZ', bytes);
    assert.match(withPrefix, new RegExp(`^YAZ-[${COUPON_CODE_ALPHABET}]{${COUPON_RANDOM_LENGTH}}$`));
    const bare = generateCouponCode(null, bytes);
    assert.match(bare, new RegExp(`^[${COUPON_CODE_ALPHABET}]{${COUPON_RANDOM_LENGTH}}$`));
  });

  it('eşit dağılım için alfabe katının üstündeki baytlar atlanır', () => {
    const limit = 256 - (256 % COUPON_CODE_ALPHABET.length);
    let calls = 0;
    // İlk paket tamamen sınırda (atlanır), sonraki 0 baytları → alfabenin ilk harfi.
    const bytes = (size) => {
      calls += 1;
      return new Uint8Array(size).fill(calls === 1 ? limit : 0);
    };
    const code = generateCouponCode(null, bytes);
    assert.equal(code, COUPON_CODE_ALPHABET[0].repeat(COUPON_RANDOM_LENGTH));
    assert.equal(calls, 2, 'ilk paket tamamen atlandı');
  });
});
