import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useT } from '../../i18n/index.jsx';
import { useNavText } from '../../i18n/useNavText.js';
import { formatDate } from '../../lib/format.js';
import { useAuthStore } from '../../store/auth.js';
import { useFrontDeskSummary } from './StayParts.jsx';

/**
 * Ön büro bölümünün kabuğu (modül 6): günün özeti ve üç liste — gelecekler,
 * gidecekler, konaklayanlar. Sayılar canlı tazelenir.
 */
export function FrontDeskPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const nav = useNavText();
  const t = useT();
  const tabs = nav.tabs('/on-buro', childrenOf('/on-buro', role, permissions));
  const summary = useFrontDeskSummary();
  const data = summary.data;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={t('frontDesk.page.title')}
        description={data ? t('frontDesk.page.descriptionWithDay', { date: formatDate(data.businessDate) }) : t('frontDesk.page.description')}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label={t('frontDesk.page.arrivals')}
          value={data?.arrivals.expected}
          hint={
            data
              ? data.arrivals.unassigned
                ? t('frontDesk.page.arrivalsHintUnassigned', { checkedIn: data.arrivals.checkedIn, unassigned: data.arrivals.unassigned })
                : t('frontDesk.page.arrivalsHint', { checkedIn: data.arrivals.checkedIn })
              : t('common.loading')
          }
          icon="key"
          tone={data?.arrivals.unassigned ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label={t('frontDesk.page.departures')}
          value={data?.departures.expected}
          hint={data ? t('frontDesk.page.departuresHint', { checkedOut: data.departures.checkedOut }) : t('common.loading')}
          icon="logout"
        />
        <SummaryTile label={t('frontDesk.page.inHouse')} value={data?.inHouse} hint={t('frontDesk.page.inHouseHint')} icon="bed" />
        <SummaryTile
          label={t('frontDesk.page.overdue')}
          value={data?.departures.overdue}
          hint={t('frontDesk.page.overdueHint')}
          icon="alertTriangle"
          tone={data?.departures.overdue ? 'danger' : 'neutral'}
        />
      </div>
      {summary.isError && <p className="text-sm text-sec-strong">{t('frontDesk.page.summaryFailed', { message: summary.error.message })}</p>}
      {tabs.length > 1 && <TabNav label={t('frontDesk.page.tabs')} tabs={tabs} />}
      <Outlet />
    </div>
  );
}
