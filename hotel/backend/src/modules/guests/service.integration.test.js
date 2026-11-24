import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * CRM & misafir kartı (modül 22) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: kart özeti (konaklama sayısı, toplam harcama, son konaklama),
 * tercih ve not ekleme, etiket düzenleme, ve en kritiği `mergeGuests`:
 * kaynağın bütün bağlı kayıtlarını hedefe taşıyıp kartları birleştirmesi.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const DESK = 'resepsiyon@test.local';

describe('CRM / misafir kartı (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let crm;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let roomTypeId;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    crm = await import('./service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    const hotel = await db.hotel.create({ data: { name: 'CRM Otel', code: `C${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' } });
    hotelId = hotel.id;
    await db.user.create({ data: { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' } });
    roomTypeId = (await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2 } })).id;
  });

  async function seedGuest({ firstName = 'Mehmet', lastName = 'Kaya', phone = null, email = null, tags = [] } = {}) {
    return db.guest.create({ data: { hotelId, firstName, lastName, phone, email, idType: 'NATIONAL_ID', idNumber: `${Math.floor(Math.random() * 1e10)}`, nationality: 'TR', tags } });
  }

  /** Tamamlanmış konaklama + folyo (borç). */
  async function seedStay(guestId, { nightly = '1000.00', nights = 2, status = 'CHECKED_OUT', offset = -5 } = {}) {
    const stay = await db.reservation.create({
      data: {
        hotelId, guestId, roomTypeId, checkIn: new Date(day(offset)), checkOut: new Date(day(offset + nights)), status,
        // CHECKED_OUT kaydı giriş ve çıkış zamanı ister (Reservation_stay_times_valid).
        checkedInAt: new Date(`${day(offset)}T15:00:00.000Z`), checkedInBy: DESK,
        checkedOutAt: new Date(`${day(offset + nights)}T11:00:00.000Z`), checkedOutBy: DESK,
        confirmedAt: new Date(`${day(offset)}T10:00:00.000Z`),
        totalPrice: core.toMoneyString(core.toDecimal(nightly).times(nights)), confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    const charges = core.toMoneyString(core.toDecimal(nightly).times(nights));
    // OPEN folyo (CLOSED closedAt ister); summarize TRANSFERRED dışını sayar.
    // Folio_balance_consistent: balance = chargesTotal − paymentsTotal.
    await db.folio.create({ data: { hotelId, reservationId: stay.id, guestId, chargesTotal: charges, balance: charges } });
    return stay;
  }

  it('kart özeti: konaklama sayısı, toplam harcama, son konaklama', async () => {
    const guest = await seedGuest();
    await seedStay(guest.id, { nightly: '1000.00', nights: 2, offset: -10 });
    await seedStay(guest.id, { nightly: '1500.00', nights: 1, offset: -3 });

    const card = await crm.getGuestCard(hotelId, guest.id);
    assert.equal(card.summary.stayCount, 2);
    assert.equal(card.summary.totalSpend, '3500.00');
    assert.equal(card.summary.lastStay.checkIn, `${day(-3)}T00:00:00.000Z`);
  });

  it('tercih ve not eklenir; etiket düzenlenir', async () => {
    const guest = await seedGuest();
    await as(DESK, () => crm.addPreference(hotelId, guest.id, { category: 'ALLERGY', value: 'GLUTEN', source: 'GUEST', confidence: 'HIGH' }));
    await as(DESK, () => crm.addPreference(hotelId, guest.id, { category: 'FLOOR', value: 'Üst kat, sessiz' }));
    await as(DESK, () => crm.addNote(hotelId, guest.id, { body: 'Köşe oda sever', pinned: true }));
    await as(DESK, () => crm.updateGuestCard(hotelId, guest.id, { tags: ['VIP', 'Sadık'] }));

    const card = await crm.getGuestCard(hotelId, guest.id);
    assert.equal(card.preferences.length, 2);
    assert.ok(card.preferences.some((p) => p.category === 'ALLERGY' && p.value === 'GLUTEN'));
    assert.equal(card.notes.length, 1);
    assert.equal(card.notes[0].pinned, true);
    assert.deepEqual(card.tags, ['VIP', 'Sadık']);
  });

  it('mergeGuests: kaynağın kayıtları hedefe taşınır, etiketler birleşir, kaynak silinir', async () => {
    const target = await seedGuest({ firstName: 'Mehmet', lastName: 'Kaya', phone: '+905551112233', tags: ['VIP'] });
    const source = await seedGuest({ firstName: 'Mehmet', lastName: 'Kaya', email: 'mehmet@example.com', tags: ['Sadık'] });
    const tStay = await seedStay(target.id, { offset: -10 });
    const sStay = await seedStay(source.id, { offset: -4 });
    await as(DESK, () => crm.addPreference(hotelId, source.id, { category: 'PILLOW', value: 'Sert yastık' }));
    await as(DESK, () => crm.addNote(hotelId, source.id, { body: 'Erken giriş istedi' }));

    const merged = await as(DESK, () =>
      crm.mergeGuests(hotelId, { sourceId: source.id, targetId: target.id, keep: { firstName: 'Mehmet', lastName: 'Kaya', phone: '+905551112233', email: 'mehmet@example.com' } }),
    );

    // Hedef: iki konaklama, birleşmiş etiket, kaynaktan taşınan tercih+not.
    assert.equal(merged.summary.stayCount, 2);
    assert.deepEqual(merged.tags.sort(), ['Sadık', 'VIP']);
    assert.equal(merged.email, 'mehmet@example.com');
    assert.ok(merged.preferences.some((p) => p.value === 'Sert yastık'));
    assert.ok(merged.notes.some((n) => n.body === 'Erken giriş istedi'));

    // Kaynağın rezervasyonu ve folyosu hedefe taşındı.
    assert.equal((await db.reservation.findUnique({ where: { id: sStay.id } })).guestId, target.id);
    assert.equal((await db.folio.findFirst({ where: { reservationId: sStay.id } })).guestId, target.id);
    // Kaynak kart silindi.
    assert.ok((await db.guest.findUnique({ where: { id: source.id } })).deletedAt);
    // Hedefin kendi kaydı duruyor.
    assert.equal((await db.reservation.findUnique({ where: { id: tStay.id } })).guestId, target.id);
  });

  it('bir kaydı kendisiyle birleştiremez', async () => {
    const guest = await seedGuest();
    await assert.rejects(as(DESK, () => crm.mergeGuests(hotelId, { sourceId: guest.id, targetId: guest.id })), (e) => e.code === 'VALIDATION');
  });

  it('liste araması ada göre kartı özetiyle döndürür', async () => {
    const guest = await seedGuest({ firstName: 'Ayşe', lastName: 'Yılmaz' });
    await seedStay(guest.id, { nightly: '2000.00', nights: 1 });
    const result = await crm.listGuests(hotelId, { q: 'Ayşe Yılmaz' });
    assert.ok(result.items.some((g) => g.id === guest.id && g.totalSpend === '2000.00'));
  });
});
