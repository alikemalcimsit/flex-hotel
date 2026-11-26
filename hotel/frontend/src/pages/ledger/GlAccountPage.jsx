import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { GL_ACCOUNT_CLASS_LABELS, GL_DEPARTMENT_LABELS, JOURNAL_PAGE_SIZE, JOURNAL_SOURCE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { monthStart } from '../../lib/accounting.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { ledgerKeys, useLedgerLive } from '../../lib/ledger.js';
import { signedBalanceText } from '../../lib/ledgerTree.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hesap ekstresi / kebir (modül 48): hesap başlığı (kod, ad, sınıf, departman), dönem (adres sorgusunda taşınır:
 * mizandan gelen dönem korunur), devir, satırlar (gün, fiş no → fiş, açıklama, cari / kasa izi, borç, alacak,
 * yürüyen bakiye), "daha fazla" (imleç) ve dönem toplamı. Üst hesapta alt hesapların satırları da gelir.
 */
export function GlAccountPage() {
  useLedgerLive();
  const { accountId } = useParams();
  const { today } = useHotelToday();
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency ?? '';
  const [params, setParams] = useSearchParams();
  const period = {
    from: DAY_PATTERN.test(params.get('from') ?? '') ? params.get('from') : monthStart(today),
    to: DAY_PATTERN.test(params.get('to') ?? '') ? params.get('to') : today,
  };
  const setPeriod = (patch) => setParams({ ...period, ...patch }, { replace: true });
  const lines = useInfiniteQuery({
    queryKey: ledgerKeys.accountLines(accountId, period),
    queryFn: ({ pageParam }) => api(withQuery(`/ledger/chart/${accountId}/lines`, { ...period, limit: JOURNAL_PAGE_SIZE, cursor: pageParam ?? undefined })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(period.from && period.to && period.from <= period.to),
  });
  const first = lines.data?.pages[0];
  if (!first) return <QueryFallback query={lines} errorTitle="Hesap ekstresi yüklenemedi" />;
  const { account } = first;
  const rows = lines.data.pages.flatMap((page) => page.items);
  const isParent = account.isPostable === false;
  const money = (value) => (Number(value) ? formatMoney(value) : '');
  const balanceOf = (value) => signedBalanceText(value, (amount) => formatMoney(amount));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${account.code} · ${account.name}`}
        description={[GL_ACCOUNT_CLASS_LABELS[account.class] ?? account.class, account.department ? GL_DEPARTMENT_LABELS[account.department] : null, isParent ? 'üst hesap (alt hesapların toplamı)' : null, account.isActive === false ? 'pasif' : null].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/genel-muhasebe/hesap-plani" className="text-sm font-semibold text-ink-soft hover:underline">
              ← Hesap planı
            </Link>
            <Link to={`/genel-muhasebe/mizan`} className="text-sm font-semibold text-ink-soft hover:underline">
              Mizan
            </Link>
          </div>
        }
      />

      <Card
        title="Ekstre"
        description="Dönem başı devir, gün sırasıyla fiş satırları ve yürüyen bakiye (devir + borç − alacak). (B) borç, (A) alacak bakiyesi."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Başlangıç" type="date" value={period.from} max={period.to} onChange={(event) => setPeriod({ from: event.target.value })} />
            <Input label="Bitiş" type="date" value={period.to} min={period.from} onChange={(event) => setPeriod({ to: event.target.value })} />
          </div>
        }
      >
        {lines.isError ? (
          <Alert tone="danger" title="Ekstre yüklenemedi" action={<Button size="sm" variant="outline" onClick={() => lines.refetch()}>Tekrar dene</Button>}>
            {lines.error.message}
          </Alert>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${lines.isFetching && !lines.isFetchingNextPage ? 'opacity-60' : ''}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Gün</th>
                  <th className="px-3 py-2">Fiş</th>
                  {isParent && <th className="px-3 py-2">Hesap</th>}
                  <th className="px-3 py-2">Açıklama</th>
                  <th className="px-3 py-2">Cari / kasa</th>
                  <th className="px-3 py-2 text-right">Borç</th>
                  <th className="px-3 py-2 text-right">Alacak</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-surface-muted">
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(first.from)}</td>
                  <td className="px-3 py-2 font-semibold" colSpan={isParent ? 6 : 5}>
                    Devir
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{balanceOf(first.opening)}</td>
                </tr>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={isParent ? 8 : 7} className="px-3 py-6 text-center text-ink-muted">
                      Bu dönemde fiş satırı yok.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={`border-b border-line ${row.status === 'VOIDED' ? 'text-ink-muted' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(row.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link to={`/genel-muhasebe/yevmiye/${row.entryId}`} className="font-semibold hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    {isParent && (
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <Link to={`/genel-muhasebe/hesaplar/${row.account.id}?from=${period.from}&to=${period.to}`} className="hover:underline">
                          <span className="tabular-nums">{row.account.code}</span> {row.account.name}
                        </Link>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="block">{row.description}</span>
                      <span className="block text-xs text-ink-muted">
                        {JOURNAL_SOURCE_LABELS[row.source] ?? row.source}
                        {row.status === 'VOIDED' && <Badge tone="neutral" className="ml-1">İptal edildi</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-soft">
                      {row.ledgerAccount && (
                        <Link to={`/muhasebe/cariler/${row.ledgerAccount.id}`} className="hover:underline">
                          {row.ledgerAccount.name}
                        </Link>
                      )}
                      {row.treasuryAccount && <span>{row.treasuryAccount.name}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(row.debit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(row.credit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{balanceOf(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line-strong font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={isParent ? 5 : 4}>
                    Dönem toplamı{currency ? ` · ${currency}` : ''}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(first.totals.debit)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(first.totals.credit)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{balanceOf(first.totals.closing)}</td>
                </tr>
              </tfoot>
            </table>
            {lines.hasNextPage && (
              <div className="mt-3 flex justify-center">
                <Button type="button" variant="outline" onClick={() => lines.fetchNextPage()} disabled={lines.isFetchingNextPage}>
                  {lines.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
