import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LOYALTY_TRANSACTION_KIND_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { loyaltyKeys, pointsText, pointsTone, signedPoints, tierTone, useLoyaltyLive } from '../../lib/loyalty.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RedeemDialog } from './RedeemDialog.jsx';

/** Kartta gösterilen son hareket sayısı. */
const HISTORY_LIMIT = 5;

/**
 * Rezervasyon ayrıntısındaki sadakat kartı (modül 56, `loyalty.view`; program kapalıysa çizilmez): misafirin hesap
 * özeti, açık folyo(lar) için "Puan kullan" (`loyalty.redeem`) ve bu konaklamanın son puan hareketleri.
 * @param {{ reservationId: string }} props
 */
export function LoyaltyReservationCard({ reservationId }) {
  useLoyaltyLive();
  const can = useCan();
  const [folio, setFolio] = useState(null);
  const query = useQuery({ queryKey: loyaltyKeys.reservation(reservationId), queryFn: () => api(`/loyalty/reservations/${reservationId}`) });

  if (query.isPending) return <Card title="Sadakat"><Spinner label="Yükleniyor…" className="py-4" /></Card>;
  if (query.isError) {
    return (
      <Card title="Sadakat">
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      </Card>
    );
  }
  const { program, currency, guestId, account, folios, history } = query.data;
  if (!program.isEnabled) return null;
  const isMember = account?.status === 'ACTIVE';
  const canRedeem = can(PERMISSIONS.LOYALTY_REDEEM) && isMember;

  return (
    <Card
      title={program.programName}
      description={isMember ? `Üye no ${account.number}` : undefined}
      actions={isMember ? <Badge tone={tierTone(account.tier.code)}>{account.tier.name}</Badge> : <Badge tone="neutral">Üye değil</Badge>}
    >
      <div className="flex flex-col gap-3 text-sm">
        {!isMember && (
          <p className="text-ink-soft">
            {program.autoEnroll ? 'Misafir üye değil; ilk folyo kapanışında kendiliğinden üye olur.' : 'Misafir üye değil; misafir kartından üye yapılabilir.'}{' '}
            <Link to={`/misafirler/${guestId}`} className="font-semibold text-ink hover:underline">
              Misafir kartı
            </Link>
          </p>
        )}
        {isMember && (
          <>
            <p>
              <span className="text-xl font-bold tabular-nums text-ink">{pointsText(account.balance)}</span>
              <span className="ml-2 text-ink-muted">{formatMoney(account.balanceValue, currency)} değerinde</span>
              <Link to={`/sadakat/uyeler/${account.id}`} className="ml-3 text-xs font-semibold text-ink-muted hover:text-ink hover:underline">
                Hesap
              </Link>
            </p>
            {account.tier.perks && <p className="text-ink-soft">{account.tier.perks}</p>}
            {folios.length === 0 ? (
              <p className="text-xs text-ink-muted">Açık folyo yok: puan girişten sonra, folyo açıkken kullanılır.</p>
            ) : (
              <ul className="divide-y divide-line">
                {folios.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-semibold text-ink">Folyo {row.window}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {row.maxPoints > 0 ? `en çok ${pointsText(row.maxPoints)} (${formatMoney(row.maxAmount, currency)})` : `kullanılamaz: en az ${pointsText(program.minRedeemPoints)}, harcamanın en çok %${program.maxRedeemPct}'i`}
                      </span>
                    </span>
                    {canRedeem && row.maxPoints > 0 && (
                      <Button type="button" size="sm" variant="outline" icon="star" onClick={() => setFolio(row)}>
                        Puan kullan
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {history.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs">
            {history.slice(0, HISTORY_LIMIT).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span className="text-ink-soft">
                  {LOYALTY_TRANSACTION_KIND_LABELS[row.kind] ?? row.kind} · {formatDateTime(row.createdAt)}
                </span>
                <span className={`font-semibold tabular-nums ${pointsTone(row.points)}`}>{signedPoints(row.points)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {folio && <RedeemDialog reservationId={reservationId} folio={folio} program={program} balance={account.balance} currency={currency} onClose={() => setFolio(null)} />}
    </Card>
  );
}
