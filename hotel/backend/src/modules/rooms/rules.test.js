import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  availabilityForStay,
  buildAvailabilityCalendar,
  consumesInventory,
  freeRoomsForStay,
  pickBestRoom,
} from './rules.js';

/**
 * "15-18 Ekim'de kaç Standart boş?" sorusunun cevabı burada üretiliyor.
 * Yanlış olursa ya oda iki kez satılır ya da boş oda satılamaz — ikisi de
 * sessizce olur, bu yüzden sınır günleri tek tek sınanıyor.
 */

const STD = 'type-std';
const DLX = 'type-dlx';

/** 3 Standart + 2 Deluxe oda. */
const ROOMS = [
  { id: 'r101', roomTypeId: STD, number: '101', floor: 1, status: 'AVAILABLE' },
  { id: 'r102', roomTypeId: STD, number: '102', floor: 1, status: 'AVAILABLE' },
  { id: 'r103', roomTypeId: STD, number: '103', floor: 1, status: 'AVAILABLE' },
  { id: 'r201', roomTypeId: DLX, number: '201', floor: 2, status: 'AVAILABLE' },
  { id: 'r202', roomTypeId: DLX, number: '202', floor: 2, status: 'AVAILABLE' },
];

const reservation = (overrides) => ({
  id: 'res-1',
  roomId: null,
  roomTypeId: STD,
  checkIn: '2026-10-15',
  checkOut: '2026-10-18',
  status: 'CONFIRMED',
  ...overrides,
});

const calendar = (overrides = {}) =>
  buildAvailabilityCalendar({
    rooms: ROOMS,
    reservations: [],
    blocks: [],
    from: '2026-10-14',
    to: '2026-10-20',
    roomTypeIds: [STD, DLX],
    ...overrides,
  });

const freeOn = (cal, roomTypeId, day) => cal.byRoomType[roomTypeId].days[day].free;

