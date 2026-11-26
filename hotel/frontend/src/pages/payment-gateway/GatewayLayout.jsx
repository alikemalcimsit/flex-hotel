import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { api } from '../../lib/api.js';
import { gatewayKeys, useGatewayLive } from '../../lib/paymentGateway.js';
import { GatewayStatusStrip } from './GatewayStatusStrip.jsx';

/**
 * Sanal POS kabuğu (modül 50): işlemler (ödeme linkleri) ve ayarlar. `payment_gateway.view` ile görünür; yazma düğmeleri
 * (`payment_gateway.send`, `payment_gateway.setup`, `payment.refund`) sayfalarda gizlenir. Üstteki şerit kapalı / test /
 * sandbox / canlı kipini her sekmede gösterir.
 */
export function GatewayLayout() {
  useGatewayLive();
  const settings = useQuery({ queryKey: gatewayKeys.settings, queryFn: () => api('/payment-gateway/settings') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sanal POS" description="Misafire ödeme linki gönderilir; kart sağlayıcının sayfasında girilir, ödeme folyoya kendiliğinden düşer." />
      {settings.data && <GatewayStatusStrip settings={settings.data.settings} />}
      <TabNav
        label="Sanal POS sayfaları"
        tabs={[
          { to: '/sanal-pos/linkler', label: 'İşlemler', icon: 'creditCard' },
          { to: '/sanal-pos/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
