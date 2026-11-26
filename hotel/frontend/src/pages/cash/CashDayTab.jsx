import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CASH_ORIGINS, CASH_PAGE_SIZE, PAYMENT_KINDS, PAYMENT_METHODS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select } from '@hotelos/ui';
import { MoneyText } from '../../components/MoneyText.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Switch } from '../../components/Switch.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, withQuery } from '../../lib/api.js';
import { eventPath } from '../../lib/banquet.js';
import { folioPath } from '../../lib/folios.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { checkPath } from '../../lib/pos.js';
import { appointmentPath } from '../../lib/spa.js';
import { PAYMENT_METHOD_ICONS, absolute, cashKeys, kindLabel, methodLabel, originLabel } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CASH_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { Movements } from './CashMovements.jsx';

const OFFLINE_REFRESH_MS = 60_000;
/**
 * Yoğun saatte (çıkış sabahı yüzlerce ödeme) açık her kasa ekranı her ödemede
 * toplam sormasın: iki tazeleme arası en az bu kadar.
 */
const LIVE_MIN_INTERVAL_MS = 3000;

/**
 * Günlük kasa (modül 17): seçilen iş gününün işlenen hareketleri yöntem (ve
 * döviz) bazında — tahsilat, iade, iptal, net —, onay bekleyen ödemeler ve
 * hareket listesi. "Yalnızca benim" kendi çekmecesini gösterir. Başka
 * personelin ödemesi canlı yansır.
 */
