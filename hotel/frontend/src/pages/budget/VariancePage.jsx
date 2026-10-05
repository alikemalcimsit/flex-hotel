import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BUDGET_ITEM_KIND_LABELS, BUDGET_MONTH_LABELS, BUDGET_SCOPE_LABELS, BUDGET_SCOPES } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Select, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { apiPost } from '../../lib/api.js';
import { budgetKeys, useBudgetLive, useCommentary, useVariance } from '../../lib/budget.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError } from '../../store/toast.js';
import { QueryError } from '../activity/shared.jsx';
import { BudgetTabs, YearPicker, useBudgetYearParam } from './BudgetTabs.jsx';

const KIND_ORDER = Object.freeze(['REVENUE', 'KPI', 'CASH', 'EXPENSE']);
const SCOPE_OPTIONS = BUDGET_SCOPES.map((value) => ({ value, label: BUDGET_SCOPE_LABELS[value] }));
const MONTH_OPTIONS = BUDGET_MONTH_LABELS.map((label, index) => ({ value: String(index + 1), label }));
const pctFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Sapmanın görünümü: olumlu yeşil, olumsuz kırmızı; işaret yazıyla da (yalnız renge dayanmaz). */
const TONE_CLASS = Object.freeze({ GOOD: 'text-success-ink', BAD: 'text-danger-ink', NEUTRAL: 'text-ink-soft' });

/** Farkın işareti (eksi için gerçek eksi işareti). @param {number} value */
const sign = (value) => (value > 0 ? '+' : value < 0 ? '−' : '');

