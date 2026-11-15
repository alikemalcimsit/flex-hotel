import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_CODE_LENGTH,
  cancellationTerms,
  changedReservationFields,
  confirmationCodePrefix,
  demandByRoomType,
  distributeTotal,
  expandGroupLines,
  generateConfirmationCode,
  findRatePlanForNight,
  mergeNights,
  noShowFee,
  priceStay,
  pricePackageStay,
  ratePlanNightAmount,
  roomTaxBreakdown,
  sameGuestName,
  stayChanged,
  totalOf,
} from './rules.js';

/**
 * Rezervasyon kuralları (modül 4) — hata payı sıfır olması gerekenler:
 * gece gece fiyat, elle fiyatın dağıtımı, vergi dökümü, iptal / gelmedi
 * cezası, onay kodu, grup açılımı ve misafir eşleştirmesi.
 */

const SEASONS = [
  { name: 'Yaz', startDate: '2026-07-01', endDate: '2026-08-31', multiplier: '1.5' },
  { name: 'Bayram', startDate: '2026-09-01', endDate: '2026-09-03', multiplier: '1.333' },
];

describe('priceStay — taban fiyat × sezon çarpanı × gece', () => {
  it('sezonsuz geceler taban fiyattır; toplam gecelerin toplamı', () => {
    const { nights, total } = priceStay({ basePrice: '2500', seasons: SEASONS, checkIn: '2026-10-01', checkOut: '2026-10-04' });
    assert.deepEqual(
      nights.map((night) => [night.date, night.amount, night.multiplier, night.seasonName]),
      [
        ['2026-10-01', '2500.00', '1.000', null],
        ['2026-10-02', '2500.00', '1.000', null],
        ['2026-10-03', '2500.00', '1.000', null],
      ],
    );
    assert.equal(total, '7500.00');
  });

  it('sezon sınırını geçen konaklamada her gece kendi çarpanını alır; çıkış gecesi sayılmaz', () => {
    const { nights, total } = priceStay({ basePrice: '1000', seasons: SEASONS, checkIn: '2026-08-30', checkOut: '2026-09-02' });
    assert.deepEqual(
      nights.map((night) => [night.date, night.amount, night.seasonName]),
      [
        ['2026-08-30', '1500.00', 'Yaz'],
        ['2026-08-31', '1500.00', 'Yaz'],
        ['2026-09-01', '1333.00', 'Bayram'],
      ],
    );
    assert.equal(total, '4333.00');
  });

  it('kuruşlu çarpımda her gece yarım yukarı yuvarlanır; toplam yuvarlanmış gecelerin toplamı', () => {
    // 999.99 × 1.333 = 1332.98667 → 1332.99 (gece başına). Sezon iki uçtan
    // kapalı: 3 Eylül hâlâ bayram, 4 Eylül taban fiyat.
    const { nights, total } = priceStay({ basePrice: '999.99', seasons: SEASONS, checkIn: '2026-09-02', checkOut: '2026-09-05' });
    assert.deepEqual(nights.map((night) => night.amount), ['1332.99', '1332.99', '999.99']);
    assert.equal(total, '3665.97');
    assert.equal(total, totalOf(nights));
  });

  it('kayan nokta hatası yok (0.1 × 3 gece)', () => {
    assert.equal(priceStay({ basePrice: '0.1', seasons: [], checkIn: '2026-10-01', checkOut: '2026-10-04' }).total, '0.30');
  });

  it('sıfır gece: boş, toplam 0', () => {
    assert.deepEqual(priceStay({ basePrice: '100', seasons: [], checkIn: '2026-10-01', checkOut: '2026-10-01' }), {
      nights: [],
      total: '0.00',
    });
  });
});

const PLANS = [
  { roomTypeId: 'STD', boardType: 'BB', name: 'Yaz BB', startDate: '2026-07-01', endDate: '2026-08-31', price: '3000', baseOccupancy: 2, extraAdultRate: '750', childRate: '300', isActive: true, deletedAt: null },
  { roomTypeId: 'STD', boardType: 'HB', name: 'Yaz HB', startDate: '2026-07-01', endDate: '2026-08-31', price: '3800', baseOccupancy: 2, extraAdultRate: '900', childRate: '400', isActive: true, deletedAt: null },
];

