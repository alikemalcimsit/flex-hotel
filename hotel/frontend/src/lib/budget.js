import { useQuery } from '@tanstack/react-query';
import { BUDGET_MONTH_LABELS, BUDGET_MONTHS } from '@hotelos/hotel-contracts';
import { api, withQuery } from './api.js';
import { BUDGET_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Bütçe (modül 27): sorgu anahtarları, canlı tazeleme, biçim ve Excel şablonu.
 *
 * Anahtar öneki `['budget', ...]`; `budget.changed` kanalı (sürüm, gider
 * kalemi, gerçekleşen, AI yorumu) hepsini tazeler.
 */

export const budgetKeys = Object.freeze({
  all: ['budget'],
  /** @param {number} year */
  year: (year) => ['budget', 'year', year],
  /** @param {number} year */
  actuals: (year) => ['budget', 'actuals', year],
  expenseItems: ['budget', 'expense-items'],
  /** @param {{ year: number, month: number, scope: string }} query */
  variance: (query) => ['budget', 'variance', query.year, query.month, query.scope],
  /** @param {{ year: number, month: number, scope: string }} query */
  commentary: (query) => ['budget', 'commentary', query.year, query.month, query.scope],
});

/** Canlı tazelemede en kısa aralık: kaydeden kişinin kendi değişikliği zaten yenilendi. */
const LIVE_MIN_REFRESH_MS = 2_000;

/** Bütçe ekranları açıkken kanal dinlenir. */
export function useBudgetLive() {
  return useLiveChannel(BUDGET_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [budgetKeys.all] });
}

/** @param {number} year */
export function useBudgetYear(year) {
  return useQuery({ queryKey: budgetKeys.year(year), queryFn: () => api(`/budgets/${year}`) });
}

/** @param {{ year: number, month: number, scope: string }} query */
export function useVariance(query) {
  return useQuery({
    queryKey: budgetKeys.variance(query),
    queryFn: () => api(withQuery(`/budgets/${query.year}/variance`, { month: query.month, scope: query.scope })),
  });
}

/**
 * Bekleyen yorum varken kanal kopuksa (olay gelmez) bu aralıkla yoklanır.
 * Ajan birkaç saniyede yazar; sunucu da zamanı geçen isteği kapatır.
 */
const COMMENTARY_POLL_MS = 5_000;

/** @param {{ year: number, month: number, scope: string }} query */
export function useCommentary(query) {
  return useQuery({
    queryKey: budgetKeys.commentary(query),
    queryFn: () => api(withQuery(`/budgets/${query.year}/commentary`, { month: query.month, scope: query.scope })),
    refetchInterval: (state) => (state.state.data?.commentary?.status === 'PENDING' ? COMMENTARY_POLL_MS : false),
  });
}

/* ─────────────── Biçim ─────────────── */

const moneyFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Izgara hücresinin görünen hali: "1234.5" → "1.234,5"; boş → "".
 * @param {string | null} value
 */
export function cellText(value) {
  return value === null || value === undefined || value === '' ? '' : moneyFormatter.format(Number(value));
}

/**
 * Kullanıcının yazdığı hücre → sunucu biçimi: "1.234,50" / "1234.5" / "1 234" →
 * "1234.50"-benzeri metin; boş → null. Geçersiz metin olduğu gibi döner
 * (doğrulama sözleşmede, hata ay adıyla gösterilir).
 * @param {string} text
 */
export function parseCell(text) {
  const trimmed = String(text ?? '').trim().replace(/\s/g, '');
  if (!trimmed) return null;
  // Türkçe biçim: nokta binlik, virgül ondalık. Yalnızca nokta varsa ve 3 haneli gruplarsa binliktir.
  if (trimmed.includes(',')) return trimmed.replace(/\./g, '').replace(',', '.');
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return trimmed.replace(/\./g, '');
  return trimmed;
}

/* ─────────────── Excel ─────────────── */

/**
 * Yüklenen Excel'in üst sınırı: şablon birkaç on KB'dir; dev dosya tarayıcıyı
 * kilitlemeden reddedilir.
 */
