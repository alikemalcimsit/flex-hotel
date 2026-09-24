/**
 * Açık / kapalı anahtarı (erişilebilir: `role="switch"`, `aria-checked`).
 *
 * Tıklamanın sonucu çoğu zaman bir onay penceresi ya da sunucu isteğidir;
 * anahtar kendi durumunu tutmaz, `checked` her zaman sunucudan gelen hâldir.
 * İstek sürerken `busy` anahtarı kilitler (çift tıklama iki istek atmasın).
 *
 * @param {{
 *   checked: boolean,
 *   onChange: (next: boolean) => void,
 *   label: string,
 *   disabled?: boolean,
 *   busy?: boolean,
 *   showLabel?: boolean,
 * }} props `label` ekran okuyucu için her zaman verilir; `showLabel` yanında da yazar.
 */
export function Switch({ checked, onChange, label, disabled = false, busy = false, showLabel = false }) {
  const locked = disabled || busy;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={showLabel ? undefined : label}
      aria-busy={busy || undefined}
      disabled={locked}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className="group inline-flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-success' : 'bg-black/[0.18]'
        } ${locked ? 'opacity-50' : ''}`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </span>
      {showLabel && <span className="text-sm font-semibold text-ink">{label}</span>}
    </button>
  );
}
