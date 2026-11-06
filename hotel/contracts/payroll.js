import { z } from './locale.js';
import { decimalField, expectedUpdatedAt, idParamSchema, isoDayField, paginationQuerySchema, optionalQueryInt } from './fields.js';
import { isValidIban } from './accounting.js';
import { isValidTckn } from './invoicing.js';

/**
 * Personel ve bordro sözleşmeleri (modül 51).
 *
 * Personel kartı kullanıcı hesabından ayrıdır (her çalışan sisteme girmez; isteyen bir hesaba bağlanır). Ücret,
 * IBAN ve bordro yalnız `payroll.view` ile görünür; kimlik numarası listede maskelidir.
 *
 * Bordro ay bazındadır (30 gün esası): aylık bordro → hesapla → onaya gönder → dört gözle onay (kilit). Onaylı ayın
 * düzeltmesi fark bordrosuyla yapılır. Yasal parametreler (asgari ücret, SGK taban / tavan ve oranları, gelir vergisi
 * tarifesi, istisnalar, kıdem tavanı) kodda değil, otelin yürürlük tarihli parametre setlerinde durur; FlexAI'nin
 * hazır seti kaynaklarıyla gelir ve bordro onaya gitmeden önce bir yetkili tarafından teyit edilir.
 */

/* ─────────────── Personel ─────────────── */

export const EMPLOYEE_STATUSES = Object.freeze(['ACTIVE', 'TERMINATED']);
export const EMPLOYEE_STATUS_LABELS = Object.freeze({ ACTIVE: 'Çalışıyor', TERMINATED: 'Ayrıldı' });

export const PAY_BASES = Object.freeze(['GROSS', 'NET']);
export const PAY_BASIS_LABELS = Object.freeze({ GROSS: 'Brüt', NET: 'Net' });

/** Sigorta türü: tüm sigorta kolları (4/a) ya da emekli çalışan (sosyal güvenlik destek primi). */
export const INSURANCE_TYPES = Object.freeze(['NORMAL', 'RETIRED']);
export const INSURANCE_TYPE_LABELS = Object.freeze({ NORMAL: 'Tüm sigorta kolları', RETIRED: 'Emekli (SGDP)' });

export const EMPLOYEE_PAYMENT_METHODS = Object.freeze(['BANK', 'CASH']);
export const EMPLOYEE_PAYMENT_METHOD_LABELS = Object.freeze({ BANK: 'Banka (IBAN)', CASH: 'Elden' });

export const DISABILITY_DEGREES = Object.freeze([1, 2, 3]);

/* ─────────────── Bordro ─────────────── */

export const PAYROLL_RUN_KINDS = Object.freeze(['MONTHLY', 'SUPPLEMENTARY']);
export const PAYROLL_RUN_KIND_LABELS = Object.freeze({ MONTHLY: 'Aylık bordro', SUPPLEMENTARY: 'Fark bordrosu' });

export const PAYROLL_RUN_STATUSES = Object.freeze(['DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED']);
export const PAYROLL_RUN_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  CALCULATED: 'Hesaplandı',
  PENDING_APPROVAL: 'Onay bekliyor',
  APPROVED: 'Onaylandı',
});
/** Girdisi (puantaj, kalem) değiştirilebilen bordro durumları. */
export const PAYROLL_EDITABLE_STATUSES = Object.freeze(['DRAFT', 'CALCULATED']);

export const PAY_ELEMENT_KINDS = Object.freeze(['EARNING', 'DEDUCTION']);
export const PAY_ELEMENT_KIND_LABELS = Object.freeze({ EARNING: 'Ödeme', DEDUCTION: 'Kesinti' });

/** Vergi istisnası türü (günlük tutar parametre setinden). */
export const PAY_ELEMENT_EXEMPTIONS = Object.freeze(['NONE', 'MEAL', 'TRANSPORT']);
export const PAY_ELEMENT_EXEMPTION_LABELS = Object.freeze({ NONE: 'Yok', MEAL: 'Yemek (günlük istisna)', TRANSPORT: 'Yol (günlük istisna)' });

