import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BOARD_TYPE_LABELS,
  CHANNEL_SYNC_KINDS,
  CHANNEL_SYNC_KIND_LABELS,
  CHANNEL_SYNC_STATUSES,
  CHANNEL_SYNC_STATUS_LABELS,
  CHANNEL_SYNC_TRIGGER_LABELS,
  channelLogQuerySchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, withQuery } from '../../lib/api.js';
import { SYNC_STATUS_TONES, channelKeys, useChannelTime } from '../../lib/channelManager.js';
import { formatDate } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useChannelOutlet } from './ChannelPage.jsx';

const PAGE_SIZE = 30;
const KIND_OPTIONS = [{ value: '', label: 'Bütün işler' }, ...CHANNEL_SYNC_KINDS.map((value) => ({ value, label: CHANNEL_SYNC_KIND_LABELS[value] }))];
const STATUS_OPTIONS = [{ value: '', label: 'Bütün sonuçlar' }, ...CHANNEL_SYNC_STATUSES.map((value) => ({ value, label: CHANNEL_SYNC_STATUS_LABELS[value] }))];

/** @param {number} ms */
const durationText = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn`);

/**
 * Senkron logu (modül 33): kanala ne gönderildi / kanaldan ne alındı, sonuç,
 * süre ve hata; satıra basınca ayrıntı (gönderilen aralıklar, kanalın
 * reddettiği satırlar, Channex görev kimlikleri). 90 gün saklanır.
 */
export function ChannelLogTab() {
  const { channel } = useChannelOutlet();
  const formatDateTime = useChannelTime();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const periodCheck = validateWith(channelLogQuerySchema, { from: period.from || undefined, to: period.to || undefined });
  const periodError = periodCheck.ok ? null : periodCheck.errors.to ?? periodCheck.errors.from;
  const filters = { kind, status, from: period.from, to: period.to, page };
  const list = useQuery({
    queryKey: channelKeys.logs(channel.id, filters),
    queryFn: () =>
      api(withQuery(`/channel-manager/${channel.id}/logs`, { kind: kind || undefined, status: status || undefined, from: period.from || undefined, to: period.to || undefined, page, pageSize: PAGE_SIZE })),
    enabled: !periodError,
    placeholderData: keepPreviousData,
  });

  const columns = [
    { key: 'createdAt', header: 'Zaman', className: 'whitespace-nowrap text-xs', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'kind',
      header: 'İş',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{CHANNEL_SYNC_KIND_LABELS[row.kind]}</span>
          <span className="block text-ink-muted">{CHANNEL_SYNC_TRIGGER_LABELS[row.trigger]}</span>
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'Ne oldu',
      render: (row) => (
        <button type="button" onClick={() => setOpenId(row.id)} className="block text-left text-sm text-ink hover:underline">
          {row.summary}
          {row.windowFrom && <span className="block text-xs text-ink-muted">{formatDate(row.windowFrom)} – {formatDate(row.windowTo)}</span>}
        </button>
      ),
    },
    { key: 'duration', header: 'Süre', className: 'whitespace-nowrap text-right text-xs tabular-nums text-ink-muted', render: (row) => durationText(row.durationMs) },
    { key: 'status', header: 'Sonuç', render: (row) => <Badge tone={SYNC_STATUS_TONES[row.status]}>{CHANNEL_SYNC_STATUS_LABELS[row.status]}</Badge> },
  ];

  const filtered = Boolean(kind || status || period.from || period.to);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-[14rem_12rem_10rem_10rem]">
        <Select label="İş" name="log-kind" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }} options={KIND_OPTIONS} />
        <Select label="Sonuç" name="log-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={STATUS_OPTIONS} />
        <Input label="Başlangıç" name="log-from" type="date" value={period.from} onChange={(event) => { setPeriod((current) => ({ ...current, from: event.target.value })); setPage(1); }} />
        <Input label="Bitiş" name="log-to" type="date" value={period.to} onChange={(event) => { setPeriod((current) => ({ ...current, to: event.target.value })); setPage(1); }} error={periodError ?? undefined} />
      </div>
      <DataTable
        columns={columns}
        rows={periodError ? [] : list.data?.items}
        meta={periodError ? undefined : list.data?.meta}
        isLoading={!periodError && list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan kayıt yok' : 'Henüz senkron kaydı yok'}
        emptyHint={filtered ? undefined : channel.status === 'ACTIVE' ? 'İlk iş birkaç saniye içinde yazılır.' : 'Kanal senkrona alınınca kayıtlar burada görünür.'}
      />
      {openId && <LogDetailDialog channelId={channel.id} logId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/**
 * Log ayrıntısı: gönderilen aralıklardan örnek, kanalın uyarıları, hata,
 * rezervasyon sayıları ve takvim sonuçları.
 * @param {{ channelId: string, logId: string, onClose: () => void }} props
 */
function LogDetailDialog({ channelId, logId, onClose }) {
  const formatDateTime = useChannelTime();
  const query = useQuery({ queryKey: channelKeys.log(channelId, logId), queryFn: () => api(`/channel-manager/${channelId}/logs/${logId}`) });
  const log = query.data;
  const details = log?.details ?? {};
  // Channex uyarıları nesne (reddedilen satır), takvim uyarıları metin.
  const warnings = Array.isArray(details.warnings) ? details.warnings : [];
  const channelWarnings = warnings.filter((item) => typeof item !== 'string');
  const textWarnings = warnings.filter((item) => typeof item === 'string');
  return (
    <Modal open title="Senkron kaydı" onClose={onClose} size="lg" footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
      {query.isPending && <Spinner className="py-6" />}
      {query.isError && <Alert tone="danger" title="Kayıt yüklenemedi">{query.error.message}</Alert>}
      {log && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SYNC_STATUS_TONES[log.status]}>{CHANNEL_SYNC_STATUS_LABELS[log.status]}</Badge>
            <span className="font-semibold text-ink">{CHANNEL_SYNC_KIND_LABELS[log.kind]}</span>
            <span className="text-ink-muted">{formatDateTime(log.createdAt)} · {CHANNEL_SYNC_TRIGGER_LABELS[log.trigger]} · {durationText(log.durationMs)}</span>
          </div>
          <p className="text-ink">{log.summary}</p>
          {details.reason && <p className="text-xs text-ink-muted">Sebep: {details.reason}</p>}
          {log.error && <Alert tone="danger" title="Hata">{log.error}{details.error?.retryInSeconds ? ` — ${details.error.retryInSeconds} sn sonra yeniden denendi` : ''}</Alert>}
          {details.availability?.length > 0 && (
            <DetailTable
              title="Müsaitlik"
              rows={details.availability}
              describe={(row) => `${row.roomType} → ${row.external}: ${row.days} gün, ${row.ranges} aralık`}
              sample={(item) => `${formatDate(item.from)} – ${formatDate(item.to)}: ${item.availability} oda`}
            />
          )}
          {details.restrictions?.length > 0 && (
            <DetailTable
              title="Fiyat ve stop-sale"
              rows={details.restrictions}
              describe={(row) => `${row.roomType} · ${BOARD_TYPE_LABELS[row.boardType] ?? row.boardType} → ${row.external}: ${row.days} gün`}
              sample={(item) => `${formatDate(item.from)} – ${formatDate(item.to)}: ${item.rate}${item.stopSell ? ' · satışa kapalı' : ''}`}
            />
          )}
          {channelWarnings.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-bold uppercase tracking-wide text-warning-ink">Kanalın reddettiği satırlar</h3>
              <pre className="max-h-48 overflow-auto rounded-item bg-surface-muted p-2 text-xs">{JSON.stringify(channelWarnings, null, 2)}</pre>
            </section>
          )}
          {details.counts && (
            <p className="text-xs text-ink-soft">
              Yeni {details.counts.NEW} · değişiklik {details.counts.MODIFIED} · iptal {details.counts.CANCELLED}
              {details.duplicates ? ` · daha önce alınmış ${details.duplicates}` : ''}
            </p>
          )}
          {details.invalid?.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-bold uppercase tracking-wide text-danger-ink">Okunamayan revizyonlar</h3>
              <ul className="list-disc pl-5 text-xs">
                {details.invalid.map((item, index) => (
                  <li key={index}>{[item.otaCode, item.bookingId].filter(Boolean).join(' · ') || 'kimliksiz'}: {item.error}</li>
                ))}
              </ul>
            </section>
          )}
          {details.calendars?.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {details.calendars.map((row) => (
                <li key={row.roomType}>
                  <span className="font-semibold text-ink">{row.roomType}:</span> {row.new} yeni, {row.modified} değişiklik, {row.cancelled} iptal, {row.closed} kanal kapatması
                  {row.invalid ? `, ${row.invalid} bozuk kayıt` : ''}
                  {row.error && <span className="block text-danger-ink">{row.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {textWarnings.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-warning-ink">
              {textWarnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {log.externalIds.length > 0 && <p className="break-all text-xs text-ink-muted">Kanal iş kimlikleri: {log.externalIds.join(', ')}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * @param {{ title: string, rows: any[], describe: (row: any) => string, sample: (item: any) => string }} props
 */
function DetailTable({ title, rows, describe, sample }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={index} className="rounded-item border border-line p-2">
            <span className="block text-xs font-semibold text-ink">{describe(row)}</span>
            <span className="block text-xs text-ink-soft">
              {row.sample.map(sample).join(' · ')}
              {row.ranges > row.sample.length ? ` · +${row.ranges - row.sample.length} aralık daha` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
