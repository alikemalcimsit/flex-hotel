import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useSpaLive } from '../../lib/spa.js';

/**
 * Spa sayfalarının kabuğu (modül 57): takvim, randevular, dersler, rapor, tanımlar, ayarlar. Hepsi `spa.view` ile
 * görünür; randevu işlemleri `spa.book`, kasa `spa.payment`, fiyat ve bedel kararı `spa.supervise`, tanımlar ve ders
 * programı `spa.setup` ister (düğmeler sayfada gizlenir). Canlı haber bütün spa ekranlarını tazeler.
 */
export function SpaLayout() {
  const { isLive } = useSpaLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Spa ve spor salonu" description="Masaj, hamam, bakım ve PT randevuları terapist takviminde; grup dersleri kontenjanıyla. Ücret oda hesabına yazılır ya da spa kasasında tahsil edilir." />
      <TabNav
        label="Spa sayfaları"
        tabs={[
          { to: '/spa', label: 'Takvim', icon: 'calendar', end: true },
          { to: '/spa/randevular', label: 'Randevular', icon: 'list' },
          { to: '/spa/dersler', label: 'Dersler', icon: 'users' },
          { to: '/spa/rapor', label: 'Rapor', icon: 'chart' },
          { to: '/spa/tanimlar', label: 'Tanımlar', icon: 'sliders' },
          { to: '/spa/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet context={{ isLive }} />
    </div>
  );
}
