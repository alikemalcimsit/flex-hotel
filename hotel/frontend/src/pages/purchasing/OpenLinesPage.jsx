import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_PURCHASE_NOTE_LENGTH, MAX_ROUND_LINES, PURCHASE_REQUEST_SOURCE_LABELS, STOCK_ITEM_GROUPS, STOCK_ITEM_GROUP_LABELS, createPurchaseRoundSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];

/**
 * Açık talep satırları (modül 45): henüz teklif turuna alınmamış satırlar malzeme başına toplanır
 * (miktar, en erken ihtiyaç, kaç talep). Yönetici malzemeleri seçer (sayfalar arası, en fazla
 * `MAX_ROUND_LINES`) ve teklif turu açar; tur, seçilen malzemelerin ihtiyaç aralığındaki bütün açık
 * satırlarını birleştirir. Ekranın gördüğü toplam bu arada değiştiyse tur açılmaz, liste yenilenir.
 */
export function OpenLinesPage() {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: hotel } = useHotelContext();
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [group, setGroup] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  /** @type {[Map<string, any>, Function]} */
  const [selected, setSelected] = useState(() => new Map());
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setPage(1), [search, group, from, to]);
  // Aralık değişince seçilen toplamlar başka satırları kapsar: seçim sıfırlanır.
  useEffect(() => setSelected(new Map()), [from, to]);

  const invalidRange = from && to && to < from;
  const filters = { search: search || undefined, group: group || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.openLines(filters), queryFn: () => api(withQuery('/purchasing/open-lines', filters)), placeholderData: keepPreviousData, enabled: !invalidRange });
  const rows = list.data?.items ?? [];

  const create = useMutation({
    mutationFn: (body) => apiPost('/purchasing/rounds', body),
    onSuccess: (round) => {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastSuccess(`${round.number} açıldı: ${round.lines.length} malzeme; tedarikçi tekliflerini girin`);
      navigate(`/satin-alma/teklif-turlari/${round.id}`);
    },
    onError: (error) => {
      if (error.code === 'LINES_CHANGED') {
        queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
        setSelected(new Map());
        setConfirming(false);
      }
      toastError(error.message);
    },
  });

  const selectable = (row) => row.unitMismatchLines === 0;
  const toggle = (row) => {
    if (!selected.has(row.stockItemId) && selected.size >= MAX_ROUND_LINES) return toastError(`Bir turda en fazla ${MAX_ROUND_LINES} malzeme`);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.stockItemId)) next.delete(row.stockItemId);
      else next.set(row.stockItemId, row);
      return next;
    });
  };
  const pageRows = rows.filter(selectable);
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selected.has(row.stockItemId));
  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of pageRows) {
        if (allOnPage) next.delete(row.stockItemId);
        else if (next.size < MAX_ROUND_LINES) next.set(row.stockItemId, row);
      }
      return next;
    });

  const columns = [
    ...(canManage
      ? [
          {
            key: 'pick',
            header: 'Seç',
            render: (row) => (
              <input type="checkbox" className="size-4 accent-ink" aria-label={`${row.name} seç`} checked={selected.has(row.stockItemId)} onChange={() => toggle(row)} disabled={!selectable(row) || create.isPending} />
            ),
          },
        ]
      : []),
    {
      key: 'name',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, STOCK_ITEM_GROUP_LABELS[row.group]].filter(Boolean).join(' · ')}</span>
          {row.unitMismatchLines > 0 && <span className="block text-xs font-semibold text-sec-strong">{row.unitMismatchLines} satır eski birimde: talebi iptal edip yeniden açın</span>}
        </span>
      ),
    },
    { key: 'quantity', header: 'Toplam', className: 'text-right tabular-nums font-semibold', render: (row) => quantityText(row.quantity, row.unit) },
    { key: 'onHand', header: 'Eldeki', className: 'text-right tabular-nums', render: (row) => quantityText(row.onHand, row.unit) },
    { key: 'neededBy', header: 'En erken ihtiyaç', render: (row) => dayText(row.neededBy) },
    {
      key: 'requests',
      header: 'Talep',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums">{row.requests}</span>
          {row.sources.map((source) => (
            <Badge key={source} tone="neutral">
              {PURCHASE_REQUEST_SOURCE_LABELS[source]}
            </Badge>
          ))}
        </span>
      ),
    },
    { key: 'total', header: 'Tahmini', className: 'text-right tabular-nums', render: (row) => formatMoney(row.estimatedTotal, hotel?.currency) },
  ];
  const filtered = search || group || from || to;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={togglePage} disabled={pageRows.length === 0}>
                {allOnPage ? 'Sayfadakileri bırak' : 'Sayfadakileri seç'}
              </Button>
              <Button type="button" icon="layers" onClick={() => setConfirming(true)} disabled={selected.size === 0}>
                {selected.size ? `${selected.size} malzemeyle teklif turu aç` : 'Teklif turu aç'}
              </Button>
            </div>
          )
        }
      >
        <Input label="Ara" name="open-search" placeholder="Malzeme adı ya da kodu" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Select label="Grup" name="open-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-48" />
        <Input label="İhtiyaç (ilk)" name="open-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-40" />
        <Input label="İhtiyaç (son)" name="open-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={rows}
        meta={list.data?.meta}
        isLoading={list.isPending && !invalidRange}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen açık satır yok' : 'Teklif bekleyen açık talep yok'}
        emptyHint={filtered ? undefined : 'Talep açıldıkça satırları burada malzeme başına toplanır; seçip teklif turu açın.'}
      />
      {confirming && <ConfirmRoundDialog items={[...selected.values()]} range={{ from, to }} busy={create.isPending} onConfirm={(note) => create.mutate(note)} onClose={() => setConfirming(false)} />}
    </div>
  );
}

/** @param {{ items: any[], range: { from: string, to: string }, busy: boolean, onConfirm: (body: any) => void, onClose: () => void }} props */
function ConfirmRoundDialog({ items, range, busy, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const body = {
    from: range.from || null,
    to: range.to || null,
    items: items.map((row) => ({ stockItemId: row.stockItemId, expectedQuantity: row.quantity })),
    note: note.trim() || null,
  };
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createPurchaseRoundSchema, body);
    if (!checked.ok) return setError(Object.values(checked.errors)[0] ?? 'Seçim geçersiz');
    setError(null);
    onConfirm(body);
  }
  return (
    <Modal
      open
      size="md"
      title="Teklif turu aç"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="round-create-form" icon="layers" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Turu aç'}
          </Button>
        </>
      }
    >
      <form id="round-create-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          {items.length} malzemenin {range.from || range.to ? `${range.from ? dayText(range.from) : '…'} – ${range.to ? dayText(range.to) : '…'} ihtiyaçlı` : 'bütün'} açık talep satırları tek turda birleşir. Sonra tedarikçi tekliflerini girip satır bazında kazananı seçersiniz.
        </p>
        <ul className="max-h-48 overflow-y-auto rounded-item border border-line p-2 text-sm">
          {items.map((row) => (
            <li key={row.stockItemId} className="flex justify-between gap-2 py-0.5">
              <span>{row.name}</span>
              <span className="tabular-nums text-ink-soft">{quantityText(row.quantity, row.unit)}</span>
            </li>
          ))}
        </ul>
        {error && <Alert tone="danger">{error}</Alert>}
        <Textarea label="Not (isteğe bağlı)" name="round-note" rows={2} maxLength={MAX_PURCHASE_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
      </form>
    </Modal>
  );
}
