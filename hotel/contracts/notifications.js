import { z } from './locale.js';
import { EMAIL_PATTERN, TIME_PATTERN, expectedUpdatedAt } from './fields.js';
import { utcToZonedWallTime, zonedWallTimeToUtc } from './zoned-time.js';

/**
 * Bildirim merkezi sözleşmeleri (modül 9).
 *
 * İki ayrı bildirim türü var:
 * - **Misafir bildirimi** (e-posta, SMS, WhatsApp): şablondan üretilir,
 *   kuyruğa yazılır, arka planda gönderilir; her gönderim geçmişte durur.
 * - **Personel uyarısı** (üst bardaki zil): misafir mesajı, acil / geciken
 *   istek, aktörün personele bıraktığı iş, misafire ulaşamayan bildirim.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/* ─────────────── Kanallar ve durumlar ─────────────── */

/** Misafire bildirim gönderilebilen kanallar (Prisma `NotificationChannel` alt kümesi). */
export const NOTIFICATION_CHANNELS = Object.freeze(['EMAIL', 'SMS', 'WHATSAPP']);

export const NOTIFICATION_CHANNEL_LABELS = Object.freeze({
  EMAIL: 'E-posta',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
});

/** SMS sağlayıcıları. Yenisi eklenince backend `notifications/providers` altına adaptörü yazılır. */
export const SMS_PROVIDERS = Object.freeze(['NETGSM']);

export const SMS_PROVIDER_LABELS = Object.freeze({ NETGSM: 'Netgsm' });

/** SMTP bağlantı güvenliği. */
export const SMTP_SECURITY_MODES = Object.freeze(['TLS', 'STARTTLS', 'NONE']);

export const SMTP_SECURITY_LABELS = Object.freeze({
  TLS: 'SSL/TLS (genelde 465)',
  STARTTLS: 'STARTTLS (genelde 587)',
  NONE: 'Şifrelemesiz (önerilmez)',
});

/**
 * Gönderimin yolculuğu (Prisma `NotificationStatus`).
 * - `PENDING`: sırada (ya da yeniden deneme saatini bekliyor)
 * - `SENDING`: gönderici üstlendi
 * - `SENT`: sağlayıcı kabul etti
 * - `DELIVERED`: sağlayıcı alıcıya ulaştığını bildirdi (SMS teslim raporu)
 * - `FAILED`: bütün denemelere rağmen gönderilemedi ya da kalıcı hata
 * - `CANCELLED`: gönderilmedi (kanal kapalı, alıcı bildirim istemiyor, personel iptal etti)
 */
export const NOTIFICATION_STATUSES = Object.freeze(['PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED']);

export const NOTIFICATION_STATUS_LABELS = Object.freeze({
  PENDING: 'Sırada',
  SENDING: 'Gönderiliyor',
  SENT: 'Gönderildi',
  DELIVERED: 'İletildi',
  FAILED: 'Gönderilemedi',
  CANCELLED: 'Gönderilmedi',
});

/** Tekrar gönderilebilen durumlar. */
export const NOTIFICATION_RESENDABLE_STATUSES = Object.freeze(['SENT', 'DELIVERED', 'FAILED', 'CANCELLED']);

/**
 * Geçici hatada yeniden deneme aralıkları. Deneme sayısı bu dizinin bir
 * fazlasıdır (ilk deneme + her aralık için bir deneme).
 */
export const NOTIFICATION_RETRY_DELAYS_MS = Object.freeze([30_000, 2 * MINUTE_MS, 10 * MINUTE_MS, 30 * MINUTE_MS]);

export const NOTIFICATION_MAX_ATTEMPTS = NOTIFICATION_RETRY_DELAYS_MS.length + 1;

/**
 * Bir sonraki denemenin zamanı; deneme hakkı bittiyse `null`.
 * @param {number} attemptsMade yapılmış deneme sayısı (bu dahil)
 * @param {Date} now
 */
