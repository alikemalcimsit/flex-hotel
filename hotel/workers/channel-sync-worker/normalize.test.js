import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvalidChannelBookingError, icalRevisionId, normalizeChannexRevision, normalizeIcalEvent } from './normalize.js';

/**
 * Kanaldan gelen rezervasyonun ortak biçime çevrilmesi. Yanlışsa misafir
 * yanlış gecede, yanlış tutarla ya da hiç açılmaz; kart bilgisi sızarsa PCI ihlali.
 */

const revision = (overrides = {}) => ({
  id: 'REV-1',
  booking_id: 'BOOK-1',
  status: 'new',
  ota_name: 'Booking.com',
  ota_reservation_code: '1234567890',
  inserted_at: '2027-05-20T10:00:00',
  arrival_date: '2027-06-01',
  departure_date: '2027-06-03',
  amount: '180.00',
  currency: 'eur',
  notes: 'Geç varış',
  payment_collect: 'ota',
  customer: { name: 'Jane', surname: 'Doe', mail: 'jane@example.com', phone: '5550100', country: 'nl' },
  guarantee: { card_number: '411111******1111', cvv: '***' },
  rooms: [
    {
      room_type_id: 'RT1',
      rate_plan_id: 'RP1',
      checkin_date: '2027-06-01',
      checkout_date: '2027-06-03',
      amount: '180',
      occupancy: { adults: 2, children: 1, infants: 0 },
    },
  ],
  ...overrides,
});

describe('Channex revizyonu', () => {
  it('ortak biçime çevrilir; kart bilgisi hiç kopyalanmaz', () => {
    const booking = normalizeChannexRevision(revision());
    assert.equal(booking.kind, 'NEW');
    assert.equal(booking.status, 'ACTIVE');
    assert.equal(booking.externalBookingId, 'BOOK-1');
    assert.equal(booking.externalRevisionId, 'REV-1');
    assert.equal(booking.occurredAt, '2027-05-20T10:00:00.000Z', 'saat dilimsiz damga UTC');
    assert.equal(booking.currency, 'EUR');
    assert.equal(booking.amount, '180.00');
    assert.equal(booking.paymentCollect, 'OTA');
    assert.deepEqual(booking.guest, { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '5550100', country: 'NL' });
    assert.deepEqual(booking.rooms[0], {
      externalRoomTypeId: 'RT1',
      externalRatePlanId: 'RP1',
      roomMappingId: null,
      checkIn: '2027-06-01',
      checkOut: '2027-06-03',
      adults: 2,
      children: 1,
      amount: '180.00',
    });
    assert.ok(!JSON.stringify(booking).includes('411111'), 'kart numarası saklanmaz');
  });

  it('değişiklik ve iptal; iptalde oda listesi boş olabilir', () => {
    assert.equal(normalizeChannexRevision(revision({ status: 'modified' })).kind, 'MODIFIED');
    const cancelled = normalizeChannexRevision(revision({ status: 'cancelled', rooms: [] }));
    assert.equal(cancelled.kind, 'CANCELLED');
    assert.equal(cancelled.status, 'CANCELLED');
  });

  it('oda tarihi yoksa rezervasyonun tarihi; tutar bozuksa bilinmiyor (null)', () => {
    const booking = normalizeChannexRevision(
      revision({ rooms: [{ room_type_id: 'RT1', rate_plan_id: 'RP1', amount: 'yüz', occupancy: { adults: 0 } }] }),
    );
    assert.equal(booking.rooms[0].checkIn, '2027-06-01');
    assert.equal(booking.rooms[0].checkOut, '2027-06-03');
    assert.equal(booking.rooms[0].amount, null);
    assert.equal(booking.rooms[0].adults, 1, 'en az bir yetişkin');
  });

  it('bozuk revizyon reddedilir (kimliksiz, bilinmeyen durum, odasız yeni, ters tarih)', () => {
    assert.throws(() => normalizeChannexRevision(revision({ booking_id: null })), InvalidChannelBookingError);
    assert.throws(() => normalizeChannexRevision(revision({ status: 'tentative' })), /Bilinmeyen revizyon durumu/);
    assert.throws(() => normalizeChannexRevision(revision({ rooms: [] })), /oda yok/);
    assert.throws(
      () => normalizeChannexRevision(revision({ rooms: [{ checkin_date: '2027-06-03', checkout_date: '2027-06-01' }] })),
      /tarihleri geçersiz/,
    );
  });
});

describe('iCal kaydı', () => {
  const event = { uid: 'abc@airbnb.com', start: '2027-06-01', end: '2027-06-04', description: 'https://www.airbnb.com/hosting/reservations/details/HMZZ1234' };

  it('misafir "Airbnb misafiri", fiyat bilinmiyor, oda eşleşmesi kayıtta', () => {
    const booking = normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'NEW', now: new Date('2027-05-01T00:00:00Z') });
    assert.equal(booking.source, 'ICAL');
    assert.equal(booking.externalBookingId, 'M1:abc@airbnb.com');
    assert.equal(booking.externalCode, 'HMZZ1234');
    assert.deepEqual([booking.guest.firstName, booking.guest.lastName], ['Airbnb', 'misafiri HMZZ1234']);
    assert.equal(booking.priceKnown, false);
    assert.equal(booking.rooms[0].roomMappingId, 'M1');
    assert.deepEqual([booking.rooms[0].checkIn, booking.rooms[0].checkOut], ['2027-06-01', '2027-06-04']);
  });

  it('revizyon kimliği hâle bağlı: aynı hâl aynı kimlik, tarih ya da iptal yeni kimlik', () => {
    const same = normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'NEW' }).externalRevisionId;
    assert.equal(normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'MODIFIED' }).externalRevisionId, same);
    assert.notEqual(normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event: { ...event, end: '2027-06-05' }, kind: 'MODIFIED' }).externalRevisionId, same);
    assert.notEqual(normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'CANCELLED' }).externalRevisionId, same);
    assert.match(icalRevisionId(['a']), /^ical-[0-9a-f]{40}$/);
    // İptalden sonra aynı tarihlerle yeniden görünen kayıt: önceki revizyon farklı → yeni revizyon.
    const again = normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'NEW', previousRevisionId: 'ical-iptal' }).externalRevisionId;
    assert.notEqual(again, same);
    assert.equal(normalizeIcalEvent({ mappingId: 'M1', provider: 'AIRBNB', event, kind: 'NEW', previousRevisionId: 'ical-iptal' }).externalRevisionId, again);
  });
});