/**
 * Sistem kalemleri: kanunun belirlediği vergi / prim davranışıyla gelir, değiştirilemez ve silinemez. Otel kendi
 * kalemlerini (çocuk yardımı, kira yardımı…) ekler ve davranışını seçer.
 * `wage: false` → damga vergisinin asgari ücret istisnasından yararlanmaz (ücret değildir).
 */
export const SYSTEM_PAY_ELEMENTS = Object.freeze([
  { code: 'BASE_SALARY', name: 'Ücret', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'OVERTIME', name: 'Fazla çalışma', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'HOLIDAY_WORK', name: 'Bayram / genel tatil çalışması', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'WEEKLY_REST_WORK', name: 'Hafta tatili çalışması', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'BONUS', name: 'Prim / ikramiye', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: true },
  { code: 'MEAL', name: 'Yemek yardımı', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'MEAL', manual: true },
  { code: 'TRANSPORT', name: 'Yol yardımı', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'TRANSPORT', manual: true },
  { code: 'SERVICE_CHARGE', name: 'Servis payı', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'RETRO_PAY', name: 'Geçmiş dönem farkı', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: true },
  { code: 'UNUSED_LEAVE', name: 'Kullanılmayan izin ücreti', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'NOTICE_PAY', name: 'İhbar tazminatı', kind: 'EARNING', sgk: false, gv: true, dv: true, exemption: 'NONE', manual: false },
  { code: 'SEVERANCE_PAY', name: 'Kıdem tazminatı', kind: 'EARNING', sgk: false, gv: false, dv: true, exemption: 'NONE', manual: false, wage: false },
  { code: 'OTHER_EARNING', name: 'Diğer ödeme', kind: 'EARNING', sgk: true, gv: true, dv: true, exemption: 'NONE', manual: true },
  { code: 'NOTICE_DEDUCTION', name: 'İhbar tazminatı kesintisi', kind: 'DEDUCTION', sgk: false, gv: false, dv: false, exemption: 'NONE', manual: false },
  { code: 'OTHER_DEDUCTION', name: 'Diğer kesinti', kind: 'DEDUCTION', sgk: false, gv: false, dv: false, exemption: 'NONE', manual: true },
]);
export const SYSTEM_PAY_ELEMENT_CODES = Object.freeze(SYSTEM_PAY_ELEMENTS.map((element) => element.code));

/** Bordro satırında motorun ürettiği kesinti kodları (kalem değil). */
export const PAYROLL_DEDUCTION_LINE_LABELS = Object.freeze({
  BES: 'BES katkısı',
  NAFAKA: 'Nafaka',
  ICRA: 'İcra',
  ADVANCE: 'Avans mahsubu',
});

/**
 * SGK eksik gün nedenleri (aylık prim ve hizmet belgesi kodları).
 * Ücretli izin ve yıllık izin eksik gün değildir.
 */
export const MISSING_DAY_REASONS = Object.freeze({
  '01': 'İstirahat (rapor)',
  '03': 'Disiplin cezası',
  '04': 'Gözaltına alınma',
  '05': 'Tutukluluk',
  '06': 'Kısmi istihdam',
  '07': 'Puantaj kayıtları',
  '08': 'Grev',
  '09': 'Lokavt',
  '10': 'Genel hayatı etkileyen olaylar',
  '11': 'Doğal afet',
  '12': 'Birden fazla neden',
  '13': 'Diğer nedenler',
  '15': 'Devamsızlık',
  '16': 'Fesih tarihinde çalışmamış',
  '18': 'Kısa çalışma ödeneği',
  '19': 'Ücretsiz doğum izni',
  '20': 'Ücretsiz yol izni',
  '21': 'Diğer ücretsiz izin',
});
export const MISSING_DAY_REASON_CODES = Object.freeze(Object.keys(MISSING_DAY_REASONS));

