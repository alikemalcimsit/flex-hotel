import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ACTIVITY_LEVEL_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Input, Spinner } from '@hotelos/ui';

/**
 * Aktivite ekranlarının ortak parçaları: adres çubuğundaki süzgeçler, seviye
 * rozeti, JSON görünümü, "daha eski" şeridi, hata kutusu.
 */

/**
 * Süzgeçler adres çubuğunda: sayfa yenilense de kalır, bağlantıyla
 * paylaşılır ("şu hatalara bak").
 *
 * @template {string} K
 * @param {Record<K, string>} names alan → adres parametresi
 * @returns {{ values: Record<K, string>, set: (field: K, value: string) => void, setMany: (patch: Partial<Record<K, string>>) => void, clear: () => void, active: boolean }}
 */
export function useUrlFilters(names) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(
    () => Object.fromEntries(Object.entries(names).map(([field, param]) => [field, params.get(param) ?? ''])),
    [params, names],
  );
  const setMany = (patch) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [field, value] of Object.entries(patch)) {
          if (value) next.set(names[field], value);
          else next.delete(names[field]);
        }
        return next;
      },
      { replace: true },
    );
  return {
    values,
    set: (field, value) => setMany({ [field]: value }),
    setMany,
    clear: () => setMany(Object.fromEntries(Object.keys(names).map((field) => [field, '']))),
    active: Object.values(values).some(Boolean),
  };
}

const LEVEL_STYLES = Object.freeze({
  INFO: { icon: 'info', className: 'bg-info-soft text-info-ink' },
  WARN: { icon: 'alertTriangle', className: 'bg-warning-soft text-warning-ink' },
  ERROR: { icon: 'alertCircle', className: 'bg-danger-soft text-sec-strong' },
  DEBUG: { icon: 'info', className: 'bg-black/[0.05] text-ink-soft' },
});

/** @param {{ level: string }} props */
export function LevelBadge({ level }) {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.INFO;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${style.className}`}>
      <Icon name={style.icon} className="size-3.5" />
      {ACTIVITY_LEVEL_LABELS[level] ?? level}
    </span>
  );
}

/** Olay gövdesi / meta: okunur JSON (kişisel veri sunucuda maskelenmiş gelir). */
export function JsonBlock({ value, label }) {
  if (value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0)) {
    return <p className="text-xs text-ink-muted">{label}: boş</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
      <pre className="max-h-72 overflow-auto rounded-control bg-surface-muted p-3 text-xs leading-relaxed text-ink-soft">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Geri: uygulama içinden gelindiyse bir önceki sayfa, bağlantıyla doğrudan
 * açıldıysa (geçmiş yok) bölümün ana sayfası — tarayıcı uygulamadan çıkmasın.
 * @param {(to: string | number) => void} navigate
 * @param {string} fallback
 */
export function goBack(navigate, fallback) {
  if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
  else navigate(fallback);
}

/** Zincir bağlantısı. @param {{ correlationId: string | null | undefined, compact?: boolean }} props */
export function ChainLink({ correlationId, compact = false }) {
  if (!correlationId) return null;
  return (
    <Link
      to={`/aktivite/zincir/${encodeURIComponent(correlationId)}`}
      className="inline-flex items-center gap-1 rounded-item px-1.5 py-0.5 text-xs font-semibold text-ink-soft underline-offset-2 hover:bg-black/[0.05] hover:text-ink hover:underline"
      title="Bu işlemin bütün adımları"
    >
      <Icon name="link" className="size-3.5" />
      {compact ? 'Zincir' : 'Zinciri gör'}
    </Link>
  );
}

/**
 * Listenin alt şeridi: daha eskiler, bitti ya da yükleniyor.
 * @param {{ query: import('@tanstack/react-query').UseInfiniteQueryResult<any>, emptyShown: boolean }} props
 */
export function OlderRows({ query, emptyShown }) {
  if (emptyShown) return null;
  if (query.isFetchingNextPage) return <Spinner label="Eski kayıtlar yükleniyor…" className="py-4" />;
  if (!query.hasNextPage) return <p className="py-4 text-center text-xs font-semibold text-ink-muted">Listenin sonu</p>;
  return (
    <div className="flex justify-center py-3">
      <Button variant="outline" size="sm" icon="arrowDown" onClick={() => query.fetchNextPage()}>
        Daha eski kayıtlar
      </Button>
    </div>
  );
}

/** @param {{ query: import('@tanstack/react-query').UseQueryResult<any> | import('@tanstack/react-query').UseInfiniteQueryResult<any>, title: string }} props */
export function QueryError({ query, title }) {
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
          Tekrar dene
        </Button>
      }
    >
      {query.error?.message}
    </Alert>
  );
}

/**
 * Tarih aralığı süzgeci (otel günü). Başlangıç bitişten sonra seçilemez.
 * @param {{ from: string, to: string, onChange: (patch: { from?: string, to?: string }) => void, idPrefix: string }} props
 */
export function DayRangeInputs({ from, to, onChange, idPrefix }) {
  const [error, setError] = useState(null);
  const change = (field) => (event) => {
    const next = { from, to, [field]: event.target.value };
    if (next.from && next.to && next.from > next.to) {
      setError('Bitiş başlangıçtan önce olamaz');
      return;
    }
    setError(null);
    onChange({ [field]: event.target.value });
  };
  return (
    <>
      <Input label="Başlangıç günü" type="date" name={`${idPrefix}-from`} value={from} max={to || undefined} onChange={change('from')} error={error ?? undefined} />
      <Input label="Bitiş günü" type="date" name={`${idPrefix}-to`} value={to} min={from || undefined} onChange={change('to')} />
    </>
  );
}
