import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoOverlap,
  findSeasonForDate,
  isValidTimeZone,
  multipliersForStay,
  rangesOverlap,
  resolveMultiplierForDate,
  toUtcDayStart,
} from './rules.js';

/**
 * Bu kurallar yanlış çalıştığında sistem çökmez — sessizce yanlış para tahsil
 * eder. Test edilmelerinin sebebi bu.
 */

const season = (name, startDate, endDate, multiplier = '1', id = name) => ({
  id,
  name,
  startDate,
  endDate,
  multiplier,
});

describe('toUtcDayStart', () => {
  it('aynı günün farklı saatlerini aynı güne indirger', () => {
    assert.equal(toUtcDayStart('2026-06-01T00:30:00Z'), toUtcDayStart('2026-06-01T23:30:00Z'));
  });

  it('geçersiz tarihi reddeder', () => {
    assert.throws(() => toUtcDayStart('bugün'), /Geçersiz tarih/);
  });
});

describe('rangesOverlap', () => {
  it('ayrık aralıklar çakışmaz', () => {
    assert.equal(rangesOverlap(season('A', '2026-06-01', '2026-06-10'), season('B', '2026-06-11', '2026-06-20')), false);
  });

  it('uç uca değen aralıklar çakışır (o gün iki çarpana düşer)', () => {
    assert.equal(rangesOverlap(season('A', '2026-06-01', '2026-06-10'), season('B', '2026-06-10', '2026-06-20')), true);
  });

  it('içine gömülü aralık çakışır', () => {
    assert.equal(rangesOverlap(season('A', '2026-06-01', '2026-06-30'), season('B', '2026-06-10', '2026-06-12')), true);
  });

  it('sıra fark etmez', () => {
    const a = season('A', '2026-06-01', '2026-06-30');
    const b = season('B', '2026-06-10', '2026-06-12');
    assert.equal(rangesOverlap(a, b), rangesOverlap(b, a));
  });

  it('tek günlük aynı tarih çakışır', () => {
    assert.equal(rangesOverlap(season('A', '2026-06-05', '2026-06-05'), season('B', '2026-06-05', '2026-06-05')), true);
  });
});

describe('assertNoOverlap', () => {
  const existing = [season('Yaz', '2026-06-01', '2026-09-15', '1.3', 'yaz-id')];

  it('çakışan aralığı sezon adıyla birlikte reddeder', () => {
    assert.throws(
      () => assertNoOverlap(existing, { startDate: '2026-09-10', endDate: '2026-10-01' }),
      /"Yaz" sezonuyla çakışıyor/,
    );
  });

  it('kaydın kendisini çakışma saymaz (güncelleme senaryosu)', () => {
    assert.doesNotThrow(() =>
      assertNoOverlap(existing, { id: 'yaz-id', startDate: '2026-06-01', endDate: '2026-09-20' }),
    );
  });

  it('çakışmayan aralığa izin verir', () => {
    assert.doesNotThrow(() => assertNoOverlap(existing, { startDate: '2026-09-16', endDate: '2026-10-31' }));
  });

  it('boş listede her aralık geçerlidir', () => {
    assert.doesNotThrow(() => assertNoOverlap([], { startDate: '2026-01-01', endDate: '2026-12-31' }));
  });
});

describe('findSeasonForDate', () => {
  const seasons = [
    season('Kış', '2026-01-01', '2026-03-31', '0.8'),
    season('Yaz', '2026-06-01', '2026-09-15', '1.3'),
  ];

  it('başlangıç günü dahildir', () => {
    assert.equal(findSeasonForDate(seasons, '2026-06-01')?.name, 'Yaz');
  });

  it('bitiş günü dahildir', () => {
    assert.equal(findSeasonForDate(seasons, '2026-09-15')?.name, 'Yaz');
  });

  it('aralık dışında null döner', () => {
    assert.equal(findSeasonForDate(seasons, '2026-09-16'), null);
  });

  it('sezonlar arası boşlukta null döner', () => {
    assert.equal(findSeasonForDate(seasons, '2026-04-15'), null);
  });
});

describe('resolveMultiplierForDate', () => {
  const seasons = [season('Yaz', '2026-06-01', '2026-09-15', '1.3')];

  it('sezon varsa çarpanını döner', () => {
    assert.equal(resolveMultiplierForDate(seasons, '2026-07-01'), '1.3');
  });

  it('sezon yoksa taban fiyat çarpanı 1 olur', () => {
    assert.equal(resolveMultiplierForDate(seasons, '2026-12-01'), '1');
  });

  it('çarpanı string olarak döner (float\'a düşmez)', () => {
    assert.equal(typeof resolveMultiplierForDate(seasons, '2026-07-01'), 'string');
  });
});

describe('multipliersForStay', () => {
  const seasons = [season('Yaz', '2026-06-01', '2026-06-10', '1.3')];

  it('çıkış gecesi sayılmaz (3 gece = 3 kayıt)', () => {
    const nights = multipliersForStay(seasons, '2026-06-01', '2026-06-04');
    assert.equal(nights.length, 3);
  });

  it('sezon sınırını aşan konaklamada her gece kendi çarpanını alır', () => {
    const nights = multipliersForStay(seasons, '2026-06-09', '2026-06-12');
    assert.deepEqual(
      nights.map((night) => night.multiplier),
      ['1.3', '1.3', '1'], // 9 ve 10 Haziran sezonda, 11 Haziran sezon dışı
    );
  });

  it('aynı gün giriş-çıkışta gece yoktur', () => {
    assert.deepEqual(multipliersForStay(seasons, '2026-06-01', '2026-06-01'), []);
  });

  it('ters tarihlerde boş döner', () => {
    assert.deepEqual(multipliersForStay(seasons, '2026-06-05', '2026-06-01'), []);
  });
});

describe('isValidTimeZone', () => {
  it('gerçek IANA dilimini kabul eder', () => {
    assert.equal(isValidTimeZone('Europe/Istanbul'), true);
  });

  it('uydurma dilimi reddeder', () => {
    assert.equal(isValidTimeZone('Mars/Phobos'), false);
  });

  it('boş değeri reddeder', () => {
    assert.equal(isValidTimeZone(''), false);
  });
});
