import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LOYALTY_ACCOUNT_STATUS_LABELS, LOYALTY_TRANSACTION_KIND_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format.js';
import { LOYALTY_PAGE_SIZE, loyaltyKeys, pointsText, pointsTone, signedPoints, tierTone, useLoyaltyLive } from '../../lib/loyalty.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { AdjustDialog } from './AdjustDialog.jsx';
import { TierProgress, useLoyaltyTiers } from './TierProgress.jsx';

/**
 * Sadakat hesabı (modül 56): numara, misafir, seviye ve avantajlar, sonraki seviyeye kalan, bakiye ve karşılığı,
 * ömür boyu kazanılan, yakında süresi dolacak puan; sayfalı hareketler. "Düzeltme" `loyalty.manage` ister.
 */
export function AccountPage() {
  useLoyaltyLive();
  const { accountId } = useParams();
  const can = useCan();
  const [adjusting, setAdjusting] = useState(false);
  const query = useQuery({ queryKey: loyaltyKeys.account(accountId), queryFn: () => api(`/loyalty/accounts/${accountId}`) });
  const { tiers } = useLoyaltyTiers();
  if (!query.data) return <QueryFallback query={query} errorTitle="Sadakat hesabı yüklenemedi" />;
  const { account, expiring, currency } = query.data;
  const canManage = can(PERMISSIONS.LOYALTY_MANAGE);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Sadakat hesabı ${account.number}`}
        description={account.guestName ?? undefined}
        actions={
          <span className="flex flex-wrap gap-2">
            <Link to="/sadakat/uyeler" className="inline-flex items-center gap-1.5 rounded-control border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-line-strong">
              Üyeler
            </Link>
            {canManage && account.status === 'ACTIVE' && (
              <Button type="button" variant="outline" icon="pencil" onClick={() => setAdjusting(true)}>
                Düzeltme
              </Button>
            )}
          </span>
        }
      />
      {account.status !== 'ACTIVE' && <Alert tone="info">Hesap {LOYALTY_ACCOUNT_STATUS_LABELS[account.status]?.toLowerCase() ?? 'kapalı'}: puan kazanmaz ve harcanmaz.</Alert>}
      <AccountCard account={account} expiring={expiring} currency={currency} tiers={tiers} />
      <Transactions accountId={accountId} currency={currency} />
      {adjusting && <AdjustDialog account={account} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

/** @param {{ account: any, expiring: { points: number, firstOn: string | null }, currency: string, tiers: any[] }} props */
function AccountCard({ account, expiring, currency, tiers }) {
  return (
    <Card title="Hesap" actions={<Badge tone={tierTone(account.tier.code, tiers)}>{account.tier.name}</Badge>}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Bakiye" value={pointsText(account.balance)} hint={formatMoney(account.balanceValue, currency)} strong />
          <Stat label="Ömür boyu" value={pointsText(account.lifetimePoints)} hint="Toplam kazanılan" />
          <Stat label="Misafir" value={<Link to={`/misafirler/${account.guestId}`} className="hover:underline">{account.guestName ?? '—'}</Link>} hint={`Üye: ${formatDate(account.enrolledAt)}${account.enrolledBy ? ` · ${account.enrolledBy}` : ''}`} />
          <Stat label="Son hareket" value={formatDateTime(account.lastActivityAt)} hint={account.consentAt ? `Açık rıza ${formatDate(account.consentAt)}` : 'Otomatik üyelik'} />
        </dl>
        <TierProgress account={account} tiers={tiers} />
        {account.tier.perks && (
          <p className="rounded-item bg-surface-muted px-3 py-2 text-sm text-ink-soft">
            <span className="font-semibold text-ink">{account.tier.name} avantajları:</span> {account.tier.perks}
          </p>
        )}
        {expiring?.points > 0 && (
          <Alert tone="warning">
            {pointsText(expiring.points)} en geç {formatDate(expiring.firstOn)} tarihinden itibaren süresi dolarak düşecek.
          </Alert>
        )}
      </div>
    </Card>
  );
}

/** @param {{ label: string, value: React.ReactNode, hint?: string, strong?: boolean }} props */
function Stat({ label, value, hint, strong = false }) {
  return (
    <div className="rounded-item bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-bold text-ink' : 'font-semibold text-ink'}`}>{value}</dd>
      {hint && <dd className="text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}

/** @param {{ accountId: string, currency: string }} props */
function Transactions({ accountId, currency }) {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: loyaltyKeys.transactions(accountId, page),
    queryFn: () => api(withQuery(`/loyalty/accounts/${accountId}/transactions`, { page, pageSize: LOYALTY_PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: 'kind', header: 'Tür', render: (row) => LOYALTY_TRANSACTION_KIND_LABELS[row.kind] ?? row.kind },
    { key: 'points', header: 'Puan', className: 'text-right tabular-nums whitespace-nowrap', render: (row) => <span className={`font-semibold ${pointsTone(row.points)}`}>{signedPoints(row.points)}</span> },
    { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums whitespace-nowrap', render: (row) => (Number(row.amount) ? formatMoney(row.amount, currency) : '—') },
    { key: 'description', header: 'Açıklama', render: (row) => <span className="block max-w-sm text-sm text-ink-soft">{row.description ?? '—'}</span> },
    {
      key: 'expires',
      header: 'Son kullanma',
      className: 'whitespace-nowrap text-xs',
      render: (row) => (row.expiresOn ? <span>{formatDate(row.expiresOn)}{row.remaining > 0 ? <span className="block text-ink-muted">kalan {pointsText(row.remaining)}</span> : null}</span> : '—'),
    },
    {
      key: 'who',
      header: 'Kim / ne zaman',
      className: 'whitespace-nowrap text-xs text-ink-soft',
      render: (row) => (
        <span className="block">
          <span className="block">{row.createdBy ?? 'Sistem'}</span>
          <span className="block text-ink-muted">{formatDateTime(row.createdAt)}</span>
        </span>
      ),
    },
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-ink">Hareketler</h2>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Hareket yok"
        emptyHint="Puan folyo kapanınca kazanılır."
        rowActions={(row) =>
          row.reservationId ? (
            <Link to={`/rezervasyonlar/${row.reservationId}`} className="inline-flex items-center rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
              Rezervasyon
            </Link>
          ) : null
        }
      />
    </section>
  );
}
