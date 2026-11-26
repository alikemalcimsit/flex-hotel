import { Navigate, Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useT } from '../../i18n/index.jsx';
import { useNavText } from '../../i18n/useNavText.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useAuthStore } from '../../store/auth.js';

/**
 * Kasa bölümünün kabuğu (modül 17): günün tahsilat / iade hareketleri ve
 * döviz kurları.
 */
export function CashPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const nav = useNavText();
  const t = useT();
  const tabs = nav.tabs('/kasa', childrenOf('/kasa', role, permissions));

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={t('cash.page.title')}
        description={t('cash.page.description')}
      />
      {tabs.length > 1 && <TabNav label={t('cash.page.tabs')} tabs={tabs} />}
      <Outlet />
    </div>
  );
}

/** `/kasa` → kasayı görebilen günlük kasaya, yalnızca kur giren kurlara. */
export function CashIndex() {
  const can = useCan();
  return <Navigate to={can(PERMISSIONS.CASH_VIEW) ? '/kasa/gun' : '/kasa/kurlar'} replace />;
}
