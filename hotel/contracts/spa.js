import { isWallTime } from "./banquet.js";
import { MAX_PAGE_SIZE } from "./constants.js";
import { normalizeDecimalString } from "./decimal.js";
import {
  TIME_PATTERN,
  expectedUpdatedAt,
  isoDayField,
  paginationQuerySchema,
} from "./fields.js";
import { looksLikeCardNumber } from "./front-desk.js";
import {
  GUEST_PORTAL_LANGUAGES,
  guestPortalTokenSchema,
} from "./guest-portal.js";
import { z } from "./locale.js";
import { PAYMENT_NOTE_MAX, PAYMENT_REFERENCE_MAX } from "./payments.js";
import { moneyInputField } from "./reservations.js";

/**
 * SPA ve spor salonu randevuları (modül 57).
 *
 * Kararlar (kullanıcı, 13 Kasım 2026):
 * - **Kapsam:** birebir randevu (masaj, hamam, cilt bakımı, PT) + **kontenjanlı grup dersi** (yoga, pilates): seans,
 *   kayıt, dolunca yedek liste. Dışarıdan üyelik / aidat modül 84'ün işi.
 * - **Para:** oteldeki misafir oda hesabına yazdırır ya da spa kasasında öder; dışarıdan gelen kasada öder. Ödemeler
 *   kasa ekranında (17) **"Spa"** kaynağıyla görünür; büyük ödeme, iade ve hatalı giriş iptali dört göz onaylı.
 * - **İptal / gelmedi:** ücretsiz iptal süresi ve oranlar ayardan; bedel oteldeki misafirin folyosuna yazılır,
 *   yetkili gerekçeyle siler.
 * - **Portal (53):** misafir yalnız gerçekten boş saatleri görür, seçince randevu kesinleşir (terapist ve oda
 *   otomatik atanır).
 *
 * Bir randevu **terapist(ler)i ve odayı** birlikte tutar; hizmetin temizlik arası ikisini de bitişten sonra dolu
 * sayar. Çift masajı = 2 misafir + 2 terapist + bir oda. Saatler otelin **duvar saatiyle** girilir
 * ("2026-11-20T14:30") ve sunucuda gerçek ana çevrilir.
 *
 * Fiyat otelin vergi ayarına göredir (SPA vergi kategorisi): dahil vergide misafirin ödediği, hariç vergide matrah;
 * misafirin ödeyeceği toplam folyonun vergi motoruyla hesaplanır.
 */

const uuid = (message) => z.string().uuid({ message });

/* ─────────────── Türler ─────────────── */

export const SPA_SERVICE_KINDS = Object.freeze(["PRIVATE", "GROUP"]);
export const SPA_SERVICE_KIND_LABELS = Object.freeze({
  PRIVATE: "Birebir randevu",
  GROUP: "Grup dersi",
});

export const SPA_CATEGORIES = Object.freeze([
  "MASSAGE",
  "HAMMAM",
  "SKINCARE",
  "BODY",
  "FITNESS",
  "WELLNESS",
  "OTHER",
]);
export const SPA_CATEGORY_LABELS = Object.freeze({
  MASSAGE: "Masaj",
  HAMMAM: "Hamam",
  SKINCARE: "Cilt bakımı",
  BODY: "Vücut bakımı",
  FITNESS: "Fitness / PT",
  WELLNESS: "Yoga / pilates",
  OTHER: "Diğer",
});

export const SPA_ROOM_KINDS = Object.freeze([
  "TREATMENT",
  "HAMMAM",
  "STUDIO",
  "GYM",
  "OTHER",
]);
export const SPA_ROOM_KIND_LABELS = Object.freeze({
  TREATMENT: "Bakım odası",
  HAMMAM: "Hamam",
  STUDIO: "Stüdyo",
  GYM: "Spor salonu",
  OTHER: "Diğer",
});

export const SPA_GENDERS = Object.freeze(["FEMALE", "MALE"]);
export const SPA_GENDER_LABELS = Object.freeze({
  FEMALE: "Kadın",
  MALE: "Erkek",
});