/**
 * SGK işten çıkış nedenleri ve varsayılan hakları (kıdem / ihbar). Varsayılandır: hak, olayın gerçeğine göre
 * personel tarafından gerekçeyle değiştirilebilir (denetim izinde kalır). Kıdem ayrıca en az bir yıllık hizmet ister.
 */
export const TERMINATION_REASONS = Object.freeze({
  '01': { label: 'Deneme süreli sözleşmenin işverence feshi', severance: false, notice: false },
  '02': { label: 'Deneme süreli sözleşmenin işçi tarafından feshi', severance: false, notice: false },
  '03': { label: 'Belirsiz süreli sözleşmenin işçi tarafından feshi (istifa)', severance: false, notice: false },
  '04': { label: 'Belirsiz süreli sözleşmenin işverence haklı sebep bildirilmeden feshi', severance: true, notice: true },
  '05': { label: 'Belirli süreli sözleşmenin sona ermesi', severance: true, notice: false },
  '08': { label: 'Emeklilik (yaşlılık) ya da toptan ödeme', severance: true, notice: false },
  '09': { label: 'Malulen emeklilik', severance: true, notice: false },
  '10': { label: 'Ölüm', severance: true, notice: false },
  '11': { label: 'İş kazası sonucu ölüm', severance: true, notice: false },
  '12': { label: 'Askerlik', severance: true, notice: false },
  '13': { label: 'Kadın işçinin evlenmesi', severance: true, notice: false },
  '14': { label: 'Emeklilik için yaş dışındaki şartların tamamlanması', severance: true, notice: false },
  '15': { label: 'Toplu işçi çıkarma', severance: true, notice: true },
  '17': { label: 'İşyerinin kapanması', severance: true, notice: true },
  '22': { label: 'Diğer nedenler', severance: false, notice: false },
  '23': { label: 'İşçi tarafından zorunlu nedenle fesih', severance: true, notice: false },
  '24': { label: 'İşçi tarafından sağlık nedeniyle fesih', severance: true, notice: false },
  '25': { label: 'İşçi tarafından işverenin ahlak ve iyi niyet kurallarına aykırı davranışı nedeniyle fesih', severance: true, notice: false },
  '26': { label: 'Disiplin kurulu kararıyla fesih', severance: false, notice: false },
  '27': { label: 'İşveren tarafından zorunlu nedenlerle ve tutukluluk nedeniyle fesih', severance: true, notice: false },
  '28': { label: 'İşveren tarafından sağlık nedeniyle fesih', severance: true, notice: false },
  '29': { label: 'İşveren tarafından işçinin ahlak ve iyi niyet kurallarına aykırı davranışı nedeniyle fesih', severance: false, notice: false },
  '34': { label: 'İşyerinin devri, işin ya da işyerinin niteliğinin değişmesi nedeniyle fesih', severance: true, notice: true },
});
export const TERMINATION_REASON_CODES = Object.freeze(Object.keys(TERMINATION_REASONS));

/** İhbar tazminatı: kimse ödemez (süre kullandırıldı / hak yok), işveren öder, çalışan öder (süreye uymadan ayrıldı). */
export const NOTICE_MODES = Object.freeze(['NONE', 'EMPLOYER_PAYS', 'EMPLOYEE_PAYS']);
export const NOTICE_MODE_LABELS = Object.freeze({
  NONE: 'Yok (süre kullandırıldı ya da hak yok)',
  EMPLOYER_PAYS: 'İşveren öder',
  EMPLOYEE_PAYS: 'Çalışan öder (son bordrodan kesilir)',
});