export function notificationRetryAt(attemptsMade, now) {
  const delay = NOTIFICATION_RETRY_DELAYS_MS[attemptsMade - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/* ─────────────── Tetikleyiciler ve şablonlar ─────────────── */

/** Şablonu olan olaylar. */
export const NOTIFICATION_TRIGGERS = Object.freeze(['RESERVATION_CONFIRMED', 'ROOM_ASSIGNED', 'CHECKED_IN', 'CHECKED_OUT']);

/** Geçmişte görünen bütün kaynaklar (şablonlu olaylar + kanal testi). */
export const NOTIFICATION_SOURCES = Object.freeze([...NOTIFICATION_TRIGGERS, 'CHANNEL_TEST']);

export const NOTIFICATION_SOURCE_LABELS = Object.freeze({
  RESERVATION_CONFIRMED: 'Rezervasyon onayı',
  ROOM_ASSIGNED: 'Oda bilgisi',
  CHECKED_IN: 'Hoş geldiniz',
  CHECKED_OUT: 'Teşekkür',
  CHANNEL_TEST: 'Kanal testi',
});

export const NOTIFICATION_TRIGGER_HINTS = Object.freeze({
  RESERVATION_CONFIRMED:
    'Rezervasyon kesin olarak açılınca ya da opsiyonlu rezervasyon onaylanınca gönderilir (opsiyonluya gönderilmez).',
  ROOM_ASSIGNED:
    'Oda giriş günü ya da misafir içerideyken atanınca (oda değişikliği dahil) gönderilir. Günler önceden yapılan atamada gönderilmez; oda son ana kadar değişebilir.',
  CHECKED_IN: 'Misafir giriş yapınca gönderilir.',
  CHECKED_OUT: 'Misafir çıkış yapınca gönderilir.',
});

/**
 * Tetikleyiciyi yayınlayan event(ler) (dinleyen: notification-worker). Bir
 * tetikleyiciyi birden çok event açabilir; aynı rezervasyona ikinci kez
 * gönderilmez (tekilleştirme anahtarı).
 */
export const NOTIFICATION_TRIGGER_EVENTS = Object.freeze({
  RESERVATION_CONFIRMED: Object.freeze(['reservation.created', 'reservation.confirmed']),
  ROOM_ASSIGNED: 'room.assigned',
  CHECKED_IN: 'guest.checked_in',
  CHECKED_OUT: 'guest.checked_out',
});

/** Şablon dilleri. Çoklu dil (modül 60) genişletene kadar Türkçe ve İngilizce. */
export const NOTIFICATION_LANGUAGES = Object.freeze(['tr', 'en']);

export const NOTIFICATION_LANGUAGE_LABELS = Object.freeze({ tr: 'Türkçe', en: 'İngilizce' });

/** Uyruğu bilinmeyen ya da Türk misafirin dili; şablonu olmayan dilde de buna düşülür. */
export const DEFAULT_NOTIFICATION_LANGUAGE = 'tr';

/**
 * Misafirin bildirim dili: Türk (ya da uyruğu bilinmeyen) misafire Türkçe,
 * diğerlerine İngilizce.
 * @param {string | null | undefined} nationality ISO ülke kodu ("TR", "DE")
 */
export function notificationLanguageFor(nationality) {
  const code = String(nationality ?? '').trim().toUpperCase();
  return !code || code === 'TR' || code === 'TUR' ? 'tr' : 'en';
}

/** Şablonda kullanılabilen değişkenler. */
export const TEMPLATE_VARIABLES = Object.freeze({
  misafirAdi: 'Misafirin adı soyadı',
  otelAdi: 'Otelin adı',
  otelTelefonu: 'Otelin telefonu',
  onayKodu: 'Rezervasyonun onay kodu',
  girisTarihi: 'Giriş tarihi',
  cikisTarihi: 'Çıkış tarihi',
  geceSayisi: 'Gece sayısı',
  girisSaati: 'Giriş saati (otel ayarı)',
  cikisSaati: 'Çıkış saati (otel ayarı)',
  odaTipi: 'Oda tipi',
  odaNo: 'Oda numarası',
  tarih: 'Bildirimin gönderildiği gün',
});

const STAY_VARIABLES = Object.freeze([
  'misafirAdi',
  'otelAdi',
  'otelTelefonu',
  'onayKodu',
  'girisTarihi',
  'cikisTarihi',
  'geceSayisi',
  'girisSaati',
  'cikisSaati',
  'odaTipi',
  'tarih',
]);

/**
 * Tetikleyiciye göre kullanılabilen değişkenler. Rezervasyon onayında oda
 * çoğu zaman henüz atanmamıştır; `{odaNo}` orada boş kalacağı için izin yok.
 */
export const TRIGGER_VARIABLES = Object.freeze({
  RESERVATION_CONFIRMED: STAY_VARIABLES,
  ROOM_ASSIGNED: Object.freeze([...STAY_VARIABLES, 'odaNo']),
  CHECKED_IN: Object.freeze([...STAY_VARIABLES, 'odaNo']),
  CHECKED_OUT: Object.freeze([...STAY_VARIABLES, 'odaNo']),
});

/** Önizleme ve uzunluk denetimi için gerçekçi (uzunca) örnek değerler. */
export const TEMPLATE_SAMPLE_VALUES = Object.freeze({
  misafirAdi: 'Ayşe Nur Yılmazoğlu',
  otelAdi: 'Demo Otel',
  otelTelefonu: '+90 242 000 00 00',
  onayKodu: 'DEMO-0006',
  girisTarihi: '14.09.2026',
  cikisTarihi: '19.09.2026',
  geceSayisi: '5',
  girisSaati: '14:00',
  cikisSaati: '12:00',
  odaTipi: 'Deluxe Deniz Manzaralı',
  odaNo: '1204',
  tarih: '17.09.2026',
});

const VARIABLE_PATTERN = /\{([A-Za-z]+)\}/g;

/**
 * Metindeki değişken adları (tekrarsız, göründüğü sırayla).
 * @param {string} text
 */
export function templateVariables(text) {
  return [...new Set([...String(text ?? '').matchAll(VARIABLE_PATTERN)].map((match) => match[1]))];
}

/**
 * Şablonun doldurulması. Bilinmeyen değişken olduğu gibi kalır (kayıtta zaten
 * reddedilir); değeri olmayan değişken boş yazılır.
 *
 * @param {string} text
 * @param {Record<string, string | null | undefined>} values
 */
export function renderTemplate(text, values) {
  return String(text ?? '').replace(VARIABLE_PATTERN, (token, name) => {
    if (!Object.hasOwn(TEMPLATE_VARIABLES, name)) return token;
    return values[name] ?? '';
  });
}

/* ─────────────── SMS uzunluğu ─────────────── */

/**
 * GSM 03.38 temel alfabesi. Netgsm'in standart gönderimi bu karakterlerle
 * yapılır; her biri 1 karakter sayılır.
 */
const GSM_BASIC = new Set([
  ...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
]);

/** GSM genişletme tablosu: 2 karakter sayılır. */
const GSM_EXTENDED = new Set([...'^{}\\[~]|€\f']);

/**
 * Türkçe dil seçeneğiyle gönderilen harfler: Netgsm SMS teknik şartnamesine
 * göre her biri 2 karakter harcar (ö, ü, Ö, Ü, Ç zaten temel alfabede).
 */
const TURKISH_DOUBLE = new Set([...'çğışĞİŞ']);

/**
 * Parça uzunlukları (Netgsm SMS teknik şartnamesi):
 * - Standart: alfanümerik başlıkta 1 SMS 155 karakter; uzun SMS en fazla 912 (6 parça).
 * - Türkçe: 1 SMS 150 karakter; uzun SMS en fazla 883 (6 parça).
 * Parça sayısı ücreti belirler; ekranda "tahmini" diye gösterilir.
 */
export const SMS_LIMITS = Object.freeze({
  GSM: Object.freeze({ single: 155, part: 152, max: 912 }),
  TR: Object.freeze({ single: 150, part: 148, max: 883 }),
});

/**
 * SMS metninin sağlayıcıdaki uzunluğu ve parça sayısı.
 *
 * @param {string} text
 * @returns {{ encoding: 'GSM' | 'TR', length: number, segments: number, maxLength: number, tooLong: boolean, invalidChars: string[] }}
 */
export function smsInfo(text) {
  let length = 0;
  let turkish = false;
  const invalid = new Set();
  for (const char of String(text ?? '')) {
    if (GSM_BASIC.has(char)) length += 1;
    else if (GSM_EXTENDED.has(char)) length += 2;
    else if (TURKISH_DOUBLE.has(char)) {
      length += 2;
      turkish = true;
    } else invalid.add(char);
  }
  const encoding = turkish ? 'TR' : 'GSM';
  const limits = SMS_LIMITS[encoding];
  const segments = length === 0 ? 0 : length <= limits.single ? 1 : Math.ceil(length / limits.part);
  return { encoding, length, segments, maxLength: limits.max, tooLong: length > limits.max, invalidChars: [...invalid] };
}

/** @param {string} char */
function smsSupported(char) {
  return GSM_BASIC.has(char) || GSM_EXTENDED.has(char) || TURKISH_DOUBLE.has(char);
}

/**
 * SMS'e yazılamayan karakterleri en yakın karşılığına çevirir ("Łukasz" →
 * "Lukasz", "José" aynı kalır). Karşılığı olmayan (emoji, Arapça harf) "?"
 * olur. Şablonun kendisi kayıtta denetlendiği için bu yalnızca değişken
 * değerlerine (misafir adı) uygulanır.
 *
 * @param {string | null | undefined} value
 */
export function sanitizeSmsValue(value) {
  let result = '';
  for (const char of String(value ?? '')) {
    if (smsSupported(char)) {
      result += char;
      continue;
    }
    const plain = char
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
    result += plain && [...plain].every(smsSupported) ? plain : '?';
  }
  return result;
}

/* ─────────────── Sessiz saatler ─────────────── */

/** @param {string} day YYYY-MM-DD */
function nextDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Sessiz saatler içindeyse gönderimin serbest kalacağı an; değilse `null`.
 *
 * Aralık gece yarısını aşabilir (22:00–08:00). Saatler otelin saat dilimiyle
 * okunur.
 *
 * @param {Date} now
 * @param {string} timeZone
 * @param {{ start?: string | null, end?: string | null }} quietHours
 * @returns {Date | null}
 */
export function quietHoursRelease(now, timeZone, { start, end }) {
  if (!start || !end || start === end) return null;
  const wall = utcToZonedWallTime(now, timeZone);
  if (!wall) return null;
  const day = wall.slice(0, 10);
  const time = wall.slice(11);
  const wraps = start > end;
  const inside = wraps ? time >= start || time < end : time >= start && time < end;
  if (!inside) return null;
  const releaseDay = wraps && time >= start ? nextDay(day) : day;
  return zonedWallTimeToUtc(`${releaseDay}T${end}`, timeZone);
}

/* ─────────────── Varsayılan şablonlar ─────────────── */

const tr = (key, channel, subject, body) => ({ key, channel, language: 'tr', subject, body });
const en = (key, channel, subject, body) => ({ key, channel, language: 'en', subject, body });

/**
 * Otel kurulurken (ve ekrandaki "varsayılana dön" ile) yüklenen metinler.
 * SMS metinleri kısa tutuldu: Türkçe tek parça 150 karakter.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES = Object.freeze([
  tr(
    'RESERVATION_CONFIRMED',
    'EMAIL',
    'Rezervasyonunuz onaylandı — {onayKodu}',
    'Sayın {misafirAdi},\n\n{otelAdi} rezervasyonunuz onaylanmıştır.\n\nOnay kodu: {onayKodu}\nGiriş: {girisTarihi}, saat {girisSaati} itibarıyla\nÇıkış: {cikisTarihi}, en geç saat {cikisSaati}\nKonaklama: {geceSayisi} gece, {odaTipi}\n\nSorularınız için bize {otelTelefonu} numarasından ulaşabilirsiniz.\n\nSizi ağırlamayı dört gözle bekliyoruz.\n{otelAdi}',
  ),
  tr(
    'RESERVATION_CONFIRMED',
    'SMS',
    null,
    '{otelAdi}: {girisTarihi}-{cikisTarihi} rezervasyonunuz onaylandı. Onay kodu {onayKodu}. Bilgi: {otelTelefonu}',
  ),
  en(
    'RESERVATION_CONFIRMED',
    'EMAIL',
    'Your reservation is confirmed — {onayKodu}',
    'Dear {misafirAdi},\n\nYour reservation at {otelAdi} is confirmed.\n\nConfirmation code: {onayKodu}\nCheck-in: {girisTarihi} (from {girisSaati})\nCheck-out: {cikisTarihi} (until {cikisSaati})\nStay: {geceSayisi} night(s), {odaTipi}\n\nFor any questions please call us on {otelTelefonu}.\n\nWe look forward to welcoming you.\n{otelAdi}',
  ),
  en(
    'RESERVATION_CONFIRMED',
    'SMS',
    null,
    '{otelAdi}: your stay {girisTarihi}-{cikisTarihi} is confirmed. Code {onayKodu}. Info: {otelTelefonu}',
  ),
  tr(
    'ROOM_ASSIGNED',
    'EMAIL',
    'Odanız hazır — {otelAdi}',
    'Sayın {misafirAdi},\n\n{otelAdi} konaklamanızda oda numaranız {odaNo}.\n\nİyi konaklamalar dileriz. Bir ihtiyacınız olursa {otelTelefonu} numarasından bize ulaşabilirsiniz.\n{otelAdi}',
  ),
  tr('ROOM_ASSIGNED', 'SMS', null, '{otelAdi}: Oda numaranız {odaNo}. İyi konaklamalar! Bilgi: {otelTelefonu}'),
  en(
    'ROOM_ASSIGNED',
    'EMAIL',
    'Your room is ready — {otelAdi}',
    'Dear {misafirAdi},\n\nYour room number at {otelAdi} is {odaNo}.\n\nEnjoy your stay. If you need anything, call us on {otelTelefonu}.\n{otelAdi}',
  ),
  en('ROOM_ASSIGNED', 'SMS', null, '{otelAdi}: your room number is {odaNo}. Enjoy your stay! Info: {otelTelefonu}'),
  tr(
    'CHECKED_IN',
    'EMAIL',
    'Hoş geldiniz — {otelAdi}',
    'Sayın {misafirAdi},\n\nHoş geldiniz! Odanız {odaNo}. Çıkış tarihiniz {cikisTarihi}, en geç saat {cikisSaati}.\n\nKonaklamanız boyunca her ihtiyacınız için {otelTelefonu} numarasından resepsiyona ulaşabilirsiniz.\n{otelAdi}',
  ),
  tr('CHECKED_IN', 'SMS', null, '{otelAdi}: Hoş geldiniz! Odanız {odaNo}. Çıkış {cikisTarihi} {cikisSaati}. Resepsiyon: {otelTelefonu}'),
  en(
    'CHECKED_IN',
    'EMAIL',
    'Welcome to {otelAdi}',
    'Dear {misafirAdi},\n\nWelcome to {otelAdi}. Your room is {odaNo}; check-out is on {cikisTarihi} at {cikisSaati}.\n\nThe front desk is available on {otelTelefonu} throughout your stay.\n{otelAdi}',
  ),
  en('CHECKED_IN', 'SMS', null, 'Welcome to {otelAdi}! Your room is {odaNo}. Check-out {cikisTarihi} {cikisSaati}. Front desk: {otelTelefonu}'),
  tr(
    'CHECKED_OUT',
    'EMAIL',
    'Bizi tercih ettiğiniz için teşekkürler — {otelAdi}',
    'Sayın {misafirAdi},\n\nKonaklamanız için teşekkür ederiz. Sizi yeniden ağırlamaktan mutluluk duyarız.\n\nİyi yolculuklar.\n{otelAdi}',
  ),
  tr('CHECKED_OUT', 'SMS', null, '{otelAdi}: bizi tercih ettiğiniz için teşekkürler, yeniden görüşmek dileğiyle. İyi yolculuklar!'),
  en(
    'CHECKED_OUT',
    'EMAIL',
    'Thank you for staying with us — {otelAdi}',
    'Dear {misafirAdi},\n\nThank you for choosing {otelAdi}. We would be delighted to welcome you again.\n\nHave a safe journey.\n{otelAdi}',
  ),
  en('CHECKED_OUT', 'SMS', null, '{otelAdi}: thank you for staying with us. We hope to see you again. Safe travels!'),
]);

/* ─────────────── Personel uyarıları ─────────────── */

export const STAFF_ALERT_KINDS = Object.freeze([
  'GUEST_MESSAGE',
  'URGENT_REQUEST',
  'OVERDUE_REQUEST',
  'MANUAL_TASK',
  'NOTIFICATION_FAILED',
  'APPROVAL_REQUESTED',
  'APPROVAL_DECIDED',
  'WAITLIST_AVAILABLE',
  'CHECKOUT_OPEN_BALANCE',
  'AI_HANDOFF',
  'AI_BUDGET',
]);

export const STAFF_ALERT_KIND_LABELS = Object.freeze({
  GUEST_MESSAGE: 'Yeni misafir mesajı',
  URGENT_REQUEST: 'Acil misafir isteği',
  OVERDUE_REQUEST: 'Geciken misafir isteği',
  MANUAL_TASK: 'Personele bırakılan iş',
  NOTIFICATION_FAILED: 'Misafire ulaşamayan bildirim',
  APPROVAL_REQUESTED: 'Onay bekleyen iş',
  APPROVAL_DECIDED: 'İstediğim onayın sonucu',
  WAITLIST_AVAILABLE: 'Bekleme listesinde yer açıldı',
  CHECKOUT_OPEN_BALANCE: 'Bakiyesi kapanmadan çıkış',
  AI_HANDOFF: 'AI konuşmayı devretti',
  AI_BUDGET: 'AI bütçesi doldu',
});

export const STAFF_ALERT_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'CRITICAL']);

