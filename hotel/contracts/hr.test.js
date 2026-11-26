import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  annualLeaveAccruals,
  annualLeaveBalance,
  annualLeaveEntitlement,
  anniversary,
  completedYears,
  countLeaveDays,
  leaveCreateSchema,
  monthlyAttendance,
  shiftInputSchema,
  shiftMinutes,
  shiftProblems,
  shiftsOverlap,
  timesheetInputSchema,
  timesheetMinutes,
  weekStartOf,
} from './hr.js';

/**
 * İK'nın saf kuralları (modül 52): yıllık izin hakkı ve bakiyesi (4857 md. 53), iş günü sayımı (md. 56), vardiya süresi /
 * çakışma / dinlenme / haftalık saat, günlük ve aylık puantaj, şema denetimleri. Sayılar elle hesaplandı.
 */

describe('yıllık izin hakkı', () => {
  it('hizmet yılına göre 14 / 20 / 26; 18 yaş altı ve 50 yaş üstü en az 20', () => {
    assert.equal(annualLeaveEntitlement(0), 0);
    assert.equal(annualLeaveEntitlement(1), 14);
    assert.equal(annualLeaveEntitlement(5), 14);
    assert.equal(annualLeaveEntitlement(6), 20);
    assert.equal(annualLeaveEntitlement(14), 20);
    assert.equal(annualLeaveEntitlement(15), 26);
    assert.equal(annualLeaveEntitlement(1, 17), 20);
    assert.equal(annualLeaveEntitlement(2, 55), 20);
    assert.equal(annualLeaveEntitlement(16, 55), 26);
  });

  it('tamamlanan yıl yıl dönümü esasıyla; 29 Şubat 28 Şubat olur', () => {
    assert.equal(completedYears('2020-03-15', '2026-03-14'), 5);
    assert.equal(completedYears('2020-03-15', '2026-03-15'), 6);
    assert.equal(completedYears('2026-01-01', '2025-12-31'), 0);
    assert.equal(anniversary('2024-02-29', 1), '2025-02-28');
    assert.equal(anniversary('2024-02-29', 4), '2028-02-29');
  });

  it('haklar her yıl dönümünde doğar; bakiye hak + düzeltme − kullanım', () => {
    const accruals = annualLeaveAccruals({ hireDate: '2019-06-01', birthDate: '1990-01-01', asOf: '2026-11-25' });
    assert.deepEqual(
      accruals.map((row) => [row.serviceYear, row.earnedOn, row.days]),
      [
        [1, '2020-06-01', 14],
        [2, '2021-06-01', 14],
        [3, '2022-06-01', 14],
        [4, '2023-06-01', 14],
        [5, '2024-06-01', 14],
        [6, '2025-06-01', 20],
        [7, '2026-06-01', 20],
      ],
    );
    const balance = annualLeaveBalance({ accruals, adjustments: [{ days: '-3' }, { days: '2.5' }], used: [{ days: '14' }, { days: '10' }] });
    assert.deepEqual(balance, { earned: 110, adjusted: -0.5, used: 24, balance: 85.5 });
    // İşten çıkış sonrası yeni hak doğmaz.
    assert.equal(annualLeaveAccruals({ hireDate: '2019-06-01', asOf: '2026-11-25', terminationDate: '2022-01-10' }).length, 2);
    assert.equal(annualLeaveAccruals({ hireDate: '2026-06-01', asOf: '2026-11-25' }).length, 0, 'ilk yıl dolmadan hak yok');
  });

  it('iş günü sayımı: hafta tatili ve resmî tatil düşülür; rapor takvim günüyle', () => {
    // 24 Kas 2026 Salı … 30 Kas 2026 Pazartesi: 7 gün; Pazar 29'u düş → 6; 27'yi tatil say → 5.
    assert.equal(countLeaveDays({ type: 'ANNUAL', startDate: '2026-11-24', endDate: '2026-11-30', weeklyRestDay: 0, holidays: [] }), 6);
    assert.equal(countLeaveDays({ type: 'ANNUAL', startDate: '2026-11-24', endDate: '2026-11-30', weeklyRestDay: 0, holidays: ['2026-11-27'] }), 5);
    assert.equal(countLeaveDays({ type: 'SICK', startDate: '2026-11-24', endDate: '2026-11-30', weeklyRestDay: 0, holidays: ['2026-11-27'] }), 7);
    assert.equal(countLeaveDays({ type: 'ANNUAL', startDate: '2026-11-29', endDate: '2026-11-29', weeklyRestDay: 0, holidays: [] }), 0, 'yalnız pazar');
    assert.equal(countLeaveDays({ type: 'ANNUAL', startDate: '2026-11-30', endDate: '2026-11-24', weeklyRestDay: 0, holidays: [] }), 0);
  });
});

