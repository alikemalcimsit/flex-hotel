import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useInvoicesLive } from '../../lib/invoicing.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Fatura sayfalarının kabuğu (modül 16 çekirdeği + 49): faturalanacaklar, taslaklar, faturalar, ayarlar.
 * Hepsi `invoices.view` ile görünür; yazma düğmeleri izne göre sayfalarda gizlenir.
 */
export function InvoicingLayout() {
  useInvoicesLive();
  const can = useCan();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Faturalar"
        description="Kapanan folyonun ve gerçekleşen etkinliğin faturası, cariye serbest fatura; e-Fatura / e-Arşiv olarak GİB'e gider, durumu buradan izlenir."
      />
      <TabNav
        label="Fatura sayfaları"
        tabs={[
          { to: '/faturalar/faturalanacaklar', label: 'Faturalanacaklar', icon: 'inbox' },
          { to: '/faturalar/taslaklar', label: 'Taslaklar', icon: 'pencil' },
          { to: '/faturalar/liste', label: 'Kesilenler', icon: 'fileText' },
          ...(can(PERMISSIONS.INVOICES_SETUP) ? [{ to: '/faturalar/ayarlar', label: 'Ayarlar', icon: 'settings' }] : []),
        ]}
      />
      <Outlet />
    </div>
  );
}
