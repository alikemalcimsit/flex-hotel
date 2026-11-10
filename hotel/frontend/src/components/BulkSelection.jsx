import { useCallback, useMemo, useState } from 'react';
import { Alert, Button } from '@hotelos/ui';

/**
 * Toplu işlem seçimi: tablo satırlarına onay kutusu sütunu, başlıkta "bu sayfadakilerin hepsi". Seçim sayfa ve
 * süzgeç değişince temizlenmeli (`clear`); sunucu her kaydı tek tek işlemin kuralıyla işler ve sonucu kayıt kayıt
 * döndürür (`BulkResultAlert`).
 */
export function useRowSelection() {
  const [selected, setSelected] = useState(() => new Set());
  const toggle = useCallback((id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  /**
   * Tablonun ilk sütunu.
   * @param {any[]} rows sayfadaki satırlar
   * @param {(row: any) => boolean} [selectable] seçilemeyen satırda kutu pasif; `disabledHint` neden seçilemediğini söyler
   * @param {string} [disabledHint]
   */
  const column = (rows, selectable = () => true, disabledHint = 'Bu kayıt toplu işleme alınamaz') => {
    const eligible = rows.filter(selectable);
    const all = eligible.length > 0 && eligible.every((row) => selected.has(row.id));
    return {
      key: '__select',
      className: 'w-10',
      header: (
        <input
          type="checkbox"
          aria-label="Bu sayfadakilerin hepsini seç"
          className="size-4 accent-ink"
          checked={all}
          disabled={eligible.length === 0}
          onChange={() =>
            setSelected((current) => {
              const next = new Set(current);
              for (const row of eligible) {
                if (all) next.delete(row.id);
                else next.add(row.id);
              }
              return next;
            })
          }
        />
      ),
      render: (row) =>
        selectable(row) ? (
          <input type="checkbox" aria-label="Seç" className="size-4 accent-ink" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
        ) : (
          <input type="checkbox" aria-label={disabledHint} title={disabledHint} className="size-4 cursor-not-allowed opacity-40" checked={false} disabled readOnly />
        ),
    };
  };
  return useMemo(() => ({ selected, ids: [...selected], count: selected.size, toggle, clear, column }), [selected, toggle, clear]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Sunucunun süre bütçesi dolduğunda işlenmeden kalan kaydın sonucu. */
export const BATCH_LEFTOVER_MESSAGE = 'İşlenmedi (süre doldu); yeniden seçip deneyin';

/**
 * Süre bütçeli toplu işlem: sunucu bütçe dolunca kalanları `pending` döndürür; kalan bitene dek aynı uç kalanlarla
 * yeniden çağrılır, sonuçlar birleşir. Bir tur hiç ilerlemezse durur (sonsuz döngü yok), kalanlar "işlenmedi" yazılır.
 * İşlenenler kalıcıdır: hata olsa da çağıran listeyi tazelemeli.
 *
 * @template T
 * @param {(items: T[]) => Promise<{ results: any[], pending?: string[] }>} send
 * @param {(item: T) => string} idOf
 */
export function useBatchRunner(send, idOf) {
  const [progress, setProgress] = useState(/** @type {{ done: number, total: number } | null} */ (null));
  const run = useCallback(
    /** @param {T[]} items */
    async (items) => {
      let remaining = items;
      const results = [];
      setProgress({ done: 0, total: items.length });
      try {
        while (remaining.length) {
          const page = await send(remaining);
          results.push(...page.results);
          const pending = new Set(page.pending ?? []);
          const next = remaining.filter((item) => pending.has(idOf(item)));
          if (next.length === remaining.length) break;
          remaining = next;
          setProgress({ done: results.length, total: items.length });
        }
        for (const item of remaining) results.push({ id: idOf(item), ok: false, message: BATCH_LEFTOVER_MESSAGE });
        return { results, succeeded: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length };
      } finally {
        setProgress(null);
      }
    },
    [send, idOf],
  );
  return { run, progress };
}

/**
 * Toplu işlemin sonucu: kaçı yapıldı, yapılamayanlar sebebiyle (ilk 10).
 * @param {{ title: string, result: { results: Array<{ id: string, ok: boolean, message?: string | null }> } | null, labelOf: (id: string) => string, onClose: () => void, hint?: string, children?: import('react').ReactNode }} props
 *   `hint`: yapılamayanlar için ne yapılacağı; `children`: başarılılar için ek not
 */
export function BulkResultAlert({ title, result, labelOf, onClose, hint = 'Yapılamayanlar tek tek açılıp işlenebilir (ör. bakiye, ücret onayı, gerekçe isteyenler).', children = null }) {
  if (!result) return null;
  const failed = result.results.filter((row) => !row.ok);
  const done = result.results.length - failed.length;
  return (
    <Alert
      tone={failed.length === 0 ? 'success' : done === 0 ? 'danger' : 'warning'}
      title={`${title}: ${done} yapıldı${failed.length ? `, ${failed.length} yapılamadı` : ''}`}
      action={
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      {failed.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-sm">
          {failed.slice(0, 10).map((row) => (
            <li key={row.id}>
              <span className="font-semibold">{labelOf(row.id)}</span>: {row.message}
            </li>
          ))}
          {failed.length > 10 && <li>… ve {failed.length - 10} kayıt daha</li>}
        </ul>
      )}
      {failed.length > 0 && <p className="mt-1 text-xs">{hint}</p>}
      {children}
    </Alert>
  );
}
