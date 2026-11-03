import { Decimal } from '@hotelos/core';

/**
 * Bordro hesap motoru (modül 51) — saf fonksiyonlar, veritabanı bilmez.
 *
 * Bütün tutarlar **kuruş tam sayı** (Number; 2^53 kuruş ≈ 90 trilyon TL, taşma yok). Oranla çarpım Decimal ile
 * yapılır ve yarım yukarı yuvarlanır: `0.14 × 12345` gibi kayan nokta hatası kuruşu kaydırmasın. Dışarıya
 * "1234.56" metniyle çıkılır (`fromCents`).
 *
 * Ay 30 gün esaslıdır (aylık ücretli). Hesap sırası Türkiye bordrosunun sırasıdır:
 *   1. SGK'ya tabi kazanç (yemek istisnası düşülür) → prime esas kazanç (gün × taban / tavan arasında)
 *   2. İşçi SGK + işsizlik payı
 *   3. Gelir vergisi matrahı = GV'ye tabi kazanç − yemek / yol istisnası − işçi payları − engellilik indirimi
 *   4. Gelir vergisi = tarife(yıl içi birikmiş + matrah) − tarife(yıl içi birikmiş); asgari ücret istisnası düşülür
 *   5. Damga vergisi; ücrete düşen kısımdan asgari ücret istisnası düşülür
 *   6. Net = brüt − işçi payları − ödenecek GV − ödenecek DV
 *   7. İşveren payları, Hazine indirimi ya da teşvik, işveren maliyeti
 * Netten anlaşılmış kalemler (`netTarget`) brüte çevrilir: kalem kalem, "bu kalem nete tam bu kadar eklesin"
 * diye ikili aramayla (net brütle azalmayan bir fonksiyon).
 */

export const MONTH_DAYS = 30;
/** Aylık ücretlinin saat ücreti: aylık ücret / 225 (30 gün × 7,5 saat). */
export const MONTHLY_HOURS = 225;
/** Fazla çalışma: saat ücretinin %50 fazlası. */
export const OVERTIME_MULTIPLIER = '1.5';
/** Hafta tatilinde çalışma: günlük ücretin 1,5 katı. */
export const WEEKLY_REST_MULTIPLIER = '1.5';
/** Ulusal bayram / genel tatilde çalışma: o günün ücretine ek bir günlük ücret. */
export const HOLIDAY_MULTIPLIER = '1';
const DAY_MS = 86_400_000;
const HALF_UP = Decimal.ROUND_HALF_UP;

/** "1234.56" → 123456. @param {string | number | null | undefined} value */
export const toCents = (value) => new Decimal(String(value ?? 0)).mul(100).toDecimalPlaces(0, HALF_UP).toNumber();
/** 123456 → "1234.56" (eksi işaret korunur). @param {number} cents */
export const fromCents = (cents) => new Decimal(cents).div(100).toFixed(2);
/** kuruş × oran → kuruş. @param {number} cents @param {string | number} rate */
export const ratio = (cents, rate) => new Decimal(cents).mul(String(rate)).toDecimalPlaces(0, HALF_UP).toNumber();
/** Aylık tutarın gün payı (30 gün esası; 30 ve üstü tam ay). @param {number} cents @param {number} days */
export const prorate = (cents, days) => (days >= MONTH_DAYS ? cents : new Decimal(cents).mul(days).div(MONTH_DAYS).toDecimalPlaces(0, HALF_UP).toNumber());

/* ═══════════════ Gelir vergisi tarifesi ═══════════════ */

/**
 * Tarifenin bir matraha düşen vergisi (yuvarlanmamış, kuruş).
 * @param {number} total kuruş
 * @param {Array<{ upTo: string | null, rate: string }>} brackets artan sınırlar; son dilim `upTo: null`
 */
export function tariff(total, brackets) {
  let tax = new Decimal(0);
  let lower = 0;
  for (const { upTo, rate } of brackets) {
    if (total <= lower) break;
    const upper = upTo === null ? Number.POSITIVE_INFINITY : toCents(upTo);
    tax = tax.plus(new Decimal(Math.min(total, upper) - lower).mul(rate));
    lower = upper;
  }
  return tax;
}

/**
 * Yıl içi birikmiş matrah üstüne eklenen matrahın vergisi: tarife(önce + matrah) − tarife(önce), kuruşa yuvarlı.
 * @param {number} before kuruş @param {number} base kuruş @param {Array<{ upTo: string | null, rate: string }>} brackets
 */
