import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellMinutesOf, dayHeader, groupByDepartment, groupShiftsByCell, leaveCellsOf, moveWeek, problemSetsOf, rowSummaryOf, timesheetRowOf, weekDaysOf, weekEndOf, weeklyMinutesOf } from './hrWeek.js';

describe('İK hafta ızgarası', () => {
  it('haftanın yedi günü, sonu ve ileri / geri gezinme', () => {
    const days = weekDaysOf('2026-11-23');
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-11-23');
    assert.equal(days[6], '2026-11-29');
    assert.equal(weekEndOf('2026-11-23'), '2026-11-29');
    assert.equal(moveWeek('2026-11-23', 1), '2026-11-30');
    assert.equal(moveWeek('2026-11-23', -1), '2026-11-16');
  });

  it('sütun başlığı kısa gün adı ve gün.ay verir', () => {
    assert.deepEqual(dayHeader('2026-11-23'), { weekday: 'Paz', dayText: '23.11' });
    assert.deepEqual(dayHeader('2026-11-29'), { weekday: 'Paz', dayText: '29.11' });
    assert.equal(dayHeader('2026-11-25').weekday, 'Çar');
  });

  it('vardiyaları hücreye dağıtır ve saatine göre sıralar', () => {
    const cells = groupShiftsByCell([
      { id: 'b', employeeId: 'e1', date: '2026-11-23', startTime: '16:00', endTime: '00:00' },
      { id: 'a', employeeId: 'e1', date: '2026-11-23', startTime: '08:00', endTime: '12:00' },
      { id: 'c', employeeId: 'e2', date: '2026-11-24', startTime: '09:00', endTime: '17:00' },
    ]);
    assert.deepEqual(cells.get('e1|2026-11-23').map((shift) => shift.id), ['a', 'b']);
    assert.equal(cells.get('e2|2026-11-24').length, 1);
    assert.equal(cells.get('e2|2026-11-23'), undefined);
  });

  it('izin günlerini ızgaradaki günlerle kesiştirir', () => {
    const cells = leaveCellsOf([{ employeeId: 'e1', type: 'ANNUAL', startDate: '2026-11-20', endDate: '2026-11-24' }], weekDaysOf('2026-11-23'));
    assert.equal(cells.get('e1|2026-11-23'), 'ANNUAL');
    assert.equal(cells.get('e1|2026-11-24'), 'ANNUAL');
    assert.equal(cells.get('e1|2026-11-25'), undefined);
  });

  it('haftalık dakika: sunucunun verdiği dakika ya da saatlerden hesap', () => {
    const totals = weeklyMinutesOf([
      { employeeId: 'e1', date: '2026-11-23', startTime: '08:00', endTime: '16:00', breakMinutes: 30, minutes: 450 },
      { employeeId: 'e1', date: '2026-11-24', startTime: '22:00', endTime: '06:00', breakMinutes: 0 },
    ]);
    assert.equal(totals.get('e1'), 450 + 480);
  });

  it('departmana göre gruplar; departmansızlar sonda, boş grup yok', () => {
    const groups = groupByDepartment(
      [
        { id: 'a', department: { id: 'd2', name: 'Kat' } },
        { id: 'b', department: null },
        { id: 'c', department: { id: 'd1', name: 'Ön büro' } },
      ],
      [
        { id: 'd1', name: 'Ön büro' },
        { id: 'd2', name: 'Kat' },
        { id: 'd3', name: 'Mutfak' },
      ],
    );
    assert.deepEqual(groups.map((group) => group.name), ['Ön büro', 'Kat', 'Departmansız']);
    assert.deepEqual(groups[0].employees.map((employee) => employee.id), ['c']);
  });

  it('problem kümeleri: çakışan ve kısa dinlenmeli vardiyalar, aşımlı personel', () => {
    const sets = problemSetsOf({ e1: { conflicts: [['s1', 's2']], shortRests: [], weekOverload: [{ weekStart: '2026-11-23', minutes: 3000 }] }, e2: { conflicts: [], shortRests: [['s3', 's4']], weekOverload: [] } });
    assert.ok(sets.conflicts.has('s1') && sets.conflicts.has('s2'));
    assert.ok(sets.shortRests.has('s4'));
    assert.ok(sets.overloaded.has('e1'));
    assert.ok(!sets.overloaded.has('e2'));
    assert.equal(problemSetsOf(undefined).conflicts.size, 0);
  });

  it('puantaj satırı: Geldi dışında saat ve mola sıfırlanır', () => {
    assert.deepEqual(timesheetRowOf('e1', '2026-11-23', { status: 'PRESENT', clockIn: '09:00', clockOut: '18:00', breakMinutes: '60', note: '' }), { employeeId: 'e1', date: '2026-11-23', status: 'PRESENT', clockIn: '09:00', clockOut: '18:00', breakMinutes: 60, note: null });
    assert.deepEqual(timesheetRowOf('e1', '2026-11-23', { status: 'ABSENT', clockIn: '09:00', clockOut: '18:00', breakMinutes: 60, note: 'rapor yok' }), { employeeId: 'e1', date: '2026-11-23', status: 'ABSENT', clockIn: null, clockOut: null, breakMinutes: 0, note: 'rapor yok' });
  });

  it('hücre dakikası ve taslaklı satır özeti', () => {
    assert.deepEqual(cellMinutesOf({ status: 'PRESENT', clockIn: '09:00', clockOut: '18:00', breakMinutes: '60' }, 450), { workedMinutes: 480, overtimeMinutes: 30 });
    assert.deepEqual(cellMinutesOf({ status: 'REST' }, 450), { workedMinutes: 0, overtimeMinutes: 0 });
    const cells = {
      '2026-11-23': { status: 'PRESENT', workedMinutes: 450, overtimeMinutes: 0 },
      '2026-11-24': { status: null, workedMinutes: 0, overtimeMinutes: 0 },
      '2026-11-25': { status: 'ABSENT', workedMinutes: 0, overtimeMinutes: 0 },
    };
    const summary = rowSummaryOf(cells, { '2026-11-24': { status: 'PRESENT', clockIn: '08:00', clockOut: '17:00', breakMinutes: 30 } }, 450);
    assert.deepEqual(summary, { worked: 450 + 510, overtime: 60, present: 2, absent: 1 });
  });
});
