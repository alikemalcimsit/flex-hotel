import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { usePayrollLive } from '../../lib/payroll.js';

/**
 * Bordro sayfalarının kabuğu (modül 51): bordrolar, puantaj ve kalemler, servis payı, ayarlar. Hepsi `payroll.view`
 * ile görünür; yazma düğmeleri izne göre sayfalarda gizlenir.
 */
export function PayrollLayout() {
  usePayrollLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bordro" description="Aylık bordro: puantaj ve ek ödemeler → hesap → dört gözle onay → ödeme. Yasal parametreler kaynaklı ve teyitli setlerden; onaylı ayın düzeltmesi fark bordrosuyla." />
      <TabNav
        label="Bordro sayfaları"
        tabs={[
          { to: '/bordro', label: 'Bordrolar', icon: 'fileText', end: true },
          { to: '/bordro/puantaj', label: 'Puantaj ve kalemler', icon: 'calendar' },
          { to: '/bordro/servis-payi', label: 'Servis payı', icon: 'coins' },
          { to: '/bordro/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
