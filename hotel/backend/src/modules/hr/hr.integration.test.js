import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * İK (modül 52) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: personelin kendi izin talebi → onay kuyruğu (LEAVE, dört göz) → onay / ret → bakiye ve ziller; çakışan talep,
 * yetersiz bakiye, yasal süre üstü; İK'nın onaysız girişi; onaylı iznin iptali ve kilitli bordro ayı; bakiye listesi ve
 * düzeltme; vardiya çizelgesi (çakışma hatası, kısa dinlenme uyarısı, hafta kopyalama); günlük puantaj (izinli gün, ileri
 * tarih) ve bordroya aktarım (TIMESHEET kaynağı, eksik gün nedeni, kilitli ay); özlük belgesi (PDF imzası, indirme,
 * süresi dolacaklar, hatırlatma zili, silme); izinler ve kullanıcı → personel bağı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'genelmudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'onburo@test.local';
const FNB = 'garson@test.local';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n').toString('base64');

describe('İK (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let leaves;
  /** @type {any} */ let shifts;
  /** @type {any} */ let timesheets;
  /** @type {any} */ let documents;
  /** @type {any} */ let settings;
  /** @type {any} */ let approvals;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {any} */ let dept;
  /** @type {any} */ let kitchen;
  /** @type {any} */ let ayse;
  /** @type {any} */ let mehmet;
  /** @type {any} */ let deskUser;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    leaves = await import('./leaves.js');
    shifts = await import('./shifts.js');
    timesheets = await import('./timesheets.js');
    documents = await import('./documents.js');
    settings = await import('./settings.js');
    approvals = await import('../approvals/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const hr = (fn) => as(ACCOUNTING, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const todayIso = () => core.toIsoDay(today());
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const weekday = (text) => new Date(`${text}T00:00:00.000Z`).getUTCDay();
  /** Bugünden sonraki ilk `offset` iş günü penceresi (pazar ve ayın son günü çakışmasın diye): [başlangıç, bitiş]. */
  const workdays = (startOffset, count) => {
    const days = [];
    for (let offset = startOffset; days.length < count; offset += 1) if (weekday(D(offset)) !== 0) days.push(D(offset));
    return [days[0], days.at(-1)];
  };

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: FNB, name: 'Garson', role: 'FNB', passwordHash },
      ],
    });
    deskUser = await db.user.findFirst({ where: { hotelId, email: DESK } });
    dept = await db.department.create({ data: { hotelId, code: 'ONB', name: 'Ön büro' } });
    kitchen = await db.department.create({ data: { hotelId, code: 'MUT', name: 'Mutfak' } });
    const hire = (yearsAgo) => new Date(`${Number(todayIso().slice(0, 4)) - yearsAgo}-01-15T00:00:00.000Z`);
    ayse = await db.employee.create({ data: { hotelId, code: 'P-0001', firstName: 'Ayşe', lastName: 'Demir', nationalId: '10000000146', departmentId: dept.id, position: 'Resepsiyonist', hireDate: hire(2), birthDate: new Date('1995-05-05T00:00:00.000Z'), userId: deskUser.id, createdBy: MANAGER } });
    mehmet = await db.employee.create({ data: { hotelId, code: 'P-0002', firstName: 'Mehmet', lastName: 'Kaya', nationalId: '10000000147', departmentId: kitchen.id, position: 'Aşçı', hireDate: hire(7), createdBy: MANAGER } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const alerts = (kind = 'HR') => db.staffAlert.findMany({ where: { hotelId, kind }, orderBy: { createdAt: 'asc' } });
  const saveSettings = async (patch) => {
    const current = await hr(() => settings.getHrSettings(hotelId));
    const { isDefault, updatedBy, ...rest } = current.settings;
    return hr(() => settings.saveHrSettings(hotelId, contracts.hrSettingsSchema.parse({ expectedUpdatedAt: current.settings.updatedAt, ...rest, ...patch })));
  };

  /* ═══════════════ İzin ═══════════════ */

  describe('izin', () => {
    it('personel kendi talebini girer → onay kuyruğu → müdür onaylar → bakiye düşer, ziller; çakışan, bakiye üstü ve yasal süre üstü reddedilir; bekleyeni kendisi iptal eder', async () => {
      const [start, end] = workdays(10, 3);
      const created = await call('POST', '/hr/me/leaves', DESK, { type: 'ANNUAL', startDate: start, endDate: end, reason: 'Aile ziyareti' });
      assert.equal(created.statusCode, 201, created.body);
      const leave = created.json().data;
      assert.deepEqual([leave.status, leave.days, leave.employee.code], ['PENDING', 3, 'P-0001']);
      assert.ok(leave.approvalId);
      const approval = await db.approval.findUnique({ where: { id: leave.approvalId } });
      assert.equal(approval.type, 'LEAVE');
      assert.match(approval.summary, /Ayşe Demir · Yıllık ücretli izin/);
      assert.equal(approval.expiresAt, null, 'izin onayı süresiz bekler');
      const requested = await alerts();
      assert.equal(requested.length, 1);
      assert.match(requested[0].title, /İzin talebi: Ayşe Demir/);
      // Aynı günlere ikinci talep çakışır; bakiye 28 (2 yıl × 14): 30 gün istenirse yetersiz.
      const clash = await call('POST', '/hr/me/leaves', DESK, { type: 'SICK', startDate: end, endDate: D(20) });
      assert.equal(clash.statusCode, 409, clash.body);
      assert.match(clash.body, /LEAVE_OVERLAP/);
      // Bakiye 28 (yıl dönümü aralığa girerse 42) − bekleyen 3: 48 iş günü (resmî tatil düşülse de 42 üstü) her durumda yetmez.
      const [bigStart, bigEnd] = workdays(30, 48);
      const tooMuch = await call('POST', '/hr/me/leaves', DESK, { type: 'ANNUAL', startDate: bigStart, endDate: bigEnd });
      assert.equal(tooMuch.statusCode, 409, tooMuch.body);
      assert.match(tooMuch.body, /bakiyesi yetersiz: kullanılabilir \d+ gün, istenen \d+/);
      const [mStart, mEnd] = workdays(70, 4);
      const marriage = await call('POST', '/hr/me/leaves', DESK, { type: 'MARRIAGE', startDate: mStart, endDate: mEnd });
      assert.equal(marriage.statusCode, 422, marriage.body);
      assert.match(marriage.body, /en fazla 3 iş günü/);
      // İsteyen onaylayamaz; başka müdür onaylar.
      await rejectsWith(as(DESK, () => approvals.decideApproval(hotelId, leave.approvalId, 'GRANTED', { note: 'Kendim' })), 'SELF_DECISION');
      await as(MANAGER2, () => approvals.decideApproval(hotelId, leave.approvalId, 'GRANTED', { note: 'İyi tatiller' }));
      const approved = await hr(() => leaves.getLeave(hotelId, leave.id));
      assert.deepEqual([approved.status, approved.decidedBy, approved.decisionNote], ['APPROVED', MANAGER2, 'İyi tatiller']);
      const balance = await hr(() => leaves.getLeaveBalance(hotelId, ayse.id));
      assert.deepEqual([balance.earned, balance.used, balance.balance, balance.pendingDays], [28, 3, 25, 0]);
      const mine = await call('GET', '/hr/me', DESK);
      assert.equal(mine.statusCode, 200, mine.body);
      assert.deepEqual([mine.json().data.balance.available, mine.json().data.leaves.length], [25, 1]);
      const decided = await alerts();
      assert.ok(decided.some((row) => row.userId === deskUser.id && /onaylandı/.test(row.title)));
      // Yeni bekleyen talep kendi iptal eder; onay isteği konusuz kalır.
      const [s2, e2] = workdays(40, 2);
      const second = (await call('POST', '/hr/me/leaves', DESK, { type: 'ANNUAL', startDate: s2, endDate: e2 })).json().data;
      const cancelled = await call('POST', `/hr/leaves/${second.id}/cancel`, DESK, { reason: 'Vazgeçtim' });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      assert.equal(cancelled.json().data.status, 'CANCELLED');
      assert.equal((await db.approval.findUnique({ where: { id: second.approvalId } })).status, 'EXPIRED');
      // Onaylı izni personel iptal edemez.
      const forbidden = await call('POST', `/hr/leaves/${leave.id}/cancel`, DESK, { reason: 'Olmaz' });
      assert.equal(forbidden.statusCode, 403);
    });

    it('red: karar notu izne yazılır, bakiye değişmez; İK onaysız ayarıyla doğrudan onaylı girer; onaylı iznin iptali kilitli bordro ayında reddedilir', async () => {
      const [start, end] = workdays(5, 2);
      const leave = (await call('POST', '/hr/me/leaves', DESK, { type: 'ANNUAL', startDate: start, endDate: end })).json().data;
      await as(MANAGER2, () => approvals.decideApproval(hotelId, leave.approvalId, 'DENIED', { note: 'Yoğun dönem' }));
      const rejected = await hr(() => leaves.getLeave(hotelId, leave.id));
      assert.deepEqual([rejected.status, rejected.decisionNote], ['REJECTED', 'Reddedildi: Yoğun dönem']);
      assert.equal((await hr(() => leaves.getLeaveBalance(hotelId, ayse.id))).balance, 28);
      await saveSettings({ leaveApprovalRequired: false });
      const direct = await hr(() => leaves.createLeave(hotelId, contracts.leaveCreateSchema.parse({ employeeId: mehmet.id, type: 'UNPAID', startDate: D(-3), endDate: D(-1) }), { canManage: true }));
      assert.deepEqual([direct.status, direct.days, direct.approvalId], ['APPROVED', 3, null]);
      // Ayın bordrosu onaylıysa izin iptali ay kilidine takılır.
      const [y, m] = [Number(D(-1).slice(0, 4)), Number(D(-1).slice(5, 7))];
      await db.payrollRun.create({ data: { hotelId, year: y, month: m, kind: 'MONTHLY', sequence: 1, number: `B-${y}-${String(m).padStart(2, '0')}`, status: 'APPROVED', createdBy: MANAGER } });
      await rejectsWith(hr(() => leaves.cancelLeave(hotelId, direct.id, { reason: 'Hata' }, { canManage: true })), 'PAYROLL_MONTH_LOCKED');
      await db.payrollRun.deleteMany({ where: { hotelId } });
      const cancelled = await hr(() => leaves.cancelLeave(hotelId, direct.id, { reason: 'Hata' }, { canManage: true }));
      assert.equal(cancelled.status, 'CANCELLED');
    });

    it('bakiye listesi ve elle düzeltme; 50 yaş üstü ve kıdemli personelde 20 / 26 gün', async () => {
      const veteran = await db.employee.create({ data: { hotelId, code: 'P-0003', firstName: 'Hasan', lastName: 'Yılmaz', nationalId: '10000000148', departmentId: kitchen.id, position: 'Şef', hireDate: new Date(`${Number(todayIso().slice(0, 4)) - 16}-06-01T00:00:00.000Z`), birthDate: new Date('1960-01-01T00:00:00.000Z'), createdBy: MANAGER } });
      const list = await hr(() => leaves.listLeaveBalances(hotelId, { page: 1, pageSize: 50 }));
      const row = (code) => list.items.find((item) => item.employee.code === code);
      assert.equal(row('P-0001').earned, 28);
      assert.equal(row('P-0002').earned, 5 * 14 + 2 * 20, '7 yıl: 5 × 14 + 2 × 20');
      // 16 yıl, 50 yaş üstü: ilk 5 yıl 14 (yaş 50'yi geçince 20), sonra 20, 15. yıldan sonra 26.
      const hasan = await hr(() => leaves.getLeaveBalance(hotelId, veteran.id));
      assert.equal(hasan.accruals.length, 16);
      assert.equal(hasan.accruals.at(-1).days, 26);
      assert.ok(hasan.accruals.every((item) => item.days >= 20), '50 yaş üstünde her yıl en az 20');
      const adjusted = await hr(() => leaves.addLeaveAdjustment(hotelId, contracts.leaveAdjustmentSchema.parse({ employeeId: ayse.id, days: '-3.5', effectiveOn: D(0), reason: 'Önceki sistemden devir' })));
      assert.deepEqual([adjusted.balance.adjusted, adjusted.balance.balance], [-3.5, 24.5]);
    });
    it('dört göz: kişi kendi iznini onaylayamaz (İK girse de); onay kapalıyken kendi kartına giriş yine onaya gider; çıkış sonrası ve onaylı aya izin girilmez', async () => {
      const managerUser = await db.user.findFirst({ where: { hotelId, email: MANAGER } });
      const boss = await db.employee.create({ data: { hotelId, code: 'P-0009', firstName: 'Ahmet', lastName: 'Müdür', nationalId: '10000000149', departmentId: dept.id, position: 'Müdür', hireDate: new Date(`${Number(todayIso().slice(0, 4)) - 3}-01-15T00:00:00.000Z`), userId: managerUser.id, createdBy: MANAGER } });
      const [start, end] = workdays(10, 2);
      const leave = (await call('POST', '/hr/leaves', ACCOUNTING, { employeeId: boss.id, type: 'ANNUAL', startDate: start, endDate: end })).json().data;
      assert.equal(leave.status, 'PENDING');
      await as(MANAGER, () => approvals.decideApproval(hotelId, leave.approvalId, 'GRANTED', { note: 'Kendime' }));
      const decided = await hr(() => leaves.getLeave(hotelId, leave.id));
      assert.deepEqual([decided.status, decided.decisionNote], ['REJECTED', 'Kişi kendi iznini onaylayamaz (dört göz)']);
      await saveSettings({ leaveApprovalRequired: false });
      const own = await call('POST', '/hr/leaves', MANAGER, { employeeId: boss.id, type: 'ANNUAL', startDate: start, endDate: end });
      assert.equal(own.statusCode, 201, own.body);
      assert.equal(own.json().data.status, 'PENDING', 'kendi kartına doğrudan onay yok');
      await db.employee.update({ where: { id: mehmet.id }, data: { terminationDate: new Date(`${D(12)}T00:00:00.000Z`) } });
      await rejectsWith(hr(() => leaves.createLeave(hotelId, contracts.leaveCreateSchema.parse({ employeeId: mehmet.id, type: 'UNPAID', startDate: D(10), endDate: D(15) }), { canManage: true })), 'VALIDATION', /çıkış gününden/);
      const [y, m] = [Number(D(-1).slice(0, 4)), Number(D(-1).slice(5, 7))];
      await db.payrollRun.create({ data: { hotelId, year: y, month: m, kind: 'MONTHLY', sequence: 1, number: `B-${y}-${String(m).padStart(2, '0')}`, status: 'APPROVED', createdBy: MANAGER } });
      await rejectsWith(hr(() => leaves.createLeave(hotelId, contracts.leaveCreateSchema.parse({ employeeId: ayse.id, type: 'SICK', startDate: D(-1), endDate: D(-1) }), { canManage: true })), 'PAYROLL_MONTH_LOCKED');
    });
  });

  /* ═══════════════ Vardiya ═══════════════ */

  describe('vardiya', () => {
    it('çizelge yazımı: çakışma hata, kısa dinlenme uyarı; liste problemleri; hafta kopyalama çakışanı atlar', async () => {
      const monday = contracts.weekStartOf(D(7));
      const day = (offset) => contracts.addDaysIso(monday, offset);
      const saved = await hr(() =>
        shifts.saveShifts(
          hotelId,
          contracts.shiftBatchSchema.parse({
            upserts: [
              { employeeId: ayse.id, departmentId: dept.id, date: day(0), startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
              { employeeId: ayse.id, departmentId: dept.id, date: day(1), startTime: '00:00', endTime: '08:00' },
              { employeeId: mehmet.id, departmentId: kitchen.id, date: day(0), startTime: '22:00', endTime: '06:00' },
            ],
          }),
        ),
      );
      assert.equal(saved.saved.length, 3);
      assert.equal(saved.saved[0].minutes, 450);
      assert.ok(saved.warnings[ayse.id]?.shortRests.length === 1, '16:00 → 00:00 arası 8 saat');
      await rejectsWith(
        hr(() => shifts.saveShifts(hotelId, contracts.shiftBatchSchema.parse({ upserts: [{ employeeId: mehmet.id, departmentId: kitchen.id, date: day(1), startTime: '05:00', endTime: '13:00' }] }))),
        'SHIFT_OVERLAP',
        /22:00–06:00/,
      );
      const grid = await hr(() => shifts.listShifts(hotelId, { from: monday, to: day(6) }));
      assert.equal(grid.shifts.length, 3);
      assert.ok(grid.problems[ayse.id]?.shortRests.length === 1);
      assert.equal(grid.days.length, 7);
      // Hedef haftada çakışan vardiya atlanır.
      await hr(() => shifts.saveShifts(hotelId, contracts.shiftBatchSchema.parse({ upserts: [{ employeeId: ayse.id, departmentId: dept.id, date: day(7), startTime: '10:00', endTime: '14:00' }] })));
      const copied = await hr(() => shifts.copyWeek(hotelId, contracts.shiftCopyWeekSchema.parse({ fromWeekStart: monday, toWeekStart: day(7) })));
      assert.deepEqual(copied, { copied: 2, skipped: 1 });
      const removed = await hr(() => shifts.saveShifts(hotelId, contracts.shiftBatchSchema.parse({ deletes: [saved.saved[2].id] })));
      assert.equal(removed.deleted, 1);
      assert.equal(await db.shift.count({ where: { hotelId } }), 5);
      // Başka otelin vardiya kimliğiyle güncelleme bulunamadı döner (otel sınırı).
      const other = await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } });
      const otherDept = await db.department.create({ data: { hotelId: other.id, code: 'X', name: 'X' } });
      const otherEmp = await db.employee.create({ data: { hotelId: other.id, code: 'P-0001', firstName: 'Ali', lastName: 'Veli', nationalId: '10000000150', departmentId: otherDept.id, position: 'X', hireDate: new Date('2020-01-01T00:00:00.000Z'), createdBy: MANAGER } });
      const foreign = await db.shift.create({ data: { hotelId: other.id, employeeId: otherEmp.id, departmentId: otherDept.id, date: new Date(`${day(2)}T00:00:00.000Z`), startTime: '08:00', endTime: '16:00', createdBy: MANAGER } });
      await rejectsWith(hr(() => shifts.saveShifts(hotelId, contracts.shiftBatchSchema.parse({ upserts: [{ id: foreign.id, employeeId: ayse.id, departmentId: dept.id, date: day(3), startTime: '08:00', endTime: '16:00' }] }))), 'NOT_FOUND');
      assert.equal((await db.shift.findUnique({ where: { id: foreign.id } })).hotelId, other.id);
    });
  });

  /* ═══════════════ Puantaj ═══════════════ */

  describe('puantaj', () => {
    it('günlük kayıt (izinli gün ve ileri tarih reddedilir) → bordroya aktarım: TIMESHEET kaynağı, eksik gün nedeni, mesai; kilitli ay reddedilir', async () => {
      await saveSettings({ leaveApprovalRequired: false, weeklyRestDay: 0, publicHolidays: [] });
      // Geçen ayın tamamı: aylık özet için sabit bir ay.
      const base = new Date(`${todayIso()}T00:00:00.000Z`);
      const prev = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
      const year = prev.getUTCFullYear();
      const month = prev.getUTCMonth() + 1;
      const d = (n) => `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      await hr(() => leaves.createLeave(hotelId, contracts.leaveCreateSchema.parse({ employeeId: ayse.id, type: 'SICK', startDate: d(10), endDate: d(12) }), { canManage: true }));
      await rejectsWith(hr(() => timesheets.saveTimesheets(hotelId, contracts.timesheetBatchSchema.parse({ rows: [{ employeeId: ayse.id, date: d(11), status: 'ABSENT' }] }))), 'TIMESHEET_ON_LEAVE');
      await rejectsWith(hr(() => timesheets.saveTimesheets(hotelId, contracts.timesheetBatchSchema.parse({ rows: [{ employeeId: ayse.id, date: D(1), status: 'PRESENT', clockIn: '08:00', clockOut: '17:00' }] }))), 'VALIDATION', /İleri tarih/);
      const rows = [
        { employeeId: ayse.id, date: d(1), status: 'PRESENT', clockIn: '08:00', clockOut: '18:00', breakMinutes: 60 },
        { employeeId: ayse.id, date: d(2), status: 'PRESENT', clockIn: '08:00', clockOut: '15:30', breakMinutes: 0 },
        { employeeId: ayse.id, date: d(3), status: 'ABSENT' },
        { employeeId: mehmet.id, date: d(1), status: 'PRESENT', clockIn: '22:00', clockOut: '06:00', breakMinutes: 0 },
      ];
      const saved = await hr(() => timesheets.saveTimesheets(hotelId, contracts.timesheetBatchSchema.parse({ rows })));
      assert.equal(saved.saved, 4);
      const grid = await hr(() => timesheets.listTimesheets(hotelId, { from: d(1), to: d(12), page: 1, pageSize: 50 }));
      const ayseRow = grid.items.find((item) => item.employee.code === 'P-0001');
      assert.deepEqual([ayseRow.cells[d(1)].workedMinutes, ayseRow.cells[d(1)].overtimeMinutes, ayseRow.cells[d(1)].clockOut], [540, 90, '18:00']);
      assert.deepEqual([ayseRow.cells[d(11)].status, ayseRow.cells[d(11)].leaveType, ayseRow.cells[d(11)].saved], ['LEAVE', 'SICK', false]);
      assert.equal(ayseRow.summary.overtime, 90);
      const exported = await hr(() => timesheets.exportToPayroll(hotelId, { year, month }));
      assert.equal(exported.exported, 2);
      const attendance = await db.payrollAttendance.findFirst({ where: { employeeId: ayse.id, year, month } });
      assert.deepEqual(
        [attendance.source, attendance.missingDays, attendance.missingReason, attendance.workedDays, String(attendance.overtimeHours)],
        ['TIMESHEET', 4, '12', 2, '1.5'],
        'rapor 3 + devamsız 1 = 4 (karışık → 12); 2 gün geldi; 90 dk mesai',
      );
      const mehmetRow = await db.payrollAttendance.findFirst({ where: { employeeId: mehmet.id, year, month } });
      assert.deepEqual([mehmetRow.missingDays, mehmetRow.missingReason, String(mehmetRow.overtimeHours)], [0, null, '0.5']);
      // Onaylı bordro: aktarım ve puantaj yazımı kilitli.
      await db.payrollRun.create({ data: { hotelId, year, month, kind: 'MONTHLY', sequence: 1, number: `B-${year}-${String(month).padStart(2, '0')}`, status: 'APPROVED', createdBy: MANAGER } });
      await rejectsWith(hr(() => timesheets.exportToPayroll(hotelId, { year, month })), 'PAYROLL_MONTH_LOCKED');
      await rejectsWith(hr(() => timesheets.saveTimesheets(hotelId, contracts.timesheetBatchSchema.parse({ rows: [{ employeeId: ayse.id, date: d(4), status: 'ABSENT' }] }))), 'PAYROLL_MONTH_LOCKED');
    });
  });

  /* ═══════════════ Belgeler ═══════════════ */

  describe('özlük belgeleri', () => {
    it('PDF yükleme ve indirme; tür uyuşmazlığı reddedilir; süresi dolacaklar listesi, hatırlatma zili (tekrar etmez), silme', async () => {
      const upload = await call('POST', `/hr/employees/${ayse.id}/documents`, ACCOUNTING, { type: 'HEALTH_REPORT', title: 'Periyodik sağlık raporu', issuedOn: D(-300), expiresOn: D(10), file: { name: 'rapor.pdf', contentType: 'application/pdf', data: PDF } });
      assert.equal(upload.statusCode, 201, upload.body);
      const doc = upload.json().data.document;
      assert.deepEqual([doc.hasFile, doc.daysLeft, doc.expired], [true, 10, false]);
      const mismatch = await call('POST', `/hr/employees/${ayse.id}/documents`, ACCOUNTING, { type: 'CONTRACT', title: 'Sözleşme', file: { name: 'x.png', contentType: 'image/png', data: PDF } });
      assert.equal(mismatch.statusCode, 422, mismatch.body);
      const noFile = await call('POST', `/hr/employees/${mehmet.id}/documents`, ACCOUNTING, { type: 'HYGIENE_CERTIFICATE', title: 'Hijyen belgesi', expiresOn: D(-5) });
      assert.equal(noFile.statusCode, 201);
      const file = await call('GET', `/hr/documents/${doc.id}/file`, MANAGER);
      assert.equal(file.statusCode, 200);
      assert.equal(file.headers['content-type'], 'application/pdf');
      assert.ok(file.rawPayload.toString('latin1').startsWith('%PDF-'));
      const expiring = (await call('GET', '/hr/documents?expiringWithin=30', ACCOUNTING)).json().data;
      assert.deepEqual(expiring.items.map((item) => [item.typeLabel.split(' ')[0], item.expired]), [['Hijyen', true], ['Sağlık', false]]);
      const reminded = await documents.remindExpiringDocuments(hotelId);
      assert.equal(reminded.alerted, 2);
      const again = await documents.remindExpiringDocuments(hotelId);
      assert.equal(again.alerted, 0, 'yedi gün dolmadan tekrar hatırlatmaz');
      const alert = (await alerts()).find((row) => /özlük belgesinin süresi/.test(row.title));
      assert.ok(alert);
      assert.match(alert.title, /1 tanesi dolmuş/);
      const removed = await call('DELETE', `/hr/documents/${doc.id}`, ACCOUNTING);
      assert.equal(removed.statusCode, 200);
      assert.equal((await call('GET', `/hr/documents/${doc.id}/file`, MANAGER)).statusCode, 404);
      assert.equal((await call('GET', `/hr/documents?employeeId=${ayse.id}`, ACCOUNTING)).json().data.items.length, 0);
    });
  });

  /* ═══════════════ İzinler ═══════════════ */

  describe('izinler ve bağ', () => {
    it('ön büro İK listesini göremez, kendi sayfasını görür; karta bağlı olmayan kullanıcı 403 açıklamasıyla; muhasebe ayar yazar; ayar kilidi', async () => {
      assert.equal((await call('GET', '/hr/leaves', DESK)).statusCode, 403);
      assert.equal((await call('GET', '/hr/me', DESK)).statusCode, 200);
      const unlinked = await call('GET', '/hr/me', FNB);
      assert.equal(unlinked.statusCode, 403);
      assert.match(unlinked.body, /personel kartına bağlı değil/);
      assert.equal((await call('GET', '/hr/shifts?from=' + D(0) + '&to=' + D(6), ACCOUNTING)).statusCode, 200);
      const current = (await call('GET', '/hr/settings', ACCOUNTING)).json().data;
      assert.equal(current.settings.isDefault, true);
      assert.ok(current.settings.publicHolidays.some((holiday) => holiday.date.endsWith('-10-29')), 'sabit tatiller varsayılan');
      const { isDefault, updatedBy, ...rest } = current.settings;
      const saved = await call('PUT', '/hr/settings', ACCOUNTING, { ...rest, expectedUpdatedAt: current.settings.updatedAt, weeklyRestDay: 1, dailyWorkMinutes: 480, documentReminderDays: 45 });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.deepEqual([saved.json().data.settings.weeklyRestDay, saved.json().data.settings.isDefault], [1, false]);
      const stale = await call('PUT', '/hr/settings', ACCOUNTING, { ...rest, expectedUpdatedAt: current.settings.updatedAt, weeklyRestDay: 2 });
      assert.equal(stale.statusCode, 200, 'ilk kayıtta önceki updatedAt yok → kilit yok');
      const stale2 = await call('PUT', '/hr/settings', ACCOUNTING, { ...rest, expectedUpdatedAt: saved.json().data.settings.updatedAt, weeklyRestDay: 3 });
      assert.equal(stale2.statusCode, 409, stale2.body);
      assert.equal((await call('PUT', '/hr/settings', DESK, { ...rest, weeklyRestDay: 1 })).statusCode, 403);
    });
  });
});
