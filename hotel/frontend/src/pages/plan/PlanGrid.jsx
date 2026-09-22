import { memo, useMemo } from 'react';
import { HOUSEKEEPING_STATUS_LABELS, ROOM_OCCUPANCY_LABELS } from '@hotelos/hotel-contracts';
import { Icon } from '@hotelos/ui';
import { formatDate } from '../../lib/format.js';
import {
  BLOCK_TONES,
  DROP_TONES,
  RESERVATION_TONES,
  conflictOnRow,
  dayLabel,
  occupancyTone,
  remainingStay,
} from './planTheme.js';

/**
 * Oda planı ızgarası: satır oda, sütun gece.
 *
 * ### Neden tek bir CSS grid
 *
 * Her satır, başlıkla aynı sütun şablonunu kullanan bir grid. Barlar
 * `grid-column: start / span n` ile yerleşir; böylece piksel hesabı yok,
 * sütun genişliği değişince (7 gün ↔ 45 gün) barlar kendiliğinden oturur.
 * Zemin hücreleri, arıza barları ve rezervasyon barları aynı satırda üst üste
 * durur — DOM sırası katmanları belirler.
 *
 * ### Çıkış günü boyanmaz
 *
 * Bir sütun bir **gece**dir. 15-18 rezervasyonu üç sütun kaplar (15, 16, 17);
 * 18 sütunu boştur, çünkü o sabah oda boşalır ve aynı gün tekrar satılabilir.
 *
 * ### Büyük otelde akıcılık
 *
 * 100 oda × 45 gün 4500 hücre demek. Satırlar `memo` ile sarılı: sürükleme
 * sırasında yalnızca ipucu değişen satırlar yeniden çizilir. Satır sınırında
 * `dragleave` iç öğeler arasında geçerken de tetiklenir; hedefin gerçekten
 * satırdan çıkıp çıkmadığına bakılır, yoksa satır yanıp söner.
 *
 * ### Sürükle-bırak bir kısayol, tek yol değil
 *
 * Dokunmatik ekranda ve klavyeyle sürükleme çalışmaz; her bar odaklanabilir ve
 * Enter ile detay çekmecesini açar, oda değişikliği oradan da yapılabilir.
 * Sürüklerken gösterilen yeşil/kırmızı çerçeve yalnızca **ipucu**: kararı
 * (arıza kaydı, kapasite, overbooking) sunucu verir.
 */

/** Bir gecenin en dar hâli; altına inince yatay kaydırma başlar. */
const MIN_CELL_PX = 54;

/** Solda sabit duran oda sütununun genişliği. */
const ROOM_COLUMN_PX = 188;

/** Taşınabilir durumlar: çıkış yapmış konaklama artık hareket ettirilemez. */
const MOVABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

const HOUSEKEEPING_DOTS = Object.freeze({
  DIRTY: 'bg-warning',
  CLEANING: 'bg-sky-500',
  CLEAN: 'bg-success',
  INSPECTED: 'bg-violet-500',
});

/** @param {{ occupancy: string, housekeepingStatus: string }} room */
function roomStateLabel(room) {
  const occupancy = ROOM_OCCUPANCY_LABELS[room.occupancy] ?? room.occupancy;
  const housekeeping = HOUSEKEEPING_STATUS_LABELS[room.housekeepingStatus] ?? room.housekeepingStatus;
  return `${occupancy} · ${housekeeping}`;
}

/**
 * Arama kelimelerinin hepsi barın adında ya da onay kodunda geçiyor mu?
 * (Sunucu odayı bu kelimelerle buldu; ekran hangi barın eşleştiğini gösterir.)
 * @param {object} bar
 * @param {string[]} tokens küçük harfe çevrilmiş
 */
function barMatches(bar, tokens) {
  if (tokens.length === 0) return false;
  const haystack = `${bar.guestName ?? ''} ${bar.confirmationCode}`.toLocaleLowerCase('tr');
  return tokens.every((token) => haystack.includes(token));
}

/**
 * @param {string} date
 * @param {object | undefined} stats
 */
function summaryTitle(date, stats) {
  const { dayMonth } = dayLabel(date);
  if (!stats) return dayMonth;
  return (
    `${dayMonth} — giriş ${stats.arrivals} (${stats.arrivalsDone} yapıldı), ` +
    `çıkış ${stats.departures} (${stats.departuresDone} yapıldı), konaklayan ${stats.stayovers}\n` +
    `Satılan ${stats.sold} / satılabilir ${stats.sellable} · boş ${stats.free} · oda bekleyen ${stats.unassigned}\n` +
    `Arızalı ${stats.outOfOrder} · hizmet dışı ${stats.outOfService} · doluluk %${stats.occupancyPct}`
  );
}

