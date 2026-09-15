/**
 * Form denetimlerinin ortak görünümü — Input, Select ve Textarea aynı kabuğu
 * paylaşsın diye tek yerde. Şablonun `.form-control-custom` ölçüleri: 14px
 * yarıçap, ince kenar, odakta koyu kenar + yumuşak halka.
 *
 * Sınıf adları hotel/frontend/src/index.css'teki `@theme` jetonlarına dayanır.
 */
const CONTROL_BASE =
  'w-full border bg-surface font-medium text-ink outline-none transition duration-200 placeholder:font-normal placeholder:text-ink-muted/70 focus:border-ink focus:ring-[3px] focus:ring-black/[0.08] focus-visible:outline-none disabled:cursor-not-allowed disabled:border-black/[0.06] disabled:bg-surface-muted disabled:text-ink-muted';

/** Form içindeki standart ölçü. */
export const CONTROL_CLASS = `${CONTROL_BASE} rounded-control px-4 py-2.5 text-sm`;

/** Tablo satırı gibi sıkışık yerler için küçük ölçü. */
export const CONTROL_CLASS_COMPACT = `${CONTROL_BASE} rounded-item px-3 py-1.5 text-xs`;

/** @param {boolean} hasError */
export const controlBorder = (hasError) =>
  hasError ? 'border-sec-strong focus:border-sec-strong focus:ring-sec/15' : 'border-line-strong';

export const LABEL_CLASS = 'text-[0.85rem] font-bold text-ink';

export const ERROR_CLASS = 'text-xs font-bold text-sec-strong';
