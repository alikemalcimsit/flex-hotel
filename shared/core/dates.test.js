import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  eachNight,
  nightCount,
  rangesOverlapClosed,
  rangesOverlapHalfOpen,
  toIsoDay,
  toUtcDayStart,
} from './dates.js';

/**
 * İki aralık semantiğinin karışması, bu sistemde bulunması en zor hata türü:
 * kod çalışır, ekran doğru görünür, ama bir oda ya iki kez satılır ya da boş
 * durduğu hâlde satılamaz. Bu yüzden sınır günleri tek tek test ediliyor.
 */

describe('toUtcDayStart', () => {
  it('saat bilgisini atar', () => {
    assert.equal(toUtcDayStart('2026-10-15T14:00:00Z'), toUtcDayStart('2026-10-15T12:00:00Z'));
  });

  it('geçersiz tarihi reddeder', () => {
    assert.throws(() => toUtcDayStart('yarın'), RangeError);
  });
});

describe('rangesOverlapClosed — sezonlar', () => {
  it('uç uca değen aralıklar ÇAKIŞIR', () => {
    const a = { startDate: '2026-06-01', endDate: '2026-06-10' };
    const b = { startDate: '2026-06-10', endDate: '2026-06-20' };
    assert.equal(rangesOverlapClosed(a, b), true);
  });

  it('bir gün boşluk varsa çakışmaz', () => {
    const a = { startDate: '2026-06-01', endDate: '2026-06-10' };
    const b = { startDate: '2026-06-11', endDate: '2026-06-20' };
    assert.equal(rangesOverlapClosed(a, b), false);
  });
});

describe('rangesOverlapHalfOpen — konaklama ve bloklar', () => {
  it('çıkış günü yeni girişle ÇAKIŞMAZ (odanın devri)', () => {
    const leaving = { start: '2026-10-15', end: '2026-10-18' };
    const arriving = { start: '2026-10-18', end: '2026-10-20' };
    assert.equal(rangesOverlapHalfOpen(leaving, arriving), false);
  });

  it('bir gece bindirme çakışmadır', () => {
    const a = { start: '2026-10-15', end: '2026-10-18' };
    const b = { start: '2026-10-17', end: '2026-10-19' };
    assert.equal(rangesOverlapHalfOpen(a, b), true);
  });

  it('içine gömülü konaklama çakışır', () => {
    const a = { start: '2026-10-01', end: '2026-10-31' };
    const b = { start: '2026-10-10', end: '2026-10-12' };
    assert.equal(rangesOverlapHalfOpen(a, b), true);
  });

  it('sıra fark etmez', () => {
    const a = { start: '2026-10-15', end: '2026-10-18' };
    const b = { start: '2026-10-17', end: '2026-10-19' };
    assert.equal(rangesOverlapHalfOpen(a, b), rangesOverlapHalfOpen(b, a));
  });

  it('süresiz blok (end yok) sonraki her tarihle çakışır', () => {
    const block = { start: '2026-10-15', end: null };
    assert.equal(rangesOverlapHalfOpen(block, { start: '2027-01-01', end: '2027-01-05' }), true);
  });

  it('süresiz blok kendisinden önceki tarihlerle çakışmaz', () => {
    const block = { start: '2026-10-15', end: null };
    assert.equal(rangesOverlapHalfOpen(block, { start: '2026-10-10', end: '2026-10-15' }), false);
  });

  it('aynı semantikteki iki aralık için sezon kuralıyla farklı sonuç verir', () => {
    // Aynı iki tarih aralığı: sezon olarak çakışır, konaklama olarak çakışmaz.
    const first = { startDate: '2026-06-01', endDate: '2026-06-10', start: '2026-06-01', end: '2026-06-10' };
    const second = { startDate: '2026-06-10', endDate: '2026-06-20', start: '2026-06-10', end: '2026-06-20' };
    assert.equal(rangesOverlapClosed(first, second), true);
    assert.equal(rangesOverlapHalfOpen(first, second), false);
  });
});

describe('eachNight', () => {
  it('çıkış gecesi sayılmaz', () => {
    const nights = eachNight('2026-10-15', '2026-10-18');
    assert.deepEqual(nights.map(toIsoDay), ['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('aynı gün giriş-çıkışta gece yoktur', () => {
    assert.deepEqual(eachNight('2026-10-15', '2026-10-15'), []);
  });

  it('ters tarihlerde boş döner', () => {
    assert.deepEqual(eachNight('2026-10-18', '2026-10-15'), []);
  });

  it('ay sınırını doğru geçer', () => {
    const nights = eachNight('2026-10-30', '2026-11-02');
    assert.deepEqual(nights.map(toIsoDay), ['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('nightCount', () => {
  it('3 gecelik konaklamayı sayar', () => {
    assert.equal(nightCount('2026-10-15', '2026-10-18'), 3);
  });

  it('aynı gün 0 gece', () => {
    assert.equal(nightCount('2026-10-15', '2026-10-15'), 0);
  });

  it('ters tarihte negatif dönmez', () => {
    assert.equal(nightCount('2026-10-18', '2026-10-15'), 0);
  });

  it('yaz saati geçişinde de tam sayı kalır', () => {
    // Türkiye'de kalıcı UTC+3 ama misafir kaydı başka bölgeden gelebilir;
    // UTC gün başına indirgeme sayesinde 1 gece hep 1 gecedir.
    assert.equal(nightCount('2026-03-28T23:00:00Z', '2026-03-29T23:00:00Z'), 1);
  });
});

describe('addDays', () => {
  it('gün ekler ve gün başına hizalar', () => {
    assert.equal(toIsoDay(addDays('2026-10-15T14:30:00Z', 3)), '2026-10-18');
  });

  it('negatif gün geri gider', () => {
    assert.equal(toIsoDay(addDays('2026-10-15', -1)), '2026-10-14');
  });
});