export const SPA_APPOINTMENT_STATUSES = Object.freeze([
  "BOOKED",
  "WAITLISTED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);
export const SPA_APPOINTMENT_STATUS_LABELS = Object.freeze({
  BOOKED: "Randevulu",
  WAITLISTED: "Yedekte",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  NO_SHOW: "Gelmedi",
});
export const SPA_APPOINTMENT_STATUS_TONES = Object.freeze({
  BOOKED: "info",
  WAITLISTED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
});
/** Yeri tutan (kontenjanı / takvimi dolduran) durumlar. */
export const SPA_ACTIVE_STATUSES = Object.freeze(["BOOKED", "WAITLISTED"]);
/** Kapanmış (borcu kesinleşmiş) durumlar. */
export const SPA_CLOSED_STATUSES = Object.freeze([
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const SPA_SOURCES = Object.freeze(["STAFF", "PORTAL"]);
export const SPA_SOURCE_LABELS = Object.freeze({
  STAFF: "Personel",
  PORTAL: "Misafir portalı",
});

export const SPA_SESSION_STATUSES = Object.freeze([
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
]);
export const SPA_SESSION_STATUS_LABELS = Object.freeze({
  SCHEDULED: "Planlı",
  COMPLETED: "Yapıldı",
  CANCELLED: "İptal",
});
export const SPA_SESSION_STATUS_TONES = Object.freeze({
  SCHEDULED: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
});

export const SPA_PAYMENT_METHODS = Object.freeze(["CASH", "CARD"]);
/** Tamamlarken ücretin gideceği yer. */
export const SPA_SETTLE_MODES = Object.freeze(["ROOM", "DESK"]);
export const SPA_SETTLE_MODE_LABELS = Object.freeze({
  ROOM: "Oda hesabına yaz",
  DESK: "Spa kasasında ödenecek",
});

export const SPA_LANGUAGES = GUEST_PORTAL_LANGUAGES;
/** Türkçe asıl metindir; çeviriler bu dillerde tutulur. */
export const SPA_TRANSLATION_LANGUAGES = Object.freeze(
  SPA_LANGUAGES.filter((language) => language !== "tr"),
);

export const SPA_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
export const SPA_WEEKDAY_LABELS = Object.freeze({
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
});
export const SPA_WEEKDAY_SHORT = Object.freeze({
  1: "Pzt",
  2: "Sal",
  3: "Çar",
  4: "Per",
  5: "Cum",
  6: "Cmt",
  7: "Paz",
});

/* ─────────────── Sınırlar ve varsayılanlar ─────────────── */

export const SPA_SLOT_OPTIONS = Object.freeze([5, 10, 15, 20, 30, 60]);
export const SPA_MAX_SERVICES = 300;
export const SPA_MAX_THERAPISTS = 200;
export const SPA_MAX_ROOMS = 100;
/** Terapistin bir günde en fazla çalışma dilimi (bölünmüş vardiya). */
export const SPA_MAX_DAILY_SLICES = 3;
/** Bir blok en fazla bu kadar gün sürer (yıllık izin dahil). */
export const SPA_MAX_BLOCK_DAYS = 60;
/** Randevu / seans en fazla bu kadar gün ileriye açılır. */
export const SPA_MAX_ADVANCE_DAYS = 365;
/** "Her hafta tekrarla" bir seferde en fazla bu kadar seans açar. */
export const SPA_MAX_REPEAT_SESSIONS = 60;
/** Grup dersine tek kayıtta en fazla kişi (aile). */
export const SPA_MAX_ENROLL_GUESTS = 6;
/** Rapor ve liste aralığı en fazla bu kadar gün. */
export const SPA_MAX_RANGE_DAYS = 366;
export const SPA_NOTE_MAX = 500;
export const SPA_REASON_MIN = 3;
export const SPA_REASON_MAX = 300;
export const SPA_APPOINTMENTS_PAGE_SIZE = 50;
/** Misafir portalında gösterilen yaklaşan seans sayısı. */
export const SPA_PORTAL_SESSION_LIMIT = 60;

export const SPA_DEFAULT_SETTINGS = Object.freeze({
  openMinute: 540,
  closeMinute: 1320,
  slotMinutes: 15,
  freeCancelHours: 4,
  lateCancelFeePct: "50.00",
  noShowFeePct: "100.00",
  portalEnabled: false,
  portalLeadMinutes: 120,
  portalMaxActive: 4,
  reminderHours: 2,
});

/* ─────────────── Saf kurallar ─────────────── */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** "14:30" → 870. Geçersizse `NaN`. @param {string} time */
export function spaMinuteOfDay(time) {
  const match = TIME_PATTERN.exec(time ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

/** 870 → "14:30" (1440 → "24:00"). @param {number} minute */
export function spaTimeOfMinute(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Günün ISO haftanın günü: 1 = Pazartesi … 7 = Pazar. @param {string} day "YYYY-MM-DD" */
export function spaWeekday(day) {
  const index = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return index === 0 ? 7 : index;
}

/** @param {string} day "YYYY-MM-DD" @param {number} count */
export function addSpaDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** İki gün arasındaki gün farkı (to − from). @param {string} from @param {string} to */
export const spaDaysBetween = (from, to) =>
  Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      DAY_MS,
  );

/**
 * Hizmetin başlayabileceği dakikalar: açılıştan itibaren aralık adımıyla, hizmet kapanıştan önce bitecek şekilde.
 * @param {{ openMinute: number, closeMinute: number, slotMinutes: number, durationMinutes: number }} input
 * @returns {number[]}
 */
export function spaSlotMinutes({
  openMinute,
  closeMinute,
  slotMinutes,
  durationMinutes,
}) {
  const starts = [];
  for (
    let minute = openMinute;
    minute + durationMinutes <= closeMinute;
    minute += slotMinutes
  )
    starts.push(minute);
  return starts;
}

/**
 * Terapist o hafta gününde [başlangıç, bitiş) aralığının tamamında çalışıyor mu? Bitişik dilimler birleşik sayılır
 * (09:00–13:00 + 13:00–18:00 → 12:30–13:30 uygun).
 * @param {Array<{ weekday: number, startMinute: number, endMinute: number }>} hours
 * @param {number} weekday @param {number} startMinute @param {number} endMinute
 */
export function spaTherapistCovers(hours, weekday, startMinute, endMinute) {
  const slices = hours
    .filter((row) => row.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
  let cursor = startMinute;
  for (const slice of slices) {
    if (slice.startMinute > cursor) break;
    if (slice.endMinute > cursor) cursor = slice.endMinute;
    if (cursor >= endMinute) return true;
  }
  return cursor >= endMinute;
}

/** @param {Array<{ start: number, end: number }>} busy @param {number} start @param {number} end */
const overlaps = (busy, start, end) =>
  busy.some((row) => row.start < end && start < row.end);

/**
 * @typedef {{ id: string, gender: string | null, sortOrder: number, name: string, hours: Array<{ weekday: number, startMinute: number, endMinute: number }>, busy: Array<{ start: number, end: number }>, load: number }} SpaTherapistSlot
 * @typedef {{ id: string, sortOrder: number, name: string, busy: Array<{ start: number, end: number }> }} SpaRoomSlot
 */

/**
 * Bir başlangıç için terapist(ler) ve oda seçer.
 *
 * - Terapist: hizmeti verebilen, o saatte çalışan (çalışma saati hizmetin süresini kapsar) ve temizlik arası dahil
 *   boş olanlar. İstenmişse belirli terapistler; yoksa tercih edilen cinsiyet. Birden fazla uygun varsa **o gün en
 *   az yüklü olan** seçilir (iş adil dağılsın), eşitlikte sıra → ad → kimlik.
 * - Oda: hizmete uygun, temizlik arası dahil boş ilk oda (sıraya göre); istenmişse o oda.
 *
 * Zamanlar epoch milisaniyesidir (`at`); çalışma saati duvar saatinin dakikasıyla (`minute`) denetlenir.
 *
 * @param {{
 *   service: { therapistCount: number, requiresRoom: boolean, durationMinutes: number, bufferMinutes: number },
 *   weekday: number, minute: number, at: number,
 *   therapists: SpaTherapistSlot[], rooms: SpaRoomSlot[],
 *   therapistIds?: string[] | null, roomId?: string | null, gender?: string | null,
 * }} input
 * @returns {{ therapistIds: string[], roomId: string | null } | { error: 'NO_THERAPIST' | 'NO_ROOM' | 'OUTSIDE_HOURS' | 'THERAPIST_BUSY' | 'ROOM_BUSY' }}
 */
export function pickSpaResources({
  service,
  weekday,
  minute,
  at,
  therapists,
  rooms,
  therapistIds = null,
  roomId = null,
  gender = null,
}) {
  const end = at + service.durationMinutes * MINUTE_MS;
  const busyUntil = end + service.bufferMinutes * MINUTE_MS;
  const endMinute = minute + service.durationMinutes;
  const works = (therapist) =>
    spaTherapistCovers(therapist.hours, weekday, minute, endMinute);
  const free = (resource) => !overlaps(resource.busy, at, busyUntil);

  /** @type {string[]} */
  let chosen = [];
  if (service.therapistCount > 0) {
    if (therapistIds?.length) {
      // Personelin seçtiği terapist(ler): sayı tutmalı, her biri çalışıyor ve boş olmalı.
      const requested = therapistIds.map((id) =>
        therapists.find((row) => row.id === id),
      );
      if (
        requested.length !== service.therapistCount ||
        requested.some((row) => !row)
      )
        return { error: "NO_THERAPIST" };
      if (
        requested.some((row) => !works(/** @type {SpaTherapistSlot} */ (row)))
      )
        return { error: "OUTSIDE_HOURS" };
      if (requested.some((row) => !free(/** @type {SpaTherapistSlot} */ (row))))
        return { error: "THERAPIST_BUSY" };
      chosen = therapistIds;
    } else {
      const candidates = therapists
        .filter(
          (row) =>
            (!gender || row.gender === gender) && works(row) && free(row),
        )
        .sort(
          (a, b) =>
            a.load - b.load ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name, "tr") ||
            a.id.localeCompare(b.id),
        );
      if (candidates.length < service.therapistCount)
        return { error: "NO_THERAPIST" };
      chosen = candidates.slice(0, service.therapistCount).map((row) => row.id);
    }
  }

  let room = null;
  if (service.requiresRoom) {
    if (roomId) {
      const requested = rooms.find((row) => row.id === roomId);
      if (!requested) return { error: "NO_ROOM" };
      if (!free(requested)) return { error: "ROOM_BUSY" };
      room = requested.id;
    } else {
      const candidate = [...rooms]
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name, "tr") ||
            a.id.localeCompare(b.id),
        )
        .find(free);
      if (!candidate) return { error: "NO_ROOM" };
      room = candidate.id;
    }
  }
  return { therapistIds: chosen, roomId: room };
}

/** Kaynak seçilemediğinde kullanıcıya yazılan sebep. */
export const SPA_PICK_ERRORS = Object.freeze({
  NO_THERAPIST: "Bu saatte uygun terapist yok",
  NO_ROOM: "Bu saatte uygun oda yok",
  OUTSIDE_HOURS: "Seçilen terapist bu saatte çalışmıyor",
  THERAPIST_BUSY: "Seçilen terapist bu saatte dolu",
  ROOM_BUSY: "Seçilen oda bu saatte dolu",
});

/**
 * İptal / gelmedi bedelinin oranı.
 *
 * - Gelmedi: `noShowFeePct`.
 * - İptal: randevuya `freeCancelHours` saatten fazla varsa ücretsiz; daha geçse `lateCancelFeePct`.
 *
 * @param {{ startsAt: Date | number, at: Date | number, outcome: 'CANCELLED' | 'NO_SHOW', settings: { freeCancelHours: number, lateCancelFeePct: string | number, noShowFeePct: string | number } }} input
 * @returns {{ pct: string, late: boolean }}
 */
export function spaCancellationPct({ startsAt, at, outcome, settings }) {
  if (outcome === "NO_SHOW")
    return {
      pct: normalizeDecimalString(String(settings.noShowFeePct)),
      late: true,
    };
  const hoursBefore = (Number(startsAt) - Number(at)) / 3_600_000;
  if (hoursBefore >= settings.freeCancelHours) return { pct: "0", late: false };
  return {
    pct: normalizeDecimalString(String(settings.lateCancelFeePct)),
    late: true,
  };
}

/**
 * "Her hafta tekrarla": ilk günden bitiş gününe kadar seçilen hafta günlerine düşen günler (ilk gün dahil).
 * @param {{ day: string, weekdays: number[], until: string, max?: number }} input
 * @returns {string[]}
 */
export function spaRepeatDays({
  day,
  weekdays,
  until,
  max = SPA_MAX_REPEAT_SESSIONS,
}) {
  const days = [day];
  const wanted = new Set(weekdays);
  for (
    let cursor = addSpaDays(day, 1);
    cursor <= until && days.length < max;
    cursor = addSpaDays(cursor, 1)
  ) {
    if (wanted.has(spaWeekday(cursor))) days.push(cursor);
  }
  return days;
}

/**
 * Hizmetin misafirin dilindeki adı ve açıklaması (çevirisi yoksa Türkçesi).
 * @param {{ name: string, description?: string | null, translations?: any }} service @param {string} language
 */
export function spaServiceText(service, language) {
  const translated =
    language === "tr" ? null : service.translations?.[language];
  return {
    name: translated?.name?.trim() || service.name,
    description: translated?.description?.trim() || service.description || null,
  };
}

/** Çevirisi eksik diller (ekrandaki uyarı). @param {{ translations?: any }} service */
export function spaMissingTranslations(service) {
  return SPA_TRANSLATION_LANGUAGES.filter(
    (language) => !service.translations?.[language]?.name?.trim(),
  );
}

/**
 * Portaldan randevu alınabilecek günler: konaklamanın giriş ve çıkış günleri arası (ikisi dahil), bugünden önce değil.
 * @param {{ checkIn: string, checkOut: string, today: string }} stay
 */
export function spaPortalWindow({ checkIn, checkOut, today }) {
  const from = checkIn > today ? checkIn : today;
  return from <= checkOut ? { from, to: checkOut } : null;
}

/* ─────────────── Alanlar ─────────────── */

const text = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const nameField = (label, max = 80) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(2, `${label} en az 2 karakter`)
    .max(max, `${label} en fazla ${max} karakter`);

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(SPA_REASON_MIN, `${label} en az ${SPA_REASON_MIN} karakter`)
    .max(SPA_REASON_MAX, `${label} en fazla ${SPA_REASON_MAX} karakter`);

const wallTime = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .refine((value) => value !== "", { message: `${label} seçin`, abort: true })
    .refine((value) => isWallTime(value), {
      message: `${label} geçersiz (gün ve saat seçin)`,
      abort: true,
    });

const timeField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .regex(TIME_PATTERN, `${label} SS:dd biçiminde olmalı`);

const intField = (label, min, max) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(min, `${label} en az ${min}`)
    .max(max, `${label} en fazla ${max}`);

const pctField = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => String(value).trim().replace(",", "."))
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
      message: `${label} geçersiz (en fazla 2 ondalık)`,
    })
    .transform(normalizeDecimalString)
    .refine((value) => Number(value) <= 100, {
      message: `${label} en fazla %100`,
    });

const sortOrderField = intField("Sıra", 0, 9999).default(0);
const idList = (label, max) =>
  z
    .array(uuid(`Geçersiz ${label}`))
    .max(max, `En fazla ${max} ${label}`)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: `Aynı ${label} iki kez seçilmiş`,
    });
