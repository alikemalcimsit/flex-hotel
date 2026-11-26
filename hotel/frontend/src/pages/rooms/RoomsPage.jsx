import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useT } from '../../i18n/index.jsx';
import { useNavText } from '../../i18n/useNavText.js';

/** Oda envanteri bölümünün kabuğu; sekmeler alt route'lara karşılık gelir. */
export function RoomsPage() {
  const t = useT();
  const nav = useNavText();
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title={t('roomPlan.rooms.title')} description={t('roomPlan.rooms.description')} />
      <TabNav label={t('roomPlan.rooms.tabs')} tabs={nav.tabs('/odalar', childrenOf('/odalar'))} />
      <Outlet />
    </div>
  );
}
