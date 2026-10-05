import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CONTRACT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Icon } from '@hotelos/ui';
import { CONTRACT_STATUS_TONES } from '../../lib/agencies.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CreateContractDialog } from './AgencyDialogs.jsx';
import { useAgencyContext } from './AgencyPage.jsx';

/**
 * Acentenin kontratları (modül 29): taslak, satışta ve sonlandırılmış; en yeni
 * dönem önce. Yeni kontrat taslak açılır, fiyatları kontrat sayfasında girilip
 * satışa açılır. Açma `agencies.manage` ister.
 */
export function AgencyContractsTab() {
  const { agency } = useAgencyContext();
  const can = useCan();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const canManage = can(PERMISSIONS.AGENCIES_MANAGE);
  const contracts = agency.contracts;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          Acentenin aynı günü kapsayan en fazla bir satıştaki kontratı olur. Kontrat fiyatı yalnızca yeni açılan rezervasyonlara uygulanır.
        </p>
        {canManage && <Button icon="plus" onClick={() => setCreating(true)}>Yeni kontrat</Button>}
      </div>

      {agency.status === 'PASSIVE' && <Alert tone="info" title="Acente pasif">Pasif acentenin kontratı satışa açılamaz.</Alert>}

      {contracts.length === 0 ? (
        <EmptyState icon="fileText" title="Henüz kontrat yok" description={canManage ? 'Dönemi girerek taslak açın, fiyatları kontrat sayfasında doldurun.' : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {contracts.map((contract) => (
            <li key={contract.id}>
              <Link to={`/acenteler/kontrat/${contract.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm hover:bg-surface-muted">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{contract.name}</span>
                    <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {formatDate(contract.startDate)} – {formatDate(contract.endDate)} · {contract.rateCount} fiyat satırı
                    {contract.stopSaleCount > 0 && ` · ${contract.stopSaleCount} stop-sale`}
                  </span>
                  {contract.status === 'ENDED' && contract.endReason && <span className="mt-0.5 block text-xs text-ink-soft">Sonlandırma: {contract.endReason}</span>}
                </span>
                <Icon name="chevronRight" className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateContractDialog
          agencyId={agency.id}
          onClose={() => setCreating(false)}
          onCreated={(contract) => {
            setCreating(false);
            navigate(`/acenteler/kontrat/${contract.id}`);
          }}
        />
      )}
    </div>
  );
}
