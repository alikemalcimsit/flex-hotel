/**
 * Yükleniyor göstergesi. `role="status"` ile ekran okuyucuya duyurulur; dönen
 * halka dekoratif. Hareket azaltma tercihinde halka durur, metin kalır.
 *
 * @param {{ label?: string, className?: string }} props
 */
export function Spinner({ label = 'Yükleniyor…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 text-sm font-medium text-ink-muted ${className}`}>
      <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-black/10 border-t-sec" />
      <span>{label}</span>
    </div>
  );
}
