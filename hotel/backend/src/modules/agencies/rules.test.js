import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activationIssues,
  commissionAmount,
  compressDays,
  describeProblems,
  priceAgencyNights,
  saleProblems,
  toReservationNights,
} from './rules.js';

const STD = 'type-std';
const DLX = 'type-dlx';

const summer = {
  id: 'contract-summer',
  name: 'Yaz 2027',
  startDate: new Date('2027-06-01T00:00:00Z'),
  endDate: new Date('2027-09-30T00:00:00Z'),
  rates: [
    { roomTypeId: STD, boardType: 'BB', startDate: new Date('2027-06-01T00:00:00Z'), endDate: new Date('2027-07-31T00:00:00Z'), price: '1800.00' },
    { roomTypeId: STD, boardType: 'BB', startDate: new Date('2027-08-01T00:00:00Z'), endDate: new Date('2027-09-30T00:00:00Z'), price: '2100.50' },
    { roomTypeId: STD, boardType: 'AI', startDate: new Date('2027-06-01T00:00:00Z'), endDate: new Date('2027-09-30T00:00:00Z'), price: '2600.00' },
    { roomTypeId: DLX, boardType: 'BB', startDate: new Date('2027-06-01T00:00:00Z'), endDate: new Date('2027-09-30T00:00:00Z'), price: '2900.00' },
  ],
  stopSales: [],
};

const days = (...list) => list;

describe('acente gece fiyatı (kontrat)', () => {
  it('oda tipi ve pansiyona göre kontrat fiyatını alır; dönem uçları dahildir', () => {
    const nights = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'BB', days: days('2027-06-01', '2027-07-31', '2027-08-01', '2027-09-30') });
    assert.deepEqual(
      nights.map((night) => [night.date, night.status, night.amount]),
      [
        ['2027-06-01', 'PRICED', '1800.00'],
        ['2027-07-31', 'PRICED', '1800.00'],
        ['2027-08-01', 'PRICED', '2100.50'],
        ['2027-09-30', 'PRICED', '2100.50'],
      ],
    );
    const ai = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'AI', days: days('2027-07-01') });
    assert.equal(ai[0].amount, '2600.00', 'pansiyon başka fiyat');
    const dlx = priceAgencyNights({ contracts: [summer], roomTypeId: DLX, boardType: 'BB', days: days('2027-07-01') });
    assert.equal(dlx[0].amount, '2900.00', 'oda tipi başka fiyat');
  });

  it('fiyatı olmayan pansiyon ve oda tipi NO_RATE; kontrat dışı gün NO_CONTRACT', () => {
    const nights = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'HB', days: days('2027-07-01') });
    assert.equal(nights[0].status, 'NO_RATE');
    assert.equal(nights[0].contractName, 'Yaz 2027');
    const outside = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'BB', days: days('2027-05-31', '2027-10-01') });
    assert.deepEqual(outside.map((night) => night.status), ['NO_CONTRACT', 'NO_CONTRACT']);
    assert.deepEqual(priceAgencyNights({ contracts: [], roomTypeId: STD, boardType: 'BB', days: days('2027-07-01') }).map((n) => n.status), ['NO_CONTRACT']);
  });

  it('stop-sale fiyattan önce gelir; tüm tipler ya da yalnız o tip; kapsam dışı etkilemez', () => {
    const contract = {
      ...summer,
      stopSales: [
        { roomTypeId: null, startDate: new Date('2027-07-10T00:00:00Z'), endDate: new Date('2027-07-12T00:00:00Z') },
        { roomTypeId: DLX, startDate: new Date('2027-07-20T00:00:00Z'), endDate: new Date('2027-07-20T00:00:00Z') },
      ],
    };
    const std = priceAgencyNights({ contracts: [contract], roomTypeId: STD, boardType: 'BB', days: days('2027-07-09', '2027-07-10', '2027-07-12', '2027-07-13', '2027-07-20') });
    assert.deepEqual(std.map((night) => night.status), ['PRICED', 'STOP_SALE', 'STOP_SALE', 'PRICED', 'PRICED']);
    const dlx = priceAgencyNights({ contracts: [contract], roomTypeId: DLX, boardType: 'BB', days: days('2027-07-20', '2027-07-21') });
    assert.deepEqual(dlx.map((night) => night.status), ['STOP_SALE', 'PRICED']);
    // Fiyatı olmayan pansiyonda bile stop-sale gerçek sebep olarak görünür.
    const hb = priceAgencyNights({ contracts: [contract], roomTypeId: STD, boardType: 'HB', days: days('2027-07-11') });
    assert.equal(hb[0].status, 'STOP_SALE');
  });

  it('konaklama iki kontrata yayılırsa her gece kendi kontratının fiyatını alır', () => {
    const next = {
      id: 'contract-winter',
      name: 'Kış 2027',
      startDate: new Date('2027-10-01T00:00:00Z'),
      endDate: new Date('2028-03-31T00:00:00Z'),
      rates: [{ roomTypeId: STD, boardType: 'BB', startDate: new Date('2027-10-01T00:00:00Z'), endDate: new Date('2028-03-31T00:00:00Z'), price: '1200' }],
      stopSales: [],
    };
    const nights = priceAgencyNights({ contracts: [summer, next], roomTypeId: STD, boardType: 'BB', days: days('2027-09-30', '2027-10-01') });
    assert.deepEqual(nights.map((night) => [night.contractName, night.amount]), [['Yaz 2027', '2100.50'], ['Kış 2027', '1200.00']]);
  });

  it('Prisma Decimal gibi toString\'li fiyatı da kuruşa yazar', () => {
    const decimalLike = { toString: () => '1999.9' };
    const nights = priceAgencyNights({
      contracts: [{ ...summer, rates: [{ roomTypeId: STD, boardType: 'BB', startDate: summer.startDate, endDate: summer.endDate, price: decimalLike }] }],
      roomTypeId: STD,
      boardType: 'BB',
      days: days('2027-06-05'),
    });
    assert.equal(nights[0].amount, '1999.90');
  });
});

