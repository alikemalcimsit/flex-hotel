import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useStockLive } from '../../lib/kitchen.js';

/**
 * Stok sayfalarının kabuğu (modül 45 — 44'ün çekirdeği): depo bazında mevcut ve değer (hareketli
 * ortalama maliyet), hareketler, depolar. Giriş mal kabulden gelir; çıkış / transfer / fire / sayım 44'te.
 */
export function StockLayout() {
  useStockLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Stok" description="Depo bazında mevcut, hareketli ortalama maliyetle stok değeri, minimum seviye ve hareketler. Mal kabulde stok otomatik girer." />
      <TabNav
        label="Stok sayfaları"
        tabs={[
          { to: '/stok', label: 'Mevcut', icon: 'package', end: true },
          { to: '/stok/hareketler', label: 'Hareketler', icon: 'list' },
          { to: '/stok/depolar', label: 'Depolar', icon: 'building' },
        ]}
      />
      <Outlet />
    </div>
  );
}