describe('findRatePlanForNight — oda tipi + pansiyon + tarihe düşen plan', () => {
  it('eşleşen planı bulur; dönem iki uçtan kapalı', () => {
    assert.equal(findRatePlanForNight(PLANS, { roomTypeId: 'STD', boardType: 'BB', date: '2026-08-31' })?.name, 'Yaz BB');
    assert.equal(findRatePlanForNight(PLANS, { roomTypeId: 'STD', boardType: 'HB', date: '2026-07-01' })?.name, 'Yaz HB');
  });

  it('pansiyon / oda tipi / tarih uymazsa null', () => {
    assert.equal(findRatePlanForNight(PLANS, { roomTypeId: 'STD', boardType: 'BB', date: '2026-09-01' }), null);
    assert.equal(findRatePlanForNight(PLANS, { roomTypeId: 'DLX', boardType: 'BB', date: '2026-08-01' }), null);
  });

  it('pasif ya da silinmiş planı görmez', () => {
    const plans = [{ ...PLANS[0], isActive: false }, { ...PLANS[1], roomTypeId: 'STD', boardType: 'BB', deletedAt: new Date() }];
    assert.equal(findRatePlanForNight(plans, { roomTypeId: 'STD', boardType: 'BB', date: '2026-08-01' }), null);
  });
});

describe('ratePlanNightAmount — kişi başı ek', () => {
  it('dahil kişi içinde ek yok', () => {
    assert.equal(ratePlanNightAmount(PLANS[0], { adults: 2, children: 0 }), '3000.00');
  });

  it('fazla yetişkin ve çocuk eklenir', () => {
    // 3000 + 1×750 (3. yetişkin) + 2×300 (çocuk) = 4350
    assert.equal(ratePlanNightAmount(PLANS[0], { adults: 3, children: 2 }), '4350.00');
  });

  it('ek tutar yoksa plan fiyatı sabittir', () => {
    assert.equal(ratePlanNightAmount({ price: '1200' }, { adults: 5, children: 3 }), '1200.00');
  });
});

describe('priceStay — fiyat planı sezon çarpanının yerine geçer', () => {
  it('planlı gece plan fiyatını alır (çarpan null), plansız gece sezona düşer', () => {
    // 30-31 Ağu plan (Yaz BB, 2 kişi = 3000), 1 Eylül plansız → Bayram sezonu 1000×1.333
    const { nights, total } = priceStay({
      basePrice: '1000',
      seasons: SEASONS,
      ratePlans: PLANS,
      roomTypeId: 'STD',
      boardType: 'BB',
      occupancy: { adults: 2, children: 0 },
      checkIn: '2026-08-30',
      checkOut: '2026-09-02',
    });
    assert.deepEqual(
      nights.map((night) => [night.date, night.amount, night.multiplier, night.seasonName]),
      [
        ['2026-08-30', '3000.00', null, 'Yaz BB'],
        ['2026-08-31', '3000.00', null, 'Yaz BB'],
        ['2026-09-01', '1333.00', '1.333', 'Bayram'],
      ],
    );
    assert.equal(total, '7333.00');
  });

  it('kişi başı ek plan tutarına yansır; baseRate plan fiyatıdır', () => {
    const { nights } = priceStay({
      basePrice: '1000',
      seasons: [],
      ratePlans: PLANS,
      roomTypeId: 'STD',
      boardType: 'HB',
      occupancy: { adults: 3, children: 1 },
      checkIn: '2026-07-10',
      checkOut: '2026-07-11',
    });
    // 3800 + 1×900 + 1×400 = 5100
    assert.deepEqual([nights[0].amount, nights[0].baseRate, nights[0].multiplier], ['5100.00', '3800.00', null]);
  });

  it('onaylı dinamik çarpan (modül 34) plan ve sezon fiyatının ikisini de ölçekler', () => {
    const adjustments = { STD: { '2026-07-10': '1.100', '2026-08-30': '1.100' } };
    // Plan gecesi: 3800 × 1.10 = 4180; plansız sezon gecesi (Yaz 1.5): 1000 × 1.5 × 1.10 = 1650.
    const planned = priceStay({
      basePrice: '1000', seasons: SEASONS, ratePlans: PLANS, roomTypeId: 'STD', boardType: 'HB',
      occupancy: { adults: 2, children: 0 }, adjustments, checkIn: '2026-07-10', checkOut: '2026-07-11',
    });
    assert.equal(planned.nights[0].amount, '4180.00');
    const seasonal = priceStay({
      basePrice: '1000', seasons: SEASONS, ratePlans: [], roomTypeId: 'STD', boardType: 'BB',
      adjustments, checkIn: '2026-08-30', checkOut: '2026-08-31',
    });
    assert.equal(seasonal.nights[0].amount, '1650.00');
    // Ayarı olmayan gece etkilenmez.
    const untouched = priceStay({
      basePrice: '1000', seasons: [], ratePlans: [], roomTypeId: 'STD', adjustments, checkIn: '2026-10-01', checkOut: '2026-10-02',
    });
    assert.equal(untouched.nights[0].amount, '1000.00');
  });

  it('ratePlans verilmezse eski sezon davranışı birebir korunur', () => {
    const withPlans = priceStay({ basePrice: '1000', seasons: SEASONS, ratePlans: [], roomTypeId: 'STD', boardType: 'BB', checkIn: '2026-07-10', checkOut: '2026-07-12' });
    const legacy = priceStay({ basePrice: '1000', seasons: SEASONS, checkIn: '2026-07-10', checkOut: '2026-07-12' });
    assert.deepEqual(withPlans, legacy);
  });
});