export const BUDGET_EXCEL_MAX_BYTES = 1024 * 1024;

/** Şablonun başlık satırı (kod sütunu eşleşme içindir; adı değişse de kalem bulunur). */
export const TEMPLATE_HEADER = Object.freeze(['Kod', 'Kalem', ...BUDGET_MONTH_LABELS]);

/**
 * Otele göre hazırlanmış bütçe şablonu (.xlsx): satır kalem, sütun ay; mevcut
 * plan değerleriyle dolu.
 *
 * @param {{ year: number, items: Array<{ item: string, label: string, unit: string, kind: string }>, lines: Map<string, Array<string | null>> }} input
 */
export async function downloadBudgetTemplate({ year, items, lines }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = TEMPLATE_HEADER.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' }));
  const rows = items.map((item) => [
    { value: item.item, type: String, textColor: '#6b7280' },
    { value: item.unit === 'PCT' ? `${item.label} (%)` : item.label, type: String },
    ...Array.from({ length: BUDGET_MONTHS }, (_, index) => {
      const value = lines.get(item.item)?.[index];
      return value === null || value === undefined ? null : { value: Number(value), type: Number, format: item.unit === 'PCT' ? '0.0' : '#,##0.00' };
    }),
  ]);
  await writeXlsxFile([header, ...rows], {
    sheet: `Bütçe ${year}`,
    columns: [{ width: 38 }, { width: 34 }, ...Array.from({ length: BUDGET_MONTHS }, () => ({ width: 13 }))],
    stickyRowsCount: 1,
    stickyColumnsCount: 2,
  }).toFile(`butce-${year}.xlsx`);
}

/**
 * Yüklenen şablonu okur: kod sütunuyla kalem, başlıktaki ay adıyla sütun
 * eşlenir. Tanınmayan kod ve okunamayan başlık hata olarak döner; doğrulama
 * (aralık, ondalık) sözleşmede.
 *
 * @param {File} file
 * @param {{ items: Array<{ item: string, label: string }> }} context
 * @returns {Promise<{ lines: Array<{ item: string, months: Array<string | null> }>, errors: string[] }>}
 */
export async function readBudgetTemplate(file, { items }) {
  if (file.size > BUDGET_EXCEL_MAX_BYTES) {
    return { lines: [], errors: [`Dosya çok büyük (en fazla ${BUDGET_EXCEL_MAX_BYTES / 1024 / 1024} MB); ekrandan indirilen şablonu kullanın.`] };
  }
  const { readSheet } = await import('read-excel-file/browser');
  const rows = await readSheet(file);
  const errors = [];
  if (!rows.length) return { lines: [], errors: ['Dosya boş.'] };
  const header = rows[0].map((cell) => String(cell ?? '').trim().toLocaleLowerCase('tr'));
  const codeColumn = header.indexOf('kod');
  const monthColumns = BUDGET_MONTH_LABELS.map((label) => header.indexOf(label.toLocaleLowerCase('tr')));
  if (codeColumn < 0 || monthColumns.some((column) => column < 0)) {
    return { lines: [], errors: ['Başlık satırı tanınmadı: ekrandan indirilen şablonu kullanın (Kod, Kalem, Ocak … Aralık).'] };
  }
  const known = new Map(items.map((item) => [item.item, item]));
  const lines = [];
  rows.slice(1).forEach((row, index) => {
    const code = String(row[codeColumn] ?? '').trim();
    if (!code) return;
    if (!known.has(code)) {
      errors.push(`${index + 2}. satır: "${code}" kodlu kalem bu otelde yok (silinmiş olabilir).`);
      return;
    }
    const months = monthColumns.map((column) => {
      const value = row[column];
      if (value === null || value === undefined || value === '') return null;
      return typeof value === 'number' ? String(Math.round(value * 100) / 100) : parseCell(String(value));
    });
    lines.push({ item: code, months });
  });
  return { lines, errors };
}
