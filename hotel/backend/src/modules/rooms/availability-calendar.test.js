import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eachNight, toIsoDay, toUtcDayStart } from '@hotelos/core';
import {
  buildAvailabilityCalendar,
  consumesInventory,
  INVENTORY_REMOVING_BLOCK_TYPE,
  openSliceStart,
} from './rules.js';

/**
 * Hızlandırılmış müsaitlik takviminin eski (okunaklı, yavaş) algoritmayla
 * **birebir aynı** sonucu verdiğinin kanıtı. Takvim overbooking denetiminin
 * çekirdeği: tek gecelik fark iki kez satılan oda demektir.
 *
 * `referenceCalendar`, hızlandırmadan önceki uygulamanın değiştirilmemiş hâli.
 */

/**
 * @param {{ start: Date | string, end?: Date | string | null }} range
 * @param {Date | string} windowFrom
 * @param {Date | string} windowTo
 */
function nightsWithinWindow(range, windowFrom, windowTo) {
  const windowStart = toUtcDayStart(windowFrom);
  const windowEnd = toUtcDayStart(windowTo);
  const start = Math.max(toUtcDayStart(range.start), windowStart);
  const end = range.end == null ? windowEnd : Math.min(toUtcDayStart(range.end), windowEnd);
  if (end <= start) return [];
  return eachNight(new Date(start), new Date(end));
}

function referenceCalendar({ rooms, reservations, blocks, segments = [], from, to, roomTypeIds = [] }) {
  const nights = eachNight(from, to);
  const days = nights.map(toIsoDay);
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const roomTypeOfRoom = new Map(rooms.map((room) => [room.id, room.roomTypeId]));

  /** @type {Map<string, number>} tip → toplam oda */
  const totalByType = new Map();
  // Henüz odası olmayan tipler de takvimde 0 olarak görünmeli; aksi halde
  // müsaitlik ızgarasında satır kaybolur ve "neden yok" sorusu doğar.
  for (const roomTypeId of roomTypeIds) totalByType.set(roomTypeId, 0);
  for (const room of rooms) {
    totalByType.set(room.roomTypeId, (totalByType.get(room.roomTypeId) ?? 0) + 1);
  }

  // Gece başına: hangi odalar satılamaz, hangi tipte kaç atanmamış talep var.
  const unavailableRoomsByNight = days.map(() => new Set());
  const occupiedRoomsByNight = days.map(() => new Set());
  const outOfOrderRoomsByNight = days.map(() => new Set());
  const outOfServiceRoomsByNight = days.map(() => new Set());
  const unassignedByNight = days.map(() => new Map());

  const consumingIds = new Set(
    reservations.filter((reservation) => reservation.id && consumesInventory(reservation)).map((reservation) => reservation.id),
  );

  // Kapanmış dilimler: taşınan misafirin eski odasında geçirdiği geceler.
  /** @type {Map<string, Set<number>>} rezervasyon → dilimle karşılanan gece indeksleri */
  const segmentNights = new Map();
  for (const segment of segments) {
    if (!consumingIds.has(segment.reservationId)) continue;
    const covered = nightsWithinWindow({ start: segment.startDate, end: segment.endDate }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;
      occupiedRoomsByNight[index].add(segment.roomId);
      unavailableRoomsByNight[index].add(segment.roomId);
      if (!segmentNights.has(segment.reservationId)) segmentNights.set(segment.reservationId, new Set());
      segmentNights.get(segment.reservationId).add(index);
    }
  }

  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;

    const openStart = toUtcDayStart(openSliceStart(reservation));
    const covered = nightsWithinWindow({ start: reservation.checkIn, end: reservation.checkOut }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;

      if (reservation.roomId && night.getTime() >= openStart) {
        occupiedRoomsByNight[index].add(reservation.roomId);
        unavailableRoomsByNight[index].add(reservation.roomId);
        continue;
      }
      // Bu gece eski odada geçti; oda yukarıdaki dilim döngüsünde işaretlendi.
      if (reservation.id && segmentNights.get(reservation.id)?.has(index)) continue;

      const counts = unassignedByNight[index];
      counts.set(reservation.roomTypeId, (counts.get(reservation.roomTypeId) ?? 0) + 1);
    }
  }

  for (const block of blocks) {
    const removesInventory = (block.type ?? INVENTORY_REMOVING_BLOCK_TYPE) === INVENTORY_REMOVING_BLOCK_TYPE;
    const covered = nightsWithinWindow({ start: block.startDate, end: block.endDate }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;
      if (removesInventory) {
        outOfOrderRoomsByNight[index].add(block.roomId);
        unavailableRoomsByNight[index].add(block.roomId);
      } else {
        outOfServiceRoomsByNight[index].add(block.roomId);
      }
    }
  }

  const byRoomType = {};
  for (const [roomTypeId, total] of totalByType) {
    const perDay = {};

    days.forEach((day, index) => {
      let occupied = 0;
      let outOfOrder = 0;
      let unavailable = 0;

      for (const roomId of unavailableRoomsByNight[index]) {
        if (roomTypeOfRoom.get(roomId) !== roomTypeId) continue;
        unavailable += 1;
        if (occupiedRoomsByNight[index].has(roomId)) occupied += 1;
        // Hem dolu hem arızalı bir oda tek kez düşülür ama iki sayaçta da görünür;
        // ekranda "neden satılamıyor" sorusunun cevabı için ikisi de lazım.
        if (outOfOrderRoomsByNight[index].has(roomId)) outOfOrder += 1;
      }

      let outOfService = 0;
      for (const roomId of outOfServiceRoomsByNight[index]) {
        if (roomTypeOfRoom.get(roomId) === roomTypeId) outOfService += 1;
      }

      const unassigned = unassignedByNight[index].get(roomTypeId) ?? 0;

      perDay[day] = {
        total,
        occupied,
        outOfOrder,
        // Satılabilir sayılır ama atanamaz: son odalar bunlarsa ön büro uyarılmalı.
        outOfService,
        unassigned,
        // Negatif kalabilir: overbooking'i gizlemek yerine görünür kılıyoruz.
        free: total - unavailable - unassigned,
      };
    });

    byRoomType[roomTypeId] = { total, days: perDay };
  }

  return { days, byRoomType };
}

