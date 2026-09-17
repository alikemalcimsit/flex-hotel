/**
 * Gelen kutusunun görsel dili — kanal, yazar ve teslim durumu tek yerde.
 *
 * Renk hiçbir yerde tek başına anlam taşımaz: kanalın adı, teslim durumunun
 * metni her zaman yanında (ekran okuyucu ve renk körlüğü için).
 */

export const CHANNEL_STYLES = Object.freeze({
  WHATSAPP: { icon: 'message', chip: 'bg-success-soft text-success-ink', dot: 'bg-success' },
  WEBCHAT: { icon: 'globe', chip: 'bg-info-soft text-info-ink', dot: 'bg-info' },
  SMS: { icon: 'phone', chip: 'bg-violet-50 text-violet-800', dot: 'bg-violet-500' },
  EMAIL: { icon: 'mail', chip: 'bg-black/[0.05] text-ink-soft', dot: 'bg-ink-muted' },
});

/** Giden mesajın teslim durumu: ikon, ton ve metin. */
export const DELIVERY_STYLES = Object.freeze({
  PENDING: { icon: 'clock', className: 'text-warning-ink', onDark: 'text-amber-200' },
  SENT: { icon: 'check', className: 'text-ink-muted', onDark: 'text-white/70' },
  DELIVERED: { icon: 'checkCheck', className: 'text-ink-muted', onDark: 'text-white/70' },
  READ: { icon: 'checkCheck', className: 'text-info', onDark: 'text-sky-300' },
  FAILED: { icon: 'alertCircle', className: 'text-sec-strong', onDark: 'text-red-300' },
});

/** Liste satırındaki son mesaj ön eki (kim yazdı). */
export const PREVIEW_PREFIX = Object.freeze({
  GUEST: '',
  STAFF: 'Personel: ',
  AI: 'AI: ',
  SYSTEM: 'Sistem: ',
});

/** Aynı yazarın bu kadar dakika içindeki mesajları tek grup çizilir. */
export const MESSAGE_GROUP_MINUTES = 5;
