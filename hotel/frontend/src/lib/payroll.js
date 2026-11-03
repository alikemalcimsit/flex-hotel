import { INSURANCE_TYPE_LABELS, MISSING_DAY_REASONS } from '@hotelos/hotel-contracts';
import { apiBlob } from './api.js';
import { PAYROLL_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
export { parsePeriod, periodOptions } from './payrollPeriod.js';
import { toastError } from '../store/toast.js';

/**
 * Personel ve bordro (modül 51): sorgu anahtarları, canlı tazeleme, durum tonları, PDF ve dosya çıktıları.
 * Hepsi `payroll` kökünde: canlı haber tek anahtarla bütün personel / bordro ekranlarını yeniler.
 */

export const payrollKeys = Object.freeze({
  all: ['payroll'],
  /** @param {object} filters */
  employees: (filters) => ['payroll', 'employees', filters],
  /** @param {string} id */
  employee: (id) => ['payroll', 'employee', id],
  departments: ['payroll', 'departments'],
  /** @param {object} filters */
  runs: (filters) => ['payroll', 'runs', filters],
  /** @param {string} id */
  run: (id) => ['payroll', 'run', id],
  /** @param {string} id @param {object} filters */
  entries: (id, filters) => ['payroll', 'run', id, 'entries', filters],
  /** @param {string} runId @param {string} entryId */
  entry: (runId, entryId) => ['payroll', 'run', runId, 'entry', entryId],
  /** @param {object} filters */
  attendance: (filters) => ['payroll', 'attendance', filters],
  /** @param {object} filters */
  items: (filters) => ['payroll', 'items', filters],
  /** @param {number} year @param {number} month */
  serviceCharge: (year, month) => ['payroll', 'service-charge', year, month],
  settings: ['payroll', 'settings'],
  parameters: ['payroll', 'parameters'],
  elements: ['payroll', 'elements'],
});

/** Personel / bordro ekranı açıkken: kart, puantaj, hesap, onay, ödeme, ayar değişince tazelenir. */
export function usePayrollLive() {
  return useLiveChannel(PAYROLL_CHANNEL, { minIntervalMs: 1_000, queryKeys: [payrollKeys.all] });
}

export const PAYROLL_RUN_STATUS_TONES = Object.freeze({ DRAFT: 'neutral', CALCULATED: 'info', PENDING_APPROVAL: 'warning', APPROVED: 'success' });
export const EMPLOYEE_STATUS_TONES = Object.freeze({ ACTIVE: 'success', TERMINATED: 'neutral' });

/** Bordro PDF'ini yeni sekmede açar. @param {string} runId @param {Record<string, string | number>} query @param {string} fileName */
export async function openPayrollPdf(runId, query, fileName) {
  const tab = window.open('', '_blank');
  try {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
    const blob = await apiBlob(`/payroll/runs/${runId}/pdf?${params}`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${fileName}.pdf`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    toastError(/** @type {Error} */ (error).message);
  }
}

const header = (labels) => labels.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' }));
const text = (value) => ({ value: value ?? '', type: String });
const number = (value) => ({ value: Number(value ?? 0), type: Number, format: '#,##0.00' });
const integer = (value) => ({ value: Number(value ?? 0), type: Number });

/**
 * Bankaya toplu maaş ödeme listesi (Excel): IBAN, ad soyad, tutar, açıklama. Banka portalı kolonları eşler.
 * @param {{ run: { number: string }, rows: any[] }} data
 */
export async function downloadBankFile(data) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const rows = data.rows.map((row) => [text(row.iban), text(row.name), number(row.amount), text(row.description), text(row.code)]);
  const total = data.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  await writeXlsxFile([header(['IBAN', 'Ad soyad', 'Tutar', 'Açıklama', 'Sicil']), ...rows, [{ value: 'Toplam', fontWeight: 'bold' }, text(`${data.rows.length} kişi`), number(total), null, null]], {
    fileName: `${data.run.number}-banka.xlsx`,
    columns: [{ width: 32 }, { width: 28 }, { width: 14 }, { width: 22 }, { width: 10 }],
  });
}

/**
 * Müşavir aktarımı (Excel): muhtasar ve prim hizmet beyannamesi / aylık prim bildirgesi alanları.
 * @param {{ run: { number: string }, rows: any[] }} data
 */
export async function downloadAccountantFile(data) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const labels = ['Sicil', 'T.C. kimlik no', 'Ad', 'Soyad', 'Sigorta', 'Prim günü', 'Eksik gün', 'Eksik gün nedeni', 'Teşvik', 'Brüt', 'SGK matrahı (PEK)', 'SGK işçi', 'İşsizlik işçi', 'GV matrahı', 'Hesaplanan GV', 'AÜ GV istisnası', 'Ödenecek GV', 'Hesaplanan DV', 'AÜ DV istisnası', 'Ödenecek DV', 'Net', 'SGK işveren', 'İşsizlik işveren', 'Hazine indirimi', 'Teşvik indirimi', 'İşveren maliyeti'];
  const rows = data.rows.map((row) => [
    text(row.code),
    text(row.nationalId),
    text(row.firstName),
    text(row.lastName),
    text(INSURANCE_TYPE_LABELS[row.insuranceType]),
    integer(row.sgkDays),
    integer(row.missingDays),
    text(row.missingReason ? `${row.missingReason} ${MISSING_DAY_REASONS[row.missingReason] ?? ''}` : ''),
    text(row.incentiveCode),
    number(row.gross),
    number(row.pek),
    number(row.employeeSgk),
    number(row.employeeUnemployment),
    number(row.gvBase),
    number(row.gvComputed),
    number(row.minWageGvExemption),
    number(row.gvPayable),
    number(row.dvComputed),
    number(row.minWageDvExemption),
    number(row.dvPayable),
    number(row.net),
    number(row.employerSgk),
    number(row.employerUnemployment),
    number(row.treasuryDiscount),
    number(row.incentiveDiscount),
    number(row.employerCost),
  ]);
  await writeXlsxFile([header(labels), ...rows], { fileName: `${data.run.number}-musavir.xlsx`, columns: labels.map((label) => ({ width: Math.max(10, label.length + 2) })) });
}
