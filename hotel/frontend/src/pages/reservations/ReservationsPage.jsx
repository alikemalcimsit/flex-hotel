import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { Button } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { childrenOf } from '../../layout/navigation.js';
import { useCan } from '../../lib/permissions.js';
import { useAuthStore } from '../../store/auth.js';
import { GroupReservationFormModal } from './GroupReservationFormModal.jsx';
import { ReservationFormModal } from './ReservationFormModal.jsx';

/** Rezervasyonlar bölümünün kabuğu: sekmeler (Liste / Bekleyenler) + yeni/grup. */
export function ReservationsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const permissions = useAuthStore((state) => state.permissions);
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const [creating, setCreating] = useState(false);
  const [groupCreating, setGroupCreating] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Rezervasyonlar"
        description="Rezervasyon açın, düzenleyin, iptal edin; sistem müsaitlik ve fiyatı hesaplar."
        actions={
          canManage && (
            <div className="flex gap-2">
              <Button variant="outline" icon="plus" onClick={() => setGroupCreating(true)}>
                Grup
              </Button>
              <Button icon="plus" onClick={() => setCreating(true)}>
                Yeni rezervasyon
              </Button>
            </div>
          )
        }
      />
      <TabNav label="Rezervasyon sayfaları" tabs={childrenOf('/rezervasyonlar', role, permissions)} />
      <Outlet />

      {creating && <ReservationFormModal onClose={() => setCreating(false)} />}
      {groupCreating && <GroupReservationFormModal onClose={() => setGroupCreating(false)} />}
    </div>
  );
}
