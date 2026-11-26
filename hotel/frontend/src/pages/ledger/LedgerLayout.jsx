import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useLedgerLive } from '../../lib/ledger.js';

/**
 * Genel muhasebe sayfalarının kabuğu (modül 48): mizan, yevmiye, hesap planı, kurallar, ayarlar.
 * Hepsi `ledger.view` ile görünür; yazma düğmeleri izne göre sayfalarda gizlenir.
 */
export function LedgerLayout() {
  useLedgerLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Genel muhasebe"
        description="Tek Düzen hesap planı, yevmiye fişleri ve mizan. Ön muhasebenin cari ve kasa / banka hareketleri ile gün kapanışındaki gelir kendiliğinden fişlenir; elle fiş girilir, dönem kilitlenir."
      />
      <TabNav
        label="Genel muhasebe sayfaları"
        tabs={[
          { to: '/genel-muhasebe/mizan', label: 'Mizan', icon: 'chart' },
          { to: '/genel-muhasebe/yevmiye', label: 'Yevmiye', icon: 'clipboard' },
          { to: '/genel-muhasebe/hesap-plani', label: 'Hesap planı', icon: 'list' },
          { to: '/genel-muhasebe/kurallar', label: 'Kurallar', icon: 'sliders' },
          { to: '/genel-muhasebe/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
