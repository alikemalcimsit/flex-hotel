import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRoomSegments, placeInWindow, planDays, summarizeDays } from './rules.js';

/**
 * Oda planının saf çekirdeği.
 *
 * Buradaki her iddia ızgarada gözle görülür bir hatayı temsil ediyor: bir gün
 * kaymış bar, çıkış gününü de boyayan konaklama, sayfaya göre değişen doluluk
 * yüzdesi. Hiçbiri çökmez; sessizce yanlış oda satılır.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const WINDOW = { from: day('2026-09-16'), days: 7 }; // 16 → 22 Eylül geceleri

describe('planDays', () => {
  it('pencere kadar gece üretir, çıkış gününü eklemez', () => {
    assert.deepEqual(planDays(day('2026-09-16'), 3), ['2026-09-16', '2026-09-17', '2026-09-18']);
  });

  it('saatli tarihi gün başına indirger', () => {
    assert.deepEqual(planDays(new Date('2026-09-16T21:30:00.000Z'), 2), ['2026-09-16', '2026-09-17']);
  });
});

describe('placeInWindow', () => {
  it('pencere içindeki konaklamayı doğru sütuna oturtur', () => {
    const placement = placeInWindow({ start: day('2026-09-18'), end: day('2026-09-21') }, WINDOW);
    assert.deepEqual(placement, { startIndex: 2, span: 3, continuesBefore: false, continuesAfter: false });
  });

  it('çıkış gününü boyamaz (yarı açık aralık)', () => {
    // 16-17 rezervasyonu yalnız 16 gecesini tutar; 17 sütunu boş kalmalı.
    const placement = placeInWindow({ start: day('2026-09-16'), end: day('2026-09-17') }, WINDOW);
    assert.equal(placement.span, 1);
  });

  it('pencereden önce başlayan barı kırpar ve işaretler', () => {
    const placement = placeInWindow({ start: day('2026-09-10'), end: day('2026-09-18') }, WINDOW);
    assert.deepEqual(placement, { startIndex: 0, span: 2, continuesBefore: true, continuesAfter: false });
  });

  it('pencereden sonra biten barı kırpar ve işaretler', () => {
    const placement = placeInWindow({ start: day('2026-09-21'), end: day('2026-10-05') }, WINDOW);
    assert.deepEqual(placement, { startIndex: 5, span: 2, continuesBefore: false, continuesAfter: true });
  });

  it('süresiz arıza kaydı pencerenin sonuna kadar sürer', () => {
    const placement = placeInWindow({ start: day('2026-09-19'), end: null }, WINDOW);
    assert.deepEqual(placement, { startIndex: 3, span: 4, continuesBefore: false, continuesAfter: true });
  });

  it('pencereyle kesişmeyen aralık çizilmez', () => {
    assert.equal(placeInWindow({ start: day('2026-08-01'), end: day('2026-08-05') }, WINDOW), null);
    assert.equal(placeInWindow({ start: day('2026-10-01'), end: day('2026-10-05') }, WINDOW), null);
  });

  it('pencerenin son gecesinde biten konaklama tam sığar', () => {
    const placement = placeInWindow({ start: day('2026-09-22'), end: day('2026-09-23') }, WINDOW);
    assert.deepEqual(placement, { startIndex: 6, span: 1, continuesBefore: false, continuesAfter: false });
  });

  it('pencere bittikten sonra başlayan konaklama çizilmez', () => {
    assert.equal(placeInWindow({ start: day('2026-09-23'), end: day('2026-09-25') }, WINDOW), null);
  });
});

describe('buildRoomSegments', () => {
  const rooms = [{ id: 'r1' }, { id: 'r2' }];

  it('barı odasının satırına koyar, atanmamış rezervasyonu ızgaraya koymaz', () => {
    const segments = buildRoomSegments({
      rooms,
      reservations: [
        { id: 'a', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CONFIRMED' },
        { id: 'b', roomId: null, checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'PENDING' },
      ],
      blocks: [],
      ...WINDOW,
    });

    assert.equal(segments.get('r1').reservations.length, 1);
    assert.equal(segments.get('r2').reservations.length, 0);
  });

  it('listede olmayan odanın barını sessizce atar (sayfalanmış ızgara)', () => {
    const segments = buildRoomSegments({
      rooms,
      reservations: [
        { id: 'a', roomId: 'baska-sayfadaki-oda', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CONFIRMED' },
      ],
      blocks: [],
      ...WINDOW,
    });

    assert.equal([...segments.values()].every((row) => row.reservations.length === 0), true);
  });

  it('barları sütun sırasına dizer', () => {
    const segments = buildRoomSegments({
      rooms,
      reservations: [
        { id: 'gec', roomId: 'r1', checkIn: day('2026-09-20'), checkOut: day('2026-09-22'), status: 'CONFIRMED' },
        { id: 'erken', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CONFIRMED' },
      ],
      blocks: [],
      ...WINDOW,
    });

    assert.deepEqual(segments.get('r1').reservations.map((row) => row.id), ['erken', 'gec']);
  });

  it('arıza kayıtları rezervasyonlardan ayrı sırada durur', () => {
    const segments = buildRoomSegments({
      rooms,
      reservations: [{ id: 'a', roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' }],
      blocks: [{ id: 'b1', roomId: 'r2', type: 'OUT_OF_ORDER', startDate: day('2026-09-18'), endDate: null }],
      ...WINDOW,
    });

    assert.equal(segments.get('r2').reservations.length, 1);
    assert.equal(segments.get('r2').blocks.length, 1);
    assert.equal(segments.get('r2').blocks[0].continuesAfter, true);
  });
});

describe('summarizeDays', () => {
  const base = { totalRooms: 10, from: WINDOW.from, days: 3, blocks: [] };

  it('giriş, çıkış ve konaklayanları ayırır', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        // 16'da giren, 18'de çıkan: 16 ve 17 geceleri dolu.
        { roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CHECKED_IN' },
        // 17'de giren.
        { roomId: 'r2', checkIn: day('2026-09-17'), checkOut: day('2026-09-19'), status: 'CONFIRMED' },
      ],
    });

    assert.deepEqual(
      summary.map((row) => [row.date, row.arrivals, row.departures, row.stayovers, row.occupied]),
      [
        ['2026-09-16', 1, 0, 0, 1],
        ['2026-09-17', 1, 0, 1, 2],
        ['2026-09-18', 0, 1, 1, 1],
      ],
    );
  });

  it('iptal ve gelmedi kayıtları sayılmaz', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        { roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CANCELLED' },
        { roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'NO_SHOW' },
      ],
    });

    assert.equal(summary[0].occupied, 0);
    assert.equal(summary[0].occupancyPct, 0);
  });

  it('oda bekleyen rezervasyon doluluğa girer ama odayı işgal etmez', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [{ roomId: null, checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CONFIRMED' }],
    });

    assert.equal(summary[0].unassigned, 1);
    assert.equal(summary[0].occupied, 0);
    assert.equal(summary[0].free, 9);
    assert.equal(summary[0].occupancyPct, 10);
  });

  it('arızalı oda satılabilir envanterden düşer, hizmet dışı düşmez', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [],
      blocks: [
        { roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
        { roomId: 'r2', type: 'OUT_OF_SERVICE', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
      ],
    });

    assert.equal(summary[0].sellable, 9);
    assert.equal(summary[0].outOfOrder, 1);
    assert.equal(summary[0].outOfService, 1);
    assert.equal(summary[0].free, 9, 'hizmet dışı oda boş sayılır (satılabilir ama verilemez)');
  });

  it('dolu oda aynı anda arızalıysa envanterden iki kez düşülmez', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [{ roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' }],
      blocks: [{ roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') }],
    });

    assert.equal(summary[0].free, 9);
    assert.equal(summary[0].sellable, 9);
  });

  it('doluluk yüzdesi satılabilir odaya göre hesaplanır', () => {
    const summary = summarizeDays({
      ...base,
      totalRooms: 10,
      reservations: [
        { roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' },
        { roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' },
      ],
      // İki oda arızalı → satılabilir 8; 2/8 = %25.
      blocks: [
        { roomId: 'r9', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
        { roomId: 'r10', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
      ],
    });

    assert.equal(summary[0].occupancyPct, 25);
  });

  it('otelin tamamı arızalıysa yüzde sıfıra bölünmez', () => {
    const summary = summarizeDays({
      ...base,
      totalRooms: 1,
      reservations: [],
      blocks: [{ roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') }],
    });

    assert.equal(summary[0].sellable, 0);
    assert.equal(summary[0].occupancyPct, 0);
  });
});
