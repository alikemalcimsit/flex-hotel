import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useAccountingLive } from '../../lib/accounting.js';

/**
 * Ön muhasebe sayfalarının kabuğu (modül 47): cariler, yaşlandırma, kasa / banka, çek / senet, fişler, ayarlar.
 * Hepsi `accounting.view` ile görünür; yazma düğmeleri izne göre sayfalarda gizlenir.
 */
export function AccountingLayout() {
  useAccountingLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ön muhasebe"
        description="Acente, tedarikçi ve şirket carileri; kasa, banka, çek ve senet tek yerde. Ön büro, etkinlik ve restoran tahsilatları, mal kabuller ve primler kendiliğinden işlenir."
      />
      <TabNav
        label="Muhasebe sayfaları"
        tabs={[
          { to: '/muhasebe/cariler', label: 'Cariler', icon: 'users' },
          { to: '/muhasebe/yaslandirma', label: 'Yaşlandırma', icon: 'clock' },
          { to: '/muhasebe/kasa-banka', label: 'Kasa / banka', icon: 'wallet' },
          { to: '/muhasebe/cek-senet', label: 'Çek / senet', icon: 'fileText' },
          { to: '/muhasebe/fisler', label: 'Fişler', icon: 'clipboard' },
          { to: '/muhasebe/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
