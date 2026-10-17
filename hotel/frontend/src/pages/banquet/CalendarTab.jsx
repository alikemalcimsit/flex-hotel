import { useMemo } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EVENT_STATUS_LABELS, VENUE_LAYOUT_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { banquetKeys, eventPath, holdClass, shiftDay, weekdayText } from '../../lib/banquet.js';
import { useHotelToday } from '../../lib/useHotel.js';

const OFFLINE_REFRESH_MS = 60_000;
const SPANS = Object.freeze([
  { value: '7', label: '1 hafta' },
  { value: '14', label: '2 hafta' },
]);

/**
 * Bir salon satırına düşen oturumlar: o salona rezerve edilenler ve (parça satırında)
 * bütün salonun parçayı dolduran rezervasyonları. Aynı oturum bir kez görünür;
 * bütün salon rezervasyonunun sırası parçalarındaki en kötü sıradır (her parçada
 * 1. olmadan kesinleşemez).
 *
 * @param {any[]} holds
 * @param {{ id: string }} venue
 */
function rowEntries(holds, venue) {
  const seen = new Map();
  for (const hold of holds) {
    if (hold.venueId !== venue.id && hold.bookedVenueId !== venue.id) continue;
    const current = seen.get(hold.sessionId);
    if (!current) seen.set(hold.sessionId, { ...hold, viaWhole: hold.bookedVenueId !== venue.id });
    else if (hold.rank > current.rank) seen.set(hold.sessionId, { ...current, rank: hold.rank });
  }
  return [...seen.values()];
}

/**
 * Salon takvimi (modül 37): salon × gün ızgarası. Kesin etkinlik yeşil, 1. opsiyon
 * sarı, sırada bekleyen opsiyon kesik çizgili (sıra numarasıyla). Bütün salonun
 * rezervasyonu parçalarında da görünür (parça satılamaz). Hafta / iki hafta;
 * pencere sunucuda en fazla 31 gün.
 */
export function CalendarTab() {
  const { isLive = true } = useOutletContext() ?? {};
  const { today } = useHotelToday();
  const [params, setParams] = useSearchParams();
  const from = params.get('bas') ?? today;
  const span = params.get('gun') === '14' ? 14 : 7;
  const to = shiftDay(from, span - 1);
  const days = useMemo(() => Array.from({ length: span }, (_, index) => shiftDay(from, index)), [from, span]);
  const set = (key, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  const calendar = useQuery({
    queryKey: banquetKeys.calendar({ from, to }),
    queryFn: () => api(withQuery('/banquet/calendar', { from, to })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const data = calendar.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Başlangıç" type="date" value={from} onChange={(event) => set('bas', event.target.value)} className="w-44" />
        <Select label="Aralık" options={SPANS} value={String(span)} onChange={(event) => set('gun', event.target.value === '7' ? '' : event.target.value)} className="w-36" />
        <div className="flex gap-2 pb-0.5">
          <Button type="button" variant="outline" icon="chevronLeft" onClick={() => set('bas', shiftDay(from, -span))} aria-label="Önceki dönem" />
          <Button type="button" variant="outline" onClick={() => set('bas', '')} disabled={from === today}>
            Bugün
          </Button>
          <Button type="button" variant="outline" icon="chevronRight" onClick={() => set('bas', shiftDay(from, span))} aria-label="Sonraki dönem" />
        </div>
        <ul className="ml-auto flex flex-wrap gap-2 text-xs" aria-label="Renkler">
          <li className={`rounded-item border px-2 py-1 ${holdClass({ status: 'DEFINITE', rank: 1 })}`}>Kesin</li>
          <li className={`rounded-item border px-2 py-1 ${holdClass({ status: 'TENTATIVE', rank: 1 })}`}>1. opsiyon</li>
          <li className={`rounded-item border px-2 py-1 ${holdClass({ status: 'TENTATIVE', rank: 2 })}`}>Sırada bekleyen</li>
        </ul>
      </div>

      {calendar.isPending && <Spinner className="py-10" label="Takvim yükleniyor…" />}
      {calendar.isError && (
        <Alert tone="danger" title="Takvim yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => calendar.refetch()}>Tekrar dene</Button>}>
          {calendar.error.message}
        </Alert>
      )}
      {data && data.venues.length === 0 && (
        <EmptyState icon="building" title="Salon tanımlı değil" description='"Salon ve tanımlar" sekmesinden salonları, kapasitelerini ve fiyatlarını girin.' />
      )}
      {data?.truncated && (
        <Alert tone="warning" title="Takvim kısaltıldı">
          Bu aralıkta çok fazla rezervasyon var; daha kısa bir aralık seçin.
        </Alert>
      )}
      {data && data.venues.length > 0 && (
        <div className={`overflow-hidden rounded-card bg-surface shadow-card ${calendar.isFetching ? 'opacity-80' : ''}`}>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[56rem] table-fixed border-collapse text-xs">
              <caption className="sr-only">Salon × gün takvimi</caption>
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.06em] text-ink-muted">
                  <th scope="col" className="sticky left-0 z-10 w-44 bg-surface-muted px-3 py-2 font-bold">Salon</th>
                  {days.map((day) => (
                    <th key={day} scope="col" className={`px-2 py-2 font-bold ${day === today ? 'text-info-ink' : ''}`}>
                      {weekdayText(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.venues.map((venue) => {
                  const entries = rowEntries(data.holds, venue);
                  return (
                    <tr key={venue.id} className={venue.status === 'PASSIVE' ? 'opacity-60' : ''}>
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left align-top font-semibold text-ink">
                        <span className={venue.parentId ? 'block pl-3 text-ink-soft' : 'block'}>{venue.name}</span>
                        <span className="block font-normal text-ink-muted">
                          {venue.capacities.map((entry) => `${VENUE_LAYOUT_LABELS[entry.layout].split(' ')[0]} ${entry.capacity}`).join(' · ')}
                        </span>
                      </th>
                      {days.map((day) => {
                        const cell = entries
                          .filter((entry) => entry.startLocal.slice(0, 10) <= day && entry.endLocal.slice(0, 10) >= day)
                          .sort((a, b) => a.startLocal.localeCompare(b.startLocal) || a.rank - b.rank);
                        return (
                          <td key={day} className={`h-16 px-1 py-1 align-top ${day === today ? 'bg-info-soft/40' : ''}`}>
                            <div className="flex flex-col gap-1">
                              {cell.map((entry) => (
                                <Link
                                  key={`${entry.sessionId}-${day}`}
                                  to={eventPath(entry.eventId, 'program')}
                                  title={`${entry.event.name} (${entry.event.code}) · ${EVENT_STATUS_LABELS[entry.event.status]} · ${entry.title}`}
                                  className={`block rounded-item border px-1.5 py-1 leading-tight hover:shadow-soft ${holdClass(entry)}`}
                                >
                                  <span className="block font-semibold tabular-nums">
                                    {entry.startLocal.slice(0, 10) === day ? entry.startLocal.slice(11, 16) : '…'}–{entry.endLocal.slice(0, 10) === day ? entry.endLocal.slice(11, 16) : '…'}
                                    {entry.status !== 'DEFINITE' && <span className="ml-1">({entry.rank}.)</span>}
                                  </span>
                                  <span className="block truncate">{entry.event.name}</span>
                                  <span className="block truncate opacity-80">
                                    {entry.pax} kişi{entry.viaWhole ? ' · bütün salon' : ''}
                                  </span>
                                </Link>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
