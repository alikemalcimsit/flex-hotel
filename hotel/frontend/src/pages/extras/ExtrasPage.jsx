import { Navigate, Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Minibar & çamaşırhane bölümünün kabuğu (modül 19).
 */
export function ExtrasPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const tabs = childrenOf('/ek-hizmetler', role, permissions);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Minibar & çamaşır"
        description="Odada tüketilen minibar ve misafirin çamaşırı folyoya kendiliğinden yansır: minibar sayım girilince, çamaşır teslim edilince."
      />
      {tabs.length > 1 && <TabNav label="Minibar ve çamaşır sayfaları" tabs={tabs} />}
      <Outlet />
    </div>
  );
}

/** `/ek-hizmetler` → kişinin görebildiği ilk sekme (kat görevlisi için minibar girişi). */
export function ExtrasIndex() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const first = childrenOf('/ek-hizmetler', role, permissions)[0];
  return <Navigate to={first?.to ?? '/'} replace />;
}
