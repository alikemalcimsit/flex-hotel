import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Bildirimler bölümünün kabuğu (modül 9). Ön büro yalnızca gönderim
 * geçmişini görür; şablon ve kanal sekmeleri yönetime açıktır.
 */
export function NotificationsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/bildirimler', role, permissions);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Bildirimler"
        description="Misafire giden e-posta ve SMS'ler: ne zaman, kime, hangi metinle gitti; gitmediyse neden."
      />
      {tabs.length > 1 && <TabNav label="Bildirim sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