const phoneField = z
  .string()
  .trim()
  .max(30, "Telefon en fazla 30 karakter")
  .refine((value) => value === "" || /^[+\d][\d\s()-]{5,}$/.test(value), {
    message: "Telefon geçersiz",
  })
  .transform((value) => value || null)
  .nullish();
const genderField = z
  .enum(SPA_GENDERS, { error: "Geçersiz tercih" })
  .nullish()
  .transform((value) => value ?? null);

/* ─────────────── Ayarlar ─────────────── */

export const spaSettingsSchema = z
  .object({
    /** İlk kayıtta boş (satır yok). */
    expectedUpdatedAt: expectedUpdatedAt.nullable(),
    openTime: timeField("Açılış"),
    closeTime: timeField("Kapanış").or(z.literal("24:00")),
    slotMinutes: z.coerce
      .number()
      .refine((value) => SPA_SLOT_OPTIONS.includes(value), {
        message: "Aralık seçin",
      }),
    freeCancelHours: intField("Ücretsiz iptal süresi", 0, 168),
    lateCancelFeePct: pctField("Geç iptal bedeli"),
    noShowFeePct: pctField("Gelmedi bedeli"),
    portalEnabled: z.boolean(),
    portalLeadMinutes: intField("En az kaç dakika önceden", 0, 10080),
    portalMaxActive: intField("Konaklama başına açık randevu", 1, 20),
    reminderHours: intField("Hatırlatma", 0, 72),
  })
  .superRefine((value, ctx) => {
    const open = spaMinuteOfDay(value.openTime);
    const close =
      value.closeTime === "24:00" ? 1440 : spaMinuteOfDay(value.closeTime);
    if (close - open < 60)
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "Kapanış açılıştan en az bir saat sonra olmalı",
      });
  });

