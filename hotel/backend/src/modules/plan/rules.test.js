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
  // İş günü pencerenin ilk günü: geçmiş gece yok, çıkış yapmışlar yalnızca giriş/çıkış sayar.
  const base = { totalRooms: 10, from: WINDOW.from, days: 3, blocks: [], businessDate: WINDOW.from };

  it('giriş, çıkış ve konaklayanları ayırır', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        // 16'da giren, 18'de çıkan: 16 ve 17 geceleri dolu.
        { id: 's1', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CHECKED_IN' },
        // 17'de giren.
        { id: 's2', roomId: 'r2', checkIn: day('2026-09-17'), checkOut: day('2026-09-19'), status: 'CONFIRMED' },
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
        { id: 's3', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'CANCELLED' },
        { id: 's4', roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-18'), status: 'NO_SHOW' },
      ],
    });

    assert.equal(summary[0].occupied, 0);
    assert.equal(summary[0].occupancyPct, 0);
  });

  it('oda bekleyen rezervasyon doluluğa girer ama odayı işgal etmez', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [{ id: 's5', roomId: null, checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CONFIRMED' }],
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
        { id: 's6', roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
        { id: 's7', roomId: 'r2', type: 'OUT_OF_SERVICE', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
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
      reservations: [{ id: 's8', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' }],
      blocks: [{ id: 's9', roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') }],
    });

    assert.equal(summary[0].free, 9);
    assert.equal(summary[0].sellable, 9);
  });

  it('doluluk yüzdesi satılabilir odaya göre hesaplanır', () => {
    const summary = summarizeDays({
      ...base,
      totalRooms: 10,
      reservations: [
        { id: 's10', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' },
        { id: 's11', roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' },
      ],
      // İki oda arızalı → satılabilir 8; 2/8 = %25.
      blocks: [
        { id: 's12', roomId: 'r9', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
        { id: 's13', roomId: 'r10', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') },
      ],
    });

    assert.equal(summary[0].occupancyPct, 25);
  });

  it('otelin tamamı arızalıysa yüzde sıfıra bölünmez', () => {
    const summary = summarizeDays({
      ...base,
      totalRooms: 1,
      reservations: [],
      blocks: [{ id: 's14', roomId: 'r1', type: 'OUT_OF_ORDER', startDate: day('2026-09-16'), endDate: day('2026-09-17') }],
    });

    assert.equal(summary[0].sellable, 0);
    assert.equal(summary[0].occupancyPct, 0);
  });
});

describe('summarizeDays — çıkış yapmış konaklamalar ve yapılan işlemler', () => {
  const from = day('2026-09-14');
  // İş günü 16 Eylül: 14 ve 15 geceleri geçmiş.
  const base = { totalRooms: 10, from, days: 4, blocks: [], businessDate: day('2026-09-16') };

  it('çıkış yapmış konaklama geçmiş gecelerin doluluğunda kalır', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [{ id: 'co', roomId: 'r1', checkIn: day('2026-09-14'), checkOut: day('2026-09-16'), status: 'CHECKED_OUT' }],
    });
    assert.equal(summary[0].sold, 1, '14 gecesi misafir kaldı');
    assert.equal(summary[1].sold, 1, '15 gecesi misafir kaldı');
    assert.equal(summary[0].occupancyPct, 10);
  });

  it('erken çıkan misafirin ileriki geceleri boş sayılır', () => {
    // Rezervasyon 18'e kadardı ama misafir çıkış yaptı; tarih güncellenmemiş olabilir.
    const summary = summarizeDays({
      ...base,
      reservations: [{ id: 'early', roomId: 'r1', checkIn: day('2026-09-14'), checkOut: day('2026-09-18'), status: 'CHECKED_OUT' }],
    });
    assert.equal(summary[1].sold, 1, '15 gecesi (geçmiş) dolu');
    assert.equal(summary[2].sold, 0, '16 gecesi (bugün) boş');
    assert.equal(summary[2].free, 10);
  });

  it('bugünkü çıkışlar yapıldıkça sayı azalmaz, yapılan ayrıca sayılır', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        { id: 'd1', roomId: 'r1', checkIn: day('2026-09-14'), checkOut: day('2026-09-16'), status: 'CHECKED_OUT' },
        { id: 'd2', roomId: 'r2', checkIn: day('2026-09-14'), checkOut: day('2026-09-16'), status: 'CHECKED_IN' },
      ],
    });
    assert.equal(summary[2].departures, 2);
    assert.equal(summary[2].departuresDone, 1);
  });

  it('bugünkü girişlerden yapılanlar ayrıca sayılır', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        { id: 'a1', roomId: 'r1', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CHECKED_IN' },
        { id: 'a2', roomId: 'r2', checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'CONFIRMED' },
        { id: 'a3', roomId: null, checkIn: day('2026-09-16'), checkOut: day('2026-09-17'), status: 'NO_SHOW' },
      ],
    });
    assert.equal(summary[2].arrivals, 2, 'gelmedi kaydı giriş sayılmaz');
    assert.equal(summary[2].arrivalsDone, 1);
  });

  it('oda değiştirmiş konaklama her gece tek oda tutar', () => {
    const summary = summarizeDays({
      ...base,
      reservations: [
        { id: 'mv', roomId: 'r2', checkIn: day('2026-09-14'), checkOut: day('2026-09-18'), roomSince: day('2026-09-16'), status: 'CHECKED_IN' },
      ],
      segments: [{ reservationId: 'mv', roomId: 'r1', startDate: day('2026-09-14'), endDate: day('2026-09-16') }],
    });
    for (const row of summary) {
      assert.equal(row.sold, 1, `${row.date}: tek konaklama`);
      assert.equal(row.unassigned, 0, `${row.date}: oda bekleyen yok`);
      assert.equal(row.free, 9, `${row.date}: tek oda dolu`);
    }
  });
});