describe('pricePackageStay — sabit gecelik paket fiyatı', () => {
  it('her gece paket fiyatı; sezon / plan uygulanmaz', () => {
    const { nights, total } = pricePackageStay({ nightlyPrice: '5000', name: 'Balayı' }, '2026-07-10', '2026-07-13');
    assert.deepEqual(nights.map((night) => [night.amount, night.baseRate, night.multiplier, night.seasonName]), [
      ['5000.00', '5000.00', null, 'Balayı'],
      ['5000.00', '5000.00', null, 'Balayı'],
      ['5000.00', '5000.00', null, 'Balayı'],
    ]);
    assert.equal(total, '15000.00');
  });
});

describe('distributeTotal — elle fiyatın gecelere dağıtımı', () => {
  it('eşit pay, kuruş son geceye; toplam birebir korunur', () => {
    const nights = distributeTotal('1000', ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.deepEqual(nights.map((night) => night.amount), ['333.33', '333.33', '333.34']);
    assert.equal(totalOf(nights), '1000.00');
    assert.equal(nights[0].baseRate, null, 'elle fiyatta taban/çarpan yok');
  });

  it('bölünmeyen kuruşlar ve tek gece', () => {
    assert.deepEqual(distributeTotal('0.05', ['2026-10-01', '2026-10-02']).map((night) => night.amount), ['0.02', '0.03']);
    assert.deepEqual(distributeTotal('99.99', ['2026-10-01']).map((night) => night.amount), ['99.99']);
    assert.deepEqual(distributeTotal('0', ['2026-10-01', '2026-10-02']).map((night) => night.amount), ['0.00', '0.00']);
    assert.deepEqual(distributeTotal('10', []), []);
  });

  it('uzun konaklamada toplam bozulmaz (366 gece)', () => {
    const dates = Array.from({ length: 366 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)));
    assert.equal(totalOf(distributeTotal('123456.78', dates)), '123456.78');
  });
});

describe('mergeNights — anlaşılan fiyat korunur', () => {
  const existing = [
    { date: '2026-10-01', amount: '900.00', baseRate: '900.00', multiplier: '1.000', seasonName: null },
    { date: '2026-10-02', amount: '900.00', baseRate: '900.00', multiplier: '1.000', seasonName: null },
  ];

  it('uzatmada eski geceler eski fiyatında, yeni gece güncel fiyatla', () => {
    const fresh = priceStay({ basePrice: '1000', seasons: [], checkIn: '2026-10-01', checkOut: '2026-10-04' }).nights;
    const merged = mergeNights(existing, fresh, () => true);
    assert.deepEqual(merged.map((night) => [night.date, night.amount]), [
      ['2026-10-01', '900.00'],
      ['2026-10-02', '900.00'],
      ['2026-10-03', '1000.00'],
    ]);
  });

  it('kısaltmada çıkan geceler düşer; keep yanlışsa gece yeniden fiyatlanır', () => {
    const fresh = priceStay({ basePrice: '1000', seasons: [], checkIn: '2026-10-02', checkOut: '2026-10-03' }).nights;
    assert.deepEqual(mergeNights(existing, fresh, () => true).map((night) => night.amount), ['900.00']);
    assert.deepEqual(mergeNights(existing, fresh, () => false).map((night) => night.amount), ['1000.00']);
  });
});

