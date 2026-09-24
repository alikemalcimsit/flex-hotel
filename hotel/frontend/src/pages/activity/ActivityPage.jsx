import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Aktivite bölümünün kabuğu (modül 10): canlı akış, olaylar, denetim kaydı.
 * İşlem zinciri ve bir kaydın zincirleri ayrı sayfalar (`/aktivite/zincir/…`,
 * `/aktivite/kayit/…`): akıştan, olaydan, denetimden ve rezervasyondan açılır.
 */
export function ActivityPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/aktivite', role, permissions);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Aktivite"
        description="Sistemde olan biten: hangi aktör hangi olayı işledi, ne kadar sürdü, hata var mı; kim hangi kaydı nasıl değiştirdi. Her satırdan işlemin bütün zincirine geçilir."
      />
      {tabs.length > 1 && <TabNav label="Aktivite sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}
