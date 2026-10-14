import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_TYPES, BOARD_TYPE_LABELS, MAX_CHANNEL_RATE_MAPPINGS_PER_ROOM, saveChannelMappingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Spinner } from '@hotelos/ui';
import { API_URL, api, apiPut } from '../../lib/api.js';
import { exportUrl, mappingErrorsByRow, mappingPayload, mappingRowsOf, ratePlansFor } from '../../lib/channelForm.js';
import { channelKeys, useChannelTime } from '../../lib/channelManager.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { useChannelOutlet } from './ChannelPage.jsx';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));
const STALE_TEXT = 'Kanal siz düzenlerken değişti; eşleştirme yeniden yüklendi, değişikliklerinizi yeniden yapın.';

/**
 * Oda tipi eşleştirme (modül 33).
 *
 * - Channex: bizim oda tipi ↔ Channex oda tipi (müsaitlik buna gider) ve
 *   Channex fiyat planları ↔ pansiyon (fiyat ve stop-sale plana gider; gelen
 *   rezervasyonun pansiyonu buradan). Channex listesi canlı okunur.
 * - iCal: oda tipi ↔ kanalın takvim adresi (içe aktarma) ve bizim dışa
 *   aktarma adresimiz (kanala verilir).
 *
 * Eşleşmeyen tip kanalda satılmaz. Kayıt tablonun tamamını yazar; kanal
 * senkrondaysa tam eşitleme istenir.
 */
