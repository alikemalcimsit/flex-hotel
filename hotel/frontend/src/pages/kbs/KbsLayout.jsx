import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { api } from '../../lib/api.js';
import { kbsKeys, useKbsLive } from '../../lib/kbs.js';
import { KbsStatusStrip } from './KbsStatusStrip.jsx';

/**
 * KBS kabuğu (modül 58): bildirimler, mutabakat, ayarlar. `kbs.view` ile görünür; yazma düğmeleri (`kbs.send`,
 * `kbs.manage`) sayfalarda gizlenir. Üstteki şerit KBS kapalı / test ortamı uyarısını her sekmede gösterir.
 */
export function KbsLayout() {
  useKbsLive();
  const settings = useQuery({ queryKey: kbsKeys.settings, queryFn: () => api('/kbs/settings') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="KBS kimlik bildirimi" description="Girişte belgesi alınan her kişi Emniyet / Jandarma KBS'ye bildirilir; çıkış ve oda değişikliği de. Gönderilemeyen burada düzeltilir." />
      {settings.data && <KbsStatusStrip data={settings.data} />}
      <TabNav
        label="KBS sayfaları"
        tabs={[
          { to: '/kbs/bildirimler', label: 'Bildirimler', icon: 'send' },
          { to: '/kbs/mutabakat', label: 'Mutabakat', icon: 'checkCheck' },
          { to: '/kbs/ayarlar', label: 'Ayarlar', icon: 'settings' },
        ]}
      />
      <Outlet />
    </div>
  );
}
