import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADVANCE_STATUS_LABELS,
  EMPLOYEE_PAYMENT_METHOD_LABELS,
  EMPLOYEE_STATUS_LABELS,
  GARNISHMENT_STATUS_LABELS,
  GARNISHMENT_TYPE_LABELS,
  INCENTIVE_METHOD_LABELS,
  INSURANCE_TYPE_LABELS,
  NOTICE_MODE_LABELS,
  PAY_BASIS_LABELS,
  payrollPeriodLabel,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { EMPLOYEE_STATUS_TONES, payrollKeys, usePayrollLive } from '../../lib/payroll.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AdvanceDialog, GarnishmentDialog, IncentiveDialog, OpeningDialog, ReasonDialog, TerminationDialog } from './EmployeeDialogs.jsx';
import { EmployeeFormDialog } from './EmployeeFormDialog.jsx';

/** Anahtar / değer satırı. */
function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{children ?? '—'}</dd>
    </div>
  );
}

/** Küçük liste tablosu (kartın alt bölümleri). */
function MiniTable({ columns, rows, empty }) {
  if (!rows?.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            {columns.map((column) => (
              <th key={column.key} className={`py-1.5 pr-3 font-semibold ${column.className ?? ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              {columns.map((column) => (
                <td key={column.key} className={`py-2 pr-3 align-top ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Personel kartı (modül 51): kimlik, iş, ücret (izinle), teşvikler, avanslar, icra / nafaka, matrah devri ve işten
 * çıkış. Her yazma düğmesi izne göre görünür; sunucu aynı izinleri ayrıca denetler.
 */
export function EmployeePage() {
  usePayrollLive();
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { today } = useHotelToday();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const query = useQuery({ queryKey: payrollKeys.employee(employeeId), queryFn: () => api(`/payroll/employees/${employeeId}`) });
  const canManage = can(PERMISSIONS.EMPLOYEES_MANAGE);
  const canPayroll = can(PERMISSIONS.PAYROLL_MANAGE);

  const remove = useMutation({
    mutationFn: () => apiDelete(`/payroll/employees/${employeeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Kart silindi');
      navigate('/personel');
    },
  });
  const reinstate = useMutation({
    mutationFn: () => apiDelete(`/payroll/employees/${employeeId}/termination`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Çıkış geri alındı');
      setDialog(null);
    },
    onError: (error) => toastError(error.message),
  });
  const removeIncentive = useMutation({
    mutationFn: (id) => apiDelete(`/payroll/employees/${employeeId}/incentives/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: payrollKeys.all }),
    onError: (error) => toastError(error.message),
  });

  if (!query.isSuccess) return <QueryFallback query={query} errorTitle="Personel kartı açılamadı" />;
  const employee = query.data;
  const withPay = 'iban' in employee;
  const active = employee.status === 'ACTIVE';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={employee.name}
        description={`${employee.code} · ${employee.department?.name ?? ''} · ${employee.position}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/personel" className="self-center text-sm text-ink-muted hover:underline">
              ← Personel
            </Link>
            {canManage && (
              <Button type="button" variant="outline" icon="pencil" onClick={() => setDialog('edit')}>
                Düzenle
              </Button>
            )}
            {canManage && canPayroll && active && (
              <Button type="button" variant="outline" icon="logout" onClick={() => setDialog('terminate')}>
                İşten çıkış
              </Button>
            )}
            {canManage && canPayroll && !active && (
              <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setDialog('reinstate')}>
                Çıkışı geri al
              </Button>
            )}
            {canManage && (
              <Button type="button" variant="outline" icon="trash" onClick={() => setDialog('delete')}>
                Sil
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={EMPLOYEE_STATUS_TONES[employee.status]}>{EMPLOYEE_STATUS_LABELS[employee.status]}</Badge>
        <Badge tone="neutral">{INSURANCE_TYPE_LABELS[employee.insuranceType]}</Badge>
        {employee.disabilityDegree && <Badge tone="info">{employee.disabilityDegree}. derece engelli</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Kimlik ve iş">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Kimlik no">{employee.nationalId}</Field>
            <Field label="Uyruk">{employee.nationality}</Field>
            <Field label="Doğum tarihi">{employee.birthDate ? formatDate(employee.birthDate) : null}</Field>
            <Field label="Telefon">{employee.phone}</Field>
            <Field label="E-posta">{employee.email}</Field>
            <Field label="Adres">{employee.address}</Field>
            <Field label="İşe giriş">{formatDate(employee.hireDate)}</Field>
            <Field label="Kullanıcı hesabı">{employee.user ? `${employee.user.name} (${employee.user.email})` : null}</Field>
            <Field label="Servis payı puanı">{Number(employee.serviceChargePoints).toLocaleString('tr-TR')}</Field>
            <Field label="Not">{employee.notes}</Field>
          </dl>
        </Card>
        {withPay ? (
          <Card title="Ücret ve ödeme">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label={`Aylık ${employee.payBasis === 'NET' ? 'net' : 'brüt'} ücret`}>
                <span className="tabular-nums">{formatMoney(employee.salary)}</span> <span className="text-xs text-ink-muted">{PAY_BASIS_LABELS[employee.payBasis]}</span>
              </Field>
              <Field label="Ödeme">{EMPLOYEE_PAYMENT_METHOD_LABELS[employee.paymentMethod]}</Field>
              <Field label="IBAN">{employee.iban ? <span className="tabular-nums">{employee.iban.replace(/(.{4})(?=.)/g, '$1 ')}</span> : null}</Field>
              <Field label="BES">{employee.besEnrolled ? `Katılımcı · %${(Number(employee.besRate ?? 0.03) * 100).toLocaleString('tr-TR')}${employee.besOptOutOn ? ` · cayma ${formatDate(employee.besOptOutOn)}` : ''}` : 'Yok'}</Field>
            </dl>
          </Card>
        ) : (
          <Alert tone="info" title="Ücret bilgisi gizli">
            Ücret, IBAN, avans ve kesintileri bordro görüntüleme izni olanlar görür.
          </Alert>
        )}
      </div>

      {employee.termination && (
        <Card title="İşten çıkış">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Field label="Çıkış günü">{formatDate(employee.termination.terminationDate)}</Field>
            <Field label="Neden">{`${employee.termination.reasonCode} · ${employee.termination.reasonLabel}`}</Field>
            <Field label="Hizmet süresi">{`${employee.termination.service.years} yıl ${employee.termination.service.months} ay ${employee.termination.service.days} gün`}</Field>
            <Field label="İhbar">{`${NOTICE_MODE_LABELS[employee.termination.noticeMode]} (${employee.termination.noticeWeeks} hafta)`}</Field>
            {withPay && (
              <>
                <Field label="Kıdem tazminatı">{employee.termination.severanceEligible ? formatMoney(employee.termination.severanceAmount) : 'Hak yok'}</Field>
                <Field label="İhbar tutarı">{formatMoney(employee.termination.noticeAmount)}</Field>
                <Field label="İzin ücreti">{`${formatMoney(employee.termination.leaveAmount)} (${employee.termination.unusedLeaveDays} gün)`}</Field>
                <Field label="Kıdeme esas / tavan">{`${formatMoney(employee.termination.severanceBase)} / ${formatMoney(employee.termination.severanceCeiling)}`}</Field>
              </>
            )}
            {employee.termination.overrideReason && <Field label="Varsayılandan farklı seçim gerekçesi">{employee.termination.overrideReason}</Field>}
          </dl>
        </Card>
      )}

      {withPay && (
        <>
          <Card
            title="Avanslar"
            actions={
              canPayroll &&
              active && (
                <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setDialog('advance')}>
                  Avans
                </Button>
              )
            }
          >
            <MiniTable
              empty="Avans yok."
              rows={employee.advances}
              columns={[
                { key: 'paidOn', header: 'Ödeme', render: (row) => formatDate(row.paidOn) },
                { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums', render: (row) => formatMoney(row.amount) },
                { key: 'plan', header: 'Mahsup', render: (row) => `${row.installments} × ${formatMoney(row.installmentAmount)} · ${payrollPeriodLabel(row.firstYear, row.firstMonth)}'dan` },
                { key: 'deducted', header: 'Mahsup edilen', className: 'text-right tabular-nums', render: (row) => formatMoney(row.deducted) },
                { key: 'status', header: 'Durum', render: (row) => ADVANCE_STATUS_LABELS[row.status] },
                {
                  key: 'action',
                  header: '',
                  className: 'text-right',
                  render: (row) =>
                    canPayroll && row.status === 'OPEN' && Number(row.deducted) === 0 ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'cancelAdvance', id: row.id })}>
                        İptal
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card
            title="İcra ve nafaka"
            actions={
              canPayroll && (
                <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setDialog('garnishment')}>
                  Kayıt
                </Button>
              )
            }
          >
            <MiniTable
              empty="İcra ya da nafaka kaydı yok."
              rows={employee.garnishments}
              columns={[
                { key: 'type', header: 'Tür', render: (row) => GARNISHMENT_TYPE_LABELS[row.type] },
                { key: 'file', header: 'Dosya', render: (row) => <span>{row.fileNumber}<span className="block text-xs text-ink-muted">{row.authority} · {row.creditor}</span></span> },
                { key: 'notified', header: 'Tebliğ', render: (row) => formatDate(row.notifiedOn) },
                { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums', render: (row) => (row.type === 'ICRA' ? `${formatMoney(row.totalAmount)} (%${Number(row.rate) * 100})` : `${formatMoney(row.monthlyAmount)} / ay`) },
                { key: 'deducted', header: 'Kesilen', className: 'text-right tabular-nums', render: (row) => formatMoney(row.deducted) },
                { key: 'status', header: 'Durum', render: (row) => GARNISHMENT_STATUS_LABELS[row.status] },
                {
                  key: 'action',
                  header: '',
                  className: 'text-right',
                  render: (row) =>
                    canPayroll && row.status === 'ACTIVE' ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'closeGarnishment', id: row.id })}>
                        Kapat
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Teşvikler"
              actions={
                canPayroll && (
                  <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setDialog('incentive')}>
                    Teşvik
                  </Button>
                )
              }
            >
              <MiniTable
                empty="Teşvik yok: teşviksiz aylarda işyerinin Hazine indirimi uygulanır."
                rows={employee.incentives}
                columns={[
                  { key: 'code', header: 'Kod', render: (row) => <span>{row.code}<span className="block text-xs text-ink-muted">{row.label}</span></span> },
                  { key: 'method', header: 'Hesap', render: (row) => `${INCENTIVE_METHOD_LABELS[row.method]}${row.points ? ` · ${Number(row.points).toLocaleString('tr-TR')} puan` : ''}${row.amount ? ` · ${formatMoney(row.amount)}` : ''}` },
                  { key: 'range', header: 'Geçerlilik', render: (row) => `${formatDate(row.validFrom)} – ${row.validTo ? formatDate(row.validTo) : 'süresiz'}` },
                  {
                    key: 'action',
                    header: '',
                    className: 'text-right',
                    render: (row) =>
                      canPayroll ? (
                        <Button type="button" size="sm" variant="ghost" icon="trash" disabled={removeIncentive.isPending} onClick={() => removeIncentive.mutate(row.id)}>
                          Sil
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </Card>
            <Card
              title="Yıl içi matrah devri"
              actions={
                canPayroll && (
                  <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setDialog('opening')}>
                    {today.slice(0, 4)} devri
                  </Button>
                )
              }
            >
              <MiniTable
                empty="Devir yok (sisteme yıl başında geçildiyse gerekmez)."
                rows={employee.openings}
                columns={[
                  { key: 'year', header: 'Yıl', render: (row) => row.year },
                  { key: 'gv', header: 'GV matrahı', className: 'text-right tabular-nums', render: (row) => formatMoney(row.gvCumulative) },
                  { key: 'mw', header: 'Asgari ücret matrahı', className: 'text-right tabular-nums', render: (row) => formatMoney(row.minWageCumulative) },
                ]}
              />
            </Card>
          </div>
        </>
      )}

      {dialog === 'edit' && <EmployeeFormDialog employee={employee} onClose={() => setDialog(null)} />}
      {dialog === 'terminate' && <TerminationDialog employee={employee} today={today} onClose={() => setDialog(null)} />}
      {dialog === 'incentive' && <IncentiveDialog employee={employee} onClose={() => setDialog(null)} />}
      {dialog === 'advance' && <AdvanceDialog employee={employee} today={today} onClose={() => setDialog(null)} />}
      {dialog === 'garnishment' && <GarnishmentDialog employee={employee} onClose={() => setDialog(null)} />}
      {dialog === 'opening' && <OpeningDialog employee={employee} year={Number(today.slice(0, 4))} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancelAdvance' && <ReasonDialog title="Avansı iptal et" url={`/payroll/advances/${dialog.id}/cancel`} success="Avans iptal edildi" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'closeGarnishment' && <ReasonDialog title="Kesinti kaydını kapat" url={`/payroll/garnishments/${dialog.id}/cancel`} success="Kayıt kapatıldı" onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'reinstate'}
        title="Çıkışı geri al"
        message="Çıkış ve hakları (kıdem, ihbar, izin kalemleri) silinir, kart yeniden çalışıyor olur. Çıkış ayının bordrosu onaylıysa yapılamaz."
        confirmLabel="Geri al"
        confirmVariant="primary"
        confirmIcon="rotateCcw"
        isPending={reinstate.isPending}
        onConfirm={() => reinstate.mutate()}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Kartı sil"
        message="Yalnız yanlış açılmış, hiç bordroya girmemiş kart silinir; diğer kartlar için işten çıkış yapılır."
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
