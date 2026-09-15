import { RESERVATION_STATUS_LABELS, ROOM_BLOCK_TYPE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Oda planının görsel dili — ızgara, lejant ve çekmece aynı kaynaktan beslenir.
 *
 * Renk asla tek başına anlam taşımaz: her barın metni (misafir adı + durum),
 * her lejant girdisinin adı var. Renk körlüğü ve siyah-beyaz çıktı için
 * `pattern` alanı ayrıca desen (çizgili zemin) veriyor.
 *
 * Ton seçimi operasyonel: içerideki misafir (yeşil) ile bekleyen (kesikli
 * çerçeve) bir bakışta ayrılmalı, çünkü ikisi farklı iş demek — biri odada,
 * diğeri gelmeyebilir.
 */

export const RESERVATION_TONES = Object.freeze({
  PENDING: {
    bar: 'border border-dashed border-warning/70 bg-warning-soft text-warning-ink',
    swatch: 'border border-dashed border-warning/70 bg-warning-soft',
    label: RESERVATION_STATUS_LABELS.PENDING,
    hint: 'Onay bekliyor — gelmeyebilir',
  },
  CONFIRMED: {
    bar: 'bg-ink text-white',
    swatch: 'bg-ink',
    label: RESERVATION_STATUS_LABELS.CONFIRMED,
    hint: 'Onaylı, henüz gelmedi',
  },
  CHECKED_IN: {
    bar: 'bg-success text-white',
    swatch: 'bg-success',
    label: RESERVATION_STATUS_LABELS.CHECKED_IN,
    hint: 'Misafir odada',
  },
  CHECKED_OUT: {
    bar: 'bg-black/[0.06] text-ink-muted',
    swatch: 'bg-black/[0.06]',
    label: RESERVATION_STATUS_LABELS.CHECKED_OUT,
    hint: 'Çıkış yapıldı',
  },
});

export const BLOCK_TONES = Object.freeze({
  OUT_OF_ORDER: {
    bar: 'bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger-line',
    swatch: 'bg-danger-soft ring-1 ring-inset ring-danger-line',
    label: ROOM_BLOCK_TYPE_LABELS.OUT_OF_ORDER,
    hint: 'Satıştan düşer',
  },
  OUT_OF_SERVICE: {
    bar: 'bg-black/[0.05] text-ink-soft ring-1 ring-inset ring-line-strong',
    swatch: 'bg-black/[0.05] ring-1 ring-inset ring-line-strong',
    label: ROOM_BLOCK_TYPE_LABELS.OUT_OF_SERVICE,
    hint: 'Satılabilir ama misafire verilemez',
  },
});

/** Sürüklenen rezervasyonun bırakılabileceği satırın çerçevesi. */
export const DROP_TONES = Object.freeze({
  valid: 'ring-2 ring-inset ring-success/70 bg-success-soft/60',
  invalid: 'ring-2 ring-inset ring-danger/50 bg-danger-soft/50',
});

/** Doluluk yüzdesinin rengi: %90 üstü kırmızı değil — dolu otel iyi haberdir. */
export function occupancyTone(pct) {
  if (pct >= 95) return 'text-danger-ink';
  if (pct >= 80) return 'text-warning-ink';
  return 'text-ink-soft';
}

const weekdayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' });
const dayMonthFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/**
 * Izgara başlığındaki gün etiketi. Gün hassasiyetli metinler saat dilimi
 * taşımaz; UTC ile basılmazsa UTC'nin gerisindeki bölgede bir gün kayar.
 * @param {string} isoDay
 */
export function dayLabel(isoDay) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  return {
    weekday: weekdayFormatter.format(date),
    dayMonth: dayMonthFormatter.format(date),
    isWeekend: [0, 6].includes(date.getUTCDay()),
  };
}

/** `YYYY-MM-DD` üzerinde gün aritmetiği (takvim günü, saat dilimi yok). */
export function addDays(isoDay, days) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Bir konaklamanın penceredeki yeri — sunucudaki `placeInWindow`'un tarayıcı
 * eşi. Yalnızca **ipucu** için kullanılır (sürüklerken hangi satır uygun
 * görünüyor); kararı her zaman sunucu verir.
 *
 * @param {{ checkIn: string, checkOut: string }} stay
 * @param {string[]} dates pencere günleri
 * @returns {{ startIndex: number, span: number } | null}
 */
export function placeStay(stay, dates) {
  if (dates.length === 0) return null;
  const windowStart = dates[0];
  const windowEnd = addDays(dates[dates.length - 1], 1);

  const start = stay.checkIn > windowStart ? stay.checkIn : windowStart;
  const end = stay.checkOut < windowEnd ? stay.checkOut : windowEnd;
  if (end <= start) return null;

  const dayMs = 86_400_000;
  const toTime = (day) => new Date(`${day}T00:00:00.000Z`).getTime();
  return {
    startIndex: Math.round((toTime(start) - toTime(windowStart)) / dayMs),
    span: Math.max(1, Math.round((toTime(end) - toTime(start)) / dayMs)),
  };
}

/** İki aralık (yarı açık) çakışıyor mu — sürükleme ipucu için. */
export function overlaps(a, b) {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

/**
 * Bir odanın satırında, verilen konaklamayla çakışan ne var?
 *
 * Yalnızca **ekrandaki pencereden** bakar, yani eksik bilgiyle çalışır: bar
 * pencerenin dışına taşan bir konaklamaya ait olabilir. Bu yüzden "çakışma yok"
 * bir garanti değil, "çakışma var" ise kesindir — kullanıcıyı sunucuya gidip
 * hata almaktan kurtarır ve nedenini hemen söyler.
 *
 * @param {{ reservations: Array<object>, blocks: Array<object> }} room
 * @param {{ checkIn: string, checkOut: string }} stay
 * @param {string} [reservationId] kaydın kendisi engel sayılmaz
 * @returns {{ kind: 'RESERVATION' | 'BLOCK', label: string } | null}
 */
export function conflictOnRow(room, stay, reservationId) {
  const bar = room.reservations.find((entry) => entry.id !== reservationId && overlaps(entry, stay));
  if (bar) return { kind: 'RESERVATION', label: bar.guestName ?? bar.confirmationCode };

  const block = room.blocks.find((entry) =>
    // Süresiz kayıt: bitişi olmayan aralık her zaman çakışır.
    overlaps({ checkIn: entry.startDate, checkOut: entry.endDate ?? '9999-12-31' }, stay),
  );
  if (block) return { kind: 'BLOCK', label: block.reason };

  return null;
}
