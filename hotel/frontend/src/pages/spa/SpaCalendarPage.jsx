import { useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Button, EmptyState, Icon, Input, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { api, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { SPA_BLOCK_CLASSES, appointmentPath, dayLabel, minuteLabel, sessionPath, shiftDay, spaKeys } from '../../lib/spa.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { AppointmentFormDialog } from './AppointmentFormDialog.jsx';

/** Canlı bağlantı yokken takvimin kendiliğinden tazelenme aralığı. */
const OFFLINE_REFRESH_MS = 60_000;
/** Dakika başına piksel (60 dk = 84 px: bir saatlik blokta üç satır okunur). */
const PX = 1.4;
const VIEWS = Object.freeze([
  { value: 'THERAPIST', label: 'Terapist' },
  { value: 'ROOM', label: 'Oda' },
]);
/** Kaynağı olmayan kayıtların (terapistsiz hamam, odasız PT) sütunu. */
const UNASSIGNED = 'unassigned';

/**
 * Çakışan kayıtları yan yana şeritlere dizer (yalnız "atanmamış" sütununda olur; terapist ve oda sütununda çakışma
 * veritabanı kısıtıyla imkânsızdır).
 * @param {any[]} items @returns {Array<{ item: any, lane: number, lanes: number }>}
 */
function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute);
  /** @type {number[]} */
  const ends = [];
  const placed = sorted.map((item) => {
    let lane = ends.findIndex((end) => end <= item.startMinute);
    if (lane < 0) lane = ends.length;
    ends[lane] = Math.max(item.busyMinute, item.endMinute);
    return { item, lane };
  });
  return placed.map((entry) => ({ ...entry, lanes: ends.length }));
}

/**
 * Günün takvimi (modül 57): sütunlar terapistler (ya da odalar), satırlar saat. Randevu mavi, tamamlanan yeşil, grup
 * dersi mor; temizlik arası bloğun altında soluk şerit; terapistin çalışmadığı saatler ve bloklar (izin, bakım) taralı.
 * Boş bir yere tıklamak o terapist ve saatle yeni randevu penceresini açar.
 */
