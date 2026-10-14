import { addIsoDays } from './ari.js';

/**
 * iCal (RFC 5545) okuyucu ve yazıcı — yalnızca kanal takvimlerinin kullandığı
 * kadarı: VEVENT, gün değerli DTSTART / DTEND, UID, SUMMARY, DESCRIPTION.
 *
 * - **Okuma** (içe aktarma): Airbnb / Booking.com takvimindeki dolu günler.
 *   Kendi dışa aktardığımız kayıtlar (UID soneki) tanınır ve atlanır: kanal
 *   bizim kapattığımız günleri kendi takviminde yeniden yayınlarsa döngü olmasın.
 * - **Yazma** (dışa aktarma): kanalın okuyacağı "kapalı günler" takvimi.
 */

/** Kendi kayıtlarımızın UID soneki. */
export const ICAL_UID_SUFFIX = '@kanal.hotelos';

/** Okunacak en fazla kayıt (bir ilanın takvimi; fazlası bozuk / yanlış adres demektir). */
export const MAX_ICAL_EVENTS = 5000;

/** Satır katlama sınırı (oktet). */
const FOLD_LIMIT = 75;

/** Airbnb'de evsahibinin kapattığı gün (rezervasyon değil). */
const AIRBNB_CLOSED_SUMMARY = /not available|blocked/i;

/**
 * Katlanmış satırları açar (CRLF + boşluk / sekme devam satırıdır).
 * @param {string} text
 * @returns {string[]}
 */
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** @param {string} value */
function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, char) => (char === 'n' || char === 'N' ? '\n' : char));
}

/** @param {string} value */
function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * "20270601" ya da "20270601T140000Z" → "2027-06-01". Saatli değerde tarih
 * kısmı alınır (kanal takvimleri gün değerli yazar; saatli yazan da gün olarak okunur).
 * @param {string} value
 * @returns {string | null}
 */
function parseDay(value) {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day ? null : day;
}

/**
 * Bir içerik satırı: ad, parametreler ve değer.
 * @param {string} line
 */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const [name, ...params] = head.split(';');
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/**
 * @typedef {{ uid: string, start: string, end: string, summary: string, description: string }} IcalEvent
 */

/**
 * Takvimi okur. Bozuk kayıt (UID'siz, tarihsiz, bitişi başlangıçtan önce) atlanır
 * ve sayılır; takvimin kendisi geçersizse (VCALENDAR yok) hata fırlatır.
 *
 * @param {string} text
 * @param {{ maxEvents?: number }} [options]
 * @returns {{ events: IcalEvent[], invalid: number }}
 */
export function parseIcal(text, { maxEvents = MAX_ICAL_EVENTS } = {}) {
  const lines = unfold(String(text ?? ''));
  if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new Error('Takvim iCal biçiminde değil (BEGIN:VCALENDAR yok)');
  }
  const events = [];
  let invalid = 0;
  /** @type {Record<string, string> | null} */
  let current = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (current) {
        const start = current.DTSTART ? parseDay(current.DTSTART) : null;
        // DTEND yoksa gün değerli kayıt bir gün sürer (RFC 5545).
        const end = current.DTEND ? parseDay(current.DTEND) : start ? addIsoDays(start, 1) : null;
        if (!current.UID || !start || !end || end <= start) {
          invalid += 1;
        } else {
          if (events.length >= maxEvents) throw new Error(`Takvimde ${maxEvents} kayıttan fazlası var`);
          events.push({
            uid: unescapeText(current.UID).trim(),
            start,
            end,
            summary: unescapeText(current.SUMMARY ?? '').trim(),
            description: unescapeText(current.DESCRIPTION ?? '').trim(),
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(line);
    if (parsed && ['UID', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION'].includes(parsed.name)) {
      current[parsed.name] = parsed.value;
    }
  }
  return { events, invalid };
}

/**
 * Kaydın türü: rezervasyon, kanalın kapattığı gün ya da bizim kaydımız.
 * Airbnb rezervasyonu ("Reserved") kapatmadan ("Airbnb (Not available)") ayırır;
 * Booking.com ve diğerleri ayırmaz — her kayıt rezervasyon sayılır.
 *
 * @param {IcalEvent} event
 * @param {'AIRBNB' | 'BOOKING' | 'OTHER'} provider
 * @returns {'RESERVATION' | 'CLOSED' | 'OURS'}
 */
export function classifyIcalEvent(event, provider) {
  if (event.uid.endsWith(ICAL_UID_SUFFIX)) return 'OURS';
  if (provider === 'AIRBNB' && AIRBNB_CLOSED_SUMMARY.test(event.summary)) return 'CLOSED';
  return 'RESERVATION';
}

/**
 * Airbnb açıklamasındaki rezervasyon kodu ("…/reservations/details/HMABC12345").
 * @param {string} description
 * @returns {string | null}
 */
export function icalReservationCode(description) {
  const match = /reservations\/details\/([A-Z0-9]{6,20})/i.exec(description ?? '');
  return match ? match[1].toUpperCase() : null;
}

/**
 * Kapalı günleri ardışık aralıklara çevirir (DTEND hariç: son gün + 1).
 * @param {string[]} days kapalı günler, sıralı
 * @returns {Array<{ start: string, end: string }>}
 */
export function closedRanges(days) {
  const ranges = [];
  for (const day of days) {
    const last = ranges.at(-1);
    if (last && last.end === day) {
      last.end = addIsoDays(day, 1);
    } else {
      ranges.push({ start: day, end: addIsoDays(day, 1) });
    }
  }
  return ranges;
}

/**
 * 75 okteti aşan satırı katlar (UTF-8 çok baytlı karakter bölünmez).
 * @param {string} line
 */
function fold(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? FOLD_LIMIT : FOLD_LIMIT - 1;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** "2027-06-01" → "20270601" */
const compactDay = (day) => day.replace(/-/g, '');

/** Date → "20271014T093000Z" */
const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Kapalı günler takvimi. Her aralık bir VEVENT; UID aralığın başından türetilir
 * (aynı kapatma her okumada aynı kimlikle görünür, kanal onu "değişmedi" sayar).
 *
 * @param {{ calendarName: string, key: string, ranges: Array<{ start: string, end: string }>, summary: string, now?: Date }} input
 * @returns {string}
 */
export function buildIcal({ calendarName, key, ranges, summary, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HotelOS//Kanal yonetimi//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const dtstamp = stamp(now);
  for (const range of ranges) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${key}-${compactDay(range.start)}${ICAL_UID_SUFFIX}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compactDay(range.start)}`,
      `DTEND;VALUE=DATE:${compactDay(range.end)}`,
      `SUMMARY:${escapeText(summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
