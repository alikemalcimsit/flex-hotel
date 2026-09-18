import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupReservationSchema,
  quoteQuerySchema,
  reservationInputSchema,
  updateReservationSchema,
} from './reservations.js';

const UID = '11111111-1111-4111-8111-111111111111';

describe('reservationInputSchema', () => {
  it('geçerli girdiyi kabul eder, çocuk/pansiyon varsayılanları uygular', () => {
    const result = reservationInputSchema.parse({
      guest: { name: 'Ali Veli' },
      roomTypeId: UID,
      checkIn: '2027-05-01',
      checkOut: '2027-05-04',
      adults: 2,
    });
    assert.equal(result.children, 0);
    assert.equal(result.boardType, 'BB');
  });

  it('misafir seçilmemiş ve ad girilmemişse reddeder', () => {
    const result = reservationInputSchema.safeParse({ guest: {}, roomTypeId: UID, checkIn: '2027-05-01', checkOut: '2027-05-04', adults: 2 });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path.join('.') === 'guest.name'));
  });

  it('çıkış girişten önceyse reddeder', () => {
    const result = reservationInputSchema.safeParse({ guest: { name: 'X' }, roomTypeId: UID, checkIn: '2027-05-04', checkOut: '2027-05-01', adults: 2 });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path.join('.') === 'checkOut'));
  });
});

describe('updateReservationSchema', () => {
  it('expectedUpdatedAt olmadan reddedilir', () => {
    const result = updateReservationSchema.safeParse({ roomTypeId: UID, checkIn: '2027-05-01', checkOut: '2027-05-04', adults: 2, boardType: 'BB' });
    assert.equal(result.success, false);
  });
});

describe('quoteQuerySchema', () => {
  it('en az bir gece ister', () => {
    assert.equal(quoteQuerySchema.safeParse({ roomTypeId: UID, checkIn: '2027-05-01', checkOut: '2027-05-01' }).success, false);
    assert.equal(quoteQuerySchema.safeParse({ roomTypeId: UID, checkIn: '2027-05-01', checkOut: '2027-05-02' }).success, true);
  });
});

describe('groupReservationSchema', () => {
  it('en az bir oda satırı ister', () => {
    assert.equal(groupReservationSchema.safeParse({ guest: { name: 'G' }, rooms: [] }).success, false);
  });
  it('geçerli grup kabul edilir', () => {
    const result = groupReservationSchema.safeParse({
      guest: { name: 'G' },
      rooms: [{ roomTypeId: UID, checkIn: '2027-05-01', checkOut: '2027-05-03', adults: 2 }],
    });
    assert.equal(result.success, true);
  });
});