describe('vardiya', () => {
  it('süre mola düşülerek; gece vardiyası ertesi güne taşar; çakışma ve dinlenme', () => {
    assert.equal(shiftMinutes({ date: '2026-11-24', startTime: '08:00', endTime: '16:30', breakMinutes: 30 }), 480);
    assert.equal(shiftMinutes({ date: '2026-11-24', startTime: '22:00', endTime: '06:00', breakMinutes: 0 }), 480);
    assert.equal(shiftsOverlap({ date: '2026-11-24', startTime: '22:00', endTime: '06:00' }, { date: '2026-11-25', startTime: '05:00', endTime: '13:00' }), true);
    assert.equal(shiftsOverlap({ date: '2026-11-24', startTime: '08:00', endTime: '16:00' }, { date: '2026-11-24', startTime: '16:00', endTime: '23:00' }), false, 'bitiş = başlangıç çakışma değil');
    const problems = shiftProblems(
      [
        { date: '2026-11-23', startTime: '08:00', endTime: '18:00', breakMinutes: 0 },
        { date: '2026-11-24', startTime: '02:00', endTime: '12:00', breakMinutes: 0 },
        { date: '2026-11-25', startTime: '08:00', endTime: '18:00', breakMinutes: 0 },
        { date: '2026-11-26', startTime: '08:00', endTime: '18:00', breakMinutes: 0 },
        { date: '2026-11-27', startTime: '08:00', endTime: '18:00', breakMinutes: 0 },
      ],
      { weeklyWorkMinutes: 2700 },
    );
    assert.deepEqual(problems.conflicts, []);
    assert.deepEqual(problems.shortRests, [[0, 1]], '18:00 → 02:00 arası 8 saat');
    assert.deepEqual(problems.weekOverload, [{ weekStart: '2026-11-23', minutes: 3000 }]);
    assert.equal(weekStartOf('2026-11-29'), '2026-11-23', 'pazar → pazartesi');
    assert.equal(weekStartOf('2026-11-23'), '2026-11-23');
  });

  it('şema: süre sıfır / 16 saat üstü reddedilir', () => {
    const base = { employeeId: '11111111-1111-4111-8111-111111111111', departmentId: '22222222-2222-4222-8222-222222222222', date: '2026-11-24' };
    assert.equal(shiftInputSchema.safeParse({ ...base, startTime: '08:00', endTime: '16:00', breakMinutes: 30 }).success, true);
    assert.equal(shiftInputSchema.safeParse({ ...base, startTime: '08:00', endTime: '08:30', breakMinutes: 30 }).success, false);
    assert.equal(shiftInputSchema.safeParse({ ...base, startTime: '06:00', endTime: '23:30', breakMinutes: 0 }).success, false);
    assert.equal(shiftInputSchema.safeParse({ ...base, startTime: '8:00', endTime: '16:00' }).success, false, 'biçim SS:DD');
  });
});

