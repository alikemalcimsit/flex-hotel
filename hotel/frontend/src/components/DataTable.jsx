import { Alert, Button, EmptyState, Icon, Spinner } from '@hotelos/ui';

/**
 * Liste ekranlarının ortak tablosu — Spark Admin'in tablo kartı: kartın
 * içinde soluk başlık satırı, ince ayraçlar, altta sayfalama şeridi.
 *
 * Dört durumu da kendisi ele alır — yükleniyor, hata, boş, dolu. Her ekranın
 * bunu ayrı ayrı yazması, er ya da geç birinde "sonsuza kadar dönen spinner"
 * veya "hiçbir şey yazmayan boş tablo" bırakır.
 *
 * @param {{
 *   columns: Array<{ key: string, header: string, render?: (row: any) => React.ReactNode, className?: string }>,
 *   rows?: any[],
 *   meta?: { page: number, pageSize: number, total: number, totalPages: number },
 *   isLoading?: boolean,
 *   isFetching?: boolean,
 *   error?: Error | null,
 *   onRetry?: () => void,
 *   onPageChange?: (page: number) => void,
 *   emptyTitle?: string,
 *   emptyHint?: string,
 *   rowActions?: (row: any) => React.ReactNode,
 * }} props
 */
export function DataTable({
  columns,
  rows = [],
  meta,
  isLoading = false,
  isFetching = false,
  error = null,
  onRetry,
  onPageChange,
  emptyTitle = 'Kayıt yok',
  emptyHint,
  rowActions,
}) {
  const columnCount = columns.length + (rowActions ? 1 : 0);
  const isRefreshing = isFetching && !isLoading;
  const hasFooter = meta && meta.total > 0;

  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="relative overflow-x-auto">
        {/* Arka planda yenilenirken tabloyu boşaltmıyoruz; sadece soluklaştırıyoruz. */}
        <table
          aria-busy={isLoading || isRefreshing}
          className={`w-full text-sm transition-opacity duration-200 ${isRefreshing ? 'opacity-60' : ''}`}
        >
          <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={`whitespace-nowrap px-5 py-3.5 font-bold ${column.className ?? ''}`}>
                  {column.header}
                </th>
              ))}
              {rowActions && (
                <th scope="col" className="px-5 py-3.5 text-right font-bold">
                  İşlem
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading && (
              <tr>
                <td colSpan={columnCount} className="px-5 py-14">
                  <Spinner className="justify-center" />
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={columnCount} className="px-5 py-8">
                  <Alert
                    tone="danger"
                    title="Liste yüklenemedi"
                    className="mx-auto max-w-xl"
                    action={
                      onRetry && (
                        <Button variant="outline" size="sm" icon="refresh" onClick={onRetry}>
                          Tekrar dene
                        </Button>
                      )
                    }
                  >
                    {error.message}
                  </Alert>
                </td>
              </tr>
            )}

            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={columnCount}>
                  <EmptyState title={emptyTitle} description={emptyHint} />
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              rows.map((row) => (
                <tr key={row.id} className="transition-colors duration-150 hover:bg-surface-muted">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-5 py-4 align-middle text-ink ${column.className ?? ''}`}>
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                  {rowActions && <td className="px-5 py-4 text-right align-middle">{rowActions(row)}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {hasFooter && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-xs font-semibold text-ink-muted">
            Toplam <span className="text-ink">{meta.total}</span> kayıt
            {isRefreshing && <span className="ml-2 text-ink-muted">· yenileniyor…</span>}
          </p>
          {meta.totalPages > 1 && (
            <Pagination meta={meta} onPageChange={onPageChange} disabled={isLoading || Boolean(error)} />
          )}
        </div>
      )}
    </div>
  );
}

const PAGE_BUTTON =
  'grid size-9 place-items-center rounded-item border border-line bg-surface text-ink transition-colors duration-200 hover:border-ink disabled:pointer-events-none disabled:opacity-40';

/**
 * @param {{ meta: { page: number, totalPages: number }, onPageChange?: (page: number) => void, disabled?: boolean }} props
 */
function Pagination({ meta, onPageChange, disabled }) {
  return (
    <nav aria-label="Sayfalama" className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Önceki sayfa"
        className={PAGE_BUTTON}
        disabled={disabled || meta.page <= 1}
        onClick={() => onPageChange?.(meta.page - 1)}
      >
        <Icon name="chevronLeft" className="size-4" />
      </button>
      <span className="min-w-[4.5rem] text-center text-sm font-semibold text-ink-soft" aria-live="polite">
        {meta.page} / {meta.totalPages}
      </span>
      <button
        type="button"
        aria-label="Sonraki sayfa"
        className={PAGE_BUTTON}
        disabled={disabled || meta.page >= meta.totalPages}
        onClick={() => onPageChange?.(meta.page + 1)}
      >
        <Icon name="chevronRight" className="size-4" />
      </button>
    </nav>
  );
}
