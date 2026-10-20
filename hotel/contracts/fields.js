import { z } from './locale.js';
import { normalizeDecimalString } from './decimal.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';

/**
 * Yeniden kullanılan alan tipleri.
 *
 * Para/oran alanları uçtan uca **string** taşınır. Sebep: JavaScript `number`
 * ikili kayan noktadır; 2500 TL'lik oda ücretine %10 vergi uygularken biriken
 * yuvarlama farkı, ay sonunda mizanı tutmayan kuruşlara dönüşür. Hesap
 * gerektiğinde `@hotelos/core`'daki `money.js` kullanılır.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Decimal alan şeması.
 * @param {{ scale: number, min: number, max: number, label: string }} options
 */
export function decimalField({ scale, min, max, label }) {
  return z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => value.length > 0, { message: `${label} zorunlu` })
    .refine((value) => new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value), {
      message: `${label} pozitif olmalı ve en fazla ${scale} ondalık basamak içerebilir`,
    })
    .transform(normalizeDecimalString)
    // Number() yalnızca aralık *karşılaştırması* için; saklanan/taşınan değer string kalır.
    .refine((value) => Number(value) >= min && Number(value) <= max, {
      message: `${label} ${min} ile ${max} arasında olmalı`,
    });
}

/** Metnin başındaki "YYYY-AA-GG" günü (ardından saat gelebilir; baştaki boşluğu V8 yutar). */
const LEADING_ISO_DAY = /^\s*(\d{4}-\d{2}-\d{2})/;

/**
 * "YYYY-AA-GG" takvimde var olan bir gün mü? Gidiş-dönüş: `Date` 31 Şubat'ı reddetmez,
 * 3 Mart'a kaydırır — geri yazılan gün girilenle aynı değilse gün yoktur.
 * @param {string} day
 */
function isCalendarDayText(day) {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/**
 * Gün hassasiyetli tarih. `<input type="date">` "YYYY-MM-DD" gönderir → UTC gün başı.
 *
 * Geçersiz tarih **durdurucu** hatadır (`abort`): nesnenin dönem denetimleri
 * (bitiş ≥ başlangıç, en fazla N gün) bozuk `Date` ile çalışıp `toISOString`'de
 * çökmesin — boş tarihli form doğrulaması tarayıcıda sessizce dururdu, sorgu
 * parametresindeki bozuk tarih sunucuda 400 yerine 500 olurdu.
 *
 * "YYYY-AA-GG" ile başlayan metnin (yalın gün ya da saatli/ofsetli ISO damgası) günü
 * dönüşümden **önce** denetlenir: `new Date("2026-02-31")` hata vermez, 3 Mart olur;
 * yanlış gün sessizce kaydedilir/filtrelenirdi. `Date` nesnesi ve diğer metinler eskisi gibi.
 */
export const dateField = z
  .union([z.string(), z.date()])
  .refine((value) => value !== '', { message: 'Tarih seçin', abort: true })
  .refine(
    (value) => {
      if (typeof value !== 'string') return true;
      const day = LEADING_ISO_DAY.exec(value)?.[1];
      return day === undefined || isCalendarDayText(day);
    },
    { message: 'Geçersiz tarih', abort: true },
  )
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((value) => !Number.isNaN(value.getTime()), { message: 'Geçersiz tarih', abort: true });

/**
 * "YYYY-AA-GG" gün metni (sorgu parametresi; sunucu `${gün}::date` ile ham SQL'e verir).
 *
 * Biçim tek başına yetmez: "2026-02-31" kalıba uyar ama PostgreSQL'de "date/time field
 * value out of range" olur (400 yerine 500), `Date`'te de sessizce 3 Mart'a kayar.
 * Gidiş-dönüş ile takvimde olmayan gün reddedilir.
 */
export const isoDayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı')
  .refine(isCalendarDayText, { message: 'Tarih geçersiz' });

/**
 * Optimistic lock alanı: istemci en son gördüğü `updatedAt` değerini geri yollar.
 * Sunucu bu damgayla eşleşmeyen kaydı güncellemez.
 */
export const expectedUpdatedAt = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((value) => !Number.isNaN(value.getTime()), { message: 'Geçersiz sürüm damgası' });

export const idParamSchema = z.object({
  id: z.string().uuid({ message: 'Geçersiz kayıt kimliği' }),
});

/**
 * Sorgu dizesinden gelen evet/hayır değeri.
 *
 * `z.coerce.boolean()` burada yanlıştır: `Boolean("false") === true` olduğu
 * için `?includeOtherTypes=false` isteği "evet" diye okunur. Yalnızca açık
 * değerler kabul edilir.
 */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])], { error: 'Değer true veya false olmalı' })
  .transform((value) => value === true || value === 'true' || value === '1');

/**
 * Sorgu dizesinden gelen isteğe bağlı tam sayı. Boş metin "filtre yok"
 * demektir; `z.coerce.number()` onu sessizce 0'a çevirirdi.
 * @param {{ label: string, min: number, max: number }} options
 */
export function optionalQueryInt({ label, min, max }) {
  return z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce
      .number({ error: `${label} sayı olmalı` })
      .int(`${label} tam sayı olmalı`)
      .min(min, `${label} ${min} değerinden küçük olamaz`)
      .max(max, `${label} ${max} değerinden büyük olamaz`)
      .optional(),
  );
}

/** http(s) adresi mi? (Logo gibi dışarıya bağlanan alanlar için.) */
export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'Sayfa numarası sayı olmalı' })
    .int('Sayfa numarası tam sayı olmalı')
    .min(1, 'Sayfa numarası 1\'den küçük olamaz')
    .default(1),
  pageSize: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int('Sayfa boyutu tam sayı olmalı')
    .min(1, 'Sayfa boyutu en az 1 olmalı')
    .max(MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${MAX_PAGE_SIZE} olabilir`)
    .default(DEFAULT_PAGE_SIZE),
});

export const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
});

/**
 * Zod hatasını `{ alan: mesaj }` sözlüğüne çevirir — form ekranları girdilerin
 * altına basabilsin diye.
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
export function toFieldErrors(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
