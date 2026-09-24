import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { formatDate } from '../../lib/format.js';
import { useAuthStore } from '../../store/auth.js';
import { useFrontDeskSummary } from './StayParts.jsx';

/**
 * Ön büro bölümünün kabuğu (modül 6): günün özeti ve üç liste — gelecekler,
 * gidecekler, konaklayanlar. Sayılar canlı tazelenir.
 */
export function FrontDeskPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/on-buro', role, permissions);
  const summary = useFrontDeskSummary();
  const data = summary.data;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Giriş / çıkış"
        description={`Giriş ve çıkış tek tıkla; oda durumu ve bildirimler kendiliğinden güncellenir.${data ? ` Otelin günü: ${formatDate(data.businessDate)}.` : ''}`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Gelecek"
          value={data?.arrivals.expected}
          hint={data ? `${data.arrivals.checkedIn} giriş yapıldı${data.arrivals.unassigned ? ` · ${data.arrivals.unassigned} odasız` : ''}` : 'Yükleniyor…'}
          icon="key"
          tone={data?.arrivals.unassigned ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label="Gidecek"
          value={data?.departures.expected}
          hint={data ? `${data.departures.checkedOut} çıkış yapıldı` : 'Yükleniyor…'}
          icon="logout"
        />
        <SummaryTile label="İçeride" value={data?.inHouse} hint="Şu an konaklayan" icon="bed" />
        <SummaryTile
          label="Gecikmiş çıkış"
          value={data?.departures.overdue}
          hint="Çıkış günü geçmiş"
          icon="alertTriangle"
          tone={data?.departures.overdue ? 'danger' : 'neutral'}
        />
      </div>
      {summary.isError && <p className="text-sm text-sec-strong">Özet yüklenemedi: {summary.error.message}</p>}
      {tabs.length > 1 && <TabNav label="Ön büro sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
