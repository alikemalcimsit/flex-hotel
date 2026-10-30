import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AGING_BUCKETS, INSTRUMENT_DIRECTION_LABELS, INSTRUMENT_STATUS_LABELS, LEDGER_ACCOUNT_TYPE_LABELS, LEDGER_SOURCE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { accountingKeys, balanceLabel, useAccountingLive, yearStart } from '../../lib/accounting.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { AccountDialog } from './AccountDialog.jsx';
import { OpeningDialog } from './OpeningDialog.jsx';
import { VoucherDialog } from './VoucherDialog.jsx';

const STATEMENT_PAGE = 100;

/**
 * Cari kartı (modül 47): bilgiler, bakiye, FIFO yaşlandırma, açık çek / senetler ve ekstre — dönem başı devir,
 * belge günü sırasıyla hareketler, yürüyen bakiye, dönem toplamları ("daha fazla" imleçle). Tahsilat / ödeme
 * fişi buradan cari seçili açılır.
 */
export function AccountPage() {
  useAccountingLive();
  const { accountId } = useParams();
  const can = useCan();
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const canSetup = can(PERMISSIONS.ACCOUNTING_SETUP);
  const { today } = useHotelToday();
  const [period, setPeriod] = useState(() => ({ from: yearStart(today), to: today }));
  const [dialog, setDialog] = useState(null);
  const card = useQuery({ queryKey: accountingKeys.account(accountId), queryFn: () => api(`/accounting/accounts/${accountId}`) });
  const statement = useInfiniteQuery({
    queryKey: accountingKeys.statement(accountId, period),
    queryFn: ({ pageParam }) => api(withQuery(`/accounting/accounts/${accountId}/statement`, { ...period, limit: STATEMENT_PAGE, cursor: pageParam ?? undefined })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(period.from && period.to && period.from <= period.to),
  });

  const fallback = <QueryFallback query={card} errorTitle="Cari yüklenemedi" />;
  if (!card.data) return fallback;
  const { account, currency, aging, openInstruments, opening } = card.data;
  const balance = balanceLabel(account.balance, currency);
  const first = statement.data?.pages[0];
  const rows = statement.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={account.name}
        description={`${account.code} · ${LEDGER_ACCOUNT_TYPE_LABELS[account.type]}${account.taxNumber ? ` · VKN ${account.taxNumber}` : ''} · vade ${account.paymentTermDays ? `${account.paymentTermDays} gün` : 'peşin'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/muhasebe/cariler" className="text-sm font-semibold text-ink-soft hover:underline">
              ← Cariler
            </Link>
            {canManage && account.isActive && (
              <>
                <Button type="button" icon="wallet" onClick={() => setDialog('COLLECTION')}>
                  Tahsilat
                </Button>
                <Button type="button" variant="outline" icon="coins" onClick={() => setDialog('PAYMENT')}>
                  Ödeme
                </Button>
              </>
            )}
            {canManage && (
              <Button type="button" variant="ghost" icon="pencil" onClick={() => setDialog('edit')}>
                Düzenle
              </Button>
            )}
            {canSetup && !opening && (
              <Button type="button" variant="ghost" icon="layers" onClick={() => setDialog('opening')}>
                Açılış bakiyesi
              </Button>
            )}
          </div>
        }
      />
      {!account.isActive && <Alert tone="warning" title="Kullanımdan kalkmış cari">Seçicide görünmez; geçmiş hareketleri ve ekstresi durur.</Alert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Bakiye" description="Borç − alacak: (B) cari bize borçlu, (A) biz cariye borçluyuz.">
          <p className={`text-3xl font-bold tabular-nums ${balance.side === 'CREDIT' ? 'text-warning-ink' : 'text-ink'}`}>{balance.text}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-muted">Toplam borç</dt>
            <dd className="text-right tabular-nums">{formatMoney(account.debitTotal, currency)}</dd>
            <dt className="text-ink-muted">Toplam alacak</dt>
            <dd className="text-right tabular-nums">{formatMoney(account.creditTotal, currency)}</dd>
            <dt className="text-ink-muted">Son hareket</dt>
            <dd className="text-right">{account.lastEntryOn ? formatDate(account.lastEntryOn) : '—'}</dd>
            {opening && (
              <>
                <dt className="text-ink-muted">Açılış</dt>
                <dd className="text-right tabular-nums">
                  <Link to={`/muhasebe/fisler/${opening.voucherId}`} className="hover:underline">
                    {formatMoney(opening.amount, currency)} {opening.side === 'DEBIT' ? '(B)' : '(A)'}
                  </Link>
                </dd>
              </>
            )}
          </dl>
        </Card>
        <Card title="Yaşlandırma" description={aging.side ? `${aging.side === 'DEBIT' ? 'Alacağımız' : 'Borcumuz'} vadesine göre (en eski borç önce kapanmış sayılır)` : 'Bakiye yok'}>
          {aging.side ? (
            <div className="flex flex-col gap-1.5 text-sm">
              {AGING_BUCKETS.map((bucket) => (
                <div key={bucket.key} className="flex items-center justify-between gap-3">
                  <span className={bucket.key === 'NOT_DUE' ? 'text-ink-muted' : 'text-ink'}>{bucket.label}</span>
                  <span className={`tabular-nums ${bucket.key !== 'NOT_DUE' && Number(aging.buckets[bucket.key]) > 0 ? 'font-semibold text-sec-strong' : ''}`}>{formatMoney(aging.buckets[bucket.key], currency)}</span>
                </div>
              ))}
              {aging.oldestDueDate && <p className="mt-1 text-xs text-ink-muted">En eski açık vade: {formatDate(aging.oldestDueDate)}</p>}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Cari kapalı.</p>
          )}
        </Card>
        <Card title="Açık çek / senet" description="Portföyde, tahsilde ya da ödenecek.">
          {openInstruments.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {openInstruments.map((group) => (
                <li key={`${group.direction}-${group.status}`} className="flex justify-between gap-3">
                  <span>
                    {INSTRUMENT_DIRECTION_LABELS[group.direction]} · {INSTRUMENT_STATUS_LABELS[group.status]} ({group.count})
                  </span>
                  <span className="tabular-nums">{formatMoney(group.amount, currency)}</span>
                </li>
              ))}
              <li>
                <Link to={`/muhasebe/cek-senet?ledgerAccountId=${account.id}`} className="text-xs font-semibold text-ink-soft hover:underline">
                  Portföyde göster →
                </Link>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Açık çek / senet yok.</p>
          )}
        </Card>
      </div>

      <Card
        title="Ekstre"
        description="Dönem başı devir, belge günü sırasıyla hareketler ve yürüyen bakiye."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Başlangıç" type="date" value={period.from} max={period.to} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />
            <Input label="Bitiş" type="date" value={period.to} min={period.from} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />
          </div>
        }
      >
        {statement.isPending ? (
          <Spinner className="py-8" />
        ) : statement.isError ? (
          <Alert tone="danger" title="Ekstre yüklenemedi" action={<Button size="sm" variant="outline" onClick={() => statement.refetch()}>Tekrar dene</Button>}>
            {statement.error.message}
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Tarih</th>
                  <th className="px-3 py-2">Açıklama</th>
                  <th className="px-3 py-2">Vade</th>
                  <th className="px-3 py-2 text-right">Borç</th>
                  <th className="px-3 py-2 text-right">Alacak</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-surface-muted">
                  <td className="px-3 py-2">{formatDate(first.from)}</td>
                  <td className="px-3 py-2 font-semibold" colSpan={4}>
                    Devir
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{balanceLabel(first.opening, currency).text}</td>
                </tr>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                      Bu dönemde hareket yok.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={`border-b border-line ${row.reversed || row.reversalOfId ? 'text-ink-muted' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(row.date)}</td>
                    <td className="px-3 py-2">
                      <span className="block">{row.description}</span>
                      <span className="block text-xs text-ink-muted">
                        {LEDGER_SOURCE_LABELS[row.sourceType]}
                        {row.voucherNumber && (
                          <>
                            {' · '}
                            <Link to={`/muhasebe/fisler/${row.voucherId}`} className="hover:underline">
                              {row.voucherNumber}
                            </Link>
                          </>
                        )}
                        {row.reference ? ` · ${row.reference}` : ''}
                        {row.reversed && <Badge tone="neutral" className="ml-1">İptal edildi</Badge>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{row.dueDate ? formatDate(row.dueDate) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(row.debit) ? formatMoney(row.debit) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(row.credit) ? formatMoney(row.credit) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{balanceLabel(row.balance, '').text}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line-strong font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>
                    Dönem toplamı ({first.totals.count} hareket)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(first.totals.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(first.totals.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{balanceLabel(first.closing, currency).text}</td>
                </tr>
              </tfoot>
            </table>
            {statement.hasNextPage && (
              <div className="mt-3 flex justify-center">
                <Button type="button" variant="outline" onClick={() => statement.fetchNextPage()} disabled={statement.isFetchingNextPage}>
                  {statement.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {(dialog === 'COLLECTION' || dialog === 'PAYMENT') && <VoucherDialog type={dialog} account={{ ...account, balance: account.balance }} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <AccountDialog account={account} onClose={() => setDialog(null)} />}
      {dialog === 'opening' && <OpeningDialog target={{ kind: 'ledger', id: account.id, name: account.name }} onClose={() => setDialog(null)} />}
    </div>
  );
}
