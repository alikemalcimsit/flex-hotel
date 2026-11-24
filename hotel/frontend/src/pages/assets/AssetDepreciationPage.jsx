import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { DEPRECIATION_SOURCE_LABELS, DEPRECIATION_SOURCE_TONES, assetPath, exportDepreciationExcel, monthlyShare } from '../../lib/assets.js';
import { useDepreciation, useDepreciationAction } from '../../lib/assetQueries.js';
import { formatDate, formatDateTime, formatMoney, formatPercent } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError } from '../../store/toast.js';
import { useAssetAccess } from './AssetFields.jsx';

/** Yıl seçicisinde bu yıldan geriye / ileriye kaç yıl. */
const YEARS_BACK = 8;
const YEARS_AHEAD = 5;

/**
 * Yıllık amortisman tablosu (modül 46, VUK yıllık doğrusal): seçilen yılda defterdeki her demirbaşın dönem başı
 * birikmişi, yıl payı, dönem sonu birikmişi ve net değeri; kategori özetleri. Kaydedilmemiş yıl plandır; "yılı
 * kaydet" payları kilitler (yıllar ardışık), yalnız son kaydedilen yıl geri alınır. Aylık pay (yıllık / 12) yönetim
 * raporları içindir. Excel mali müşavire.
 */
export function AssetDepreciationPage() {
  const { today } = useHotelToday();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const query = useDepreciation(year);
  const years = Array.from({ length: YEARS_BACK + YEARS_AHEAD + 1 }, (_, index) => currentYear + YEARS_AHEAD - index);
  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Yıl"
        name="depreciation-year"
        className="w-full sm:w-40"
        value={String(year)}
        onChange={(event) => setYear(Number(event.target.value))}
        options={years.map((value) => ({ value: String(value), label: String(value) }))}
      />
      {query.data ? <DepreciationView table={query.data} isFetching={query.isFetching} /> : <QueryFallback query={query} errorTitle="Amortisman tablosu okunamadı" />}
    </div>
  );
}