describe('roomTaxBreakdown', () => {
  const taxes = [
    { name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] },
    { name: 'Konaklama vergisi', rate: '2', isIncluded: false, appliesTo: ['ROOM'] },
    { name: 'Minibar KDV', rate: '20', isIncluded: true, appliesTo: ['MINIBAR'] },
  ];

  it('dahil vergi fiyatın içinden, hariç vergi net üzerine eklenir; oda dışı vergi sayılmaz', () => {
    const result = roomTaxBreakdown('1100.00', taxes);
    assert.equal(result.net, '1000.00');
    assert.deepEqual(result.included, [{ name: 'KDV', rate: '10', amount: '100.00' }]);
    assert.deepEqual(result.added, [{ name: 'Konaklama vergisi', rate: '2', amount: '20.00' }]);
    assert.equal(result.grandTotal, '1120.00');
  });

  it('vergi yoksa net = toplam', () => {
    assert.deepEqual(roomTaxBreakdown('500', []), { net: '500.00', included: [], added: [], grandTotal: '500.00' });
  });
});

describe('cancellationTerms — iptal politikası', () => {
  const policy = { cancellationPolicyDays: 3, cancellationPolicyPenaltyPct: '50' };
  const stay = { totalPrice: '3000.00', checkIn: '2026-10-10' };

  it('girişe tam 3 gün kala ücretsiz; 2 gün kala cezalı', () => {
    assert.deepEqual(cancellationTerms(stay, policy, '2026-10-07'), {
      fee: '0.00',
      penaltyApplies: false,
      freeUntil: '2026-10-07',
      daysBefore: 3,
    });
    const late = cancellationTerms(stay, policy, '2026-10-08');
    assert.equal(late.penaltyApplies, true);
    assert.equal(late.fee, '1500.00');
  });

  it('giriş günü ve geçmişte de cezalı', () => {
    assert.equal(cancellationTerms(stay, policy, '2026-10-10').fee, '1500.00');
    assert.equal(cancellationTerms(stay, policy, '2026-10-12').daysBefore, -2);
  });

  it('politika yoksa (0 gün ya da %0) ceza yok', () => {
    assert.equal(cancellationTerms(stay, { cancellationPolicyDays: 0, cancellationPolicyPenaltyPct: '0' }, '2026-10-10').fee, '0.00');
    assert.equal(cancellationTerms(stay, { cancellationPolicyDays: 5, cancellationPolicyPenaltyPct: '0' }, '2026-10-10').penaltyApplies, false);
  });

  it('kuruşlu oranda yuvarlama', () => {
    assert.equal(cancellationTerms({ totalPrice: '999.99', checkIn: '2026-10-10' }, { cancellationPolicyDays: 1, cancellationPolicyPenaltyPct: '33.33' }, '2026-10-10').fee, '333.30');
  });
});

describe('noShowFee', () => {
  it('ilk gecenin fiyatı (sıra karışık gelse de)', () => {
    assert.equal(
      noShowFee([
        { date: '2026-10-02', amount: '1200' },
        { date: '2026-10-01', amount: '900.5' },
      ]),
      '900.50',
    );
    assert.equal(noShowFee([]), '0.00');
  });
});

