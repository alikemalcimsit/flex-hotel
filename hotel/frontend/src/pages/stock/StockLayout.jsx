import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useStockLive } from '../../lib/kitchen.js';

/**
 * Stok sayfalarının kabuğu (modül 45 çekirdek + modül 44): depo bazında mevcut ve değer (hareketli ortalama
 * maliyet), hareketler (mal kabul girişi, elle çıkış / fire / transfer, satış düşümü, sayım farkı), sayım,
 * maliyet raporu, depolar ve satış noktası → depo eşlemesi.
 */
export function StockLayout() {
  useStockLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Stok" description="Depo bazında mevcut, hareketli ortalama maliyetle stok değeri, minimum seviye ve hareketler. Mal kabulde stok girer; kapanan adisyon reçeteden düşer; çıkış, fire, transfer ve sayım buradan." />
      <TabNav
        label="Stok sayfaları"
        tabs={[
          { to: '/stok', label: 'Mevcut', icon: 'package', end: true },
          { to: '/stok/hareketler', label: 'Hareketler', icon: 'list' },
          { to: '/stok/sayim', label: 'Sayım', icon: 'clipboard' },
          { to: '/stok/maliyet', label: 'Maliyet raporu', icon: 'chart' },
          { to: '/stok/depolar', label: 'Depolar', icon: 'building' },
        ]}
      />
      <Outlet />
    </div>
  );
}