/** Uyarılar bu kadar gün sonra silinir (zil bir iş listesi değil). */
export const STAFF_ALERT_RETENTION_DAYS = 30;

/** Zil listesinde bir seferde gelen uyarı. */
export const STAFF_ALERT_PAGE_SIZE = 20;

/** Rozette gösterilen görülmemiş uyarı üst sınırı ("99+"). */
export const STAFF_ALERT_BADGE_CAP = 99;

/* ─────────────── Şema yardımcıları ─────────────── */

const MAX_SUBJECT_LENGTH = 200;
const MAX_EMAIL_BODY_LENGTH = 10_000;
const MAX_WHATSAPP_BODY_LENGTH = 1024;

/** Netgsm gönderici başlığı en fazla 11 karakter. */
export const MAX_SMS_HEADER_LENGTH = 11;

const cursorLimit = (fallback, max) =>
  z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(max, `Kayıt sayısı en fazla ${max} olabilir`)
    .default(fallback);

/**
 * Şablon metinlerinin kuralları: yalnızca tetikleyicinin izin verdiği
 * değişkenler; SMS'te desteklenen karakterler ve örnek değerlerle en fazla
 * 6 parça.
 *
 * @param {{ key: string, channel: string, subject?: string | null, body: string }} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineTemplate(value, ctx) {
  const allowed = TRIGGER_VARIABLES[value.key] ?? [];
  for (const field of ['subject', 'body']) {
    const unknown = templateVariables(value[field]).filter((name) => !allowed.includes(name));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `Bu şablonda kullanılamayan değişken: ${unknown.map((name) => `{${name}}`).join(', ')}`,
      });
    }
  }

  if (value.channel === 'EMAIL' && !value.subject) {
    ctx.addIssue({ code: 'custom', path: ['subject'], message: 'E-posta konusu zorunlu' });
  }

  if (value.channel === 'SMS') {
    const info = smsInfo(renderTemplate(value.body, TEMPLATE_SAMPLE_VALUES));
    if (info.invalidChars.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `SMS'te gönderilemeyen karakter: ${info.invalidChars.join(' ')}`,
      });
    } else if (info.tooLong) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `Örnek değerlerle ${info.length} karakter; SMS en fazla ${info.maxLength} karakter olabilir`,
      });
    }
  }

  if (value.channel === 'WHATSAPP' && value.body.length > MAX_WHATSAPP_BODY_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['body'],
      message: `WhatsApp şablonu en fazla ${MAX_WHATSAPP_BODY_LENGTH} karakter olabilir`,
    });
  }
}

/* ─────────────── Şemalar ─────────────── */