describe('takvim iskeleti', () => {
  it('pencerenin her gecesini üretir (çıkış günü hariç)', () => {
    const cal = calendar();
    assert.deepEqual(cal.days, [
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
  });

  it('boş otelde bütün odalar boştur', () => {
    const cal = calendar();
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3);
    assert.equal(freeOn(cal, DLX, '2026-10-15'), 2);
  });

  it('odası olmayan oda tipi takvimde 0 ile görünür', () => {
    const cal = buildAvailabilityCalendar({
      rooms: [],
      reservations: [],
      blocks: [],
      from: '2026-10-14',
      to: '2026-10-16',
      roomTypeIds: [STD],
    });
    assert.equal(cal.byRoomType[STD].total, 0);
    assert.equal(freeOn(cal, STD, '2026-10-15'), 0);
  });
});

describe('rezervasyonların envantere etkisi', () => {
  it('atanmamış rezervasyon tipin envanterinden düşer', () => {
    const cal = calendar({ reservations: [reservation()] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].unassigned, 1);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].occupied, 0);
  });

  it('atanmış rezervasyon o odayı işgal eder', () => {
    const cal = calendar({ reservations: [reservation({ roomId: 'r101' })] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].occupied, 1);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].unassigned, 0);
  });

  it('çıkış günü oda tekrar boştur (devir)', () => {
    const cal = calendar({ reservations: [reservation({ roomId: 'r101' })] });
    assert.equal(freeOn(cal, STD, '2026-10-17'), 2, '17 gecesi hâlâ dolu');
    assert.equal(freeOn(cal, STD, '2026-10-18'), 3, '18 gecesi boşalmalı');
  });

  it('giriş gününden önceki gece etkilenmez', () => {
    const cal = calendar({ reservations: [reservation({ roomId: 'r101' })] });
    assert.equal(freeOn(cal, STD, '2026-10-14'), 3);
  });

  it('diğer oda tipini etkilemez', () => {
    const cal = calendar({ reservations: [reservation({ roomId: 'r101' })] });
    assert.equal(freeOn(cal, DLX, '2026-10-15'), 2);
  });

  it('iptal, gelmedi ve çıkış yapmış rezervasyonlar envanteri tüketmez', () => {
    const cal = calendar({
      reservations: [
        reservation({ id: 'a', status: 'CANCELLED' }),
        reservation({ id: 'b', status: 'NO_SHOW' }),
        reservation({ id: 'c', status: 'CHECKED_OUT' }),
      ],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3);
  });

  it('bekleyen ve giriş yapmış rezervasyonlar envanteri tüketir', () => {
    const cal = calendar({
      reservations: [reservation({ id: 'a', status: 'PENDING' }), reservation({ id: 'b', status: 'CHECKED_IN' })],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 1);
  });

  it('pencereye taşan rezervasyonun yalnızca kesişen geceleri sayılır', () => {
    const cal = calendar({
      reservations: [reservation({ roomId: 'r101', checkIn: '2026-10-01', checkOut: '2026-10-16' })],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2, '15 gecesi dolu');
    assert.equal(freeOn(cal, STD, '2026-10-16'), 3, '16 gecesi boş');
  });
});

describe('blokların envantere etkisi', () => {
  it('bloklu oda satılamaz', () => {
    const cal = calendar({ blocks: [{ roomId: 'r101', startDate: '2026-10-15', endDate: '2026-10-17' }] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2);
    assert.equal(freeOn(cal, STD, '2026-10-16'), 2);
    assert.equal(freeOn(cal, STD, '2026-10-17'), 3, 'blok bitiş günü tekrar satılabilir');
  });

  it('süresiz blok pencerenin sonuna kadar sürer', () => {
    const cal = calendar({ blocks: [{ roomId: 'r101', startDate: '2026-10-16', endDate: null }] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3);
    assert.equal(freeOn(cal, STD, '2026-10-19'), 2);
  });

  it('hem bloklu hem dolu oda iki kez düşülmez', () => {
    // Bu, naif "toplam − rezervasyon − blok" formülünün yanıldığı yer.
    const cal = calendar({
      reservations: [reservation({ roomId: 'r101' })],
      blocks: [{ roomId: 'r101', startDate: '2026-10-15', endDate: '2026-10-18' }],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2, 'tek oda düşmeli, iki değil');
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].occupied, 1);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].blocked, 1);
  });
});

describe('overbooking görünürlüğü', () => {
  it('kapasitenin üstünde talep negatif boşluk olarak raporlanır', () => {
    const cal = calendar({
      reservations: [
        reservation({ id: 'a' }),
        reservation({ id: 'b' }),
        reservation({ id: 'c' }),
        reservation({ id: 'd' }),
      ],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), -1, 'gizlenmemeli, görünmeli');
  });
});

describe('availabilityForStay', () => {
  it('gecelerin en düşüğünü alır', () => {
    // 16 gecesi iki rezervasyon, diğer geceler bir tane.
    const cal = calendar({
      reservations: [
        reservation({ id: 'a', checkIn: '2026-10-15', checkOut: '2026-10-18' }),
        reservation({ id: 'b', checkIn: '2026-10-16', checkOut: '2026-10-17' }),
      ],
    });
    assert.equal(availabilityForStay(cal, STD, '2026-10-15', '2026-10-18'), 1);
  });

  it('tek gece dolu olsa bile konaklama satılamaz', () => {
    const cal = calendar({
      reservations: [
        reservation({ id: 'a', roomId: 'r101', checkIn: '2026-10-16', checkOut: '2026-10-17' }),
        reservation({ id: 'b', roomId: 'r102', checkIn: '2026-10-16', checkOut: '2026-10-17' }),
        reservation({ id: 'c', roomId: 'r103', checkIn: '2026-10-16', checkOut: '2026-10-17' }),
      ],
    });
    assert.equal(availabilityForStay(cal, STD, '2026-10-15', '2026-10-18'), 0);
  });

  it('takvim penceresi dışındaki gece sorulursa 0 döner', () => {
    const cal = calendar();
    assert.equal(availabilityForStay(cal, STD, '2026-11-01', '2026-11-03'), 0);
  });

  it('bilinmeyen oda tipi 0 döner', () => {
    assert.equal(availabilityForStay(calendar(), 'yok', '2026-10-15', '2026-10-16'), 0);
  });

  it('aynı gün giriş-çıkış 0 döner', () => {
    assert.equal(availabilityForStay(calendar(), STD, '2026-10-15', '2026-10-15'), 0);
  });
});

