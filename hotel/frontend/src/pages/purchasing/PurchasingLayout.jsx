import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { usePurchasingLive } from '../../lib/kitchen.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Satın alma sayfalarının kabuğu (modül 45): talep → teklif karşılaştırma → sipariş → mal kabul
 * zinciri sekmelerde. Öneriler talep açan / yöneten içindir; diğerleri `purchasing.view` ile görünür.
 */
export function PurchasingLayout() {
  usePurchasingLive();
  const can = useCan();
  const canSuggest = can(PERMISSIONS.PURCHASING_REQUEST) || can(PERMISSIONS.PURCHASING_MANAGE);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Satın alma"
        description="Talep → teklif karşılaştırma → sipariş → mal kabul. Teklifler satır bazında karşılaştırılır, her malzeme en uygun tedarikçiden alınır; mal kabulde stok otomatik girer."
      />
      <TabNav
        label="Satın alma sayfaları"
        tabs={[
          { to: '/satin-alma/talepler', label: 'Talepler', icon: 'clipboard' },
          ...(canSuggest ? [{ to: '/satin-alma/oneriler', label: 'Min. stok önerileri', icon: 'alertTriangle' }] : []),
          { to: '/satin-alma/acik-satirlar', label: 'Açık satırlar', icon: 'list' },
          { to: '/satin-alma/teklif-turlari', label: 'Teklif turları', icon: 'layers' },
          { to: '/satin-alma/siparisler', label: 'Siparişler', icon: 'truck' },
          { to: '/satin-alma/mal-kabul', label: 'Mal kabul', icon: 'package' },
          { to: '/satin-alma/tedarikciler', label: 'Tedarikçiler', icon: 'users' },
        ]}
      />
      <Outlet />
    </div>
  );
}