export const notificationTemplateSchema = z
  .object({
    key: z.enum(NOTIFICATION_TRIGGERS, { error: 'Geçersiz şablon' }),
    channel: z.enum(NOTIFICATION_CHANNELS, { error: 'Geçersiz kanal' }),
    language: z.enum(NOTIFICATION_LANGUAGES, { error: 'Geçersiz dil' }),
    subject: z
      .string()
      .trim()
      .max(MAX_SUBJECT_LENGTH, `Konu en fazla ${MAX_SUBJECT_LENGTH} karakter`)
      .optional()
      .nullable()
      .transform((value) => value || null),
    body: z
      .string({ error: 'Metin zorunlu' })
      .trim()
      .min(1, 'Metin zorunlu')
      .max(MAX_EMAIL_BODY_LENGTH, `Metin en fazla ${MAX_EMAIL_BODY_LENGTH} karakter`),
    isActive: z.boolean({ error: 'Açık/kapalı bilgisi eksik' }),
    /** Yeni şablonda boş; var olanı güncellerken ekranın gördüğü sürüm. */
    expectedUpdatedAt: expectedUpdatedAt.optional().nullable(),
  })
  .superRefine(refineTemplate);

export const templateParamSchema = z.object({
  key: z.enum(NOTIFICATION_TRIGGERS, { error: 'Geçersiz şablon' }),
  channel: z.enum(NOTIFICATION_CHANNELS, { error: 'Geçersiz kanal' }),
  language: z.enum(NOTIFICATION_LANGUAGES, { error: 'Geçersiz dil' }),
});

