import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';

/** Ayarlar bölümünün kabuğu; sekmeler alt route'lara karşılık gelir. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Ayarlar"
        description="Otelin tanımları. Rezervasyon, müsaitlik ve fiyat hesabı bu sayfadaki değerleri kullanır."
      />
      <TabNav label="Ayar sayfaları" tabs={childrenOf('/ayarlar')} />
      <Outlet />
    </div>
  );
}
