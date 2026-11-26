import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LEAVE_STATUS_LABELS, weekStartOf } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { LEAVE_STATUS_TONES, daysText, hrKeys, minutesText, useHrLive } from '../../lib/hr.js';
import { dayHeader, moveWeek, shiftLabel, weekEndOf } from '../../lib/hrWeek.js';
import { LeaveCancelDialog, LeaveDialog } from './LeaveDialog.jsx';

const HTTP_FORBIDDEN = 403;

/**
 * Personelin kendi İK sayfası (modül 52, `hr.self`): kart, yıllık izin bakiyesi (hak / kullanılan / kalan /
 * bekleyen), "İzin talebi", izinlerim (bekleyeni iptal), bu ve gelecek haftanın vardiyaları, bu ayın puantaj özeti.
 * Kullanıcı hesabı personel kartına bağlı değilse (403) açıklayıcı boş durum.
 */
export function MyHrPage() {
  useHrLive();
  const [dialog, setDialog] = useState(null);
  const query = useQuery({ queryKey: hrKeys.me, queryFn: () => api('/hr/me'), retry: (count, error) => error?.status !== HTTP_FORBIDDEN && count < 2 });
  if (query.isError && query.error.status === HTTP_FORBIDDEN) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="İzinlerim" />
        <Card>
          <EmptyState icon="user" title="Personel kartınız bağlı değil" description={query.error.message} />
        </Card>
      </div>
    );
  }
  if (!query.isSuccess) return <QueryFallback query={query} errorTitle="Sayfa yüklenemedi" />;
  const data = query.data;
  const thisWeek = weekStartOf(data.today);
  const nextWeek = moveWeek(thisWeek, 1);
  const shiftsOf = (weekStart) => data.shifts.filter((shift) => shift.date >= weekStart && shift.date <= weekEndOf(weekStart));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="İzinlerim"
        description={`${data.employee.name} · ${data.employee.code}${data.employee.department ? ` · ${data.employee.department.name}` : ''} · ${data.employee.position} · işe giriş ${formatDate(data.employee.hireDate)}`}
        actions={
          <Button type="button" icon="plus" onClick={() => setDialog({ kind: 'request' })}>
            İzin talebi
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Yıllık izin hakkı" value={daysText(data.balance.earned)} hint={data.balance.adjusted ? `${daysText(data.balance.adjusted)} gün düzeltme dahil` : 'Yıl dönümlerinde doğan hak'} icon="sun" />
        <SummaryTile label="Kullanılan" value={daysText(data.balance.used)} hint="Onaylı yıllık izin" icon="checkCheck" />
        <SummaryTile label="Kalan" value={daysText(data.balance.available)} hint={data.balance.pendingDays ? `Bekleyen talep düşülmüş (${daysText(data.balance.balance)} bakiye)` : `${formatDate(data.balance.asOf)} itibarıyla`} icon="calendar" tone={Number(data.balance.available) < 0 ? 'danger' : 'neutral'} />
        <SummaryTile label="Onay bekleyen" value={daysText(data.balance.pendingDays)} hint="Yıllık izin talepleri" icon="clock" tone={data.balance.pendingDays ? 'warning' : 'neutral'} />
      </div>
      {!data.settings.leaveApprovalRequired && (
        <Alert tone="info">İzin talebiniz yine de onaya gider; ayar yalnız İK'nın girdiği izinleri doğrudan onaylar.</Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="İzinlerim" className="lg:col-span-2">
          {data.leaves.length === 0 ? (
            <p className="text-sm text-ink-muted">Henüz izin kaydınız yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="py-1.5 pr-3 font-semibold">Tür</th>
                    <th className="py-1.5 pr-3 font-semibold">Tarih</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Gün</th>
                    <th className="py-1.5 pr-3 font-semibold">Durum</th>
                    <th className="py-1.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {data.leaves.map((leave) => (
                    <tr key={leave.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3">
                        <span className="block font-medium text-ink">{leave.typeLabel}</span>
                        {leave.reason && <span className="block max-w-xs truncate text-xs text-ink-muted">{leave.reason}</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{daysText(leave.days)}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={LEAVE_STATUS_TONES[leave.status]}>{LEAVE_STATUS_LABELS[leave.status]}</Badge>
                        {leave.status === 'REJECTED' && leave.decisionNote && <span className="block mt-1 max-w-xs text-xs text-ink-muted">{leave.decisionNote}</span>}
                        {leave.status === 'CANCELLED' && leave.cancelReason && <span className="block mt-1 max-w-xs text-xs text-ink-muted">{leave.cancelReason}</span>}
                        {leave.status === 'APPROVED' && leave.decidedAt && <span className="block mt-1 text-xs text-ink-muted">{formatDateTime(leave.decidedAt)}</span>}
                      </td>
                      <td className="py-2 text-right">
                        {leave.status === 'PENDING' && (
                          <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setDialog({ kind: 'cancel', leave })}>
                            İptal
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Bu ay" description={`${formatDate(data.month.from)} – ${formatDate(data.today)}`}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Geldiğim gün" value={data.month.presentDays} />
            <Stat label="Gelmediğim gün" value={data.month.absentDays} tone={data.month.absentDays ? 'danger' : undefined} />
            <Stat label="Çalışma" value={minutesText(data.month.workedMinutes)} />
            <Stat label="Mesai" value={minutesText(data.month.overtimeMinutes)} tone={data.month.overtimeMinutes ? 'warning' : undefined} />
          </dl>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ShiftsCard title="Bu hafta" weekStart={thisWeek} shifts={shiftsOf(thisWeek)} today={data.today} />
        <ShiftsCard title="Gelecek hafta" weekStart={nextWeek} shifts={shiftsOf(nextWeek)} today={data.today} />
      </div>
      {dialog?.kind === 'request' && <LeaveDialog self settings={data.settings} today={data.today} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancel' && <LeaveCancelDialog leave={{ ...dialog.leave, employee: data.employee }} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** @param {{ label: string, value: React.ReactNode, tone?: 'danger' | 'warning' }} props */
function Stat({ label, value, tone }) {
  const color = tone === 'danger' ? 'text-sec-strong' : tone === 'warning' ? 'text-warning-ink' : 'text-ink';
  return (
    <div className="rounded-item bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

/** Haftanın vardiyaları. @param {{ title: string, weekStart: string, shifts: any[], today: string }} props */
function ShiftsCard({ title, weekStart, shifts, today }) {
  return (
    <Card title={title} description={`${formatDate(weekStart)} – ${formatDate(weekEndOf(weekStart))}`}>
      {shifts.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu haftaya vardiya yazılmamış.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shifts.map((shift) => {
            const { weekday, dayText } = dayHeader(shift.date);
            return (
              <li key={shift.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${shift.date === today ? 'font-semibold' : ''}`}>
                <span className="w-20 shrink-0 tabular-nums text-ink-soft">
                  {weekday} {dayText}
                </span>
                <span className="flex-1 tabular-nums text-ink">{shiftLabel(shift)}</span>
                <span className="truncate text-xs text-ink-muted">
                  {shift.department}
                  {shift.breakMinutes ? ` · ${shift.breakMinutes} dk mola` : ''}
                  {shift.note ? ` · ${shift.note}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
