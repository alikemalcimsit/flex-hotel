import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allotmentHolds, allotmentUsage, isNightHeld } from './allotment-rules.js';

/**
 * Allotment kuralları (modül 30) — hata payı sıfır olması gerekenler: release
 * tarihi hesabı, kullanım mahsubu, satış bağlamına göre tutulan kota.
 */

const AGENCY_A = 'agency-a';
const AGENCY_B = 'agency-b';
const STD = 'type-std';
const DLX = 'type-dlx';

const allotment = (overrides = {}) => ({
  agencyId: AGENCY_A,
  roomTypeId: STD,
  startDate: '2027-07-01',
  endDate: '2027-07-10',
  quantity: 5,
  releaseDays: 7,
  deletedAt: null,
  ...overrides,
});

const stay = (agencyId, roomTypeId, checkIn, checkOut) => ({ agencyId, roomTypeId, checkIn, checkOut });

const dayMs = (day) => new Date(`${day}T00:00:00.000Z`).getTime();

describe('isNightHeld — release tarihi', () => {
  it('release tarihinden önce tutulur, release gününden itibaren serbesttir', () => {
    const row = allotment({ releaseDays: 7 });
    // 8 Temmuz gecesi: release 1 Temmuz. 30 Haziran'da tutulu, 1 Temmuz'da serbest.
    assert.equal(isNightHeld(row, dayMs('2027-07-08'), dayMs('2027-06-30')), true);
    assert.equal(isNightHeld(row, dayMs('2027-07-08'), dayMs('2027-07-01')), false);
  });

  it('releaseDays = 0: gelecek geceler tutulur, günün gecesi serbesttir (same-day satış herkese açık)', () => {
    const row = allotment({ releaseDays: 0 });
    assert.equal(isNightHeld(row, dayMs('2027-07-05'), dayMs('2027-07-04')), true);
    assert.equal(isNightHeld(row, dayMs('2027-07-05'), dayMs('2027-07-05')), false);
  });

  it('dönem dışı gece hiç tutulmaz', () => {
    const row = allotment();
    assert.equal(isNightHeld(row, dayMs('2027-06-30'), dayMs('2027-06-01')), false);
    assert.equal(isNightHeld(row, dayMs('2027-07-11'), dayMs('2027-06-01')), false);
  });
});

