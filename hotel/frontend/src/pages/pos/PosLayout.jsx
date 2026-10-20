import { Navigate, Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { usePosLive } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Restoran sayfasının kabuğu (modül 39): başlık ve yetkiye göre sekmeler — terminal (masa
 * planı), adisyonlar, vardiyalar, satış raporu, tanımlar. Kanal burada dinlenir: alt
 * sekmelerin hepsi `['pos', ...]` anahtarındadır.
 */
export function PosLayout() {
  const can = useCan();
  const { isLive } = usePosLive();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const report = can(PERMISSIONS.POS_REPORT);
  const tabs = [
    operate && { to: '/pos/masalar', label: 'Masa planı', icon: 'utensils' },
    (operate || report) && { to: '/pos/adisyonlar', label: 'Adisyonlar', icon: 'list' },
    (operate || report) && { to: '/pos/vardiyalar', label: 'Vardiyalar', icon: 'clock' },
    report && { to: '/pos/rapor', label: 'Satış raporu', icon: 'chart' },
    can(PERMISSIONS.POS_SETUP) && { to: '/pos/tanimlar', label: 'Menü ve tanımlar', icon: 'settings' },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Restoran"
        description="Masa planı, adisyon, sipariş, ödeme / odaya yaz ve garson vardiyası. İkram, iptal ve indirim şef garsonun; eşik üstü dört göz onaylı."
      />
      <TabNav label="Restoran sayfaları" tabs={tabs} />
      <Outlet context={{ isLive }} />
    </div>
  );
}

/** `/pos`: yetkiye göre ilk sekme (garson masa planı, raporcu adisyonlar, tanımcı tanımlar). */
export function PosHome() {
  const can = useCan();
  const to = can(PERMISSIONS.POS_OPERATE) ? 'masalar' : can(PERMISSIONS.POS_REPORT) ? 'adisyonlar' : 'tanimlar';
  return <Navigate to={to} replace />;
}