/** Boş bırakılabilir saat: formdan gelen boş metin "yok" demektir. */
const quietTime = z
  .string()
  .trim()
  .refine((value) => value === '' || TIME_PATTERN.test(value), 'Saat SS:DD biçiminde olmalı')
  .optional()
  .nullable()
  .transform((value) => value || null);

const secret = z.string().max(500, 'Parola en fazla 500 karakter').optional();

const emailChannelSchema = z
  .object({
    channel: z.literal('EMAIL'),
    enabled: z.boolean(),
    host: z.string().trim().max(255, 'Sunucu adı çok uzun').default(''),
    port: z.coerce
      .number({ error: 'Port sayı olmalı' })
      .int('Port tam sayı olmalı')
      .min(1, 'Port 1-65535 arasında olmalı')
      .max(65535, 'Port 1-65535 arasında olmalı'),
    security: z.enum(SMTP_SECURITY_MODES, { error: 'Bağlantı güvenliği seçin' }),
    username: z.string().trim().max(255, 'Kullanıcı adı çok uzun').default(''),
    /** Gönderilmezse (ya da boşsa) kayıtlı parola korunur. */
    password: secret,
    fromName: z.string().trim().max(120, 'Gönderen adı en fazla 120 karakter').default(''),
    fromAddress: z.string().trim().max(255).default(''),
    replyTo: z.string().trim().max(255).default(''),
    expectedUpdatedAt: expectedUpdatedAt.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.fromAddress && !EMAIL_PATTERN.test(value.fromAddress)) {
      ctx.addIssue({ code: 'custom', path: ['fromAddress'], message: 'Geçerli bir e-posta adresi girin' });
    }
    if (value.replyTo && !EMAIL_PATTERN.test(value.replyTo)) {
      ctx.addIssue({ code: 'custom', path: ['replyTo'], message: 'Geçerli bir e-posta adresi girin' });
    }
    if (!value.enabled) return;
    if (!value.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'SMTP sunucusu zorunlu' });
    if (!value.fromAddress) ctx.addIssue({ code: 'custom', path: ['fromAddress'], message: 'Gönderen adresi zorunlu' });
  });