describe('puantaj', () => {
  it('günlük dakika ve mesai; gece çıkışı', () => {
    assert.deepEqual(timesheetMinutes({ clockIn: '08:00', clockOut: '17:00', breakMinutes: 60, dailyWorkMinutes: 450 }), { workedMinutes: 480, overtimeMinutes: 30 });
    assert.deepEqual(timesheetMinutes({ clockIn: '22:00', clockOut: '06:00', breakMinutes: 0, dailyWorkMinutes: 450 }), { workedMinutes: 480, overtimeMinutes: 30 });
    assert.deepEqual(timesheetMinutes({ clockIn: null, clockOut: null, dailyWorkMinutes: 450 }), { workedMinutes: 0, overtimeMinutes: 0 });
    assert.deepEqual(timesheetMinutes({ clockIn: '08:00', clockOut: '08:00', dailyWorkMinutes: 450 }), { workedMinutes: 0, overtimeMinutes: 0 }, 'aynı saat 24 saat sayılmaz');
    assert.equal(timesheetInputSchema.safeParse({ employeeId: '11111111-1111-4111-8111-111111111111', date: '2026-11-24', status: 'PRESENT', clockIn: '08:00', clockOut: '08:00' }).success, false);
    assert.equal(timesheetInputSchema.safeParse({ employeeId: '11111111-1111-4111-8111-111111111111', date: '2026-11-24', status: 'PRESENT', clockIn: '08:00' }).success, false, 'çıkışsız giriş');
    assert.equal(timesheetInputSchema.safeParse({ employeeId: '11111111-1111-4111-8111-111111111111', date: '2026-11-24', status: 'ABSENT', clockIn: '08:00', clockOut: '17:00' }).success, false, 'gelmedi gününde saat');
  });

  it('aylık özet: eksik gün = gelmedi + rapor + ücretsiz (tek neden kodu, karışıkta 12); bayram ve hafta tatili çalışması; mesai saati', () => {
    const base = { year: 2026, month: 11, weeklyRestDay: 0, holidays: ['2026-11-10'] };
    const timesheets = [
      { date: '2026-11-02', status: 'PRESENT', overtimeMinutes: 90 }, // rapor gününde: sayılmaz
      { date: '2026-11-08', status: 'PRESENT', overtimeMinutes: 0 }, // Pazar
      { date: '2026-11-10', status: 'PRESENT', overtimeMinutes: 30 }, // resmî tatil
      { date: '2026-11-11', status: 'ABSENT', overtimeMinutes: 0 },
      { date: '2026-12-01', status: 'ABSENT', overtimeMinutes: 0 }, // ay dışı
    ];
    const summary = monthlyAttendance({ ...base, timesheets, leaves: [{ type: 'SICK', startDate: '2026-10-30', endDate: '2026-11-03' }, { type: 'ANNUAL', startDate: '2026-11-16', endDate: '2026-11-20' }] });
    assert.deepEqual(summary, { missingDays: 4, missingReason: '12', workedDays: 2, overtimeHours: '0.50', holidayDays: '1', weeklyRestDays: '1', hasRecords: true });
    // İzin günündeki puantaj satırı iki kez sayılmaz.
    const overlap = monthlyAttendance({ ...base, timesheets: [{ date: '2026-11-05', status: 'ABSENT', overtimeMinutes: 0 }], leaves: [{ type: 'SICK', startDate: '2026-11-05', endDate: '2026-11-05' }] });
    assert.deepEqual([overlap.missingDays, overlap.missingReason], [1, '01']);
    const sickOnly = monthlyAttendance({ ...base, timesheets: [], leaves: [{ type: 'SICK', startDate: '2026-11-05', endDate: '2026-11-07' }] });
    assert.deepEqual([sickOnly.missingDays, sickOnly.missingReason, sickOnly.workedDays], [3, '01', 0]);
    const clean = monthlyAttendance({ ...base, timesheets: [{ date: '2026-11-02', status: 'PRESENT', overtimeMinutes: 0 }], leaves: [] });
    assert.deepEqual([clean.missingDays, clean.missingReason], [0, null]);
  });
});

describe('izin şeması', () => {
  it('bitiş başlangıçtan önce ve 365 günü aşan aralık reddedilir', () => {
    assert.equal(leaveCreateSchema.safeParse({ type: 'ANNUAL', startDate: '2026-12-01', endDate: '2026-12-05' }).success, true);
    assert.equal(leaveCreateSchema.safeParse({ type: 'ANNUAL', startDate: '2026-12-05', endDate: '2026-12-01' }).success, false);
    assert.equal(leaveCreateSchema.safeParse({ type: 'UNPAID', startDate: '2026-01-01', endDate: '2027-06-01' }).success, false);
  });
});
