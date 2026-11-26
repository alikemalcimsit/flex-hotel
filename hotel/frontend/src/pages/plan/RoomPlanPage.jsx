import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDaysIso } from '../../lib/reservations.js';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HOUSEKEEPING_STATUSES,
  MAX_PLAN_DAYS,
  PLAN_ROOMS_PAGE_SIZE,
  PLAN_WINDOW_OPTIONS,
  ROOM_CONDITIONS,
  ROOM_OCCUPANCIES,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveInventory } from '../../lib/useLiveInventory.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { MoveConfirmDialog } from './MoveConfirmDialog.jsx';
import { MoveRoomDialog } from './MoveRoomDialog.jsx';
import { PlanGrid } from './PlanGrid.jsx';
import { ReservationDrawer } from './ReservationDrawer.jsx';
import { UnassignedStrip } from './UnassignedStrip.jsx';
import { BLOCK_TONES, RESERVATION_TONES, addDays, conflictOnRow, remainingStay } from './planTheme.js';

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
 * ### Görünüm adres çubuğunda
 *
 * Tarih, gün sayısı, filtreler ve sayfa URL'de durur: sayfa yenilenince görünüm
 * kaybolmaz, "şu tarihe bak" diye link paylaşılabilir, tarayıcının geri tuşu
 * önceki görünüme döner. Başlangıç tarihi yalnızca kullanıcı başka bir güne
 * gittiyse yazılır; yoksa ekran otelin bugününü takip eder.
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
 * yüzden yalnızca bu durumda onay (ve sebep) isteniyor.
 */

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;

/** Arama kutusuna yazarken sunucuya gitmeden önce beklenen süre. */
const SEARCH_DEBOUNCE_MS = 300;

/** Filtre "hepsi" seçeneği — boş metin sorguya eklenmiyor (bkz. withQuery). */
const ALL = '';

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Adres çubuğunda taşınan filtreler (sunucu sorgusuyla aynı adlar). */
const FILTER_KEYS = Object.freeze(['search', 'roomTypeId', 'floor', 'occupancy', 'housekeepingStatus', 'condition']);

/**
 * Süzgeç seçenekleri: "hepsi" + sözleşmedeki değerler, etiketler etkin dilde.
 * @param {(key: string) => string} t @param {string} allLabel @param {readonly string[]} values @param {string} prefix
 */
const filterOptions = (t, allLabel, values, prefix) => [
  { value: ALL, label: allLabel },
  ...values.map((value) => ({ value, label: t(`${prefix}${value}`) })),
];

/** @param {(key: string, vars?: object) => string} t @param {number} days */
const dayOption = (t, days) => ({ value: String(days), label: t('roomPlan.plan.dayCount', { count: days }) });

/**
 * Adres çubuğundaki görünüm. Elle değiştirilmiş (geçersiz) değerler sessizce
 * varsayılana döner — sunucuya bozuk istek gitmesin.
 * @param {URLSearchParams} params
 */
function readView(params) {
  const from = params.get('from');
  const days = Number(params.get('days'));
  const page = Number(params.get('page'));
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ALL]));
  return {
    pinnedFrom: from && ISO_DAY_PATTERN.test(from) ? from : null,
    days: Number.isInteger(days) && days >= 1 && days <= MAX_PLAN_DAYS ? days : PLAN_WINDOW_OPTIONS[1],
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    filters,
  };
}

/** Oda değişikliği sonucunu kullanıcıya anlatan metin. @param {(key: string, vars?: object) => string} t */
function changeRoomMessage(t, data) {
  const roomNumber = data.reservation?.roomNumber ?? '';
  const vars = { from: data.previousRoomNumber, to: roomNumber };
  switch (data.mode) {
    case 'UNCHANGED':
      return t('roomPlan.plan.unchanged');
    case 'IN_HOUSE_MOVED':
      return t('roomPlan.plan.inHouseMoved', vars);
    case 'MOVED':
      return t('roomPlan.plan.moved', vars);
    default:
      return t('roomPlan.shared.roomAssigned', { room: roomNumber });
  }
}

