import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HOUSEKEEPING_STATUS_LABELS,
  PLAN_ROOMS_PAGE_SIZE,
  PLAN_WINDOW_OPTIONS,
  ROOM_CONDITION_LABELS,
  ROOM_OCCUPANCY_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveInventory } from '../../lib/useLiveInventory.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { MoveRoomDialog } from './MoveRoomDialog.jsx';
import { PlanGrid } from './PlanGrid.jsx';
import { ReservationDrawer } from './ReservationDrawer.jsx';
import { UnassignedStrip } from './UnassignedStrip.jsx';
import { BLOCK_TONES, RESERVATION_TONES, addDays, conflictOnRow } from './planTheme.js';

/**
 * Oda planı — otelin tamamının tek ekranda görüldüğü yer.
 *
 * ### Ekranın üç katmanı
 *
 * 1. **Şerit:** oda bekleyen rezervasyonlar. Envanteri tüketirler ama hiçbir
 *    satırda görünmezler; buradan bir odaya sürüklenirler.
 * 2. **Izgara:** satır oda, sütun gece. Barlar konaklama, şeritler arıza kaydı.
 * 3. **Çekmece:** bara tıklayınca açılan detay ve işlemler.
 *
 * ### Canlı
 *
 * Değişiklikler socket ile gelir (bkz. `useLiveInventory`). Bağlantı koparsa
 * ekran sessizce bayatlamaz: rozet "canlı değil" olur ve sorgu periyodik
 * tazelemeye düşer.
 *
 * ### Neden onay soruluyor
 *
 * İçerideki misafiri taşımak fiziksel bir iştir (eşya taşınır, anahtar
 * değişir) ve oda durumlarını değiştirir. Sürükle-bırak kazara olabilir; bu
 * yüzden yalnızca bu durumda onay isteniyor.
 */

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;

/** Filtre "hepsi" seçeneği — boş metin sorguya eklenmiyor (bkz. withQuery). */
const ALL = '';

const CONDITION_OPTIONS = [
  { value: ALL, label: 'Tümü' },
  ...Object.entries(ROOM_CONDITION_LABELS).map(([value, label]) => ({ value, label })),
];

