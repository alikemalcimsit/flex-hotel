import { RESERVATION_STATUS_LABELS, ROOM_BLOCK_TYPE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Oda planının görsel dili — ızgara, lejant ve çekmece aynı kaynaktan beslenir.
 *
 * Renk asla tek başına anlam taşımaz: her barın metni (misafir adı), erişilebilir
 * adı (durum dahil) ve her lejant girdisinin adı var; bekleyen rezervasyon
 * ayrıca kesikli çerçeveyle, arıza kaydı uyarı simgesiyle ayrılır.
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

/** İki aralık (yarı açık) çakışıyor mu — sürükleme ipucu için. */
export function overlaps(a, b) {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

/**
 * Sürüklenen konaklamanın hangi geceleri yeni odada geçecek?
 *
 * İçerideki misafir için bugünden itibaren: geçmiş geceler zaten eski odada
 * geçti (sunucu da böyle bakar). Diğerleri için konaklamanın tamamı.
 *
 * @param {{ checkIn: string, checkOut: string, status: string }} stay
 * @param {string} today otelin iş günü
 */
export function remainingStay(stay, today) {
  const from = stay.status === 'CHECKED_IN' && stay.checkIn < today ? today : stay.checkIn;
  return { checkIn: from, checkOut: stay.checkOut };
}

/**
 * Bir odanın satırında, verilen konaklamayla çakışan ne var?
 *
 * Yalnızca **ekrandaki pencereden** bakar, yani eksik bilgiyle çalışır. Bu
 * yüzden "çakışma yok" bir garanti değil; "çakışma var" ise kesindir —
 * kullanıcıyı sunucuya gidip hata almaktan kurtarır ve nedenini hemen söyler.
 * Çıkış yapmış konaklamalar odayı tutmaz (sunucu da saymaz).
 *
 * @param {{ reservations: Array<object>, blocks: Array<object> }} room
 * @param {{ checkIn: string, checkOut: string }} stay kalan geceler (bkz. `remainingStay`)
 * @param {string} [reservationId] kaydın kendisi engel sayılmaz
 * @returns {{ kind: 'RESERVATION' | 'BLOCK', label: string } | null}
 */
export function conflictOnRow(room, stay, reservationId) {
  const bar = room.reservations.find(
    (entry) =>
      entry.id !== reservationId &&
      entry.status !== 'CHECKED_OUT' &&
      // Bar bu odada yalnızca kendi diliminin gecelerini tutar (oda değiştirmiş konaklama).
      overlaps({ checkIn: entry.sliceFrom, checkOut: entry.sliceTo }, stay),
  );
  if (bar) return { kind: 'RESERVATION', label: bar.guestName ?? bar.confirmationCode };

  const block = room.blocks.find((entry) =>
    // Süresiz kayıt: bitişi olmayan aralık her zaman çakışır.
    overlaps({ checkIn: entry.startDate, checkOut: entry.endDate ?? '9999-12-31' }, stay),
  );
  if (block) return { kind: 'BLOCK', label: block.reason };

  return null;
}
