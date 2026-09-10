import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';

/**
 * Müsaitlik ızgarası: satır oda tipi, sütun gece, hücrede boş oda sayısı.
 *
 * Renk kodu bilinçli: resepsiyonist ekrana bakınca sayı okumadan önce doluluk
 * durumunu görmeli. Kırmızı = overbooking (negatif), turuncu = son odalar,
 * yeşil = rahat.
 */

const WINDOW_DAYS = 14;

const toIsoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDay, days) => {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDay(date);
};

/** @param {{ free: number, total: number }} cell */
function cellTone({ free, total }) {
  if (free < 0) return 'bg-red-100 text-red-800 font-semibold';
  if (free === 0) return 'bg-gray-100 text-gray-500';
  if (total > 0 && free / total <= 0.25) return 'bg-orange-100 text-orange-900';
  return 'bg-green-50 text-green-800';
}

function dayLabel(isoDay) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  return {
    weekday: new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date),
    isWeekend: [0, 6].includes(date.getUTCDay()),
  };
}

export function AvailabilityTab() {
  const [from, setFrom] = useState(toIsoDay(new Date()));

  const to = addDays(from, WINDOW_DAYS);
  const query = useQuery({
    queryKey: ['rooms', 'availability', { from, to }],
    queryFn: () => api(withQuery('/rooms/availability', { from, to })),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Başlangıç"
          name="from"
          type="date"
          value={from}
          onChange={(event) => event.target.value && setFrom(event.target.value)}
          className="w-48"
        />
        <Button variant="secondary" onClick={() => setFrom(addDays(from, -WINDOW_DAYS))}>
          ← Önceki {WINDOW_DAYS} gün
        </Button>
        <Button variant="secondary" onClick={() => setFrom(toIsoDay(new Date()))}>
          Bugün
        </Button>
        <Button variant="secondary" onClick={() => setFrom(addDays(from, WINDOW_DAYS))}>
          Sonraki {WINDOW_DAYS} gün →
        </Button>
      </div>

      {query.isPending && <Card>Müsaitlik hesaplanıyor…</Card>}

      {query.isError && (
        <Card>
          <p className="mb-3 text-sm text-red-600">{query.error.message}</p>
          <Button variant="secondary" onClick={() => query.refetch()}>
            Tekrar dene
          </Button>
        </Card>
      )}

      {query.data && query.data.roomTypes.length === 0 && (
        <Card>
          <p className="text-sm font-medium text-gray-700">Henüz oda tipi tanımlanmamış</p>
          <p className="mt-1 text-xs text-gray-500">
            Müsaitlik hesaplanabilmesi için Ayarlar → Oda tipleri bölümünden tip tanımlayın.
          </p>
        </Card>
      )}

      {query.data && query.data.roomTypes.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Oda tipi
                  </th>
                  {query.data.days.map((day) => {
                    const label = dayLabel(day);
                    return (
                      <th
                        key={day}
                        className={`px-2 py-2 text-center text-xs font-medium ${
                          label.isWeekend ? 'bg-blue-50 text-blue-800' : 'text-gray-500'
                        }`}
                      >
                        <div>{label.weekday}</div>
                        <div className="font-normal">{label.day}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.roomTypes.map((roomType) => (
                  <tr key={roomType.id}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-3">
                      <div className="font-medium text-gray-900">{roomType.code}</div>
                      <div className="text-xs text-gray-500">
                        {roomType.name} · {roomType.total} oda
                      </div>
                    </td>
                    {query.data.days.map((day) => {
                      const cell = roomType.days[day] ?? { free: 0, total: roomType.total, occupied: 0, blocked: 0, unassigned: 0 };
                      return (
                        <td key={day} className="px-1 py-1 text-center">
                          <div
                            className={`rounded px-2 py-1.5 text-sm ${cellTone(cell)}`}
                            title={`Toplam ${cell.total} · Dolu ${cell.occupied} · Bloklu ${cell.blocked} · Oda bekleyen ${cell.unassigned}`}
                          >
                            {cell.free}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-green-50 ring-1 ring-green-200" /> Yer var
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-orange-100 ring-1 ring-orange-300" /> Son odalar (%25 ve altı)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-gray-100 ring-1 ring-gray-300" /> Dolu
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-red-100 ring-1 ring-red-300" /> Overbooking
            </span>
            <span className="text-gray-400">Hücrenin üzerine gelince kırılım görünür.</span>
          </div>
        </>
      )}
    </div>
  );
}
