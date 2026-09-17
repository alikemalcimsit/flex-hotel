import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Onaylar bölümünün kabuğu (modül 11): bekleyenler ve geçmiş.
 */
export function ApprovalsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const tabs = childrenOf('/onaylar', role);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Onaylar"
        description="Personelin kararını bekleyen işler: para iadesi, büyük ödeme, toplu fiyat değişimi. Onaylanınca sistem kaldığı yerden devam eder; reddedilince ya da süresi dolunca iş yapılmaz."
      />
      {tabs.length > 1 && <TabNav label="Onay sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
