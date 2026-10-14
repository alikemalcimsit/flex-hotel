import { MAX_PROMOTION_REPORT_DAYS, PROMOTION_REPORT_BASES, PROMOTION_REPORT_BASIS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Input, Select } from '@hotelos/ui';

const BASIS_OPTIONS = PROMOTION_REPORT_BASES.map((value) => ({ value, label: PROMOTION_REPORT_BASIS_LABELS[value] }));

/**
 * Rapor dönemi geçerli mi (bitiş ≥ başlangıç, en fazla `MAX_PROMOTION_REPORT_DAYS` gün)?
 * @param {{ from: string, to: string }} period
 */
export function periodIssue(period) {
  if (!period.from || !period.to) return 'Başlangıç ve bitiş günlerini seçin.';
  if (period.to < period.from) return 'Bitiş, başlangıçtan önce olamaz.';
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1;
  if (days > MAX_PROMOTION_REPORT_DAYS) return `Dönem en fazla ${MAX_PROMOTION_REPORT_DAYS} gün olabilir.`;
  return null;
}

/**
 * Kullanım raporunun dönemi ve esası (satış günü / giriş günü). İki uç dahil.
 *
 * @param {{ period: { from: string, to: string, basis: string }, onChange: (period: { from: string, to: string, basis: string }) => void, idPrefix: string }} props
 */
export function ReportPeriod({ period, onChange, idPrefix }) {
  const issue = periodIssue(period);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Başlangıç" name={`${idPrefix}-from`} type="date" value={period.from} max={period.to || undefined} onChange={(event) => onChange({ ...period, from: event.target.value })} className="w-full sm:w-44" />
        <Input label="Bitiş" name={`${idPrefix}-to`} type="date" value={period.to} min={period.from || undefined} onChange={(event) => onChange({ ...period, to: event.target.value })} className="w-full sm:w-44" />
        <Select label="Esas" name={`${idPrefix}-basis`} value={period.basis} onChange={(event) => onChange({ ...period, basis: event.target.value })} options={BASIS_OPTIONS} className="w-full sm:w-56" />
      </div>
      {issue && <Alert tone="warning" title="Dönem geçersiz">{issue}</Alert>}
      <p className="text-xs text-ink-muted">
        {period.basis === 'STAY'
          ? 'Girişi bu dönemde olan rezervasyonlar.'
          : 'Bu dönemde açılan (satılan) rezervasyonlar; gün otelin saatine göre.'}{' '}
        Kullanım, tutar ve indirim geçerli rezervasyonlardan; iptal ve gelmeyenler ayrı sayılır.
      </p>
    </div>
  );
}

/** @param {{ label: string, value: string, hint?: string }} props */
export function Figure({ label, value, hint }) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-soft sm:p-5">
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
