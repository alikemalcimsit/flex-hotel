import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PRICE_SUGGESTION_SOURCE_LABELS,
  PRICE_SUGGESTION_STATUSES,
  PRICE_SUGGESTION_STATUS_LABELS,
  updatePriceSuggestionSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, apiPut } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ApprovalDetailDialog } from '../approvals/ApprovalDetailDialog.jsx';
import { PriceHistoryCard } from './PriceHistoryCard.jsx';

const STATUS_OPTIONS = [
  ...PRICE_SUGGESTION_STATUSES.map((value) => ({ value, label: PRICE_SUGGESTION_STATUS_LABELS[value] })),
  { value: 'ALL', label: 'Tümü' },
];

const STATUS_TONES = Object.freeze({ PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral', EXPIRED: 'neutral' });

const suggestionKeys = Object.freeze({
  all: ['pricing', 'suggestions'],
  list: (filters) => ['pricing', 'suggestions', filters],
});

/** "1.100" → "+%10", "0.850" → "−%15" */
export function multiplierPctLabel(multiplier) {
  const pct = Math.round((Number(multiplier) - 1) * 100);
  return pct >= 0 ? `+%${pct}` : `−%${Math.abs(pct)}`;
}

/**
 * Fiyat önerileri (modül 34): yield kuralının ve fiyat ajanının onay bekleyen
 * önerileri. Karar M11 onayıdır (aynı pencere); bekleyen önerinin çarpanı
 * karar verilmeden düzenlenebilir. Hiçbir fiyat onaysız değişmez.
 */
export function PriceSuggestionsPage() {
  const can = useCan();
  const canDecide = can(PERMISSIONS.APPROVALS_DECIDE);
  const { timeZone } = useHotelToday();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('PENDING');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  /** Onay penceresi: { approvalId, mode } */
  const [deciding, setDeciding] = useState(null);

  const roomTypes = useQuery({ queryKey: ['settings', 'room-types', 'all'], queryFn: () => api('/settings/room-types?pageSize=200') });
  const filters = { status: status === 'ALL' ? undefined : status, roomTypeId: roomTypeId || undefined, page };
  const listQuery = useQuery({
    queryKey: suggestionKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.roomTypeId) params.set('roomTypeId', filters.roomTypeId);
      params.set('page', String(page));
      return api(`/pricing/suggestions?${params}`);
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: suggestionKeys.all });

  const columns = [
    { key: 'roomTypeName', header: 'Oda tipi', className: 'font-semibold' },
    { key: 'period', header: 'Dönem', render: (row) => `${formatDate(row.startDate)} – ${formatDate(row.endDate)}` },
    {
      key: 'price',
      header: 'Mevcut → Önerilen',
      className: 'tabular-nums',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {formatMoney(row.currentPrice)} → <strong>{formatMoney(row.suggestedPrice)}</strong>
          <Badge tone={Number(row.multiplier) >= 1 ? 'warning' : 'info'} dot={false} className="tabular-nums">
            {multiplierPctLabel(row.multiplier)}
          </Badge>
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Kaynak',
      render: (row) => (
        <Badge tone={row.source === 'AGENT' ? 'info' : 'neutral'} dot={false}>
          {PRICE_SUGGESTION_SOURCE_LABELS[row.source] ?? row.source}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} dot={false}>
          {PRICE_SUGGESTION_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fiyat önerileri"
        description="Yield kuralının ve fiyat ajanının önerileri. Hiçbir fiyat kendiliğinden değişmez: onaylanan öneri geceye işlenir ve kanallara gider."
      />

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Select
            label="Durum"
            name="status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            className="w-44"
          />
          <Select
            label="Oda tipi"
            name="roomTypeId"
            value={roomTypeId}
            onChange={(event) => {
              setRoomTypeId(event.target.value);
              setPage(1);
            }}
            options={[{ value: '', label: 'Tümü' }, ...(roomTypes.data?.items ?? []).map((type) => ({ value: type.id, label: type.name }))]}
            className="w-56"
          />
        </div>

        <DataTable
          columns={columns}
          rows={listQuery.data?.items ?? []}
          meta={listQuery.data?.meta}
          isLoading={listQuery.isPending}
          isFetching={listQuery.isFetching}
          error={listQuery.error}
          onRetry={listQuery.refetch}
          onPageChange={setPage}
          emptyTitle={status === 'PENDING' ? 'Bekleyen öneri yok' : 'Öneri yok'}
          emptyHint="Öneriler günlük değerlendirmede üretilir; eşikler Ayarlar → Dinamik fiyat sekmesinde."
          rowActions={(row) => (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" icon="eye" onClick={() => setDetail(row)}>
                Detay
              </Button>
              {row.status === 'PENDING' && canDecide && (
                <>
                  <Button size="sm" icon="check" onClick={() => setDeciding({ approvalId: row.approvalId, mode: 'grant' })}>
                    Onayla
                  </Button>
                  <Button variant="dangerSoft" size="sm" icon="close" onClick={() => setDeciding({ approvalId: row.approvalId, mode: 'deny' })}>
                    Reddet
                  </Button>
                </>
              )}
            </div>
          )}
        />
      </Card>

      <PriceHistoryCard roomTypes={roomTypes.data?.items ?? []} />

      {detail && (
        <SuggestionDetailModal
          key={detail.id}
          suggestion={detail}
          canDecide={canDecide}
          onDecide={(mode) => {
            setDetail(null);
            setDeciding({ approvalId: detail.approvalId, mode });
          }}
          onSaved={(updated) => {
            setDetail(updated);
            refresh();
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {deciding && (
        <ApprovalDetailDialog
          key={deciding.approvalId}
          approvalId={deciding.approvalId}
          canDecide={canDecide}
          timeZone={timeZone}
          initialMode={deciding.mode}
          onClose={() => {
            setDeciding(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Öneri dökümü: gerekçe + yapılandırılmış girdiler (gün gün doluluk) +
 * bekleyen öneride çarpan düzenleme.
 */
function SuggestionDetailModal({ suggestion, canDecide, onDecide, onSaved, onClose }) {
  const [multiplier, setMultiplier] = useState(suggestion.multiplier);
  const [error, setError] = useState('');
  const editable = suggestion.status === 'PENDING' && canDecide;
  const days = suggestion.inputs?.days ?? [];

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut(`/pricing/suggestions/${suggestion.id}`, values),
    onSuccess: (updated) => {
      toastSuccess('Çarpan güncellendi; artık bu değerle onaylanır');
      onSaved(updated);
    },
    onError: (err) => toastError(err.message),
  });

  function saveMultiplier() {
    const result = validateWith(updatePriceSuggestionSchema, { multiplier, expectedUpdatedAt: suggestion.updatedAt });
    if (!result.ok) {
      setError(result.errors.multiplier ?? 'Çarpan geçersiz');
      return;
    }
    setError('');
    saveMutation.mutate(result.data);
  }

  return (
    <Modal
      open
      title={`${suggestion.roomTypeName} · ${formatDate(suggestion.startDate)} – ${formatDate(suggestion.endDate)}`}
      onClose={onClose}
      size="lg"
      footer={
        editable ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
            <Button variant="dangerSoft" icon="close" onClick={() => onDecide('deny')}>
              Reddet
            </Button>
            <Button icon="check" onClick={() => onDecide('grant')}>
              Onayla
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={suggestion.source === 'AGENT' ? 'info' : 'neutral'} dot={false}>
            {PRICE_SUGGESTION_SOURCE_LABELS[suggestion.source] ?? suggestion.source}
          </Badge>
          <Badge tone={STATUS_TONES[suggestion.status] ?? 'neutral'} dot={false}>
            {PRICE_SUGGESTION_STATUS_LABELS[suggestion.status] ?? suggestion.status}
          </Badge>
          {suggestion.decidedBy && (
            <span className="text-xs text-ink-muted">
              Karar: {suggestion.decidedBy} · {formatDate(suggestion.decidedAt)}
            </span>
          )}
        </div>

        <Alert tone="info" title="Gerekçe">
          {suggestion.reason}
        </Alert>

        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm">
            <p className="font-semibold text-ink">Fiyat</p>
            <p className="tabular-nums">
              {formatMoney(suggestion.currentPrice)} → <strong>{formatMoney(suggestion.suggestedPrice)}</strong>{' '}
              <span className="text-ink-muted">({multiplierPctLabel(suggestion.multiplier)})</span>
            </p>
          </div>
          {editable && (
            <div className="flex items-end gap-2">
              <Input
                label="Çarpan (0.5 – 3)"
                name="multiplier"
                value={multiplier}
                error={error}
                onChange={(event) => setMultiplier(event.target.value)}
                className="w-36"
              />
              <Button variant="outline" icon="pencil" disabled={saveMutation.isPending || multiplier === suggestion.multiplier} onClick={saveMultiplier}>
                {saveMutation.isPending ? 'Kaydediliyor…' : 'Çarpanı değiştir'}
              </Button>
            </div>
          )}
        </div>

        {days.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Değerlendirmenin girdileri</p>
            <div className="overflow-x-auto rounded-control border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Gün</th>
                    <th className="px-3 py-2">Doluluk</th>
                    <th className="px-3 py-2">Satılan / Satılabilir</th>
                    <th className="px-3 py-2">Kalan gün</th>
                    <th className="px-3 py-2">Geçen yıl</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.date} className="border-t border-line tabular-nums">
                      <td className="px-3 py-1.5">{formatDate(day.date)}</td>
                      <td className="px-3 py-1.5">%{Math.round(day.occupancyPct)}</td>
                      <td className="px-3 py-1.5">
                        {day.sold} / {day.sellable}
                      </td>
                      <td className="px-3 py-1.5">{day.daysOut}</td>
                      <td className="px-3 py-1.5">{day.lastYearOccupancyPct === null ? '—' : `%${day.lastYearOccupancyPct}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
