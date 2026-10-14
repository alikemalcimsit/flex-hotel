import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AGENCY_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { apiPost } from '../../lib/api.js';
import { AGENCY_STATUS_TONES, agencyKeys } from '../../lib/agencies.js';
import { formatPercent } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AgencyFormDialog } from './AgencyDialogs.jsx';
import { useAgencyContext } from './AgencyPage.jsx';

/** @param {{ label: string, children: React.ReactNode }} props */
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="break-words text-sm text-ink">{children || '—'}</dd>
    </div>
  );
}

/**
 * Acente kartı (modül 29): firma, yetkili, iletişim, vergi bilgisi, komisyon ve
 * vade. Düzenleme ve pasife alma `agencies.manage` ister. Aktif acentenin
 * satıştaki kontratı yoksa rezervasyon açılamayacağı uyarılır.
 */
export function AgencyOverviewTab() {
  const { agency } = useAgencyContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const canManage = can(PERMISSIONS.AGENCIES_MANAGE);

  const toggle = useMutation({
    mutationFn: () => apiPost(`/agencies/${agency.id}/status`, { expectedUpdatedAt: agency.updatedAt, status: agency.status === 'ACTIVE' ? 'PASSIVE' : 'ACTIVE' }),
    onSuccess: (saved) => {
      toastSuccess(saved.status === 'ACTIVE' ? 'Acente yeniden aktif' : 'Acente pasife alındı');
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      setDialog(null);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? 'Kart bu arada değişti; ekran yenilendi, tekrar deneyin.' : error.message);
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      setDialog(null);
    },
  });

  const selling = agency.contracts.some((contract) => contract.status === 'ACTIVE');
  return (
    <div className="flex flex-col gap-5">
      {agency.status === 'ACTIVE' && !selling && (
        <Alert
          tone="warning"
          title="Satıştaki kontrat yok"
          action={
            <Link to={`/acenteler/${agency.id}/kontratlar`}>
              <Button variant="outline" size="sm" icon="fileText">Kontratlar</Button>
            </Link>
          }
        >
          Kontratı satışa açılana kadar bu acente adına rezervasyon açılamaz.
        </Alert>
      )}
      {agency.status === 'PASSIVE' && (
        <Alert tone="info" title="Acente pasif">
          Yeni rezervasyon açılamaz ve kontrat satışa açılamaz. Açılmış rezervasyonlar ve satıştaki kontratlar etkilenmez.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-col gap-5 p-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-ink">Firma bilgileri</h2>
              {canManage && <Button variant="outline" size="sm" icon="pencil" onClick={() => setDialog('edit')}>Düzenle</Button>}
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Firma adı">{agency.name}</Field>
              <Field label="Kod"><span className="font-mono">{agency.code}</span></Field>
              <Field label="Yetkili">{agency.contactName}</Field>
              <Field label="Telefon">{agency.phone}</Field>
              <Field label="E-posta">{agency.email}</Field>
              <Field label="Adres">{agency.address}</Field>
              <Field label="Vergi dairesi">{agency.taxOffice}</Field>
              <Field label="Vergi numarası">{agency.taxNumber}</Field>
            </dl>
            {agency.notes && (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Not</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-soft">{agency.notes}</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-5 p-1">
            <h2 className="text-lg font-bold text-ink">Ticari koşullar</h2>
            <dl className="grid gap-4">
              <Field label="Komisyon">{formatPercent(agency.commissionPct)}</Field>
              <Field label="Vade">{agency.paymentTermDays ? `Çıkıştan ${agency.paymentTermDays} gün sonra` : 'Peşin'}</Field>
              <Field label="Durum"><Badge tone={AGENCY_STATUS_TONES[agency.status]}>{AGENCY_STATUS_LABELS[agency.status]}</Badge></Field>
            </dl>
            <p className="text-xs text-ink-muted">
              Komisyon rezervasyon toplamı üzerinden hesaplanır ve rezervasyon açılırken kopyalanır: oran değişirse açılmış rezervasyonlar eski oranını korur.
            </p>
            {canManage && (
              <Button variant={agency.status === 'ACTIVE' ? 'dangerSoft' : 'outline'} icon={agency.status === 'ACTIVE' ? 'lock' : 'check'} onClick={() => setDialog('status')}>
                {agency.status === 'ACTIVE' ? 'Pasife al' : 'Yeniden aktif et'}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {dialog === 'edit' && <AgencyFormDialog agency={agency} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'status'}
        title={agency.status === 'ACTIVE' ? 'Acenteyi pasife al' : 'Acenteyi yeniden aktif et'}
        message={
          agency.status === 'ACTIVE'
            ? `"${agency.name}" pasife alınınca yeni rezervasyon açılamaz. Açılmış rezervasyonlar ve satıştaki kontratlar değişmez.`
            : `"${agency.name}" yeniden aktif olunca kontratı satışa açılabilir ve adına rezervasyon açılabilir.`
        }
        confirmLabel={agency.status === 'ACTIVE' ? 'Pasife al' : 'Aktif et'}
        confirmVariant={agency.status === 'ACTIVE' ? 'danger' : 'primary'}
        confirmIcon={agency.status === 'ACTIVE' ? 'lock' : 'check'}
        isPending={toggle.isPending}
        onConfirm={() => toggle.mutate()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
