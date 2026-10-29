import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MIN_REQUEST_REASON_LENGTH, PURCHASE_ORDER_STATUS_LABELS, PURCHASE_REQUEST_SOURCE_LABELS, PURCHASE_ROUND_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, usePurchasingLive } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ORDER_STATUS_TONES, ROUND_LINE_STATE_LABELS, ROUND_STATUS_TONES } from '../../lib/purchasingFormat.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { QuoteDialog } from './QuoteDialog.jsx';
import { ReasonDialog } from './ReasonDialog.jsx';

const PRICE = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * Teklif karşılaştırma (modül 45): satırlar malzeme × miktar × ihtiyaç, sütunlar tedarikçi teklifi
 * (termin → beklenen teslim, geçerlilik, toplam). Hücrede KDV hariç birim fiyat ve satır tutarı;
 * en uygun (fiyat → termin → önce girilen) yeşil, ihtiyaçtan geç teslim uyarılı. Kazanan satır
 * bazında seçilir (varsayılan en uygun); en uygun dışı seçim gerekçe ister. Seçimler tedarikçi başına
 * siparişe döner, eşik üstü onaya gider.
 */
export function RoundPage() {
  const { roundId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  usePurchasingLive();
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);
  const query = useQuery({ queryKey: purchasingKeys.round(roundId), queryFn: () => api(`/purchasing/rounds/${roundId}`) });
  const settings = useQuery({ queryKey: purchasingKeys.settings, queryFn: () => api('/purchasing/settings') });
  const [quoting, setQuoting] = useState(null);
  const [closing, setClosing] = useState(false);
  /** @type {[Record<string, { quoteLineId: string, reason: string }>, Function]} */
  const [picks, setPicks] = useState({});
  const round = query.data;

  // Tur değişince (yeni teklif, seçim, red) seçim en uygunlara döner.
  useEffect(() => {
    if (!round) return;
    setPicks(Object.fromEntries(round.lines.filter((line) => line.state === 'PENDING' && line.bestQuoteLineId).map((line) => [line.id, { quoteLineId: line.bestQuoteLineId, reason: '' }])));
  }, [round?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (result) => {
    if (result) queryClient.setQueryData(purchasingKeys.round(roundId), result);
    queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
  };
  const onFail = (error) => {
    if (['STALE_WRITE', 'ROUND_STATUS'].includes(error.code)) {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.round(roundId) });
      return toastError('Tur bu arada değişti (yeni teklif ya da seçim); karşılaştırma yenilendi, tekrar bakın.');
    }
    toastError(error.message);
  };
  const award = useMutation({
    mutationFn: (body) => apiPost(`/purchasing/rounds/${roundId}/award`, body),
    onSuccess: (result) => {
      refresh(result.round);
      const pending = result.orders.filter((order) => order.status === 'PENDING_APPROVAL').length;
      toastSuccess(`${result.orders.length} sipariş açıldı: ${result.orders.map((order) => order.number).join(', ')}${pending ? ` · ${pending} onay bekliyor` : ''}`);
    },
    onError: onFail,
  });
  const close = useMutation({
    mutationFn: (reason) => apiPost(`/purchasing/rounds/${roundId}/cancel`, { expectedUpdatedAt: round.updatedAt, reason }),
    onSuccess: (result) => {
      refresh(result);
      setClosing(false);
      toastSuccess('Tur kapatıldı; siparişe dönmemiş satırlar talebe geri bırakıldı');
    },
    onError: onFail,
  });

  const cellIndex = useMemo(() => {
    /** @type {Map<string, { quote: any, cell: any }>} */
    const map = new Map();
    for (const quote of round?.quotes ?? []) for (const cell of quote.lines) map.set(cell.id, { quote, cell });
    return map;
  }, [round]);

  const back = (
    <Link to="/satin-alma/teklif-turlari" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Teklif turları
    </Link>
  );
  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <QueryFallback query={query} errorTitle="Teklif turu yüklenemedi" />
      </div>
    );
  }

  const open = round.status === 'OPEN';
  const editable = open && canManage;
  const currency = round.currency;
  const threshold = Number(settings.data?.orderApprovalAmount ?? 0);
  const pendingLines = round.lines.filter((line) => line.state === 'PENDING');

  // Seçim özeti: tedarikçi başına satır, toplam (KDV dahil), eşik.
  const groups = new Map();
  const missingReasons = [];
  for (const line of pendingLines) {
    const pick = picks[line.id];
    if (!pick) continue;
    const found = cellIndex.get(pick.quoteLineId);
    if (!found) continue;
    const group = groups.get(found.quote.supplierId) ?? { name: found.quote.supplierName, lines: 0, total: 0 };
    group.lines += 1;
    group.total += Number(found.cell.total);
    groups.set(found.quote.supplierId, group);
    if (pick.quoteLineId !== line.bestQuoteLineId && pick.reason.trim().length < MIN_REQUEST_REASON_LENGTH) missingReasons.push(line.name);
  }
  const pickedCount = [...groups.values()].reduce((sum, group) => sum + group.lines, 0);

  function submitAward() {
    if (missingReasons.length) return toastError(`En uygun dışı seçim için gerekçe yazın: ${missingReasons.slice(0, 3).join(', ')}`);
    const awards = pendingLines
      .filter((line) => picks[line.id] && cellIndex.has(picks[line.id].quoteLineId))
      .map((line) => ({ roundLineId: line.id, quoteLineId: picks[line.id].quoteLineId, reason: picks[line.id].quoteLineId === line.bestQuoteLineId ? null : picks[line.id].reason.trim() }));
    award.mutate({ expectedUpdatedAt: round.updatedAt, awards });
  }

  const choose = (lineId, quoteLineId) => setPicks((current) => ({ ...current, [lineId]: { quoteLineId, reason: current[lineId]?.quoteLineId === quoteLineId ? current[lineId].reason : '' } }));
  const unpick = (lineId) =>
    setPicks((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={round.number}
        description={`${round.createdBy} · ${formatDate(round.createdAt)} · en erken ihtiyaç ${dayText(round.neededBy)} · ${round.lines.length} malzeme · ${round.quotes.length} teklif`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ROUND_STATUS_TONES[round.status]}>{PURCHASE_ROUND_STATUS_LABELS[round.status]}</Badge>
            {editable && (
              <>
                <Button type="button" icon="plus" onClick={() => setQuoting('new')}>
                  Teklif ekle
                </Button>
                <Button type="button" variant="dangerSoft" icon="close" onClick={() => setClosing(true)}>
                  Turu kapat
                </Button>
              </>
            )}
          </div>
        }
      />
      {round.status === 'CANCELLED' && (
        <Alert tone="info" title="Tur kapatıldı">
          {round.cancelledBy} · {formatDate(round.cancelledAt)} · {round.cancelReason}
        </Alert>
      )}
      {round.status === 'AWARDED' && round.cancelReason && (
        <Alert tone="info" title="Tur kapatıldı; siparişe dönmeyen satırlar talebe bırakıldı">
          {round.cancelledBy} · {formatDate(round.cancelledAt)} · {round.cancelReason}
        </Alert>
      )}
      {round.note && <Alert tone="info">Not: {round.note}</Alert>}
      {open && round.quotes.length === 0 && (
        <Alert tone="warning" title="Henüz teklif yok">
          Tedarikçilerden fiyat alıp "Teklif ekle" ile girin; en az iki teklifle karşılaştırma anlamlı olur.
        </Alert>
      )}

      <Card title="Karşılaştırma" description="Fiyatlar KDV hariç, stok biriminde. Yeşil: satırın en uygun teklifi — ihtiyaca yetişenler arasında en düşük fiyat (eşitse kısa termin). Geç: beklenen teslim ihtiyaç gününden sonra; ucuz olsa da önerilmez, seçmek gerekçe ister.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: `${420 + round.quotes.length * 190}px` }}>
            <thead>
              <tr className="border-b border-line align-bottom text-left">
                <th className="py-2 pr-3 text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">Malzeme</th>
                {round.quotes.map((quote) => (
                  <th key={quote.id} className="min-w-[180px] py-2 pr-3 align-bottom font-normal">
                    <span className="flex items-start justify-between gap-1">
                      <span className="block font-semibold text-ink">{quote.supplierName}</span>
                      {editable && (
                        <button type="button" className="rounded-item p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" onClick={() => setQuoting(quote)} aria-label={`${quote.supplierName} teklifini düzenle`}>
                          <Icon name="pencil" className="size-3.5" />
                        </button>
                      )}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      Termin {quote.deliveryDays} gün → {dayText(quote.expectedOn)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {quote.validUntil ? `Geçerli: ${dayText(quote.validUntil)}` : 'Geçerlilik belirtilmedi'} · vade {quote.paymentTermDays} gün
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {quote.expired && <Badge tone="danger">süresi doldu</Badge>}
                      {!quote.supplierActive && <Badge tone="neutral">pasif</Badge>}
                      {quote.bestLines > 0 && <Badge tone="success">{quote.bestLines} en uygun</Badge>}
                      {quote.lateLines > 0 && <Badge tone="warning">{quote.lateLines} geç</Badge>}
                    </span>
                    <span className="mt-1 block text-xs tabular-nums text-ink-soft">
                      {quote.pricedLines}/{round.lines.length} kalem · {formatMoney(quote.total, currency)}
                    </span>
                  </th>
                ))}
                <th className="py-2 text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">Durum</th>
              </tr>
            </thead>
            <tbody>
              {round.lines.map((line) => {
                const pick = picks[line.id];
                const choosable = editable && line.state === 'PENDING';
                const needsReason = choosable && pick && pick.quoteLineId !== line.bestQuoteLineId;
                return (
                  <tr key={line.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="block font-semibold text-ink">{line.name}</span>
                      <span className="block tabular-nums">{quantityText(line.quantity, line.unit)}</span>
                      <span className="block text-xs text-ink-muted">
                        İhtiyaç {dayText(line.neededBy)} · kart {formatMoney(line.currentCost, currency)}/{KITCHEN_UNIT_LABELS[line.unit]}
                      </span>
                      <span className="block text-xs text-ink-muted" title={line.requests.map((request) => request.number).join(', ')}>
                        {line.requestCount} talep · {[...new Set(line.requests.map((request) => PURCHASE_REQUEST_SOURCE_LABELS[request.source]))].join(', ')}
                      </span>
                      {needsReason && (
                        <input
                          aria-label={`${line.name} seçim gerekçesi`}
                          placeholder="En uygun dışı seçimin gerekçesi"
                          className={`mt-1.5 w-full rounded-item border bg-surface px-2 py-1 text-xs outline-none focus:border-ink ${pick.reason.trim().length < MIN_REQUEST_REASON_LENGTH ? 'border-sec-strong' : 'border-line-strong'}`}
                          value={pick.reason}
                          onChange={(event) => setPicks((current) => ({ ...current, [line.id]: { ...current[line.id], reason: event.target.value } }))}
                          disabled={award.isPending}
                        />
                      )}
                      {line.awardReason && <span className="mt-1 block text-xs italic text-ink-soft">Gerekçe: {line.awardReason}</span>}
                    </td>
                    {round.quotes.map((quote) => {
                      const cell = quote.lines.find((entry) => entry.roundLineId === line.id);
                      if (!cell || cell.unitPrice === null) {
                        return (
                          <td key={quote.id} className="py-2 pr-3 text-xs text-ink-muted">
                            vermiyor
                          </td>
                        );
                      }
                      const awarded = line.awardedQuoteLineId === cell.id;
                      const usable = quote.supplierActive && !quote.expired;
                      const checked = choosable ? pick?.quoteLineId === cell.id : awarded;
                      return (
                        <td key={quote.id} className={`py-2 pr-3 ${cell.best ? 'bg-success-soft/60' : ''} ${awarded ? 'ring-2 ring-inset ring-success-ink/40' : ''}`}>
                          <label className={`flex items-start gap-2 ${choosable && usable ? 'cursor-pointer' : ''}`}>
                            {choosable && (
                              <input
                                type="radio"
                                name={`pick-${line.id}`}
                                className="mt-1 accent-ink"
                                checked={checked}
                                onChange={() => choose(line.id, cell.id)}
                                disabled={!usable || award.isPending}
                                aria-label={`${line.name}: ${quote.supplierName}`}
                              />
                            )}
                            <span className={!usable ? 'opacity-50' : ''}>
                              <span className="block font-semibold tabular-nums text-ink">
                                {PRICE.format(Number(cell.unitPrice))} <span className="text-xs font-normal text-ink-muted">/{KITCHEN_UNIT_LABELS[line.unit]}</span>
                              </span>
                              <span className="block text-xs tabular-nums text-ink-soft">
                                {formatMoney(cell.net, currency)} · KDV %{cell.taxRatePct}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {cell.best && <Badge tone="success">en uygun</Badge>}
                                {cell.late && <Badge tone="warning">geç</Badge>}
                                {awarded && <Badge tone="success">kazandı</Badge>}
                              </span>
                            </span>
                          </label>
                        </td>
                      );
                    })}
                    <td className="py-2 text-xs">
                      {line.order ? (
                        <span className="flex flex-col gap-1">
                          <Link to={`/satin-alma/siparisler/${line.order.id}`} className="font-mono font-semibold text-ink hover:underline">
                            {line.order.number}
                          </Link>
                          <Badge tone={ORDER_STATUS_TONES[line.order.status]}>{PURCHASE_ORDER_STATUS_LABELS[line.order.status]}</Badge>
                        </span>
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          <span className="text-ink-soft">{ROUND_LINE_STATE_LABELS[line.state]}</span>
                          {choosable && pick && (
                            <button type="button" className="text-ink-muted underline hover:text-ink" onClick={() => unpick(line.id)} disabled={award.isPending}>
                              bu turda alma
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editable && pendingLines.length > 0 && round.quotes.length > 0 && (
        <Card
          title="Kazanan seçimi"
          description={`Seçimler tedarikçi başına ayrı siparişe döner. KDV dahil ${threshold > 0 ? `${formatMoney(threshold.toFixed(2), currency)} ve üstü` : 'hiçbir'} sipariş onay kuyruğuna gider (başka yetkili onaylar).`}
        >
          {groups.size === 0 ? (
            <p className="text-sm text-ink-muted">Seçili satır yok; matristen tedarikçi seçin.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {[...groups.entries()].map(([supplierId, group]) => (
                <li key={supplierId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 last:border-0">
                  <span>
                    <span className="font-semibold text-ink">{group.name}</span> <span className="text-ink-muted">· {group.lines} kalem</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-semibold">{formatMoney(group.total.toFixed(2), currency)}</span>
                    {threshold > 0 && group.total >= threshold && <Badge tone="warning">onaya gider</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {missingReasons.length > 0 && (
            <Alert tone="warning" className="mt-3">
              En uygun dışı seçimlerin gerekçesi eksik: {missingReasons.join(', ')}
            </Alert>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="text-sm text-ink-muted">
              {pickedCount} / {pendingLines.length} bekleyen satır seçili
            </span>
            <Button type="button" icon="truck" onClick={submitAward} disabled={pickedCount === 0 || award.isPending}>
              {award.isPending ? 'Siparişler açılıyor…' : `Seçilenleri siparişe çevir (${groups.size} sipariş)`}
            </Button>
          </div>
        </Card>
      )}

      {quoting && <QuoteDialog round={round} quote={quoting === 'new' ? null : quoting} defaultTaxRatePct={settings.data?.defaultTaxRatePct ?? '10'} onClose={() => setQuoting(null)} />}
      {closing && (
        <ReasonDialog
          title="Turu kapat"
          message={`Siparişe dönmemiş ${pendingLines.length} satır talebe geri bırakılır (yeniden tura alınabilir). Açılmış siparişler sürer.`}
          confirmLabel="Turu kapat"
          busy={close.isPending}
          onConfirm={(reason) => close.mutate(reason)}
          onClose={() => setClosing(false)}
        />
      )}
    </div>
  );
}
