import { Navigate, Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { ASSETS_PATH, ASSET_COUNTS_PATH, ASSET_DEFINITIONS_PATH, ASSET_DEPRECIATION_PATH, ASSET_WARRANTY_PATH } from '../../lib/assets.js';
import { useAssetsLive } from '../../lib/assetQueries.js';
import { useAssetAccess } from './AssetFields.jsx';

/**
 * Demirbaş sayfalarının kabuğu (modül 46): liste, sayım, amortisman (VUK yıllık doğrusal), garanti ve tanımlar.
 * Yalnız sayım yetkilisi (etiket okutan personel) sayım sekmesini görür.
 */
export function AssetsLayout() {
  useAssetsLive();
  const access = useAssetAccess();
  const tabs = [
    access.view && { to: ASSETS_PATH, label: 'Demirbaşlar', icon: 'package', end: true },
    access.count && { to: ASSET_COUNTS_PATH, label: 'Sayım', icon: 'clipboard' },
    access.view && { to: ASSET_DEPRECIATION_PATH, label: 'Amortisman', icon: 'chart' },
    access.view && { to: ASSET_WARRANTY_PATH, label: 'Garanti', icon: 'alarm' },
    access.view && { to: ASSET_DEFINITIONS_PATH, label: 'Tanımlar', icon: 'settings' },
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Demirbaş"
        description="Otelin sabit kıymetleri: QR etiketli kart, konum ve zimmet, barkodla sayım, VUK usulü yıllık amortisman ve garantisi bitecekler."
      />
      <TabNav label="Demirbaş sayfaları" tabs={tabs} />
      <Outlet />
    </div>
  );
}

/**
 * Bölümün açılış sayfası: demirbaşları gören listeyi, yalnız sayım yetkilisi (etiket okutan personel) sayımları görür.
 * @param {{ children: React.ReactNode }} props
 */
export function AssetsHome({ children }) {
  const access = useAssetAccess();
  return access.view ? children : <Navigate to={ASSET_COUNTS_PATH} replace />;
}
