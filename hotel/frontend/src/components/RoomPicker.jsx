import { useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Icon, LABEL_CLASS, ERROR_CLASS, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../lib/api.js';

/** Açılır listede gösterilen en fazla oda. */
const RESULT_LIMIT = 8;

/** Yazmayı bırakınca aramaya geçmeden önceki bekleme. */
const SEARCH_DEBOUNCE_MS = 200;

const INPUT_CLASS =
  'w-full rounded-control border bg-surface py-2.5 pl-10 pr-4 text-sm font-medium text-ink outline-none transition duration-200 placeholder:font-normal placeholder:text-ink-muted/70 focus:border-ink focus:ring-[3px] focus:ring-black/[0.08] disabled:cursor-not-allowed disabled:bg-surface-muted';

/**
 * Oda seçici — numara yazılarak aranan açılır liste (WAI-ARIA combobox).
 *
 * Yüzlerce odalı otelde düz açılır liste kullanılamaz; resepsiyon zaten oda
 * numarasını bilir ("203 havlu istiyor"). Yazılan numarayla tam eşleşen oda
 * listenin başına alınır, Enter ile doğrudan seçilir.
 *
 * Klavye: ↓ listeyi açar, ↑/↓ seçenekler arasında gezer, Enter seçer, Esc
 * listeyi kapatır.
 *
 * @param {{
 *   label: string,
 *   value: { id: string, number: string, floor?: number | null } | null,
 *   onChange: (room: { id: string, number: string, floor?: number | null } | null) => void,
 *   error?: string,
 *   hint?: React.ReactNode,
 *   disabled?: boolean,
 * }} props
 */
export function RoomPicker({ label, value, onChange, error, hint, disabled = false }) {
  const inputId = useId();
  const listId = useId();
  const errorId = useId();
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useQuery({
    queryKey: ['rooms', 'picker', search],
    queryFn: () => api(withQuery('/rooms', { search, page: 1, pageSize: RESULT_LIMIT })),
    enabled: open && !value,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rooms = [...(query.data?.items ?? [])].sort(
    (a, b) => Number(b.number === search) - Number(a.number === search),
  );

  useEffect(() => setActiveIndex(0), [search]);

  const choose = (room) => {
    onChange({ id: room.id, number: room.number, floor: room.floor });
    setText('');
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    // Seçim kalkınca yazma alanı çizilir; odak bir sonraki çizimde oraya.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Kapalıyken ilk basış yalnızca listeyi açar; ilk seçenek atlanmasın.
      if (!open) setOpen(true);
      else setActiveIndex((index) => Math.min(index + 1, Math.max(rooms.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && rooms[activeIndex]) {
        event.preventDefault();
        choose(rooms[activeIndex]);
      }
    } else if (event.key === 'Escape' && open) {
      // Diyaloğun kendisi kapanmasın: yalnızca liste kapanır.
      event.stopPropagation();
      setOpen(false);
    }
  };

  const activeId = open && rooms[activeIndex] ? `${listId}-${rooms[activeIndex].id}` : undefined;

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <span className={LABEL_CLASS}>{label}</span>
      ) : (
        <label htmlFor={inputId} className={LABEL_CLASS}>
          {label}
        </label>
      )}

      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-line-strong bg-surface-muted px-4 py-2">
          <span className="flex items-center gap-2 text-sm font-bold text-ink">
            <Icon name="bed" className="size-4 text-ink-muted" />
            Oda {value.number}
            {value.floor !== null && value.floor !== undefined && (
              <span className="text-xs font-medium text-ink-muted">{value.floor}. kat</span>
            )}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              aria-label={`${label}: Oda ${value.number} seçili — değiştir`}
              className="rounded-item px-2 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
            >
              Değiştir
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="search"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="Oda numarası yazın…"
            value={text}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
            }}
            // Odaklanınca açılmaz: diyalog açılışında odak buraya gelir ve
            // liste alttaki alanları örterdi. Yazınca, ↓ ile ya da tıklayınca açılır.
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className={`${INPUT_CLASS} ${error ? 'border-sec-strong' : 'border-line-strong'}`}
          />

          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Odalar"
              className="absolute inset-x-0 top-full z-10 mt-1.5 max-h-72 overflow-y-auto rounded-panel border border-line bg-surface p-1.5 shadow-float"
            >
              {query.isPending && (
                <li className="px-3 py-3">
                  <Spinner label="Odalar aranıyor…" className="justify-start" />
                </li>
              )}
              {query.isError && <li className="px-3 py-3 text-sm text-sec-strong">{query.error.message}</li>}
              {query.data && rooms.length === 0 && (
                <li className="px-3 py-3 text-sm text-ink-muted">
                  {search ? `"${search}" ile eşleşen oda yok` : 'Tanımlı oda yok'}
                </li>
              )}
              {rooms.map((room, index) => (
                <li
                  key={room.id}
                  id={`${listId}-${room.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Tıklama `blur`dan önce işlensin diye mousedown.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(room);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-item px-3 py-2 text-sm ${
                    index === activeIndex ? 'bg-ink text-white' : 'text-ink'
                  }`}
                >
                  <span className="font-bold">Oda {room.number}</span>
                  <span className={`text-xs ${index === activeIndex ? 'text-white/70' : 'text-ink-muted'}`}>
                    {room.floor}. kat · {room.roomTypeCode}
                    {room.occupancy === 'OCCUPIED' ? ' · dolu' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hint && !error && <div className="text-xs text-ink-muted">{hint}</div>}
      {error && (
        <span id={errorId} className={ERROR_CLASS}>
          {error}
        </span>
      )}
    </div>
  );
}