/* ─────────────── Oda, terapist, hizmet ─────────────── */

export const spaRoomInputSchema = z.object({
  name: nameField("Oda adı", 60),
  kind: z.enum(SPA_ROOM_KINDS, { error: "Oda türü seçin" }),
  isActive: z.boolean().default(true),
  sortOrder: sortOrderField,
});
export const spaRoomUpdateSchema = spaRoomInputSchema.extend({
  expectedUpdatedAt,
});

const hourRow = z
  .object({
    weekday: z.coerce
      .number()
      .int()
      .min(1, "Gün geçersiz")
      .max(7, "Gün geçersiz"),
    start: timeField("Başlangıç"),
    end: timeField("Bitiş").or(z.literal("24:00")),
  })
  .refine(
    (value) =>
      (value.end === "24:00" ? 1440 : spaMinuteOfDay(value.end)) >
      spaMinuteOfDay(value.start),
    { path: ["end"], message: "Bitiş başlangıçtan sonra olmalı" },
  );

const therapistShape = {
  name: nameField("Ad soyad"),
  title: text(60, "Unvan"),
  gender: genderField,
  phone: phoneField,
  isActive: z.boolean().default(true),
  sortOrder: sortOrderField,
  /** Haftalık çalışma saatleri; boşsa terapiste randevu verilemez. */
  hours: z
    .array(hourRow)
    .max(7 * SPA_MAX_DAILY_SLICES, "Çok fazla çalışma dilimi"),
  /** Verebildiği hizmetler. */
  serviceIds: idList("hizmet", SPA_MAX_SERVICES).default([]),
};

