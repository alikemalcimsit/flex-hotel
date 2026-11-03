import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILT_IN_PARAMETER_SETS } from './catalog.js';
import {
  applyDeductions,
  computeMonth,
  employmentDays,
  fromCents,
  incomeTax,
  noticePay,
  noticeWeeks,
  serviceLength,
  severancePay,
  solveMonth,
  toCents,
  unusedLeavePay,
  wageComponents,
} from './engine.js';

const params = BUILT_IN_PARAMETER_SETS[0].values;
const wage = (amount, extra = {}) => ({ key: 'BASE_SALARY', amount: toCents(amount), sgk: true, gv: true, dv: true, ...extra });
const month = (earnings, extra = {}) =>
  computeMonth({ params, insurance: 'NORMAL', sgkDays: 30, workedDays: 30, earnings, gvBefore: 0, minWageBefore: 0, treasuryPoints: '2', ...extra });
const money = (result, keys) => Object.fromEntries(keys.map((key) => [key, fromCents(result[key])]));

describe('bordro motoru — asgari ücret (Ocak 2026)', () => {
  it('asgari ücretli: net 28.075,50; vergiler istisnayla sıfır; işveren maliyeti resmî tabloyla aynı', () => {
    const result = month([wage('33030.00')]);
    assert.deepEqual(money(result, ['pek', 'employeeSgk', 'employeeUnemployment', 'gvBase', 'gvComputed', 'minWageGvExemption', 'gvPayable', 'dvComputed', 'dvPayable', 'net']), {
      pek: '33030.00',
      employeeSgk: '4624.20',
      employeeUnemployment: '330.30',
      gvBase: '28075.50',
      gvComputed: '4211.33',
      minWageGvExemption: '4211.33',
      gvPayable: '0.00',
      dvComputed: '250.70',
      dvPayable: '0.00',
      net: '28075.50',
    });
    // 2 puan Hazine indirimiyle 40.214,03; indirimsiz 40.874,63
    assert.equal(fromCents(result.employerCost), '40214.03');
    assert.equal(fromCents(month([wage('33030.00')], { treasuryPoints: null }).employerCost), '40874.63');
  });

  it('Temmuz: birikmiş matrah ikinci dilime geçer, istisna da geçer — asgari ücretlinin vergisi yine sıfır', () => {
    const before = toCents('28075.50') * 6;
    const result = month([wage('33030.00')], { gvBefore: before, minWageBefore: before });
    assert.equal(fromCents(result.gvComputed), '4537.75');
    assert.equal(result.gvPayable, 0);
    assert.equal(fromCents(result.net), '28075.50');
  });

  it('yarım ay (15 gün): taban, istisnalar gün payıyla', () => {
    const result = month([wage('16515.00')], { sgkDays: 15, workedDays: 15 });
    assert.equal(fromCents(result.pek), '16515.00');
    assert.equal(result.gvPayable, 0);
    assert.equal(result.dvPayable, 0);
    assert.equal(fromCents(result.net), '14037.75');
  });

  it('emekli (SGDP): işçi %7,5, işsizlik yok, Hazine indirimi yok', () => {
    const result = month([wage('33030.00')], { insurance: 'RETIRED' });
    assert.deepEqual(money(result, ['employeeSgk', 'employeeUnemployment', 'gvPayable', 'net', 'employerSgk', 'treasuryDiscount']), {
      employeeSgk: '2477.25',
      employeeUnemployment: '0.00',
      gvPayable: '0.00',
      net: '30552.75',
      employerSgk: '8174.93',
      treasuryDiscount: '0.00',
    });
  });
});

describe('bordro motoru — üst ücretler', () => {
  it('100.000 brüt: istisna asgari ücret vergisi kadar düşülür', () => {
    const result = month([wage('100000.00')]);
    assert.deepEqual(money(result, ['employeeSgk', 'gvComputed', 'gvPayable', 'dvPayable', 'net']), {
      employeeSgk: '14000.00',
      gvComputed: '12750.00',
      gvPayable: '8538.67',
      dvPayable: '508.30',
      net: '75953.03',
    });
  });

  it('SGK tavanı: prime esas kazanç 297.270 ile sınırlı, vergi dilim aşar', () => {
    const result = month([wage('400000.00')]);
    assert.equal(fromCents(result.pek), '297270.00');
    assert.equal(result.pekAtCeiling, true);
    assert.equal(fromCents(result.gvComputed), '61581.90');
    assert.equal(fromCents(result.net), '295253.63');
  });

  it('tarife: birikmiş matrahla dilim geçişi doğru bölünür', () => {
    assert.equal(fromCents(incomeTax(toCents('180000'), toCents('20000'), params.taxBrackets)), '3500.00'); // 10.000 × %15 + 10.000 × %20
    assert.equal(incomeTax(0, 0, params.taxBrackets), 0);
  });

  it('engellilik indirimi matrahtan düşer, matrahı aşmaz', () => {
    const result = month([wage('50000.00')], { disabilityDegree: 1 });
    assert.equal(fromCents(result.disabilityDeduction), '12000.00');
    assert.equal(fromCents(result.gvBase), '30500.00');
    const small = month([wage('33030.00')], { disabilityDegree: 1, sgkDays: 30 });
    assert.ok(small.gvBase >= 0);
  });
});