describe('allotmentHolds — satış bağlamına göre tutulan kota', () => {
  const days = ['2027-07-04', '2027-07-05', '2027-07-06'];

  it('genel satışta kullanılmamış kota tutulur; acente kullanımı mahsup edilir', () => {
    const holds = allotmentHolds({
      allotments: [allotment({ quantity: 5 })],
      // A acentesi 4-6 arası 2 oda kullanmış (2 rezervasyon × 2 gece).
      agencyStays: [stay(AGENCY_A, STD, '2027-07-04', '2027-07-06'), stay(AGENCY_A, STD, '2027-07-04', '2027-07-06')],
      saleAgencyId: null,
      days,
      today: '2027-06-01',
    });
    assert.deepEqual(holds, { [STD]: { '2027-07-04': 3, '2027-07-05': 3, '2027-07-06': 5 } });
  });

  it('satışı yapan acentenin kendi kotası düşülmez; başka acenteninki düşülür', () => {
    const holds = allotmentHolds({
      allotments: [allotment({ agencyId: AGENCY_A, quantity: 5 }), allotment({ agencyId: AGENCY_B, quantity: 2 })],
      agencyStays: [],
      saleAgencyId: AGENCY_A,
      days,
      today: '2027-06-01',
    });
    assert.deepEqual(holds, { [STD]: { '2027-07-04': 2, '2027-07-05': 2, '2027-07-06': 2 } });
  });

  it('kota dolunca (kullanım ≥ kota) o acente için düşüm kalmaz — satış genel havuzdan devam eder', () => {
    const holds = allotmentHolds({
      allotments: [allotment({ quantity: 2 })],
      agencyStays: [
        stay(AGENCY_A, STD, '2027-07-04', '2027-07-07'),
        stay(AGENCY_A, STD, '2027-07-04', '2027-07-07'),
        stay(AGENCY_A, STD, '2027-07-04', '2027-07-07'),
      ],
      saleAgencyId: null,
      days,
      today: '2027-06-01',
    });
    assert.deepEqual(holds, {});
  });

  it('release edilen geceler tutulmaz; farklı tipler ayrı sayılır', () => {
    const holds = allotmentHolds({
      // Release 3 gün: bugün 2 Temmuz → 4 Temmuz (release 1 Tem) ve 5 Temmuz (release 2 Tem) serbest, 6 Temmuz tutulu.
      allotments: [allotment({ releaseDays: 3, quantity: 4 }), allotment({ roomTypeId: DLX, releaseDays: 0, quantity: 1 })],
      agencyStays: [],
      saleAgencyId: null,
      days,
      today: '2027-07-02',
    });
    assert.deepEqual(holds, {
      [STD]: { '2027-07-06': 4 },
      [DLX]: { '2027-07-04': 1, '2027-07-05': 1, '2027-07-06': 1 },
    });
  });

  it('başka tipteki ya da acentesiz konaklama kullanıma sayılmaz', () => {
    const holds = allotmentHolds({
      allotments: [allotment({ quantity: 3 })],
      agencyStays: [stay(AGENCY_A, DLX, '2027-07-04', '2027-07-06'), stay(null, STD, '2027-07-04', '2027-07-06')],
      saleAgencyId: null,
      days,
      today: '2027-06-01',
    });
    assert.deepEqual(holds, { [STD]: { '2027-07-04': 3, '2027-07-05': 3, '2027-07-06': 3 } });
  });

  it('silinmiş kota ve boş gün listesi: boş sonuç', () => {
    assert.deepEqual(
      allotmentHolds({ allotments: [allotment({ deletedAt: new Date() })], agencyStays: [], days, today: '2027-06-01' }),
      {},
    );
    assert.deepEqual(allotmentHolds({ allotments: [allotment()], agencyStays: [], days: [], today: '2027-06-01' }), {});
  });
});

describe('allotmentUsage — kullanım tablosu', () => {
  it('gün gün verilen / kullanılan / kalan / release durumu; dönemin son günü dahil', () => {
    const row = allotment({ startDate: '2027-07-01', endDate: '2027-07-03', quantity: 2, releaseDays: 1 });
    const rows = allotmentUsage(row, [stay(AGENCY_A, STD, '2027-07-01', '2027-07-03')], '2027-07-01');
    assert.deepEqual(rows, [
      // 1 Temmuz: release tarihi 30 Haziran geçti → released.
      { day: '2027-07-01', given: 2, used: 1, remaining: 1, released: true },
      // 2 Temmuz: release tarihi 1 Temmuz = bugün → released.
      { day: '2027-07-02', given: 2, used: 1, remaining: 1, released: true },
      // 3 Temmuz: release tarihi 2 Temmuz > bugün → tutulu; konaklama 3'ünde çıkıyor (gece yok).
      { day: '2027-07-03', given: 2, used: 0, remaining: 2, released: false },
    ]);
  });

  it('kota üstü kullanım kalanı eksiye düşürmez', () => {
    const row = allotment({ startDate: '2027-07-01', endDate: '2027-07-01', quantity: 1, releaseDays: 0 });
    const rows = allotmentUsage(
      row,
      [stay(AGENCY_A, STD, '2027-07-01', '2027-07-02'), stay(AGENCY_A, STD, '2027-07-01', '2027-07-02')],
      '2027-06-01',
    );
    assert.deepEqual(rows, [{ day: '2027-07-01', given: 1, used: 2, remaining: 0, released: false }]);
  });
});
