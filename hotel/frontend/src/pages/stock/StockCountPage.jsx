import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, STOCK_COUNT_STATUS_LABELS, cancelStockCountSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { recipeKeys, stockKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { quantityStep } from '../../lib/purchasingFormat.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { STOCK_COUNT_STATUS_TONES } from './StockCountsPage.jsx';

/**
 * Sayım ekranı (modül 44): satır başına beklenen (açılıştaki mevcut), şu anki mevcut, sayılan ve fark (+ değer).
 * Sayılan miktarlar yazılıp "Kaydet"le gönderilir (sayım ekranının gördüğü sürümle — iki sayımcı aynı anda yazarsa
 * ikincisi güncel listeyi görür); listede olmayan malzeme aranıp eklenir. Onay: sayılan satırların farkı stoğa işler
 * (`COUNT_ADJUST`), sayılmayan satıra dokunulmaz. İptal hiçbir şeyi değiştirmez.
 */
export function StockCountPage() {
  const { countId } = useParams();
  const can = useCan();
  const canManage = can(PERMISSIONS.STOCK_MANAGE);
  const { data: hotel } = useHotelContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: stockKeys.count(countId), queryFn: () => api(`/stock/counts/${countId}`) });
  const count = query.data;
  /** Düzenlenen sayılan miktarlar: malzeme → metin (sunucudaki değerden farklıysa kirli). */
  const [edits, setEdits] = useState({});
  const [added, setAdded] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    setEdits({});
    setAdded([]);
  }, [count?.updatedAt]);

  const isOpen = count?.status === 'OPEN';
  const rows = useMemo(() => {
    if (!count) return [];
    const extra = added.filter((item) => !count.lines.some((line) => line.stockItemId === item.id)).map((item) => ({ id: `new-${item.id}`, stockItemId: item.id, name: item.name, unit: item.unit, expectedQuantity: null, currentQuantity: null, countedQuantity: null, differenceQuantity: null, differenceValue: null, unitCost: item.unitCost, isNew: true }));
    return [...count.lines, ...extra];
  }, [count, added]);
  const dirty = Object.entries(edits).filter(([stockItemId, value]) => {
    const line = rows.find((row) => row.stockItemId === stockItemId);
    return line && (line.isNew || String(value ?? '') !== String(line.countedQuantity ?? ''));
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: stockKeys.all });
  };
  const onFailure = (failure) => {
    setActionError(failure);
    if (failure.code === 'STALE_WRITE' || failure.code === 'COUNT_NOT_OPEN') refresh();
    toastError(failure.message);
  };
  const saveLines = useMutation({
    mutationFn: () => apiPut(`/stock/counts/${countId}/lines`, { expectedUpdatedAt: count.updatedAt, lines: dirty.map(([stockItemId, value]) => ({ stockItemId, countedQuantity: String(value ?? '').trim().replace(',', '.') || null })) }),
    onSuccess: (next) => {
      queryClient.setQueryData(stockKeys.count(countId), next);
      refresh();
      toastSuccess(`${dirty.length} satır kaydedildi`);
    },
    onError: onFailure,
  });
  const approve = useMutation({
    mutationFn: () => apiPost(`/stock/counts/${countId}/approve`, { expectedUpdatedAt: count.updatedAt }),
    onSuccess: (next) => {
      queryClient.setQueryData(stockKeys.count(countId), next);
      refresh();
      setConfirm(null);
      toastSuccess(`${next.number} onaylandı: ${next.adjustedLines} düzeltme (${formatMoney(next.adjustedValue, hotel?.currency)})`);
    },
    onError: onFailure,
  });
  const cancel = useMutation({
    mutationFn: (reason) => apiPost(`/stock/counts/${countId}/cancel`, { expectedUpdatedAt: count.updatedAt, reason }),
    onSuccess: (next) => {
      queryClient.setQueryData(stockKeys.count(countId), next);
      refresh();
      setConfirm(null);
      toastSuccess(`${next.number} iptal edildi`);
    },
    onError: onFailure,
  });

  if (!count) return <QueryFallback query={query} errorTitle="Sayım okunamadı" />;
  const counted = rows.filter((row) => (edits[row.stockItemId] ?? row.countedQuantity ?? '') !== '').length;
  const differing = count.lines.filter((line) => line.differenceQuantity !== null && Number(line.differenceQuantity) !== 0).length;
  const valueOf = (line) => (line.differenceValue === null ? null : Number(line.differenceValue));
  const totalDifference = count.lines.reduce((sum, line) => sum + (valueOf(line) ?? 0), 0);
  const busy = saveLines.isPending || approve.isPending || cancel.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/stok/sayim" className="text-xs font-semibold text-ink-muted hover:underline">
            ← Sayımlar
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
            <span className="font-mono">{count.number}</span>
            <Badge tone={STOCK_COUNT_STATUS_TONES[count.status]}>{STOCK_COUNT_STATUS_LABELS[count.status]}</Badge>
          </h2>
          <p className="text-sm text-ink-soft">
            {count.warehouse.name} · açılış {formatDateTime(count.openedAt)} ({count.openedBy})
            {count.approvedAt && ` · onay ${formatDateTime(count.approvedAt)} (${count.approvedBy})`}
            {count.cancelledAt && ` · iptal ${formatDateTime(count.cancelledAt)}: ${count.cancelReason}`}
            {count.note && ` · ${count.note}`}
          </p>
        </div>
        {isOpen && canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" icon="close" onClick={() => setConfirm('cancel')} disabled={busy}>
              İptal et
            </Button>
            <Button type="button" variant="outline" icon="check" onClick={() => saveLines.mutate()} disabled={busy || dirty.length === 0}>
              {saveLines.isPending ? 'Kaydediliyor…' : `Kaydet${dirty.length ? ` (${dirty.length})` : ''}`}
            </Button>
            <Button type="button" icon="checkCheck" onClick={() => setConfirm('approve')} disabled={busy || dirty.length > 0 || counted === 0}>
              Onayla
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Satır" value={rows.length} hint="açılışta dondurulan + eklenen" icon="list" />
        <SummaryTile label="Sayılan" value={counted} hint={`${rows.length - counted} sayılmadı`} icon="clipboard" tone={counted === rows.length ? 'success' : 'neutral'} />
        <SummaryTile label="Farklı satır" value={differing} hint="sayılan ≠ mevcut" icon="alertTriangle" tone={differing ? 'warning' : 'neutral'} />
        <SummaryTile label={count.status === 'APPROVED' ? 'İşlenen fark' : 'Fark (önizleme)'} value={formatMoney(count.status === 'APPROVED' ? count.adjustedValue : totalDifference.toFixed(2), hotel?.currency)} hint="sayılan − mevcut × ort. maliyet" icon="wallet" tone={(count.status === 'APPROVED' ? Number(count.adjustedValue) : totalDifference) < 0 ? 'danger' : 'neutral'} />
      </div>
      {isOpen && dirty.length > 0 && <Alert tone="info">Girilen miktarlar henüz kaydedilmedi. Onaylamadan önce "Kaydet"e basın.</Alert>}
      {actionError?.code === 'STALE_WRITE' && <Alert tone="warning" title="Sayım bu arada değişti">Başka bir sayımcı yazdı; liste yenilendi. Girdiklerinizi kontrol edip tekrar kaydedin.</Alert>}
      {isOpen && canManage && (
        <Card title="Listede olmayan malzeme" description="Depoda beklenmeyen bir malzeme bulduysanız ekleyin; beklenen = şu anki depo mevcudu (çoğunlukla 0).">
          <div className="max-w-md">
            <SearchPicker
              label="Malzeme ara"
              placeholder="Malzeme adı ya da kodu"
              queryOf={(search) => ({ queryKey: recipeKeys.stock({ search, picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', { search: search || undefined, page: 1, pageSize: 30 })) })}
              itemsOf={(data) => data?.items ?? []}
              renderItem={(entry) => <span className="font-semibold">{entry.name}</span>}
              isDisabled={(entry) => (rows.some((row) => row.stockItemId === entry.id) ? 'Listede' : null)}
              onPick={(entry) => setAdded((current) => [...current, entry])}
              emptyText="Malzeme bulunamadı"
              disabled={busy}
            />
          </div>
        </Card>
      )}
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="px-4 py-3">Malzeme</th>
                <th className="px-4 py-3 text-right">Beklenen</th>
                {isOpen && <th className="px-4 py-3 text-right">Şu anki</th>}
                <th className="px-4 py-3 text-right">Sayılan</th>
                <th className="px-4 py-3 text-right">Fark</th>
                <th className="px-4 py-3 text-right">Fark değeri</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-muted">
                    Depoda stoklu malzeme yok; bulduğunuz malzemeyi yukarıdan ekleyin.
                  </td>
                </tr>
              )}
              {rows.map((line) => {
                const value = edits[line.stockItemId] ?? line.countedQuantity ?? '';
                const current = Number(line.currentQuantity ?? 0);
                const previewDiff = isOpen && value !== '' && !Number.isNaN(Number(String(value).replace(',', '.'))) ? Number(String(value).replace(',', '.')) - current : null;
                const diff = isOpen ? previewDiff : line.differenceQuantity === null ? null : Number(line.differenceQuantity);
                const diffValue = diff === null ? null : diff * Number(line.unitCost);
                const tone = diff === null || diff === 0 ? 'text-ink-muted' : diff < 0 ? 'text-sec-strong' : 'text-success-ink';
                return (
                  <tr key={line.id} className={line.isNew ? 'bg-surface-muted/50' : ''}>
                    <td className="px-4 py-2">
                      <span className="block font-semibold text-ink">{line.name}</span>
                      <span className="block text-xs text-ink-muted">{[line.code, line.isNew ? 'yeni eklendi' : null].filter(Boolean).join(' · ') || KITCHEN_UNIT_LABELS[line.unit]}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{line.expectedQuantity === null ? '—' : quantityText(line.expectedQuantity, line.unit)}</td>
                    {isOpen && <td className="px-4 py-2 text-right tabular-nums">{quantityText(line.currentQuantity ?? '0', line.unit)}</td>}
                    <td className="px-4 py-2 text-right tabular-nums">
                      {isOpen && canManage ? (
                        <Input
                          label=""
                          name={`counted-${line.stockItemId}`}
                          inputMode="decimal"
                          step={quantityStep(line.unit)}
                          placeholder="sayılmadı"
                          value={value}
                          onChange={(event) => setEdits((currentEdits) => ({ ...currentEdits, [line.stockItemId]: event.target.value }))}
                          className="ml-auto w-32 text-right"
                          disabled={busy}
                        />
                      ) : line.countedQuantity === null ? (
                        <span className="text-ink-muted">sayılmadı</span>
                      ) : (
                        quantityText(line.countedQuantity, line.unit)
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${tone}`}>{diff === null ? '—' : `${diff > 0 ? '+' : ''}${quantityText(diff.toFixed(3), line.unit)}`}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${tone}`}>{diffValue === null ? '—' : formatMoney(diffValue.toFixed(2), hotel?.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDialog
        open={confirm === 'approve'}
        title={`${count.number} onaylansın mı?`}
        message={`${counted} satır sayıldı. Sayılan ile şu anki mevcut arasındaki fark ${count.warehouse.name} deposuna sayım farkı hareketi olarak işlenir; sayılmayan satırlara dokunulmaz. Geri alınamaz.`}
        confirmLabel="Onayla"
        confirmVariant="primary"
        confirmIcon="checkCheck"
        onConfirm={() => approve.mutate()}
        onClose={() => setConfirm(null)}
        isPending={approve.isPending}
        error={approve.isError ? approve.error : null}
      />
      {confirm === 'cancel' && <CancelCountDialog onClose={() => setConfirm(null)} onConfirm={(reason) => cancel.mutate(reason)} isPending={cancel.isPending} />}
    </div>
  );
}

/** @param {{ onClose: () => void, onConfirm: (reason: string) => void, isPending: boolean }} props */
function CancelCountDialog({ onClose, onConfirm, isPending }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  function submit(event) {
    event.preventDefault();
    const checked = cancelStockCountSchema.shape.reason.safeParse(reason);
    if (!checked.success) return setError(checked.error.issues[0]?.message ?? 'Sebep yazın');
    setError(null);
    onConfirm(checked.data);
  }
  return (
    <Modal
      open
      size="sm"
      title="Sayımı iptal et"
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="cancel-count-form" variant="danger" icon="close" disabled={isPending}>
            {isPending ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      <form id="cancel-count-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">İptal edilen sayım stoğa hiçbir şey işlemez; girilen miktarlar kayıtta kalır.</p>
        <Textarea label="Sebep" name="cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={error ?? undefined} required disabled={isPending} />
      </form>
    </Modal>
  );
}