const smsChannelSchema = z
  .object({
    channel: z.literal('SMS'),
    enabled: z.boolean(),
    provider: z.enum(SMS_PROVIDERS, { error: 'SMS sağlayıcısı seçin' }),
    username: z.string().trim().max(64, 'Kullanıcı kodu çok uzun').default(''),
    password: secret,
    sender: z
      .string()
      .trim()
      .max(MAX_SMS_HEADER_LENGTH, `Gönderici başlığı en fazla ${MAX_SMS_HEADER_LENGTH} karakter`)
      .default(''),
    quietHoursStart: quietTime,
    quietHoursEnd: quietTime,
    expectedUpdatedAt: expectedUpdatedAt.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.quietHoursStart) !== Boolean(value.quietHoursEnd)) {
      ctx.addIssue({
        code: 'custom',
        path: [value.quietHoursStart ? 'quietHoursEnd' : 'quietHoursStart'],
        message: 'Sessiz saatlerin başlangıcı ve bitişi birlikte girilmeli',
      });
    }
    if (value.quietHoursStart && value.quietHoursStart === value.quietHoursEnd) {
      ctx.addIssue({ code: 'custom', path: ['quietHoursEnd'], message: 'Bitiş başlangıçla aynı olamaz' });
    }
    if (!value.enabled) return;
    if (!value.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Kullanıcı kodu zorunlu' });
    if (!value.sender) ctx.addIssue({ code: 'custom', path: ['sender'], message: 'Gönderici başlığı zorunlu' });
  });

