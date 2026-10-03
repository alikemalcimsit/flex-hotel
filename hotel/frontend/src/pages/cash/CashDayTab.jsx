import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CASH_PAGE_SIZE, PAYMENT_KINDS, PAYMENT_METHODS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api, withQuery } from '../../lib/api.js';
import { folioPath } from '../../lib/folios.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import {
  PAYMENT_METHOD_ICONS,
  absolute,
  cashKeys,
  formatRate,
  kindLabel,
  methodLabel,
  sourceLabel,
} from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CASH_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

const OFFLINE_REFRESH_MS = 60_000;
const timeFormatter = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

/**
 * Günlük kasa (modül 17): seçilen iş gününün işlenen hareketleri yöntem (ve
 * döviz) bazında — tahsilat, iade, iptal, net —, onay bekleyen ödemeler ve
 * hareket listesi. "Yalnızca benim" kendi çekmecesini gösterir. Başka
 * personelin ödemesi canlı yansır.
 */
export function CashDayTab() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const date = params.get('gun') ?? undefined;
  const mine = params.get('benim') === '1';
  const [method, setMethod] = useState('');
  const [kind, setKind] = useState('');
  const setParam = (key, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const { isLive } = useLiveChannel(CASH_CHANNEL, { queryKeys: [cashKeys.all] });
  const summary = useQuery({
    queryKey: cashKeys.summary({ date, mine }),
    queryFn: () => api(withQuery('/payments/cash/summary', { date, mine })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const movementFilters = { date, mine, method: method || undefined, kind: kind || undefined };
  const movements = useInfiniteQuery({
    queryKey: cashKeys.movements(movementFilters),
    queryFn: ({ pageParam }) => api(withQuery('/payments/cash/movements', { ...movementFilters, cursor: pageParam ?? undefined, limit: CASH_PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (!summary.data) return <QueryFallback query={summary} errorTitle="Kasa yüklenemedi" />;
  const data = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="İş günü"
          type="date"
          value={data.date}
          max={data.businessDate}
          onChange={(event) => setParam('gun', event.target.value && event.target.value !== data.businessDate ? event.target.value : '')}
          className="w-44"
        />
        {!data.isToday && (
          <Button variant="outline" icon="calendar" onClick={() => setParam('gun', '')}>Bugün</Button>
        )}
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
          <Switch checked={mine} onChange={(next) => setParam('benim', next ? '1' : '')} label="Yalnızca benim aldıklarım" />
          Yalnızca benim aldıklarım
        </label>
        <Badge tone={isLive ? 'success' : 'warning'} className="mb-2 ml-auto">{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
      </div>

      <MethodTotals data={data} />
      <PendingPayments pending={data.pending} currency={data.currency} canDecide={can(PERMISSIONS.APPROVALS_VIEW)} />

      <section className="flex flex-col gap-3" aria-labelledby="cash-movements">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="cash-movements" className="text-base font-bold text-ink">Hareketler</h2>
          <div className="flex flex-wrap gap-2">
            <Select
              compact
              label="Yöntem"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              options={[{ value: '', label: 'Bütün yöntemler' }, ...PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }))]}
            />
            <Select
              compact
              label="Tür"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={[{ value: '', label: 'Bütün türler' }, ...PAYMENT_KINDS.map((value) => ({ value, label: kindLabel(value) }))]}
            />
          </div>
        </div>
        <Movements query={movements} currency={data.currency} />
      </section>
    </div>
  );
}

/**
 * Yöntem başına tahsilat / iade / iptal / net (folyo para biriminde); dövizde kasadaki döviz.
 * @param {{ data: any }} props
 */
function MethodTotals({ data }) {
  const { currency, total } = data;
  return (
    <Card title={`${formatDate(data.date)}${data.isToday ? ' (bugün)' : ''} · ${data.mine ? 'benim kasam' : 'bütün kasa'}`}>
      {data.methods.length === 0 ? (
        <EmptyState icon="wallet" title="Bu gün işlenmiş ödeme yok" description="Ödeme alındıkça burada yöntem bazında toplanır." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Yöntem</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Adet</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Tahsilat</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">İade</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">İptal</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.methods.map((line) => (
                <tr key={line.method}>
                  <td className="px-3 py-2.5 align-top">
                    <span className="flex items-center gap-2 font-semibold">
                      <Icon name={PAYMENT_METHOD_ICONS[line.method]} className="size-4 text-ink-muted" />
                      {methodLabel(line.method)}
                    </span>
                    {line.currencies.some((row) => row.currency !== currency) &&
                      line.currencies.map((row) => (
                        <span key={row.currency} className="ml-6 block whitespace-nowrap text-xs text-ink-muted">
                          {formatMoney(row.amount, row.currency)}
                          {row.currency !== currency ? ` (${formatMoney(row.folioAmount, currency)})` : ''}
                        </span>
                      ))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">{line.count}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">{formatMoney(line.received, currency)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums text-warning-ink">{Number(line.refunded) ? `−${formatMoney(absolute(line.refunded))}` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums text-ink-muted">{Number(line.voided) ? formatMoney(line.voided) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-bold tabular-nums">{formatMoney(line.net, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              <tr>
                <th scope="row" className="px-3 py-2.5 text-left font-bold">Toplam</th>
                <td />
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatMoney(total.received, currency)}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-warning-ink">{Number(total.refunded) ? `−${formatMoney(absolute(total.refunded))}` : '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{Number(total.voided) ? formatMoney(total.voided) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums">{formatMoney(total.net, currency)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-ink-muted">
            İptal: hatalı girişin düzeltmesi (iptal kaydının günü). Dövizde parantez içi folyoya giren karşılık; nakit dövizi çekmecede kendi para biriminde sayın.
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * Onay bekleyen ödeme / iadeler: para çekmecede olabilir ama defterde değil.
 * @param {{ pending: { count: number, items: any[] }, currency: string, canDecide: boolean }} props
 */
function PendingPayments({ pending, currency, canDecide }) {
  if (pending.count === 0) return null;
  return (
    <Alert
      tone="warning"
      title={`Onay bekleyen ${pending.count} ödeme / iade`}
      action={
        canDecide && (
          <Link to="/onaylar/bekleyen">
            <Button size="sm" variant="outline" icon="checkCheck">Onaylara git</Button>
          </Link>
        )
      }
    >
      <span className="block">
        Onaylanınca bakiyeye ve kasa toplamına girer. Onay bekleyen tahsilatın parası çekmecede ayrı tutulmalı; onay bekleyen iade henüz
        ödenmemeli.
      </span>
      <ul className="mt-2 flex flex-col gap-1">
        {pending.items.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-semibold">{kindLabel(row.kind)}</span>
            <span className="tabular-nums">{formatMoney(absolute(row.folioAmount), currency)}</span>
            <span className="text-ink-muted">· {methodLabel(row.method)}</span>
            {row.stay && (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={folioPath(row.stay.id, row.folioId)}>
                oda {row.stay.roomNumber ?? '—'} · {row.stay.guestName}
              </Link>
            )}
            <span className="text-xs text-ink-muted">
              {formatDate(row.receivedAt)} · {row.receivedBy}
            </span>
          </li>
        ))}
        {pending.count > pending.items.length && <li className="text-xs text-ink-muted">ve {pending.count - pending.items.length} tane daha</li>}
      </ul>
    </Alert>
  );
}

/**
 * Günün hareketleri (son işlenen önce), "daha fazla" ile.
 * @param {{ query: import('@tanstack/react-query').UseInfiniteQueryResult, currency: string }} props
 */
function Movements({ query, currency }) {
  if (query.isPending) return <Spinner className="py-6" />;
  if (query.isError) {
    return (
      <Alert tone="danger" title="Hareketler yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const rows = query.data.pages.flatMap((page) => page.movements);
  if (rows.length === 0) return <EmptyState icon="list" title="Hareket yok" description="Seçilen gün ve süzgeçte işlenmiş ödeme yok." />;
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-bold">Saat</th>
              <th scope="col" className="px-4 py-3 font-bold">Konaklama</th>
              <th scope="col" className="px-4 py-3 font-bold">Yöntem / tür</th>
              <th scope="col" className="px-4 py-3 text-right font-bold">Tutar</th>
              <th scope="col" className="px-4 py-3 font-bold">Referans</th>
              <th scope="col" className="px-4 py-3 font-bold">Alan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const negative = Number(row.folioAmount) < 0;
              return (
                <tr key={row.id} className={row.voided ? 'bg-surface-muted' : ''}>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top tabular-nums">{timeFormatter.format(new Date(row.postedAt))}</td>
                  <td className="px-4 py-2.5 align-top">
                    {row.stay ? (
                      <Link className="font-semibold text-info-ink underline-offset-2 hover:underline" to={folioPath(row.stay.id, row.folioId)}>
                        oda {row.stay.roomNumber ?? '—'} · {row.stay.guestName}
                      </Link>
                    ) : (
                      '—'
                    )}
                    <span className="block text-xs text-ink-muted">
                      {row.stay?.confirmationCode} · {row.folioName}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="flex items-center gap-1.5">
                      <Icon name={PAYMENT_METHOD_ICONS[row.method]} className="size-4 text-ink-muted" />
                      {methodLabel(row.method)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {kindLabel(row.kind)}
                      {row.kind === 'PAYMENT' && row.source !== 'DESK' ? ` · ${sourceLabel(row.source)}` : ''}
                      {row.voided ? ' · iptal edildi' : ''}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right align-top font-bold tabular-nums ${negative ? 'text-warning-ink' : ''} ${row.voided ? 'line-through' : ''}`}>
                    {negative ? '−' : ''}
                    {formatMoney(absolute(row.folioAmount), currency)}
                    {row.currency !== currency && (
                      <span className="block text-xs font-normal text-ink-muted">
                        {formatMoney(absolute(row.amount), row.currency)} × {formatRate(row.exchangeRate)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-xs text-ink-soft">{row.reference ?? '—'}</td>
                  <td className="px-4 py-2.5 align-top text-xs text-ink-soft">{row.receivedBy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {query.hasNextPage && (
        <div className="border-t border-line px-4 py-3 text-center">
          <Button size="sm" variant="outline" icon="arrowDown" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla hareket'}
          </Button>
        </div>
      )}
    </div>
  );
}
