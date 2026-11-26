import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@hotelos/hotel-contracts';
import { Icon, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../lib/api.js';
import { chainKeys, switchHotel } from '../lib/chain.js';
import { useAuthStore } from '../store/auth.js';
import { toastError, toastSuccess } from '../store/toast.js';

/** Bu kadar oteli olan kişiye arama kutusu da gösterilir. */
const SEARCH_FROM = 8;

/**
 * Üst bardaki otel seçici (modül 63). Yalnız birden çok otele erişimi olan kişide görünür. Geçişte sunucu o otelin
 * kimliği ve rolüyle yeni oturum açar; önbellek ve canlı bağlantı yeni otele göre kurulur, ana sayfaya dönülür (açık
 * sayfanın kaydı başka otelde olmayabilir).
 *
 * Klavye: açılınca odak aramaya (ya da ilk otele) gider; Esc kapatır; dışarı tıklanınca kapanır.
 */
export function HotelSwitcher() {
  const hotel = useAuthStore((state) => state.hotel);
  const hotelCount = useAuthStore((state) => state.hotelCount);
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [switchingTo, setSwitchingTo] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();

  const term = search.trim();
  const list = useQuery({
    queryKey: chainKeys.myHotels(term),
    queryFn: () => api(withQuery('/auth/hotels', { search: term || undefined, limit: 50 })),
    enabled: isOpen,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    searchRef.current?.focus();
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!hotel || hotelCount < 2) return null;

  async function choose(target) {
    if (target.id === hotel.id) {
      setIsOpen(false);
      return;
    }
    setSwitchingTo(target.id);
    try {
      await switchHotel(target.id);
      setIsOpen(false);
      setSearch('');
      navigate('/');
      toastSuccess(`${target.name} oteline geçildi`);
    } catch (error) {
      toastError(error.message);
    } finally {
      setSwitchingTo(null);
    }
  }

  const items = list.data?.items ?? [];
  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => setIsOpen((open) => !open)}
        title={`Açık otel: ${hotel.name}. Başka otele geçmek için tıklayın.`}
        aria-label={`Açık otel: ${hotel.name}. Başka otele geçmek için tıklayın.`}
        className="inline-flex h-[42px] min-w-0 max-w-[14rem] items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-sm font-semibold text-ink shadow-soft transition duration-200 hover:bg-line sm:gap-2 sm:px-3"
      >
        <Icon name="building" className="size-[18px] shrink-0" />
        {/* Telefonda üst bar dar: yalnız simge (otel adı etikette ve açılan listede); tablette kod, masaüstünde ad. */}
        <span className="hidden truncate md:inline">{hotel.name}</span>
        <span className="hidden truncate sm:inline md:hidden">{hotel.code}</span>
        <Icon name="chevronDown" className="size-4 shrink-0 text-ink-muted" />
      </button>

      {isOpen && (
        // Telefonda düğme sola yakın: sağa hizalı liste ekrandan taşardı; üst barın altında tam genişlik açılır.
        <div className="fixed inset-x-4 top-[4.75rem] z-30 rounded-card border border-line bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]">
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Otel seç</p>
          {hotelCount >= SEARCH_FROM && (
            <div className="px-1 pb-2">
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Otel adı ya da kodu"
                aria-label="Otel ara"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              />
            </div>
          )}
          <div id={listId} role="listbox" aria-label="Erişiminiz olan oteller" className="max-h-80 overflow-y-auto">
            {list.isPending && <Spinner label="Oteller yükleniyor…" className="py-4" />}
            {list.isError && (
              <div className="px-3 py-3 text-sm text-danger-ink">
                {list.error.message}{' '}
                <button type="button" className="font-semibold underline" onClick={() => list.refetch()}>
                  Tekrar dene
                </button>
              </div>
            )}
            {list.isSuccess && items.length === 0 && <p className="px-3 py-4 text-sm text-ink-muted">Aramaya uyan otel yok.</p>}
            {items.map((item) => {
              const current = item.id === hotel.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={current}
                  disabled={Boolean(switchingTo)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm transition hover:bg-line disabled:opacity-60 ${current ? 'bg-surface-muted' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{item.name}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {item.code} · {ROLE_LABELS[item.role] ?? item.role}
                      {item.isHome ? ' · ana otel' : ''}
                      {item.groupName ? ` · ${item.groupName}` : ''}
                    </span>
                  </span>
                  {switchingTo === item.id ? (
                    <span className="shrink-0 text-xs text-ink-muted" role="status">Geçiliyor…</span>
                  ) : current ? (
                    <Icon name="check" className="size-4 shrink-0 text-success-ink" />
                  ) : null}
                </button>
              );
            })}
            {list.data?.hasMore && <p className="px-3 py-2 text-xs text-ink-muted">Daha fazla otel var; aramayla daraltın.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
