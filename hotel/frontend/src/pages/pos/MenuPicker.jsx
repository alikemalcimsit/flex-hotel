import { useMemo, useState } from 'react';
import { MAX_POS_NOTE_LENGTH } from '@hotelos/hotel-contracts';
import { Badge, Button, EmptyState, Icon, Input } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { formatMoney } from '../../lib/format.js';
import { addToCart, cartCount, cartTotal, changeQuantity, setNote } from '../../lib/posCart.js';

/** Ürün aramasında Türkçe büyük / küçük harf. @param {string} text */
const fold = (text) => text.toLocaleLowerCase('tr-TR');

/**
 * Menüden sepet doldurma (restoranın turu ve oda servisi siparişi ortak): satış noktasında satılan gruplar, dokunmatik
 * ürün düğmeleri (tükenen kapalı), arama, sepet (adet, satır notu) ve tutar. Gönderme düğmeleri çağıranın
 * (`actions`): restoran "Gönder", oda servisi "Siparişi kaydet".
 *
 * @param {{
 *   terminal: { categories: any[], items: any[] },
 *   outletId: string,
 *   cart: import('../../lib/posCart.js').CartLine[],
 *   onCart: (update: (cart: any[]) => any[]) => void,
 *   maxLines: number,
 *   busy?: boolean,
 *   actions?: React.ReactNode,
 *   emptyCartHint?: string,
 * }} props
 */
export function MenuPicker({ terminal, outletId, cart, onCart, maxLines, busy = false, actions, emptyCartHint = 'Sepet boş — menüden ürüne dokunun.' }) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState(null);

  // Bu satış noktasında satılan gruplar (boş liste = her yerde) ve ürünleri.
  const categories = useMemo(() => terminal.categories.filter((entry) => entry.outletIds.length === 0 || entry.outletIds.includes(outletId)), [terminal.categories, outletId]);
  const allowed = useMemo(() => new Set(categories.map((entry) => entry.id)), [categories]);
  const items = useMemo(() => {
    const needle = fold(search.trim());
    return terminal.items.filter(
      (item) =>
        allowed.has(item.categoryId) &&
        (!category || item.categoryId === category) &&
        (!needle || fold(item.name).includes(needle) || (item.code ?? '').toLowerCase().includes(needle)),
    );
  }, [terminal.items, allowed, category, search]);
  const full = cart.length >= maxLines;

  return (
    <div className="flex flex-col gap-3">
      <Input label="Ürün ara" name="pos-menu-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ad ya da kod" />
      {categories.length > 1 && <ChoiceChips label="Menü grubu" options={categories.map((entry) => ({ value: entry.id, label: entry.name }))} value={category} onChange={setCategory} />}
      {items.length === 0 ? (
        <EmptyState icon="utensils" title="Ürün yok" description={search ? 'Aramaya uyan ürün yok.' : 'Bu satış noktasında satılan ürün tanımlı değil.'} />
      ) : (
        <ul className="grid max-h-[26rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={item.soldOut || busy || (full && !cart.some((line) => line.menuItemId === item.id && !line.note.trim()))}
                onClick={() => onCart((current) => addToCart(current, item))}
                className="flex h-20 w-full flex-col justify-between rounded-item border border-line bg-surface p-2.5 text-left text-sm transition-colors duration-150 hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="line-clamp-2 font-semibold leading-tight text-ink">{item.name}</span>
                <span className="flex items-center justify-between gap-1">
                  <span className="tabular-nums text-ink-soft">{formatMoney(item.price)}</span>
                  {item.soldOut && <Badge tone="danger" dot={false}>Tükendi</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Sepet" className="rounded-panel border border-line bg-surface-muted p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Sepet</h3>
          <span className="text-xs text-ink-muted">
            {cartCount(cart)} adet · {cart.length}/{maxLines} satır
          </span>
        </div>
        {cart.length === 0 ? (
          <p className="text-sm text-ink-muted">{emptyCartHint}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cart.map((line) => (
              <li key={line.key} className="rounded-item bg-surface px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" aria-label={`${line.name} bir azalt`} onClick={() => onCart((current) => changeQuantity(current, line.key, -1))} disabled={busy}>
                    −
                  </Button>
                  <span className="w-6 text-center font-bold tabular-nums">{line.quantity}</span>
                  <Button type="button" size="sm" variant="outline" icon="plus" aria-label={`${line.name} bir artır`} onClick={() => onCart((current) => changeQuantity(current, line.key, 1))} disabled={busy} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{line.name}</span>
                  <button type="button" className="text-xs font-semibold text-info-ink underline-offset-2 hover:underline" onClick={() => setNoteFor(noteFor === line.key ? null : line.key)} disabled={busy}>
                    {line.note ? 'Notu düzelt' : 'Not'}
                  </button>
                  <span className="tabular-nums text-sm">{formatMoney((Number(line.price) * line.quantity).toFixed(2))}</span>
                </div>
                {line.note && noteFor !== line.key && <p className="mt-1 pl-1 text-xs italic text-ink-soft">“{line.note}”</p>}
                {noteFor === line.key && (
                  <Input
                    className="mt-2"
                    aria-label={`${line.name} notu`}
                    value={line.note}
                    maxLength={MAX_POS_NOTE_LENGTH}
                    onChange={(event) => onCart((current) => setNote(current, line.key, event.target.value))}
                    placeholder="Az pişmiş, soğansız, alerji…"
                    autoFocus
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ink-soft">
            Tutar <strong className="tabular-nums text-ink">{formatMoney(cartTotal(cart))}</strong>
          </span>
          <div className="flex gap-2">
            {cart.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => onCart(() => [])} disabled={busy}>
                Temizle
              </Button>
            )}
            {actions}
          </div>
        </div>
        {full && (
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-warning-ink">
            <Icon name="alertTriangle" className="size-3.5" /> En fazla {maxLines} satır.
          </p>
        )}
      </section>
    </div>
  );
}
