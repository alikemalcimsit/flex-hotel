import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useRecipesLive } from '../../lib/kitchen.js';

/**
 * Mutfak sayfalarının kabuğu (modül 38'in reçete kısmı — modül 43): reçeteler (maliyet ve
 * kâr marjı tablosu) ve malzeme kartları. Banket menüleri, malzeme ihtiyacı ve üretim planı
 * reçeteden hesaplanır.
 */
export function KitchenLayout() {
  useRecipesLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mutfak" description="Reçeteler, malzeme kartları, porsiyon maliyeti ve kâr marjı. Banket menüsü, malzeme ihtiyacı ve üretim planı reçeteden hesaplanır." />
      <TabNav
        label="Mutfak sayfaları"
        tabs={[
          { to: '/mutfak', label: 'Reçeteler', icon: 'bookOpen', end: true },
          { to: '/mutfak/malzemeler', label: 'Malzeme kartları', icon: 'package' },
        ]}
      />
      <Outlet />
    </div>
  );
}
