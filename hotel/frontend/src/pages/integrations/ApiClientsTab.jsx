import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { API_BOOKING_STATUS_LABELS, API_CLIENT_STATUS_LABELS, MAX_API_CLIENTS } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api } from '../../lib/api.js';
import { CLIENT_STATUS_TONES, integrationKeys, useIntegrationTime } from '../../lib/integrations.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ApiClientDialog } from './ApiClientDialog.jsx';

/**
 * Uygulama listesi: açık anahtar ve abonelik sayısı, son kullanım, durum. Otelde en fazla `MAX_API_CLIENTS` uygulama
 * (liste sayfalanmaz; tek sorgu).
 */
export function ApiClientsTab() {
  const can = useCan();
  const formatTime = useIntegrationTime();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: integrationKeys.clients(), queryFn: () => api('/integrations/clients') });
  const canManage = can(PERMISSIONS.INTEGRATIONS_MANAGE);

  const columns = [
    {
      key: 'name',
      header: 'Uygulama',
      render: (row) => (
        <Link to={`/entegrasyonlar/uygulamalar/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          {row.description && <span className="block max-w-md truncate text-xs text-ink-muted">{row.description}</span>}
        </Link>
      ),
    },
    { key: 'keys', header: 'Açık anahtar', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => row.activeKeyCount },
    { key: 'webhooks', header: 'Webhook', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => row.webhookCount },
    { key: 'booking', header: 'Rezervasyon', className: 'text-xs', render: (row) => API_BOOKING_STATUS_LABELS[row.bookingStatus].split(' —')[0] },
    { key: 'used', header: 'Son kullanım', className: 'whitespace-nowrap text-xs', render: (row) => (row.lastUsedAt ? formatTime(row.lastUsedAt) : <span className="text-ink-muted">Hiç</span>) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={CLIENT_STATUS_TONES[row.status]}>{API_CLIENT_STATUS_LABELS[row.status]}</Badge> },
  ];

  const count = list.data?.length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">Her dış sistem için ayrı uygulama açın: anahtarı sızan uygulama tek başına kapatılır.</p>
          <Button icon="plus" onClick={() => setCreating(true)} disabled={count >= MAX_API_CLIENTS}>
            Yeni uygulama
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={list.data}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        emptyTitle="Henüz bağlı uygulama yok"
        emptyHint={canManage ? '"Yeni uygulama" ile açın, sonra anahtar oluşturup dış sisteme verin.' : 'Yönetici bir uygulama açtığında burada görünür.'}
      />
      {creating && <ApiClientDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