export function SpaCalendarPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const can = useCan();
  const canBook = can(PERMISSIONS.SPA_BOOK);
  const { today } = useHotelToday();
  const [params, setParams] = useSearchParams();
  const day = params.get('gun') ?? today;
  const view = params.get('gorunum') === 'oda' ? 'ROOM' : 'THERAPIST';
  const set = (key, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const [form, setForm] = useState(null);

  const calendar = useQuery({
    queryKey: spaKeys.calendar(day),
    queryFn: () => api(withQuery('/spa/calendar', { day })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const setup = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup'), enabled: canBook });
  const data = calendar.data;

  const grid = useMemo(() => {
    if (!data) return null;
    const starts = [data.openMinute, ...data.items.map((item) => item.startMinute), ...data.blocks.map((block) => block.startMinute)];
    const ends = [data.closeMinute, ...data.items.map((item) => Math.max(item.busyMinute, item.endMinute))];
    const from = Math.max(0, Math.floor(Math.min(...starts) / 60) * 60);
    const to = Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60);
    const byTherapist = view === 'THERAPIST';
    const resources = (byTherapist ? data.therapists : data.rooms).filter(
      (resource) => resource.isActive || data.items.some((item) => (byTherapist ? item.therapistIds.includes(resource.id) : item.roomId === resource.id)),
    );
    const columns = resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      hint: byTherapist ? resource.title : null,
      inactive: !resource.isActive,
      working: byTherapist ? resource.working : null,
      entries: layoutLanes(data.items.filter((item) => (byTherapist ? item.therapistIds.includes(resource.id) : item.roomId === resource.id))),
      blocks: data.blocks.filter((block) => (byTherapist ? block.therapistId === resource.id : block.roomId === resource.id)),
    }));
    const loose = data.items.filter((item) => (byTherapist ? item.therapistIds.length === 0 : !item.roomId));
    if (loose.length) columns.push({ id: UNASSIGNED, name: byTherapist ? 'Terapistsiz' : 'Odasız', hint: null, inactive: false, working: null, entries: layoutLanes(loose), blocks: [] });
    const hours = [];
    for (let minute = from; minute < to; minute += 60) hours.push(minute);
    return { from, to, columns, hours, height: (to - from) * PX };
  }, [data, view]);

  function openForm(column, event) {
    if (!canBook || !grid || day < today) return;
    const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const raw = grid.from + offset / PX;
    const minute = Math.max(data.openMinute, Math.floor(raw / data.slotMinutes) * data.slotMinutes);
    setForm({ day, time: minuteLabel(minute), therapistId: view === 'THERAPIST' && column.id !== UNASSIGNED && !column.inactive ? column.id : '' });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Gün" type="date" value={day} onChange={(event) => set('gun', event.target.value && event.target.value !== today ? event.target.value : '')} className="w-44" />
        <div className="flex gap-2 pb-0.5">
          <Button type="button" variant="outline" icon="chevronLeft" onClick={() => set('gun', shiftDay(day, -1) === today ? '' : shiftDay(day, -1))} aria-label="Önceki gün" />
          <Button type="button" variant="outline" onClick={() => set('gun', '')} disabled={day === today}>
            Bugün
          </Button>
          <Button type="button" variant="outline" icon="chevronRight" onClick={() => set('gun', shiftDay(day, 1) === today ? '' : shiftDay(day, 1))} aria-label="Sonraki gün" />
        </div>
        <div className="flex flex-col gap-1.5 pb-0.5">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Sütunlar</span>
          <ChoiceChips label="Takvim sütunları" options={VIEWS} value={view} onChange={(value) => set('gorunum', value === 'ROOM' ? 'oda' : '')} required />
        </div>
        <p className="pb-2 text-sm font-semibold text-ink">{dayLabel(day)}</p>
        {canBook && (
          <Button type="button" icon="plus" className="ml-auto" onClick={() => setForm({ day: day < today ? today : day })} disabled={!setup.data}>
            Yeni randevu
          </Button>
        )}
      </div>

      <ul className="flex flex-wrap gap-2 text-xs" aria-label="Renkler">
        <li className={`rounded-item border px-2 py-1 ${SPA_BLOCK_CLASSES.BOOKED}`}>Randevu</li>
        <li className={`rounded-item border px-2 py-1 ${SPA_BLOCK_CLASSES.COMPLETED}`}>Tamamlandı</li>
        <li className={`rounded-item border px-2 py-1 ${SPA_BLOCK_CLASSES.SESSION}`}>Grup dersi</li>
        <li className="rounded-item border border-line bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.06)_0_6px,transparent_6px_12px)] px-2 py-1 text-ink-soft">Çalışmıyor / blok</li>
      </ul>

      {calendar.isPending && <Spinner className="py-10" label="Takvim yükleniyor…" />}
      {calendar.isError && (
        <Alert tone="danger" title="Takvim yüklenemedi" action={<Button type="button" size="sm" variant="outline" icon="refresh" onClick={() => calendar.refetch()}>Tekrar dene</Button>}>
          {calendar.error.message}
        </Alert>
      )}
      {data?.truncated && <Alert tone="warning">Bu günde gösterilemeyecek kadar çok kayıt var; randevular listesinden süzerek bakın.</Alert>}
      {grid && grid.columns.length === 0 && (
        <EmptyState
          icon="users"
          title={view === 'THERAPIST' ? 'Terapist tanımlı değil' : 'Oda tanımlı değil'}
          description="Takvim için önce Tanımlar sekmesinden terapistleri (çalışma saatleriyle), odaları ve hizmetleri girin."
          action={<Link to="/spa/tanimlar" className="text-sm font-semibold text-info-ink hover:underline">Tanımlara git</Link>}
        />
      )}
      {grid && grid.columns.length > 0 && (
        <div className={`overflow-hidden rounded-card bg-surface shadow-card ${calendar.isFetching ? 'opacity-80' : ''}`}>
          <div className="overflow-x-auto">
            <div className="flex min-w-max">
              {/* Saat ekseni */}
              <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-line bg-surface">
                <div className="h-12 border-b border-line bg-surface-muted" />
                <div className="relative" style={{ height: grid.height }}>
                  {grid.hours.map((minute) => (
                    <span key={minute} className="absolute right-2 -translate-y-1/2 text-[0.7rem] tabular-nums text-ink-muted" style={{ top: (minute - grid.from) * PX }}>
                      {minute === grid.from ? '' : minuteLabel(minute)}
                    </span>
                  ))}
                </div>
              </div>
              {grid.columns.map((column) => (
                <div key={column.id} className="w-44 shrink-0 border-r border-line last:border-r-0">
                  <div className={`flex h-12 flex-col justify-center border-b border-line bg-surface-muted px-3 ${column.inactive ? 'opacity-60' : ''}`}>
                    <span className="truncate text-sm font-semibold text-ink">{column.name}</span>
                    {(column.hint || column.inactive) && <span className="truncate text-[0.7rem] text-ink-muted">{column.inactive ? 'Kullanımda değil' : column.hint}</span>}
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- klavye yolu: "Yeni randevu" düğmesi */}
                  <div className={`relative ${canBook && day >= today ? 'cursor-copy' : ''}`} style={{ height: grid.height }} onClick={(event) => event.target === event.currentTarget && openForm(column, event)}>
                    {grid.hours.map((minute) => (
                      <span key={minute} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: (minute - grid.from) * PX }} />
                    ))}
                    {/* Çalışılmayan saatler: çalışma dilimlerinin dışı */}
                    {column.working && <OffHours working={column.working} from={grid.from} to={grid.to} />}
                    {column.blocks.map((block) => (
                      <div
                        key={block.id}
                        className="pointer-events-none absolute inset-x-0 overflow-hidden border-y border-line bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.08)_0_6px,transparent_6px_12px)] px-2 py-1 text-[0.7rem] font-semibold text-ink-soft"
                        style={{ top: (Math.max(block.startMinute, grid.from) - grid.from) * PX, height: (Math.min(block.endMinute, grid.to) - Math.max(block.startMinute, grid.from)) * PX }}
                      >
                        {block.reason}
                      </div>
                    ))}
                    {data.nowMinute !== null && data.nowMinute >= grid.from && data.nowMinute <= grid.to && (
                      <span className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-sec" style={{ top: (data.nowMinute - grid.from) * PX }} />
                    )}
                    {column.entries.map(({ item, lane, lanes }) => (
                      <CalendarBlock key={item.id} item={item} from={grid.from} lane={lane} lanes={lanes} byTherapist={view === 'THERAPIST'} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {data && data.items.length === 0 && grid?.columns.length > 0 && <p className="text-sm text-ink-muted">Bu gün için randevu ya da ders yok.{canBook && day >= today ? ' Takvimde boş bir yere tıklayarak randevu açabilirsiniz.' : ''}</p>}

      {setup.data && <AppointmentFormDialog open={Boolean(form)} onClose={() => setForm(null)} setup={setup.data} initial={form ?? {}} />}
    </div>
  );
}

/** Terapistin çalışmadığı saatler (taralı). @param {{ working: Array<{ startMinute: number, endMinute: number }>, from: number, to: number }} props */
function OffHours({ working, from, to }) {
  const gaps = [];
  let cursor = from;
  for (const slice of working) {
    if (slice.startMinute > cursor) gaps.push([cursor, Math.min(slice.startMinute, to)]);
    cursor = Math.max(cursor, slice.endMinute);
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps
    .filter(([start, end]) => end > start)
    .map(([start, end]) => (
      <span
        key={start}
        className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.045)_0_6px,transparent_6px_12px)]"
        style={{ top: (start - from) * PX, height: (end - start) * PX }}
      />
    ));
}

/** @param {{ item: any, from: number, lane: number, lanes: number, byTherapist: boolean }} props */
function CalendarBlock({ item, from, lane, lanes, byTherapist }) {
  const session = item.type === 'SESSION';
  const tone = session ? SPA_BLOCK_CLASSES.SESSION : item.status === 'COMPLETED' ? SPA_BLOCK_CLASSES.COMPLETED : SPA_BLOCK_CLASSES.BOOKED;
  const duration = item.endMinute - item.startMinute;
  const buffer = Math.max(0, item.busyMinute - item.endMinute);
  const width = 100 / lanes;
  // Sütunun kaynağı zaten başlıkta; blokta diğeri yazar (terapist sütununda oda, oda sütununda terapist).
  const other = byTherapist ? item.roomName : item.therapistNames.join(', ');
  return (
    <div className="absolute z-[5] px-0.5" style={{ top: (item.startMinute - from) * PX, height: (duration + buffer) * PX, left: `${lane * width}%`, width: `${width}%` }}>
      <Link
        to={session ? sessionPath(item.id) : appointmentPath(item.id)}
        title={`${item.time} · ${item.title} · ${item.subtitle}`}
        className={`block overflow-hidden rounded-item border px-2 py-1 text-[0.72rem] leading-tight shadow-sm transition-shadow hover:shadow-md ${tone}`}
        style={{ height: Math.max(duration * PX - 2, 22) }}
      >
        <span className="flex items-center gap-1 font-bold tabular-nums">
          {item.time}
          {item.source === 'PORTAL' && <Icon name="globe" className="size-3" aria-label="Portaldan" />}
          {item.hasBalance && <Icon name="wallet" className="size-3" aria-label="Açık bakiye" />}
          {item.note && <Icon name="message" className="size-3" aria-label="Notu var" />}
        </span>
        <span className="block truncate font-semibold">
          {item.title}
          {item.roomNumber ? ` · ${item.roomNumber}` : ''}
        </span>
        {duration >= 45 && <span className="block truncate opacity-80">{item.subtitle}</span>}
        {duration >= 60 && other && <span className="block truncate opacity-70">{other}</span>}
      </Link>
      {buffer > 0 && <span className="pointer-events-none block rounded-b-item bg-black/[0.05]" style={{ height: buffer * PX }} title="Temizlik arası" />}
    </div>
  );
}
