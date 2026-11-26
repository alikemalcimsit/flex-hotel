import { Link } from 'react-router-dom';
import { Alert, Button, EmptyState, Icon, Spinner } from '@hotelos/ui';
import { ApproxMoney } from '../../components/MoneyText.jsx';
import { useT } from '../../i18n/index.jsx';
import { getIntlLocale } from '../../i18n/current.js';
import { eventPath } from '../../lib/banquet.js';
import { folioPath } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { checkPath } from '../../lib/pos.js';
import { appointmentPath } from '../../lib/spa.js';
import { PAYMENT_METHOD_ICONS, absolute, formatRate, kindLabel, methodLabel, originLabel, sourceLabel } from '../../lib/payments.js';

/** "14:05" etkin dilde. @param {string} value ISO zaman */
const clockText = (value) => new Intl.DateTimeFormat(getIntlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

/**
 * Günün hareketleri (son işlenen önce), "daha fazla" ile.
 * @param {{ query: import('@tanstack/react-query').UseInfiniteQueryResult, currency: string }} props
 */
export function Movements({ query, currency }) {
  const t = useT();
  if (query.isPending) return <Spinner className="py-6" />;
  if (query.isError) {
    return (
      <Alert tone="danger" title={t('cash.day.movementsFailed')} action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>{t('common.retry')}</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const rows = query.data.pages.flatMap((page) => page.movements);
  if (rows.length === 0) return <EmptyState icon="list" title={t('cash.day.noMovements')} description={t('cash.day.noMovementsHint')} />;
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-bold">{t('cash.day.time')}</th>
              <th scope="col" className="px-4 py-3 font-bold">{t('cash.day.subject')}</th>
              <th scope="col" className="px-4 py-3 font-bold">{t('cash.day.methodKind')}</th>
              <th scope="col" className="px-4 py-3 text-right font-bold">{t('cash.day.amount')}</th>
              <th scope="col" className="px-4 py-3 font-bold">{t('cash.day.reference')}</th>
              <th scope="col" className="px-4 py-3 font-bold">{t('cash.day.receivedBy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const negative = Number(row.folioAmount) < 0;
              return (
                <tr key={row.id} className={row.voided ? 'bg-surface-muted' : ''}>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top tabular-nums">{clockText(row.postedAt)}</td>
                  <td className="px-4 py-2.5 align-top">
                    {row.spa ? (
                      <>
                        <Link className="font-semibold text-info-ink underline-offset-2 hover:underline" to={appointmentPath(row.spa.id)}>
                          {row.spa.customerName}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {originLabel('SPA')} · {row.spa.code} · {row.spa.serviceName}
                        </span>
                      </>
                    ) : row.pos ? (
                      <>
                        <Link className="font-semibold text-info-ink underline-offset-2 hover:underline" to={checkPath(row.pos.id)}>
                          {row.pos.outletName}
                          {row.pos.tableName ? ` · ${t('cash.day.table', { table: row.pos.tableName })}` : ''}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {originLabel('POS')} · {row.pos.number}
                        </span>
                      </>
                    ) : row.event ? (
                      <>
                        <Link className="font-semibold text-info-ink underline-offset-2 hover:underline" to={eventPath(row.event.id, 'odemeler')}>
                          {row.event.name}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {originLabel('EVENT')} · {row.event.code}
                          {row.event.clientName ? ` · ${row.event.clientName}` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        {row.stay ? (
                          <Link className="font-semibold text-info-ink underline-offset-2 hover:underline" to={folioPath(row.stay.id, row.folioId)}>
                            {t('cash.day.roomGuest', { room: row.stay.roomNumber ?? '—', guest: row.stay.guestName })}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="block text-xs text-ink-muted">
                          {row.stay?.confirmationCode} · {row.folioName}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="flex items-center gap-1.5">
                      <Icon name={PAYMENT_METHOD_ICONS[row.method]} className="size-4 text-ink-muted" />
                      {methodLabel(row.method)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {kindLabel(row.kind)}
                      {row.kind === 'PAYMENT' && row.source && row.source !== 'DESK' ? ` · ${sourceLabel(row.source)}` : ''}
                      {row.voided ? ` · ${t('cash.day.voidedMark')}` : ''}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right align-top font-bold tabular-nums ${negative ? 'text-warning-ink' : ''} ${row.voided ? 'line-through' : ''}`}>
                    {negative ? '−' : ''}
                    {formatMoney(absolute(row.folioAmount), currency)}
                    {!row.voided && <ApproxMoney value={absolute(row.folioAmount)} currency={currency} className="block" />}
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
            {query.isFetchingNextPage ? t('common.loading') : t('cash.day.moreMovements')}
          </Button>
        </div>
      )}
    </div>
  );
}