const HOUSEKEEPING_OPTIONS = [
  { value: ALL, label: 'Tüm durumlar' },
  ...Object.entries(HOUSEKEEPING_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const OCCUPANCY_OPTIONS = [
  { value: ALL, label: 'Tüm odalar' },
  ...Object.entries(ROOM_OCCUPANCY_LABELS).map(([value, label]) => ({ value, label })),
];

const EMPTY_FILTERS = Object.freeze({
  search: ALL,
  roomTypeId: ALL,
  floor: ALL,
  occupancy: ALL,
  housekeepingStatus: ALL,
  condition: ALL,
});

export function RoomPlanPage() {
  const queryClient = useQueryClient();
  const canOperate = useCan()(PERMISSIONS.ROOMS_OPERATE);
  const { today } = useHotelToday();
  const { options: roomTypeOptions } = useRoomTypes();

  // Kullanıcı başka bir güne gitmediyse pencere otelin bugününü takip eder.
  const [pinnedFrom, setPinnedFrom] = useState(null);
  const [days, setDays] = useState(PLAN_WINDOW_OPTIONS[1]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  // Sürüklenen kayıt hem state'te (ızgara onu soluklaştırsın diye) hem ref'te
  // tutuluyor: "bırak" olayı, sürüklemeyi başlatan çizimden önce gelebilir ve
  // o an state'i okuyan bir kapanış (closure) boş görür — bırakma sessizce
  // kaybolurdu. Ref her zaman günceldir.
  const draggingRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [unassignTarget, setUnassignTarget] = useState(null);

  const from = pinnedFrom ?? today;
  const { isLive } = useLiveInventory([['plan'], ['rooms']]);

  const planQuery = useQuery({
    queryKey: ['plan', 'grid', { from, days, page, ...filters }],
    queryFn: () =>
      api(
        withQuery('/plan', {
          from,
          days,
          page,
          pageSize: PLAN_ROOMS_PAGE_SIZE,
          ...filters,
        }),
      ),
    enabled: Boolean(from),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const unassignedQuery = useQuery({
    queryKey: ['plan', 'unassigned', { from, days }],
    queryFn: () => api(withQuery('/plan/unassigned', { from, days })),
    enabled: Boolean(from),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['plan'] });
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const changeRoomMutation = useMutation({
    mutationFn: ({ reservationId, roomId }) => apiPut(`/plan/reservations/${reservationId}/room`, { roomId }),
    onSuccess: (data) => {
      const roomNumber = data.reservation?.roomNumber ?? '';
      if (data.mode === 'UNCHANGED') {
        toastSuccess('Rezervasyon zaten bu odada');
      } else if (data.mode === 'IN_HOUSE_MOVED') {
        toastSuccess(
          `Misafir ${data.previousRoomNumber} → ${roomNumber} odasına taşındı. ${data.previousRoomNumber} numaralı oda kirli olarak işaretlendi.`,
        );
      } else if (data.mode === 'MOVED') {
        toastSuccess(`Rezervasyon ${data.previousRoomNumber} → ${roomNumber} odasına taşındı`);
      } else {
        toastSuccess(`${roomNumber} numaralı oda atandı`);
      }
      setPendingMove(null);
      setMoveTarget(null);
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const unassignMutation = useMutation({
    mutationFn: (reservationId) => apiDelete(`/plan/reservations/${reservationId}/room`),
    onSuccess: () => {
      toastSuccess('Oda ataması kaldırıldı');
      setUnassignTarget(null);
      setDetailId(null);
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const autoAssignMutation = useMutation({
    mutationFn: (reservationId) => apiPost(`/rooms/assignments/${reservationId}/auto`, {}),
    onSuccess: (data) => {
      if (data.assigned) toastSuccess(`${data.room.number} numaralı oda atandı`);
      else toastError(data.reason ?? 'Uygun oda bulunamadı');
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const startDrag = (payload) => {
    draggingRef.current = payload;
    setDragging(payload);
  };

  const endDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setDropTargetId(null);
  };

  /** Sürüklenen kaydı bir odanın satırına bırakma. */
  const handleDrop = (room) => {
    const payload = draggingRef.current;
    endDrag();
    if (!payload || payload.roomId === room.id) return;

    // Ekrandaki veriyle görülebilen çakışmayı sunucuya sormadan söylüyoruz:
    // kullanıcı "neden olmadı" cevabını bir tık beklemeden almalı. Görünmeyen
    // engelleri (kapasite, overbooking, pencere dışı konaklama) sunucu söyler.
    const conflict = conflictOnRow(room, payload, payload.reservationId);
    if (conflict) {
      toastError(
        conflict.kind === 'BLOCK'
          ? `${room.number} numaralı odada bu tarihlerde arıza kaydı var: ${conflict.label}`
          : `${room.number} numaralı oda bu tarihlerde dolu: ${conflict.label}`,
      );
      return;
    }

    // İçerideki misafirin taşınması fiziksel bir iş; kazara sürüklemeyi onaya bağlıyoruz.
    if (payload.status === 'CHECKED_IN') {
      setPendingMove({ ...payload, room });
      return;
    }
    changeRoomMutation.mutate({ reservationId: payload.reservationId, roomId: room.id });
  };

  const setFilter = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };

  const data = planQuery.data;
  const meta = data?.meta;
  const filtersActive = Object.values(filters).some((value) => value !== ALL);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Oda planı"
        description="Tüm odalar ve rezervasyonlar tek takvimde; sürükleyerek oda değiştirin."
      />

      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Başlangıç"
            name="from"
            type="date"
            value={from ?? ''}
            onChange={(event) => {
              if (event.target.value) {
                setPinnedFrom(event.target.value);
                setPage(1);
              }
            }}
            className="w-full sm:w-44"
          />
          <Select
            label="Gün"
            name="days"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            options={PLAN_WINDOW_OPTIONS.map((value) => ({ value: String(value), label: `${value} gün` }))}
            className="w-28"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="chevronLeft" onClick={() => setPinnedFrom(addDays(from, -days))}>
              Geri
            </Button>
            <Button variant="secondary" onClick={() => setPinnedFrom(null)}>
              Bugün
            </Button>
            <Button variant="outline" onClick={() => setPinnedFrom(addDays(from, days))}>
              İleri
              <Icon name="chevronRight" className="size-4 shrink-0" />
            </Button>
          </div>

          <span className="ml-auto flex items-center gap-2">
            {planQuery.isFetching && <Spinner className="size-4" />}
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Input
            label="Oda ara"
            name="search"
            type="search"
            placeholder="Oda numarası…"
            value={filters.search}
            onChange={setFilter('search')}
            className="w-full sm:w-44"
          />
          <Select
            label="Oda tipi"
            name="roomTypeId"
            value={filters.roomTypeId}
            onChange={setFilter('roomTypeId')}
            options={[{ value: ALL, label: 'Tüm tipler' }, ...roomTypeOptions]}
            className="w-full sm:w-52"
          />
          <Input
            label="Kat"
            name="floor"
            type="number"
            placeholder="Tümü"
            value={filters.floor}
            onChange={setFilter('floor')}
            className="w-24"
          />
          <Select
            label="Doluluk"
            name="occupancy"
            value={filters.occupancy}
            onChange={setFilter('occupancy')}
            options={OCCUPANCY_OPTIONS}
            className="w-full sm:w-40"
          />
          <Select
            label="Kat hizmeti"
            name="housekeepingStatus"
            value={filters.housekeepingStatus}
            onChange={setFilter('housekeepingStatus')}
            options={HOUSEKEEPING_OPTIONS}
            className="w-full sm:w-44"
          />
          <Select
            label="Arıza"
            name="condition"
            value={filters.condition}
            onChange={setFilter('condition')}
            options={CONDITION_OPTIONS}
            className="w-full sm:w-40"
          />
          {filtersActive && (
            <Button
              variant="ghost"
              icon="close"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Filtreleri temizle
            </Button>
          )}
        </div>
      </div>

      <UnassignedStrip
        data={unassignedQuery.data}
        canOperate={canOperate}
        draggingId={dragging?.roomId === null ? dragging.reservationId : null}
        onDragStart={startDrag}
        onDragEnd={endDrag}
        onSelect={setDetailId}
        onAutoAssign={(id) => autoAssignMutation.mutate(id)}
        isAssigning={autoAssignMutation.isPending}
      />

      {planQuery.isPending && (
        <Card>
          <Spinner label="Oda planı hazırlanıyor…" className="py-10" />
        </Card>
      )}

      {planQuery.isError && (
        <Alert
          tone="danger"
          title="Oda planı yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => planQuery.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {planQuery.error.message}
        </Alert>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <EmptyState
            icon="bed"
            title={filtersActive ? 'Filtreye uyan oda yok' : 'Henüz oda tanımlanmamış'}
            description={
              filtersActive
                ? 'Filtreleri temizleyip tekrar deneyin.'
                : 'Ayarlar → Oda tipleri ve Odalar → Oda listesi bölümünden oda ekleyin.'
            }
          />
        </Card>
      )}

      {data && data.items.length > 0 && (
        <>
          <PlanGrid
            window={data.window}
            summary={data.summary}
            rooms={data.items}
            canOperate={canOperate}
            dragging={dragging}
            dropTargetId={dropTargetId}
            onDragStartReservation={startDrag}
            onDragEnd={endDrag}
            onHoverRoom={setDropTargetId}
            onDropOnRoom={handleDrop}
            onSelectReservation={setDetailId}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <Legend />
            {meta && meta.totalPages > 1 && (
              <nav aria-label="Oda sayfaları" className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-muted">
                  {meta.total} odadan {data.items.length} tanesi
                </span>
                <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Önceki
                </Button>
                <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
                  {meta.page} / {meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Sonraki
                  <Icon name="chevronRight" className="size-3.5" />
                </Button>
              </nav>
            )}
          </div>
        </>
      )}

      {detailId && (
        <ReservationDrawer
          key={detailId}
          reservationId={detailId}
          canOperate={canOperate}
          onClose={() => setDetailId(null)}
          // Aynı anda tek diyalog: iki üst üste modal odak tuzağını ve arka
          // plan kaydırma kilidini birbirine karıştırıyor.
          onChangeRoom={(detail) => {
            setDetailId(null);
            setMoveTarget(detail);
          }}
          onUnassign={(detail) => {
            setDetailId(null);
            setUnassignTarget(detail);
          }}
        />
      )}

      {moveTarget && (
        <MoveRoomDialog
          key={moveTarget.id}
          reservation={moveTarget}
          isMoving={changeRoomMutation.isPending}
          onClose={() => setMoveTarget(null)}
          // Buradan gelen seçim bilinçli: pencere zaten "misafir odada, eski oda
          // kirliye düşecek" uyarısını gösteriyor. Ayrıca onay sormak, üst üste
          // iki diyalog ve gereksiz bir tık demek — onay yalnızca kazara
          // olabilecek sürükle-bırakta isteniyor.
          onPick={(room) => changeRoomMutation.mutate({ reservationId: moveTarget.id, roomId: room.id })}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingMove)}
        title="İçerideki misafir taşınacak"
        confirmLabel="Taşı"
        confirmVariant="primary"
        confirmIcon="key"
        message={
          pendingMove
            ? `${pendingMove.guestName ?? 'Misafir'} ${pendingMove.roomNumber} numaralı odadan ${pendingMove.room.number} numaralı odaya taşınacak. ` +
              `${pendingMove.roomNumber} numaralı oda boş ve kirli olarak işaretlenecek, ${pendingMove.room.number} dolu sayılacak.`
            : ''
        }
        isPending={changeRoomMutation.isPending}
        error={changeRoomMutation.error}
        onClose={() => {
          setPendingMove(null);
          changeRoomMutation.reset();
        }}
        onConfirm={() => changeRoomMutation.mutate({ reservationId: pendingMove.reservationId, roomId: pendingMove.room.id })}
      />

      <ConfirmDialog
        open={Boolean(unassignTarget)}
        title="Oda ataması kaldırılsın mı?"
        confirmLabel="Kaldır"
        confirmIcon="close"
        message={
          unassignTarget
            ? `${unassignTarget.room?.number} numaralı odanın ataması kaldırılacak; rezervasyon "oda bekleyenler" şeridine düşecek.`
            : ''
        }
        isPending={unassignMutation.isPending}
        error={unassignMutation.error}
        onClose={() => {
          setUnassignTarget(null);
          unassignMutation.reset();
        }}
        onConfirm={() => unassignMutation.mutate(unassignTarget.id)}
      />
    </div>
  );
}

/** Izgaranın okunması için gereken tek açıklama — renkler tek kaynaktan. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-ink-soft">
      {Object.entries(RESERVATION_TONES).map(([key, tone]) => (
        <span key={key} className="flex items-center gap-2" title={tone.hint}>
          <span aria-hidden="true" className={`inline-block size-3.5 rounded-[5px] ${tone.swatch}`} />
          {tone.label}
        </span>
      ))}
      {Object.entries(BLOCK_TONES).map(([key, tone]) => (
        <span key={key} className="flex items-center gap-2" title={tone.hint}>
          <span aria-hidden="true" className={`inline-block size-3.5 rounded-[5px] ${tone.swatch}`} />
          {tone.label}
        </span>
      ))}
      <span className="font-medium text-ink-muted">
        Satır başındaki iki nokta: doluluk ve kat hizmeti. Bir sütun bir gecedir; çıkış günü boyanmaz.
      </span>
    </div>
  );
}