describe('freeRoomsForStay', () => {
  const base = { rooms: ROOMS, reservations: [], blocks: [], checkIn: '2026-10-15', checkOut: '2026-10-18' };

  it('boş otelde tipin bütün odalarını verir', () => {
    const free = freeRoomsForStay({ ...base, roomTypeId: STD });
    assert.deepEqual(free.map((room) => room.id), ['r101', 'r102', 'r103']);
  });

  it('dolu odayı listeden çıkarır', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      reservations: [reservation({ roomId: 'r102' })],
    });
    assert.deepEqual(free.map((room) => room.id), ['r101', 'r103']);
  });

  it('çıkış günü devreden odayı uygun sayar', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      reservations: [reservation({ roomId: 'r102', checkIn: '2026-10-12', checkOut: '2026-10-15' })],
    });
    assert.ok(free.some((room) => room.id === 'r102'), '15\'te çıkan oda 15\'te tekrar verilebilir');
  });

  it('bloklu odayı listeden çıkarır', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      blocks: [{ roomId: 'r103', startDate: '2026-10-16', endDate: '2026-10-17' }],
    });
    assert.deepEqual(free.map((room) => room.id), ['r101', 'r102']);
  });

  it('iptal edilmiş rezervasyon odayı engellemez', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      reservations: [reservation({ roomId: 'r102', status: 'CANCELLED' })],
    });
    assert.equal(free.length, 3);
  });

  it('oda değiştirirken kaydın kendi odası engel sayılmaz', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      reservations: [reservation({ id: 'res-x', roomId: 'r102' })],
      excludeReservationId: 'res-x',
    });
    assert.ok(free.some((room) => room.id === 'r102'));
  });

  it('oda tipi verilmezse bütün tiplerden döner', () => {
    const free = freeRoomsForStay(base);
    assert.equal(free.length, 5);
  });
});

describe('pickBestRoom', () => {
  it('temiz odayı kirliye tercih eder', () => {
    const best = pickBestRoom([
      { id: 'a', number: '105', floor: 1, status: 'DIRTY' },
      { id: 'b', number: '301', floor: 3, status: 'AVAILABLE' },
    ]);
    assert.equal(best.id, 'b');
  });

  it('eşit durumda alt katı tercih eder', () => {
    const best = pickBestRoom([
      { id: 'a', number: '301', floor: 3, status: 'AVAILABLE' },
      { id: 'b', number: '101', floor: 1, status: 'AVAILABLE' },
    ]);
    assert.equal(best.id, 'b');
  });

  it('aynı katta oda numarasını sayısal sıralar', () => {
    const best = pickBestRoom([
      { id: 'a', number: '110', floor: 1, status: 'AVAILABLE' },
      { id: 'b', number: '102', floor: 1, status: 'AVAILABLE' },
    ]);
    assert.equal(best.id, 'b', '102 < 110 (metin sıralamasında ters olurdu)');
  });

  it('aday yoksa null döner', () => {
    assert.equal(pickBestRoom([]), null);
  });

  it('girdi dizisini değiştirmez', () => {
    const candidates = [
      { id: 'a', number: '301', floor: 3, status: 'AVAILABLE' },
      { id: 'b', number: '101', floor: 1, status: 'AVAILABLE' },
    ];
    pickBestRoom(candidates);
    assert.equal(candidates[0].id, 'a', 'sıralama yan etki yapmamalı');
  });
});

describe('consumesInventory', () => {
  it('durumları doğru ayırır', () => {
    assert.equal(consumesInventory({ status: 'CONFIRMED' }), true);
    assert.equal(consumesInventory({ status: 'CANCELLED' }), false);
  });
});