const whatsappChannelSchema = z.object({
  channel: z.literal('WHATSAPP'),
  enabled: z.boolean(),
  expectedUpdatedAt: expectedUpdatedAt.optional().nullable(),
});

export const channelConfigSchema = z.discriminatedUnion(
  'channel',
  [emailChannelSchema, smsChannelSchema, whatsappChannelSchema],
  { error: 'Geçersiz kanal' },
);

export const channelParamSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS, { error: 'Geçersiz kanal' }),
});

/** Kanal ayarının test gönderimi. */
export const channelTestSchema = z
  .object({
    channel: z.enum(['EMAIL', 'SMS'], { error: 'Test yalnızca e-posta ve SMS için' }),
    to: z.string({ error: 'Alıcı zorunlu' }).trim().min(1, 'Alıcı zorunlu').max(255, 'Alıcı çok uzun'),
  })
  .superRefine((value, ctx) => {
    if (value.channel === 'EMAIL' && !EMAIL_PATTERN.test(value.to)) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Geçerli bir e-posta adresi girin' });
    }
    if (value.channel === 'SMS' && value.to.replace(/\D/g, '').length < 10) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Geçerli bir telefon numarası girin' });
    }
  });

export const notificationHistoryQuerySchema = z.object({
  status: z.enum(NOTIFICATION_STATUSES, { error: 'Geçersiz durum' }).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS, { error: 'Geçersiz kanal' }).optional(),
  source: z.enum(NOTIFICATION_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
  reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }).optional(),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: cursorLimit(30, 100),
});

export const notificationParamSchema = z.object({
  notificationId: z.string().uuid({ message: 'Geçersiz bildirim' }),
});

/** Bekleyen gönderimin iptali sebep ister (geçmişte görünür). */
export const cancelNotificationSchema = z.object({
  reason: z
    .string({ error: 'İptal sebebini yazın' })
    .trim()
    .min(1, 'İptal sebebini yazın')
    .max(200, 'Sebep en fazla 200 karakter'),
});

export const staffAlertQuerySchema = z.object({
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: cursorLimit(STAFF_ALERT_PAGE_SIZE, 50),
});

export const staffAlertParamSchema = z.object({
  alertId: z.string().uuid({ message: 'Geçersiz uyarı' }),
});

export const staffAlertPreferencesSchema = z.object({
  mutedKinds: z
    .array(z.enum(STAFF_ALERT_KINDS, { error: 'Geçersiz uyarı türü' }))
    .max(STAFF_ALERT_KINDS.length)
    .transform((kinds) => [...new Set(kinds)]),
});
