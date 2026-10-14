import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ICAL_UID_SUFFIX, buildIcal, classifyIcalEvent, closedRanges, icalReservationCode, parseIcal } from './ical.js';

/**
 * iCal okuyucu / yazıcı. Okuma yanlışsa Airbnb rezervasyonu sisteme hiç düşmez
 * ya da yanlış gecelere düşer; yazma yanlışsa kanal dolu günde satış açar.
 */

const AIRBNB = [
  'BEGIN:VCALENDAR',
  'PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20270605',
  'DTSTART;VALUE=DATE:20270601',
  'UID:1418fb94e984-0f7a5d1e3b4c8a2e@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCD1234\\nPhone Number (Last 4 Digits): 1234',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20270612',
  'DTSTART;VALUE=DATE:20270610',
  'UID:7f3e0c-blocked@airbnb.com',
  'SUMMARY:Airbnb (Not available)',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('iCal okuma', () => {
  it('gün değerli kayıtlar: giriş dahil, çıkış hariç; açıklamadaki kaçışlar açılır', () => {
    const { events, invalid } = parseIcal(AIRBNB);
    assert.equal(invalid, 0);
    assert.equal(events.length, 2);
    assert.deepEqual(
      { uid: events[0].uid, start: events[0].start, end: events[0].end, summary: events[0].summary },
      { uid: '1418fb94e984-0f7a5d1e3b4c8a2e@airbnb.com', start: '2027-06-01', end: '2027-06-05', summary: 'Reserved' },
    );
    assert.match(events[0].description, /\nPhone Number/, '\\n satır sonu olur');
    assert.equal(icalReservationCode(events[0].description), 'HMABCD1234');
  });

  it('katlanmış satırlar birleşir; DTEND yoksa bir gün; saatli değerde tarih kısmı', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uzun-',
      ' kimlik@booking.com',
      'DTSTART:20270701T140000Z',
      'SUMMARY:CLOSED - Not available',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { events } = parseIcal(text);
    assert.equal(events[0].uid, 'uzun-kimlik@booking.com');
    assert.deepEqual([events[0].start, events[0].end], ['2027-07-01', '2027-07-02']);
  });

  it('bozuk kayıt atlanır ve sayılır; iCal olmayan metin reddedilir', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20270601',
      'END:VEVENT', // UID yok
      'BEGIN:VEVENT',
      'UID:ters',
      'DTSTART;VALUE=DATE:20270605',
      'DTEND;VALUE=DATE:20270601',
      'END:VEVENT', // bitiş başlangıçtan önce
      'BEGIN:VEVENT',
      'UID:gecersiz',
      'DTSTART;VALUE=DATE:20270231',
      'END:VEVENT', // 31 Şubat
      'END:VCALENDAR',
    ].join('\r\n');
    assert.deepEqual(parseIcal(text), { events: [], invalid: 3 });
    assert.throws(() => parseIcal('<html>giriş yapın</html>'), /iCal biçiminde değil/);
  });

  it('kayıt sayısı sınırı aşılırsa hata (yanlış adres / dev takvim)', () => {
    const many = ['BEGIN:VCALENDAR'];
    for (let index = 0; index < 4; index += 1) many.push('BEGIN:VEVENT', `UID:${index}`, 'DTSTART;VALUE=DATE:20270601', 'END:VEVENT');
    many.push('END:VCALENDAR');
    assert.throws(() => parseIcal(many.join('\n'), { maxEvents: 3 }), /3 kayıttan fazlası/);
  });

  it('Airbnb kapatmayı rezervasyondan ayırır; Booking ayırmaz; kendi kaydımız tanınır', () => {
    const { events } = parseIcal(AIRBNB);
    assert.equal(classifyIcalEvent(events[0], 'AIRBNB'), 'RESERVATION');
    assert.equal(classifyIcalEvent(events[1], 'AIRBNB'), 'CLOSED');
    assert.equal(classifyIcalEvent({ ...events[1], summary: 'CLOSED - Not available' }, 'BOOKING'), 'RESERVATION');
    assert.equal(classifyIcalEvent({ ...events[0], uid: `abc-20270601${ICAL_UID_SUFFIX}` }, 'BOOKING'), 'OURS');
  });
});

describe('iCal yazma', () => {
  it('kapalı günler ardışık aralıklara, bitiş son günün ertesi', () => {
    assert.deepEqual(closedRanges(['2027-06-01', '2027-06-02', '2027-06-05']), [
      { start: '2027-06-01', end: '2027-06-03' },
      { start: '2027-06-05', end: '2027-06-06' },
    ]);
    assert.deepEqual(closedRanges([]), []);
  });

  it('yazılan takvim yeniden okunabilir: CRLF, gün değerli, kendi UID sonekiyle', () => {
    const text = buildIcal({
      calendarName: 'Otel; Deluxe, deniz',
      key: 'tok123',
      ranges: [{ start: '2027-06-01', end: '2027-06-03' }],
      summary: 'Kapalı',
      now: new Date('2027-05-01T10:00:00.000Z'),
    });
    assert.ok(text.endsWith('\r\n'));
    assert.ok(text.split('\r\n').every((line) => Buffer.byteLength(line) <= 75), 'satırlar 75 okteti aşmaz');
    assert.match(text, /X-WR-CALNAME:Otel\\; Deluxe\\, deniz/);
    assert.match(text, /DTSTAMP:20270501T100000Z/);
    const { events } = parseIcal(text);
    assert.deepEqual(events.map((event) => [event.start, event.end]), [['2027-06-01', '2027-06-03']]);
    assert.equal(classifyIcalEvent(events[0], 'OTHER'), 'OURS', 'kanal geri yansıtırsa döngü olmaz');
  });

  it('uzun satır çok baytlı karakteri bölmeden katlanır', () => {
    const text = buildIcal({ calendarName: 'Ğ'.repeat(60), key: 'k', ranges: [], summary: 'x' });
    const unfolded = text.replace(/\r\n /g, '');
    assert.match(unfolded, new RegExp(`X-WR-CALNAME:${'Ğ'.repeat(60)}`));
  });
});
