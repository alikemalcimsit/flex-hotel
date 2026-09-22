import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quietHoursRelease } from '@hotelos/hotel-contracts';
import {
  failureAlertKey,
  guestOptedOut,
  manualTaskPermission,
  MANUAL_TASK_FALLBACK_PERMISSION,
  notificationDedupeKey,
  recipientFor,
  smsQuietHours,
  smsSafeVariables,
  stayVariables,
  triggerSkipReason,
} from './rules.js';

/**
 * Bildirim kuralları: yanlış olursa misafire günler önce "odanız 101" gider
 * (sonra oda değişir), aynı olay iki kez bildirilir ya da SMS yanlış kişiye
 * gider.
 */

const today = new Date('2026-09-17T00:00:00Z');
const stay = (overrides) => ({ status: 'CONFIRMED', checkIn: new Date('2026-09-17T00:00:00Z'), ...overrides });

describe('tetikleyici kuralları', () => {
  it('oda bilgisi giriş günü ya da içerideki misafire gönderilir', () => {
    assert.equal(triggerSkipReason('ROOM_ASSIGNED', stay(), today), null);
    assert.equal(triggerSkipReason('ROOM_ASSIGNED', stay({ status: 'CHECKED_IN', checkIn: new Date('2026-09-10') }), today), null);
  });

  it('günler önceki oda atamasında gönderilmez', () => {
    assert.match(triggerSkipReason('ROOM_ASSIGNED', stay({ checkIn: new Date('2026-09-20') }), today), /Giriş günü değil/);
  });

  it('iptal edilmiş ya da gelmemiş rezervasyona bildirim gitmez', () => {
    assert.ok(triggerSkipReason('RESERVATION_CONFIRMED', stay({ status: 'CANCELLED' }), today));
    assert.ok(triggerSkipReason('ROOM_ASSIGNED', stay({ status: 'NO_SHOW' }), today));
    // Opsiyonlu rezervasyona onay bildirimi gitmez; onaylanınca (`reservation.confirmed`) gider.
    assert.match(triggerSkipReason('RESERVATION_CONFIRMED', stay({ status: 'PENDING' }), today), /Opsiyonlu/);
    assert.equal(triggerSkipReason('RESERVATION_CONFIRMED', stay({ status: 'CONFIRMED' }), today), null);
  });

  it('giriş ve çıkış bildirimi ancak durum gerçekten değiştiyse gider', () => {
    assert.equal(triggerSkipReason('CHECKED_IN', stay({ status: 'CHECKED_IN' }), today), null);
    assert.ok(triggerSkipReason('CHECKED_IN', stay(), today));
    assert.equal(triggerSkipReason('CHECKED_OUT', stay({ status: 'CHECKED_OUT' }), today), null);
    assert.ok(triggerSkipReason('UNKNOWN', stay(), today));
  });
});

describe('tekillik anahtarı', () => {
  it('oda bilgisi odaya göre ayrışır; diğerleri rezervasyon ve kanal başına bir tane', () => {
    const subject = { reservationId: 'r1', roomId: 'o1' };
    assert.equal(notificationDedupeKey('ROOM_ASSIGNED', subject, 'SMS'), 'ROOM_ASSIGNED:r1:o1:SMS');
    assert.notEqual(
      notificationDedupeKey('ROOM_ASSIGNED', subject, 'SMS'),
      notificationDedupeKey('ROOM_ASSIGNED', { ...subject, roomId: 'o2' }, 'SMS'),
    );
    assert.equal(notificationDedupeKey('CHECKED_IN', subject, 'EMAIL'), 'CHECKED_IN:r1:EMAIL');
  });

  it('hata uyarısı kanal, kod ve gün başına birleşir', () => {
    assert.equal(failureAlertKey('SMS', 'NETGSM_30', today), 'notification-failed:SMS:NETGSM_30:2026-09-17');
    assert.equal(failureAlertKey('EMAIL', null, today), 'notification-failed:EMAIL:UNKNOWN:2026-09-17');
  });
});