describe('rezervasyon gecesine çevirme', () => {
  it('kontrat fiyatı baseRate, kontrat adı seasonName; çarpan yok', () => {
    const nights = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'BB', days: days('2027-06-01') });
    assert.deepEqual(toReservationNights(nights), [{ date: '2027-06-01', amount: '1800.00', baseRate: '1800.00', multiplier: null, seasonName: 'Yaz 2027' }]);
  });

  it('fiyatlanmamış geceyi yazmaz (hata fırlatır)', () => {
    const nights = priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'HB', days: days('2027-06-01') });
    assert.throws(() => toReservationNights(nights), /Fiyatlanmamış gece/);
  });
});

describe('satış sorunları', () => {
  it('ardışık günler aralık olur', () => {
    assert.deepEqual(compressDays(['2027-06-30', '2027-07-01', '2027-07-02', '2027-07-05']), [
      { from: '2027-06-30', to: '2027-07-02' },
      { from: '2027-07-05', to: '2027-07-05' },
    ]);
    assert.deepEqual(compressDays([]), []);
    assert.deepEqual(compressDays(['2027-12-31', '2028-01-01']), [{ from: '2027-12-31', to: '2028-01-01' }], 'yıl sonu');
  });

  it('elle fiyatta yalnızca stop-sale engeller; sistem fiyatında hepsi', () => {
    const contract = { ...summer, stopSales: [{ roomTypeId: null, startDate: new Date('2027-07-10T00:00:00Z'), endDate: new Date('2027-07-10T00:00:00Z') }] };
    const nights = priceAgencyNights({ contracts: [contract], roomTypeId: STD, boardType: 'HB', days: days('2027-07-09', '2027-07-10', '2027-10-05') });
    const manual = saleProblems(nights, { requireRate: false });
    assert.deepEqual(manual.map((problem) => problem.status), ['STOP_SALE']);
    const system = saleProblems(nights, { requireRate: true });
    assert.deepEqual(system.map((problem) => problem.status), ['STOP_SALE', 'NO_CONTRACT', 'NO_RATE'], 'öncelik sırası');
    assert.equal(system[0].code, 'AGENCY_STOP_SALE');
    assert.deepEqual(saleProblems(priceAgencyNights({ contracts: [summer], roomTypeId: STD, boardType: 'BB', days: days('2027-07-01') }), { requireRate: true }), []);
  });

  it('mesaj: tek gece / çok gece, aralık sınırı, sebebe göre metin', () => {
    const labels = { agencyName: 'TUI', roomTypeName: 'Standart Oda', boardLabel: 'HB — Yarım pansiyon' };
    const one = saleProblems([{ date: '2027-07-10', status: 'STOP_SALE' }], { requireRate: false });
    assert.equal(describeProblems(one, labels), '10.07.2027 gecesinde TUI için stop-sale var');

    const many = saleProblems(
      ['2027-07-10', '2027-07-11', '2027-07-12'].map((date) => ({ date, status: 'NO_RATE' })),
      { requireRate: true },
    );
    assert.equal(describeProblems(many, labels), '10.07.2027 – 12.07.2027 gecelerinde kontratta Standart Oda / HB — Yarım pansiyon fiyatı yok');

    const scattered = saleProblems(
      ['2027-07-01', '2027-07-03', '2027-07-05', '2027-07-07', '2027-07-09'].map((date) => ({ date, status: 'NO_CONTRACT' })),
      { requireRate: true },
    );
    assert.match(describeProblems(scattered, labels), /\(\+2 aralık daha\) gecelerinde TUI acentesinin satıştaki kontratı yok/);
  });
});

