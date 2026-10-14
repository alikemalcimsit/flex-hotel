import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_CHANNEL_STOP_SALE_REASON_LENGTH, addChannelStopSaleSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { apiDelete, apiPost } from '../../lib/api.js';
import { channelKeys } from '../../lib/channelManager.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useChannelOutlet } from './ChannelPage.jsx';

/**
 * Kanala özel stop-sale (modül 33): seçilen günlerde (iki uç dahil) kanal
 * satış yapmaz — Channex'te fiyat planlarına "satışa kapalı" gider, iCal'de
 * günler dolu görünür. Otelin kendi satışını (resepsiyon, web) etkilemez.
 * Oda tipi seçilmezse kanaldaki bütün tipler.
 */
export function ChannelStopSaleTab() {
  const { channel } = useChannelOutlet();
  const can = useCan();
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ startDate: channel.today, endDate: channel.today, roomTypeIds: [], reason: '' });
  const [errors, setErrors] = useState({});
  const [removing, setRemoving] = useState(null);

  const refresh = (result) => {
    queryClient.setQueryData(channelKeys.detail(result.id), result);
    queryClient.invalidateQueries({ queryKey: channelKeys.all });
  };
  const add = useMutation({
    mutationFn: (payload) => apiPost(`/channel-manager/${channel.id}/stop-sales`, payload),
    onSuccess: (result) => {
      toastSuccess(result.status === 'ACTIVE' ? 'Stop-sale eklendi; kanala birkaç saniye içinde gider' : 'Stop-sale eklendi; kanal senkrona alınınca gider');
      refresh(result);
      setValues((current) => ({ ...current, reason: '' }));
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });
  const remove = useMutation({
    mutationFn: (sale) => apiDelete(`/channel-manager/${channel.id}/stop-sales/${sale.id}`),
    onSuccess: (result) => {
      setRemoving(null);
      toastSuccess('Stop-sale kaldırıldı; kanalda satış yeniden açılıyor');
      refresh(result);
    },
    onError: (error) => {
      setRemoving(null);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = { roomTypeIds: values.roomTypeIds, startDate: values.startDate, endDate: values.endDate, reason: values.reason };
    const checked = validateWith(addChannelStopSaleSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (values.endDate < channel.today) {
      setErrors({ endDate: 'Geçmiş günlere stop-sale konmaz' });
      return;
    }
    setErrors({});
    add.mutate(payload);
  }

  const toggleType = (roomTypeId) =>
    setValues((current) => ({
      ...current,
      roomTypeIds: current.roomTypeIds.includes(roomTypeId) ? current.roomTypeIds.filter((id) => id !== roomTypeId) : [...current.roomTypeIds, roomTypeId],
    }));
  const busy = add.isPending;

  const columns = [
    { key: 'period', header: 'Dönem', className: 'whitespace-nowrap', render: (row) => `${formatDate(row.startDate)} – ${formatDate(row.endDate)}` },
    { key: 'types', header: 'Oda tipleri', render: (row) => (row.roomTypeIds.length ? row.roomTypes.join(', ') : <span className="text-ink-muted">Bütün tipler</span>) },
    { key: 'reason', header: 'Sebep', render: (row) => row.reason ?? <span className="text-ink-muted">—</span> },
    { key: 'createdBy', header: 'Koyan', className: 'text-xs text-ink-muted', render: (row) => row.createdBy },
    ...(canManage
      ? [{ key: 'actions', header: '', className: 'text-right', render: (row) => <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(row)}>Kaldır</Button> }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {canManage && (
        <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-3 rounded-item border border-line bg-surface p-4">
          <h2 className="text-sm font-bold text-ink">Stop-sale ekle</h2>
          <div className="flex flex-wrap gap-3">
            <Input label="Başlangıç" name="stop-start" type="date" min={channel.today} value={values.startDate} onChange={(event) => setValues((current) => ({ ...current, startDate: event.target.value }))} error={errors.startDate} disabled={busy} className="w-44" />
            <Input label="Bitiş (dahil)" name="stop-end" type="date" min={values.startDate || channel.today} value={values.endDate} onChange={(event) => setValues((current) => ({ ...current, endDate: event.target.value }))} error={errors.endDate} disabled={busy} className="w-44" />
          </div>
          {channel.rooms.length === 0 ? (
            <Alert tone="info" title="Eşleşen oda tipi yok">Stop-sale eşleşmiş oda tiplerine konur; önce eşleştirmeyi yapın.</Alert>
          ) : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Oda tipleri (seçilmezse hepsi)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {channel.rooms.map((room) => (
                  <Checkbox key={room.roomTypeId} label={room.roomType.name} checked={values.roomTypeIds.includes(room.roomTypeId)} onChange={() => toggleType(room.roomTypeId)} disabled={busy} />
                ))}
              </div>
              {errors.roomTypeIds && <span className="text-xs text-danger-ink">{errors.roomTypeIds}</span>}
            </fieldset>
          )}
          <Input label="Sebep (isteğe bağlı)" name="stop-reason" value={values.reason} onChange={(event) => setValues((current) => ({ ...current, reason: event.target.value }))} error={errors.reason} maxLength={MAX_CHANNEL_STOP_SALE_REASON_LENGTH} placeholder="Ör. grup bloğu, tadilat" disabled={busy} />
          <div>
            <Button type="submit" icon="lock" disabled={busy || channel.rooms.length === 0}>{busy ? 'Ekleniyor…' : 'Stop-sale koy'}</Button>
          </div>
        </form>
      )}
      <DataTable columns={columns} rows={channel.stopSales} emptyTitle="Güncel stop-sale yok" emptyHint="Kanal eşleşen bütün tiplerde, müsaitlik oldukça satış yapar." />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Stop-sale kaldırılsın mı?"
        message={removing ? `${formatDate(removing.startDate)} – ${formatDate(removing.endDate)} arasında kanalda satış yeniden açılır (müsaitlik oldukça).` : ''}
        confirmLabel="Kaldır"
        confirmIcon="trash"
        onConfirm={() => remove.mutate(removing)}
        onClose={() => setRemoving(null)}
        isPending={remove.isPending}
      />
    </div>
  );
}
