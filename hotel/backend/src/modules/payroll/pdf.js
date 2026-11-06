import { INSURANCE_TYPE_LABELS, MAX_PAYSLIPS_PER_PDF, MISSING_DAY_REASONS, PAY_BASIS_LABELS, PAYROLL_RUN_STATUS_LABELS, maskIdNumber } from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';
import { hotelContext, loadPayrollSettings, periodLabel, prisma } from './shared.js';

/**
 * Bordro PDF'leri (modül 51): bordro listesi (bütün personel, toplamlı) ve personel pusulaları (kişi başı bir
 * sayfa; büyük otelde departman ya da sayfa sayfa, PDF başına en fazla `MAX_PAYSLIPS_PER_PDF`). Onaylanmamış
 * bordronun her sayfasında "TASLAK" yazar.
 */

const tl = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (value) => tl.format(Number(value ?? 0));
const plus = (...values) => values.reduce((acc, value) => acc + Number(value ?? 0), 0);

/** @param {string} hotelId @param {string} runId */
async function loadHeader(hotelId, runId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, hotelId } });
  if (!run) throw new NotFoundError('Bordro bulunamadı');
  const [context, settings] = await Promise.all([hotelContext(hotelId), loadPayrollSettings(prisma, hotelId)]);
  return { run, workplace: settings.workplaceName || context.hotel.name, sgkNo: settings.sgkWorkplaceNo, currency: context.currency };
}

/** Altlık: sayfa no + taslak uyarısı. @param {any} run */
const footerOf = (run, title) => (doc) => {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - PAGE.margin + 6;
    doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
    doc.text(`${title} · ${run.number} · ${PAYROLL_RUN_STATUS_LABELS[run.status]}${run.status === 'APPROVED' ? '' : ' — TASLAK, ödemeye esas değildir'} · Sayfa ${index - range.start + 1} / ${range.count}`, PAGE.margin, y, { width: doc.page.width - PAGE.margin * 2, align: 'center', lineBreak: false });
  }
};

/**
 * @param {string} hotelId @param {string} runId
 * @param {{ kind: 'PAYROLL' | 'PAYSLIPS', employeeId?: string, departmentId?: string, page: number }} query
 */
export async function renderPayrollPdf(hotelId, runId, query) {
  const header = await loadHeader(hotelId, runId);
  return query.kind === 'PAYSLIPS' ? renderPayslips(hotelId, header, query) : renderPayrollList(hotelId, header, query);
}

/** @param {string} hotelId @param {any} header @param {any} query */
async function renderPayrollList(hotelId, { run, workplace, sgkNo, currency }, query) {
  const entries = await prisma.payrollEntry.findMany({
    where: { hotelId, runId: run.id, ...(query.departmentId ? { departmentId: query.departmentId } : {}) },
    select: { employeeName: true, sgkDays: true, gross: true, employeeSgk: true, employeeUnemployment: true, gvPayable: true, dvPayable: true, net: true, deductionTotal: true, payable: true, employerCost: true, employee: { select: { code: true } } },
    orderBy: [{ employeeName: 'asc' }, { id: 'asc' }],
  });
  const title = `${periodLabel(run.year, run.month)} ${run.kind === 'MONTHLY' ? 'bordrosu' : 'fark bordrosu'}`;
  const columns = [
    { label: 'Sicil', width: 44 },
    { label: 'Ad soyad', width: 110 },
    { label: 'Gün', width: 26, align: 'right' },
    { label: 'Brüt', width: 62, align: 'right' },
    { label: 'SGK + işsizlik', width: 58, align: 'right' },
    { label: 'GV', width: 52, align: 'right' },
    { label: 'DV', width: 42, align: 'right' },
    { label: 'Net', width: 62, align: 'right' },
    { label: 'Kesinti', width: 52, align: 'right' },
    { label: 'Ödenecek', width: 62, align: 'right' },
    { label: 'İşveren maliyeti', width: 66, align: 'right' },
  ];
  const rows = entries.map((entry) => [entry.employee.code, entry.employeeName, String(entry.sgkDays), amount(entry.gross), amount(plus(entry.employeeSgk, entry.employeeUnemployment)), amount(entry.gvPayable), amount(entry.dvPayable), amount(entry.net), amount(entry.deductionTotal), amount(entry.payable), amount(entry.employerCost)]);
  const sum = (pick) => amount(entries.reduce((acc, entry) => acc + pick(entry), 0));
  rows.push([
    '',
    `Toplam (${entries.length} personel)`,
    '',
    sum((entry) => Number(entry.gross)),
    sum((entry) => plus(entry.employeeSgk, entry.employeeUnemployment)),
    sum((entry) => Number(entry.gvPayable)),
    sum((entry) => Number(entry.dvPayable)),
    sum((entry) => Number(entry.net)),
    sum((entry) => Number(entry.deductionTotal)),
    sum((entry) => Number(entry.payable)),
    sum((entry) => Number(entry.employerCost)),
  ]);
  return renderPdf({
    info: { Title: `${title} ${run.number}` },
    draw: (writer) => {
      writer.bold(SIZE.title, COLOR.accent);
      writer.doc.text(title, writer.left, writer.y);
      writer.y += 24;
      writer.pairs([
        ['İşyeri', workplace],
        ['SGK işyeri no', sgkNo],
        ['Bordro no', run.number],
        ['Durum', PAYROLL_RUN_STATUS_LABELS[run.status]],
        ['Para birimi', currency],
        ['Onaylayan', run.approvedBy],
      ]);
      writer.gap(10);
      writer.table(columns, rows, { boldLastRow: true });
    },
    footer: footerOf(run, title),
  });
}

