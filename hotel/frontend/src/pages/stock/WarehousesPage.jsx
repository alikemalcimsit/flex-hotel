import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_WAREHOUSES, createWarehouseSchema, updateWarehouseSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Checkbox, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { apiPost, apiPut } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Depolar (modül 45): kod, ad, varsayılan (mal kabulde önce seçili; otelde tek, pasif olamaz),
 * stoklu malzeme sayısı ve değer. Stoğu olan depo pasife alınamaz (transfer 44'te). Düzenleme
 * `stock.manage`; en fazla `MAX_WAREHOUSES` depo.
 */
export function WarehousesPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.STOCK_MANAGE);
  const { data: hotel } = useHotelContext();
  const list = useWarehouses({ includeInactive: true });
  const [editing, setEditing] = useState(null);

  const columns = [
    {
      key: 'name',
      header: 'Depo',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block font-mono text-xs text-ink-muted">{row.code}</span>
        </span>
      ),
    },
    { key: 'items', header: 'Stoklu malzeme', className: 'text-right tabular-nums', render: (row) => row.items },
    { key: 'value', header: 'Değer', className: 'text-right tabular-nums', render: (row) => formatMoney(row.value, hotel?.currency) },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.isDefault && <Badge tone="info">varsayılan</Badge>}
          <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Etkin' : 'Pasif'}</Badge>
        </span>
      ),
    },
  ];
  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setEditing('new')} disabled={rows.length >= MAX_WAREHOUSES}>
              Depo ekle
            </Button>
          )
        }
      >
        <p className="text-sm text-ink-soft">Ana depo, soğuk oda, bar deposu… Mal kabulde depo seçilir; varsayılan depo önce gelir.</p>
      </Toolbar>
      <DataTable
        columns={columns}
        rows={rows}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        emptyTitle="Depo yok"
        emptyHint={canManage ? 'İlk depo kendiliğinden varsayılan olur; mal kabul için en az bir depo gerekir.' : undefined}
        rowActions={
          canManage
            ? (row) => (
                <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
              )
            : undefined
        }
      />
      {editing && <WarehouseDialog warehouse={editing === 'new' ? null : editing} first={rows.length === 0} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ warehouse: any | null, first: boolean, onClose: () => void }} props */
function WarehouseDialog({ warehouse, first, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => ({ code: warehouse?.code ?? '', name: warehouse?.name ?? '', isDefault: warehouse?.isDefault ?? first, isActive: warehouse?.isActive ?? true }));
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => (warehouse ? apiPut(`/stock/warehouses/${warehouse.id}`, body) : apiPost('/stock/warehouses', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastSuccess(warehouse ? `${result.name} güncellendi` : `${result.name} eklendi`);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastError(error.code === 'STALE_WRITE' ? 'Depo bu arada değişti; liste yenilendi, tekrar açın.' : error.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = warehouse ? { ...values, expectedUpdatedAt: warehouse.updatedAt } : { code: values.code, name: values.name, isDefault: values.isDefault };
    const checked = validateWith(warehouse ? updateWarehouseSchema : createWarehouseSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (warehouse?.isDefault && !values.isDefault) return setErrors({ isDefault: 'Varsayılanı başka bir depoyu varsayılan yaparak taşıyın' });
    if (values.isDefault && !values.isActive) return setErrors({ isActive: 'Varsayılan depo pasif olamaz' });
    setErrors({});
    save.mutate(body);
  }
  const busy = save.isPending;
  return (
    <Modal
      open
      size="sm"
      title={warehouse ? warehouse.name : 'Yeni depo'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="warehouse-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="warehouse-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Kod" name="warehouse-code" value={values.code} onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))} error={errors.code} required disabled={busy} />
        <Input label="Ad" name="warehouse-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} error={errors.name} required disabled={busy} />
        <Checkbox
          label="Varsayılan depo"
          hint={first ? 'İlk depo kendiliğinden varsayılan olur.' : 'Mal kabulde önce seçili gelir; eski varsayılan düşer.'}
          checked={values.isDefault}
          onChange={(event) => setValues((current) => ({ ...current, isDefault: event.target.checked }))}
          disabled={busy || first || warehouse?.isDefault}
        />
        {errors.isDefault && <p className="text-xs text-sec-strong">{errors.isDefault}</p>}
        {warehouse && (
          <Checkbox
            label="Etkin"
            hint={warehouse.items > 0 ? `Depoda ${warehouse.items} malzemenin stoğu var; pasife almak için stok başka depoya aktarılmalı.` : 'Pasif depoya mal kabul yapılmaz.'}
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy || warehouse.isDefault}
          />
        )}
        {errors.isActive && <p className="text-xs text-sec-strong">{errors.isActive}</p>}
      </form>
    </Modal>
  );
}