export function RoomPlanPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const can = useCan();
  const canOperate = can(PERMISSIONS.ROOMS_OPERATE);
  const canCreateReservation = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const navigate = useNavigate();
  const { today } = useHotelToday();
  const { options: roomTypeOptions } = useRoomTypes();

  const [searchParams, setSearchParams] = useSearchParams();
  const view = readView(searchParams);
  const { pinnedFrom, days, page, filters } = view;
  const from = pinnedFrom ?? today;

  /** Görünümü günceller; filtre ya da pencere değişince sayfa başa döner. */
  const updateView = useCallback(
    (changes, { resetPage = true, replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === ALL) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage && !('page' in changes)) next.delete('page');
          return next;
        },
        // Yazarken her duraklama geçmişe ayrı adım olarak eklenmesin.
        { replace },
      );
    },
    [setSearchParams],
  );

  // Arama kutusu yerel: her tuşta adres ve sorgu değişmesin.
  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    if (searchText === filters.search) return undefined;
    // Kırpma sunucuda: burada kırpılırsa "ayşe " yazıp duraklayan kullanıcının
    // boşluğu silinir ve sonraki harf bitişik yazılır.
    const timer = setTimeout(() => updateView({ search: searchText }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, updateView]);

  // Sürüklenen kayıt hem state'te (ızgara onu soluklaştırsın diye) hem ref'te
  // tutuluyor: "bırak" olayı, sürüklemeyi başlatan çizimden önce gelebilir ve
  // o an state'i okuyan bir kapanış boş görür — bırakma sessizce kaybolurdu.
  const draggingRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [unassignTarget, setUnassignTarget] = useState(null);

  const { isLive } = useLiveInventory([['plan'], ['rooms']]);

  const planQuery = useQuery({
    queryKey: ['plan', 'grid', { from, days, page, ...filters }],
    queryFn: () => api(withQuery('/plan', { from, days, page, pageSize: PLAN_ROOMS_PAGE_SIZE, ...filters })),
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

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['plan'] });
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  }, [queryClient]);

  const changeRoomMutation = useMutation({
    mutationFn: ({ reservationId, roomId, reason }) =>
      apiPut(`/plan/reservations/${reservationId}/room`, { roomId, reason: reason || null }),
    onSuccess: (data) => {
      toastSuccess(changeRoomMessage(t, data));
      setPendingMove(null);
      setMoveTarget(null);
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const unassignMutation = useMutation({
    mutationFn: (reservationId) => apiDelete(`/plan/reservations/${reservationId}/room`),
    onSuccess: () => {
      toastSuccess(t('roomPlan.plan.unassigned'));
      setUnassignTarget(null);
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const autoAssignMutation = useMutation({
    mutationFn: (reservationId) => apiPost(`/rooms/assignments/${reservationId}/auto`, {}),
    onSuccess: (data) => {
      if (data.assigned) toastSuccess(t('roomPlan.shared.roomAssigned', { room: data.room.number }));
      else toastError(data.reason ?? t('roomPlan.shared.noRoomFound'));
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const startDrag = useCallback((payload) => {
    draggingRef.current = payload;
    setDragging(payload);
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
    setDropTargetId(null);
  }, []);

  const mutateChangeRoom = changeRoomMutation.mutate;

  /** Sürüklenen kaydı bir odanın satırına bırakma. */
  const handleDrop = useCallback(
    (room) => {
      const payload = draggingRef.current;
      endDrag();
      if (!payload || payload.roomId === room.id) return;

      // Ekrandaki veriyle görülebilen çakışmayı sunucuya sormadan söylüyoruz:
      // kullanıcı "neden olmadı" cevabını bir tık beklemeden almalı. Görünmeyen
      // engelleri (kapasite, overbooking, pencere dışı konaklama) sunucu söyler.
      const conflict = conflictOnRow(room, remainingStay(payload, today), payload.reservationId);
      if (conflict) {
        toastError(
          t(conflict.kind === 'BLOCK' ? 'roomPlan.plan.conflictBlock' : 'roomPlan.plan.conflictBooked', {
            room: room.number,
            label: conflict.label,
          }),
        );
        return;
      }

      // İçerideki misafirin taşınması fiziksel bir iş; kazara sürüklemeyi onaya bağlıyoruz.
      if (payload.status === 'CHECKED_IN') {
        setPendingMove({ ...payload, room });
        return;
      }
      mutateChangeRoom({ reservationId: payload.reservationId, roomId: room.id });
    },
    [endDrag, mutateChangeRoom, today, t],
  );

  const setFilter = (key) => (event) => updateView({ [key]: event.target.value });

  // Adresten elle gelen gün sayısı listede yoksa seçenek olarak eklenir; yoksa
  // açılır liste yanlış değeri gösterirdi.
  const baseDayOptions = PLAN_WINDOW_OPTIONS.map((value) => dayOption(t, value));
  const dayOptions = baseDayOptions.some((option) => option.value === String(days))
    ? baseDayOptions
    : [...baseDayOptions, dayOption(t, days)];

  const data = planQuery.data;
  const meta = data?.meta;
  const filtersActive = FILTER_KEYS.some((key) => filters[key] !== ALL);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('roomPlan.plan.title')}
        description={t('roomPlan.plan.description')}
      />

      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('roomPlan.shared.from')}
            name="from"
            type="date"
            value={from ?? ''}
            onChange={(event) => event.target.value && updateView({ from: event.target.value })}
            className="w-full sm:w-44"
          />
          <Select
            label={t('roomPlan.plan.days')}
            name="days"
            value={String(days)}
            onChange={(event) => updateView({ days: event.target.value })}
            options={dayOptions}
            className="w-28"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="chevronLeft" onClick={() => updateView({ from: addDays(from, -days) })}>
              {t('roomPlan.plan.back')}
            </Button>
            <Button variant="secondary" onClick={() => updateView({ from: null })} disabled={!pinnedFrom}>
              {t('common.today')}
            </Button>
            <Button variant="outline" onClick={() => updateView({ from: addDays(from, days) })}>
              {t('roomPlan.plan.forward')}
              <Icon name="chevronRight" className="size-4 shrink-0" />
            </Button>
          </div>

          <span className="ml-auto flex items-center gap-2" aria-live="polite">
            {planQuery.isFetching && <Spinner className="size-4" />}
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? t('common.live') : t('common.notLive')}</Badge>
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Input
            label={t('roomPlan.filter.search')}
            name="search"
            type="search"
            placeholder={t('roomPlan.plan.searchPlaceholder')}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            label={t('roomPlan.filter.roomType')}
            name="roomTypeId"
            value={filters.roomTypeId}
            onChange={setFilter('roomTypeId')}
            options={[{ value: ALL, label: t('roomPlan.filter.allTypes') }, ...roomTypeOptions]}
            className="w-full sm:w-52"
          />
          <Input
            label={t('roomPlan.filter.floor')}
            name="floor"
            type="number"
            placeholder={t('common.all')}
            value={filters.floor}
            onChange={setFilter('floor')}
            className="w-24"
          />
          <Select
            label={t('roomPlan.filter.occupancy')}
            name="occupancy"
            value={filters.occupancy}
            onChange={setFilter('occupancy')}
            options={filterOptions(t, t('roomPlan.filter.allRooms'), ROOM_OCCUPANCIES, 'roomPlan.occupancy.')}
            className="w-full sm:w-40"
          />
          <Select
            label={t('roomPlan.filter.housekeeping')}
            name="housekeepingStatus"
            value={filters.housekeepingStatus}
            onChange={setFilter('housekeepingStatus')}
            options={filterOptions(t, t('roomPlan.filter.allStatuses'), HOUSEKEEPING_STATUSES, 'roomPlan.housekeeping.')}
            className="w-full sm:w-44"
          />
          <Select
            label={t('roomPlan.filter.condition')}
            name="condition"
            value={filters.condition}
            onChange={setFilter('condition')}
            options={filterOptions(t, t('common.all'), ROOM_CONDITIONS, 'roomPlan.condition.')}
            className="w-full sm:w-40"
          />
          {filtersActive && (
            <Button
              variant="ghost"
              icon="close"
              onClick={() => {
                setSearchText(ALL);
                updateView(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
              }}
            >
              {t('roomPlan.plan.clearFilters')}
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
          <Spinner label={t('roomPlan.plan.loading')} className="py-10" />
        </Card>
      )}

      {planQuery.isError && (
        <Alert
          tone="danger"
          title={t('roomPlan.plan.loadFailed')}
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => planQuery.refetch()}>
              {t('common.retry')}
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
            title={filtersActive ? t('roomPlan.plan.emptyFiltered') : t('roomPlan.plan.emptyNoRooms')}
            description={filtersActive ? t('roomPlan.plan.emptyFilteredHint') : t('roomPlan.plan.emptyNoRoomsHint')}
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
            search={filters.search}
            onDragStartReservation={startDrag}
            onDragEnd={endDrag}
            onHoverRoom={setDropTargetId}
            onDropOnRoom={handleDrop}
            onSelectReservation={setDetailId}
            onCreateReservation={
              canCreateReservation
                ? (room, date) =>
                    navigate(
                      `/rezervasyonlar/yeni?oda=${room.id}&tip=${room.roomTypeId}&giris=${date}&cikis=${addDaysIso(date, 1)}`,
                    )
                : undefined
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <Legend />
            {meta && meta.totalPages > 1 && (
              <nav aria-label={t('roomPlan.plan.pages')} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-muted">
                  {t('roomPlan.plan.pageSummary', { total: meta.total, shown: data.items.length })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  icon="chevronLeft"
                  disabled={page <= 1}
                  onClick={() => updateView({ page: page - 1 }, { resetPage: false })}
                >
                  {t('roomPlan.shared.prev')}
                </Button>
                <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
                  {meta.page} / {meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => updateView({ page: page + 1 }, { resetPage: false })}
                >
                  {t('roomPlan.shared.next')}
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
          // kirliye düşecek" uyarısını ve sebep alanını gösteriyor. Ayrıca onay
          // sormak üst üste iki diyalog demek — onay yalnızca kazara olabilecek
          // sürükle-bırakta isteniyor.
          onPick={(room, reason) => changeRoomMutation.mutate({ reservationId: moveTarget.id, roomId: room.id, reason })}
        />
      )}

      {pendingMove && (
        <MoveConfirmDialog
          key={`${pendingMove.reservationId}-${pendingMove.room.id}`}
          move={pendingMove}
          isPending={changeRoomMutation.isPending}
          error={changeRoomMutation.error}
          onClose={() => {
            setPendingMove(null);
            changeRoomMutation.reset();
          }}
          onConfirm={(reason) =>
            changeRoomMutation.mutate({ reservationId: pendingMove.reservationId, roomId: pendingMove.room.id, reason })
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(unassignTarget)}
        title={t('roomPlan.plan.unassignTitle')}
        confirmLabel={t('roomPlan.plan.unassignConfirm')}
        confirmIcon="close"
        message={
          unassignTarget ? t('roomPlan.plan.unassignMessage', { room: unassignTarget.room?.number }) : ''
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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-ink-soft">
      {Object.entries(RESERVATION_TONES).map(([key, tone]) => (
        <span key={key} className="flex items-center gap-2" title={t(tone.hintKey)}>
          <span aria-hidden="true" className={`inline-block size-3.5 rounded-[5px] ${tone.swatch}`} />
          {t(tone.labelKey)}
        </span>
      ))}
      {Object.entries(BLOCK_TONES).map(([key, tone]) => (
        <span key={key} className="flex items-center gap-2" title={t(tone.hintKey)}>
          <span aria-hidden="true" className={`inline-block size-3.5 rounded-[5px] ${tone.swatch}`} />
          {t(tone.labelKey)}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true">↳ / →</span> {t('roomPlan.plan.legendMoved')}
      </span>
      <span className="font-medium text-ink-muted">
        {t('roomPlan.plan.legendHint')}
      </span>
    </div>
  );
}
