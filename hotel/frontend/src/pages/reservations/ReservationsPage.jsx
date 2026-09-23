import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Rezervasyonlar bölümünün kabuğu (modül 4): liste, yeni rezervasyon,
 * bekleme listesi; rezervasyon detayı da bu kabuğun içinde açılır.
 */
export function ReservationsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/rezervasyonlar', role, permissions);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Rezervasyonlar"
        description="Rezervasyon açın, düzenleyin, iptal edin. Müsaitlik ve fiyat sistemce hesaplanır; yer yoksa misafiri bekleme listesine alın."
      />
      {tabs.length > 1 && <TabNav label="Rezervasyon sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
