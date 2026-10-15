import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { useAgencyBonusLive, useBonusRule } from '../../lib/agencyBonus.js';
import { agencyKeys } from '../../lib/agencies.js';
import { api, withQuery } from '../../lib/api.js';
import { BonusRuleForm } from './BonusRuleForm.jsx';

/**
 * Yeni prim kuralı (modül 35). Acente kartından gelinirse (`?acente=`) acente
 * seçili gelir.
 */
export function NewBonusRulePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const agencyId = params.get('acente');
  const preset = useQuery({
    queryKey: agencyKeys.options({ id: agencyId }),
    queryFn: () => api(withQuery('/agencies/options', { id: agencyId })),
    enabled: Boolean(agencyId),
  });
  const agency = preset.data?.items?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={agencyId ? `/acenteler/${agencyId}/prim` : '/acente-primleri'} label={agencyId ? 'Acente' : 'Acente primleri'} />
      <PageHeader title="Yeni prim kuralı" description="Acentenin dönem hedefi ve kademeli prim oranları. Taslak açılır; kontrol edip yürürlüğe alırsınız." />
      {agencyId && (preset.isPending || preset.isError) ? (
        <QueryFallback query={preset} errorTitle="Acente yüklenemedi" />
      ) : (
        <BonusRuleForm
          key={agency?.id ?? 'empty'}
          defaultAgency={agency ? { id: agency.id, code: agency.code, name: agency.name } : null}
          onSaved={(rule) => navigate(`/acente-primleri/kural/${rule.id}`)}
          onCancel={() => navigate(-1)}
        />
      )}
    </div>
  );
}

/** Kuralı düzenler (taslak ya da yürürlükte; hak edişi onaya gitmemişse). */
export function EditBonusRulePage() {
  const { ruleId } = useParams();
  const navigate = useNavigate();
  const query = useBonusRule(ruleId);
  useAgencyBonusLive();

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink to={`/acente-primleri/kural/${ruleId}`} label="Kural" />
        <QueryFallback query={query} errorTitle="Kural yüklenemedi" />
      </div>
    );
  }
  const rule = query.data;
  const locked = rule.status === 'CANCELLED' || (rule.bonus && rule.bonus.status !== 'DRAFT');
  return (
    <div className="flex flex-col gap-6">
      <BackLink to={`/acente-primleri/kural/${rule.id}`} label={rule.name} />
      <PageHeader title="Prim kuralını düzenle" description={`${rule.agency.name} · ${rule.name}`} />
      {locked ? (
        <Alert tone="warning" title="Bu kural düzenlenemez">
          {rule.status === 'CANCELLED' ? 'İptal edilmiş kural değiştirilemez.' : 'Hak edişi onaya gönderilmiş ya da onaylanmış; önce hak edişi yeniden açın.'}
        </Alert>
      ) : (
        <BonusRuleForm rule={rule} onSaved={() => navigate(`/acente-primleri/kural/${rule.id}`)} onCancel={() => navigate(`/acente-primleri/kural/${rule.id}`)} />
      )}
    </div>
  );
}

/** @param {{ to: string, label: string }} props */
function BackLink({ to, label }) {
  return (
    <Link to={to} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      {label}
    </Link>
  );
}
