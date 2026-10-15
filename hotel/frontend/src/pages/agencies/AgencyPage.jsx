import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { AGENCY_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { AGENCY_STATUS_TONES, useAgency, useAgencyLive } from '../../lib/agencies.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Acente sayfasının kabuğu (modül 29): başlık ve sekmeler (genel, kontratlar,
 * rezervasyonlar ve cari; prim izni olana prim ve hedef — modül 35). Acente bir
 * kez yüklenir, sekmelere bağlam olarak verilir; canlı kanal kartı ve
 * kontratları tazeler.
 */
export function AgencyPage() {
  const { agencyId } = useParams();
  const query = useAgency(agencyId);
  const can = useCan();
  useAgencyLive();

  const fallback = <QueryFallback query={query} errorTitle="Acente yüklenemedi" />;
  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {fallback}
      </div>
    );
  }

  const agency = query.data;
  const base = `/acenteler/${agency.id}`;
  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={agency.name}
        description={[agency.code, agency.contactName, agency.phone].filter(Boolean).join(' · ')}
        actions={<Badge tone={AGENCY_STATUS_TONES[agency.status]}>{AGENCY_STATUS_LABELS[agency.status]}</Badge>}
      />
      <TabNav
        label="Acente sayfaları"
        tabs={[
          { to: base, label: 'Genel', icon: 'building', end: true },
          { to: `${base}/kontratlar`, label: 'Kontratlar', icon: 'fileText' },
          { to: `${base}/cari`, label: 'Rezervasyonlar ve cari', icon: 'banknote' },
          // Hedef ve prim (modül 35) yalnızca prim izni olana.
          ...(can(PERMISSIONS.AGENCY_BONUS_VIEW) ? [{ to: `${base}/prim`, label: 'Prim ve hedef', icon: 'coins' }] : []),
        ]}
      />
      <Outlet context={{ agency }} />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/acenteler" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Acenteler
    </Link>
  );
}

/** Sekmelerin acenteyi okuduğu kanca. */
export function useAgencyContext() {
  return useOutletContext();
}
