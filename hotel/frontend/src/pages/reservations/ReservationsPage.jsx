import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useT } from '../../i18n/index.jsx';
import { useNavText } from '../../i18n/useNavText.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Rezervasyonlar bölümünün kabuğu (modül 4): liste, yeni rezervasyon,
 * bekleme listesi; rezervasyon detayı da bu kabuğun içinde açılır.
 */
export function ReservationsPage() {
  const t = useT();
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const nav = useNavText();
  const tabs = nav.tabs('/rezervasyonlar', childrenOf('/rezervasyonlar', role, permissions));

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={t('reservations.page.title')}
        description={t('reservations.page.description')}
      />
      {tabs.length > 1 && <TabNav label={t('reservations.page.tabs')} tabs={tabs} />}
      <Outlet />
    </div>
  );
}