describe('buildRoomSegments — oda değiştirmiş konaklama', () => {
  const rooms = [{ id: 'r1' }, { id: 'r2' }];
  const moved = {
    id: 'mv',
    roomId: 'r2',
    checkIn: day('2026-09-15'),
    checkOut: day('2026-09-20'),
    roomSince: day('2026-09-17'),
    status: 'CHECKED_IN',
  };
  const segments = [
    { id: 'seg1', roomId: 'r1', startDate: day('2026-09-15'), endDate: day('2026-09-17'), reason: 'Klima', reservation: moved },
  ];

  it('eski odada kapanmış dilim, yeni odada açık dilim çizilir', () => {
    const rows = buildRoomSegments({ rooms, reservations: [moved], blocks: [], segments, ...WINDOW });

    const old = rows.get('r1').reservations[0];
    assert.equal(old.movedOut, true);
    assert.equal(old.startIndex, 0);
    assert.equal(old.span, 1, '16 gecesi (15 pencere dışında)');
    assert.equal(old.continuesBefore, true);
    assert.equal(old.segmentReason, 'Klima');

    const current = rows.get('r2').reservations[0];
    assert.equal(current.movedIn, true);
    assert.equal(current.startIndex, 1, 'yeni oda 17 gecesinden başlar');
    assert.equal(current.span, 3);
  });

  it('her barın ayrı anahtarı var (aynı rezervasyon iki satırda)', () => {
    const rows = buildRoomSegments({ rooms, reservations: [moved], blocks: [], segments, ...WINDOW });
    assert.notEqual(rows.get('r1').reservations[0].key, rows.get('r2').reservations[0].key);
  });

  it('taşınmamış konaklamada taşıma işareti yoktur', () => {
    const plain = { ...moved, roomSince: null };
    const rows = buildRoomSegments({ rooms, reservations: [plain], blocks: [], ...WINDOW });
    assert.equal(rows.get('r2').reservations[0].movedIn, false);
    assert.equal(rows.get('r2').reservations[0].startIndex, 0);
  });
});
