import { Button } from '@hotelos/ui';

/**
 * Liste ekranlarının ortak tablosu.
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

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {/* Arka planda yenilenirken tabloyu boşaltmıyoruz; sadece soluklaştırıyoruz. */}
        <table className={`w-full text-sm transition-opacity ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-medium ${column.className ?? ''}`}>
                  {column.header}
                </th>
              ))}
              {rowActions && <th className="px-4 py-3 text-right font-medium">İşlem</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center text-gray-500">
                  Yükleniyor…
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center">
                  <p className="mb-3 text-sm text-red-600">{error.message}</p>
                  {onRetry && (
                    <Button variant="secondary" onClick={onRetry}>
                      Tekrar dene
                    </Button>
                  )}
                </td>
              </tr>
            )}

            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-gray-700">{emptyTitle}</p>
                  {emptyHint && <p className="mt-1 text-xs text-gray-500">{emptyHint}</p>}
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3 text-gray-800 ${column.className ?? ''}`}>
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                  {rowActions && <td className="px-4 py-3 text-right">{rowActions(row)}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <Pagination meta={meta} onPageChange={onPageChange} disabled={isLoading || Boolean(error)} />
      )}

      {meta && meta.total > 0 && (
        <p className="text-xs text-gray-500">
          Toplam {meta.total} kayıt{meta.totalPages > 1 ? ` · sayfa ${meta.page}/${meta.totalPages}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * @param {{ meta: { page: number, totalPages: number }, onPageChange?: (page: number) => void, disabled?: boolean }} props
 */
function Pagination({ meta, onPageChange, disabled }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="secondary"
        disabled={disabled || meta.page <= 1}
        onClick={() => onPageChange?.(meta.page - 1)}
      >
        Önceki
      </Button>
      <span className="text-sm text-gray-600">
        {meta.page} / {meta.totalPages}
      </span>
      <Button
        variant="secondary"
        disabled={disabled || meta.page >= meta.totalPages}
        onClick={() => onPageChange?.(meta.page + 1)}
      >
        Sonraki
      </Button>
    </div>
  );
}
