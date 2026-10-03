import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Input, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { extrasKeys } from '../../lib/extras.js';
import { formatDate } from '../../lib/format.js';

/**
 * Oda bul (mobil): numarayı yaz, odanın şimdiki durumu gelir — odadaki misafir,
 * son 24 saatte ayrılanlar (çıkış / oda değişimi), son sayımlar, açık çamaşır.
 *
 * @param {{ children: (lookup: any, reset: () => void) => React.ReactNode, autoFocus?: boolean }} props
 */
export function RoomFinder({ children, autoFocus = true }) {
  const [input, setInput] = useState('');
  const [number, setNumber] = useState('');
  const lookup = useQuery({
    queryKey: extrasKeys.room(number),
    queryFn: () => api(withQuery('/extras/rooms/lookup', { number })),
    enabled: Boolean(number),
    retry: false,
  });

  function submit(event) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    if (value === number) lookup.refetch();
    else setNumber(value);
  }
  const reset = () => {
    setInput('');
    setNumber('');
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex items-end gap-2" noValidate>
        <Input
          label="Oda numarası"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ör. 204"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="w-40"
          autoFocus={autoFocus}
        />
        <Button type="submit" icon="search" disabled={!input.trim() || lookup.isFetching}>
          {lookup.isFetching ? 'Aranıyor…' : 'Odayı aç'}
        </Button>
      </form>
      {number && lookup.isPending && <Spinner className="py-4" />}
      {lookup.isError && <Alert tone="warning" title="Oda açılamadı">{lookup.error.message}</Alert>}
      {lookup.data && children(lookup.data, reset)}
    </div>
  );
}

/**
 * Odanın başlığı: numara, tip, odadaki misafir.
 * @param {{ data: any }} props
 */
export function RoomHeader({ data }) {
  const { room, inHouse } = data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-surface-muted px-4 py-3">
      <div>
        <p className="text-lg font-bold text-ink">Oda {room.number}</p>
        <p className="text-xs text-ink-muted">
          {room.roomType?.name} · {room.floor}. kat
        </p>
      </div>
      {inHouse ? (
        <div className="text-right text-sm">
          <p className="font-semibold text-ink">{inHouse.guestName}</p>
          <p className="text-xs text-ink-muted">
            {inHouse.confirmationCode} · çıkış {formatDate(inHouse.checkOut)}
          </p>
        </div>
      ) : (
        <Badge tone="neutral">Odada konaklayan yok</Badge>
      )}
    </div>
  );
}
