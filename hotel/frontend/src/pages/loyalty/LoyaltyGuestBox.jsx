import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loyaltyEnrollSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Spinner } from '@hotelos/ui';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { loyaltyKeys, pointsText, tierTone, useLoyaltyLive } from '../../lib/loyalty.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { LoyaltyFormDialog, useLoyaltySubmit } from './LoyaltyFormDialog.jsx';
import { TierProgress, useLoyaltyTiers } from './TierProgress.jsx';

/**
 * Misafir kartındaki sadakat kutusu (modül 56, `loyalty.view`): program kapalıysa çizilmez. Üye değilse "Üye yap"
 * (`loyalty.redeem`, KVKK açık rıza işareti); üyeyse numara, seviye, bakiye ve karşılığı, sonraki seviye, süresi
 * dolacak puan uyarısı ve hesaba bağlantı.
 * @param {{ guestId: string }} props
 */
export function LoyaltyGuestBox({ guestId }) {
  useLoyaltyLive();
  const can = useCan();
  const [enrolling, setEnrolling] = useState(false);
  const query = useQuery({ queryKey: loyaltyKeys.guest(guestId), queryFn: () => api(`/loyalty/guests/${guestId}`) });
  const { tiers, currency } = useLoyaltyTiers();

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
  const { program, account, expiring } = query.data;
  if (!program.isEnabled) return null;

  if (!account || account.status !== 'ACTIVE') {
    return (
      <Card title={program.programName} actions={<Badge tone="neutral">Üye değil</Badge>}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
          <p>{account ? 'Sadakat hesabı kapalı.' : program.autoEnroll ? 'İlk folyo kapanışında kendiliğinden üye olur.' : 'Otomatik üyelik kapalı: puan kazanması için üye yapın.'}</p>
          {!account && can(PERMISSIONS.LOYALTY_REDEEM) && (
            <Button type="button" size="sm" variant="outline" icon="star" onClick={() => setEnrolling(true)}>
              Üye yap
            </Button>
          )}
        </div>
        {enrolling && <EnrollDialog guestId={guestId} programName={program.programName} onClose={() => setEnrolling(false)} />}
      </Card>
    );
  }

  return (
    <Card
      title={program.programName}
      description={`Üye no ${account.number}`}
      actions={
        <span className="flex items-center gap-2">
          <Badge tone={tierTone(account.tier.code, tiers)}>{account.tier.name}</Badge>
          <Link to={`/sadakat/uyeler/${account.id}`} className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline">
            Hesap
          </Link>
        </span>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums text-ink">{pointsText(account.balance)}</span>
          <span className="ml-2 text-ink-muted">{formatMoney(account.balanceValue, currency)} değerinde</span>
        </p>
        <TierProgress account={account} tiers={tiers} />
        {account.tier.perks && <p className="text-ink-soft">{account.tier.perks}</p>}
        {expiring?.points > 0 && <Alert tone="warning">{pointsText(expiring.points)} {formatDate(expiring.firstOn)} tarihinden itibaren süresi dolarak düşecek.</Alert>}
      </div>
    </Card>
  );
}

/** Üye yap: misafirin açık rızası işaretlenmeden gönderilmez. @param {{ guestId: string, programName: string, onClose: () => void }} props */
function EnrollDialog({ guestId, programName, onClose }) {
  const queryClient = useQueryClient();
  const [consent, setConsent] = useState(false);
  const { submit, errors, serverError, busy } = useLoyaltySubmit({
    schema: loyaltyEnrollSchema,
    request: (body) => apiPost(`/loyalty/guests/${guestId}/enroll`, body),
    success: (result) => `Üye yapıldı: ${result.account?.number ?? ''}`.trim(),
    onSuccess: (result) => queryClient.setQueryData(loyaltyKeys.guest(guestId), result),
    onClose,
  });
  return (
    <LoyaltyFormDialog title={`${programName}: üye yap`} formId="loyalty-enroll-form" busy={busy} onClose={onClose} submitLabel="Üye yap" submitIcon="star" serverError={serverError} submitDisabled={!consent}>
      <form
        id="loyalty-enroll-form"
        noValidate
        className="flex flex-col gap-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ consent });
        }}
      >
        <p className="text-ink-soft">Misafir puan kazanır ve konaklamada puanla indirim alabilir. Kişisel verileri sadakat programı için işlenir.</p>
        <Checkbox label="Misafir açık rızasını verdi (KVKK)" name="loyalty-consent" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} />
        {errors.consent && <p className="text-xs font-bold text-sec-strong">{errors.consent}</p>}
      </form>
    </LoyaltyFormDialog>
  );
}
