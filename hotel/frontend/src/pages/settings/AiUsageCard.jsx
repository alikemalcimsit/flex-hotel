import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAX_USAGE_DAYS } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { aiKeys } from '../../lib/concierge.js';

/** Kullanım ekranının dönem seçenekleri (gün). */
const PERIODS = Object.freeze([7, 30, MAX_USAGE_DAYS]);
const PERIOD_OPTIONS = PERIODS.map((days) => ({ value: String(days), label: `Son ${days} gün` }));

/** Ekranda aktör adı yerine ne iş yaptığı. */
const ACTOR_LABELS = Object.freeze({
  'router-agent': 'Niyet ve özet',
  'concierge-agent': 'Misafirle konuşma',
});

/** USD, 4 ondalık (küçük tutarlar sıfır görünmesin). @param {string} value */
const usd = (value) => `$${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const count = (value) => Number(value).toLocaleString('tr-TR');

/**
 * AI kullanımı: bugünün bütçe durumu, dönem toplamı, model ve iş kırılımı,
 * gün gün maliyet. Sunucu otelin iş gününe göre toplar.
 */
export function AiUsageCard() {
  const [days, setDays] = useState(30);
  const query = useQuery({
    queryKey: aiKeys.usage(days),
    queryFn: () => api(withQuery('/ai/usage', { days })),
  });

  return (
    <Card
      title="Kullanım ve maliyet"
      description="Her model çağrısı token sayısı ve fiyatıyla kaydedilir. Tutarlar ayardaki fiyatlarla hesaplanır; sağlayıcının faturasıyla küçük farklar olabilir."
      actions={
        <Select
          label="Dönem"
          name="ai-usage-period"
          value={String(days)}
          options={PERIOD_OPTIONS}
          onChange={(event) => setDays(Number(event.target.value))}
          className="w-40"
        />
      }
    >
      <UsageBody query={query} />
    </Card>
  );
}

/** @param {{ query: import('@tanstack/react-query').UseQueryResult<any> }} props */
function UsageBody({ query }) {
  if (query.isPending) return <Spinner label="Kullanım yükleniyor…" className="py-8" />;
  if (query.isError) {
    return (
      <Alert
        tone="danger"
        title="Kullanım yüklenemedi"
        action={
          <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
            Tekrar dene
          </Button>
        }
      >
        {query.error.message}
      </Alert>
    );
  }

  const usage = query.data;
  const budget = Number(usage.today.budgetUsd);
  const spent = Number(usage.today.spentUsd);
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 0;
  const barTone = ratio >= 1 ? 'bg-sec-strong' : ratio >= 0.8 ? 'bg-warning' : 'bg-success';

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ai-usage-today" className="flex flex-col gap-2">
        <h3 id="ai-usage-today" className="text-sm font-bold text-ink">
          Bugün ({usage.today.date})
        </h3>
        <p className="text-sm text-ink-soft">
          {usd(usage.today.spentUsd)} harcandı
          {budget > 0 ? ` · günlük bütçe ${usd(usage.today.budgetUsd)}` : ' · bütçe girilmemiş (AI çağrı yapmaz)'}
        </p>
        {budget > 0 && (
          <div
            role="progressbar"
            aria-label="Günlük bütçenin kullanılan kısmı"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]"
          >
            <div className={`h-full ${barTone}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
        )}
        {budget > 0 && ratio >= 1 && (
          <p className="text-xs font-semibold text-sec-strong">Bütçe doldu: AI bugün yeni mesaja cevap vermiyor, konuşmalar personele düşüyor.</p>
        )}
      </section>

      {usage.total.calls === 0 ? (
        <EmptyState icon="bot" title="Bu dönemde AI kullanımı yok" description="AI misafire cevap verdikçe çağrılar burada görünür." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={`Toplam (${usage.from} – ${usage.to})`} value={usd(usage.total.costUsd)} />
            <Stat label="Model çağrısı" value={count(usage.total.calls)} />
            <Stat
              label="Çağrı başına ortalama"
              value={usd(String(Number(usage.total.costUsd) / Math.max(1, usage.total.calls)))}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <UsageTable
              caption="Modele göre"
              columns={['Model', 'Çağrı', 'Girdi / önbellek / çıktı token', 'Maliyet']}
              rows={usage.byModel.map((row) => [
                row.model,
                count(row.calls),
                `${count(row.tokensIn)} / ${count(row.cacheRead)} / ${count(row.tokensOut)}`,
                usd(row.costUsd),
              ])}
            />
            <UsageTable
              caption="İşe göre"
              columns={['İş', 'Çağrı', 'Maliyet']}
              rows={usage.byActor.map((row) => [ACTOR_LABELS[row.actorName] ?? row.actorName, count(row.calls), usd(row.costUsd)])}
            />
          </div>

          <UsageTable
            caption="Gün gün"
            columns={['Gün', 'Çağrı', 'Maliyet']}
            rows={[...usage.days].reverse().map((row) => [row.date, count(row.calls), usd(row.costUsd)])}
          />
        </>
      )}
    </div>
  );
}

/** @param {{ label: string, value: string }} props */
function Stat({ label, value }) {
  return (
    <div className="rounded-control border border-line px-4 py-3">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

/** @param {{ caption: string, columns: string[], rows: Array<Array<string>> }} props */
function UsageTable({ caption, columns, rows }) {
  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="w-full text-sm">
        <caption className="border-b border-line bg-surface-muted px-4 py-2.5 text-left text-xs font-bold text-ink">{caption}</caption>
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            {columns.map((column, index) => (
              <th key={column} scope="col" className={`whitespace-nowrap px-4 py-2 font-bold ${index > 0 ? 'text-right' : ''}`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-line">
              {row.map((cell, index) => (
                <td key={`${row[0]}-${columns[index]}`} className={`whitespace-nowrap px-4 py-2 ${index > 0 ? 'text-right tabular-nums' : 'font-semibold text-ink'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
