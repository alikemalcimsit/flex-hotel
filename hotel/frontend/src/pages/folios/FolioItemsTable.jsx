import { Link } from 'react-router-dom';
import { folioItemActionError } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Spinner } from '@hotelos/ui';
import { amountClass, folioPath, itemSourceLabel, itemTypeLabel } from '../../lib/folios.js';
import { formatDate, formatMoney, formatPercent } from '../../lib/format.js';

/**
 * Folyo dökümü: kalemler işlenme sırasıyla (imleçli, "daha fazla").
 *
 * - Seçim yalnızca taşınabilir kalemlerde (iptal edilmiş, iptal kaydı ve iptal
 *   onayı bekleyen kalem seçilmez — sunucu da reddeder).
 * - İptal edilmiş kalem üstü çizili, iptal kaydı yanında; başka konaklamadan
 *   gelen ya da aktarılan kalemin kaynağı yazılır.
 * - Vergi hücresi kalemin işlendiği andaki dökümüdür (ayar sonradan değişse de).
 *
 * @param {{
 *   query: import('@tanstack/react-query').UseInfiniteQueryResult,
 *   currency: string,
 *   selectable: boolean,
 *   selected: Set<string>,
 *   onToggle: (id: string) => void,
 *   onToggleAll: (ids: string[]) => void,
 *   onVoid?: (item: object) => void,
 * }} props
 */
export function FolioItemsTable({ query, currency, selectable, selected, onToggle, onToggleAll, onVoid }) {
  if (query.isPending) return <Spinner label="Kalemler yükleniyor…" className="py-10" />;
  if (query.isError) {
    return (
      <Alert tone="danger" title="Kalemler yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const items = query.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return <EmptyState icon="fileText" title="Bu folyoda kalem yok" description="Oda ücretleri her gece işlenir; harcamayı “Harcama ekle” ile girin." />;
  }
  const movable = items.filter((item) => !folioItemActionError(item, 'transfer')).map((item) => item.id);
  const allSelected = movable.length > 0 && movable.every((id) => selected.has(id));

  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Taşınabilir kalemlerin hepsini seç"
                    checked={allSelected}
                    disabled={movable.length === 0}
                    onChange={() => onToggleAll(allSelected ? [] : movable)}
                    className="size-4 accent-[var(--color-ink)]"
                  />
                </th>
              )}
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-bold">Tarih</th>
              <th scope="col" className="px-4 py-3 font-bold">Açıklama</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-bold">Adet × birim</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-bold">Vergi</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-bold">Tutar</th>
              {onVoid && <th scope="col" className="px-4 py-3 text-right font-bold"><span className="sr-only">İşlem</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => {
              const blocked = folioItemActionError(item, 'transfer');
              const voidBlocked = folioItemActionError(item, 'void');
              return (
                <tr key={item.id} className={item.voided || item.source === 'REVERSAL' ? 'bg-surface-muted/60 text-ink-muted' : ''}>
                  {selectable && (
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        aria-label={`${item.description} seç`}
                        checked={selected.has(item.id)}
                        disabled={Boolean(blocked)}
                        title={blocked ?? undefined}
                        onChange={() => onToggle(item.id)}
                        className="size-4 accent-[var(--color-ink)]"
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3 align-top text-xs">{formatDate(item.serviceDate)}</td>
                  <td className="px-4 py-3 align-top">
                    <span className={`block font-semibold ${item.voided ? 'line-through' : ''}`}>{item.description}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      <span>{itemTypeLabel(item.type)} · {itemSourceLabel(item.source)} · {item.postedBy}</span>
                      {item.voidPending && <Badge tone="warning">İptal onayı bekliyor</Badge>}
                      {item.voided && <Badge tone="neutral">İptal edildi{item.voidedBy ? ` · ${item.voidedBy}` : ''}</Badge>}
                    </span>
                    {item.voided && item.voidReason && <span className="mt-0.5 block text-xs text-ink-muted">Gerekçe: {item.voidReason}</span>}
                    {item.origin && (
                      <span className="mt-0.5 block text-xs text-info-ink">
                        Kaynak: <Link className="underline-offset-2 hover:underline" to={folioPath(item.origin.reservationId)}>oda {item.origin.roomNumber ?? '—'} · {item.origin.guestName}</Link>
                      </span>
                    )}
                    {item.transferredFrom && (
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {item.transferredFrom.name}
                        {item.transferredFrom.reservationId !== item.reservationId && item.transferredFrom.roomNumber ? ` (oda ${item.transferredFrom.roomNumber})` : ''} folyosundan aktarıldı · {item.transferredBy}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums">
                    {item.quantity} × {formatMoney(item.amount)}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-muted">
                    {item.taxLines.length === 0
                      ? '—'
                      : item.taxLines.map((tax) => (
                          <span key={`${tax.name}-${tax.rate}-${tax.included}`} className="block whitespace-nowrap">
                            {tax.name} {formatPercent(tax.rate)} {tax.included ? 'dahil' : '+'} {formatMoney(tax.amount)}
                          </span>
                        ))}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right align-top font-bold tabular-nums ${amountClass(item.total)}`}>
                    {formatMoney(item.total, currency)}
                  </td>
                  {onVoid && (
                    <td className="px-4 py-3 text-right align-top">
                      {!voidBlocked && (
                        <Button size="sm" variant="dangerSoft" icon="close" onClick={() => onVoid(item)}>
                          İptal iste
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {query.hasNextPage && (
        <div className="border-t border-line px-4 py-3 text-center">
          <Button size="sm" variant="outline" icon="arrowDown" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla kalem'}
          </Button>
        </div>
      )}
    </div>
  );
}
