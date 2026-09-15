import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PLAN_DAYS, PLAN_ROOMS_PAGE_SIZE, PLAN_WINDOW_OPTIONS } from './constants.js';
import { changeRoomSchema, planUnassignedQuerySchema, roomPlanQuerySchema } from './plan.js';

/**
 * Oda planı sözleşmeleri.
 *
 * Sınırlar keyfi değil: 500 odalı bir otelde 45 gün zaten 22.500 hücre.
 * "Hepsini ver" diyen bir istek sunucuyu ve tarayıcıyı birlikte durdurur.
 */

describe('roomPlanQuerySchema', () => {
  const base = { from: '2026-09-16' };

  it('varsayılan pencere ve sayfa boyutu uygular', () => {
    const parsed = roomPlanQuerySchema.parse(base);
    assert.equal(parsed.days, PLAN_WINDOW_OPTIONS[1]);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, PLAN_ROOMS_PAGE_SIZE);
  });

  it('sorgu dizesinden gelen sayıları çevirir', () => {
    const parsed = roomPlanQuerySchema.parse({ ...base, days: '7', page: '2', floor: '3' });
    assert.equal(parsed.days, 7);
    assert.equal(parsed.page, 2);
    assert.equal(parsed.floor, 3);
  });

  it('boş kat filtresini "filtre yok" sayar', () => {
    assert.equal(roomPlanQuerySchema.parse({ ...base, floor: '' }).floor, undefined);
  });

  it('pencere üst sınırını aşan isteği Türkçe mesajla reddeder', () => {
    const result = roomPlanQuerySchema.safeParse({ ...base, days: MAX_PLAN_DAYS + 1 });
    assert.equal(result.success, false);
    assert.match(result.error.issues[0].message, new RegExp(`${MAX_PLAN_DAYS}`));
  });

  it('sıfır ve negatif gün kabul edilmez', () => {
    assert.equal(roomPlanQuerySchema.safeParse({ ...base, days: 0 }).success, false);
    assert.equal(roomPlanQuerySchema.safeParse({ ...base, days: -3 }).success, false);
  });

  it('sayfa boyutu üst sınırı vardır', () => {
    assert.equal(roomPlanQuerySchema.safeParse({ ...base, pageSize: 500 }).success, false);
  });

  it('geçersiz tarih reddedilir', () => {
    assert.equal(roomPlanQuerySchema.safeParse({ from: 'dün' }).success, false);
  });

  it('bilinmeyen durum filtresi reddedilir', () => {
    assert.equal(roomPlanQuerySchema.safeParse({ ...base, housekeepingStatus: 'YIKANIYOR' }).success, false);
    assert.equal(roomPlanQuerySchema.safeParse({ ...base, condition: 'BOZUK' }).success, false);
  });
});

describe('planUnassignedQuerySchema', () => {
  it('varsayılan kayıt sayısı sınırlıdır', () => {
    const parsed = planUnassignedQuerySchema.parse({ from: '2026-09-16' });
    assert.equal(parsed.limit, 25);
  });

  it('sınırsız liste istenemez', () => {
    assert.equal(planUnassignedQuerySchema.safeParse({ from: '2026-09-16', limit: 1000 }).success, false);
  });
});

describe('changeRoomSchema', () => {
  it('oda kimliği uuid olmalı', () => {
    assert.equal(changeRoomSchema.safeParse({ roomId: '00000000-0000-4000-8000-000000000000' }).success, true);
    const result = changeRoomSchema.safeParse({ roomId: '101' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'Geçersiz oda');
  });

  it('oda seçilmediğinde Türkçe mesaj verir', () => {
    const result = changeRoomSchema.safeParse({});
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'Oda seçilmedi');
  });
});