describe('şablon değişkenleri', () => {
  const values = stayVariables({
    hotel: { name: 'Demo Otel', phone: '+90 242 000 00 00', checkInTime: '14:00', checkOutTime: '12:00' },
    reservation: {
      confirmationCode: 'DEMO-0006',
      checkIn: new Date('2026-09-14T00:00:00Z'),
      checkOut: new Date('2026-09-19T00:00:00Z'),
    },
    guest: { firstName: 'Łukasz', lastName: 'Nowak' },
    roomTypeName: 'Standart',
    roomNumber: '101',
    today,
  });

  it('tarihler gün.ay.yıl, gece sayısı konaklamadan', () => {
    assert.equal(values.girisTarihi, '14.09.2026');
    assert.equal(values.cikisTarihi, '19.09.2026');
    assert.equal(values.geceSayisi, '5');
    assert.equal(values.tarih, '17.09.2026');
    assert.equal(values.misafirAdi, 'Łukasz Nowak');
  });

  it('bütün değişkenler dolu (boş bırakılan tek şey eksik oda/telefon)', () => {
    for (const [name, value] of Object.entries(values)) assert.notEqual(value, undefined, name);
  });

  it('SMS için desteklenmeyen harfler çevrilir', () => {
    assert.equal(smsSafeVariables(values).misafirAdi, 'Lukasz Nowak');
  });

  it('eksik oda ve telefon boş yazılır', () => {
    const empty = stayVariables({
      hotel: { name: 'O', phone: null, checkInTime: '14:00', checkOutTime: '12:00' },
      reservation: { confirmationCode: 'X', checkIn: today, checkOut: today },
      guest: { firstName: 'A', lastName: 'B' },
      today,
    });
    assert.deepEqual([empty.odaNo, empty.otelTelefonu, empty.geceSayisi], ['', '', '0']);
  });
});

describe('alıcı', () => {
  it('e-posta küçük harfe iner; geçersiz adres yok sayılır', () => {
    assert.equal(recipientFor('EMAIL', { email: ' Ayse@Example.COM ' }, '90'), 'ayse@example.com');
    assert.equal(recipientFor('EMAIL', { email: 'ayse@' }, '90'), null);
    assert.equal(recipientFor('EMAIL', { email: null }, '90'), null);
  });

  it('telefon otelin ülke koduyla uluslararası biçime çevrilir', () => {
    assert.equal(recipientFor('SMS', { phone: '0532 111 00 01' }, '90'), '905321110001');
    assert.equal(recipientFor('WHATSAPP', { phone: '+44 7911 123456' }, '90'), '447911123456');
    assert.equal(recipientFor('SMS', { phone: '' }, '90'), null);
  });
});

describe('misafir tercihi ve uyarı izni', () => {
  it('kanal bazında bildirim istemeyen misafir', () => {
    assert.equal(guestOptedOut({ notifications: { optOut: ['SMS'] } }, 'SMS'), true);
    assert.equal(guestOptedOut({ notifications: { optOut: ['SMS'] } }, 'EMAIL'), false);
    assert.equal(guestOptedOut({}, 'SMS'), false);
    assert.equal(guestOptedOut(null, 'SMS'), false);
    assert.equal(guestOptedOut({ notifications: { optOut: 'SMS' } }, 'SMS'), false, 'dizi olmayan değer yok sayılır');
  });

  it('elle yapılacak iş modülüne göre izne gider; bilinmeyen yönetime düşer', () => {
    assert.equal(manualTaskPermission('Oda atama'), 'rooms.operate');
    assert.equal(manualTaskPermission('Başka'), MANUAL_TASK_FALLBACK_PERMISSION);
  });
});

describe('SMS sessiz saatleri', () => {
  it('kanal ayarı sözleşmedeki biçime çevrilir ve gerçekten erteler', () => {
    const settings = { provider: 'NETGSM', quietHoursStart: '22:00', quietHoursEnd: '08:00' };
    assert.deepEqual(smsQuietHours(settings), { start: '22:00', end: '08:00' });
    // 23:30 İstanbul = 20:30 UTC → ertesi sabah 08:00 İstanbul = 05:00 UTC
    const release = quietHoursRelease(new Date('2026-09-17T20:30:00Z'), 'Europe/Istanbul', smsQuietHours(settings));
    assert.equal(release?.toISOString(), '2026-09-18T05:00:00.000Z');
  });

  it('ayar yoksa ertelenmez', () => {
    assert.deepEqual(smsQuietHours(null), { start: null, end: null });
    assert.equal(quietHoursRelease(new Date(), 'Europe/Istanbul', smsQuietHours({})), null);
  });
});
