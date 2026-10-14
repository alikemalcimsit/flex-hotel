import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../lib/api.js';
import { agencyKeys } from '../lib/agencies.js';

const SEARCH_DEBOUNCE_MS = 250;
const OPTIONS_STALE_MS = 15_000;

/**
 * Acente seçici (modül 29): ada ya da koda göre arar (sunucu tarafı, en fazla
 * 20 sonuç — binlerce acentesi olan otelde de açılışta liste çekilmez), seçilen
 * acenteyi çip olarak gösterir. Yalnızca aktif acenteler listelenir.
 *
 * Klavye: ↑ ↓ ile gezinir, Enter seçer, Esc kapatır.
 *
 * @param {{
 *   value: { id: string, code?: string, name: string } | null,
 *   onChange: (agency: { id: string, code: string, name: string } | null) => void,
 *   label?: string,
 *   error?: string,
 *   disabled?: boolean,
 *   required?: boolean,
 * }} props
 */
export function AgencyPicker({ value, onChange, label = 'Acente', error, disabled = false, required = false }) {
  const inputId = useId();
  const listId = useId();
  const rootRef = useRef(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // Dışarı tıklayınca kapanır.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const results = useQuery({
    queryKey: agencyKeys.options({ q: query }),
    queryFn: () => api(withQuery('/agencies/options', { q: query || undefined })),
    enabled: open && !value,
    staleTime: OPTIONS_STALE_MS,
    placeholderData: (previous) => previous,
  });
  const items = results.data?.items ?? [];

  function choose(agency) {
    onChange({ id: agency.id, code: agency.code, name: agency.name });
    setText('');
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && items[active]) {
      event.preventDefault();
      choose(items[active]);
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>

      {value ? (
        <div className={`flex items-center justify-between gap-3 rounded-control border bg-surface px-4 py-2.5 ${error ? 'border-sec-strong' : 'border-line-strong'}`}>
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name="building" className="size-4 shrink-0 text-ink-muted" />
            <span className="truncate font-semibold text-ink">{value.name}</span>
            {value.code && <span className="shrink-0 font-mono text-xs text-ink-muted">{value.code}</span>}
          </span>
          {!disabled && (
            <button type="button" aria-label="Acenteyi kaldır" onClick={() => onChange(null)} className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-black/[0.06] hover:text-ink">
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
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
            placeholder="Acente adı ya da kodu yazın"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={`w-full rounded-control border bg-surface px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-ink disabled:opacity-60 ${error ? 'border-sec-strong' : 'border-line-strong'}`}
          />
          {open && (
            <ul id={listId} role="listbox" aria-label="Acenteler" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-card">
              {results.isPending && (
                <li className="px-4 py-3">
                  <Spinner label="Acenteler aranıyor…" />
                </li>
              )}
              {results.isError && (
                <li className="px-4 py-3 text-sm text-sec-strong">
                  Acenteler alınamadı.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => results.refetch()}>
                    Tekrar dene
                  </button>
                </li>
              )}
              {results.isSuccess && items.length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-muted">{query ? 'Eşleşen aktif acente yok' : 'Kayıtlı aktif acente yok'}</li>
              )}
              {items.map((agency, index) => (
                <li key={agency.id} role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    onClick={() => choose(agency)}
                    onMouseEnter={() => setActive(index)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${index === active ? 'bg-surface-muted' : ''}`}
                  >
                    <span className="truncate font-semibold text-ink">{agency.name}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{agency.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-sec-strong">
          {error}
        </p>
      )}
    </div>
  );
}