describe('bordro motoru — istisnalar ve indirimler', () => {
  it('yemek: GV günlük 300, SGK günlük 158 × çalışılan gün kadar istisna', () => {
    const meal = { key: 'MEAL', amount: toCents('6600.00'), sgk: true, gv: true, dv: true, exemption: 'MEAL' };
    const result = month([wage('40000.00'), meal], { workedDays: 22 });
    assert.equal(fromCents(result.mealGvExempt), '6600.00');
    assert.equal(fromCents(result.sgkMealExempt), '3476.00');
    assert.equal(fromCents(result.sgkSubject), '43124.00');
  });

  it('teşvik varsa Hazine indirimi uygulanmaz; asgari ücret üzerinden işveren payı', () => {
    const result = month([wage('60000.00')], { incentive: { method: 'MIN_WAGE_EMPLOYER_SHARE' } });
    assert.equal(result.treasuryDiscount, 0);
    assert.equal(fromCents(result.incentiveDiscount), '7184.03');
  });

  it('kıdem tazminatı: yalnız damga vergisi, asgari ücret damga istisnası ona uygulanmaz', () => {
    const severance = { key: 'SEVERANCE_PAY', amount: toCents('100000.00'), sgk: false, gv: false, dv: true, wage: false };
    const result = month([severance], { sgkDays: 0, workedDays: 0 });
    assert.equal(result.pek, 0);
    assert.equal(result.gvPayable, 0);
    assert.equal(fromCents(result.dvPayable), '759.00');
    assert.equal(fromCents(result.net), '99241.00');
  });
});

describe('bordro motoru — netten brüte', () => {
  it('net asgari ücret tam olarak brüt 33.030,00 bulur', () => {
    const { result, earnings } = solveMonth({ params, insurance: 'NORMAL', sgkDays: 30, workedDays: 30, earnings: [{ ...wage('0'), netTarget: toCents('28075.50') }], gvBefore: 0, minWageBefore: 0 });
    assert.equal(fromCents(earnings[0].amount), '33030.00');
    assert.equal(fromCents(result.net), '28075.50');
  });

  for (const [target, before] of [['50000.00', 0], ['85000.00', toCents('350000')], ['250000.00', toCents('1400000')]]) {
    it(`net ${target} (birikmiş ${fromCents(before)}): en küçük brüt, net hedefin altında değil`, () => {
      const input = { params, insurance: 'NORMAL', sgkDays: 30, workedDays: 30, gvBefore: before, minWageBefore: toCents('168453.00') };
      const { result, earnings } = solveMonth({ ...input, earnings: [{ ...wage('0'), netTarget: toCents(target) }] });
      assert.ok(result.net >= toCents(target));
      assert.ok(result.net - toCents(target) <= 2, 'hedefi en fazla birkaç kuruş aşar');
      const less = computeMonth({ ...input, earnings: [{ ...wage('0'), amount: earnings[0].amount - 1 }] });
      assert.ok(less.net < toCents(target), 'bir kuruş eksik brüt hedefi tutturamaz');
    });
  }

  it('brüt ücrete eklenen net prim: prim nete tam hedefi ekler', () => {
    const base = month([wage('60000.00')]);
    const { result } = solveMonth({ params, insurance: 'NORMAL', sgkDays: 30, workedDays: 30, gvBefore: 0, minWageBefore: 0, earnings: [wage('60000.00'), { key: 'BONUS', netTarget: toCents('10000.00'), sgk: true, gv: true, dv: true }] });
    assert.ok(result.net - base.net >= toCents('10000.00'));
    assert.ok(result.net - base.net - toCents('10000.00') <= 2);
  });
});

