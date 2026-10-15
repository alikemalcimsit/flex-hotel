import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { agencyBonusKeys, useAgencyBonusLive } from '../../lib/agencyBonus.js';
import { api } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

const OFFLINE_REFRESH_MS = 60_000;

/**
 * Acente primleri sayfasının kabuğu (modül 35): başlık, özet kutuları (sürmekte
 * olan / gerisinde kalan kural, dönemi bitip hak edişi bekleyen, onay bekleyen,
 * onaylı ödenmemiş, bu yıl ödenen) ve sekmeler (hedef durumu, hak ediş raporu).
 * Kural açmak `agency_bonus.manage` ister.
 */
export function AgencyBonusLayout() {
  const can = useCan();
  const navigate = useNavigate();
  const { isLive } = useAgencyBonusLive();
  const summary = useQuery({
    queryKey: agencyBonusKeys.summary,
    queryFn: () => api('/agency-bonus/summary'),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const data = summary.data;
  const money = (value) => (data ? formatMoney(value, data.currency) : '—');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Acente primleri"
        description="Acentelerin dönem hedefleri, kademeli prim oranları ve dönem sonu hak edişleri. Üretim = misafirin kaldığı geceler; ciro = bu gecelerin folyodaki vergisiz oda geliri."
        actions={
          can(PERMISSIONS.AGENCY_BONUS_MANAGE) && (
            <Button icon="plus" onClick={() => navigate('/acente-primleri/yeni')}>
              Yeni prim kuralı
            </Button>
          )
        }
      />
      <section aria-label="Özet" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Süren kural" value={data?.rules.running} hint={data ? `${data.rules.upcoming} kural başlamadı` : 'Yükleniyor…'} icon="chart" />
        <SummaryTile
          label="Hedefin gerisinde"
          value={data?.rules.behind}
          hint="Zamana göre beklentinin %10'dan fazla altında"
          icon="alertTriangle"
          tone={data?.rules.behind ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label="Hak ediş bekleyen"
          value={data ? data.rules.awaitingSettlement : undefined}
          hint={data ? `Onayda: ${data.bonuses.pending.count} · ${money(data.bonuses.pending.amount)}` : 'Yükleniyor…'}
          icon="clipboard"
          tone={data?.rules.awaitingSettlement ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label="Ödenecek (onaylı)"
          value={data?.bonuses.approvedUnpaid.count}
          hint={data ? `${money(data.bonuses.approvedUnpaid.amount)} · bu yıl ödenen ${money(data.bonuses.paidThisYear.amount)}` : 'Yükleniyor…'}
          icon="wallet"
        />
      </section>
      {summary.isError && <p className="text-sm text-sec-strong">Özet yüklenemedi: {summary.error.message}</p>}
      <TabNav
        label="Acente primi sayfaları"
        tabs={[
          { to: '/acente-primleri', label: 'Hedef durumu', icon: 'chart', end: true },
          { to: '/acente-primleri/hak-edis', label: 'Hak ediş raporu', icon: 'fileText' },
        ]}
      />
      <Outlet context={{ isLive }} />
    </div>
  );
}
