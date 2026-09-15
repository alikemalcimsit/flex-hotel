import { HOUSEKEEPING_STATUS_LABELS, ROOM_OCCUPANCY_LABELS } from '@hotelos/hotel-contracts';
import { Icon } from '@hotelos/ui';
import { BLOCK_TONES, DROP_TONES, RESERVATION_TONES, conflictOnRow, dayLabel, occupancyTone } from './planTheme.js';

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
 * ### Sürükle-bırak bir kısayol, tek yol değil
 *
 * Dokunmatik ekranda ve klavyeyle sürükleme çalışmaz; her barın kendisi bir
 * düğme — tıklayınca detay çekmecesi açılır ve oda değişikliği oradan da
 * yapılabilir. Sürüklerken gösterilen yeşil/kırmızı çerçeve yalnızca **ipucu**:
 * kararı (arıza kaydı, kapasite, overbooking) sunucu verir.
 */

/** Bir gecenin en dar hâli; altına inince yatay kaydırma başlar. */
const MIN_CELL_PX = 54;

/** Solda sabit duran oda sütununun genişliği. */
const ROOM_COLUMN_PX = 188;

/** @param {{ occupancy: string, housekeepingStatus: string }} room */
function roomStateDots(room) {
  const occupancy = ROOM_OCCUPANCY_LABELS[room.occupancy] ?? room.occupancy;
  const housekeeping = HOUSEKEEPING_STATUS_LABELS[room.housekeepingStatus] ?? room.housekeepingStatus;
  return `${occupancy} · ${housekeeping}`;
}

const HOUSEKEEPING_DOTS = Object.freeze({
  DIRTY: 'bg-warning',
  CLEANING: 'bg-sky-500',
  CLEAN: 'bg-success',
  INSPECTED: 'bg-violet-500',
});

/**
 * @param {{
 *   window: { dates: string[], today: string },
 *   summary: Array<object>,
 *   rooms: Array<object>,
 *   canOperate: boolean,
 *   dragging: { reservationId: string, checkIn: string, checkOut: string, roomId: string | null } | null,
 *   dropTargetId: string | null,
 *   onDragStartReservation: (payload: object) => void,
 *   onDragEnd: () => void,
 *   onDropOnRoom: (room: object) => void,
 *   onHoverRoom: (roomId: string | null) => void,
 *   onSelectReservation: (reservationId: string) => void,
 * }} props
 */
