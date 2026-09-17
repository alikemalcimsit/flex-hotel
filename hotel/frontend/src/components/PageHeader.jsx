/**
 * Sayfa başlığı — Spark Admin'in `.page-header`'ı: solda başlık ve açıklama,
 * sağda sayfanın eylemleri. Dar ekranda eylemler başlığın altına iner.
 *
 * @param {{ title: string, description?: string, actions?: React.ReactNode }} props
 */
export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-bold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}
