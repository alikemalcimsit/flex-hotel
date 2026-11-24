import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useSurveysLive } from '../../lib/surveys.js';

/**
 * Anket sayfalarının kabuğu (modül 55): rapor, cevaplar, takip, tasarım, ayarlar. Hepsi `surveys.view` ile görünür;
 * tasarım ve ayar düzenlemesi `surveys.setup`, takip işlemleri `surveys.follow_up` ister (düğmeler sayfada gizlenir).
 */
export function SurveysLayout() {
  useSurveysLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Anket ve memnuniyet"
        description="Çıkıştan sonra ve konaklama içinde misafire giden anketler: NPS, bölüm puanları, yorumlar ve AI özeti; düşük puanın takibi."
      />
      <TabNav
        label="Anket sayfaları"
        tabs={[
          { to: '/anketler/rapor', label: 'Rapor', icon: 'chart' },
          { to: '/anketler/cevaplar', label: 'Cevaplar', icon: 'list' },
          { to: '/anketler/takip', label: 'Takip', icon: 'alertCircle' },
          { to: '/anketler/tasarim', label: 'Sorular', icon: 'pencil' },
          { to: '/anketler/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
