import { Link } from 'react-router-dom';
import { Button } from '@hotelos/ui';
import { TabNav } from '../../components/TabNav.jsx';
import { DELIVERY_HISTORY_PATH, DELIVERY_PATH, NEW_DELIVERY_PATH } from '../../lib/delivery.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Paket servis sayfalarının alt sekmeleri (modül 42): pano ve geçmiş; yeni sipariş düğmesi yalnızca garsona
 * (`pos.operate`; sunucu da reddeder).
 */
export function DeliveryTabs() {
  const operate = useCan()(PERMISSIONS.POS_OPERATE);
  const tabs = [
    { to: DELIVERY_PATH, label: 'Pano', icon: 'dashboard', end: true },
    { to: DELIVERY_HISTORY_PATH, label: 'Geçmiş', icon: 'list' },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabNav label="Paket servis sayfaları" tabs={tabs} />
      {operate && (
        <Link to={NEW_DELIVERY_PATH}>
          <Button type="button" icon="plus">
            Yeni paket sipariş
          </Button>
        </Link>
      )}
    </div>
  );
}