/** @param {any} value @param {import('zod').RefinementCtx} ctx */
function refineTherapist(value, ctx) {
  for (const weekday of SPA_WEEKDAYS) {
    const slices = value.hours
      .map((row, index) => ({
        index,
        weekday: row.weekday,
        start: spaMinuteOfDay(row.start),
        end: row.end === "24:00" ? 1440 : spaMinuteOfDay(row.end),
      }))
      .filter((row) => row.weekday === weekday)
      .sort((a, b) => a.start - b.start);
    if (slices.length > SPA_MAX_DAILY_SLICES)
      ctx.addIssue({
        code: "custom",
        path: ["hours"],
        message: `${SPA_WEEKDAY_LABELS[weekday]}: en fazla ${SPA_MAX_DAILY_SLICES} dilim`,
      });
    for (let index = 1; index < slices.length; index += 1) {
      if (slices[index].start < slices[index - 1].end)
        ctx.addIssue({
          code: "custom",
          path: ["hours", slices[index].index, "start"],
          message: `${SPA_WEEKDAY_LABELS[weekday]}: dilimler çakışıyor`,
        });
    }
  }
}

export const spaTherapistInputSchema = z
  .object(therapistShape)
  .superRefine(refineTherapist);
export const spaTherapistUpdateSchema = z
  .object({ ...therapistShape, expectedUpdatedAt })
  .superRefine(refineTherapist);

const translationBlock = z.object({
  name: z.string().trim().max(80, "Ad en fazla 80 karakter").default(""),
  description: z
    .string()
    .trim()
    .max(600, "Açıklama en fazla 600 karakter")
    .default(""),
});

const serviceShape = {
  name: nameField("Hizmet adı"),
  description: text(600, "Açıklama"),
  translations: z
    .object(
      Object.fromEntries(
        SPA_TRANSLATION_LANGUAGES.map((language) => [
          language,
          translationBlock.default({ name: "", description: "" }),
        ]),
      ),
    )
    .default({}),
  category: z.enum(SPA_CATEGORIES, { error: "Kategori seçin" }),
  kind: z.enum(SPA_SERVICE_KINDS, { error: "Tür seçin" }),
  durationMinutes: intField("Süre", 5, 600),
  bufferMinutes: intField("Temizlik arası", 0, 120).default(0),
  price: moneyInputField,
  therapistCount: intField("Terapist sayısı", 0, 4).default(1),
  guestCount: intField("Misafir sayısı", 1, 4).default(1),
  capacity: intField("Kontenjan", 2, 500)
    .nullish()
    .transform((value) => value ?? null),
  requiresRoom: z.boolean().default(true),
  portalBookable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: sortOrderField,
  therapistIds: idList("terapist", SPA_MAX_THERAPISTS).default([]),
  roomIds: idList("oda", SPA_MAX_ROOMS).default([]),
};

