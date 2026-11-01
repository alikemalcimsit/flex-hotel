import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Kat hizmetleri bölümünün kabuğu (modül 14): görev panosu (şefin masası),
 * görevlinin telefonu (Görevlerim), kontrol ekranı ve kat haritası.
 */
export function HousekeepingPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/kat-hizmetleri', role, permissions);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Kat hizmetleri"
        description="Günlük temizlik görevleri: çıkış yapan oda otomatik listeye düşer, görevli telefonundan işaretler, kat şefi kontrol eder. Temizliği zamanında işaretlenen oda akşam satışına yetişir."
      />
      {tabs.length > 1 && <TabNav label="Kat hizmeti sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