export function incomeTax(before, base, brackets) {
  if (base <= 0) return 0;
  return tariff(before + base, brackets).minus(tariff(before, brackets)).toDecimalPlaces(0, HALF_UP).toNumber();
}

/* ═══════════════ Gün hesabı ═══════════════ */

/** "YYYY-AA-GG" → UTC gün başı (ms). @param {string} day */
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);

/**
 * Ayın ücretli gün sayısı (30 esası): ay boyunca çalışan 30; ay içinde giren / çıkan takvim günü kadar (en fazla 30).
 * Çalışma ayın dışındaysa 0.
 * @param {{ year: number, month: number, hireDate: string, terminationDate?: string | null }} input
 */
export function employmentDays({ year, month, hireDate, terminationDate = null }) {
  const first = Date.UTC(year, month - 1, 1);
  const last = Date.UTC(year, month, 0);
  const start = Math.max(first, dayMs(hireDate));
  const end = Math.min(last, terminationDate ? dayMs(terminationDate) : last);
  if (end < start) return 0;
  if (start === first && end === last) return MONTH_DAYS;
  return Math.min(MONTH_DAYS, Math.round((end - start) / DAY_MS) + 1);
}

/* ═══════════════ Ay hesabı ═══════════════ */

/**
 * @typedef {{
 *   minWageGross: string, sgkFloorDaily: string, sgkCeilingDaily: string,
 *   rates: Record<'NORMAL' | 'RETIRED', { employeeSgk: string, employeeUnemployment: string, employerSgk: string, employerUnemployment: string }>,
 *   treasuryPoints: Record<'GENERAL' | 'MANUFACTURING', string>,
 *   stampDutyRate: string, taxBrackets: Array<{ upTo: string | null, rate: string }>,
 *   disability: Record<'1' | '2' | '3', string>,
 *   mealGvDaily: string, mealSgkDaily: string, transportGvDaily: string,
 *   severanceCeiling: string, besRate: string,
 * }} PayrollParams
 *
 * @typedef {{
 *   key: string, amount?: number, netTarget?: number | null,
 *   sgk: boolean, gv: boolean, dv: boolean, exemption?: 'MEAL' | 'TRANSPORT' | null,
 *   wage?: boolean,
 * }} Earning `wage: false` → damga vergisinin asgari ücret istisnasından yararlanmaz (kıdem tazminatı)
 *
 * @typedef {{ method: 'TREASURY_POINTS' | 'MIN_WAGE_EMPLOYER_SHARE' | 'FIXED_AMOUNT', points?: string | null, amount?: number | null, code?: string }} Incentive
 *
 * @typedef {{
 *   params: PayrollParams, insurance: 'NORMAL' | 'RETIRED', sgkDays: number, workedDays: number,
 *   earnings: Earning[], gvBefore: number, minWageBefore: number, disabilityDegree?: number | null,
 *   treasuryPoints?: string | null, incentive?: Incentive | null,
 * }} MonthInput
 */

/**
 * Asgari ücretin bu ayki gelir vergisi matrahı (gün payı): brüt asgari ücret − işçinin kendi sigorta payları.
 * İstisna, çalışanın asgari ücret kazansaydı ödeyeceği vergi kadardır; SGDP'li (emekli) çalışanda işçi payı %7,5
 * olduğundan matrah da ona göre bulunur.
 * @param {PayrollParams} params @param {'NORMAL' | 'RETIRED'} insurance @param {number} days
 */
export function minWageBase(params, insurance, days) {
  const gross = toCents(params.minWageGross);
  const rates = params.rates[insurance];
  return prorate(gross - ratio(gross, rates.employeeSgk) - ratio(gross, rates.employeeUnemployment), days);
}

/**
 * Bir çalışanın bir aylık bordrosu (bütün kazançlar brüt tutarlı).
 * @param {MonthInput} input
 */
