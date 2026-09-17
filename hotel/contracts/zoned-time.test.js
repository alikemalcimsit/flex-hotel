import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { utcToZonedWallTime, zonedWallTimeToUtc } from './zoned-time.js';

/**
 * Uyandırma saati otelin saatine göre kurulur. Burada bir saatlik hata,
 * misafirin bir saat erken ya da geç uyandırılması demek.
 */

const iso = (wallTime, timeZone) => zonedWallTimeToUtc(wallTime, timeZone)?.toISOString() ?? null;

describe('zonedWallTimeToUtc', () => {
  it('İstanbul saatini UTC ana çevirir', () => {
    assert.equal(iso('2026-09-17T06:30', 'Europe/Istanbul'), '2026-09-17T03:30:00.000Z');
  });

  it('yaz ve kış saatinde farkı doğru alır', () => {
    assert.equal(iso('2026-07-01T12:00', 'Europe/Berlin'), '2026-07-01T10:00:00.000Z');
    assert.equal(iso('2026-01-15T12:00', 'Europe/Berlin'), '2026-01-15T11:00:00.000Z');
  });

  it('geçiş gününün geçişten uzak saati normal çevrilir', () => {
    assert.equal(iso('2026-03-08T12:00', 'America/New_York'), '2026-03-08T16:00:00.000Z');
    assert.equal(iso('2026-03-29T00:30', 'Europe/Berlin'), '2026-03-28T23:30:00.000Z');
  });

  it('ileri alınan gecede var olmayan saat ileri kayar', () => {
    // Berlin 29 Mart 2026: 02:00 → 03:00. 02:30 yok; 03:30 CEST olur.
    assert.equal(iso('2026-03-29T02:30', 'Europe/Berlin'), '2026-03-29T01:30:00.000Z');
    // New York 8 Mart 2026: 02:00 → 03:00. 02:30 yok; 03:30 EDT olur.
    assert.equal(iso('2026-03-08T02:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  });

  it('geri alınan gecede iki kez yaşanan saatin ilki seçilir', () => {
    // New York 1 Kasım 2026: 02:00 EDT → 01:00 EST. 01:30 önce EDT'de yaşanır.
    assert.equal(iso('2026-11-01T01:30', 'America/New_York'), '2026-11-01T05:30:00.000Z');
  });

  it('bozuk ya da var olmayan tarih reddedilir', () => {
    assert.equal(zonedWallTimeToUtc('2026-02-31T06:30', 'Europe/Istanbul'), null);
    assert.equal(zonedWallTimeToUtc('2026-09-17 06:30', 'Europe/Istanbul'), null);
    assert.equal(zonedWallTimeToUtc('', 'Europe/Istanbul'), null);
    assert.equal(zonedWallTimeToUtc(undefined, 'Europe/Istanbul'), null);
  });
});

describe('utcToZonedWallTime', () => {
  it('anı otelin duvar saatine çevirir', () => {
    assert.equal(utcToZonedWallTime('2026-09-17T03:30:00.000Z', 'Europe/Istanbul'), '2026-09-17T06:30');
    assert.equal(utcToZonedWallTime('2026-09-16T22:15:00.000Z', 'Europe/Istanbul'), '2026-09-17T01:15');
  });

  it('gece yarısı 24 değil 00 yazılır', () => {
    assert.equal(utcToZonedWallTime('2026-09-16T21:00:00.000Z', 'Europe/Istanbul'), '2026-09-17T00:00');
  });

  it('gidiş-dönüş aynı sonucu verir', () => {
    for (const wall of ['2026-01-01T00:00', '2026-06-30T23:59', '2026-10-25T02:30', '2026-12-31T12:45']) {
      for (const zone of ['Europe/Istanbul', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles']) {
        assert.equal(utcToZonedWallTime(zonedWallTimeToUtc(wall, zone), zone), wall, `${zone} ${wall}`);
      }
    }
  });

  it('geçersiz an null döner', () => {
    assert.equal(utcToZonedWallTime('bozuk', 'Europe/Istanbul'), null);
  });
});
