import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { INVENTORY_CHANNEL, RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

/** Sayfa başına satır. */
export const STAY_PAGE_SIZE = 25;
/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;

/** Adres çubuğundaki filtreler: yenileyince kaybolmaz, bağlantı paylaşılabilir. */
export const STAY_PARAMS = Object.freeze({ view: 'gorunum', search: 'q', sort: 'sirala', page: 'sayfa' });

/**
 * Ön büro listeleri: adresteki filtreler, gecikmeli arama, canlı tazeleme.
 *
 * Giriş / çıkış (`reservations.changed`) ve oda durumu (`inventory.changed`:
 * temizlendi, kirlendi) listeyi ve özet sayıları tazeler. Socket kopuksa
 * liste dakikada bir kendini yeniler.
 *
 * @param {'arrivals' | 'departures' | 'in-house'} kind
 * @param {{ views?: readonly string[], sorts?: readonly string[], defaultView?: string, defaultSort?: string }} options
 */
export function useStayList(kind, { views, sorts, defaultView, defaultSort } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get(STAY_PARAMS.view);
  const rawSort = searchParams.get(STAY_PARAMS.sort);
  const page = Number(searchParams.get(STAY_PARAMS.page));
  const filters = {
    view: views ? (views.includes(rawView) ? rawView : defaultView) : undefined,
    sort: sorts ? (sorts.includes(rawSort) ? rawSort : defaultSort) : undefined,
    search: searchParams.get(STAY_PARAMS.search) ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };

  const update = useCallback(
    (changes, { resetPage = true, replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete(STAY_PARAMS.page);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    if (searchText === filters.search) return undefined;
    const timer = setTimeout(() => update({ [STAY_PARAMS.search]: searchText.trim() }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, update]);

  const keys = { queryKeys: [frontDeskKeys.lists, frontDeskKeys.summary], minIntervalMs: 1000 };
  const reservations = useLiveChannel(RESERVATIONS_CHANNEL, keys);
  const inventory = useLiveChannel(INVENTORY_CHANNEL, keys);
  const isLive = reservations.isLive && inventory.isLive;

  const query = useQuery({
    queryKey: frontDeskKeys.list(kind, filters),
    queryFn: () =>
      api(
        withQuery(`/front-desk/${kind}`, {
          view: filters.view,
          sort: filters.sort,
          search: filters.search || undefined,
          page: filters.page,
          pageSize: STAY_PAGE_SIZE,
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  return {
    filters,
    query,
    isLive,
    searchText,
    setSearchText,
    setView: (view) => update({ [STAY_PARAMS.view]: view === defaultView ? null : view }),
    setSort: (sort) => update({ [STAY_PARAMS.sort]: sort === defaultSort ? null : sort }),
    setPage: (next) => update({ [STAY_PARAMS.page]: next > 1 ? next : null }, { resetPage: false }),
  };
}
