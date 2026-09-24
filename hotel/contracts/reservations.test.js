import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowedReservationActions,
  createGroupReservationSchema,
  createReservationSchema,
  createWaitlistSchema,
  guestInputSchema,
  reservationActionError,
  reservationListQuerySchema,
  stayNights,
  updateReservationSchema,
} from './reservations.js';

/**
 * Rezervasyon sözleşmeleri (modül 4): durum işlemlerinin kuralı ekran ve
 * sunucuda aynıdır; şemalar bozuk girdiyi anlaşılır mesajla reddeder.
 */

const TODAY = '2026-10-10';
const stay = (status, checkIn = '2026-10-12', checkOut = '2026-10-15') => ({ status, checkIn, checkOut });

describe('reservationActionError / allowedReservationActions', () => {
  it('opsiyonlu ve gelecek: düzenle, onayla, iptal; gelmedi yok', () => {
    assert.deepEqual(allowedReservationActions(stay('PENDING'), TODAY).sort(), ['cancel', 'confirm', 'edit'].sort());
    assert.match(reservationActionError('noShow', stay('PENDING'), TODAY), /Giriş günü gelmeden/);
  });

  it('onaylı ve giriş günü: giriş yapılır, gelmedi işaretlenebilir; onaylanmaz', () => {
    const arriving = stay('CONFIRMED', TODAY, '2026-10-12');
    assert.deepEqual(allowedReservationActions(arriving, TODAY).sort(), ['cancel', 'checkIn', 'edit', 'noShow'].sort());
    assert.match(reservationActionError('confirm', arriving, TODAY), /Yalnızca opsiyonlu/);
  });

  it('içerideki misafir: düzenleme ve çıkış (iptal değil)', () => {
    assert.deepEqual(allowedReservationActions(stay('CHECKED_IN', '2026-10-08', '2026-10-12'), TODAY).sort(), ['checkOut', 'edit']);
    assert.match(reservationActionError('cancel', stay('CHECKED_IN'), TODAY), /çıkış işlemi/);
  });

  it('iptal / gelmedi: tarihi geçmemişse geri alınır; geçmişse alınmaz', () => {
    assert.deepEqual(allowedReservationActions(stay('CANCELLED'), TODAY), ['reinstate']);
    assert.deepEqual(allowedReservationActions(stay('NO_SHOW', '2026-10-09', '2026-10-11'), TODAY), ['reinstate']);
    assert.deepEqual(allowedReservationActions(stay('NO_SHOW', '2026-10-08', TODAY), TODAY), []);
  });

  it('çıkış yapmış: hiçbir işlem', () => {
    assert.deepEqual(allowedReservationActions(stay('CHECKED_OUT', '2026-10-01', '2026-10-05'), TODAY), []);
  });

  it('giriş: gelecek tarihliye yapılmaz (önce tarih öne çekilir); geç gelen ertesi gün girebilir; bitmiş konaklamaya yapılmaz', () => {
    assert.match(reservationActionError('checkIn', stay('CONFIRMED'), TODAY), /Giriş günü gelmedi/);
    assert.equal(reservationActionError('checkIn', stay('PENDING', '2026-10-09', '2026-10-12'), TODAY), null);
    assert.match(reservationActionError('checkIn', stay('CONFIRMED', '2026-10-08', TODAY), TODAY), /tarihleri geçmiş/);
    assert.match(reservationActionError('checkIn', stay('CHECKED_IN'), TODAY), /zaten giriş/);
    assert.match(reservationActionError('checkIn', stay('CANCELLED', TODAY, '2026-10-12'), TODAY), /gelmesi beklenen/);
  });

  it('çıkış yalnızca içerideki misafire', () => {
    assert.equal(reservationActionError('checkOut', stay('CHECKED_IN', '2026-10-08', '2026-10-09'), TODAY), null);
    assert.match(reservationActionError('checkOut', stay('CONFIRMED', TODAY, '2026-10-12'), TODAY), /içerideki misafir/);
  });

  it('tarih Date ya da metin olarak gelebilir', () => {
    assert.equal(reservationActionError('noShow', { status: 'CONFIRMED', checkIn: new Date('2026-10-10T00:00:00Z'), checkOut: '2026-10-12' }, new Date('2026-10-10T00:00:00Z')), null);
  });
});

describe('stayNights', () => {
  it('yarı açık aralık; saatten etkilenmez', () => {
    assert.equal(stayNights('2026-10-10', '2026-10-13'), 3);
    assert.equal(stayNights('2026-10-10T00:00:00.000Z', new Date('2026-10-11T00:00:00.000Z')), 1);
  });
});

const base = {
  guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '0532 111 00 01' },
  roomTypeId: '11111111-1111-4111-8111-111111111111',
  adults: 2,
  boardType: 'BB',
  checkIn: '2026-10-10',
  checkOut: '2026-10-12',
  requestId: '22222222-2222-4222-8222-222222222222',
};