export function ChannelMappingTab() {
  const { channel } = useChannelOutlet();
  const can = useCan();
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const queryClient = useQueryClient();
  const { roomTypes, isPending: typesPending } = useRoomTypes();
  const [rows, setRows] = useState(null);
  const [base, setBase] = useState(channel.updatedAt);
  const [errors, setErrors] = useState({});
  const isChannex = channel.type === 'CHANNEX';

  const options = useQuery({
    queryKey: channelKeys.options(channel.id),
    queryFn: () => api(`/channel-manager/${channel.id}/external-options`),
    enabled: isChannex && canManage,
    staleTime: 60_000,
  });

  // Tablo oda tipleri gelince kurulur; başkası kaydedene kadar kullanıcının düzenlemesi korunur.
  useEffect(() => {
    if (typesPending) return;
    // Düzenleyen kişinin satırları başkasının kaydıyla ezilmez (uyarı çıkar); yalnızca görüntüleyen her zaman güncel görür.
    setRows((current) => (canManage ? current ?? mappingRowsOf(channel, roomTypes) : mappingRowsOf(channel, roomTypes)));
    if (!canManage) setBase(channel.updatedAt);
  }, [typesPending, roomTypes, channel, canManage]);

  const serverChanged = channel.updatedAt !== base;
  const rowErrors = useMemo(() => (rows ? mappingErrorsByRow(errors, rows) : {}), [errors, rows]);

  const save = useMutation({
    mutationFn: (payload) => apiPut(`/channel-manager/${channel.id}/mappings`, payload),
    onSuccess: (result) => {
      toastSuccess(result.status === 'ACTIVE' ? 'Eşleştirme kaydedildi; kanala tam eşitleme gidiyor' : 'Eşleştirme kaydedildi');
      queryClient.setQueryData(channelKeys.detail(result.id), result);
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      setRows(mappingRowsOf(result, roomTypes));
      setBase(result.updatedAt);
      setErrors({});
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') {
        queryClient.invalidateQueries({ queryKey: channelKeys.all });
        setRows(null);
        setBase(channel.updatedAt);
      }
    },
  });

  if (!rows) return <Spinner className="py-8" />;

  const update = (roomTypeId, patch) => setRows((current) => current.map((row) => (row.roomTypeId === roomTypeId ? { ...row, ...patch } : row)));
  const updateRate = (row, index, patch) => update(row.roomTypeId, { rates: row.rates.map((rate, position) => (position === index ? { ...rate, ...patch } : rate)) });

  function submit() {
    const payload = mappingPayload(rows, { ...channel, updatedAt: base }, options.data);
    const checked = validateWith(saveChannelMappingsSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  const busy = save.isPending;
  const disabled = busy || !canManage;
  const roomOptions = [{ value: '', label: 'Channex oda tipi seçin' }, ...(options.data?.roomTypes ?? []).map((row) => ({ value: row.id, label: row.title }))];

  return (
    <div className="flex flex-col gap-4">
      {serverChanged && canManage && (
        <Alert
          tone="warning"
          title="Eşleştirme başka biri tarafından değiştirildi"
          action={<Button size="sm" variant="outline" icon="refresh" onClick={() => { setRows(mappingRowsOf(channel, roomTypes)); setBase(channel.updatedAt); setErrors({}); }}>Güncel hâli yükle</Button>}
        >
          Kaydetmeden önce güncel hâli yükleyin.
        </Alert>
      )}
      {isChannex && canManage && options.isError && (
        <Alert tone="danger" title="Channex listesi okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => options.refetch()}>Tekrar dene</Button>}>
          {options.error.message}
        </Alert>
      )}
      <p className="text-sm text-ink-soft">
        {isChannex
          ? 'Her oda tipini Channex\'teki karşılığına ve en az bir fiyat planına bağlayın. Planın pansiyonu, o plandan gelen rezervasyonun pansiyonu olur. Eşleşmeyen tip kanalda satılmaz.'
          : 'Kanalın takvim adresini (Airbnb: Takvim → Takvimleri bağla → Takvimi dışa aktar) girin; bizim dışa aktarma adresimizi de kanala "takvim içe aktar" olarak verin.'}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const errorsOf = rowErrors[row.roomTypeId] ?? {};
          const plans = ratePlansFor(options.data, row.externalRoomTypeId);
          return (
            <li key={row.roomTypeId} className={`rounded-item border p-4 ${row.enabled ? 'border-line-strong bg-surface' : 'border-line bg-surface-muted'}`}>
              <Checkbox
                label={`${row.roomTypeCode} — ${row.roomTypeName}${row.deleted ? ' (silinmiş tip)' : ''}`}
                hint={row.deleted ? 'Silinmiş tip satılamaz; eşleşmeyi kaldırın' : undefined}
                checked={row.enabled}
                onChange={(event) => update(row.roomTypeId, { enabled: event.target.checked, rates: event.target.checked && row.rates.length === 0 && isChannex ? [{ externalRatePlanId: '', boardType: 'BB' }] : row.rates })}
                disabled={disabled || (row.deleted && !row.enabled)}
              />
              {row.enabled && isChannex && (
                <div className="mt-3 flex flex-col gap-3 pl-7">
                  {canManage ? (
                    <Select
                      label="Channex oda tipi"
                      name={`map-room-${row.roomTypeId}`}
                      value={row.externalRoomTypeId}
                      onChange={(event) => update(row.roomTypeId, { externalRoomTypeId: event.target.value, rates: row.rates.map((rate) => ({ ...rate, externalRatePlanId: '' })) })}
                      options={roomOptions}
                      error={errorsOf.externalRoomTypeId}
                      disabled={disabled || options.isPending}
                      className="sm:max-w-md"
                    />
                  ) : (
                    <p className="text-sm">Channex oda tipi: <span className="font-semibold">{channel.rooms.find((room) => room.roomTypeId === row.roomTypeId)?.externalName ?? row.externalRoomTypeId}</span></p>
                  )}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Fiyat planları</span>
                    {row.rates.length === 0 && <p className="text-xs text-warning-ink">Fiyat planı yok: bu tipe fiyat gitmez, senkrona alınamaz.</p>}
                    {row.rates.map((rate, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
                        {canManage ? (
                          <Select
                            label="Channex fiyat planı"
                            name={`map-rate-${row.roomTypeId}-${index}`}
                            value={rate.externalRatePlanId}
                            onChange={(event) => updateRate(row, index, { externalRatePlanId: event.target.value })}
                            options={[{ value: '', label: row.externalRoomTypeId ? 'Plan seçin' : 'Önce oda tipini seçin' }, ...plans.map((plan) => ({ value: plan.id, label: plan.title }))]}
                            error={errorsOf[`rates.${index}.externalRatePlanId`]}
                            disabled={disabled || !row.externalRoomTypeId}
                          />
                        ) : (
                          <span className="text-sm">{channel.rooms.find((room) => room.roomTypeId === row.roomTypeId)?.rates.find((item) => item.externalRatePlanId === rate.externalRatePlanId)?.externalName ?? rate.externalRatePlanId}</span>
                        )}
                        <Select label="Pansiyon" name={`map-board-${row.roomTypeId}-${index}`} value={rate.boardType} onChange={(event) => updateRate(row, index, { boardType: event.target.value })} options={BOARD_OPTIONS} disabled={disabled} />
                        {canManage && (
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => update(row.roomTypeId, { rates: row.rates.filter((_, position) => position !== index) })} disabled={disabled}>
                            Kaldır
                          </Button>
                        )}
                      </div>
                    ))}
                    {canManage && row.rates.length < MAX_CHANNEL_RATE_MAPPINGS_PER_ROOM && (
                      <Button size="sm" variant="outline" icon="plus" className="w-fit" onClick={() => update(row.roomTypeId, { rates: [...row.rates, { externalRatePlanId: '', boardType: 'BB' }] })} disabled={disabled}>
                        Fiyat planı ekle
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {row.enabled && !isChannex && <IcalRow row={row} errors={errorsOf} disabled={disabled} onChange={(icalImportUrl) => update(row.roomTypeId, { icalImportUrl })} />}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <div className="flex gap-2">
          <Button icon="check" onClick={submit} disabled={busy || serverChanged}>{busy ? 'Kaydediliyor…' : 'Eşleştirmeyi kaydet'}</Button>
        </div>
      )}
    </div>
  );
}

/**
 * iCal satırı: kanalın takvim adresi, bizim dışa aktarma adresimiz (kopyala),
 * son okuma / kanalın son okuması ve hata.
 * @param {{ row: import('../../lib/channelForm.js').MappingRow, errors: Record<string, string>, disabled: boolean, onChange: (value: string) => void }} props
 */
function IcalRow({ row, errors, disabled, onChange }) {
  const formatDateTime = useChannelTime();
  const url = exportUrl(API_URL, row.exportPath);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Adres kopyalandı; kanalın "takvim içe aktar" alanına yapıştırın');
    } catch {
      toastError('Kopyalanamadı; adresi seçip elle kopyalayın');
    }
  }
  return (
    <div className="mt-3 flex flex-col gap-3 pl-7">
      <Input
        label="Kanalın takvim adresi (içe aktarma)"
        name={`map-ical-${row.roomTypeId}`}
        value={row.icalImportUrl}
        onChange={(event) => onChange(event.target.value)}
        error={errors.icalImportUrl}
        placeholder="https://www.airbnb.com/calendar/ical/….ics?s=…"
        disabled={disabled}
      />
      <div className="text-xs text-ink-muted">
        {row.lastImportAt ? `En son ${formatDateTime(row.lastImportAt)} okundu` : row.icalImportUrl ? 'Henüz okunmadı' : 'Adres girilmezse kanaldaki rezervasyonlar gelmez'}
        {row.lastImportError && <span className="block font-semibold text-danger-ink">Okunamadı: {row.lastImportError}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Bizim takvimimiz (kanala verin)</span>
        {url ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-item bg-surface-muted px-2 py-1 text-xs">{url}</code>
            <Button size="sm" variant="outline" icon="clipboard" onClick={copy}>Kopyala</Button>
          </div>
        ) : (
          <span className="text-xs text-ink-muted">Kaydedince oluşur.</span>
        )}
        <span className="text-xs text-ink-muted">{row.lastExportAt ? `Kanal en son ${formatDateTime(row.lastExportAt)} okudu` : 'Kanal henüz okumadı'}</span>
      </div>
    </div>
  );
}
