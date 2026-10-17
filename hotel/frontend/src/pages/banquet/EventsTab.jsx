import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EVENT_STATUSES, EVENT_STATUS_LABELS, EVENT_TYPES, EVENT_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api, withQuery } from '../../lib/api.js';
import { EVENT_STATUS_TONES, banquetKeys, dayText, eventPath, wallText } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;

const STATUS_FILTERS = Object.freeze([{ value: '', label: 'Hepsi' }, ...EVENT_STATUSES.map((value) => ({ value, label: EVENT_STATUS_LABELS[value] }))]);
const TYPE_OPTIONS = Object.freeze([{ value: '', label: 'Bütün türler' }, ...EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_LABELS[value] }))]);

/**
 * Etkinlik dosyaları (modül 37): ilk oturum gününe göre sıralı, sayfalı ve canlı.
 * Duruma, türe, tarih aralığına ve "benim dosyalarım"a göre süzgeç; numara, ad ya
 * da müşteriyle arama. Opsiyonlu dosyada sıra ve opsiyonun son günü görünür.
 */
export function EventsTab() {
  const can = useCan();
  const { isLive = true } = useOutletContext() ?? {};
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const rangeError = from && to && to < from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const filters = { search, status, type, from, to, mine, page };
  const list = useQuery({
    queryKey: banquetKeys.events(filters),
    queryFn: () =>
      api(
        withQuery('/banquet/events', {
          search: search || undefined,
          status: status || undefined,
          type: type || undefined,
          from: from || undefined,
          to: to || undefined,
          mine: mine ? 'true' : undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    enabled: !rangeError,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const currency = list.data?.meta?.currency ?? '';
  const reset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const columns = [
    {
      key: 'event',
      header: 'Dosya',
      render: (row) => (
        <Link to={eventPath(row.id)} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block truncate text-xs text-ink-muted">
            <span className="font-mono">{row.code}</span> · {row.client.name}
          </span>
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'İlk oturum',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{row.firstStartLocal ? wallText(row.firstStartLocal) : 'Program yok'}</span>
          <span className="block text-ink-muted">
            {EVENT_TYPE_LABELS[row.type]} · {row.sessionCount} oturum
          </span>
        </span>
      ),
    },
    {
      key: 'pax',
      header: 'Kişi',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{row.billablePax.toLocaleString('tr-TR')}</span>
          <span className="block text-ink-muted">{row.guaranteedPax ? 'garanti' : 'tahmini'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={EVENT_STATUS_TONES[row.status]}>{EVENT_STATUS_LABELS[row.status]}</Badge>
          {row.status === 'TENTATIVE' && (
            <span className={`text-xs font-semibold ${row.optionRank > 1 ? 'text-warning-ink' : 'text-ink-muted'}`}>
              {row.optionRank}. opsiyon · son gün {dayText(row.optionUntil)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Tutar / bakiye',
      className: 'whitespace-nowrap text-right',
      render: (row) => {
        const balance = Number(row.balance);
        const untouched = Number(row.amountDue) === 0 && Number(row.paidTotal) === 0;
        return (
          <span className="block text-xs tabular-nums">
            <span className="block font-semibold text-ink">{row.status === 'LOST' ? '—' : formatMoney(row.amountDue, currency)}</span>
            <span className={`block ${balance > 0 ? 'text-warning-ink' : balance < 0 ? 'text-info-ink' : 'text-ink-muted'}`}>
              {untouched ? '—' : balance > 0 ? `${formatMoney(row.balance, currency)} kalan` : balance < 0 ? `${formatMoney(Math.abs(balance), currency)} iade edilecek` : 'ödendi'}
            </span>
          </span>
        );
      },
    },
  ];

  const filtered = Boolean(search || status || type || from || to || mine);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Durum">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => reset(setStatus)(option.value)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${status === option.value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className={`ml-auto text-xs font-semibold ${isLive ? 'text-success-ink' : 'text-warning-ink'}`}>{isLive ? 'Canlı' : 'Canlı değil — dakikada bir tazelenir'}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Ara" name="event-search" placeholder="Numara, etkinlik ya da müşteri" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:max-w-xs" />
        <Select label="Tür" name="event-type" options={TYPE_OPTIONS} value={type} onChange={(event) => reset(setType)(event.target.value)} className="w-full sm:w-48" />
        <Input label="Başlangıç" name="event-from" type="date" value={from} onChange={(event) => reset(setFrom)(event.target.value)} className="w-full sm:w-44" />
        <Input label="Bitiş" name="event-to" type="date" value={to} min={from || undefined} onChange={(event) => reset(setTo)(event.target.value)} error={rangeError ?? undefined} className="w-full sm:w-44" />
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-soft">
          <Switch checked={mine} onChange={(next) => reset(setMine)(next)} label="Yalnızca benim dosyalarım" />
          Benim dosyalarım
        </label>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !rangeError}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan etkinlik yok' : 'Henüz etkinlik dosyası yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeçleri değiştirin.' : can(PERMISSIONS.BANQUET_MANAGE) ? '"Yeni etkinlik" ile müşterinin talebini dosyaya alın; salon ve saati programa ekleyin.' : undefined}
      />
    </div>
  );
}