describe('createReservationSchema', () => {
  it('varsayılanlar: kesin, resepsiyon, 0 çocuk', () => {
    const parsed = createReservationSchema.parse(base);
    assert.equal(parsed.status, 'CONFIRMED');
    assert.equal(parsed.source, 'UI');
    assert.equal(parsed.children, 0);
    assert.equal(parsed.forceNewGuest, false);
    assert.ok(parsed.checkIn instanceof Date);
  });

  it('misafir: ya kart ya yeni bilgi; ikisi birden ya da hiçbiri olmaz', () => {
    assert.equal(createReservationSchema.safeParse({ ...base, guest: null }).success, false);
    assert.equal(
      createReservationSchema.safeParse({ ...base, guestId: '33333333-3333-4333-8333-333333333333' }).success,
      false,
    );
    assert.equal(createReservationSchema.safeParse({ ...base, guest: null, guestId: '33333333-3333-4333-8333-333333333333' }).success, true);
  });

  it('tarih sırası ve en uzun konaklama', () => {
    const reversed = createReservationSchema.safeParse({ ...base, checkOut: '2026-10-10' });
    assert.equal(reversed.success, false);
    assert.equal(reversed.error.issues[0].path.join('.'), 'checkOut');
    assert.equal(createReservationSchema.safeParse({ ...base, checkOut: '2027-10-12' }).success, false);
  });

  it('elle fiyat gerekçe ister; tutar biçimi denetlenir', () => {
    const noNote = createReservationSchema.safeParse({ ...base, manualTotal: '1500' });
    assert.equal(noNote.success, false);
    assert.equal(noNote.error.issues[0].path.join('.'), 'priceNote');
    assert.equal(createReservationSchema.parse({ ...base, manualTotal: '1500,5', priceNote: 'Anlaşma' }).manualTotal, '1500.5');
    assert.equal(createReservationSchema.safeParse({ ...base, manualTotal: '-5', priceNote: 'x' }).success, false);
    assert.equal(createReservationSchema.safeParse({ ...base, manualTotal: '999999999', priceNote: 'x' }).success, false);
  });

  it('kanal kaynağı elle seçilemez; istek kimliği zorunlu', () => {
    assert.equal(createReservationSchema.safeParse({ ...base, source: 'OTA' }).success, false);
    const { requestId, ...withoutId } = base;
    assert.ok(requestId);
    assert.equal(createReservationSchema.safeParse(withoutId).success, false);
  });
});

describe('guestInputSchema', () => {
  it('telefon ya da e-posta şart; biçimler temizlenir', () => {
    assert.equal(guestInputSchema.safeParse({ firstName: 'A', lastName: 'B' }).success, false);
    const parsed = guestInputSchema.parse({ firstName: ' Ayşe ', lastName: 'Yılmaz', email: ' AYSE@Example.COM ', nationality: 'tr', phone: '' });
    assert.equal(parsed.firstName, 'Ayşe');
    assert.equal(parsed.email, 'ayse@example.com');
    assert.equal(parsed.nationality, 'TR');
    assert.equal(parsed.phone, null);
    assert.equal(guestInputSchema.safeParse({ firstName: 'A', lastName: 'B', phone: '12' }).success, false);
    assert.equal(guestInputSchema.safeParse({ firstName: 'A', lastName: 'B', email: 'yok' }).success, false);
  });
});

describe('createGroupReservationSchema', () => {
  const group = {
    guest: base.guest,
    groupName: 'Demir Ailesi',
    checkIn: base.checkIn,
    checkOut: base.checkOut,
    requestId: base.requestId,
    lines: [{ roomTypeId: base.roomTypeId, adults: 2, boardType: 'HB', quantity: 2 }],
  };

  it('en az iki oda, en fazla 50 oda', () => {
    assert.equal(createGroupReservationSchema.safeParse(group).success, true);
    assert.equal(createGroupReservationSchema.safeParse({ ...group, lines: [{ ...group.lines[0], quantity: 1 }] }).success, false);
    assert.equal(
      createGroupReservationSchema.safeParse({ ...group, lines: [{ ...group.lines[0], quantity: 30 }, { ...group.lines[0], quantity: 30 }] }).success,
      false,
    );
  });
});

describe('updateReservationSchema', () => {
  it('elle fiyat toplam ve gerekçe ister; sistem fiyatı boş gövdeyle', () => {
    const version = new Date().toISOString();
    assert.equal(updateReservationSchema.safeParse({ expectedUpdatedAt: version, price: { mode: 'MANUAL', total: '100' } }).success, false);
    assert.equal(updateReservationSchema.safeParse({ expectedUpdatedAt: version, price: { mode: 'CALCULATED' } }).success, true);
    assert.equal(updateReservationSchema.safeParse({ checkOut: '2026-10-12' }).success, false, 'sürüm şart');
  });
});

describe('liste ve bekleme listesi şemaları', () => {
  it('liste: varsayılan görünüm, ters tarih aralığı reddi', () => {
    assert.equal(reservationListQuerySchema.parse({}).view, 'ALL');
    assert.equal(reservationListQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success, false);
  });

  it('bekleme listesi: iletişim bilgisi ya da kart şart', () => {
    const entry = { firstName: 'Deniz', lastName: 'Kara', roomTypeId: base.roomTypeId, adults: 1, boardType: 'BB', checkIn: base.checkIn, checkOut: base.checkOut };
    assert.equal(createWaitlistSchema.safeParse(entry).success, false);
    assert.equal(createWaitlistSchema.safeParse({ ...entry, phone: '0533 222 33 44' }).success, true);
  });
});