export function computeMonth(input) {
  const { params, insurance } = input;
  const rates = params.rates[insurance];
  if (!rates) throw new Error(`Bilinmeyen sigorta türü: ${insurance}`);
  const days = Math.max(0, Math.min(MONTH_DAYS, input.sgkDays));
  const worked = Math.max(0, Math.min(days, input.workedDays));
  const earnings = input.earnings.map((item) => ({ ...item, amount: Math.max(0, item.amount ?? 0) }));
  const total = (filter) => earnings.reduce((acc, item) => (filter(item) ? acc + item.amount : acc), 0);

  const gross = total(() => true);

  // 1. SGK: yemek istisnası (günlük tutar × çalışılan gün), prime esas kazanç taban / tavan arasında
  const mealSgkCap = toCents(params.mealSgkDaily) * worked;
  const sgkMealExempt = Math.min(total((item) => item.sgk && item.exemption === 'MEAL'), mealSgkCap);
  const sgkSubject = total((item) => item.sgk) - sgkMealExempt;
  const floor = toCents(params.sgkFloorDaily) * days;
  const ceiling = toCents(params.sgkCeilingDaily) * days;
  const pek = days === 0 ? 0 : Math.min(Math.max(sgkSubject, floor), ceiling);

  // 2. İşçi payları
  const employeeSgk = ratio(pek, rates.employeeSgk);
  const employeeUnemployment = ratio(pek, rates.employeeUnemployment);

  // 3. GV matrahı
  const mealGvExempt = Math.min(total((item) => item.gv && item.exemption === 'MEAL'), toCents(params.mealGvDaily) * worked);
  const transportGvExempt = Math.min(total((item) => item.gv && item.exemption === 'TRANSPORT'), toCents(params.transportGvDaily) * worked);
  const gvSubject = total((item) => item.gv) - mealGvExempt - transportGvExempt;
  const afterInsurance = Math.max(0, gvSubject - employeeSgk - employeeUnemployment);
  const degree = input.disabilityDegree ? String(input.disabilityDegree) : null;
  const disabilityDeduction = degree && params.disability[degree] ? Math.min(afterInsurance, toCents(params.disability[degree])) : 0;
  const gvBase = afterInsurance - disabilityDeduction;

  // 4. Gelir vergisi + asgari ücret istisnası (asgari ücretin kendi birikmiş matrahıyla)
  const gvComputed = incomeTax(input.gvBefore, gvBase, params.taxBrackets);
  const mwBase = minWageBase(params, insurance, days);
  const minWageGvExemption = Math.min(gvComputed, incomeTax(input.minWageBefore, mwBase, params.taxBrackets));
  const gvPayable = gvComputed - minWageGvExemption;

  // 5. Damga vergisi: istisna yalnız ücrete düşen damga vergisinden
  const dvComputed = ratio(total((item) => item.dv), params.stampDutyRate);
  const dvOnWage = ratio(total((item) => item.dv && item.wage !== false), params.stampDutyRate);
  const minWageDvExemption = Math.min(dvOnWage, prorate(ratio(toCents(params.minWageGross), params.stampDutyRate), days));
  const dvPayable = dvComputed - minWageDvExemption;

  // 6. Net
  const net = gross - employeeSgk - employeeUnemployment - gvPayable - dvPayable;

  // 7. İşveren: tek indirim (teşvik varsa Hazine indirimi uygulanmaz), işveren SGK payını aşamaz
  const employerSgk = ratio(pek, rates.employerSgk);
  const employerUnemployment = ratio(pek, rates.employerUnemployment);
  let treasuryDiscount = 0;
  let incentiveDiscount = 0;
  const incentive = input.incentive ?? null;
  if (incentive) {
    if (incentive.method === 'TREASURY_POINTS') incentiveDiscount = ratio(pek, new Decimal(incentive.points ?? '0').div(100).toString());
    else if (incentive.method === 'MIN_WAGE_EMPLOYER_SHARE') incentiveDiscount = ratio(Math.min(pek, floor), rates.employerSgk);
    else incentiveDiscount = Math.max(0, incentive.amount ?? 0);
    incentiveDiscount = Math.min(incentiveDiscount, employerSgk);
  } else if (input.treasuryPoints && insurance === 'NORMAL') {
    treasuryDiscount = Math.min(ratio(pek, new Decimal(input.treasuryPoints).div(100).toString()), employerSgk);
  }
  const employerCost = gross + employerSgk + employerUnemployment - treasuryDiscount - incentiveDiscount;

  return {
    days,
    workedDays: worked,
    gross,
    sgkSubject,
    sgkMealExempt,
    pek,
    pekAtFloor: days > 0 && sgkSubject < floor,
    pekAtCeiling: days > 0 && sgkSubject > ceiling,
    employeeSgk,
    employeeUnemployment,
    gvSubject,
    mealGvExempt,
    transportGvExempt,
    disabilityDeduction,
    gvBase,
    gvBefore: input.gvBefore,
    gvAfter: input.gvBefore + gvBase,
    gvComputed,
    minWageBase: mwBase,
    minWageBefore: input.minWageBefore,
    minWageAfter: input.minWageBefore + mwBase,
    minWageGvExemption,
    gvPayable,
    dvComputed,
    minWageDvExemption,
    dvPayable,
    net,
    employerSgk,
    employerUnemployment,
    treasuryDiscount,
    incentiveDiscount,
    employerCost,
  };
}

