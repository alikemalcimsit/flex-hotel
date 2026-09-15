import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeBlockOn,
  assignmentKind,
  availabilityForStay,
  blockRemovalMode,
  buildAvailabilityCalendar,
  consumesInventory,
  findNewOverbooking,
  fitsCapacity,
  freeRoomsForStay,
  pickBestRoom,
  rankRooms,
  roomChangeMode,
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
  { id: 'r101', roomTypeId: STD, number: '101', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
  { id: 'r102', roomTypeId: STD, number: '102', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
  { id: 'r103', roomTypeId: STD, number: '103', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
  { id: 'r201', roomTypeId: DLX, number: '201', floor: 2, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
  { id: 'r202', roomTypeId: DLX, number: '202', floor: 2, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
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

const block = (overrides) => ({
  roomId: 'r101',
  type: 'OUT_OF_ORDER',
  startDate: '2026-10-15',
  endDate: '2026-10-17',
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

  it('saatli giriş-çıkış gece hesabını kaydırmaz', () => {
    const cal = calendar({
      reservations: [reservation({ roomId: 'r101', checkIn: '2026-10-15T14:00:00Z', checkOut: '2026-10-18T12:00:00Z' })],
    });
    assert.equal(freeOn(cal, STD, '2026-10-17'), 2);
    assert.equal(freeOn(cal, STD, '2026-10-18'), 3, 'öğlen çıkan misafir 18 gecesini tutmaz');
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

  it('başka tipe yerleştirilen rezervasyon odanın tipinden düşer (upgrade)', () => {
    const cal = calendar({ reservations: [reservation({ roomId: 'r201' })] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3, 'Standart envanteri serbest kalır');
    assert.equal(freeOn(cal, DLX, '2026-10-15'), 1, 'Deluxe odası işgal edildi');
  });
});

describe('arıza kayıtlarının envantere etkisi', () => {
  it('arızalı oda satılamaz', () => {
    const cal = calendar({ blocks: [block()] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2);
    assert.equal(freeOn(cal, STD, '2026-10-16'), 2);
    assert.equal(freeOn(cal, STD, '2026-10-17'), 3, 'blok bitiş günü tekrar satılabilir');
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].outOfOrder, 1);
  });

  it('hizmet dışı oda satışta kalır ama sayaçta görünür', () => {
    const cal = calendar({ blocks: [block({ type: 'OUT_OF_SERVICE' })] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3, 'envanter azalmaz');
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].outOfService, 1);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].outOfOrder, 0);
  });

  it('süresiz blok pencerenin sonuna kadar sürer', () => {
    const cal = calendar({ blocks: [block({ startDate: '2026-10-16', endDate: null })] });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 3);
    assert.equal(freeOn(cal, STD, '2026-10-19'), 2);
  });

  it('hem arızalı hem dolu oda iki kez düşülmez', () => {
    // Bu, naif "toplam − rezervasyon − blok" formülünün yanıldığı yer.
    const cal = calendar({
      reservations: [reservation({ roomId: 'r101' })],
      blocks: [block({ endDate: '2026-10-18' })],
    });
    assert.equal(freeOn(cal, STD, '2026-10-15'), 2, 'tek oda düşmeli, iki değil');
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].occupied, 1);
    assert.equal(cal.byRoomType[STD].days['2026-10-15'].outOfOrder, 1);
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

describe('findNewOverbooking — envanteri azaltan işlem denetimi', () => {
  const threeUnassigned = [reservation({ id: 'a' }), reservation({ id: 'b' }), reservation({ id: 'c' })];

  it('talep dolu tipte odayı arızaya almak yeni overbooking yaratır', () => {
    // Canlıda bulunan hata: 3 odalı tipte 3 onaylı talep varken oda bloklanabiliyordu.
    const before = calendar({ reservations: threeUnassigned });
    const after = calendar({ reservations: threeUnassigned, blocks: [block()] });
    const violations = findNewOverbooking(before, after, [STD]);

    assert.deepEqual(
      violations.map((violation) => violation.day),
      ['2026-10-15', '2026-10-16'],
    );
    assert.deepEqual(
      { freeAfter: violations[0].freeAfter, sellable: violations[0].sellable, demand: violations[0].demand },
      { freeAfter: -1, sellable: 2, demand: 3 },
    );
  });

  it('boş yeri olan tipte arıza kaydı sorun değildir', () => {
    const before = calendar({ reservations: [reservation({ id: 'a' })] });
    const after = calendar({ reservations: [reservation({ id: 'a' })], blocks: [block()] });
    assert.deepEqual(findNewOverbooking(before, after, [STD]), []);
  });

  it('hizmet dışı kayıt envanteri azaltmadığı için overbooking yaratmaz', () => {
    const before = calendar({ reservations: threeUnassigned });
    const after = calendar({ reservations: threeUnassigned, blocks: [block({ type: 'OUT_OF_SERVICE' })] });
    assert.deepEqual(findNewOverbooking(before, after, [STD]), []);
  });

  it('zaten overbook olan tipte net etkisi sıfır olan işlem engellenmez', () => {
    // 4 talep, 3 oda: -1. Talebi aynı tipte odaya yerleştirmek durumu kötüleştirmez.
    const four = [...threeUnassigned, reservation({ id: 'd' })];
    const before = calendar({ reservations: four });
    const after = calendar({ reservations: [...threeUnassigned, reservation({ id: 'd', roomId: 'r101' })] });
    assert.equal(freeOn(after, STD, '2026-10-15'), -1);
    assert.deepEqual(findNewOverbooking(before, after, [STD]), []);
  });

  it('dolu tipe başka tipten misafir yerleştirmek hedef tipi overbook eder', () => {
    const dlxDemand = [reservation({ id: 'x', roomTypeId: DLX }), reservation({ id: 'y', roomTypeId: DLX })];
    const moving = reservation({ id: 'm', roomTypeId: STD });
    const before = calendar({ reservations: [...dlxDemand, moving] });
    const after = calendar({ reservations: [...dlxDemand, { ...moving, roomId: 'r201' }] });

    assert.equal(findNewOverbooking(before, after, [DLX]).length, 3, 'Deluxe 3 gecede de aşılır');
    assert.deepEqual(findNewOverbooking(before, after, [STD]), [], 'kaynak tip rahatlar');
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

  it('arızalı odayı listeden çıkarır', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      blocks: [block({ roomId: 'r103', startDate: '2026-10-16', endDate: '2026-10-17' })],
    });
    assert.deepEqual(free.map((room) => room.id), ['r101', 'r102']);
  });

  it('hizmet dışı odayı da listeden çıkarır (satışta ama misafir verilmez)', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      blocks: [block({ roomId: 'r103', type: 'OUT_OF_SERVICE' })],
    });
    assert.ok(!free.some((room) => room.id === 'r103'));
  });

  it('konaklamadan sonra başlayan blok odayı engellemez', () => {
    const free = freeRoomsForStay({
      ...base,
      roomTypeId: STD,
      blocks: [block({ roomId: 'r103', startDate: '2026-10-18', endDate: null })],
    });
    assert.ok(free.some((room) => room.id === 'r103'), '18\'de başlayan blok 15-18 konaklamasını etkilemez');
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

describe('rankRooms / pickBestRoom', () => {
  const room = (id, floor, number, occupancy, housekeepingStatus) => ({ id, floor, number, occupancy, housekeepingStatus });

  it('bugün gelen misafire önce kontrol edilmiş, sonra temiz, sonra kirli oda verir', () => {
    const ranked = rankRooms(
      [
        room('kirli', 1, '101', 'VACANT', 'DIRTY'),
        room('temiz', 3, '301', 'VACANT', 'CLEAN'),
        room('kontrol', 4, '401', 'VACANT', 'INSPECTED'),
        room('temizleniyor', 2, '201', 'VACANT', 'CLEANING'),
      ],
      { arrivalIsToday: true },
    );
    assert.deepEqual(ranked.map((r) => r.id), ['kontrol', 'temiz', 'temizleniyor', 'kirli']);
  });

  it('bugün gelen misafire çıkışı beklenen dolu odayı en sona koyar', () => {
    const best = pickBestRoom(
      [room('dolu-temiz', 1, '101', 'OCCUPIED', 'CLEAN'), room('bos-kirli', 3, '301', 'VACANT', 'DIRTY')],
      { arrivalIsToday: true },
    );
    assert.equal(best.id, 'bos-kirli');
  });

  it('ileri tarihli konaklamada odanın bugünkü hâline bakmaz', () => {
    // Gelecek ay gelecek misafir için 101'in bugün kirli olması anlamsız.
    const best = pickBestRoom([room('ust-kat-temiz', 3, '301', 'VACANT', 'CLEAN'), room('alt-kat-kirli', 1, '101', 'VACANT', 'DIRTY')]);
    assert.equal(best.id, 'alt-kat-kirli');
  });

  it('eşit durumda alt katı tercih eder', () => {
    const best = pickBestRoom([room('a', 3, '301', 'VACANT', 'CLEAN'), room('b', 1, '101', 'VACANT', 'CLEAN')], { arrivalIsToday: true });
    assert.equal(best.id, 'b');
  });

  it('aynı katta oda numarasını sayısal sıralar', () => {
    const best = pickBestRoom([room('a', 1, '110', 'VACANT', 'CLEAN'), room('b', 1, '102', 'VACANT', 'CLEAN')]);
    assert.equal(best.id, 'b', '102 < 110 (metin sıralamasında ters olurdu)');
  });

  it('aday yoksa null döner', () => {
    assert.equal(pickBestRoom([]), null);
  });

  it('girdi dizisini değiştirmez', () => {
    const candidates = [room('a', 3, '301', 'VACANT', 'CLEAN'), room('b', 1, '101', 'VACANT', 'CLEAN')];
    rankRooms(candidates);
    assert.equal(candidates[0].id, 'a', 'sıralama yan etki yapmamalı');
  });
});

describe('assignmentKind', () => {
  const std = { id: STD, basePrice: '2500.00' };

  it('aynı tip', () => {
    assert.equal(assignmentKind(std, { id: STD, basePrice: '2500.00' }), 'SAME');
  });

  it('pahalı tipe yerleştirme üst sınıftır', () => {
    assert.equal(assignmentKind(std, { id: DLX, basePrice: '3500' }), 'UPGRADE');
  });

  it('ucuz tipe yerleştirme alt sınıftır (eskiden bu da "upgrade" görünüyordu)', () => {
    assert.equal(assignmentKind({ id: DLX, basePrice: '3500' }, std), 'DOWNGRADE');
  });

  it('aynı fiyatlı farklı tip', () => {
    assert.equal(assignmentKind(std, { id: 'type-twin', basePrice: '2500' }), 'LATERAL');
  });

  it('fiyat karşılaştırması ondalık doğrulukla yapılır', () => {
    assert.equal(assignmentKind({ id: 'a', basePrice: '999.99' }, { id: 'b', basePrice: '1000.00' }), 'UPGRADE');
  });
});

describe('fitsCapacity', () => {
  it('yetişkin ve çocuk ayrı ayrı sığmalı', () => {
    const roomType = { capacityAdults: 2, capacityChildren: 1 };
    assert.equal(fitsCapacity({ adults: 2, children: 1 }, roomType), true);
    assert.equal(fitsCapacity({ adults: 3, children: 0 }, roomType), false);
    assert.equal(fitsCapacity({ adults: 1, children: 2 }, roomType), false);
  });
});

describe('activeBlockOn', () => {
  const blocks = [block({ startDate: '2026-10-15', endDate: '2026-10-17' })];

  it('başlangıç günü etkindir', () => {
    assert.ok(activeBlockOn(blocks, '2026-10-15'));
  });

  it('bitiş günü etkin değildir', () => {
    assert.equal(activeBlockOn(blocks, '2026-10-17'), null);
  });

  it('süresiz blok ileri tarihte de etkindir', () => {
    assert.ok(activeBlockOn([block({ startDate: '2026-10-15', endDate: null })], '2027-03-01'));
  });
});

describe('blockRemovalMode — geçmiş değiştirilmez', () => {
  const today = '2026-10-16';

  it('henüz başlamamış blok iptal edilir', () => {
    assert.equal(blockRemovalMode(block({ startDate: '2026-10-20', endDate: '2026-10-25' }), today), 'CANCEL');
  });

  it('bugün başlayan blok iptal edilir (henüz hiçbir geceyi etkilemedi)', () => {
    assert.equal(blockRemovalMode(block({ startDate: today, endDate: null }), today), 'CANCEL');
  });

  it('süren blok bitirilir', () => {
    assert.equal(blockRemovalMode(block({ startDate: '2026-10-10', endDate: '2026-10-20' }), today), 'END');
    assert.equal(blockRemovalMode(block({ startDate: '2026-10-10', endDate: null }), today), 'END');
  });

  it('bitmiş bloğa dokunulmaz', () => {
    assert.equal(blockRemovalMode(block({ startDate: '2026-10-01', endDate: today }), today), 'ALREADY_ENDED');
  });
});

describe('roomChangeMode — oda planındaki sürükle-bırak', () => {
  it('odası olmayan rezervasyona atama yapılır', () => {
    assert.equal(roomChangeMode({ roomId: null, status: 'CONFIRMED' }), 'ASSIGNED');
  });

  it('henüz gelmemiş misafirin odası sadece değişir', () => {
    assert.equal(roomChangeMode({ roomId: 'r1', status: 'CONFIRMED' }), 'MOVED');
  });

  it('içerideki misafir taşınırsa oda durumları da değişmeli', () => {
    assert.equal(roomChangeMode({ roomId: 'r1', status: 'CHECKED_IN' }), 'IN_HOUSE_MOVED');
  });
});

describe('consumesInventory', () => {
  it('durumları doğru ayırır', () => {
    assert.equal(consumesInventory({ status: 'CONFIRMED' }), true);
    assert.equal(consumesInventory({ status: 'CANCELLED' }), false);
  });
});