/** Teşvik yöntemi: SGK işveren payından düşülen tutarın hesabı. Teşvikli çalışana Hazine indirimi ayrıca uygulanmaz. */
export const INCENTIVE_METHODS = Object.freeze(['TREASURY_POINTS', 'MIN_WAGE_EMPLOYER_SHARE', 'FIXED_AMOUNT']);
export const INCENTIVE_METHOD_LABELS = Object.freeze({
  TREASURY_POINTS: 'Prime esas kazancın puanı kadar',
  MIN_WAGE_EMPLOYER_SHARE: 'Asgari ücret üzerinden işveren payının tamamı',
  FIXED_AMOUNT: 'Sabit aylık tutar',
});

export const GARNISHMENT_TYPES = Object.freeze(['ICRA', 'NAFAKA']);
export const GARNISHMENT_TYPE_LABELS = Object.freeze({ ICRA: 'İcra', NAFAKA: 'Nafaka' });
export const GARNISHMENT_STATUSES = Object.freeze(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export const GARNISHMENT_STATUS_LABELS = Object.freeze({ ACTIVE: 'Kesiliyor', COMPLETED: 'Tamamlandı', CANCELLED: 'İptal' });
/** İcra kesintisinin yasal en az oranı (net ücretin dörtte biri). */
export const DEFAULT_GARNISHMENT_RATE = '0.25';

export const ADVANCE_STATUSES = Object.freeze(['OPEN', 'SETTLED', 'CANCELLED']);
export const ADVANCE_STATUS_LABELS = Object.freeze({ OPEN: 'Mahsup ediliyor', SETTLED: 'Kapandı', CANCELLED: 'İptal' });

export const SERVICE_CHARGE_METHODS = Object.freeze(['POINTS', 'EQUAL']);
export const SERVICE_CHARGE_METHOD_LABELS = Object.freeze({ POINTS: 'Puan usulü', EQUAL: 'Eşit pay' });
export const SERVICE_CHARGE_STATUSES = Object.freeze(['DRAFT', 'DISTRIBUTED']);

/** İşyerinin sektörü: Hazine indirimi puanı buna göre (imalat dışı / imalat). */
export const PAYROLL_SECTORS = Object.freeze(['GENERAL', 'MANUFACTURING']);
export const PAYROLL_SECTOR_LABELS = Object.freeze({ GENERAL: 'İmalat dışı', MANUFACTURING: 'İmalat' });

/* ─────────────── Sınırlar ─────────────── */

export const MAX_PAYROLL_AMOUNT = 100_000_000;
export const MAX_MONTHLY_SALARY = 10_000_000;
/** Ay içinde girilebilen en fazla fazla çalışma (saat): yıllık yasal sınır 270 saat. */
export const MAX_OVERTIME_HOURS = 120;
export const MAX_ADVANCE_INSTALLMENTS = 24;
/** Tek PDF'teki en fazla pusula (büyük otelde departman ya da sayfa sayfa alınır). */
export const MAX_PAYSLIPS_PER_PDF = 500;
export const MAX_EMPLOYEE_NAME_LENGTH = 60;
export const MAX_PAYROLL_TEXT_LENGTH = 300;
/** Bordro yılı aralığı (yazım hatası koruması). */
export const MIN_PAYROLL_YEAR = 2024;
export const MAX_PAYROLL_YEAR = 2100;

/* ─────────────── Saf kurallar ─────────────── */

/** "Ayşe Demir". @param {{ firstName: string, lastName: string }} employee */
export const employeeFullName = (employee) => `${employee.firstName} ${employee.lastName}`.trim();

/** "Ocak 2026". @param {number} year @param {number} month */
export function payrollPeriodLabel(year, month) {
  const names = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${names[month - 1]} ${year}`;
}

/** Ayın ilk ve son günü ("YYYY-AA-GG"). @param {number} year @param {number} month */
export function payrollMonthBounds(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { first, last };
}

/**
 * Çıkış nedeninin varsayılan hakları.
 * @param {string} code @returns {{ severance: boolean, notice: boolean } | null}
 */
export function terminationDefaults(code) {
  const reason = TERMINATION_REASONS[code];
  return reason ? { severance: reason.severance, notice: reason.notice } : null;
}

/* ─────────────── Şemalar ─────────────── */

const money = (label, { min = 0, max = MAX_PAYROLL_AMOUNT } = {}) => decimalField({ scale: 2, min, max, label });
const text = (label, max = MAX_PAYROLL_TEXT_LENGTH) => z.string().trim().min(1, `${label} zorunlu`).max(max, `${label} en fazla ${max} karakter`);
const optionalText = (max = MAX_PAYROLL_TEXT_LENGTH) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const yearField = z.coerce.number({ error: 'Yıl sayı olmalı' }).int().min(MIN_PAYROLL_YEAR, `Yıl ${MIN_PAYROLL_YEAR}'ten önce olamaz`).max(MAX_PAYROLL_YEAR, 'Yıl geçersiz');
const monthField = z.coerce.number({ error: 'Ay sayı olmalı' }).int().min(1, 'Ay 1–12 olmalı').max(12, 'Ay 1–12 olmalı');
const quantity = (label, max, scale = 2) => decimalField({ scale, min: 0, max, label });

/** T.C. kimlik no (11 hane, denetim haneli) ya da yabancı uyruklu için 99 ile başlayan 11 hane / pasaport. */
const nationalIdField = z
  .string()
  .trim()
  .min(1, 'Kimlik numarası zorunlu')
  .max(20, 'Kimlik numarası en fazla 20 karakter');

const ibanField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => value === '' || isValidIban(value), { message: 'IBAN geçersiz (TR ile başlayan 26 karakter, denetim hanesi tutmalı)' })
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const employeeInputSchema = z
  .object({
    firstName: text('Ad', MAX_EMPLOYEE_NAME_LENGTH),
    lastName: text('Soyad', MAX_EMPLOYEE_NAME_LENGTH),
    nationality: z.string().trim().toUpperCase().length(2, 'Uyruk iki harfli ülke kodu olmalı').default('TR'),
    nationalId: nationalIdField,
    birthDate: isoDayField.optional().nullable(),
    phone: optionalText(30),
    email: z.string().trim().max(160).email('E-posta geçersiz').optional().nullable().or(z.literal('').transform(() => null)),
    address: optionalText(),
    departmentId: z.string().uuid({ message: 'Departman seçin' }),
    position: text('Görev', 80),
    hireDate: isoDayField,
    insuranceType: z.enum(INSURANCE_TYPES, { error: 'Sigorta türü seçin' }).default('NORMAL'),
    disabilityDegree: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
    serviceChargePoints: quantity('Servis payı puanı', 1000).default('0'),
    userId: z.string().uuid().optional().nullable(),
    notes: optionalText(1000),
    // Ücret alanları: yalnız payroll.view / payroll.manage ile gelir ve yazılır
    payBasis: z.enum(PAY_BASES, { error: 'Ücret türü seçin' }).optional(),
    salary: money('Ücret', { min: 0, max: MAX_MONTHLY_SALARY }).optional(),
    paymentMethod: z.enum(EMPLOYEE_PAYMENT_METHODS).optional(),
    iban: ibanField,
    besEnrolled: z.boolean().optional(),
    besRate: decimalField({ scale: 4, min: 0.01, max: 0.5, label: 'BES oranı' }).optional().nullable(),
    besOptOutOn: isoDayField.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.nationality === 'TR' && !isValidTckn(value.nationalId)) {
      ctx.addIssue({ code: 'custom', path: ['nationalId'], message: 'T.C. kimlik numarası geçersiz' });
    }
    if (value.birthDate && value.birthDate >= value.hireDate) ctx.addIssue({ code: 'custom', path: ['birthDate'], message: 'Doğum tarihi işe girişten önce olmalı' });
    if (value.paymentMethod === 'BANK' && value.iban === null) ctx.addIssue({ code: 'custom', path: ['iban'], message: 'Bankadan ödenen personelin IBAN\'ı olmalı' });
  });

