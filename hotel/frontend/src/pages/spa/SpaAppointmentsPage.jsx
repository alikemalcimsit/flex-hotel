import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SPA_APPOINTMENT_STATUSES, SPA_APPOINTMENT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { SPA_RANGES, appointmentPath, rangeOf, shortDayLabel, spaKeys } from '../../lib/spa.js';
import { AppointmentFormDialog } from './AppointmentFormDialog.jsx';
import { AppointmentStatusBadge } from './SpaShared.jsx';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_OPTIONS = [{ value: '', label: 'Bütün durumlar' }, ...SPA_APPOINTMENT_STATUSES.map((value) => ({ value, label: SPA_APPOINTMENT_STATUS_LABELS[value] }))];

/**
 * Randevular (modül 57): gün aralığındaki birebir randevular ve ders kayıtları, başlangıç sırasıyla. Süzgeçler: dönem,
 * durum, hizmet, terapist ve arama (randevu numarası, oda numarası, ad). "Açık bakiyeler" kapanmış ama bakiyesi sıfır
 * olmayanları verir (tahsil edilecek borç ya da iade edilecek fazla ödeme).
 */
export function SpaAppointmentsPage() {
  const can = useCan();
  const canBook = can(PERMISSIONS.SPA_BOOK);
  const [range, setRange] = useState('week');
  const [view, setView] = useState('ALL');
  const [status, setStatus] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => setPage(1), [range, view, status, serviceId, therapistId, search]);

  const setup = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup') });
  const filters = { ...rangeOf(range), view, status: status || undefined, serviceId: serviceId || undefined, therapistId: therapistId || undefined, search: search || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: spaKeys.appointments(filters), queryFn: () => api(withQuery('/spa/appointments', filters)), placeholderData: keepPreviousData });
  const counts = list.data?.counts ?? {};
  const currency = list.data?.currency ?? '';

  const columns = [
    {
      key: 'when',
      header: 'Gün ve saat',
      className: 'whitespace-nowrap',
      render: (row) => (
        <Link to={appointmentPath(row.id)} className="block hover:underline">
          <span className="block font-semibold tabular-nums text-ink">
            {row.time}–{row.endTime}
          </span>
          <span className="block text-xs text-ink-muted">{shortDayLabel(row.day)}</span>
        </Link>
      ),
    },
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <Link to={appointmentPath(row.id)} className="block hover:underline">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            {row.customerName}
            {row.source === 'PORTAL' && <Icon name="globe" className="size-3.5 text-ink-muted" aria-label="Portaldan" />}
          </span>
          <span className="block text-xs text-ink-muted">
            {row.code}
            {row.roomNumber ? ` · oda ${row.roomNumber}` : row.reservationId ? '' : ' · dışarıdan'}
            {row.guestCount > 1 ? ` · ${row.guestCount} kişi` : ''}
          </span>
        </Link>
      ),
    },
    {
      key: 'service',
      header: 'Hizmet',
      render: (row) => (
        <>
          <span className="block text-ink">{row.serviceName}</span>
          <span className="block text-xs text-ink-muted">
            {row.therapists.map((item) => item.name).join(', ') || '—'}
            {row.room ? ` · ${row.room.name}` : ''}
          </span>
        </>
      ),
    },
    { key: 'status', header: 'Durum', render: (row) => <AppointmentStatusBadge status={row.status} /> },
    {
      key: 'amount',
      header: 'Tutar',
      className: 'text-right whitespace-nowrap',
      render: (row) => {
        const closed = !['BOOKED', 'WAITLISTED'].includes(row.status);
        const balance = Number(row.balance);
        return (
          <>
            <span className="block tabular-nums">{formatMoney(closed ? row.totalDue : row.priceTotal, currency)}</span>
            {closed && balance !== 0 && <Badge tone={balance > 0 ? 'warning' : 'info'}>{balance > 0 ? `${formatMoney(row.balance, currency)} açık` : `${formatMoney(String(-balance), currency)} iade`}</Badge>}
            {!closed && Number(row.paidTotal) > 0 && <span className="block text-xs text-ink-muted">{formatMoney(row.paidTotal, currency)} ön ödeme</span>}
          </>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Randevulu" value={counts.BOOKED ?? 0} hint={counts.WAITLISTED ? `${counts.WAITLISTED} yedekte` : 'Açık randevular'} icon="calendar" selected={status === 'BOOKED'} onClick={() => setStatus(status === 'BOOKED' ? '' : 'BOOKED')} />
        <SummaryTile label="Tamamlanan" value={counts.COMPLETED ?? 0} hint="Bu dönemde" icon="checkCircle" selected={status === 'COMPLETED'} onClick={() => setStatus(status === 'COMPLETED' ? '' : 'COMPLETED')} />
        <SummaryTile label="İptal" value={counts.CANCELLED ?? 0} hint="Bu dönemde" icon="close" selected={status === 'CANCELLED'} onClick={() => setStatus(status === 'CANCELLED' ? '' : 'CANCELLED')} />
        <SummaryTile label="Gelmedi" value={counts.NO_SHOW ?? 0} hint="Bu dönemde" icon="alertCircle" tone={counts.NO_SHOW ? 'warning' : 'neutral'} selected={status === 'NO_SHOW'} onClick={() => setStatus(status === 'NO_SHOW' ? '' : 'NO_SHOW')} />
      </div>
      <Toolbar
        actions={
          canBook && (
            <Button type="button" icon="plus" onClick={() => setFormOpen(true)} disabled={!setup.data}>
              Yeni randevu
            </Button>
          )
        }
      >
        <Select label="Dönem" compact options={SPA_RANGES.map(({ value, label }) => ({ value, label }))} value={range} onChange={(event) => setRange(event.target.value)} className="w-48" />
        <Select
          label="Görünüm"
          compact
          options={[
            { value: 'ALL', label: 'Hepsi' },
            { value: 'OPEN_BALANCE', label: 'Açık bakiyeler' },
          ]}
          value={view}
          onChange={(event) => setView(event.target.value)}
          className="w-40"
        />
        <Select label="Durum" compact options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-40" />
        <Select label="Hizmet" compact options={[{ value: '', label: 'Bütün hizmetler' }, ...(setup.data?.services ?? []).map((item) => ({ value: item.id, label: item.name }))]} value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="w-48" />
        <Select label="Terapist" compact options={[{ value: '', label: 'Bütün ekip' }, ...(setup.data?.therapists ?? []).map((item) => ({ value: item.id, label: item.name }))]} value={therapistId} onChange={(event) => setTherapistId(event.target.value)} className="w-44" />
        <Input label="Ara" compact="true" placeholder="Numara, oda, ad" value={text} onChange={(event) => setText(event.target.value)} className="w-44" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={view === 'OPEN_BALANCE' ? 'Açık bakiye yok' : 'Bu süzgeçlerle randevu yok'}
        emptyHint={view === 'OPEN_BALANCE' ? 'Kapanmış bütün randevuların hesabı kapalı.' : 'Dönemi ya da süzgeçleri değiştirin; yeni randevuyu takvimden ya da buradan açabilirsiniz.'}
      />
      {setup.data && <AppointmentFormDialog open={formOpen} onClose={() => setFormOpen(false)} setup={setup.data} />}
    </div>
  );
}
