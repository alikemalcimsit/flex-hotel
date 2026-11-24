import { Link } from 'react-router-dom';
import { Alert } from '@hotelos/ui';
import { assetPath } from '../../lib/assets.js';
import { useEmployeeAssets } from '../../lib/assetQueries.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * İşten çıkışta zimmet uyarısı (modül 46 → 51): personelin zimmetindeki kullanımdaki demirbaşlar listelenir; çıkıştan
 * önce iade alınması hatırlatılır (engellemez). Demirbaş görme yetkisi yoksa hiçbir şey çizmez.
 * @param {{ employeeId: string }} props
 */
export function EmployeeAssetsWarning({ employeeId }) {
  const canView = useCan()(PERMISSIONS.ASSETS_VIEW);
  const query = useEmployeeAssets(employeeId, { enabled: canView });
  const items = query.data?.items ?? [];
  if (!canView || items.length === 0) return null;
  const total = query.data.meta?.total ?? items.length;
  return (
    <Alert tone="warning" className="mb-4" title={`Bu personelin zimmetinde ${total} demirbaş var — çıkıştan önce iade alın`}>
      <ul className="mt-1 space-y-0.5">
        {items.map((asset) => (
          <li key={asset.id}>
            <Link to={assetPath(asset.id)} className="font-semibold hover:underline">
              {asset.code}
            </Link>{' '}
            · {asset.name} · {asset.location.label}
          </li>
        ))}
      </ul>
      {total > items.length && <p className="mt-1 text-xs">İlk {items.length} gösteriliyor.</p>}
    </Alert>
  );
}