export const employeeCreateSchema = employeeInputSchema;
export const employeeUpdateSchema = employeeInputSchema.and(z.object({ expectedUpdatedAt }));

export const employeeListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  departmentId: z.string().uuid().optional(),
});

export const employeeParamSchema = z.object({ employeeId: z.string().uuid({ message: 'Geçersiz personel' }) });

export const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/, 'Kod 1–12 karakter: harf, rakam, - _'),
  name: text('Ad', 60),
  isActive: z.boolean().default(true),
});

export const incentiveSchema = z
  .object({
    code: z.string().trim().min(1, 'Teşvik kodu zorunlu').max(12),
    label: text('Açıklama', 120),
    method: z.enum(INCENTIVE_METHODS, { error: 'Hesap yöntemi seçin' }),
    points: decimalField({ scale: 2, min: 0.01, max: 100, label: 'Puan' }).optional().nullable(),
    amount: money('Tutar').optional().nullable(),
    validFrom: isoDayField,
    validTo: isoDayField.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'TREASURY_POINTS' && !value.points) ctx.addIssue({ code: 'custom', path: ['points'], message: 'Puan girin' });
    if (value.method === 'FIXED_AMOUNT' && !value.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Tutar girin' });
    if (value.validTo && value.validTo < value.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

export const advanceSchema = z
  .object({
    amount: money('Tutar', { min: 0.01 }),
    paidOn: isoDayField,
    installments: z.coerce.number().int().min(1, 'En az 1 taksit').max(MAX_ADVANCE_INSTALLMENTS, `En fazla ${MAX_ADVANCE_INSTALLMENTS} taksit`),
    firstYear: yearField,
    firstMonth: monthField,
    treasuryAccountId: z.string().uuid().optional().nullable(),
    note: optionalText(),
  });

export const garnishmentSchema = z
  .object({
    type: z.enum(GARNISHMENT_TYPES, { error: 'Tür seçin' }),
    fileNumber: text('Dosya no', 60),
    authority: text('Daire / mahkeme', 120),
    creditor: text('Alacaklı', 120),
    notifiedOn: isoDayField,
    totalAmount: money('Borç tutarı', { min: 0.01 }).optional().nullable(),
    monthlyAmount: money('Aylık tutar', { min: 0.01 }).optional().nullable(),
    rate: decimalField({ scale: 4, min: 0.25, max: 1, label: 'Kesinti oranı' }).optional().nullable(),
    ledgerAccountId: z.string().uuid().optional().nullable(),
    note: optionalText(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'ICRA' && !value.totalAmount) ctx.addIssue({ code: 'custom', path: ['totalAmount'], message: 'İcra borcunu girin' });
    if (value.type === 'NAFAKA' && !value.monthlyAmount) ctx.addIssue({ code: 'custom', path: ['monthlyAmount'], message: 'Aylık nafakayı girin' });
  });

export const terminationSchema = z
  .object({
    terminationDate: isoDayField,
    reasonCode: z.enum(TERMINATION_REASON_CODES, { error: 'Çıkış nedeni seçin' }),
    severanceEligible: z.boolean(),
    noticeMode: z.enum(NOTICE_MODES),
    unusedLeaveDays: quantity('Kullanılmayan izin', 365, 1).default('0'),
    severanceBase: money('Kıdeme esas ücret').optional().nullable(),
    overrideReason: optionalText(),
  })
  .superRefine((value, ctx) => {
    const defaults = terminationDefaults(value.reasonCode);
    // Çalışanın ödediği ihbar varsayılandan sapma sayılmaz (süreye uymadan ayrılan çalışan için olağan durum).
    const noticeDefault = defaults?.notice ? 'EMPLOYER_PAYS' : 'NONE';
    const noticeChanged = value.noticeMode !== 'EMPLOYEE_PAYS' && value.noticeMode !== noticeDefault;
    const changed = Boolean(defaults) && (defaults.severance !== value.severanceEligible || noticeChanged);
    if (changed && !value.overrideReason) ctx.addIssue({ code: 'custom', path: ['overrideReason'], message: 'Varsayılan haktan farklı seçim için gerekçe yazın' });
  });

export const attendanceSchema = z
  .object({
    employeeId: z.string().uuid(),
    missingDays: z.coerce.number().int().min(0).max(30, 'Eksik gün en fazla 30'),
    missingReason: z.enum(MISSING_DAY_REASON_CODES).optional().nullable(),
    workedDays: z.coerce.number().int().min(0).max(30).optional().nullable(),
    overtimeHours: quantity('Fazla çalışma', MAX_OVERTIME_HOURS).default('0'),
    holidayDays: quantity('Bayram çalışması', 15, 1).default('0'),
    weeklyRestDays: quantity('Hafta tatili çalışması', 5, 1).default('0'),
    note: optionalText(),
  })
  .superRefine((value, ctx) => {
    if (value.missingDays > 0 && !value.missingReason) ctx.addIssue({ code: 'custom', path: ['missingReason'], message: 'Eksik gün nedenini seçin' });
  });

export const attendanceBatchSchema = z.object({ rows: z.array(attendanceSchema).min(1).max(200, 'Bir seferde en fazla 200 satır') });

export const payrollItemSchema = z.object({
  year: yearField,
  month: monthField,
  /** Fark bordrosuna giden kalem: o bordronun kimliği. Boşsa ayın aylık bordrosuna. */
  runId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid({ message: 'Personel seçin' }),
  elementId: z.string().uuid({ message: 'Kalem seçin' }),
  amount: money('Tutar', { min: 0.01 }),
  isNet: z.boolean().default(false),
  note: optionalText(),
});

export const payElementSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,24}$/, 'Kod 2–24 karakter: büyük harf, rakam, _'),
  name: text('Ad', 60),
  kind: z.enum(PAY_ELEMENT_KINDS),
  sgk: z.boolean(),
  gv: z.boolean(),
  dv: z.boolean(),
  exemption: z.enum(PAY_ELEMENT_EXEMPTIONS).default('NONE'),
  isActive: z.boolean().default(true),
});