describe('bordro motoru — günler ve ücret kalemleri', () => {
  it('ayın tamamı 30 gün (Şubat dahil); ay içi giriş / çıkış takvim günü', () => {
    assert.equal(employmentDays({ year: 2026, month: 1, hireDate: '2025-05-01' }), 30);
    assert.equal(employmentDays({ year: 2026, month: 2, hireDate: '2025-05-01' }), 30);
    assert.equal(employmentDays({ year: 2026, month: 1, hireDate: '2026-01-16' }), 16);
    assert.equal(employmentDays({ year: 2026, month: 2, hireDate: '2026-02-15' }), 14);
    assert.equal(employmentDays({ year: 2026, month: 3, hireDate: '2025-01-01', terminationDate: '2026-03-10' }), 10);
    assert.equal(employmentDays({ year: 2026, month: 1, hireDate: '2026-02-01' }), 0);
    assert.equal(employmentDays({ year: 2026, month: 4, hireDate: '2025-01-01', terminationDate: '2026-03-31' }), 0);
  });

  it('fazla çalışma saat ücretinin 1,5 katı (aylık / 225); bayram ek günlük; hafta tatili 1,5 günlük', () => {
    const lines = wageComponents({ salary: toCents('45000.00'), payBasis: 'GROSS', days: 30, overtimeHours: '10', holidayDays: '1', weeklyRestDays: '2' });
    assert.deepEqual(
      lines.map((line) => [line.key, fromCents(line.value)]),
      [
        ['BASE_SALARY', '45000.00'],
        ['OVERTIME', '3000.00'],
        ['HOLIDAY_WORK', '1500.00'],
        ['WEEKLY_REST_WORK', '4500.00'],
      ],
    );
    assert.equal(fromCents(wageComponents({ salary: toCents('45000.00'), payBasis: 'GROSS', days: 12 })[0].value), '18000.00');
  });
});

describe('bordro motoru — kesintiler', () => {
  it('sıra: BES → nafaka → icra (netin dörtte biri, kalan borçla sınırlı) → avans', () => {
    const result = applyDeductions({
      net: toCents('28075.50'),
      pek: toCents('33030.00'),
      besRate: '0.03',
      garnishments: [
        { id: 'n1', type: 'NAFAKA', monthly: toCents('2000.00') },
        { id: 'i1', type: 'ICRA', rate: '0.25', remaining: toCents('5000.00') },
        { id: 'i2', type: 'ICRA', rate: '0.25', remaining: toCents('9000.00') },
      ],
      advances: [{ id: 'a1', due: toCents('3000.00') }],
    });
    assert.deepEqual(
      result.lines.map((line) => [line.key, line.refId, fromCents(line.amount)]),
      [
        ['BES', null, '990.90'],
        ['NAFAKA', 'n1', '2000.00'],
        ['ICRA', 'i1', '5000.00'],
        ['ADVANCE', 'a1', '3000.00'],
      ],
    );
    assert.equal(fromCents(result.payable), '17084.60');
  });

  it('net yetmezse kesinti kesilebildiği kadar; ödenecek eksiye düşmez', () => {
    const result = applyDeductions({ net: toCents('1000.00'), pek: 0, advances: [{ id: 'a1', due: toCents('3000.00') }] });
    assert.equal(fromCents(result.lines[0].amount), '1000.00');
    assert.equal(result.payable, 0);
  });
});

describe('bordro motoru — çıkış', () => {
  it('hizmet süresi yıl / ay / gün (çıkış günü dahil)', () => {
    assert.deepEqual(serviceLength('2020-03-15', '2026-06-30'), { years: 6, months: 3, days: 16, totalDays: 2299 });
    assert.deepEqual(serviceLength('2025-01-01', '2025-12-31'), { years: 1, months: 0, days: 0, totalDays: 365 });
  });

  it('kıdem tavanla sınırlı, yıl + ay/12 + gün/365; bir yıldan kısa hizmette yok', () => {
    const service = serviceLength('2020-03-15', '2026-06-30');
    const pay = severancePay({ monthlyBase: toCents('80000.00'), ceiling: toCents('64948.77'), ...service });
    assert.equal(fromCents(pay.base), '64948.77');
    assert.equal(fromCents(pay.amount), '408776.88');
    assert.equal(severancePay({ monthlyBase: toCents('80000.00'), ceiling: toCents('64948.77'), years: 0, months: 11, days: 29 }).amount, 0);
  });

  it('ihbar süresi ve tutarı; kullanılmayan izin', () => {
    assert.equal(noticeWeeks({ years: 0, months: 5, days: 0 }), 2);
    assert.equal(noticeWeeks({ years: 0, months: 6, days: 0 }), 4);
    assert.equal(noticeWeeks({ years: 1, months: 6, days: 0 }), 6);
    assert.equal(noticeWeeks({ years: 6, months: 3, days: 16 }), 8);
    assert.equal(fromCents(noticePay(toCents('80000.00'), 8)), '149333.33');
    assert.equal(fromCents(unusedLeavePay(toCents('45000.00'), '7.5')), '11250.00');
  });
});
