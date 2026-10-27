import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_TRAY_BATCH } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, Checkbox, EmptyState, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { usePosLive } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ROOM_SERVICE_PATH, dayClockText, durationText, rsKeys } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Kanal yalnızca POS yetkilisine açık: kat görevlisinin ekranı bu aralıkla tazelenir. */
const REFRESH_MS = 60_000;

/**
 * Toplanacak tepsiler (modül 41): teslim edilmiş, tepsi bırakılmış, toplanmamış siparişler — en eski önce; uyarı
 * süresini geçenler işaretli. Kat görevlisi ya da oda servisi tek tek ya da toplu "toplandı" der (iki kişi aynı anda
 * işaretlese de sonuç aynı). Misafir bu arada oda değiştirdiyse tepsi eski odadadır; çıkış yaptıysa oda boşalmıştır.
 */
export function RoomServiceTraysPage() {
  const can = useCan();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const { isLive } = usePosLive();
  const { timeZone } = useHotelToday();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(() => new Set());
  const query = useQuery({ queryKey: rsKeys.trays({}), queryFn: () => api('/pos/room-service/trays'), refetchInterval: operate && isLive ? false : REFRESH_MS });
  const collect = useMutation({
    mutationFn: (orderIds) => apiPost('/pos/room-service/trays/collect', { orderIds }),
    onSuccess: (result) => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: rsKeys.all });
      toastSuccess(result.skipped ? `${result.collected} tepsi toplandı (${result.skipped} zaten işaretliydi)` : `${result.collected} tepsi toplandı`);
    },
    onError: (error) => toastError(error.message),
  });
  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_TRAY_BATCH) next.add(id);
      return next;
    });
  const busy = collect.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Toplanacak tepsiler" description="Oda servisinin odada bıraktığı tepsiler. Toplayınca işaretleyin; süresi geçen tepsi oda servisine uyarı düşürür." />
      {operate && (
        <Link to={ROOM_SERVICE_PATH} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Oda servisi panosu
        </Link>
      )}
      {query.isPending || query.isError ? (
        <QueryFallback query={query} errorTitle="Tepsiler yüklenemedi" />
      ) : query.data.total === 0 ? (
        <Card>
          <EmptyState icon="checkCheck" title="Toplanacak tepsi yok" description="Teslim edilen siparişlerin tepsileri toplandı." />
        </Card>
      ) : (
        <Card
          title={`${query.data.total} tepsi`}
          description={`Uyarı süresi ${query.data.trayAlertMinutes} dakika`}
          actions={
            <Button type="button" icon="checkCheck" onClick={() => collect.mutate([...selected])} disabled={busy || selected.size === 0}>
              {busy ? 'İşaretleniyor…' : `Seçilenler toplandı (${selected.size})`}
            </Button>
          }
        >
          <ul className="flex flex-col divide-y divide-line">
            {query.data.items.map((tray) => (
              <li key={tray.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Checkbox label={`Oda ${tray.roomNumber}`} checked={selected.has(tray.id)} onChange={() => toggle(tray.id)} disabled={busy} />
                <span className="text-ink-soft">
                  {tray.guestName} · <span className="font-mono">{tray.number}</span>
                </span>
                {tray.checkedOut ? <Badge tone="neutral">Misafir çıktı</Badge> : tray.currentRoom && tray.currentRoom !== tray.roomNumber && <Badge tone="warning">Misafir {tray.currentRoom} odasında</Badge>}
                <span className={tray.overdue ? 'font-semibold text-danger-ink' : 'text-ink-muted'}>
                  teslim {dayClockText(tray.deliveredAt, timeZone)} · {durationText(tray.minutes)} önce
                </span>
                {tray.overdue && <Badge tone="danger">Süresi geçti</Badge>}
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => collect.mutate([tray.id])} disabled={busy}>
                  Toplandı
                </Button>
              </li>
            ))}
          </ul>
          {query.data.total > query.data.items.length && <p className="mt-2 text-xs text-ink-muted">En eski {query.data.items.length} tepsi gösteriliyor.</p>}
        </Card>
      )}
    </div>
  );
}
