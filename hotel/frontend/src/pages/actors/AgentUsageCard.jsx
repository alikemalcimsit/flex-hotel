import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ACTOR_USAGE_DEFAULT_DAYS, MAX_USAGE_DAYS } from '@hotelos/hotel-contracts';
import { Alert, Card, EmptyState, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { actorKeys, formatCount, formatUsd } from '../../lib/actors.js';
import { QueryError } from '../activity/shared.jsx';
import { BudgetBar } from './actorParts.jsx';

const PERIOD_OPTIONS = [...new Set([7, ACTOR_USAGE_DEFAULT_DAYS, 30, MAX_USAGE_DAYS])]
  .sort((a, b) => a - b)
  .map((days) => ({ value: String(days), label: `Son ${days} gün` }));

/**
 * LLM ajanı kartı (modül 12): model, günlük bütçe, bugünkü kullanım çubuğu
 * (otelin toplamı ve ajanın payı), tahmini maliyet ve gün gün çağrı/maliyet.
 * Veri günlük özetten gelir (çağrı satırlarından değil).
 *
 * @param {{ actorName: string, llm: { model: string | null, keyConfigured: boolean, aiEnabled: boolean } }} props
 */
export function AgentUsageCard({ actorName, llm }) {
  const [days, setDays] = useState(ACTOR_USAGE_DEFAULT_DAYS);
  const query = useQuery({
    queryKey: actorKeys.usage(actorName, days),
    queryFn: () => api(withQuery(`/actors/${encodeURIComponent(actorName)}/usage`, { days })),
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      title="LLM kullanımı"
      description="Tutarlar ayardaki model fiyatlarıyla hesaplanan tahmindir. Günlük bütçe otelin tamamı içindir; ajanlar paylaşır."
      actions={
        <Select
          label="Dönem"
          name="agent-usage-period"
          value={String(days)}
          options={PERIOD_OPTIONS}
          onChange={(event) => setDays(Number(event.target.value))}
          className="w-40"
        />
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Model">{llm.model ? <span className="font-mono">{llm.model}</span> : 'Seçilmemiş (Ayarlar › AI asistanı)'}</Fact>
          <Fact label="Sunucu anahtarı">{llm.keyConfigured ? 'Tanımlı' : 'Tanımlı değil — ajan çalışmıyor'}</Fact>
          <Fact label="AI asistanı">{llm.aiEnabled ? 'Açık' : 'Kapalı (misafire cevap vermiyor)'}</Fact>
        </dl>

        {query.isPending && <Spinner label="Kullanım yükleniyor…" className="py-8" />}
        {query.isError && <QueryError query={query} title="Kullanım yüklenemedi" />}
        {query.data && <UsageBody usage={query.data} />}
      </div>
    </Card>
  );
}

/** @param {{ usage: any }} props */
function UsageBody({ usage }) {
  const peak = Math.max(...usage.days.map((day) => Number(day.costUsd)), 0);
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="agent-usage-today" className="flex flex-col gap-2">
        <h3 id="agent-usage-today" className="text-sm font-bold text-ink">
          Bugün ({usage.today.date})
        </h3>
        <p className="text-sm text-ink-soft">
          Bu ajan {formatCount(usage.today.calls)} çağrı, {formatUsd(usage.today.agentSpentUsd)} · otelin toplamı {formatUsd(usage.today.hotelSpentUsd)}
        </p>
        <BudgetBar
          spent={usage.today.hotelSpentUsd}
          budget={usage.today.budgetUsd}
          share={usage.today.agentSpentUsd}
          label="Bugünkü AI harcamasının bütçeye oranı (koyu kısım bu ajanın payı)"
        />
        {usage.today.exhausted && Number(usage.today.budgetUsd) > 0 && (
          <Alert tone="warning">Bütçe doldu: AI bugün yeni mesaja cevap vermiyor, konuşmalar personele düşüyor.</Alert>
        )}
      </section>

      {usage.total.calls === 0 ? (
        <EmptyState icon="bot" title="Bu dönemde model çağrısı yok" description="Ajan misafire cevap verdikçe çağrılar burada görünür." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={`Tahmini maliyet (${usage.from} – ${usage.to})`} value={formatUsd(usage.total.costUsd)} />
            <Stat label="Model çağrısı" value={formatCount(usage.total.calls)} />
            <Stat label="Çağrı başına ortalama" value={formatUsd(usage.total.avgCostPerCallUsd)} />
          </div>

          <section aria-labelledby="agent-usage-days" className="flex flex-col gap-2">
            <h3 id="agent-usage-days" className="text-sm font-bold text-ink">
              Gün gün maliyet
            </h3>
            <ol className="flex h-32 items-end gap-1" aria-label="Gün gün maliyet çubukları">
              {usage.days.map((day) => {
                const height = peak > 0 ? Math.max(2, Math.round((Number(day.costUsd) / peak) * 100)) : 2;
                return (
                  <li key={day.date} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${day.date}: ${formatCount(day.calls)} çağrı, ${formatUsd(day.costUsd)}`}>
                    <span className="sr-only">
                      {day.date}: {formatCount(day.calls)} çağrı, {formatUsd(day.costUsd)}
                    </span>
                    <span className={`block w-full rounded-t-sm ${day.calls > 0 ? 'bg-ink/70' : 'bg-black/[0.08]'}`} style={{ height: `${height}%` }} />
                  </li>
                );
              })}
            </ol>
            <div className="flex justify-between text-[0.7rem] text-ink-muted">
              <span>{usage.from}</span>
              <span>{usage.to}</span>
            </div>
          </section>

          <div className="overflow-x-auto rounded-control border border-line">
            <table className="w-full text-sm">
              <caption className="border-b border-line bg-surface-muted px-4 py-2.5 text-left text-xs font-bold text-ink">Modele göre</caption>
              <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-bold">Model</th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">Çağrı</th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">Maliyet</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((row) => (
                  <tr key={row.model} className="border-t border-line">
                    <td className="px-4 py-2 font-mono text-xs text-ink">{row.model}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCount(row.calls)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
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