/**
 * @param {{
 *   window: { dates: string[], today: string },
 *   summary: Array<object>,
 *   rooms: Array<object>,
 *   canOperate: boolean,
 *   dragging: { reservationId: string, checkIn: string, checkOut: string, status: string, roomId: string | null } | null,
 *   dropTargetId: string | null,
 *   search: string,
 *   onDragStartReservation: (payload: object) => void,
 *   onDragEnd: () => void,
 *   onDropOnRoom: (room: object) => void,
 *   onHoverRoom: (roomId: string | null) => void,
 *   onSelectReservation: (reservationId: string) => void,
 *   onCreateReservation?: (room: object, date: string) => void,
 * }} props
 *
 * `onCreateReservation` verilirse (rezervasyon açma yetkisi) bugünden itibaren
 * boş hücreler tıklanabilir: o odaya o gün girişli yeni rezervasyon formu açılır.
 */
export function PlanGrid({
  window: planWindow,
  summary,
  rooms,
  canOperate,
  dragging,
  dropTargetId,
  search,
  onDragStartReservation,
  onDragEnd,
  onDropOnRoom,
  onHoverRoom,
  onSelectReservation,
  onCreateReservation,
}) {
  const { dates, today } = planWindow;
  const template = `${ROOM_COLUMN_PX}px repeat(${dates.length}, minmax(${MIN_CELL_PX}px, 1fr))`;
  const summaryByDate = useMemo(() => new Map(summary.map((entry) => [entry.date, entry])), [summary]);
  const days = useMemo(
    () => dates.map((date) => ({ date, ...dayLabel(date), isToday: date === today, isPast: date < today })),
    [dates, today],
  );
  const tokens = useMemo(
    () =>
      (search ?? '')
        .toLocaleLowerCase('tr')
        .split(/\s+/)
        .filter(Boolean),
    [search],
  );

  // Sürüklenen konaklamanın yeni odada geçireceği geceler (içerideki misafir için bugünden).
  const stay = dragging ? remainingStay(dragging, today) : null;

  return (
    // Kaydırma ızgaranın **kendi içinde**: başlık satırı yukarıda yapışık
    // kalsın (40 odalık sayfada 20. satırdayken hangi gündeyiz sorusu).
    <div className="max-h-[68vh] overflow-auto rounded-card bg-surface shadow-card">
      <div className="min-w-max">
        {/* ── Başlık: günler ve günlük özet ── */}
        <div
          className="sticky top-0 z-30 border-b border-line bg-surface-muted"
          style={{ display: 'grid', gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-10 border-r border-line bg-surface-muted px-4 py-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
            Oda
          </div>
          {days.map((day) => {
            const stats = summaryByDate.get(day.date);
            return (
              <div
                key={day.date}
                aria-current={day.isToday ? 'date' : undefined}
                title={summaryTitle(day.date, stats)}
                className={`border-l border-line px-1 py-1.5 text-center ${day.isWeekend ? 'bg-info-soft/60' : ''} ${
                  day.isToday ? 'shadow-[inset_0_-3px_0_var(--color-sec)]' : ''
                }`}
              >
                <div className={`text-[0.7rem] font-bold capitalize ${day.isToday ? 'text-sec-strong' : 'text-ink-muted'}`}>
                  {day.isToday ? 'Bugün' : day.weekday}
                </div>
                <div className="text-xs font-semibold tabular-nums text-ink">{day.dayMonth}</div>
                {stats && (
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[0.65rem] font-bold tabular-nums leading-none">
                    <span className="text-success-ink">
                      <span aria-hidden="true">↓</span>
                      {stats.arrivals}
                      <span className="sr-only"> giriş,</span>
                    </span>
                    <span className="text-ink-muted">
                      <span aria-hidden="true">↑</span>
                      {stats.departures}
                      <span className="sr-only"> çıkış,</span>
                    </span>
                  </div>
                )}
                {stats && (
                  <div className={`text-[0.65rem] font-bold tabular-nums ${occupancyTone(stats.occupancyPct)}`}>
                    <span className="sr-only">doluluk </span>%{stats.occupancyPct}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {rooms.map((room) => {
          const hint = stay
            ? dragging.roomId === room.id || conflictOnRow(room, stay, dragging.reservationId)
              ? 'invalid'
              : 'valid'
            : null;
          return (
            <RoomRow
              key={room.id}
              room={room}
              days={days}
              template={template}
              hint={hint}
              isTarget={dropTargetId === room.id}
              canOperate={canOperate}
              draggingKey={dragging?.key ?? null}
              tokens={tokens}
              onDragStartReservation={onDragStartReservation}
              onDragEnd={onDragEnd}
              onDropOnRoom={onDropOnRoom}
              onHoverRoom={onHoverRoom}
              onSelectReservation={onSelectReservation}
              onCreateReservation={onCreateReservation}
            />
          );
        })}
      </div>
    </div>
  );
}

const RoomRow = memo(function RoomRow({
  room,
  days,
  template,
  hint,
  isTarget,
  canOperate,
  draggingKey,
  tokens,
  onDragStartReservation,
  onDragEnd,
  onDropOnRoom,
  onHoverRoom,
  onSelectReservation,
  onCreateReservation,
}) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: template }}
      // Sürükleme sırasında dolu satırlar soluklaşır (nereye bırakabileceğim
      // bir bakışta görünsün), üzerine gelinen satır yeşil/kırmızı çerçeve alır.
      className={`border-b border-line/70 transition-colors duration-150 ${isTarget && hint ? DROP_TONES[hint] : ''} ${
        hint === 'invalid' && !isTarget ? 'opacity-50' : ''
      }`}
      onDragOver={(event) => {
        if (!canOperate) return;
        // preventDefault olmadan tarayıcı "bırakılamaz" der.
        event.preventDefault();
        onHoverRoom(room.id);
      }}
      onDragLeave={(event) => {
        // İç öğeler arasında geçmek satırdan çıkmak değildir.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        onHoverRoom(null);
      }}
      onDrop={(event) => {
        if (!canOperate) return;
        event.preventDefault();
        // Sürüklenen kaydın ne olduğuna ebeveyn karar verir (ref'ten okur):
        // bu kapanış, sürükleme başladığı anda çizilmiş olabilir.
        onDropOnRoom(room);
      }}
    >
      <div className="sticky left-0 z-10 flex items-center gap-2 border-r border-line bg-surface px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold tabular-nums text-ink">{room.number}</span>
            <span className="truncate text-[0.7rem] font-semibold text-ink-muted">{room.roomTypeCode}</span>
            {room.condition !== 'IN_SERVICE' && (
              <span
                title={BLOCK_TONES[room.condition]?.label}
                className={`rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold ${
                  room.condition === 'OUT_OF_ORDER' ? 'bg-danger-soft text-danger-ink' : 'bg-black/[0.06] text-ink-soft'
                }`}
              >
                {room.condition === 'OUT_OF_ORDER' ? 'Arıza' : 'H.dışı'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[0.7rem] text-ink-muted" title={roomStateLabel(room)}>
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${room.occupancy === 'OCCUPIED' ? 'bg-info' : 'bg-ink-muted/40'}`}
            />
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${HOUSEKEEPING_DOTS[room.housekeepingStatus] ?? 'bg-ink-muted/40'}`}
            />
            <span className="truncate">{room.floor}. kat</span>
            <span className="sr-only">, {roomStateLabel(room)}</span>
          </div>
        </div>
      </div>

      {/* Zemin hücreleri: hafta sonu tonu, bugün çizgisi, boş satırda bırakma alanı */}
      {days.map((day, index) => {
        const tone = `h-12 border-l border-line/60 ${day.isWeekend ? 'bg-info-soft/30' : ''} ${
          day.isToday ? 'shadow-[inset_2px_0_0_var(--color-sec)]' : ''
        }`;
        // Rezervasyon çubukları ve arıza kayıtları hücrenin üstünde durur;
        // tıklama yalnızca gerçekten boş kalan yere düşer.
        if (!onCreateReservation || day.isPast) {
          return <div key={day.date} style={{ gridColumn: index + 2, gridRow: 1 }} className={tone} />;
        }
        return (
          <button
            key={day.date}
            type="button"
            style={{ gridColumn: index + 2, gridRow: 1 }}
            className={`${tone} cursor-cell transition-colors hover:bg-info-soft/60 focus-visible:bg-info-soft/60 focus-visible:outline-none`}
            aria-label={`${room.number} numaralı odaya ${day.date} girişli rezervasyon aç`}
            title="Bu odaya bu gün girişli rezervasyon aç"
            onClick={() => onCreateReservation(room, day.date)}
          />
        );
      })}

      {/* Arıza kayıtları rezervasyonların altında kalır. */}
      {room.blocks.map((block) => (
        <div
          key={block.id}
          style={{ gridColumn: `${block.startIndex + 2} / span ${block.span}`, gridRow: 1 }}
          className={`z-10 m-1 flex items-center gap-1 self-center overflow-hidden rounded-item px-2 py-1 text-[0.7rem] font-semibold ${
            BLOCK_TONES[block.type]?.bar ?? ''
          }`}
          title={`${BLOCK_TONES[block.type]?.label}: ${block.reason} (${formatDate(block.startDate)} → ${
            block.endDate ? formatDate(block.endDate) : 'süresiz'
          })`}
        >
          <Icon name="alertTriangle" className="size-3 shrink-0" />
          <span className="truncate">{block.reason}</span>
        </div>
      ))}

      {room.reservations.map((bar) => (
        <ReservationBar
          key={bar.key}
          bar={bar}
          room={room}
          canOperate={canOperate}
          isDragging={draggingKey === bar.key}
          isMatch={barMatches(bar, tokens)}
          onDragStart={onDragStartReservation}
          onDragEnd={onDragEnd}
          onSelect={onSelectReservation}
        />
      ))}
    </div>
  );
});

function ReservationBar({ bar, room, canOperate, isDragging, isMatch, onDragStart, onDragEnd, onSelect }) {
  const tone = RESERVATION_TONES[bar.status] ?? RESERVATION_TONES.CONFIRMED;
  // Kapanmış dilim (misafir buradan taşındı) geçmiştir; sürüklenemez.
  const draggable = canOperate && !bar.movedOut && MOVABLE_STATUSES.has(bar.status);
  const summary = [
    `${bar.guestName ?? 'Misafir'} · ${bar.confirmationCode} · ${tone.label}`,
    `${formatDate(bar.checkIn)} → ${formatDate(bar.checkOut)} (${bar.nights} gece) · ${bar.adults} yetişkin` +
      (bar.children > 0 ? ` + ${bar.children} çocuk` : ''),
    bar.movedIn ? `${formatDate(bar.sliceFrom)} gecesi bu odaya taşındı` : null,
    bar.movedOut
      ? `${formatDate(bar.sliceTo)} gecesi başka odaya taşındı${bar.moveReason ? ` (${bar.moveReason})` : ''}`
      : null,
    bar.typeMismatch ? `Misafirin oda tipi ${bar.roomTypeCode}, oda ${room.roomTypeCode}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    // Bilerek `div role="button"`: tarayıcılar `<button>` üzerinden HTML5
    // sürüklemeyi güvenilir biçimde başlatmıyor. Klavye ve ekran okuyucu
    // davranışı elle korunuyor: odaklanabilir, Enter/Space ile açılır.
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(bar.id);
      }}
      draggable={draggable}
      onDragStart={(event) => {
        // Bazı tarayıcılar veri taşımayan sürüklemeyi başlatmıyor.
        event.dataTransfer.setData('text/plain', bar.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart({
          key: bar.key,
          reservationId: bar.id,
          roomId: room.id,
          checkIn: bar.checkIn,
          checkOut: bar.checkOut,
          status: bar.status,
          guestName: bar.guestName,
          confirmationCode: bar.confirmationCode,
          roomNumber: room.number,
        });
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(bar.id)}
      style={{ gridColumn: `${bar.startIndex + 2} / span ${bar.span}`, gridRow: 1 }}
      title={summary}
      aria-label={summary.replaceAll('\n', ' · ')}
      className={`z-20 m-1 flex h-8 items-center gap-1 self-center overflow-hidden rounded-item px-2 text-left text-xs font-semibold shadow-soft transition-all duration-150 hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec ${
        tone.bar
      } ${bar.movedOut ? 'opacity-60' : ''} ${isMatch ? 'ring-2 ring-sec ring-offset-1' : ''} ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {bar.continuesBefore && <span aria-hidden="true">‹</span>}
      {bar.movedIn && (
        <span aria-hidden="true" className="shrink-0" title="Bu odaya taşındı">
          ↳
        </span>
      )}
      <span className="truncate">{bar.guestName ?? bar.confirmationCode}</span>
      {bar.typeMismatch && (
        <span aria-hidden="true" className="shrink-0 opacity-80">
          ⇄
        </span>
      )}
      {bar.movedOut && (
        <span aria-hidden="true" className="ml-auto shrink-0">
          →
        </span>
      )}
      {bar.continuesAfter && !bar.movedOut && (
        <span aria-hidden="true" className="ml-auto">
          ›
        </span>
      )}
    </div>
  );
}