/** İşaretli yüzde: "+%8,6" / "−%96,6" (işaret yüzde işaretinden önce). @param {number | null} value */
const signedPct = (value) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}%${pctFormatter.format(Math.abs(value))}`);

/**
 * Sapma raporu (modül 27): seçilen ayın ya da yılbaşından o aya kadarın plan /
 * gerçekleşen / fark / fark %'si; gelir, gider ve brüt faaliyet kârı; oda
 * gelirinin doluluk ve fiyat etkisi; AI yorumu.
 */
export function VariancePage() {
  const can = useCan();
  const { year, setYear, currentYear } = useBudgetYearParam();
  const { today } = useHotelToday();
  useBudgetLive();
  // Varsayılan ay: geçmiş yılda Aralık, bu yıl geçen ay (kapanmış son ay), gelecek yılda Ocak.
  const thisMonth = Number((today ?? '').slice(5, 7)) || 1;
  const defaultMonth = year < currentYear ? 12 : year > currentYear ? 1 : Math.max(1, thisMonth - 1);
  const [month, setMonth] = useState(/** @type {number | null} */ (null));
  const [scope, setScope] = useState('MONTH');
  const params = { year, month: month ?? defaultMonth, scope };
  const report = useVariance(params);
  const data = report.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Sapma raporu" description="Bütçe planı ile gerçekleşenin farkı. Gelirde fazlası, giderde azı olumludur. İçinde bulunulan ay, kapanmış günler oranında planla karşılaştırılır." />
      <BudgetTabs year={year} />
      <div className="flex flex-wrap items-end gap-3">
        <YearPicker year={year} currentYear={currentYear} onChange={setYear} />
        <Select label="Ay" compact value={String(params.month)} onChange={(event) => setMonth(Number(event.target.value))} options={MONTH_OPTIONS} className="w-36" />
        <ChoiceChips label="Kapsam" required options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
      </div>

      {report.isPending && <Spinner label="Rapor hazırlanıyor…" className="py-12" />}
      {report.isError && <QueryError query={report} title="Sapma raporu yüklenemedi" />}
      {data && !data.basis && (
        <EmptyState icon="wallet" title={`${year} bütçesi yok`} description="Sapma, bütçe girilince hesaplanır." action={<Link to={`/butce/plan?yil=${year}`} className="font-semibold text-info-ink underline-offset-2 hover:underline">Bütçe ekranına git</Link>} />
      )}
      {data && data.basis && (
        <div className={`grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${report.isFetching && !report.isPending ? 'opacity-70' : ''}`}>
          <Card title={`${data.period.label} · ${BUDGET_SCOPE_LABELS[data.scope]}`} description={basisNote(data)}>
            {data.period.months.length === 0 ? (
              <EmptyState icon="clock" title="Henüz gerçekleşen yok" description="Seçilen dönemin kapanmış günü yok; sapma ay başladıktan sonra çıkar." />
            ) : (
              <VarianceTable data={data} />
            )}
          </Card>
          <div className="flex flex-col gap-5">
            <DriversCard data={data} />
            <CommentaryCard params={params} canRequest={can(PERMISSIONS.BUDGET_MANAGE)} hasData={data.period.months.length > 0} />
          </div>
        </div>
      )}
    </div>
  );
}

/** @param {any} data */
function basisNote(data) {
  const parts = [data.basis.status === 'APPROVED' ? `Onaylı bütçe (sürüm ${data.basis.version})` : `Onaylanmamış taslak (sürüm ${data.basis.version}) — işaretli`];
  if (data.period.partial) parts.push(`${BUDGET_MONTH_LABELS[data.period.partial.month - 1]} sürüyor: plan kapanmış günler oranında (%${pctFormatter.format(data.period.partial.sharePct)})`);
  parts.push(`tutarlar vergiler hariç, ${data.currency}`);
  return parts.join(' · ');
}

/**
 * Hücre biçimleri (para, yüzde, işaretli fark).
 * @param {string} currency
 */
function formatters(currency) {
  const money = (value) => (value === null ? '—' : formatMoney(value, currency));
  const signedMoney = (value) => (value === null ? '—' : `${sign(Number(value))}${formatMoney(Math.abs(Number(value)).toFixed(2), currency)}`);
  return {
    money,
    show: (row, value) => (value === null ? '—' : row.unit === 'PCT' ? `%${pctFormatter.format(value)}` : money(value)),
    difference: (row) => {
      if (row.difference === null) return '—';
      const value = Number(row.difference);
      if (row.unit === 'PCT') return `${sign(value)}${pctFormatter.format(Math.abs(value))} puan`;
      return signedMoney(row.difference);
    },
    signedMoney,
  };
}

/** @param {{ data: any }} props */
function VarianceTable({ data }) {
  const format = formatters(data.currency);
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: data.rows.filter((row) => row.kind === kind) })).filter((group) => group.rows.length);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th scope="col" className="px-2 py-2 font-bold">Kalem</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Plan</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Gerçekleşen</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Fark</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Fark %</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupBlock key={group.kind} group={group} format={format} />
          ))}
          <TotalRow label="Gelir toplamı" total={data.totals.revenue} format={format} />
          <TotalRow label="Gider toplamı" total={data.totals.expense} format={format} incomplete={!data.totals.expense.complete} />
          <TotalRow label="Brüt faaliyet kârı" total={data.totals.gop} format={format} incomplete={!data.totals.gop.complete} strong />
        </tbody>
      </table>
      {!data.totals.expense.complete && (
        <p className="mt-3 text-sm text-warning-ink">
          Bazı gider kalemlerinin gerçekleşeni girilmemiş; gider ve brüt faaliyet kârı eksik.{' '}
          <Link to={`/butce/gerceklesen?yil=${data.year}`} className="font-semibold underline-offset-2 hover:underline">
            Gerçekleşen giderleri gir
          </Link>
        </p>
      )}
    </div>
  );
}

/** @param {{ group: { kind: string, rows: any[] }, format: ReturnType<typeof formatters> }} props */
function GroupBlock({ group, format }) {
  return (
    <>
      <tr className="border-t border-line">
        <th colSpan={5} scope="colgroup" className="px-2 pb-1 pt-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
          {BUDGET_ITEM_KIND_LABELS[group.kind]}
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.item} className="border-t border-line/60">
          <th scope="row" className="px-2 py-1.5 text-left font-semibold text-ink">
            {row.label}
            {row.source === 'MANUAL' && !row.complete && (
              <Badge tone="warning" className="ml-2">
                eksik
              </Badge>
            )}
          </th>
          <td className="px-2 py-1.5 whitespace-nowrap text-right tabular-nums">{format.show(row, row.plan)}</td>
          <td className="px-2 py-1.5 whitespace-nowrap text-right tabular-nums">{format.show(row, row.actual)}</td>
          <td className={`px-2 py-1.5 whitespace-nowrap text-right font-semibold tabular-nums ${TONE_CLASS[row.tone]}`}>{format.difference(row)}</td>
          <td className={`px-2 py-1.5 whitespace-nowrap text-right tabular-nums ${TONE_CLASS[row.tone]}`}>
            {signedPct(row.differencePct)}
          </td>
        </tr>
      ))}
    </>
  );
}

/** @param {{ label: string, total: any, format: ReturnType<typeof formatters>, incomplete?: boolean, strong?: boolean }} props */
function TotalRow({ label, total, format, incomplete = false, strong = false }) {
  const { money } = format;
  return (
    <tr className={`border-t bg-surface-muted ${strong ? 'border-line-strong font-bold' : 'border-line font-semibold'}`}>
      <th scope="row" className="px-2 py-2 text-left text-ink">
        {label}
        {incomplete && <span className="ml-2 text-xs font-normal text-warning-ink">(eksik)</span>}
      </th>
      <td className="px-2 py-2 whitespace-nowrap text-right tabular-nums">{money(total.plan)}</td>
      <td className="px-2 py-2 whitespace-nowrap text-right tabular-nums">{money(total.actual)}</td>
      <td className={`px-2 py-2 whitespace-nowrap text-right tabular-nums ${TONE_CLASS[total.tone]}`}>{format.signedMoney(total.difference)}</td>
      <td className={`px-2 py-2 whitespace-nowrap text-right tabular-nums ${TONE_CLASS[total.tone]}`}>
        {signedPct(total.differencePct)}
      </td>
    </tr>
  );
}

/** Oda gelirinin doluluk / fiyat etkisi. @param {{ data: any }} props */
function DriversCard({ data }) {
  const drivers = data.drivers.room;
  const money = (value) => formatMoney(value, data.currency);
  const signed = (value) => `${Number(value) > 0 ? '+' : ''}${money(value)}`;
  return (
    <Card title="Oda geliri: neden saptı?" description="Doluluk etkisi = (gerçek gece − planlanan gece) × hedef ADR; fiyat etkisi = (gerçek ADR − hedef ADR) × gerçek gece.">
      {!drivers ? (
        <p className="text-sm text-ink-soft">Ayrıştırma için dönemin doluluk ve ADR hedefleri girilmeli.</p>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Doluluk etkisi</dt>
            <dd className={`font-semibold tabular-nums ${Number(drivers.occupancyEffect) < 0 ? 'text-danger-ink' : 'text-success-ink'}`}>{signed(drivers.occupancyEffect)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Fiyat (ADR) etkisi</dt>
            <dd className={`font-semibold tabular-nums ${Number(drivers.rateEffect) < 0 ? 'text-danger-ink' : 'text-success-ink'}`}>{signed(drivers.rateEffect)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-ink-soft">Gece: gerçek / planlanan</dt>
            <dd className="tabular-nums">
              {data.nights.sold} / {data.nights.planned ?? '—'}
            </dd>
          </div>
          {drivers.planGap !== null && Number(drivers.planGap) !== 0 && (
            <p className="text-xs text-ink-muted">
              Not: girilen oda geliri planı hedeflerin ima ettiğinden {money(Math.abs(Number(drivers.planGap)).toFixed(2))} {Number(drivers.planGap) > 0 ? 'düşük' : 'yüksek'}; bu fark iki etkinin dışında kalır.
            </p>
          )}
        </dl>
      )}
    </Card>
  );
}

/** @param {{ params: { year: number, month: number, scope: string }, canRequest: boolean, hasData: boolean }} props */
function CommentaryCard({ params, canRequest, hasData }) {
  const queryClient = useQueryClient();
  const query = useCommentary(params);
  const request = useMutation({
    mutationFn: () => apiPost('/budgets/commentary', params),
    onSuccess: (data) => queryClient.setQueryData(budgetKeys.commentary(params), data),
    onError: (error) => toastError(error.message),
  });
  const data = query.data;
  const commentary = data?.commentary;
  const pending = commentary?.status === 'PENDING';
  return (
    <Card
      title="AI yorumu"
      description="Sistemin hesapladığı sapmayı kısa bir paragrafla yorumlar; rakamları değiştirmez."
      actions={
        canRequest && data?.available && hasData ? (
          <Button size="sm" icon="sparkles" onClick={() => request.mutate()} disabled={pending || request.isPending}>
            {commentary ? 'Yeniden yorumla' : 'Yorumla'}
          </Button>
        ) : null
      }
    >
      {query.isPending && <Spinner className="py-4" />}
      {query.isError && <p className="text-sm text-danger-ink">Yorum yüklenemedi.</p>}
      {data && !data.available && <Alert tone="info" title="AI yorumu kullanılamıyor">{data.reason} Rapor yorumsuz da eksiksiz.</Alert>}
      {pending && <Spinner label="Yorum yazılıyor…" className="py-4" />}
      {commentary?.status === 'READY' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-6 text-ink">{commentary.text}</p>
          <p className="text-xs text-ink-muted">AI ({commentary.model}) · {new Date(commentary.completedAt).toLocaleString('tr-TR')} · rakamlar sistemden, yorum modelden.</p>
        </div>
      )}
      {commentary?.status === 'FAILED' && <Alert tone="warning" title="Yorum yapılamadı">{commentary.failureReason}</Alert>}
      {data?.available && !commentary && <p className="text-sm text-ink-soft">{hasData ? 'Bu dönem için henüz yorum istenmedi.' : 'Dönemin gerçekleşeni oluşunca yorum istenebilir.'}</p>}
    </Card>
  );
}
