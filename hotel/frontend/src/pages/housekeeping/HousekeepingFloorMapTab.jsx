import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HOUSEKEEPING_STATUS_LABELS, ROOM_OCCUPANCY_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, EmptyState, Icon } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { HOUSEKEEPING_TONES, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { api } from '../../lib/api.js';
import { priorityLabel, taskStatusLabel, taskTypeLabel } from '../../lib/housekeeping.js';
import { HOUSEKEEPING_CHANNEL, INVENTORY_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

const OFFLINE_REFRESH_MS = 60_000;

/** Kutu arka planları: rozet tonlarıyla aynı anlam, harita yoğunluğunda. */
const BOX_TONES = Object.freeze({
  DIRTY: 'bg-amber-100 border-amber-300 text-amber-900',
  CLEANING: 'bg-sky-100 border-sky-300 text-sky-900',
  CLEAN: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  INSPECTED: 'bg-violet-100 border-violet-300 text-violet-900',
});

/**
 * Oda durum haritası: kat kat renkli kutular. Renk kat hizmeti durumudur;
 * köşe işaretleri bugünkü giriş / çıkış, arıza ve açık görevi gösterir.
 * Kutuların anlamı yalnızca renkte değil: tıklayınca ayrıntı açılır.
 */
export function HousekeepingFloorMapTab() {
  const [selected, setSelected] = useState(null);

  // Hem görev hem oda durumu haberleri haritayı tazeler.
  const live = useLiveChannel(HOUSEKEEPING_CHANNEL, { queryKeys: [['housekeeping', 'floor-map']], minIntervalMs: 1500 });
  useLiveChannel(INVENTORY_CHANNEL, { queryKeys: [['housekeeping', 'floor-map']], minIntervalMs: 1500 });

  const map = useQuery({
    queryKey: ['housekeeping', 'floor-map'],
    queryFn: () => api('/housekeeping/floor-map'),
    refetchInterval: live.isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  // Yükleniyor ve hata ayrı: hata "oda yok" diye okunmasın.
  if (!map.data) return <QueryFallback query={map} errorTitle="Kat haritası yüklenemedi" />;
  const floors = map.data.floors;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {Object.entries(HOUSEKEEPING_STATUS_LABELS).map(([status, label]) => (
          <Badge key={status} tone={HOUSEKEEPING_TONES[status] ?? 'neutral'} dot>
            {label}
          </Badge>
        ))}
        <span className="flex items-center gap-1 text-ink-muted">
          <Icon name="arrowRight" className="h-3.5 w-3.5" /> giriş
        </span>
        <span className="flex items-center gap-1 text-ink-muted">
          <Icon name="logout" className="h-3.5 w-3.5" /> çıkış
        </span>
        <span className="flex items-center gap-1 text-ink-muted">
          <Icon name="alertTriangle" className="h-3.5 w-3.5" /> arıza / sorun
        </span>
        <Badge tone={live.isLive ? 'success' : 'warning'} className="ml-auto">
          {live.isLive ? 'Canlı' : 'Canlı değil'}
        </Badge>
      </div>

      {floors.length === 0 ? (
        <EmptyState icon="bed" title="Oda yok" description="Önce oda envanterini tanımlayın (Odalar ekranı)." />
      ) : (
        floors.map((floor) => (
          <section key={floor.floor} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Kat {floor.floor}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
              {floor.rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelected(room)}
                  className={`relative flex min-h-16 flex-col items-start justify-between rounded-item border p-2 text-left shadow-soft transition-transform hover:-translate-y-0.5 ${
                    BOX_TONES[room.housekeepingStatus] ?? 'border-line bg-surface'
                  } ${room.blocked ? 'opacity-60 ring-2 ring-red-400' : ''}`}
                >
                  <span className="text-sm font-black">{room.number}</span>
                  <span className="flex w-full items-center justify-between text-[11px] font-semibold">
                    <span>{room.occupancy === 'OCCUPIED' ? 'Dolu' : 'Boş'}</span>
                    <span className="flex items-center gap-0.5">
                      {room.arrivalToday && <Icon name="arrowRight" className="h-3 w-3" />}
                      {room.departureToday && <Icon name="logout" className="h-3 w-3" />}
                      {(room.blocked || room.openTask?.issue) && <Icon name="alertTriangle" className="h-3 w-3" />}
                      {room.openTask && <Icon name="sparkles" className="h-3 w-3" />}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {selected && <RoomDetailDialog room={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** @param {{ room: object, onClose: () => void }} props */
function RoomDetailDialog({ room, onClose }) {
  return (
    <Modal
      open
      title={`Oda ${room.number}`}
      onClose={onClose}
      size="sm"
      footer={
        <Button variant="outline" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <HousekeepingBadge status={room.housekeepingStatus} />
          <OccupancyBadge occupancy={room.occupancy} />
          {room.blocked && <Badge tone="danger">Arızalı / hizmet dışı</Badge>}
          {room.arrivalToday && <Badge tone="info">Bugün giriş var</Badge>}
          {room.departureToday && <Badge tone="warning">Bugün çıkış var</Badge>}
        </div>
        {room.openTask ? (
          <div className="rounded-item bg-surface-muted p-3">
            <p className="font-semibold">
              Açık görev: {taskTypeLabel(room.openTask.type)} · {taskStatusLabel(room.openTask.status)}
            </p>
            <p className="text-ink-muted">
              Öncelik: {priorityLabel(room.openTask.priority)} · Görevli: {room.openTask.assignedTo?.name ?? 'atanmadı'}
              {room.openTask.issue ? ' · sorun bildirildi' : ''}
            </p>
          </div>
        ) : (
          <p className="text-ink-muted">Açık temizlik görevi yok. {ROOM_OCCUPANCY_LABELS[room.occupancy] ?? ''}</p>
        )}
      </div>
    </Modal>
  );
}
