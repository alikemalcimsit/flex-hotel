import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useLoyaltyLive } from '../../lib/loyalty.js';

/**
 * Sadakat programı kabuğu (modül 56): üyeler ve ayarlar. `loyalty.view` ile görünür; yazma düğmeleri
 * (`loyalty.manage`) sayfalarda gizlenir. Hesap sayfası (`/sadakat/uyeler/:accountId`) kabuğun dışında.
 */
export function LoyaltyLayout() {
  useLoyaltyLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sadakat programı" description="Folyo kapanınca harcamaya göre puan; konaklamada puanla indirim; son 12 aya göre seviye ve avantajlar." />
      <TabNav
        label="Sadakat sayfaları"
        tabs={[
          { to: '/sadakat/uyeler', label: 'Üyeler', icon: 'users' },
          { to: '/sadakat/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