export const serviceChargeSchema = z.object({
  year: yearField,
  month: monthField,
  amount: money('Dağıtılacak tutar', { min: 0.01 }),
  method: z.enum(SERVICE_CHARGE_METHODS),
  daysWeighted: z.boolean().default(true),
  departmentIds: z.array(z.string().uuid()).max(50).default([]),
  note: optionalText(),
});

export const payrollRunCreateSchema = z.object({ year: yearField, month: monthField, kind: z.enum(PAYROLL_RUN_KINDS).default('MONTHLY'), note: optionalText() });

export const payrollRunListQuerySchema = paginationQuerySchema.extend({ year: optionalQueryInt({ label: 'Yıl', min: MIN_PAYROLL_YEAR, max: MAX_PAYROLL_YEAR }) });

export const payrollMonthQuerySchema = paginationQuerySchema.extend({
  year: yearField,
  month: monthField,
  search: z.string().trim().max(100).optional(),
  departmentId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
});

export const payrollRunParamSchema = z.object({ runId: z.string().uuid({ message: 'Geçersiz bordro' }) });

export const payrollEntryListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  departmentId: z.string().uuid().optional(),
  unpaid: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

export const payrollPaySchema = z.object({
  treasuryAccountId: z.string().uuid({ message: 'Hesap seçin' }),
  date: isoDayField,
  method: z.enum(EMPLOYEE_PAYMENT_METHODS),
  employeeIds: z.array(z.string().uuid()).max(5000).optional(),
});

