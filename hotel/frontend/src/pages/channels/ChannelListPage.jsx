import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CHANNEL_STATUSES, CHANNEL_STATUS_LABELS, CHANNEL_TYPE_LABELS, ICAL_PROVIDER_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, withQuery } from '../../lib/api.js';
import { syncSummary } from '../../lib/channelForm.js';
import { CHANNEL_STATUS_TONES, channelKeys, useChannelLive, useChannelTime } from '../../lib/channelManager.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { NewChannelDialog } from './NewChannelDialog.jsx';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;
const STATUS_OPTIONS = CHANNEL_STATUSES.map((value) => ({ value, label: CHANNEL_STATUS_LABELS[value] }));
const SUMMARY_TONE_CLASSES = Object.freeze({
  success: 'text-success-ink',
  warning: 'text-warning-ink',
  danger: 'text-danger-ink',
  info: 'text-info-ink',
  neutral: 'text-ink-muted',
});

/**
 * Kanal listesi (modül 33): kanalın türü, durumu, senkron durumu (son iş,
 * hata, bekleme), eşleşen oda tipi ve dikkat isteyen kanal rezervasyonları.
 * Canlı: gönderim / rezervasyon olunca satır tazelenir.
 */
export function ChannelListPage() {
  const can = useCan();
  const formatDateTime = useChannelTime();
  const [creating, setCreating] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { isLive } = useChannelLive();
  const filters = { search, status, page };
  const list = useQuery({
    queryKey: channelKeys.list(filters),
    queryFn: () => api(withQuery('/channel-manager', { search: search || undefined, status: status || undefined, page, pageSize: PAGE_SIZE })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const columns = [
    {
      key: 'name',
      header: 'Kanal',
      render: (row) => (
        <Link to={`/kanallar/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.type === 'CHANNEX' ? `${CHANNEL_TYPE_LABELS.CHANNEX}${row.externalName ? ` · ${row.externalName}` : ''}` : `iCal · ${ICAL_PROVIDER_LABELS[row.provider] ?? ''}`}
          </span>
        </Link>
      ),
    },
    {
      key: 'sync',
      header: 'Senkron',
      render: (row) => {
        const summary = syncSummary(row, formatDateTime);
        return <span className={`block max-w-md text-xs font-semibold ${SUMMARY_TONE_CLASSES[summary.tone]}`}>{summary.text}</span>;
      },
    },
    { key: 'mapped', header: 'Eşleşen tip', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => row.mappedRoomTypes },
    {
      key: 'bookings',
      header: 'Dikkat',
      className: 'whitespace-nowrap',
      render: (row) =>
        row.bookings.attention + row.bookings.review === 0 ? (
          <span className="text-xs text-ink-muted">—</span>
        ) : (
          <Link to={`/kanallar/${row.id}/rezervasyonlar`} className="flex flex-wrap gap-1">
            {row.bookings.attention > 0 && <Badge tone="danger">{row.bookings.attention} elle işlenmeli</Badge>}
            {row.bookings.review > 0 && <Badge tone="warning">{row.bookings.review} doğrulanmalı</Badge>}
          </Link>
        ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={CHANNEL_STATUS_TONES[row.status]}>{CHANNEL_STATUS_LABELS[row.status]}</Badge> },
  ];

  const filtered = Boolean(search || status);
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kanallar"
        description="OTA'lar (Channex üzerinden) ve iCal takvimleri. Müsaitlik, fiyat ve stop-sale değiştikçe kanala gider; kanaldan gelen rezervasyonlar sisteme düşer."
        actions={canManage && <Button icon="plus" onClick={() => setCreating(true)}>Yeni kanal</Button>}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ChoiceChips label="Durum" options={STATUS_OPTIONS} value={status} onChange={(value) => { setStatus(value); setPage(1); }} />
          <Badge tone={isLive ? 'success' : 'warning'} className="ml-auto">{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </div>
        <Input label="Ara" name="channel-search" placeholder="Kanal adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="sm:max-w-md" />
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
        emptyTitle={filtered ? 'Süzgece uyan kanal yok' : 'Henüz kanal yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeci değiştirin.' : canManage ? '"Yeni kanal" ile Channex hesabınızı ya da bir Airbnb / Booking.com takvimini bağlayın.' : undefined}
      />
      {creating && <NewChannelDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