/** @param {any} value @param {import('zod').RefinementCtx} ctx */
function refineService(value, ctx) {
  if (value.kind === "GROUP") {
    if (value.capacity === null)
      ctx.addIssue({
        code: "custom",
        path: ["capacity"],
        message: "Grup dersinin kontenjanını yazın",
      });
    if (value.therapistCount > 1)
      ctx.addIssue({
        code: "custom",
        path: ["therapistCount"],
        message: "Grup dersinde en fazla bir eğitmen",
      });
    if (value.guestCount !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["guestCount"],
        message: "Grup dersinde kişi sayısı kayıtta girilir",
      });
  } else if (value.capacity !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["capacity"],
      message: "Kontenjan yalnız grup dersinde",
    });
  }
  if (value.therapistIds.length < value.therapistCount) {
    ctx.addIssue({
      code: "custom",
      path: ["therapistIds"],
      message:
        value.therapistCount === 1
          ? "Hizmeti verebilen en az bir terapist seçin"
          : `Hizmeti verebilen en az ${value.therapistCount} terapist seçin`,
    });
  }
  if (value.requiresRoom && value.roomIds.length === 0)
    ctx.addIssue({
      code: "custom",
      path: ["roomIds"],
      message: "Hizmetin verilebildiği en az bir oda seçin",
    });
}

export const spaServiceInputSchema = z
  .object(serviceShape)
  .superRefine(refineService);
export const spaServiceUpdateSchema = z
  .object({ ...serviceShape, expectedUpdatedAt })
  .superRefine(refineService);

export const spaEntityParamSchema = z.object({ id: uuid("Geçersiz kayıt") });
/** Silme: iyimser kilit sorgu parametresinde. */
export const spaDeleteQuerySchema = z.object({ expectedUpdatedAt });

/* ─────────────── Blok (izin, bakım) ─────────────── */

export const spaBlockInputSchema = z
  .object({
    therapistId: uuid("Geçersiz terapist")
      .nullish()
      .transform((value) => value ?? null),
    roomId: uuid("Geçersiz oda")
      .nullish()
      .transform((value) => value ?? null),
    startsAt: wallTime("Başlangıç"),
    endsAt: wallTime("Bitiş"),
    reason: reasonField("Sebep"),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.therapistId) === Boolean(value.roomId))
      ctx.addIssue({
        code: "custom",
        path: ["therapistId"],
        message: "Bir terapist ya da bir oda seçin",
      });
    if (value.endsAt <= value.startsAt)
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Bitiş başlangıçtan sonra olmalı",
      });
    else if (
      spaDaysBetween(value.startsAt.slice(0, 10), value.endsAt.slice(0, 10)) >
      SPA_MAX_BLOCK_DAYS
    )
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: `Blok en fazla ${SPA_MAX_BLOCK_DAYS} gün sürebilir`,
      });
  });

const rangeShape = { from: isoDayField, to: isoDayField };
/** @param {{ from: string, to: string }} value @param {import('zod').RefinementCtx} ctx */
function refineRange(value, ctx) {
  if (value.to < value.from)
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: "Bitiş başlangıçtan önce olamaz",
    });
  else if (spaDaysBetween(value.from, value.to) + 1 > SPA_MAX_RANGE_DAYS)
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: `Aralık en fazla ${SPA_MAX_RANGE_DAYS} gün olabilir`,
    });
}

export const spaBlockListQuerySchema = paginationQuerySchema
  .extend(rangeShape)
  .superRefine(refineRange);
export const spaBlockParamSchema = z.object({ blockId: uuid("Geçersiz blok") });

/* ─────────────── Takvim ve boş saat ─────────────── */

export const spaCalendarQuerySchema = z.object({ day: isoDayField });
export const spaAvailabilityQuerySchema = z.object({
  serviceId: uuid("Hizmet seçin"),
  day: isoDayField,
  therapistId: uuid("Geçersiz terapist").optional(),
  gender: z.enum(SPA_GENDERS, { error: "Geçersiz tercih" }).optional(),
  /** Yeniden planlamada randevunun kendi tutmaları boş sayılır. */
  ignoreAppointmentId: uuid("Geçersiz randevu").optional(),
});

/* ─────────────── Randevu ─────────────── */

const customerShape = {
  /** Oteldeki / gelecek misafir: konaklama. Dışarıdan gelen: ad (ve telefon). */
  reservationId: uuid("Geçersiz konaklama")
    .nullish()
    .transform((value) => value ?? null),
  customerName: z
    .string()
    .trim()
    .max(120, "Ad en fazla 120 karakter")
    .nullish()
    .transform((value) => value || null),
  customerPhone: phoneField,
};
/** @param {any} value @param {import('zod').RefinementCtx} ctx */
function refineCustomer(value, ctx) {
  if (!value.reservationId && (value.customerName?.length ?? 0) < 2)
    ctx.addIssue({
      code: "custom",
      path: ["customerName"],
      message: "Misafiri seçin ya da dışarıdan gelenin adını yazın",
    });
}

