import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BOARD_TYPE_LABELS, RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { agencyKeys, useAgencySummary } from '../../lib/agencies.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RESERVATION_STATUS_TONES } from '../../lib/reservations.js';
import { useAgencyContext } from './AgencyPage.jsx';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_OPTIONS = [{ value: '', label: 'Bütün durumlar' }, ...Object.entries(RESERVATION_STATUS_LABELS).filter(([value]) => value !== 'WAITLISTED').map(([value, label]) => ({ value, label }))];

/** @param {{ label: string, value: string, hint?: string, strong?: boolean }} props */
function Figure({ label, value, hint, strong = false }) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-soft sm:p-5">
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</p>
      <p className={`mt-1 break-words font-bold tabular-nums ${strong ? 'text-2xl text-ink' : 'text-xl text-ink'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Acente rezervasyonları ve cari özeti (modül 29).
 *
 * Dönem: girişi bu aralıkta olan rezervasyonlar (varsayılan bu yıl). Satış ve
 * komisyon rezervasyon açılışındaki oranla hesaplanır; iptal ve gelmeyenler
 * satışa girmez, ücretleri ayrı görünür. "Cariye aktarılan", folyoda "Acente /
 * cari" yöntemiyle kapatılan tutardır; acentenin yaptığı ödemelerin düşümü ön
 * muhasebe ile gelecek. Görmek `agencies.view` ister (rezervasyon listesi izni
 * gerekmez); rezervasyon bağlantısı yalnızca o izni olana verilir.
 */
export function AgencyAccountTab() {
  const { agency } = useAgencyContext();
  const can = useCan();
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const periodValid = !period.from || !period.to || period.to >= period.from;
  const effective = periodValid ? period : { from: '', to: '' };
  const summary = useAgencySummary(agency.id, effective);
  const filters = { ...effective, status, search, page };
  const list = useQuery({
    queryKey: agencyKeys.reservations(agency.id, filters),
    queryFn: () =>
      api(
        withQuery(`/agencies/${agency.id}/reservations`, {
          from: effective.from || undefined,
          to: effective.to || undefined,
          status: status || undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const data = summary.data;
  const currency = data?.currency ?? '';
  const money = (value) => formatMoney(value, currency);
  const canOpenReservation = can(PERMISSIONS.RESERVATIONS_VIEW);

  const columns = [
    {
      key: 'code',
      header: 'Rezervasyon',
      render: (row) =>
        canOpenReservation ? (
          <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-bold text-ink hover:underline">{row.confirmationCode}</Link>
        ) : (
          <span className="font-mono text-xs font-bold">{row.confirmationCode}</span>
        ),
    },
    { key: 'guestName', header: 'Misafir', render: (row) => <span className="font-semibold">{row.guestName}</span> },
    {
      key: 'stay',
      header: 'Konaklama',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{formatDate(row.checkIn)} – {formatDate(row.checkOut)}</span>
          <span className="block text-ink-muted">{row.nights} gece · {row.roomType.name} · {BOARD_TYPE_LABELS[row.boardType]?.split(' — ')[0] ?? row.boardType}</span>
        </span>
      ),
    },
    { key: 'totalPrice', header: 'Tutar', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => money(row.totalPrice) },
    { key: 'commission', header: 'Komisyon', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => money(row.commission) },
    { key: 'dueDate', header: 'Vade', className: 'whitespace-nowrap', render: (row) => formatDate(row.dueDate) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={RESERVATION_STATUS_TONES[row.status]}>{RESERVATION_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="İlk giriş" name="cari-from" type="date" value={period.from} max={period.to || undefined} onChange={(event) => { setPeriod((current) => ({ ...current, from: event.target.value })); setPage(1); }} className="w-full sm:w-44" />
        <Input label="Son giriş" name="cari-to" type="date" value={period.to} min={period.from || undefined} onChange={(event) => { setPeriod((current) => ({ ...current, to: event.target.value })); setPage(1); }} className="w-full sm:w-44" />
        {(period.from || period.to) && <Button variant="outline" icon="rotateCcw" onClick={() => { setPeriod({ from: '', to: '' }); setPage(1); }}>Bu yıl</Button>}
        {data && <p className="text-xs text-ink-muted sm:ml-auto">Dönem: {formatDate(data.period.from)} – {formatDate(data.period.to)} (giriş tarihine göre)</p>}
      </div>
      {!periodValid && <Alert tone="warning" title="Dönem geçersiz">Son giriş, ilk girişten önce olamaz; varsayılan dönem gösteriliyor.</Alert>}

      {summary.isPending && <Spinner className="py-6" />}
      {summary.isError && (
        <Alert tone="danger" title="Cari özeti yüklenemedi" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => summary.refetch()}>Tekrar dene</Button>}>
          {summary.error.message}
        </Alert>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Figure label="Satış" value={money(data.sold.total)} hint={`${data.sold.reservations} rezervasyon · ${data.sold.nights} gece`} strong />
            <Figure label="Komisyon" value={money(data.sold.commission)} hint="Açılıştaki oranlarla" />
            <Figure label="Net (satış − komisyon)" value={money(data.sold.net)} />
            <Figure
              label="Cariye aktarılan"
              value={money(data.account.transferred)}
              hint={`Vadesi gelen ${money(data.account.dueNow)} · gelmemiş ${money(data.account.notDue)}`}
            />
          </div>
          <p className="text-xs text-ink-muted">
            Vade, çıkış gününden {data.agency.paymentTermDays} gün sonradır. &quot;Cariye aktarılan&quot; folyoda Acente / cari yöntemiyle kapatılan tutardır; acentenin yaptığı ödemelerin düşümü ön muhasebe ile gelecek.
          </p>
          {(Number(data.fees.cancellation) > 0 || Number(data.fees.noShow) > 0) && (
            <p className="text-xs text-ink-soft">
              İptal ücreti {money(data.fees.cancellation)} · gelmeme ücreti {money(data.fees.noShow)} (satışa dahil değil).
            </p>
          )}
          {data.byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.byStatus.map((row) => (
                <Badge key={row.status} tone={RESERVATION_STATUS_TONES[row.status]}>
                  {RESERVATION_STATUS_LABELS[row.status]}: {row.reservations}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Input label="Ara" name="cari-search" placeholder="Onay kodu, misafir adı ya da telefon" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Select label="Durum" name="cari-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={STATUS_OPTIONS} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || status ? 'Süzgece uyan rezervasyon yok' : 'Bu dönemde acente rezervasyonu yok'}
        emptyHint={search || status ? undefined : 'Acente adına açılan rezervasyonlar burada listelenir.'}
      />
    </div>
  );
}
