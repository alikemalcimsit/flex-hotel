import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { QueryError } from '../activity/shared.jsx';

const RANGES = [
  { value: '30', label: 'Son 30 gün + 30 gün ileri' },
  { value: '60', label: 'Son 60 gün + 30 gün ileri' },
  { value: '90', label: 'Son 90 gün + 30 gün ileri' },
];

/** Çubuğun en fazla yüzde genişliği (±%50 ve üstü tam bar). */
const BAR_CAP_PCT = 50;

const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * Uygulanmış dinamik fiyat ayarları (modül 34): gece gece onaylı çarpanlar.
 * Grafik kütüphanesiz — artış sağa (amber), indirim sola (mavi) yatay çubuk.
 * Dönem geçmişe ve 30 gün ileriye bakar (onaylı gelecek ayarları da görünür).
 */
export function PriceHistoryCard({ roomTypes }) {
  const [roomTypeId, setRoomTypeId] = useState('');
  const [range, setRange] = useState('30');

  const window = useMemo(() => {
    const now = Date.now();
    return {
      from: isoDay(new Date(now - Number(range) * 86_400_000)),
      to: isoDay(new Date(now + 30 * 86_400_000)),
    };
  }, [range]);

  const query = useQuery({
    queryKey: ['pricing', 'history', window.from, window.to, roomTypeId],
    queryFn: () => {
      const params = new URLSearchParams({ from: window.from, to: window.to });
      if (roomTypeId) params.set('roomTypeId', roomTypeId);
      return api(`/pricing/history?${params}`);
    },
  });
  const rows = query.data ?? [];

  return (
    <Card
      title="Fiyat geçmişi"
      description="Onaylanıp uygulanan gece çarpanları. Çarpanı olmayan gecelerde taban (plan / sezon) fiyat geçerlidir."
      actions={
        <div className="flex gap-2">
          <Select
            name="history-room-type"
            aria-label="Oda tipi"
            value={roomTypeId}
            onChange={(event) => setRoomTypeId(event.target.value)}
            options={[{ value: '', label: 'Tüm tipler' }, ...roomTypes.map((type) => ({ value: type.id, label: type.name }))]}
            className="w-44"
          />
          <Select
            name="history-range"
            aria-label="Dönem"
            value={range}
            onChange={(event) => setRange(event.target.value)}
            options={RANGES}
            className="w-56"
          />
        </div>
      }
    >
      {query.isPending && <Spinner label="Fiyat geçmişi yükleniyor…" className="py-8" />}
      {query.isError && <QueryError query={query} title="Fiyat geçmişi yüklenemedi" />}
      {!query.isPending && !query.isError && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-muted">Bu dönemde uygulanmış dinamik fiyat ayarı yok.</p>
      )}
      {rows.length > 0 && (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
          {rows.map((row) => {
            const pct = Math.round((Number(row.multiplier) - 1) * 100);
            const width = Math.min(Math.abs(pct), BAR_CAP_PCT) * (100 / BAR_CAP_PCT);
            return (
              <li key={`${row.roomTypeId}:${row.date}`} className="grid grid-cols-[7rem_5rem_1fr_4rem] items-center gap-2 text-xs tabular-nums">
                <span className="text-ink-muted">{formatDate(row.date)}</span>
                <span className="truncate font-semibold">{row.roomTypeCode}</span>
                <span className="relative h-3 rounded-sm bg-surface-muted">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden />
                  <span
                    className={`absolute inset-y-0 rounded-sm ${pct >= 0 ? 'left-1/2 bg-amber-400' : 'right-1/2 bg-sky-400'}`}
                    style={{ width: `${width / 2}%` }}
                    aria-hidden
                  />
                </span>
                <span className={`text-right font-semibold ${pct >= 0 ? 'text-amber-600' : 'text-sky-600'}`}>
                  {pct >= 0 ? `+%${pct}` : `−%${Math.abs(pct)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