/**
 * Net kalemleri brüte çevirip ayı hesaplar. Kalemler **verilen sırayla** eklenir: brüt kalem olduğu gibi, net kalem
 * için "o ana kadarki nete tam `netTarget` eklesin" diyen en küçük brüt bulunur (kuruş üzerinde ikili arama).
 * Sıra anlamlıdır: netten ücretlide ücret önce gelir (anlaşılan net ücret güvence altında; sonraki brüt ek ödemeler
 * kendi marjinal vergisiyle eklenir); brüt ücretliye verilen net prim ücretten sonra çözülür. Hiç kalem yokken net
 * sıfır sayılır (boş ayın taban primi eksi net değildir). Yuvarlamadan net hedef en fazla birkaç kuruş aşılabilir,
 * hiçbir zaman altında kalınmaz.
 *
 * @param {MonthInput} input
 * @returns {{ result: ReturnType<typeof computeMonth>, earnings: Array<Earning & { amount: number }> }}
 */
export function solveMonth(input) {
  /** @type {Array<Earning & { amount: number }>} */
  const resolved = [];
  let current = computeMonth({ ...input, earnings: resolved });
  for (const item of input.earnings) {
    if (item.netTarget === undefined || item.netTarget === null) {
      resolved.push({ ...item, amount: Math.max(0, item.amount ?? 0) });
      current = computeMonth({ ...input, earnings: resolved });
      continue;
    }
    const want = Math.max(0, item.netTarget);
    if (want === 0) {
      resolved.push({ ...item, amount: 0 });
      continue;
    }
    const target = (resolved.length === 0 ? 0 : current.net) + want;
    const netWith = (amount) => computeMonth({ ...input, earnings: [...resolved, { ...item, amount }] }).net;
    let low = want;
    let high = want * 2 + 100_000;
    while (netWith(high) < target) high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (netWith(mid) >= target) high = mid;
      else low = mid + 1;
    }
    resolved.push({ ...item, amount: low });
    current = computeMonth({ ...input, earnings: resolved });
  }
  return { result: current, earnings: resolved };
}

/* ═══════════════ Ücret kalemleri ═══════════════ */

/**
 * Ücret ve puantajdan çıkan kalemler (tutar ya brüt ya net hedef — ücretin anlaşma türüyle aynı).
 * @param {{ salary: number, payBasis: 'GROSS' | 'NET', days: number, overtimeHours?: string | number, holidayDays?: string | number, weeklyRestDays?: string | number }} input
 * @returns {Array<{ key: string, value: number, quantity: string }>} value: kuruş (brüt ya da net hedef)
 */
export function wageComponents({ salary, payBasis, days, overtimeHours = 0, holidayDays = 0, weeklyRestDays = 0 }) {
  const lines = [{ key: 'BASE_SALARY', value: prorate(salary, days), quantity: String(days) }];
  const daily = new Decimal(salary).div(MONTH_DAYS);
  const hourly = new Decimal(salary).div(MONTHLY_HOURS);
  const add = (key, amount, quantity) => {
    const value = amount.toDecimalPlaces(0, HALF_UP).toNumber();
    if (value > 0) lines.push({ key, value, quantity: String(quantity) });
  };
  if (Number(overtimeHours) > 0) add('OVERTIME', hourly.mul(String(overtimeHours)).mul(OVERTIME_MULTIPLIER), overtimeHours);
  if (Number(holidayDays) > 0) add('HOLIDAY_WORK', daily.mul(String(holidayDays)).mul(HOLIDAY_MULTIPLIER), holidayDays);
  if (Number(weeklyRestDays) > 0) add('WEEKLY_REST_WORK', daily.mul(String(weeklyRestDays)).mul(WEEKLY_REST_MULTIPLIER), weeklyRestDays);
  return lines.map((line) => ({ ...line, basis: payBasis }));
}

/* ═══════════════ Kesintiler (net üstünden) ═══════════════ */

