import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ROOM_SERVICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, withQuery } from '../../lib/api.js';
import { prepListHtml, printHtml } from '../../lib/posPrint.js';
import { RS_STATUS_TONES, clockText, orderPath, rsKeys } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError } from '../../store/toast.js';
import { RoomServiceTabs } from './RoomServiceTabs.jsx';

const OFFLINE_REFRESH_MS = 60_000;

/** @param {string} day "YYYY-AA-GG" @param {number} offset gün */
const shiftDay = (day, offset) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Hazırlık listesi (modül 41, kahvaltı kartı): seçilen gün teslim saatli siparişler — günün üretim toplamı (ürün başına
 * adet, notlu kalem ayrı) ve 15 dakikalık teslim aralıkları (aralığın toplamı, odalar ve kalemleri, durumları).
 * Mutfak sabah bu listeyle hazırlar; yazdırılabilir. Gün otelin günüdür.
 */
export function RoomServicePrepPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const { today, timeZone } = useHotelToday();
  const [date, setDate] = useState('');
  const day = date || shiftDay(today, 1);
  const query = useQuery({
    queryKey: rsKeys.prep({ date: day }),
    queryFn: () => api(withQuery('/pos/room-service/prep', { date: day })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const prep = query.data;
  const print = () => {
    if (!printHtml(prepListHtml(prep))) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
  };

  return (
    <div className="flex flex-col gap-4">
      <RoomServiceTabs />
      <div className="flex flex-wrap items-end gap-3">
        <ChoiceChips
          label="Gün"
          options={[
            { value: today, label: 'Bugün' },
            { value: shiftDay(today, 1), label: 'Yarın' },
          ]}
          value={day}
          onChange={(value) => setDate(value || '')}
        />
        <Input label="Başka gün" name="rs-prep-date" type="date" value={day} onChange={(event) => setDate(event.target.value)} className="w-44" />
        {prep && prep.total > 0 && (
          <Button type="button" variant="outline" icon="fileText" onClick={print}>
            Yazdır
          </Button>
        )}
      </div>
      {query.isPending || query.isError ? (
        <QueryFallback query={query} errorTitle="Hazırlık listesi yüklenemedi" />
      ) : prep.total === 0 ? (
        <Card>
          <EmptyState icon="calendar" title="Bu güne teslim saatli sipariş yok" description="Kahvaltı kartları ve ileri saatli siparişler girildikçe burada toplanır." />
        </Card>
      ) : (
        <>
          {prep.truncated && <Alert tone="warning" title="Liste kesildi">Bu günün siparişleri sınırı aştı; ilk {prep.total} sipariş gösteriliyor.</Alert>}
          <section aria-label="Özet" className="flex flex-wrap gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm shadow-soft">
            <span>
              <strong>{prep.total}</strong> sipariş
            </span>
            <span>Planlı / kabul bekleyen {prep.counts.scheduled}</span>
            <span>Mutfakta {prep.counts.inKitchen}</span>
            <span>Yolda / teslim {prep.counts.out}</span>
          </section>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <Card title="Günün üretim listesi" description="Mutfağa giden ürünler; aynı ürünün notlu siparişi ayrı satır.">
              <ItemTotals items={prep.items} />
            </Card>
            <div className="flex flex-col gap-4">
              {prep.slots.map((slot) => (
                <Card key={slot.time} title={`${slot.time} · ${slot.orders.length} oda`} description={`${prep.slotMinutes} dakikalık teslim aralığı`}>
                  <ItemTotals items={slot.items} compact />
                  <ul className="mt-3 flex flex-col divide-y divide-line">
                    {slot.orders.map((order) => (
                      <li key={order.id} className="py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={orderPath(order.id)} className="font-bold text-ink hover:underline">
                            Oda {order.movedTo ?? order.roomNumber}
                          </Link>
                          <span className="text-ink-soft">{clockText(order.deliverAt, timeZone)} · {order.covers} kişi · {order.guestName}</span>
                          <Badge tone={RS_STATUS_TONES[order.status]}>{ROOM_SERVICE_STATUS_LABELS[order.status]}</Badge>
                        </div>
                        <p className="text-ink-soft">
                          {order.items.map((item) => `${item.quantity} × ${item.name}${item.note ? ` (${item.note})` : ''}`).join(', ')}
                        </p>
                        {order.note && <p className="text-xs italic text-ink-muted">Not: {order.note}</p>}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** @param {{ items: Array<{ menuItemId: string, name: string, note: string | null, quantity: number }>, compact?: boolean }} props */
function ItemTotals({ items, compact = false }) {
  if (!items.length) return <p className="text-sm text-ink-muted">Mutfağa giden kalem yok.</p>;
  return (
    <ul className={`grid gap-1 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
      {items.map((item) => (
        <li key={`${item.menuItemId}|${item.note ?? ''}`} className="flex items-baseline justify-between gap-2 rounded-item bg-surface-muted px-2.5 py-1.5 text-sm">
          <span className="min-w-0 truncate">
            {item.name}
            {item.note && <span className="ml-1 text-xs italic text-ink-soft">({item.note})</span>}
          </span>
          <strong className="tabular-nums text-ink">{item.quantity}</strong>
        </li>
      ))}
    </ul>
  );
}