export function PlanGrid({
  window: planWindow,
  summary,
  rooms,
  canOperate,
  dragging,
  dropTargetId,
  onDragStartReservation,
  onDragEnd,
  onDropOnRoom,
  onHoverRoom,
  onSelectReservation,
}) {
  const { dates, today } = planWindow;
  const template = `${ROOM_COLUMN_PX}px repeat(${dates.length}, minmax(${MIN_CELL_PX}px, 1fr))`;
  const summaryByDate = new Map(summary.map((entry) => [entry.date, entry]));

  /** Sürüklenen konaklama bu odaya sığıyor gibi mi görünüyor? (yalnızca ipucu) */
  const dropHint = (room) => {
    if (!dragging) return null;
    if (dragging.roomId === room.id) return 'invalid';
    const stay = { checkIn: dragging.checkIn, checkOut: dragging.checkOut };
    return conflictOnRow(room, stay, dragging.reservationId) ? 'invalid' : 'valid';
  };

  return (
    // Kaydırma ızgaranın **kendi içinde**: başlık satırı yukarıda yapışık
    // kalsın (40 odalık sayfada 20. satırdayken hangi gündeyiz sorusu).
    <div className="max-h-[68vh] overflow-auto rounded-card bg-surface shadow-card">
      <div className="min-w-max">
        {/* ── Başlık: günler ve günlük özet ── */}
        <div className="sticky top-0 z-30 border-b border-line bg-surface-muted" style={{ display: 'grid', gridTemplateColumns: template }}>
          <div className="sticky left-0 z-10 border-r border-line bg-surface-muted px-4 py-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
            Oda
          </div>
          {dates.map((date) => {
            const label = dayLabel(date);
            const stats = summaryByDate.get(date);
            const isToday = date === today;
            return (
              <div
                key={date}
                aria-current={isToday ? 'date' : undefined}
                title={
                  stats
                    ? `${label.dayMonth}: ${stats.arrivals} giriş, ${stats.departures} çıkış, ${stats.stayovers} konaklayan · ` +
                      `${stats.free} boş, ${stats.unassigned} oda bekleyen · arızalı ${stats.outOfOrder}, hizmet dışı ${stats.outOfService} · ` +
                      `doluluk %${stats.occupancyPct}`
                    : label.dayMonth
                }
                className={`border-l border-line px-1 py-1.5 text-center ${label.isWeekend ? 'bg-info-soft/60' : ''} ${
                  isToday ? 'shadow-[inset_0_-3px_0_var(--color-sec)]' : ''
                }`}
              >
                <div className={`text-[0.7rem] font-bold capitalize ${isToday ? 'text-sec-strong' : 'text-ink-muted'}`}>
                  {isToday ? 'Bugün' : label.weekday}
                </div>
                <div className="text-xs font-semibold tabular-nums text-ink">{label.dayMonth}</div>
                {stats && (
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[0.65rem] font-bold tabular-nums leading-none">
                    <span className="text-success-ink">↓{stats.arrivals}</span>
                    <span className="text-ink-muted">↑{stats.departures}</span>
                  </div>
                )}
                {stats && (
                  <div className={`text-[0.65rem] font-bold tabular-nums ${occupancyTone(stats.occupancyPct)}`}>
                    %{stats.occupancyPct}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Oda satırları ── */}
        {rooms.map((room) => {
          const hint = dropHint(room);
          const isTarget = dropTargetId === room.id;
          return (
            <div
              key={room.id}
              style={{ display: 'grid', gridTemplateColumns: template }}
              // Sürükleme sırasında dolu satırlar soluklaşır (nereye
              // bırakabileceğim bir bakışta görünsün), üzerine gelinen satır
              // yeşil/kırmızı çerçeve alır.
              className={`border-b border-line/70 transition-colors duration-150 ${
                isTarget && hint ? DROP_TONES[hint] : ''
              } ${dragging && !isTarget && hint === 'invalid' ? 'opacity-50' : ''}`}
              onDragOver={(event) => {
                if (!canOperate) return;
                // preventDefault olmadan tarayıcı "bırakılamaz" der.
                event.preventDefault();
                onHoverRoom(room.id);
              }}
              onDragLeave={() => onHoverRoom(null)}
              onDrop={(event) => {
                if (!canOperate) return;
                event.preventDefault();
                // Sürüklenen kaydın ne olduğuna ebeveyn karar verir (ref'ten
                // okur): bu kapanış, sürükleme başladığı anda çizilmiş olabilir.
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
                  <div className="flex items-center gap-1.5 text-[0.7rem] text-ink-muted" title={roomStateDots(room)}>
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${room.occupancy === 'OCCUPIED' ? 'bg-info' : 'bg-ink-muted/40'}`}
                    />
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${HOUSEKEEPING_DOTS[room.housekeepingStatus] ?? 'bg-ink-muted/40'}`}
                    />
                    <span className="truncate">{room.floor}. kat</span>
                  </div>
                </div>
              </div>

              {/* Zemin hücreleri: hafta sonu tonu, bugün çizgisi, boş satırda bırakma alanı */}
              {dates.map((date, index) => (
                <div
                  key={date}
                  style={{ gridColumn: index + 2, gridRow: 1 }}
                  className={`h-12 border-l border-line/60 ${dayLabel(date).isWeekend ? 'bg-info-soft/30' : ''} ${
                    date === today ? 'shadow-[inset_2px_0_0_var(--color-sec)]' : ''
                  }`}
                />
              ))}

              {/* Arıza kayıtları rezervasyonların altında kalır: oda kapalıyken
                  de o gecelerde eski bir konaklama görünebilir. */}
              {room.blocks.map((block) => (
                <div
                  key={block.id}
                  style={{ gridColumn: `${block.startIndex + 2} / span ${block.span}`, gridRow: 1 }}
                  className={`z-10 m-1 flex items-center gap-1 self-center overflow-hidden rounded-item px-2 py-1 text-[0.7rem] font-semibold ${
                    BLOCK_TONES[block.type]?.bar ?? ''
                  }`}
                  title={`${BLOCK_TONES[block.type]?.label}: ${block.reason}`}
                >
                  <Icon name="alertTriangle" className="size-3 shrink-0" />
                  <span className="truncate">{block.reason}</span>
                </div>
              ))}

              {room.reservations.map((bar) => (
                <ReservationBar
                  key={bar.id}
                  bar={bar}
                  room={room}
                  canOperate={canOperate}
                  isDragging={dragging?.reservationId === bar.id}
                  onDragStart={onDragStartReservation}
                  onDragEnd={onDragEnd}
                  onSelect={onSelectReservation}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Taşınabilir durumlar: çıkış yapmış konaklama artık hareket ettirilemez. */
const MOVABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

function ReservationBar({ bar, room, canOperate, isDragging, onDragStart, onDragEnd, onSelect }) {
  const tone = RESERVATION_TONES[bar.status] ?? RESERVATION_TONES.CONFIRMED;
  const draggable = canOperate && MOVABLE_STATUSES.has(bar.status);
  const summary =
    `${bar.guestName ?? 'Misafir'} · ${bar.confirmationCode} · ${tone.label} · ` +
    `${bar.checkIn} → ${bar.checkOut} (${bar.nights} gece) · ${bar.adults} yetişkin` +
    `${bar.children > 0 ? ` + ${bar.children} çocuk` : ''}` +
    `${bar.typeMismatch ? ` · misafirin tipi ${bar.roomTypeCode}, oda ${room.roomTypeCode}` : ''}`;

  return (
    // Bilerek `div role="button"`: tarayıcılar `<button>` üzerinden HTML5
    // sürüklemeyi güvenilir biçimde başlatmıyor (Chrome'da sürükleme sessizce
    // hiç başlamıyor). Klavye ve ekran okuyucu davranışı elle korunuyor:
    // odaklanabilir, Enter/Space ile açılır, adı `aria-label`da.
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
      aria-label={summary}
      className={`z-20 m-1 flex h-8 items-center gap-1 self-center overflow-hidden rounded-item px-2 text-left text-xs font-semibold shadow-soft transition-all duration-150 hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec ${
        tone.bar
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${isDragging ? 'opacity-40' : ''}`}
    >
      {bar.continuesBefore && <span aria-hidden="true">‹</span>}
      <span className="truncate">{bar.guestName ?? bar.confirmationCode}</span>
      {bar.typeMismatch && (
        <span aria-hidden="true" title="Misafirin oda tipi farklı" className="shrink-0 opacity-80">
          ⇄
        </span>
      )}
      {bar.continuesAfter && <span aria-hidden="true" className="ml-auto">›</span>}
    </div>
  );
}
