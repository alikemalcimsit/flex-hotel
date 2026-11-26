import { api, apiBlob, withQuery } from './api.js';
import { HR_CHANNEL, PAYROLL_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { toastError } from '../store/toast.js';

/**
 * İK (modül 52): sorgu anahtarları, canlı tazeleme, personel seçici sorgusu, rozet tonları ve süre yazımı.
 * Hepsi `hr` kökünde: canlı haber tek anahtarla izin, bakiye, vardiya, puantaj, belge ve ayar ekranlarını yeniler.
 * Bordro kanalı da dinlenir: personel kartı (işe giriş / çıkış) değişince çizelge ve puantaj satırları değişir.
 */

export const hrKeys = Object.freeze({
  all: ['hr'],
  me: ['hr', 'me'],
  settings: ['hr', 'settings'],
  /** @param {object} filters */
  leaves: (filters) => ['hr', 'leaves', filters],
  /** @param {object} filters */
  balances: (filters) => ['hr', 'balances', filters],
  /** @param {string} employeeId @param {string | undefined} asOf */
  balance: (employeeId, asOf) => ['hr', 'balance', employeeId, asOf ?? null],
  /** @param {object} filters */
  shifts: (filters) => ['hr', 'shifts', filters],
  /** @param {object} filters */
  timesheets: (filters) => ['hr', 'timesheets', filters],
  /** @param {object} filters */
  documents: (filters) => ['hr', 'documents', filters],
  /** @param {string} search */
  employeePicker: (search) => ['hr', 'employee-picker', search],
});

/** İki tazeleme arası en kısa süre: puantaj girişinde saniyede birden çok haber gelebilir. */
const LIVE_MIN_REFRESH_MS = 1_500;

/** İK ekranı açıkken: izin, vardiya, puantaj, belge, ayar ve personel kartı değişince tazelenir. */
export function useHrLive() {
  useLiveChannel(PAYROLL_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [hrKeys.all] });
  return useLiveChannel(HR_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [hrKeys.all] });
}

/** Seçicide gelen personel sayısı. */
const PICKER_PAGE_SIZE = 30;

/**
 * Personel seçici sorgusu (izin, bakiye düzeltmesi, belge): ad, soyad ya da sicil; cevap `{ items }`,
 * her satır `{ id, code, firstName, lastName, department }`.
 * @param {string} search
 */
export const employeePickerQuery = (search) => ({
  queryKey: hrKeys.employeePicker(search),
  queryFn: () => api(withQuery('/payroll/employees', { search: search || undefined, page: 1, pageSize: PICKER_PAGE_SIZE })),
});

/** Personelin görünen adı: İK cevabında `name`, bordro listesinde `firstName` + `lastName`. @param {any} employee */
export const employeeName = (employee) => (employee ? employee.name ?? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() : '—');

export const LEAVE_STATUS_TONES = Object.freeze({ PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' });
export const TIMESHEET_STATUS_TONES = Object.freeze({ PRESENT: 'success', ABSENT: 'danger', LEAVE: 'info', REST: 'neutral', HOLIDAY: 'violet' });

/** Belgenin bitişine kalan günün rozet tonu: dolmuş kırmızı, eşik içinde sarı. @param {number | null} daysLeft @param {number} warnDays */
export function expiryTone(daysLeft, warnDays) {
  if (daysLeft === null || daysLeft === undefined) return 'neutral';
  if (daysLeft < 0) return 'danger';
  return daysLeft <= warnDays ? 'warning' : 'success';
}

/**
 * Dakikayı okunur yazar: 450 → "7s 30dk", 60 → "1s", 0 → "0dk".
 * @param {number | null | undefined} minutes
 */
export function minutesText(minutes) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}dk`;
  return rest === 0 ? `${hours}s` : `${hours}s ${rest}dk`;
}

/** Gün sayısı yazımı: 14 → "14", 1.5 → "1,5". @param {number | string | null | undefined} days */
export const daysText = (days) => (days === null || days === undefined ? '—' : Number(days).toLocaleString('tr-TR', { maximumFractionDigits: 1 }));

/** Belge dosyasını yeni sekmede açar (oturum başlığıyla indirilir, `<a href>` gönderemez). @param {string} documentId */
export async function openHrDocument(documentId) {
  const tab = window.open('', '_blank');
  try {
    const blob = await apiBlob(`/hr/documents/${documentId}/file`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    toastError(/** @type {Error} */ (error).message);
  }
}

/**
 * Dosyayı base64 okur (data URL'nin virgülden sonrası); sunucu `file.data` olarak bekler.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const comma = text.indexOf(',');
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.readAsDataURL(file);
  });
}