export const payrollPdfQuerySchema = z.object({
  kind: z.enum(['PAYROLL', 'PAYSLIPS']).default('PAYROLL'),
  employeeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const payrollOpeningSchema = z.object({
  employeeId: z.string().uuid(),
  year: yearField,
  gvCumulative: money('Devreden GV matrahı'),
  minWageCumulative: money('Devreden asgari ücret matrahı'),
  note: optionalText(),
});

export const payrollSettingsSchema = z.object({
  workplaceName: optionalText(120),
  sgkWorkplaceNo: optionalText(40),
  taxOffice: optionalText(80),
  taxNumber: optionalText(11),
  sector: z.enum(PAYROLL_SECTORS).default('GENERAL'),
  treasuryDiscount: z.boolean().default(true),
  expectedUpdatedAt: expectedUpdatedAt.optional().nullable(),
});

const rateText = (label) => decimalField({ scale: 5, min: 0, max: 1, label });
const insuranceRates = z.object({
  employeeSgk: rateText('İşçi SGK oranı'),
  employeeUnemployment: rateText('İşçi işsizlik oranı'),
  employerSgk: rateText('İşveren SGK oranı'),
  employerUnemployment: rateText('İşveren işsizlik oranı'),
});

/** Yasal parametre setinin değerleri (hepsi metin; para iki ondalık, oran beş ondalık). */
export const payrollParameterValuesSchema = z
  .object({
    minWageGross: money('Brüt asgari ücret', { min: 1 }),
    sgkFloorDaily: money('SGK günlük taban', { min: 1 }),
    sgkCeilingDaily: money('SGK günlük tavan', { min: 1 }),
    rates: z.object({ NORMAL: insuranceRates, RETIRED: insuranceRates }),
    treasuryPoints: z.object({ GENERAL: decimalField({ scale: 2, min: 0, max: 10, label: 'Hazine indirimi' }), MANUFACTURING: decimalField({ scale: 2, min: 0, max: 10, label: 'Hazine indirimi (imalat)' }) }),
    stampDutyRate: rateText('Damga vergisi oranı'),
    taxBrackets: z
      .array(z.object({ upTo: money('Dilim üst sınırı', { min: 1 }).nullable(), rate: rateText('Dilim oranı') }))
      .min(2, 'En az iki dilim')
      .max(8),
    disability: z.object({ 1: money('1. derece engellilik'), 2: money('2. derece engellilik'), 3: money('3. derece engellilik') }),
    mealGvDaily: money('Yemek GV günlük istisna'),
    mealSgkDaily: money('Yemek SGK günlük istisna'),
    transportGvDaily: money('Yol GV günlük istisna'),
    severanceCeiling: money('Kıdem tazminatı tavanı', { min: 1 }),
    besRate: rateText('BES oranı'),
  })
  .superRefine((value, ctx) => {
    if (Number(value.sgkCeilingDaily) < Number(value.sgkFloorDaily)) ctx.addIssue({ code: 'custom', path: ['sgkCeilingDaily'], message: 'Tavan tabandan küçük olamaz' });
    const brackets = value.taxBrackets;
    brackets.forEach((bracket, index) => {
      const last = index === brackets.length - 1;
      if (last !== (bracket.upTo === null)) ctx.addIssue({ code: 'custom', path: ['taxBrackets', index, 'upTo'], message: last ? 'Son dilimin üst sınırı olmaz' : 'Üst sınır girin' });
      if (!last && index > 0 && bracket.upTo !== null && brackets[index - 1].upTo !== null && Number(bracket.upTo) <= Number(brackets[index - 1].upTo)) {
        ctx.addIssue({ code: 'custom', path: ['taxBrackets', index, 'upTo'], message: 'Dilim sınırları artan olmalı' });
      }
    });
  });

export const payrollParameterSetSchema = z.object({
  validFrom: isoDayField,
  label: text('Ad', 80),
  values: payrollParameterValuesSchema,
  sources: z.array(z.object({ label: text('Kaynak', 160), url: z.string().trim().url('Adres geçersiz').max(400).optional().nullable() })).max(20).default([]),
});

export const payrollParameterParamSchema = z.object({ setId: z.string().uuid() });
export const payrollIdParamSchema = idParamSchema;
