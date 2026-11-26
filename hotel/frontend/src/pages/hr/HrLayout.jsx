import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { useHrLive } from '../../lib/hr.js';

/**
 * İK sayfalarının kabuğu (modül 52): izinler, izin bakiyeleri, vardiya, puantaj, belgeler, ayarlar. Hepsi `hr.view`
 * ile görünür; yazma düğmeleri `hr.manage` iznine göre sayfalarda gizlenir. Personelin kendi sayfası (`/ik/benim`) ayrı.
 */
export function HrLayout() {
  useHrLive();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="İK" description="İzin talebi → onay → bakiye; haftalık vardiya çizelgesi; günlük puantaj ve ay sonunda bordroya aktarım; özlük belgeleri ve süre takibi." />
      <TabNav
        label="İK sayfaları"
        tabs={[
          { to: '/ik/izinler', label: 'İzinler', icon: 'sun' },
          { to: '/ik/izin-bakiyeleri', label: 'İzin bakiyeleri', icon: 'calendar' },
          { to: '/ik/vardiya', label: 'Vardiya', icon: 'clock' },
          { to: '/ik/puantaj', label: 'Puantaj', icon: 'checkCheck' },
          { to: '/ik/belgeler', label: 'Belgeler', icon: 'fileText' },
          { to: '/ik/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