/** @param {{ table: any, isFetching: boolean }} props */
function DepreciationView({ table, isFetching }) {
  const access = useAssetAccess();
  const action = useDepreciationAction();
  const [confirm, setConfirm] = useState(null);
  const [exporting, setExporting] = useState(false);
  const posted = table.status === 'POSTED';

  function run(path) {
    action.mutate(
      { path, year: table.year, message: path === 'post' ? `${table.year} amortismanı kaydedildi` : `${table.year} kaydı geri alındı` },
      { onSettled: () => setConfirm(null) },
    );
  }

  async function exportExcel() {
    setExporting(true);
    try {
      await exportDepreciationExcel(table);
    } catch (failure) {
      toastError(`Excel hazırlanamadı: ${failure.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={posted ? 'success' : 'info'}>{posted ? 'Kaydedildi' : 'Kaydedilmedi (plan)'}</Badge>
          {table.run && (
            <span className="text-ink-muted">
              {formatDateTime(table.run.postedAt)} · {table.run.postedBy} · {table.run.assetCount} demirbaş
            </span>
          )}
          {!posted && table.lastPostedYear && <span className="text-ink-muted">Son kaydedilen yıl: {table.lastPostedYear}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" icon="download" onClick={exportExcel} disabled={exporting || table.rows.length === 0}>
            {exporting ? 'Hazırlanıyor…' : 'Excel'}
          </Button>
          {access.finance && table.canReverse && (
            <Button type="button" variant="dangerSoft" icon="rotateCcw" onClick={() => setConfirm('reverse')}>
              Kaydı geri al
            </Button>
          )}
          {access.finance && table.canPost && (
            <Button type="button" icon="check" onClick={() => setConfirm('post')}>
              {table.year} yılını kaydet
            </Button>
          )}
        </div>
      </div>
      {!posted && !table.canPost && table.postBlockReason && access.finance && (
        <Alert tone="info" title="Bu yıl şimdi kaydedilemez">
          {table.postBlockReason}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total label="Maliyet" value={table.totals.cost} />
        <Total label="Dönem başı birikmiş" value={table.totals.accumulatedStart} />
        <Total label={`${table.year} amortismanı`} value={table.totals.amount} hint={`aylık pay ${formatMoney(monthlyShare(table.totals.amount))}`} strong />
        <Total label="Dönem sonu net değer" value={table.totals.bookValueEnd} />
      </div>

      {table.categories.length > 0 && (
        <Card title="Kategori özeti">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2 text-right">Adet</th>
                  <th className="px-3 py-2 text-right">Maliyet</th>
                  <th className="px-3 py-2 text-right">Yıl payı</th>
                  <th className="px-3 py-2 text-right">Aylık pay</th>
                  <th className="px-3 py-2 text-right">Birikmiş</th>
                  <th className="px-3 py-2 text-right">Net değer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.categories.map((row) => (
                  <tr key={row.categoryId}>
                    <td className="px-3 py-2 font-semibold">{row.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{formatMoney(monthlyShare(row.amount))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.accumulatedEnd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.bookValueEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`Demirbaşlar · ${table.rows.length}`} description="Alındığı yıl tam yıl ayrılır; elden çıkarıldığı yıl ayrılmaz (kalan net değer o yılın gideri).">
        {table.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">Bu yıl defterde demirbaş yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Demirbaş</th>
                  <th className="px-3 py-2">Alış</th>
                  <th className="px-3 py-2 text-right">Maliyet</th>
                  <th className="px-3 py-2 text-right">Oran</th>
                  <th className="px-3 py-2 text-right">Dönem başı</th>
                  <th className="px-3 py-2 text-right">Yıl payı</th>
                  <th className="px-3 py-2 text-right">Dönem sonu</th>
                  <th className="px-3 py-2 text-right">Net değer</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.rows.map((row) => (
                  <tr key={row.assetId}>
                    <td className="px-3 py-2">
                      <Link to={assetPath(row.assetId)} className="font-semibold hover:underline">
                        {row.name}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        <span className="font-mono">{row.code}</span> · {row.categoryName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(row.purchaseDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.cost)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                      {formatPercent(row.ratePct)} · {row.usefulLifeYears} yıl
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.accumulatedStart)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.accumulatedEnd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.bookValueEnd)}</td>
                    <td className="px-3 py-2">
                      {row.disposedOn ? (
                        <span className="text-xs text-ink-muted">Elden çıkarıldı {formatDate(row.disposedOn)}</span>
                      ) : (
                        <Badge tone={DEPRECIATION_SOURCE_TONES[row.source]} dot={false}>
                          {row.source === 'NONE' ? 'Ayrılmaz' : DEPRECIATION_SOURCE_LABELS[row.source]}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirm === 'post'}
        title={`${table.year} amortismanını kaydet`}
        message={`${table.rows.filter((row) => Number(row.amount) > 0).length} demirbaş için toplam ${formatMoney(table.totals.amount)} yazılır. Kaydedilen yıl kilitlenir: kartların alış tarihi, tutarı ve ömrü değişmez; düzeltme için kaydı geri almak gerekir.`}
        confirmLabel="Kaydet"
        confirmVariant="primary"
        confirmIcon="check"
        onConfirm={() => run('post')}
        onClose={() => setConfirm(null)}
        isPending={action.isPending}
      />
      <ConfirmDialog
        open={confirm === 'reverse'}
        title={`${table.year} kaydını geri al`}
        message={`${table.year} yılının amortisman kaydı silinir; tablo yeniden plan olur ve bu yılın kartları düzeltilebilir. Yalnız son kaydedilen yıl geri alınır.`}
        confirmLabel="Geri al"
        confirmIcon="rotateCcw"
        onConfirm={() => run('reverse')}
        onClose={() => setConfirm(null)}
        isPending={action.isPending}
      />
    </div>
  );
}

/** @param {{ label: string, value: string, hint?: string, strong?: boolean }} props */
function Total({ label, value, hint, strong = false }) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-soft">
      <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
      <span className={`mt-1 block tabular-nums ${strong ? 'text-2xl font-bold' : 'text-xl font-semibold'}`}>{formatMoney(value)}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