export const spaAppointmentCreateSchema = z
  .object({
    /** Tekrar gönderime karşı istek kimliği (aynı istek ikinci randevu açmaz). */
    requestId: uuid("Geçersiz istek"),
    serviceId: uuid("Hizmet seçin"),
    startsAt: wallTime("Randevu saati"),
    ...customerShape,
    /** Boşsa uygun terapist(ler) otomatik atanır. */
    therapistIds: idList("terapist", 4)
      .nullish()
      .transform((value) => (value?.length ? value : null)),
    /** Boşsa uygun oda otomatik atanır. */
    roomId: uuid("Geçersiz oda")
      .nullish()
      .transform((value) => value ?? null),
    therapistPreference: genderField,
    note: text(SPA_NOTE_MAX, "Not"),
  })
  .superRefine(refineCustomer);

/** Yeniden planlama / atama / not (yalnız açık randevu). Gönderilmeyen alan değişmez. */
export const spaAppointmentUpdateSchema = z.object({
  expectedUpdatedAt,
  startsAt: wallTime("Randevu saati").optional(),
  therapistIds: idList("terapist", 4).nullable().optional(),
  roomId: uuid("Geçersiz oda").nullable().optional(),
  therapistPreference: z
    .enum(SPA_GENDERS, { error: "Geçersiz tercih" })
    .nullable()
    .optional(),
  note: text(SPA_NOTE_MAX, "Not").optional(),
  customerName: z
    .string()
    .trim()
    .min(2, "Ad en az 2 karakter")
    .max(120, "Ad en fazla 120 karakter")
    .optional(),
  customerPhone: phoneField.optional(),
});

/** Fiyatı elle belirleme (ikram, paket, VIP): gerekçeli, yetkili. */
export const spaAppointmentPriceSchema = z.object({
  expectedUpdatedAt,
  price: moneyInputField,
  reason: reasonField("Gerekçe"),
});

export const spaCompleteSchema = z.object({
  expectedUpdatedAt,
  settle: z.enum(SPA_SETTLE_MODES, {
    error: "Ücretin nereye gideceğini seçin",
  }),
});

export const spaCancelSchema = z
  .object({
    expectedUpdatedAt,
    reason: reasonField("Gerekçe"),
    /** Bedeli alma (yetkili, gerekçeli). */
    waiveFee: z.boolean().default(false),
    waiveReason: z
      .string()
      .trim()
      .max(SPA_REASON_MAX, `Gerekçe en fazla ${SPA_REASON_MAX} karakter`)
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    if (value.waiveFee && (value.waiveReason?.length ?? 0) < SPA_REASON_MIN)
      ctx.addIssue({
        code: "custom",
        path: ["waiveReason"],
        message: "Bedelin neden alınmadığını yazın",
      });
  });

export const spaRestoreSchema = z.object({ expectedUpdatedAt });
export const spaRoomChargeSchema = z.object({
  requestId: uuid("Geçersiz istek"),
  expectedUpdatedAt,
});

export const SPA_APPOINTMENT_VIEWS = Object.freeze(["ALL", "OPEN_BALANCE"]);
export const spaAppointmentListQuerySchema = paginationQuerySchema
  .extend({
    ...rangeShape,
    view: z.enum(SPA_APPOINTMENT_VIEWS).default("ALL"),
    status: z
      .enum(SPA_APPOINTMENT_STATUSES, { error: "Geçersiz durum" })
      .optional(),
    serviceId: uuid("Geçersiz hizmet").optional(),
    therapistId: uuid("Geçersiz terapist").optional(),
    search: z
      .string()
      .trim()
      .max(120, "Arama metni en fazla 120 karakter")
      .optional(),
  })
  .superRefine(refineRange);

export const spaAppointmentParamSchema = z.object({
  appointmentId: uuid("Geçersiz randevu"),
});
export const spaStaySearchQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .min(1, "Oda ya da ad yazın")
    .max(80, "Arama metni en fazla 80 karakter"),
});

/* ─────────────── Ödeme ─────────────── */

const paymentText = (max, label, cardMessage = "Kart numarası yazılamaz") =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: cardMessage })
    .transform((value) => value || null)
    .nullish();

export const spaPaymentSchema = z
  .object({
    requestId: uuid("Geçersiz istek"),
    kind: z.enum(["PAYMENT", "REFUND"], { error: "İşlem türü geçersiz" }),
    method: z.enum(SPA_PAYMENT_METHODS, { error: "Ödeme yöntemi seçin" }),
    amount: moneyInputField.refine((value) => Number(value) > 0, {
      message: "Tutar 0'dan büyük olmalı",
    }),
    reference: paymentText(
      PAYMENT_REFERENCE_MAX,
      "Referans",
      "Kart numarası yazılamaz; slip numarasını yazın",
    ),
    note: paymentText(PAYMENT_NOTE_MAX, "Not"),
  })
  .superRefine((value, ctx) => {
    if (value.method === "CARD" && !value.reference)
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Slip numarası zorunlu",
      });
    if (value.kind === "REFUND" && !value.note)
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "İade sebebini yazın",
      });
  });

