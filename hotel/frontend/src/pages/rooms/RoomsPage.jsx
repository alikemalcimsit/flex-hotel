import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';

/** Oda envanteri bölümünün kabuğu; sekmeler alt route'lara karşılık gelir. */
export function RoomsPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="Odalar" description="Oda envanteri, müsaitlik takvimi ve rezervasyonlara oda atama." />
      <TabNav label="Oda sayfaları" tabs={childrenOf('/odalar')} />
      <Outlet />
    </div>
  );
}