export function CashDayTab() {
  const t = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const date = params.get('gun') ?? undefined;
  const mine = params.get('benim') === '1';
  const [method, setMethod] = useState('');
  const [kind, setKind] = useState('');
  const [origin, setOrigin] = useState('');
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

  // Geçmiş gün kapanmıştır (ödeme işlendiği iş gününe yazılır): yalnızca bugün canlı.
  const { isLive } = useLiveChannel(CASH_CHANNEL, {
    queryKeys: [cashKeys.summary({ date, mine }), ['cash', 'movements']],
    enabled: !date,
    minIntervalMs: LIVE_MIN_INTERVAL_MS,
  });
  const summary = useQuery({
    queryKey: cashKeys.summary({ date, mine }),
    queryFn: () => api(withQuery('/payments/cash/summary', { date, mine })),
    refetchInterval: date || isLive ? false : OFFLINE_REFRESH_MS,
  });
  const movementFilters = { date, mine, method: method || undefined, kind: kind || undefined, origin: origin || undefined };
  const movements = useInfiniteQuery({
    queryKey: cashKeys.movements(movementFilters),
    queryFn: ({ pageParam }) => api(withQuery('/payments/cash/movements', { ...movementFilters, cursor: pageParam ?? undefined, limit: CASH_PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (!summary.data) return <QueryFallback query={summary} errorTitle={t('cash.day.loadFailed')} />;
  const data = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('cash.day.businessDay')}
          type="date"
          value={data.date}
          max={data.businessDate}
          onChange={(event) => setParam('gun', event.target.value && event.target.value !== data.businessDate ? event.target.value : '')}
          className="w-44"
        />
        {!data.isToday && (
          <Button variant="outline" icon="calendar" onClick={() => setParam('gun', '')}>{t('common.today')}</Button>
        )}
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
          <Switch checked={mine} onChange={(next) => setParam('benim', next ? '1' : '')} label={t('cash.day.onlyMine')} />
          {t('cash.day.onlyMine')}
        </label>
        {data.isToday && <Badge tone={isLive ? 'success' : 'warning'} className="mb-2 ml-auto">{isLive ? t('common.live') : t('common.notLive')}</Badge>}
      </div>

      <MethodTotals data={data} />
      <PendingPayments pending={data.pending} currency={data.currency} canDecide={can(PERMISSIONS.APPROVALS_VIEW)} />

      <section className="flex flex-col gap-3" aria-labelledby="cash-movements">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="cash-movements" className="text-base font-bold text-ink">{t('cash.day.movements')}</h2>
          <div className="flex flex-wrap gap-2">
            <Select
              compact
              label={t('cash.day.method')}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              options={[{ value: '', label: t('cash.day.allMethods') }, ...PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }))]}
            />
            <Select
              compact
              label={t('cash.day.kind')}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={[{ value: '', label: t('cash.day.allKinds') }, ...PAYMENT_KINDS.map((value) => ({ value, label: kindLabel(value) }))]}
            />
            <Select
              compact
              label={t('cash.day.origin')}
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              options={[{ value: '', label: t('cash.day.allOrigins') }, ...CASH_ORIGINS.map((value) => ({ value, label: originLabel(value) }))]}
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
  const t = useT();
  const { currency, total } = data;
  const scope = data.mine ? t('cash.day.myDrawer') : t('cash.day.allDrawers');
  return (
    <Card title={data.isToday ? t('cash.day.totalsTitleToday', { date: formatDate(data.date), scope }) : t('cash.day.totalsTitle', { date: formatDate(data.date), scope })}>
      {data.methods.length === 0 ? (
        <EmptyState icon="wallet" title={t('cash.day.emptyTitle')} description={t('cash.day.emptyDescription')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">{t('cash.day.method')}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{t('cash.day.count')}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{t('cash.day.received')}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{t('cash.day.refunded')}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{t('cash.day.voided')}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">{t('cash.day.net')}</th>
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
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-bold tabular-nums"><MoneyText value={line.net} currency={currency} block /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              <tr>
                <th scope="row" className="px-3 py-2.5 text-left font-bold">{t('cash.day.total')}</th>
                <td />
                <td className="px-3 py-2.5 text-right font-bold tabular-nums"><MoneyText value={total.received} currency={currency} block /></td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-warning-ink">{Number(total.refunded) ? `−${formatMoney(absolute(total.refunded))}` : '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{Number(total.voided) ? formatMoney(total.voided) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums"><MoneyText value={total.net} currency={currency} block /></td>
              </tr>
            </tfoot>
          </table>
          {data.origins && (Number(data.origins.EVENT) !== 0 || Number(data.origins.POS) !== 0 || Number(data.origins.SPA ?? 0) !== 0) && (
            <p className="mt-2 text-sm text-ink-soft">
              {t('cash.day.originPrefix')}{' '}
              {CASH_ORIGINS.map((origin, index) => (
                <span key={origin}>
                  {index > 0 && ' · '}
                  {originLabel(origin)} <strong className="tabular-nums">{formatMoney(data.origins[origin] ?? '0', currency)}</strong>
                </span>
              ))}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            {t('cash.day.footnote')}
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
  const t = useT();
  if (pending.count === 0) return null;
  return (
    <Alert
      tone="warning"
      title={t('cash.day.pendingTitle', { count: pending.count })}
      action={
        canDecide && (
          <Link to="/onaylar/bekleyen">
            <Button size="sm" variant="outline" icon="checkCheck">{t('cash.day.goToApprovals')}</Button>
          </Link>
        )
      }
    >
      <span className="block">
        {t('cash.day.pendingHint')}
      </span>
      <ul className="mt-2 flex flex-col gap-1">
        {pending.items.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-semibold">{kindLabel(row.kind)}</span>
            <span className="tabular-nums">{formatMoney(absolute(row.folioAmount), currency)}</span>
            <span className="text-ink-muted">· {methodLabel(row.method)}</span>
            {row.stay && (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={folioPath(row.stay.id, row.folioId)}>
                {t('cash.day.roomGuest', { room: row.stay.roomNumber ?? '—', guest: row.stay.guestName })}
              </Link>
            )}
            {row.event && (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={eventPath(row.event.id, 'odemeler')}>
                {t('cash.day.eventRef', { code: row.event.code, name: row.event.name })}
              </Link>
            )}
            {row.pos && (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={checkPath(row.pos.id)}>
                {row.pos.outletName} · {row.pos.number}
                {row.pos.tableName ? ` · ${t('cash.day.table', { table: row.pos.tableName })}` : ''}
              </Link>
            )}
            {row.spa && (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={appointmentPath(row.spa.id)}>
                {t('cash.day.spaRef', { code: row.spa.code, name: row.spa.customerName })}
              </Link>
            )}
            <span className="text-xs text-ink-muted">
              {formatDate(row.receivedAt)} · {row.receivedBy}
            </span>
          </li>
        ))}
        {pending.count > pending.items.length && <li className="text-xs text-ink-muted">{t('cash.day.andMore', { count: pending.count - pending.items.length })}</li>}
      </ul>
    </Alert>
  );
}