/** @param {string} hotelId @param {any} header @param {any} query */
async function renderPayslips(hotelId, { run, workplace, sgkNo }, query) {
  const entries = await prisma.payrollEntry.findMany({
    where: { hotelId, runId: run.id, ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}) },
    include: { lines: { orderBy: { sortOrder: 'asc' } }, employee: { select: { code: true, nationalId: true, position: true, hireDate: true, department: { select: { name: true } } } } },
    orderBy: [{ employeeName: 'asc' }, { id: 'asc' }],
    skip: (query.page - 1) * MAX_PAYSLIPS_PER_PDF,
    take: MAX_PAYSLIPS_PER_PDF,
  });
  if (entries.length === 0) throw new NotFoundError('Pusula çıkacak satır yok');
  const title = `${periodLabel(run.year, run.month)} ücret pusulası`;
  return renderPdf({
    info: { Title: `${title} ${run.number}` },
    draw: (writer) => {
      entries.forEach((entry, index) => {
        if (index > 0) {
          writer.doc.addPage();
          writer.y = PAGE.margin;
        }
        writer.bold(SIZE.title, COLOR.accent);
        writer.doc.text(title, writer.left, writer.y);
        writer.y += 22;
        writer.pairs([
          ['İşyeri', workplace],
          ['SGK işyeri no', sgkNo],
          ['Personel', `${entry.employee.code} · ${entry.employeeName}`],
          ['Kimlik no', maskIdNumber(entry.employee.nationalId)],
          ['Departman / görev', `${entry.employee.department.name} · ${entry.employee.position}`],
          ['İşe giriş', entry.employee.hireDate.toISOString().slice(0, 10).split('-').reverse().join('.')],
          ['Ücret türü', PAY_BASIS_LABELS[entry.payBasis]],
          ['Sigorta', INSURANCE_TYPE_LABELS[entry.insuranceType]],
          ['Prim günü', String(entry.sgkDays)],
          ['Eksik gün', entry.missingDays ? `${entry.missingDays} (${MISSING_DAY_REASONS[entry.missingReason] ?? entry.missingReason ?? '—'})` : '0'],
        ]);
        writer.gap(8);
        writer.heading('Kazançlar');
        const earnings = entry.lines.filter((line) => line.kind === 'EARNING');
        writer.table(
          [
            { label: 'Kalem', width: 220 },
            { label: 'Miktar', width: 60, align: 'right' },
            { label: 'Brüt tutar', width: 90, align: 'right' },
          ],
          [...earnings.map((line) => [`${line.label}${line.isNet ? ' (netten)' : ''}`, line.quantity ?? '', amount(line.amount)]), ['Toplam brüt', '', amount(entry.gross)]],
          { boldLastRow: true },
        );
        writer.gap(8);
        writer.heading('Yasal kesintiler');
        writer.pairs([
          ['Prime esas kazanç', amount(entry.pek)],
          ['SGK işçi payı', amount(entry.employeeSgk)],
          ['İşsizlik işçi payı', amount(entry.employeeUnemployment)],
          ['GV matrahı', amount(entry.gvBase)],
          ['Birikmiş GV matrahı', amount(plus(entry.gvBefore, entry.gvBase))],
          ['Hesaplanan GV', amount(entry.gvComputed)],
          ['Asgari ücret GV istisnası', amount(entry.minWageGvExemption)],
          ['Ödenecek GV', amount(entry.gvPayable)],
          ['Damga vergisi', amount(entry.dvComputed)],
          ['Asgari ücret DV istisnası', amount(entry.minWageDvExemption)],
          ['Ödenecek DV', amount(entry.dvPayable)],
          ['Net ücret', amount(entry.net)],
        ]);
        const deductions = entry.lines.filter((line) => line.kind === 'DEDUCTION');
        if (deductions.length) {
          writer.gap(8);
          writer.heading('Diğer kesintiler');
          writer.table(
            [
              { label: 'Kesinti', width: 280 },
              { label: 'Tutar', width: 90, align: 'right' },
            ],
            [...deductions.map((line) => [line.label, amount(line.amount)]), ['Toplam', amount(entry.deductionTotal)]],
            { boldLastRow: true },
          );
        }
        writer.gap(10);
        writer.totals([
          { label: 'Net ücret', value: amount(entry.net) },
          { label: 'Kesintiler', value: amount(entry.deductionTotal) },
          { label: 'Ödenecek', value: amount(entry.payable), strong: true },
        ]);
        writer.gap(28);
        writer.regular(SIZE.small, COLOR.muted);
        writer.doc.text('Yukarıdaki ücreti eksiksiz aldım.            İmza: ______________________', writer.left, writer.y);
        writer.y += 14;
      });
    },
    footer: footerOf(run, title),
  });
}