export const spaPaymentVoidSchema = z.object({
  reason: reasonField("İptal gerekçesi").refine(
    (value) => !looksLikeCardNumber(value),
    { message: "Kart numarası yazılamaz" },
  ),
});
export const spaPaymentParamSchema = z.object({
  appointmentId: uuid("Geçersiz randevu"),
  paymentId: uuid("Geçersiz ödeme"),
});
export const spaPaymentRefParamSchema = z.object({
  paymentId: uuid("Geçersiz ödeme"),
});

/* ─────────────── Grup dersi ─────────────── */

export const spaSessionCreateSchema = z
  .object({
    serviceId: uuid("Ders seçin"),
    startsAt: wallTime("Ders saati"),
    /** Eğitmen (hizmet eğitmen istiyorsa zorunlu). */
    therapistId: uuid("Geçersiz eğitmen")
      .nullish()
      .transform((value) => value ?? null),
    roomId: uuid("Geçersiz salon")
      .nullish()
      .transform((value) => value ?? null),
    /** Boşsa hizmetin kontenjanı / fiyatı. */
    capacity: intField("Kontenjan", 1, 500)
      .nullish()
      .transform((value) => value ?? null),
    price: moneyInputField.nullish().transform((value) => value ?? null),
    note: text(SPA_NOTE_MAX, "Not"),
    /** Her hafta tekrarla: seçilen günlerde, bitiş gününe kadar. */
    repeat: z
      .object({
        weekdays: z
          .array(z.coerce.number().int().min(1).max(7))
          .min(1, "En az bir gün seçin")
          .max(7),
        until: isoDayField,
      })
      .nullish()
      .transform((value) => value ?? null),
  })
  .superRefine((value, ctx) => {
    if (!value.repeat) return;
    const day = value.startsAt.slice(0, 10);
    if (value.repeat.until < day)
      ctx.addIssue({
        code: "custom",
        path: ["repeat", "until"],
        message: "Bitiş günü ilk dersten önce olamaz",
      });
    else if (spaDaysBetween(day, value.repeat.until) > SPA_MAX_ADVANCE_DAYS)
      ctx.addIssue({
        code: "custom",
        path: ["repeat", "until"],
        message: `En fazla ${SPA_MAX_ADVANCE_DAYS} gün ileriye açılır`,
      });
  });

export const spaSessionUpdateSchema = z.object({
  expectedUpdatedAt,
  startsAt: wallTime("Ders saati").optional(),
  therapistId: uuid("Geçersiz eğitmen").nullable().optional(),
  roomId: uuid("Geçersiz salon").nullable().optional(),
  capacity: intField("Kontenjan", 1, 500).optional(),
  note: text(SPA_NOTE_MAX, "Not").optional(),
});

export const spaSessionCancelSchema = z.object({
  expectedUpdatedAt,
  reason: reasonField("İptal gerekçesi"),
});
export const spaSessionCompleteSchema = z.object({ expectedUpdatedAt });

export const spaEnrollSchema = z
  .object({
    requestId: uuid("Geçersiz istek"),
    ...customerShape,
    guestCount: intField("Kişi sayısı", 1, SPA_MAX_ENROLL_GUESTS).default(1),
    /** Ders doluysa yedek listeye yaz. */
    waitlist: z.boolean().default(false),
    note: text(SPA_NOTE_MAX, "Not"),
  })
  .superRefine(refineCustomer);

export const spaSessionListQuerySchema = paginationQuerySchema
  .extend({
    ...rangeShape,
    serviceId: uuid("Geçersiz ders").optional(),
    status: z
      .enum(SPA_SESSION_STATUSES, { error: "Geçersiz durum" })
      .optional(),
  })
  .superRefine(refineRange);
export const spaSessionParamSchema = z.object({
  sessionId: uuid("Geçersiz seans"),
});

/* ─────────────── Rapor ─────────────── */

export const spaReportQuerySchema = z
  .object(rangeShape)
  .superRefine(refineRange);

/* ─────────────── Misafir portalı ─────────────── */

export const spaPortalAvailabilityQuerySchema = z.object({
  serviceId: uuid("Hizmet seçin"),
  day: isoDayField,
  gender: z.enum(SPA_GENDERS, { error: "Geçersiz tercih" }).optional(),
});

export const spaPortalBookSchema = z.object({
  requestId: uuid("Geçersiz istek"),
  serviceId: uuid("Hizmet seçin"),
  day: isoDayField,
  time: timeField("Saat"),
  gender: genderField,
  note: text(SPA_NOTE_MAX, "Not"),
});

export const spaPortalEnrollSchema = z.object({
  requestId: uuid("Geçersiz istek"),
  guestCount: intField("Kişi sayısı", 1, SPA_MAX_ENROLL_GUESTS).default(1),
  waitlist: z.boolean().default(false),
});

export const spaPortalAppointmentParamSchema = guestPortalTokenSchema.extend({
  appointmentId: uuid("Geçersiz randevu"),
});
export const spaPortalSessionParamSchema = guestPortalTokenSchema.extend({
  sessionId: uuid("Geçersiz seans"),
});

/** Sayfa boyutu üst sınırı (liste uçları). */
export const SPA_MAX_PAGE_SIZE = MAX_PAGE_SIZE;