/** Tekrarlanabilir sözde rastgele sayı (mulberry32). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1);
const STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

/** @param {number} seed */
function scenario(seed) {
  const next = random(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  // Saatli tarihler de gelir (gün başına indirgenmeli).
  const at = (day) => new Date(BASE + day * DAY + int(0, 3) * 3_600_000);

  const types = Array.from({ length: int(1, 4) }, (_, index) => `tip-${index}`);
  const rooms = Array.from({ length: int(0, 25) }, (_, index) => ({ id: `oda-${index}`, roomTypeId: pick(types) }));
  const roomIds = [...rooms.map((room) => room.id), 'silinmis-oda'];
  const reservations = Array.from({ length: int(0, 60) }, (_, index) => {
    const checkIn = int(-10, 40);
    const checkOut = checkIn + int(0, 12);
    const roomSince = next() < 0.2 ? at(checkIn + int(-2, 14)) : null;
    return {
      id: next() < 0.95 ? `rez-${index}` : undefined,
      roomId: next() < 0.7 ? pick(roomIds) : null,
      roomTypeId: next() < 0.95 ? pick(types) : 'bilinmeyen-tip',
      checkIn: at(checkIn),
      checkOut: at(checkOut),
      roomSince,
      status: pick(STATUSES),
    };
  });
  const blocks = Array.from({ length: int(0, 10) }, () => {
    const start = int(-15, 45);
    return {
      roomId: pick(roomIds),
      type: next() < 0.2 ? undefined : pick([INVENTORY_REMOVING_BLOCK_TYPE, 'OUT_OF_SERVICE']),
      startDate: at(start),
      endDate: next() < 0.2 ? null : at(start + int(-1, 20)),
    };
  });
  const segments = Array.from({ length: int(0, 12) }, () => {
    const start = int(-10, 40);
    return {
      reservationId: next() < 0.9 ? (pick(reservations)?.id ?? 'yok') : 'yok',
      roomId: pick(roomIds),
      startDate: at(start),
      endDate: at(start + int(0, 8)),
    };
  });
  const from = at(int(-5, 20));
  const to = new Date(from.getTime() + int(-1, 45) * DAY);
  const roomTypeIds = next() < 0.5 ? [...types, 'bos-tip'] : [];
  return { rooms, reservations, blocks, segments, from, to, roomTypeIds };
}

describe('müsaitlik takvimi — hızlı uygulama eskisiyle birebir aynı', () => {
  it('600 rastgele senaryoda (taşınan misafir, süresiz arıza, silinmiş oda, saatli tarih) sonuçlar eşit', () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const input = scenario(seed);
      assert.deepStrictEqual(buildAvailabilityCalendar(input), referenceCalendar(input), `senaryo ${seed}`);
    }
  });

  it('büyük otelde (1500 oda, 30 bin rezervasyon, 90 gün) hızlı kalır', () => {
    const rooms = Array.from({ length: 1500 }, (_, index) => ({ id: `oda-${index}`, roomTypeId: `tip-${index % 12}` }));
    const reservations = Array.from({ length: 30_000 }, (_, index) => {
      const checkIn = index % 90;
      return {
        id: `rez-${index}`,
        roomId: index % 10 === 0 ? null : `oda-${index % 1500}`,
        roomTypeId: `tip-${index % 12}`,
        checkIn: new Date(BASE + checkIn * DAY),
        checkOut: new Date(BASE + (checkIn + 1 + (index % 4)) * DAY),
        roomSince: null,
        status: 'CONFIRMED',
      };
    });
    const input = { rooms, reservations, blocks: [], segments: [], from: new Date(BASE), to: new Date(BASE + 90 * DAY) };
    const started = performance.now();
    const result = buildAvailabilityCalendar(input);
    const elapsed = performance.now() - started;
    assert.equal(result.days.length, 90);
    assert.ok(elapsed < 250, `takvim ${Math.round(elapsed)} ms sürdü`);
  });
});