describe('komisyon', () => {
  it('toplam × yüzde, kuruşa yuvarlanır', () => {
    assert.equal(commissionAmount('1000.00', '10'), '100.00');
    assert.equal(commissionAmount('1234.56', '12.5'), '154.32');
    assert.equal(commissionAmount('999.99', '0'), '0.00');
    assert.equal(commissionAmount('250.00', 12.5), '31.25');
    // 33.335 → kuruş yuvarlaması çalışan deneme: tutar tam kuruşa iner.
    assert.match(commissionAmount('333.35', '10'), /^33\.3[45]$/);
  });
});

describe('kontratı satışa açma koşulları', () => {
  const base = {
    agencyStatus: 'ACTIVE',
    contract: { currency: 'TRY', endDate: new Date('2027-09-30T00:00:00Z') },
    rateCount: 4,
    hotelCurrency: 'TRY',
    businessDate: '2027-05-01',
  };

  it('eksiksiz kontrat açılabilir', () => {
    assert.deepEqual(activationIssues(base), []);
  });

  it('pasif acente, fiyatsız kontrat, farklı para birimi ve geçmiş dönem engeller', () => {
    assert.match(activationIssues({ ...base, agencyStatus: 'PASSIVE' })[0], /Pasif acente/);
    assert.match(activationIssues({ ...base, rateCount: 0 })[0], /en az bir fiyat/);
    assert.match(activationIssues({ ...base, hotelCurrency: 'EUR' })[0], /para birimi \(TRY\).*\(EUR\)/);
    assert.match(activationIssues({ ...base, businessDate: '2027-10-01' })[0], /geçmiş/);
    assert.equal(activationIssues({ ...base, businessDate: '2027-09-30' }).length, 0, 'son gün hâlâ geçerli');
    assert.equal(activationIssues({ ...base, agencyStatus: 'PASSIVE', rateCount: 0 }).length, 2, 'birden fazla eksik birlikte');
  });
});
