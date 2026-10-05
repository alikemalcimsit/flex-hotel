import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Kayıp eşya (modül 21) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: kayıt (etiket no, iş günü, çift gönderim, ileri tarih, başka otelin
 * odası), liste görünümleri ve arama (etiket no, oda, açıklama, misafir),
 * süresi dolanlar (değerli / normal), eşleştirme adayları (odadaki, çıkan,
 * taşınan, refakatçi; eski ve sonradan gelen yok), eşleştirme kuralları ve
 * sürüm damgası, eşleşmeyi kaldırma, teslim (değerli eşyada kimlik), aynı
 * eşyanın eşzamanlı iki teslimi, kapatma, kapanmış kayda not, fotoğraflar
 * (disk, sınır, silme, kapanmış eşya, süre dolunca silme işi), çıkış
 * penceresi uyarısı, iletişim bilgisinin yetkiye göre gizlenmesi, otel sınırı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const KAT = 'kat@test.local';
const DESK = 'resepsiyon@test.local';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PHOTO = { contentType: 'image/jpeg', image: JPEG.toString('base64'), thumbnail: JPEG.toString('base64') };
const silentLogger = { info() {}, warn() {}, error() {} };

describe('kayıp eşya (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let service;
  /** @type {any} */ let photos;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let room;
  let roomType;
  let storageDir;
  let previousStorage;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'hotelos-lost-'));
    previousStorage = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = storageDir;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    service = await import('./service.js');
    photos = await import('./photos.js');
    frontDesk = await import('../front-desk/service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
    if (previousStorage === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorage;
    await rm(storageDir, { recursive: true, force: true });
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const kat = (fn) => as(KAT, fn);
  const desk = (fn) => as(DESK, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);
  const hotelFiles = async (hotel = hotelId) => {
    try {
      return (await readdir(path.join(storageDir, 'lost-items', hotel))).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  beforeEach(async () => {
    await resetDatabase(db);
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    await rm(path.join(storageDir, 'lost-items'), { recursive: true, force: true });
    const hotel = await db.hotel.create({
      data: { name: 'Deniz Otel', code: `X${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, checkInTime: '14:00', checkOutTime: '12:00' },
    });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `Y${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } })).id;
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 } });
    room = {};
    for (const number of ['101', '102', '103']) room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id } });
  });

  async function seedGuest(firstName, lastName, extra = {}) {
    return db.guest.create({ data: { hotelId, firstName, lastName, phone: '+905321112233', email: `${firstName.toLowerCase()}@test.local`, ...extra } });
  }

  /**
   * @param {{ roomNumber?: string, status?: string, guest?: any, checkInOffset?: number, checkOutOffset?: number, checkedInAt?: Date, checkedOutAt?: Date | null, roomSince?: Date | null }} options
   */
  async function seedStay({ roomNumber = '101', status = 'CHECKED_IN', guest, checkInOffset = -2, checkOutOffset = 1, checkedInAt, checkedOutAt = null, roomSince = null } = {}) {
    const owner = guest ?? (await seedGuest('Ayşe', 'Kaya'));
    return db.reservation.create({
      data: {
        hotelId,
        guestId: owner.id,
        roomTypeId: roomType.id,
        roomId: room[roomNumber].id,
        roomSince,
        checkIn: new Date(day(checkInOffset)),
        checkOut: new Date(day(checkOutOffset)),
        status,
        checkedInAt: checkedInAt ?? at('15:00', checkInOffset),
        checkedInBy: DESK,
        checkedOutAt,
        checkedOutBy: checkedOutAt ? DESK : null,
        confirmedAt: new Date(),
        totalPrice: '3000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
  }

  /** @param {Record<string, unknown>} [overrides] */
  function record(overrides = {}) {
    return kat(() =>
      service.createLostItem(hotelId, {
        requestId: randomUUID(),
        description: 'Siyah deri cüzdan',
        category: 'DOCUMENTS',
        valuable: false,
        roomId: room['101'].id,
        locationText: null,
        foundAt: at('10:30', -1),
        foundByName: 'Ayşe (kat)',
        storageLocation: 'Kasa',
        ...overrides,
      }),
    );
  }

  /* ─────────────── Kayıt ─────────────── */

  it('eşyayı kaydeder: etiket no, iş günü, ilk not, denetim izi ve olay; aynı istek ikinci kez kayıt açmaz', async () => {
    const requestId = randomUUID();
    const first = await record({ requestId, note: 'Yatağın altında bulundu', valuable: true });
    assert.equal(first.created, true);
    const item = first.item;
    assert.match(item.reference, /^LF-[2-9A-HJ-NP-Z]{6}$/);
    assert.equal(item.status, 'STORED');
    assert.equal(item.businessDate, day(-1));
    assert.equal(item.roomNumber, '101');
    assert.equal(item.retainUntil, day(364));
    assert.equal(item.expired, false);
    assert.equal(item.recordedBy, KAT);
    assert.deepEqual(item.notes.map((note) => [note.channel, note.text]), [['NOTE', 'Yatağın altında bulundu']]);

    const again = await record({ requestId });
    assert.equal(again.created, false);
    assert.equal(again.item.id, item.id);
    assert.equal(await db.lostItem.count({ where: { hotelId } }), 1);

    const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'LostItem', entityId: item.id } });
    assert.equal(audit.action, 'CREATE');
    assert.equal(audit.actor, KAT);
    const event = await db.eventLog.findFirst({ where: { hotelId, name: 'lost_item.recorded' } });
    assert.equal(event.payload.itemId, item.id);
  });

  it('gece yarısından sonra bulunan eşyanın iş günü otelin saat dilimine göre', async () => {
    const { item } = await record({ foundAt: at('00:30', -1) });
    assert.equal(item.businessDate, day(-1));
  });

  it('ileri tarihli bulunma zamanını, bilinmeyen ve başka otelin odasını reddeder', async () => {
    await rejectsWith(record({ foundAt: new Date(Date.now() + 60 * 60 * 1000) }), 'VALIDATION', /ileride/);
    await rejectsWith(record({ roomId: randomUUID() }), 'VALIDATION', /oda bulunamadı/);
    const foreignType = await db.roomType.create({ data: { hotelId: otherHotelId, code: 'STD', name: 'Std', basePrice: '1', capacityAdults: 1, capacityChildren: 0 } });
    const foreignRoom = await db.room.create({ data: { hotelId: otherHotelId, number: '101', roomTypeId: foreignType.id } });
    await rejectsWith(record({ roomId: foreignRoom.id }), 'VALIDATION', /oda bulunamadı/);
    assert.equal(await db.lostItem.count(), 0);
  });

  it('başka otelin eşyası okunamaz, değiştirilemez', async () => {
    const { item } = await record();
    await rejectsWith(service.getLostItem(otherHotelId, item.id, { includeContact: true }), 'NOT_FOUND');
    await rejectsWith(
      desk(() => service.disposeLostItem(otherHotelId, item.id, { expectedUpdatedAt: new Date(item.updatedAt), method: 'DONATED', reason: 'deneme' })),
      'NOT_FOUND',
    );
  });

  /* ─────────────── Liste, arama, süre ─────────────── */

  it('arama: etiket no (öneksiz da), oda no, açıklama, yazılı yer; süzgeçler ve sayfa', async () => {
    const wallet = (await record()).item;
    const phone = (await record({ description: 'Beyaz iPhone 15, kılıfı kırmızı', category: 'ELECTRONICS', valuable: true, roomId: room['102'].id, foundAt: at('10:40', -1) })).item;
    const scarf = (await record({ description: 'Mavi ipek eşarp', category: 'CLOTHING', roomId: null, locationText: 'Havuz barı', foundAt: at('10:50', -1) })).item;
    const list = (query) => service.listLostItems(hotelId, { view: 'OPEN', page: 1, pageSize: 25, ...query }, { includeContact: false });

    assert.deepEqual((await list({})).items.map((item) => item.id), [scarf.id, phone.id, wallet.id]);
    assert.deepEqual((await list({ search: wallet.reference })).items.map((item) => item.id), [wallet.id]);
    assert.deepEqual((await list({ search: wallet.reference.slice(3).toLowerCase() })).items.map((item) => item.id), [wallet.id]);
    assert.deepEqual((await list({ search: '102' })).items.map((item) => item.id), [phone.id]);
    assert.deepEqual((await list({ search: 'iphone' })).items.map((item) => item.id), [phone.id]);
    assert.deepEqual((await list({ search: 'havuz' })).items.map((item) => item.id), [scarf.id]);
    assert.deepEqual((await list({ search: 'iphone kırmızı' })).items.map((item) => item.id), [phone.id]);
    assert.equal((await list({ search: 'iphone eşarp' })).items.length, 0);
    assert.deepEqual((await list({ valuable: true })).items.map((item) => item.id), [phone.id]);
    assert.deepEqual((await list({ category: 'CLOTHING' })).items.map((item) => item.id), [scarf.id]);
    assert.equal((await list({ from: day(1) })).items.length, 0);

    const paged = await list({ pageSize: 2 });
    assert.equal(paged.items.length, 2);
    assert.equal(paged.meta.total, 3);
    assert.equal(paged.meta.totalPages, 2);
  });

  it('süresi dolanlar: normal ve değerli ayrı süre; ayar değişince hemen uygulanır', async () => {
    const normalOld = (await record({ description: 'Eski şemsiye', category: 'OTHER' })).item;
    const valuableOld = (await record({ description: 'Eski saat', category: 'JEWELRY', valuable: true })).item;
    await record({ description: 'Yeni şemsiye', category: 'OTHER' });
    await db.lostItem.updateMany({ where: { id: { in: [normalOld.id, valuableOld.id] } }, data: { businessDate: new Date(day(-100)) } });

    const expired = await service.listLostItems(hotelId, { view: 'EXPIRED', page: 1, pageSize: 25 }, { includeContact: false });
    assert.deepEqual(expired.items.map((item) => item.id), [normalOld.id]);
    assert.equal(expired.items[0].expired, true);
    assert.equal(expired.items[0].retainUntil, day(-10));
    let summary = await service.getLostItemSummary(hotelId);
    assert.deepEqual([summary.open, summary.matched, summary.expired], [3, 0, 1]);

    const { updatedAt } = await service.getLostItemSettings(hotelId);
    await desk(() => service.updateLostItemSettings(hotelId, { retentionDays: 30, valuableRetentionDays: 60, expectedUpdatedAt: new Date(updatedAt) }));
    // Eski sürümle ikinci kayıt reddedilir (ilkini sessizce ezmez).
    await assert.rejects(
      desk(() => service.updateLostItemSettings(hotelId, { retentionDays: 45, valuableRetentionDays: 90, expectedUpdatedAt: new Date(updatedAt) })),
      (error) => error.code === 'STALE_WRITE',
    );
    summary = await service.getLostItemSummary(hotelId);
    assert.equal(summary.expired, 2);
    const event = await db.eventLog.findFirst({ where: { hotelId, name: 'lost_items.settings.changed' } });
    assert.ok(event);
  });

  /* ─────────────── Eşleştirme ─────────────── */

  it('adaylar: odadaki, sabah çıkan (refakatçisiyle), odadan taşınan; eski çıkan ve eşyadan sonra gelen yok', async () => {
    // Eşyanın bulunduğu gün: dün (B). 101'in geçmişi: taşınan misafir B-6..B-3 (sonra 103'e),
    // sabah çıkan B-3..B (07:30'da çıktı), yeni gelen B'de 16:00'da girdi; eski misafir 15 gün önce.
    const B = -1;
    const morning = await seedStay({ guest: await seedGuest('Sabah', 'Çıkan'), status: 'CHECKED_OUT', checkInOffset: B - 3, checkOutOffset: B, checkedOutAt: at('07:30', B) });
    const companion = await seedGuest('Refakatçi', 'Kişi');
    await db.reservationGuest.createMany({
      data: [
        { hotelId, reservationId: morning.id, guestId: morning.guestId, isPrimary: true },
        { hotelId, reservationId: morning.id, guestId: companion.id, isPrimary: false },
      ],
    });
    const newcomer = await seedStay({ guest: await seedGuest('Yeni', 'Gelen'), checkInOffset: B, checkOutOffset: B + 3, checkedInAt: at('16:00', B) });
    const moved = await seedStay({ guest: await seedGuest('Taşınan', 'Misafir'), roomNumber: '103', checkInOffset: B - 6, checkOutOffset: B + 3, roomSince: new Date(day(B - 3)) });
    await db.roomStaySegment.create({
      data: { hotelId, reservationId: moved.id, roomId: room['101'].id, startDate: new Date(day(B - 6)), endDate: new Date(day(B - 3)), movedBy: DESK, createdAt: at('11:00', B - 3) },
    });
    await seedStay({ guest: await seedGuest('Eski', 'Misafir'), status: 'CHECKED_OUT', checkInOffset: B - 20, checkOutOffset: B - 15, checkedOutAt: at('10:00', B - 15) });

    // Temizlikte (yeni misafir gelmeden) bulundu: sabah çıkan en üstte, taşınan sonra; yeni gelen aday değil.
    const cleaning = (await record({ foundAt: at('10:30', B) })).item;
    const result = await desk(() => service.getMatchCandidates(hotelId, cleaning.id));
    assert.equal(result.roomNumber, '101');
    assert.deepEqual(
      result.candidates.map((candidate) => [candidate.reservationId, candidate.relation]),
      [
        [morning.id, 'DEPARTED'],
        [moved.id, 'DEPARTED'],
      ],
    );
    assert.deepEqual(result.candidates[0].guests.map((guest) => [guest.name, guest.isPrimary]), [
      ['Sabah Çıkan', true],
      ['Refakatçi Kişi', false],
    ]);
    assert.equal(result.candidates[1].currentRoomNumber, '103');

    // Akşam (yeni misafir içerideyken) bulundu: odadaki misafir en üstte.
    const evening = (await record({ foundAt: at('20:00', B) })).item;
    const later = await desk(() => service.getMatchCandidates(hotelId, evening.id));
    assert.deepEqual(
      later.candidates.map((candidate) => [candidate.reservationId, candidate.relation]),
      [
        [newcomer.id, 'IN_ROOM'],
        [morning.id, 'DEPARTED'],
        [moved.id, 'DEPARTED'],
      ],
    );

    // Ortak alanda bulunan eşyada aday yok (misafir araması).
    const lobby = (await record({ roomId: null, locationText: 'Lobi' })).item;
    assert.deepEqual((await service.getMatchCandidates(hotelId, lobby.id)).candidates, []);
  });

  it('eşleştirme: misafir konaklamada olmalı, eski ekrandan yazılamaz; eşleşme kaldırılabilir (not düşer)', async () => {
    const stay = await seedStay();
    const stranger = await seedGuest('Yabancı', 'Kişi');
    const { item } = await record();
    const stamp = new Date(item.updatedAt);

    await rejectsWith(
      desk(() => service.matchLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, guestId: stranger.id, reservationId: stay.id })),
      'VALIDATION',
      /bu konaklamada kalmıyor/,
    );
    const matched = await desk(() => service.matchLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, guestId: stay.guestId, reservationId: stay.id }));
    assert.equal(matched.status, 'MATCHED');
    assert.equal(matched.guest.name, 'Ayşe Kaya');
    assert.equal(matched.guest.phone, '+905321112233');
    assert.equal(matched.stay.id, stay.id);
    assert.equal(matched.matchedBy, DESK);

    await rejectsWith(desk(() => service.matchLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, guestId: stranger.id })), 'STALE_WRITE');

    // Teslim yetkisi olmayan (kat) misafirin telefonunu görmez.
    const hidden = await service.getLostItem(hotelId, item.id, { includeContact: false });
    assert.equal(hidden.guest.name, 'Ayşe Kaya');
    assert.equal('phone' in hidden.guest, false);

    // Aramada eşleşen misafirin adıyla bulunur.
    const found = await service.listLostItems(hotelId, { view: 'MATCHED', search: 'kaya', page: 1, pageSize: 25 }, { includeContact: false });
    assert.deepEqual(found.items.map((row) => row.id), [item.id]);

    const unmatched = await desk(() => service.unmatchLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(matched.updatedAt), reason: 'Misafir kendisinin olmadığını söyledi' }));
    assert.equal(unmatched.status, 'STORED');
    assert.equal(unmatched.guest, null);
    assert.match(unmatched.notes[0].text, /Eşleşme kaldırıldı \(Ayşe Kaya\): Misafir kendisinin olmadığını söyledi/);
    await rejectsWith(
      desk(() => service.unmatchLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(unmatched.updatedAt), reason: 'tekrar' })),
      'LOST_ITEM_RULE',
    );
  });

  /* ─────────────── Teslim ve kapatma ─────────────── */

  it('değerli eşya elden kimlik görülmeden verilmez; teslimden sonra kayıt kapanır, not yazılabilir', async () => {
    const stay = await seedStay();
    const { item } = await record({ valuable: true });
    const matched = await desk(() => service.matchLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(item.updatedAt), guestId: stay.guestId, reservationId: stay.id }));
    const stamp = new Date(matched.updatedAt);
    await rejectsWith(
      desk(() => service.returnLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, method: 'IN_PERSON', receiverName: 'Ayşe Kaya', receiverIdChecked: false })),
      'VALIDATION',
      /kimliği/,
    );
    const returned = await desk(() =>
      service.returnLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, method: 'IN_PERSON', receiverName: 'Ayşe Kaya', receiverIdChecked: true, note: 'Lobide' }),
    );
    assert.equal(returned.status, 'RETURNED');
    assert.equal(returned.returned.receiverIdChecked, true);
    assert.equal(returned.closedBy, DESK);
    assert.ok(returned.closedAt);

    await rejectsWith(
      kat(() => service.updateLostItem(hotelId, item.id, { ...item, roomId: item.roomId, expectedUpdatedAt: new Date(returned.updatedAt), foundAt: new Date(item.foundAt) })),
      'LOST_ITEM_RULE',
      /teslim edilmiş/,
    );
    await desk(() => service.addContactNote(hotelId, item.id, { channel: 'PHONE', text: 'Misafir aradı, teşekkür etti' }));
    const detail = await service.getLostItem(hotelId, item.id, { includeContact: true });
    assert.equal(detail.notes[0].text, 'Misafir aradı, teşekkür etti');
  });

  it('kargo: adres yalnızca teslim yetkisine görünür; teslim alan eşleşen misafir', async () => {
    const stay = await seedStay();
    const { item } = await record();
    const matched = await desk(() => service.matchLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(item.updatedAt), guestId: stay.guestId, reservationId: stay.id }));
    await desk(() =>
      service.returnLostItem(hotelId, item.id, {
        expectedUpdatedAt: new Date(matched.updatedAt),
        method: 'SHIPPED',
        receiverName: null,
        receiverIdChecked: false,
        carrier: 'Yurtiçi Kargo',
        trackingNumber: 'YK123456',
        shippingAddress: 'Atatürk Cad. No: 5, Çankaya / Ankara',
        shippingCost: '120.5',
        shippingPayer: 'GUEST',
      }),
    );
    const full = await service.getLostItem(hotelId, item.id, { includeContact: true });
    assert.equal(full.returned.receiverName, 'Ayşe Kaya');
    assert.equal(full.returned.shippingCost, '120.50');
    assert.equal(full.returned.shippingAddress, 'Atatürk Cad. No: 5, Çankaya / Ankara');
    const limited = await service.getLostItem(hotelId, item.id, { includeContact: false });
    assert.equal('shippingAddress' in limited.returned, false);
    assert.equal(limited.returned.trackingNumber, 'YK123456');
  });

  it('aynı eşya aynı anda iki kişiye teslim edilemez', async () => {
    const { item } = await record();
    const stamp = new Date(item.updatedAt);
    const attempt = (name) => desk(() => service.returnLostItem(hotelId, item.id, { expectedUpdatedAt: stamp, method: 'IN_PERSON', receiverName: name, receiverIdChecked: true }));
    const results = await Promise.allSettled([attempt('Birinci Kişi'), attempt('İkinci Kişi')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected');
    assert.equal(failure.reason.code, 'STALE_WRITE');
    const audits = await db.auditLog.count({ where: { hotelId, entity: 'LostItem', entityId: item.id, action: 'UPDATE' } });
    assert.equal(audits, 1);
  });

  it('kapatma: gerekçeli; kapanmış eşya teslim edilemez', async () => {
    const { item } = await record();
    const disposed = await desk(() => service.disposeLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(item.updatedAt), method: 'DONATED', reason: 'Süre doldu, Kızılay' }));
    assert.equal(disposed.status, 'DISPOSED');
    assert.deepEqual(disposed.disposal, { method: 'DONATED', reason: 'Süre doldu, Kızılay' });
    await rejectsWith(
      desk(() => service.returnLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(disposed.updatedAt), method: 'IN_PERSON', receiverName: 'Biri', receiverIdChecked: true })),
      'LOST_ITEM_RULE',
      /kapatılmış/,
    );
    const list = await service.listLostItems(hotelId, { view: 'DISPOSED', page: 1, pageSize: 25 }, { includeContact: false });
    assert.deepEqual(list.items.map((row) => row.id), [item.id]);
  });

  /* ─────────────── Fotoğraflar ─────────────── */

  it('fotoğraf diske yazılır, yalnızca kendi eşyasından okunur; sınır aşılınca dosya kalmaz; silinince dosya gider', async () => {
    const { item } = await record();
    const other = (await record({ description: 'Başka eşya' })).item;
    const first = await kat(() => photos.addPhoto(hotelId, item.id, PHOTO));
    assert.equal(first.contentType, 'image/jpeg');
    assert.deepEqual(await hotelFiles(), [`${first.id}.jpg`, `${first.id}.thumb.jpg`].sort());

    const opened = await photos.openPhoto(hotelId, item.id, first.id, 'thumb');
    assert.equal(opened.size, JPEG.length);
    opened.stream.destroy();
    await rejectsWith(photos.openPhoto(hotelId, other.id, first.id, 'full'), 'NOT_FOUND');
    await rejectsWith(photos.openPhoto(otherHotelId, item.id, first.id, 'full'), 'NOT_FOUND');

    for (let index = 1; index < contracts.LOST_ITEM_MAX_PHOTOS; index += 1) await kat(() => photos.addPhoto(hotelId, item.id, PHOTO));
    await rejectsWith(kat(() => photos.addPhoto(hotelId, item.id, PHOTO)), 'PHOTO_LIMIT');
    assert.equal((await hotelFiles()).length, contracts.LOST_ITEM_MAX_PHOTOS * 2);

    const detail = await service.getLostItem(hotelId, item.id, { includeContact: false });
    assert.equal(detail.photoCount, contracts.LOST_ITEM_MAX_PHOTOS);
    assert.equal(detail.coverPhotoId, first.id);
    const listed = await service.listLostItems(hotelId, { view: 'OPEN', page: 1, pageSize: 25 }, { includeContact: false });
    assert.equal(listed.items.find((row) => row.id === item.id).coverPhotoId, first.id);

    await kat(() => photos.removePhoto(hotelId, item.id, first.id, silentLogger));
    assert.equal((await hotelFiles()).includes(`${first.id}.jpg`), false);
    assert.equal(await db.lostItemPhoto.count({ where: { itemId: item.id } }), contracts.LOST_ITEM_MAX_PHOTOS - 1);

    await rejectsWith(kat(() => photos.addPhoto(hotelId, item.id, { ...PHOTO, image: Buffer.from('<svg/>').toString('base64') })), 'VALIDATION');
  });

  it('kapanmış eşyaya fotoğraf eklenmez (yazılan dosya geri silinir)', async () => {
    const { item } = await record();
    await desk(() => service.disposeLostItem(hotelId, item.id, { expectedUpdatedAt: new Date(item.updatedAt), method: 'RECORD_ERROR', reason: 'Yanlış açıldı' }));
    await rejectsWith(kat(() => photos.addPhoto(hotelId, item.id, PHOTO)), 'LOST_ITEM_RULE');
    assert.deepEqual(await hotelFiles(), []);
  });

  it('kapanıştan 30 gün sonra fotoğraflar silinir (dosyalar dahil); açık ve yeni kapanan eşyaya dokunulmaz', async () => {
    const old = (await record({ description: 'Eski kapanan' })).item;
    const recent = (await record({ description: 'Yeni kapanan' })).item;
    const open = (await record({ description: 'Açık' })).item;
    const photoOld = await kat(() => photos.addPhoto(hotelId, old.id, PHOTO));
    const photoRecent = await kat(() => photos.addPhoto(hotelId, recent.id, PHOTO));
    const photoOpen = await kat(() => photos.addPhoto(hotelId, open.id, PHOTO));
    for (const target of [old, recent]) {
      const fresh = await service.getLostItem(hotelId, target.id, { includeContact: false });
      await desk(() => service.returnLostItem(hotelId, target.id, { expectedUpdatedAt: new Date(fresh.updatedAt), method: 'IN_PERSON', receiverName: 'Sahibi', receiverIdChecked: true }));
    }
    await db.lostItem.update({ where: { id: old.id }, data: { closedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } });

    const purged = await photos.purgeClosedItemPhotos(silentLogger);
    assert.deepEqual(purged, { items: 1, photos: 1 });
    const files = await hotelFiles();
    assert.equal(files.includes(`${photoOld.id}.jpg`), false);
    assert.equal(files.includes(`${photoRecent.id}.jpg`), true);
    assert.equal(files.includes(`${photoOpen.id}.jpg`), true);
    const oldRow = await db.lostItem.findUnique({ where: { id: old.id } });
    assert.ok(oldRow.photosPurgedAt);
    const audit = await db.auditLog.findFirst({ where: { entityId: old.id, actor: 'sistem:kayip-esya' } });
    assert.match(audit.after.reason, /30 gün/);

    // İkinci tur boş (kısmi index'teki koşul: silinmişler yeniden taranmaz).
    assert.deepEqual(await photos.purgeClosedItemPhotos(silentLogger), { items: 0, photos: 0 });
  });

  /* ─────────────── Çıkış penceresi ─────────────── */

  it('çıkış penceresi: misafire eşleşmiş eşyayı ve odasında bulunup eşleşmemiş eşyayı gösterir', async () => {
    const stay = await seedStay({ checkOutOffset: 0 });
    const mine = (await record({ description: 'Gözlük', category: 'ACCESSORY' })).item;
    await desk(() => service.matchLostItem(hotelId, mine.id, { expectedUpdatedAt: new Date(mine.updatedAt), guestId: stay.guestId, reservationId: stay.id }));
    const unknown = (await record({ description: 'Şarj aleti', category: 'ELECTRONICS' })).item;
    await record({ description: 'Başka odadaki', roomId: room['102'].id });

    const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00') });
    assert.deepEqual(preview.lostItems.matched.map((row) => row.id), [mine.id]);
    assert.deepEqual(preview.lostItems.foundInRoom.map((row) => row.id), [unknown.id]);
  });
});