/**
 * Netten yapılan kesintiler, yasal sırayla: BES (prime esas kazancın oranı) → nafaka (aylık tutar) → icra
 * (bildirim sırasıyla yalnız ilk dosya; netin oranı kadar, kalan borcu aşmadan) → avans taksitleri → diğer
 * kesintiler. Ödenecek tutar eksiye düşmez: yetmeyen kesinti kesilebildiği kadar kesilir, kalanı sonraki aya kalır.
 *
 * @param {{
 *   net: number, pek: number, besRate?: string | null,
 *   garnishments?: Array<{ id: string, type: 'NAFAKA' | 'ICRA', monthly?: number | null, rate?: string | null, remaining?: number | null }>,
 *   advances?: Array<{ id: string, due: number }>,
 *   others?: Array<{ key: string, amount: number, id?: string }>,
 * }} input garnishments bildirim sırasıyla
 */
export function applyDeductions({ net, pek, besRate = null, garnishments = [], advances = [], others = [] }) {
  let available = Math.max(0, net);
  /** @type {Array<{ key: string, refId: string | null, wanted: number, amount: number }>} */
  const lines = [];
  const take = (key, refId, wanted) => {
    const amount = Math.max(0, Math.min(wanted, available));
    available -= amount;
    lines.push({ key, refId, wanted, amount });
  };
  if (besRate && Number(besRate) > 0 && pek > 0) take('BES', null, ratio(pek, besRate));
  for (const item of garnishments.filter((entry) => entry.type === 'NAFAKA')) take('NAFAKA', item.id, Math.max(0, item.monthly ?? 0));
  const icra = garnishments.find((entry) => entry.type === 'ICRA' && (entry.remaining ?? 0) > 0);
  if (icra) take('ICRA', icra.id, Math.min(ratio(Math.max(0, net), icra.rate ?? '0.25'), icra.remaining ?? 0));
  for (const advance of advances) take('ADVANCE', advance.id, Math.max(0, advance.due));
  for (const other of others) take(other.key, other.id ?? null, Math.max(0, other.amount));
  const deducted = lines.reduce((acc, line) => acc + line.amount, 0);
  return { lines, deducted, payable: Math.max(0, net) - deducted };
}

/* ═══════════════ Çıkış: kıdem, ihbar, izin ═══════════════ */

/**
 * Hizmet süresi (giriş ve çıkış günü dahil): yıl, ay, gün ve toplam gün.
 * @param {string} hireDate @param {string} endDate
 */
export function serviceLength(hireDate, endDate) {
  const start = new Date(`${hireDate}T00:00:00Z`);
  const end = new Date(dayMs(endDate) + DAY_MS); // çıkış günü dahil
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days, totalDays: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

/**
 * Kıdem tazminatı: tavanla sınırlı giydirilmiş brüt × (yıl + ay/12 + gün/365). Bir yıldan kısa hizmette doğmaz.
 * @param {{ monthlyBase: number, ceiling: number, years: number, months: number, days: number }} input kuruş
 */
export function severancePay({ monthlyBase, ceiling, years, months, days }) {
  if (years < 1) return { base: Math.min(monthlyBase, ceiling), amount: 0, eligibleByService: false };
  const base = Math.min(monthlyBase, ceiling);
  const amount = new Decimal(base).mul(years).plus(new Decimal(base).mul(months).div(12)).plus(new Decimal(base).mul(days).div(365)).toDecimalPlaces(0, HALF_UP).toNumber();
  return { base, amount, eligibleByService: true };
}

/**
 * İhbar süresi (hafta), İş Kanunu 17: 6 aydan az 2; 6 ay – 1,5 yıl 4; 1,5 – 3 yıl 6; 3 yıldan fazla 8.
 * @param {{ years: number, months: number, days: number }} service
 */
export function noticeWeeks({ years, months, days }) {
  const totalMonths = years * 12 + months + (days > 0 ? 0.5 : 0);
  if (totalMonths < 6) return 2;
  if (totalMonths < 18) return 4;
  if (totalMonths < 36) return 6;
  return 8;
}

/** İhbar tazminatı: günlük giydirilmiş brüt × 7 × hafta. @param {number} monthlyBase kuruş @param {number} weeks */
export const noticePay = (monthlyBase, weeks) => new Decimal(monthlyBase).div(MONTH_DAYS).mul(7 * weeks).toDecimalPlaces(0, HALF_UP).toNumber();

/** Kullanılmayan yıllık izin ücreti: günlük çıplak brüt × gün. @param {number} monthlyGross kuruş @param {string | number} days */
export const unusedLeavePay = (monthlyGross, days) => new Decimal(monthlyGross).div(MONTH_DAYS).mul(String(days)).toDecimalPlaces(0, HALF_UP).toNumber();
