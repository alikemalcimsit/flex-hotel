import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Satış CRM (modül 36) entegrasyon testleri: fırsat yaşam döngüsü, arama
 * kaydı + takip, teklif (fiyat ANINDA kilitlenir — sonradan zam sözü bozmaz),
 * kabul → rezervasyon (idempotent) + fırsat WON, süpürme (süre doldurma + zil).
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Satış CRM (modül 36)', { skip }, () => {
  let db;
  let core;
  let cache;
  let sales;
  let resetDatabase;
  let hotelId;
  let types;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    sales = await import('./service.js');
    (await import('../reservations/service.js')).clearReservationCache();
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'satis@hotel.local' }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.clear();
    const hotel = await db.hotel.create({
      data: { name: 'Satış Otel', code: `S${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    types = {
      std: await db.roomType.create({
        data: { hotelId, code: 'STD', name: 'STD oda', basePrice: '1000', capacityAdults: 3, capacityChildren: 2 },
      }),
    };
    await db.room.create({ data: { hotelId, number: '101', roomTypeId: types.std.id } });
    await db.room.create({ data: { hotelId, number: '102', roomTypeId: types.std.id } });
  });

  const leadInput = (overrides = {}) => ({
    name: 'Mehmet Deniz',
    company: 'Deniz Turizm',
    phone: '+905321110022',
    email: null,
    source: 'PHONE',
    guestId: null,
    checkIn: new Date(day(10)),
    checkOut: new Date(day(12)),
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    notes: 'Deniz manzarası istiyor',
    followUpAt: null,
    ...overrides,
  });

  const quoteInput = (overrides = {}) => ({
    checkIn: new Date(day(10)),
    checkOut: new Date(day(12)),
    roomTypeId: types.std.id,
    boardType: 'BB',
    adults: 2,
    children: 0,
    validUntil: new Date(day(5)),
    notes: null,
    ...overrides,
  });

  describe('fırsat yaşam döngüsü', () => {
    it('açılır, listelenir, pano özetine düşer; WON elle verilemez, LOST sebep ister', async () => {
      const lead = await as(() => sales.createLead(hotelId, leadInput()));
      assert.equal(lead.status, 'NEW');

      const list = await sales.listLeads(hotelId, { page: 1, pageSize: 20, search: 'Deniz' });
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].company, 'Deniz Turizm');

      const summary = await sales.getSalesSummary(hotelId);
      assert.equal(summary.byStatus.NEW, 1);

      await assert.rejects(
        as(() => sales.setLeadStatus(hotelId, lead.id, { status: 'WON', lostReason: null, expectedUpdatedAt: lead.updatedAt })),
        /teklifi kabul/i,
      );

      const lost = await as(() =>
        sales.setLeadStatus(hotelId, lead.id, { status: 'LOST', lostReason: 'Rakip otel daha ucuz', expectedUpdatedAt: lead.updatedAt }),
      );
      assert.equal(lost.status, 'LOST');
      assert.equal(lost.lostReason, 'Rakip otel daha ucuz');
    });

    it('arama kaydı eklenir; "tekrar aranacak" takip tarihini günceller; dosyada görünür', async () => {
      const lead = await as(() => sales.createLead(hotelId, leadInput()));
      const call = await as(() =>
        sales.addCallLog(hotelId, lead.id, {
          channel: 'STAFF',
          direction: 'INBOUND',
          phone: '+905321110022',
          outcome: 'FOLLOW_UP',
          summary: 'Fiyatları eşiyle konuşacak; cuma günü aranmak istedi.',
          recordingRef: null,
          followUpAt: new Date(day(3)),
        }),
      );
      assert.equal(call.outcome, 'FOLLOW_UP');

      const file = await sales.getLead(hotelId, lead.id);
      assert.equal(file.calls.length, 1);
      assert.equal(file.followUpAt, day(3));

      const due = await sales.listLeads(hotelId, { page: 1, pageSize: 20, dueOnly: true });
      assert.equal(due.items.length, 0); // takip 3 gün sonra — bugün listede değil
    });
  });

  describe('teklif', () => {
    it('fiyat hazırlanırken kilitlenir: sonradan zam teklifi değiştirmez; kabulde rezervasyon teklif toplamıyla açılır', async () => {
      const lead = await as(() => sales.createLead(hotelId, leadInput()));
      const quote = await as(() => sales.createQuote(hotelId, lead.id, quoteInput()));
      assert.match(quote.code, /^TKF-/);
      assert.equal(quote.total, '2000.00'); // 2 gece × 1000
      assert.equal(quote.nights.length, 2);

      // Teklif sonrası ZAM: taban fiyat 1000 → 5000.
      await db.roomType.update({ where: { id: types.std.id }, data: { basePrice: '5000' } });
      cache.cache.clear();

      const sent = await as(() => sales.sendQuote(hotelId, quote.id, { expectedUpdatedAt: quote.updatedAt }));
      assert.equal(sent.status, 'SENT');
      assert.equal((await sales.getLead(hotelId, lead.id)).status, 'QUOTED');

      const accepted = await as(() => sales.acceptQuote(hotelId, quote.id, { expectedUpdatedAt: sent.updatedAt }));
      assert.equal(accepted.status, 'ACCEPTED');
      assert.ok(accepted.reservation.confirmationCode);

      const reservation = await db.reservation.findFirst({ where: { id: accepted.reservationId } });
      assert.equal(Number(reservation.totalPrice), 2000); // zam değil, teklif sözü
      assert.equal(reservation.priceMode, 'MANUAL');
      assert.equal(reservation.priceNote, `Teklif ${quote.code}`);
      assert.equal(reservation.status, 'CONFIRMED');

      const wonLead = await sales.getLead(hotelId, lead.id);
      assert.equal(wonLead.status, 'WON');
      assert.equal(wonLead.wonReservationId, accepted.reservationId);

      // Misafir kartı fırsattan açıldı (ad + telefon).
      const guest = await db.guest.findFirst({ where: { id: reservation.guestId } });
      assert.equal(guest.firstName, 'Mehmet');
      assert.equal(guest.lastName, 'Deniz');
    });

    it('taslak doğrudan kabul edilemez; gönderilen reddedilir; kapanmış fırsata teklif açılamaz', async () => {
      const lead = await as(() => sales.createLead(hotelId, leadInput()));
      const quote = await as(() => sales.createQuote(hotelId, lead.id, quoteInput()));

      await assert.rejects(as(() => sales.acceptQuote(hotelId, quote.id, { expectedUpdatedAt: quote.updatedAt })), /önce gönderilmeli/);

      const sent = await as(() => sales.sendQuote(hotelId, quote.id, { expectedUpdatedAt: quote.updatedAt }));
      const rejected = await as(() => sales.rejectQuote(hotelId, quote.id, { expectedUpdatedAt: sent.updatedAt, reason: 'Bütçeyi aştı' }));
      assert.equal(rejected.status, 'REJECTED');
      assert.equal(rejected.rejectReason, 'Bütçeyi aştı');

      const fresh = await sales.getLead(hotelId, lead.id);
      const lost = await as(() =>
        sales.setLeadStatus(hotelId, lead.id, { status: 'LOST', lostReason: 'Vazgeçti', expectedUpdatedAt: new Date(fresh.updatedAt) }),
      );
      await assert.rejects(as(() => sales.createQuote(hotelId, lost.id, quoteInput())), /Kapanmış fırsata/);
    });
  });

  describe('süpürme (iş)', () => {
    it('geçerliliği geçen gönderilmiş teklif süresi doldu olur; takip zili tek birleşik uyarı çalar', async () => {
      const lead = await as(() => sales.createLead(hotelId, leadInput({ followUpAt: new Date(day(0)) })));
      const quote = await as(() => sales.createQuote(hotelId, lead.id, quoteInput({ validUntil: new Date(day(1)) })));
      await as(() => sales.sendQuote(hotelId, quote.id, { expectedUpdatedAt: quote.updatedAt }));
      // Geçerliliği düne çek (süpürme yakalasın).
      await db.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(day(-1)) } });

      const alerts = [];
      const fakeAlert = async (_tx, _stage, alert) => alerts.push(alert);
      const result = await as(() => sales.sweepSales(hotelId, { raiseStaffAlert: fakeAlert }));

      assert.equal(result.expired, 1);
      assert.equal(result.due, 1);
      assert.equal((await db.quote.findFirst({ where: { id: quote.id } })).status, 'EXPIRED');
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].kind, 'SALES_FOLLOW_UP');
      assert.equal(alerts[0].permission, 'sales.manage');
      assert.match(alerts[0].title, /1 satış fırsatı/);

      // İkinci süpürme: süresi dolacak teklif kalmadı; zil dedupeKey aynı (gün).
      const second = await as(() => sales.sweepSales(hotelId, { raiseStaffAlert: fakeAlert }));
      assert.equal(second.expired, 0);
      assert.equal(alerts[1].dedupeKey, alerts[0].dedupeKey);
    });
  });
});
