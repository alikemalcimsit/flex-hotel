import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, Spinner } from '@hotelos/ui';

/** Yazmayı bitirmeden sunucuya gidilmesin. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Arama seçici (combobox): yazdıkça sunucudan sonuç getirir, seçilen öğeyi `onPick` ile verir
 * ve kutuyu temizler (bir listeye ard arda ekleme için: reçete satırı, menü yemeği). Klavye:
 * ↑ ↓, Enter, Esc. Yükleniyor / hata / sonuç yok durumları listede yazar.
 *
 * @param {{
 *   label: string,
 *   placeholder: string,
 *   queryOf: (search: string) => { queryKey: unknown[], queryFn: () => Promise<any> },
 *   itemsOf?: (data: any) => any[],
 *   renderItem: (item: any) => React.ReactNode,
 *   onPick: (item: any) => void,
 *   isDisabled?: (item: any) => string | null,
 *   emptyText: string,
 *   disabled?: boolean,
 *   error?: string,
 * }} props `isDisabled` seçilemeyen öğenin sebebini döner (zaten listede gibi)
 */
export function SearchPicker({ label, placeholder, queryOf, itemsOf = (data) => data ?? [], renderItem, onPick, isDisabled = () => null, emptyText, disabled = false, error }) {
  const inputId = useId();
  const listId = useId();
  const rootRef = useRef(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const results = useQuery({ ...queryOf(search), enabled: open && !disabled, placeholderData: (previous) => previous });
  const items = itemsOf(results.data);

  function choose(item) {
    if (isDisabled(item)) return;
    onPick(item);
    setText('');
    setActive(0);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      // Formu göndermesin: Enter seçimdir.
      event.preventDefault();
      if (open && items[active]) choose(items[active]);
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-control border bg-surface py-2.5 pl-9 pr-4 text-sm text-ink outline-none transition-colors focus:border-ink disabled:opacity-60 ${error ? 'border-sec-strong' : 'border-line-strong'}`}
        />
      </div>
      {error && <p className="text-xs font-semibold text-sec-strong">{error}</p>}
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute top-full z-30 mt-1 max-h-80 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-card">
          {results.isPending && (
            <li className="px-4 py-2.5">
              <Spinner label="Aranıyor…" className="justify-start" />
            </li>
          )}
          {results.isError && <li className="px-4 py-2.5 text-sm text-sec-strong">Sonuçlar alınamadı: {results.error.message}</li>}
          {!results.isPending && !results.isError && items.length === 0 && <li className="px-4 py-2.5 text-sm text-ink-muted">{emptyText}</li>}
          {items.map((item, index) => {
            const reason = isDisabled(item);
            return (
              <li key={item.id} role="option" aria-selected={index === active} aria-disabled={reason ? true : undefined}>
                <button
                  type="button"
                  disabled={Boolean(reason)}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${index === active ? 'bg-surface-muted' : ''}`}
                >
                  <span className="min-w-0 flex-1">{renderItem(item)}</span>
                  {reason && <span className="shrink-0 text-xs text-ink-muted">{reason}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
