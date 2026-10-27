import { Link } from 'react-router-dom';
import { Button } from '@hotelos/ui';
import { TabNav } from '../../components/TabNav.jsx';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { HISTORY_PATH, NEW_ORDER_PATH, PREP_PATH, ROOM_SERVICE_PATH, RS_REPORT_PATH, TRAYS_PATH } from '../../lib/roomService.js';

/**
 * Oda servisi sayfalarının alt sekmeleri (modül 41): pano, hazırlık listesi, geçmiş, rapor; tepsi listesi ve yeni
 * sipariş düğmeleri. Yetkisiz kullanıcıdan sekme / düğme gizlenir (sunucu da reddeder).
 */
export function RoomServiceTabs() {
  const can = useCan();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const report = can(PERMISSIONS.POS_REPORT);
  const tabs = [
    { to: ROOM_SERVICE_PATH, label: 'Pano', icon: 'dashboard', end: true },
    { to: PREP_PATH, label: 'Hazırlık listesi', icon: 'clipboard' },
    { to: HISTORY_PATH, label: 'Geçmiş', icon: 'list' },
    report && { to: RS_REPORT_PATH, label: 'Rapor', icon: 'chart' },
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabNav label="Oda servisi sayfaları" tabs={tabs} />
      <div className="flex flex-wrap gap-2">
        {operate && (
          <Link to={TRAYS_PATH}>
            <Button type="button" variant="outline" icon="checkCheck">
              Tepsiler
            </Button>
          </Link>
        )}
        {operate && (
          <Link to={NEW_ORDER_PATH}>
            <Button type="button" icon="plus">
              Yeni sipariş
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