describe('onay kodu', () => {
  it('önek otel kodundan: yalnızca harf-rakam, büyük harf, en fazla 6', () => {
    assert.equal(confirmationCodePrefix('demo'), 'DEMO');
    assert.equal(confirmationCodePrefix('Deniz-Otel 1'), 'DENIZO');
    assert.equal(confirmationCodePrefix('---'), 'R');
  });

  it('kod yalnızca karışmayan harflerden, sabit uzunlukta', () => {
    const codes = new Set();
    for (let index = 0; index < 500; index += 1) {
      const code = generateConfirmationCode('DEMO', randomBytes);
      const [prefix, body] = code.split('-');
      assert.equal(prefix, 'DEMO');
      assert.equal(body.length, CONFIRMATION_CODE_LENGTH);
      assert.ok([...body].every((char) => CONFIRMATION_CODE_ALPHABET.includes(char)), code);
      codes.add(code);
    }
    assert.equal(codes.size, 500, 'çakışma yok (244 milyon olasılıkta 500 kod)');
    assert.ok(![...'01OIL25SZ6G8B'].some((char) => CONFIRMATION_CODE_ALPHABET.includes(char)));
  });

  it('alfabe dışı baytlar atlanır (modulo sapması yok), yine de kod tamamlanır', () => {
    const limit = 256 - (256 % CONFIRMATION_CODE_ALPHABET.length);
    let call = 0;
    const bytes = (size) => Uint8Array.from({ length: size }, (_, index) => (call++ === 0 && index < 4 ? 255 : index));
    assert.ok(255 >= limit);
    assert.equal(generateConfirmationCode('X', bytes).length, 'X-'.length + CONFIRMATION_CODE_LENGTH);
  });
});

describe('grup', () => {
  it('satırlar adet kadar odaya açılır, sıra korunur; tip başına talep sayılır', () => {
    const rooms = expandGroupLines([
      { roomTypeId: 'STD', adults: 2, children: 0, boardType: 'BB', quantity: 2 },
      { roomTypeId: 'DLX', adults: 1, children: 1, boardType: 'HB', quantity: 1 },
      { roomTypeId: 'STD', adults: 1, children: 0, boardType: 'BB', quantity: 1 },
    ]);
    assert.deepEqual(rooms.map((room) => [room.roomTypeId, room.line]), [
      ['STD', 0],
      ['STD', 0],
      ['DLX', 1],
      ['STD', 2],
    ]);
    assert.equal('quantity' in rooms[0], false);
    assert.deepEqual([...demandByRoomType(rooms)], [
      ['STD', 3],
      ['DLX', 1],
    ]);
  });
});

describe('misafir eşleştirme', () => {
  it('Türkçe büyük/küçük harf ve boşluk duyarsız', () => {
    assert.equal(sameGuestName({ firstName: 'AYŞE', lastName: ' yılmaz ' }, { firstName: 'ayşe', lastName: 'Yılmaz' }), true);
    assert.equal(sameGuestName({ firstName: 'İSMAİL', lastName: 'Işık' }, { firstName: 'ismail', lastName: 'ışık' }), true);
    assert.equal(sameGuestName({ firstName: 'Ali  Rıza', lastName: 'Kaya' }, { firstName: 'Ali Rıza', lastName: 'Kaya' }), true);
  });

  it('farklı ad ya da soyad ayrı kişi', () => {
    assert.equal(sameGuestName({ firstName: 'Ayşe', lastName: 'Yılmaz' }, { firstName: 'Mehmet', lastName: 'Yılmaz' }), false);
    assert.equal(sameGuestName({ firstName: 'Ayşe', lastName: 'Yılmaz' }, { firstName: 'Ayşe', lastName: 'Kaya' }), false);
  });
});

describe('değişiklik tespiti', () => {
  const before = {
    checkIn: new Date('2026-10-01'),
    checkOut: new Date('2026-10-04'),
    roomTypeId: 'A',
    adults: 2,
    children: 0,
    boardType: 'BB',
    notes: null,
    totalPrice: '3000.00',
    priceMode: 'CALCULATED',
  };

  it('yalnızca gönderilen ve farklı olan alanlar', () => {
    assert.deepEqual(changedReservationFields(before, { checkOut: new Date('2026-10-05'), adults: 2, notes: 'Geç gelecek' }), [
      'checkOut',
      'notes',
    ]);
    assert.deepEqual(changedReservationFields(before, { totalPrice: '3000.00', priceMode: 'CALCULATED' }), []);
  });

  it('konaklama değişikliği: tarih ya da tip', () => {
    assert.equal(stayChanged(before, { ...before, adults: 3 }), false);
    assert.equal(stayChanged(before, { ...before, roomTypeId: 'B' }), true);
    assert.equal(stayChanged(before, { ...before, checkIn: '2026-10-01T00:00:00.000Z' }), false);
    assert.equal(stayChanged(before, { ...before, checkIn: '2026-10-02' }), true);
  });
});
