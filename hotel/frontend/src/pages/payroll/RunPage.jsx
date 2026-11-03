import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMPLOYEE_PAYMENT_METHOD_LABELS, EMPLOYEE_PAYMENT_METHODS, INSURANCE_TYPE_LABELS, MAX_PAYSLIPS_PER_PDF, PAY_BASIS_LABELS, PAYROLL_RUN_KIND_LABELS, PAYROLL_RUN_STATUS_LABELS, payrollPaySchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiDelete, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { PAYROLL_RUN_STATUS_TONES, downloadAccountantFile, downloadBankFile, openPayrollPdf, payrollKeys, usePayrollLive } from '../../lib/payroll.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ItemsPanel } from './ItemsPanel.jsx';

const PAGE_SIZE = 50;

/**
 * Bordro ekranı (modül 51): hesapla → onaya gönder (dört göz) → öde. Uyarılar: yeniden hesaplanmalı, parametre seti
 * teyitsiz, onay bekliyor / reddedildi. Toplamlar, departman icmali, personel satırları (hesap izi açılır), çıktılar
 * (bordro ve pusula PDF'i, banka ve müşavir Excel'i) ve ödemeler.
 */
export function RunPage() {
  usePayrollLive();
  const { runId } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [entryId, setEntryId] = useState(null);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [departmentId, setDepartmentId] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, departmentId, unpaid]);
  const run = useQuery({ queryKey: payrollKeys.run(runId), queryFn: () => api(`/payroll/runs/${runId}`) });
  const filters = { search: search || undefined, departmentId: departmentId || undefined, unpaid: unpaid ? 'true' : undefined, page, pageSize: PAGE_SIZE };
  const entries = useQuery({ queryKey: payrollKeys.entries(runId, filters), queryFn: () => api(withQuery(`/payroll/runs/${runId}/entries`, filters)), placeholderData: keepPreviousData, enabled: run.isSuccess && run.data.employeeCount > 0 });

  const useRunAction = (path, success) =>
    useMutation({
      mutationFn: () => apiPost(`/payroll/runs/${runId}/${path}`, {}),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: payrollKeys.all });
        toastSuccess(success);
      },
      onError: (error) => toastError(error.message),
    });
  const calculate = useRunAction('calculate', 'Bordro hesaplandı');
  const submit = useRunAction('submit', 'Bordro onaya gönderildi; başka bir yetkili onaylayacak');
  const remove = useMutation({
    mutationFn: () => apiDelete(`/payroll/runs/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      navigate('/bordro');
    },
  });
  const exportFile = useMutation({
    mutationFn: async (kind) => {
      const data = await api(withQuery(`/payroll/runs/${runId}/export`, { kind }));
      if (kind === 'BANK') await downloadBankFile(data);
      else await downloadAccountantFile(data);
    },
    onError: (error) => toastError(error.message),
  });

  if (!run.isSuccess) return <QueryFallback query={run} errorTitle="Bordro açılamadı" />;
  const data = run.data;
  const editable = data.status === 'DRAFT' || data.status === 'CALCULATED';
  const canManage = can(PERMISSIONS.PAYROLL_MANAGE);
  const busy = calculate.isPending || submit.isPending;
  const totals = data.totals;
  const insurance = Number(totals.employeeSgk) + Number(totals.employeeUnemployment) + Number(totals.employerSgk) + Number(totals.employerUnemployment) - Number(totals.discounts);
  const payslipPages = Math.max(1, Math.ceil(data.employeeCount / MAX_PAYSLIPS_PER_PDF));

  const columns = [
    {
      key: 'name',
      header: 'Personel',
      render: (row) => (
        <button type="button" className="block text-left hover:underline" onClick={() => setEntryId(row.id)}>
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.code} · {PAY_BASIS_LABELS[row.payBasis]} · {row.sgkDays} gün{row.missingDays ? ` (${row.missingDays} eksik)` : ''}
          </span>
        </button>
      ),
    },
    { key: 'gross', header: 'Brüt', className: 'text-right tabular-nums', render: (row) => formatMoney(row.gross) },
    { key: 'insurance', header: 'SGK + işsizlik', className: 'text-right tabular-nums', render: (row) => formatMoney(row.insurance) },
    { key: 'taxes', header: 'GV + DV', className: 'text-right tabular-nums', render: (row) => formatMoney(row.taxes) },
    { key: 'net', header: 'Net', className: 'text-right tabular-nums', render: (row) => formatMoney(row.net) },
    { key: 'deductions', header: 'Kesinti', className: 'text-right tabular-nums', render: (row) => (Number(row.deductions) ? formatMoney(row.deductions) : '—') },
    { key: 'payable', header: 'Ödenecek', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.payable) },
    { key: 'paid', header: 'Ödeme', render: (row) => (row.paidAt ? <Badge tone="success">Ödendi</Badge> : <span className="text-xs text-ink-muted">{EMPLOYEE_PAYMENT_METHOD_LABELS[row.paymentMethod]}</span>) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${data.period} ${data.kind === 'MONTHLY' ? 'bordrosu' : 'fark bordrosu'}`}
        description={`${data.number} · ${PAYROLL_RUN_KIND_LABELS[data.kind]}${data.note ? ` · ${data.note}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/bordro" className="self-center text-sm text-ink-muted hover:underline">
              ← Bordrolar
            </Link>
            {canManage && editable && (
              <Button type="button" variant={data.status === 'DRAFT' || data.stale ? 'primary' : 'outline'} icon="refresh" disabled={busy} onClick={() => calculate.mutate()}>
                {calculate.isPending ? 'Hesaplanıyor…' : data.status === 'DRAFT' ? 'Hesapla' : 'Yeniden hesapla'}
              </Button>
            )}
            {canManage && data.status === 'CALCULATED' && (
              <Button type="button" icon="send" disabled={busy || data.stale || !data.parameterSet?.verified} onClick={() => submit.mutate()}>
                Onaya gönder
              </Button>
            )}
            {can(PERMISSIONS.PAYROLL_PAY) && data.status === 'APPROVED' && Number(data.totals.paid) < Number(data.totals.payable) && (
              <Button type="button" icon="banknote" onClick={() => setDialog('pay')}>
                Öde
              </Button>
            )}
            {canManage && editable && (
              <Button type="button" variant="outline" icon="trash" onClick={() => setDialog('delete')}>
                Sil
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PAYROLL_RUN_STATUS_TONES[data.status]}>{PAYROLL_RUN_STATUS_LABELS[data.status]}</Badge>
        {data.parameterSet && (
          <Badge tone={data.parameterSet.verified ? 'neutral' : 'warning'}>
            {data.parameterSet.label} · {data.parameterSet.verified ? `teyit: ${data.parameterSet.verifiedBy}` : 'teyit edilmedi'}
          </Badge>
        )}
        {data.calculatedAt && <span className="text-xs text-ink-muted">Hesap: {formatDate(data.calculatedAt)} · {data.calculatedBy}</span>}
        {data.approvedBy && <span className="text-xs text-ink-muted">Onay: {data.approvedBy}</span>}
      </div>

      {data.stale && editable && (
        <Alert tone="warning" title="Yeniden hesaplanmalı">
          Hesaptan sonra puantaj, kalem, personel kartı ya da parametre değişti. Onaya göndermeden önce yeniden hesaplayın.
        </Alert>
      )}
      {!data.parameterSet && (
        <Alert tone="danger" title="Yasal parametre seti yok" action={<Link to="/bordro/ayarlar" className="text-sm font-semibold underline">Ayarlar</Link>}>
          Bu ay için yürürlükte yasal parametre seti yok; hazır setleri yükleyin ya da set ekleyin.
        </Alert>
      )}
      {data.parameterSet && !data.parameterSet.verified && data.status === 'CALCULATED' && (
        <Alert tone="warning" title="Parametre seti teyit edilmedi" action={<Link to="/bordro/ayarlar" className="text-sm font-semibold underline">Teyit et</Link>}>
          Hesap "{data.parameterSet.label}" setiyle yapıldı. Değerleri resmî metinle (Resmî Gazete, SGK, GİB) karşılaştırıp teyit etmeden bordro onaya gitmez.
        </Alert>
      )}
      {data.status === 'PENDING_APPROVAL' && (
        <Alert tone="info" title="Onay bekliyor">
          {data.submittedBy} onaya gönderdi. Hazırlayan onaylayamaz; Onaylar ekranından başka bir yetkili karar verir. Bu sırada ayın puantajı ve kalemleri değiştirilemez.
        </Alert>
      )}
      {data.approval?.status === 'DENIED' && data.status === 'CALCULATED' && (
        <Alert tone="danger" title="Onay reddedildi">
          {data.approval.decidedBy}: {data.approval.note ?? '—'}
        </Alert>
      )}

      {data.employeeCount > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryTile label="Personel" value={data.employeeCount} icon="users" />
          <SummaryTile label="Brüt" value={formatMoney(totals.gross)} icon="coins" />
          <SummaryTile label="Net" value={formatMoney(totals.net)} hint={Number(totals.deductions) ? `Kesinti ${formatMoney(totals.deductions)}` : undefined} icon="wallet" />
          <SummaryTile label="Ödenecek" value={formatMoney(totals.payable)} hint={Number(totals.paid) ? `Ödenen ${formatMoney(totals.paid)}` : undefined} icon="banknote" tone={data.status === 'APPROVED' && Number(totals.paid) < Number(totals.payable) ? 'warning' : 'neutral'} />
          <SummaryTile label="SGK (işçi + işveren − indirim)" value={formatMoney(insurance)} hint={Number(totals.discounts) ? `İndirim ${formatMoney(totals.discounts)}` : undefined} icon="building" />
          <SummaryTile label="İşveren maliyeti" value={formatMoney(totals.cost)} hint={`GV ${formatMoney(totals.gv)} · DV ${formatMoney(totals.dv)}`} icon="chart" />
        </div>
      )}

      {data.kind === 'SUPPLEMENTARY' && <ItemsPanel year={data.year} month={data.month} runId={data.id} locked={!editable} />}

      {data.employeeCount > 0 && (
        <Card
          title="Çıktılar"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" icon="fileText" onClick={() => openPayrollPdf(runId, { kind: 'PAYROLL', departmentId }, `${data.number}-bordro`)}>
                Bordro PDF
              </Button>
              {Array.from({ length: payslipPages }, (_, index) => (
                <Button key={index} type="button" size="sm" variant="outline" icon="fileText" onClick={() => openPayrollPdf(runId, { kind: 'PAYSLIPS', departmentId, page: index + 1 }, `${data.number}-pusula-${index + 1}`)}>
                  Pusulalar{payslipPages > 1 ? ` ${index + 1}` : ''}
                </Button>
              ))}
              <Button type="button" size="sm" variant="outline" icon="download" disabled={exportFile.isPending} onClick={() => exportFile.mutate('BANK')}>
                Banka listesi
              </Button>
              <Button type="button" size="sm" variant="outline" icon="download" disabled={exportFile.isPending} onClick={() => exportFile.mutate('ACCOUNTANT')}>
                Müşavir Excel'i
              </Button>
            </div>
          }
        >
          {data.status !== 'APPROVED' && <p className="mb-3 text-xs text-ink-muted">Onaylanmamış bordronun çıktıları "TASLAK" işaretlidir; ödemeye ve beyana esas onaylı bordrodur.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1.5 pr-3">Departman (icmal)</th>
                  <th className="py-1.5 pr-3 text-right">Personel</th>
                  <th className="py-1.5 pr-3 text-right">Brüt</th>
                  <th className="py-1.5 pr-3 text-right">Net</th>
                  <th className="py-1.5 pr-3 text-right">Ödenecek</th>
                  <th className="py-1.5 pr-3 text-right">Maliyet</th>
                </tr>
              </thead>
              <tbody>
                {data.departments.map((row) => (
                  <tr key={row.departmentId} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <button type="button" className="hover:underline" onClick={() => setDepartmentId((current) => (current === row.departmentId ? '' : row.departmentId))}>
                        {row.name}
                        {departmentId === row.departmentId ? ' ✓' : ''}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(row.gross)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(row.net)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(row.payable)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.employeeCount > 0 ? (
        <>
          <Toolbar>
            <Input label="Ara" name="entry-search" placeholder="Ad soyad" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-52" />
            <Select label="Departman" options={[{ value: '', label: 'Hepsi' }, ...data.departments.map((row) => ({ value: row.departmentId, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
            {data.status === 'APPROVED' && <Checkbox label="Yalnız ödenmemiş" checked={unpaid} onChange={(event) => setUnpaid(event.target.checked)} />}
          </Toolbar>
          <DataTable columns={columns} rows={entries.data?.items} meta={entries.data?.meta} isLoading={entries.isPending} isFetching={entries.isFetching} error={entries.isError ? entries.error : null} onRetry={() => entries.refetch()} onPageChange={setPage} emptyTitle="Eşleşen satır yok" />
        </>
      ) : (
        data.status === 'DRAFT' && (
          <Alert tone="info" title="Henüz hesaplanmadı">
            Puantaj ve ek ödemeler Puantaj sekmesinden girilir; hazır olunca "Hesapla". Ayda çalışan herkes bordroya girer.
          </Alert>
        )
      )}

      {data.payments.length > 0 && (
        <Card title="Ödemeler">
          <ul className="flex flex-col gap-2 text-sm">
            {data.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2 border-t border-line pt-2 first:border-0 first:pt-0">
                <span>
                  {formatDate(payment.date)} · {EMPLOYEE_PAYMENT_METHOD_LABELS[payment.method]} · {payment.account} · {payment.count} personel
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {entryId && <EntryDialog runId={runId} entryId={entryId} onClose={() => setEntryId(null)} />}
      {dialog === 'pay' && <PayDialog run={data} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Bordroyu sil"
        message={data.kind === 'SUPPLEMENTARY' ? 'Fark bordrosu ve ona girilen kalemler silinir.' : 'Hesap sonucu silinir; puantaj ve kalemler kalır.'}
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          remove.reset();
          setDialog(null);
        }}
      />
    </div>
  );
}

/** Satırın ayrıntısı: kalemler, yasal kesintiler, diğer kesintiler, hesap izi, pusula. */
function EntryDialog({ runId, entryId, onClose }) {
  const entry = useQuery({ queryKey: payrollKeys.entry(runId, entryId), queryFn: () => api(`/payroll/runs/${runId}/entries/${entryId}`) });
  const row = (label, value, strong = false) => (
    <div className={`flex justify-between gap-4 border-t border-line py-1.5 first:border-0 ${strong ? 'font-semibold text-ink' : ''}`}>
      <span className="text-ink-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <Modal open size="lg" title={entry.data ? `${entry.data.code} · ${entry.data.name}` : 'Bordro satırı'} onClose={onClose}>
      {!entry.isSuccess ? (
        <QueryFallback query={entry} errorTitle="Satır açılamadı" />
      ) : (
        <div className="flex flex-col gap-5 text-sm">
          <p className="text-ink-muted">
            {entry.data.position} · {PAY_BASIS_LABELS[entry.data.payBasis]} ücret · {INSURANCE_TYPE_LABELS[entry.data.insuranceType]} · {entry.data.sgkDays} prim günü
            {entry.data.missingDays ? ` · ${entry.data.missingDays} eksik gün (${entry.data.missingReasonLabel})` : ''}
            {entry.data.incentiveCode ? ` · teşvik ${entry.data.incentiveCode}` : ''}
          </p>
          <section>
            <h3 className="mb-1 font-bold text-ink">Kazançlar</h3>
            {entry.data.lines
              .filter((line) => line.kind === 'EARNING')
              .map((line, index) => (
                <div key={index}>{row(`${line.label}${line.quantity ? ` (${line.quantity})` : ''}${line.isNet ? ' · netten' : ''}`, formatMoney(line.amount))}</div>
              ))}
            {row('Toplam brüt', formatMoney(entry.data.gross), true)}
          </section>
          <section>
            <h3 className="mb-1 font-bold text-ink">Yasal kesintiler</h3>
            {row(`Prime esas kazanç${entry.data.trace?.pekAtFloor ? ' (taban)' : entry.data.trace?.pekAtCeiling ? ' (tavan)' : ''}`, formatMoney(entry.data.pek))}
            {row('SGK işçi payı', formatMoney(entry.data.employeeSgk))}
            {row('İşsizlik işçi payı', formatMoney(entry.data.employeeUnemployment))}
            {Number(entry.data.trace?.disabilityDeduction) > 0 && row('Engellilik indirimi', formatMoney(entry.data.trace.disabilityDeduction))}
            {row('GV matrahı', formatMoney(entry.data.gvBase))}
            {row('Birikmiş GV matrahı (önce → sonra)', `${formatMoney(entry.data.gvBefore)} → ${formatMoney(entry.data.trace?.gvAfter)}`)}
            {row('Hesaplanan GV', formatMoney(entry.data.gvComputed))}
            {row('Asgari ücret GV istisnası', `− ${formatMoney(entry.data.minWageGvExemption)}`)}
            {row('Ödenecek GV', formatMoney(entry.data.gvPayable))}
            {row('Damga vergisi (istisna sonrası)', `${formatMoney(entry.data.dvComputed)} − ${formatMoney(entry.data.minWageDvExemption)} = ${formatMoney(entry.data.dvPayable)}`)}
            {row('Net ücret', formatMoney(entry.data.net), true)}
          </section>
          {entry.data.lines.some((line) => line.kind === 'DEDUCTION') && (
            <section>
              <h3 className="mb-1 font-bold text-ink">Diğer kesintiler</h3>
              {entry.data.lines
                .filter((line) => line.kind === 'DEDUCTION')
                .map((line, index) => (
                  <div key={index}>{row(line.label, `− ${formatMoney(line.amount)}`)}</div>
                ))}
              {entry.data.trace?.shortfall?.length > 0 && <p className="mt-1 text-xs text-sec-strong">Net yetmediği için kesilemeyen kısım sonraki aya kaldı.</p>}
            </section>
          )}
          <section>
            {row('Ödenecek', formatMoney(entry.data.payable), true)}
            <h3 className="mb-1 mt-4 font-bold text-ink">İşveren</h3>
            {row('SGK işveren payı', formatMoney(entry.data.employerSgk))}
            {row('İşsizlik işveren payı', formatMoney(entry.data.employerUnemployment))}
            {Number(entry.data.treasuryDiscount) > 0 && row(`Hazine indirimi (${Number(entry.data.trace?.treasuryPoints ?? 0).toLocaleString('tr-TR')} puan)`, `− ${formatMoney(entry.data.treasuryDiscount)}`)}
            {Number(entry.data.incentiveDiscount) > 0 && row(`Teşvik indirimi (${entry.data.incentiveCode})`, `− ${formatMoney(entry.data.incentiveDiscount)}`)}
            {row('İşveren maliyeti', formatMoney(entry.data.employerCost), true)}
          </section>
          <p className="text-xs text-ink-muted">Parametre seti: {entry.data.trace?.parameterSet}</p>
          <div>
            <Button type="button" size="sm" variant="outline" icon="fileText" onClick={() => openPayrollPdf(runId, { kind: 'PAYSLIPS', employeeId: entry.data.employeeId }, `pusula-${entry.data.code}`)}>
              Pusula
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Maaş ödemesi: yöntem (banka / elden), hesap, gün. */
function PayDialog({ run, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [values, setValues] = useState({ method: 'BANK', treasuryAccountId: '', date: today });
  const [error, setError] = useState(null);
  const accounts = useQuery({ queryKey: ['accounting', 'treasury', 'payroll-picker'], queryFn: () => api(withQuery('/accounting/treasury', { pageSize: 100, page: 1 })) });
  const pay = useMutation({
    mutationFn: (body) => apiPost(`/payroll/runs/${run.id}/pay`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Ödeme kaydedildi; muhasebeye işleniyor');
      onClose();
    },
    onError: setError,
  });
  const kind = values.method === 'BANK' ? 'BANK' : 'CASH';
  const options = (accounts.data?.items ?? []).filter((row) => row.isActive && row.kind === kind);
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(payrollPaySchema, values);
    if (!checked.ok) return setError({ message: Object.values(checked.errors)[0] });
    pay.mutate(checked.data);
  };
  return (
    <Modal
      open
      title={`Öde: ${run.number}`}
      onClose={pay.isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pay.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="pay-form" icon="banknote" disabled={pay.isPending}>
            {pay.isPending ? 'Kaydediliyor…' : 'Ödendi olarak kaydet'}
          </Button>
        </>
      }
    >
      <form id="pay-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error.message}</Alert>}
        {accounts.isError && <Alert tone="warning">Kasa / banka hesapları okunamadı (ön muhasebe görüntüleme izni gerekir).</Alert>}
        <Select label="Yöntem" options={EMPLOYEE_PAYMENT_METHODS.map((value) => ({ value, label: EMPLOYEE_PAYMENT_METHOD_LABELS[value] }))} value={values.method} onChange={(event) => setValues((current) => ({ ...current, method: event.target.value, treasuryAccountId: '' }))} />
        <Select label={kind === 'BANK' ? 'Banka hesabı' : 'Kasa'} options={[{ value: '', label: 'Seçin' }, ...options.map((row) => ({ value: row.id, label: `${row.name} (${row.currency})` }))]} value={values.treasuryAccountId} onChange={(event) => setValues((current) => ({ ...current, treasuryAccountId: event.target.value }))} />
        <Input label="Ödeme günü" type="date" value={values.date} max={today} onChange={(event) => setValues((current) => ({ ...current, date: event.target.value }))} />
        <p className="text-xs text-ink-muted">Bu yöntemle ödenen ve henüz ödenmemiş bütün satırlar kaydedilir. Bankaya göndereceğiniz liste "Banka listesi" Excel'idir; bu kayıt kasadan / bankadan çıkışı ve personel carilerinin kapanmasını muhasebeye işler.</p>
      </form>
    </Modal>
  );
}
