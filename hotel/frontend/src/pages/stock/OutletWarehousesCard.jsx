import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POS_OUTLET_KIND_LABELS } from '@hotelos/hotel-contracts';
import { Button, Card, Select } from '@hotelos/ui';
import { api, apiPut } from '../../lib/api.js';
import { stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Satış noktası → depo (modül 44): kapanan adisyonun stoğu hangi depodan düşer. Eşlenmeyen nokta varsayılan
 * depodan düşer. Kayıt otel ayarının sürüm damgasıyla (`stock.manage`).
 *
 * @param {{ canManage: boolean }} props
 */
export function OutletWarehousesCard({ canManage }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: stockKeys.settings, queryFn: () => api('/stock/settings') });
  const warehouses = useWarehouses();
  const [links, setLinks] = useState({});
  useEffect(() => {
    if (settings.data) setLinks(Object.fromEntries(settings.data.outlets.map((outlet) => [outlet.outletId, outlet.warehouseId ?? ''])));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      apiPut('/stock/settings', {
        expectedUpdatedAt: settings.data.updatedAt,
        outletWarehouses: Object.entries(links)
          .filter(([, warehouseId]) => warehouseId)
          .map(([outletId, warehouseId]) => ({ outletId, warehouseId })),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(stockKeys.settings, next);
      toastSuccess('Satış noktası → depo eşlemesi kaydedildi');
    },
    onError: (failure) => {
      if (failure.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: stockKeys.settings });
      toastError(failure.code === 'STALE_WRITE' ? 'Otel ayarı bu arada değişti; liste yenilendi, tekrar deneyin.' : failure.message);
    },
  });
  const dirty = settings.data ? settings.data.outlets.some((outlet) => (links[outlet.outletId] ?? '') !== (outlet.warehouseId ?? '')) : false;
  const options = [{ value: '', label: settings.data?.defaultWarehouse ? `Varsayılan (${settings.data.defaultWarehouse.name})` : 'Varsayılan depo (tanımlı değil)' }, ...(warehouses.data ?? []).map((row) => ({ value: row.id, label: row.name }))];

  return (
    <Card
      title="Satış noktası → depo"
      description="Kapanan adisyonun reçeteden düşümü hangi depodan yapılır. Eşlenmeyen satış noktası varsayılan depodan düşer."
      actions={
        canManage && (
          <Button type="button" size="sm" icon="check" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        )
      }
    >
      {settings.data?.outlets.length === 0 && <p className="text-sm text-ink-muted">Satış noktası tanımlı değil (Restoran → Tanımlar).</p>}
      {!settings.data?.defaultWarehouse && settings.data && <p className="mb-3 text-sm text-warning-ink">Varsayılan depo yok: eşlenmeyen satış noktasının stoğu düşülemez, iş stok yetkilisine manuel görev olarak düşer.</p>}
      <ul className="divide-y divide-line">
        {(settings.data?.outlets ?? []).map((outlet) => (
          <li key={outlet.outletId} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span className="block">
              <span className="block text-sm font-semibold text-ink">{outlet.name}</span>
              <span className="block text-xs text-ink-muted">
                {POS_OUTLET_KIND_LABELS?.[outlet.kind] ?? outlet.kind}
                {outlet.warehouseActive === false && ' · eşlenen depo pasif'}
              </span>
            </span>
            {canManage ? (
              <Select label="" name={`outlet-warehouse-${outlet.outletId}`} compact options={options} value={links[outlet.outletId] ?? ''} onChange={(event) => setLinks((current) => ({ ...current, [outlet.outletId]: event.target.value }))} className="w-56" />
            ) : (
              <span className="text-sm text-ink-soft">{outlet.warehouseName ?? options[0].label}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
