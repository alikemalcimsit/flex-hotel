import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_CONTRACT_TERMS_LENGTH,
  MAX_POLICY_TIERS,
  VENUE_LAYOUTS,
  VENUE_LAYOUT_LABELS,
  VENUE_STATUS_LABELS,
  cancellationTierRanges,
  createEquipmentSchema,
  createVenueSchema,
  updateEquipmentSchema,
  updateEventSettingsSchema,
  updateVenueSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { banquetKeys, useBanquetSettings, useVenues } from '../../lib/banquet.js';
import { EMPTY_VENUE_FORM, venueFormOf, venuePayloadOf } from '../../lib/banquetForm.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';
import { ClientDialog } from './ClientPicker.jsx';

const SECTIONS = Object.freeze([
  { key: 'salonlar', label: 'Salonlar' },
  { key: 'ekipman', label: 'Ekipman' },
  { key: 'musteriler', label: 'Müşteriler' },
  { key: 'politika', label: 'Banket politikası' },
]);
const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** @param {string} text */
function useDebounced(text) {
  const [value, setValue] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setValue(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return value;
}

/**
 * Banket tanımları (modül 37): salonlar (bölünebilir yapı, düzen başına kapasite,
 * fiyatlar, kurulum / söküm), ekipman (stok), müşteri kartları ve banket politikası
 * (opsiyon süresi, teklif geçerliliği, depozito, imzalı sözleşme şartı, iptal
 * kademeleri, sözleşme şartları). Salon / ekipman / politika `banquet.setup`,
 * müşteri kartı `banquet.manage` ister.
 */
export function SetupTab() {
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((entry) => entry.key === params.get('bolum')) ? params.get('bolum') : 'salonlar';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tanım bölümü">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={section === entry.key}
            onClick={() => setParams(entry.key === 'salonlar' ? {} : { bolum: entry.key }, { replace: true })}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${section === entry.key ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {section === 'salonlar' && <VenuesSection />}
      {section === 'ekipman' && <EquipmentSection />}
      {section === 'musteriler' && <ClientsSection />}
      {section === 'politika' && <PolicySection />}
    </div>
  );
}

/* ══════════════════ Salonlar ══════════════════ */

function VenuesSection() {
  const can = useCan();
  const venues = useVenues();
  const [editing, setEditing] = useState(null);
  const canSetup = can(PERMISSIONS.BANQUET_SETUP);
  if (venues.isPending || venues.isError) return <QueryFallback query={venues} errorTitle="Salonlar yüklenemedi" />;
  const items = venues.data.items;
  return (
    <Card
      title="Salonlar"
      description="Bölünebilir salonda bütün satılınca bütün parçalar, parça satılınca bütün dolar. Kapasite düzene göre."
      actions={
        canSetup && (
          <Button type="button" size="sm" icon="plus" onClick={() => setEditing('new')}>
            Salon ekle
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState icon="building" title="Salon yok" description={canSetup ? 'Salonları kapasite ve fiyatlarıyla tanımlayın.' : 'Henüz salon tanımlanmamış.'} />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Salon</th>
                <th scope="col" className="px-3 py-2 font-bold">Kapasite</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Saatlik / yarım / tam gün</th>
                <th scope="col" className="px-3 py-2 font-bold">Hazırlık</th>
                <th scope="col" className="px-3 py-2 font-bold">Durum</th>
                {canSetup && <th scope="col" className="px-3 py-2"><span className="sr-only">İşlem</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((venue) => (
                <tr key={venue.id}>
                  <td className="px-3 py-2">
                    <span className={`block font-semibold ${venue.parentId ? 'pl-4 text-ink-soft' : ''}`}>
                      {venue.parentId ? '└ ' : ''}
                      {venue.name}
                    </span>
                    <span className={`block font-mono text-xs text-ink-muted ${venue.parentId ? 'pl-4' : ''}`}>
                      {venue.code}
                      {venue.partCount ? ` · ${venue.partCount} parça` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{venue.capacities.map((entry) => `${VENUE_LAYOUT_LABELS[entry.layout]} ${entry.capacity}`).join(' · ')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                    {[venue.hourlyRate, venue.halfDayRate, venue.dayRate].map((rate) => (rate ? formatMoney(rate) : '—')).join(' / ')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">
                    {venue.setupMinutes} / {venue.teardownMinutes} dk
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={venue.status === 'ACTIVE' ? 'success' : 'neutral'}>{VENUE_STATUS_LABELS[venue.status]}</Badge>
                  </td>
                  {canSetup && (
                    <td className="px-3 py-2 text-right">
                      <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(venue)}>
                        Düzenle
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <VenueDialog venue={editing === 'new' ? null : editing} venues={items} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** @param {{ venue: any | null, venues: any[], onClose: () => void }} props */
function VenueDialog({ venue, venues, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => (venue ? venueFormOf(venue) : { ...EMPTY_VENUE_FORM, capacities: [] }));
  const [errors, setErrors] = useState({});
  const set = (key) => (changeEvent) => setValues((current) => ({ ...current, [key]: changeEvent.target.value }));
  const capacityOf = (layout) => values.capacities.find((entry) => entry.layout === layout)?.capacity ?? '';
  const setCapacity = (layout, capacity) =>
    setValues((current) => ({ ...current, capacities: [...current.capacities.filter((entry) => entry.layout !== layout), ...(capacity === '' ? [] : [{ layout, capacity }])] }));
  // Yalnızca parçası olmayan bir bütüne bağlanır (iki seviye); parçaları olan salon parça olamaz.
  const parents = venues.filter((entry) => !entry.parentId && entry.id !== venue?.id);
  const hasParts = Boolean(venue?.partCount);

  const save = useMutation({
    mutationFn: (body) => (venue ? api(`/banquet/venues/${venue.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/banquet/venues', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(venue ? 'Salon güncellendi' : 'Salon eklendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = venuePayloadOf({ ...values, capacities: VENUE_LAYOUTS.map((layout) => ({ layout, capacity: capacityOf(layout) })) }, venue?.updatedAt);
    const checked = validateWith(venue ? updateVenueSchema : createVenueSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={venue ? `${venue.name} salonu` : 'Yeni salon'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="venue-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="venue-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Kod" name="venue-code" value={values.code} onChange={set('code')} error={errors.code} required disabled={busy} />
        <Input label="Ad" name="venue-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} />
        <Select
          label="Bütün salon (parçasıysa)"
          name="venue-parent"
          value={values.parentId}
          onChange={set('parentId')}
          error={errors.parentId}
          disabled={busy || hasParts}
          options={[{ value: '', label: hasParts ? 'Bu salonun parçaları var' : 'Bağımsız salon' }, ...parents.map((entry) => ({ value: entry.id, label: entry.name }))]}
        />
        {venue ? (
          <Select
            label="Durum"
            name="venue-status"
            value={values.status}
            onChange={set('status')}
            disabled={busy}
            options={Object.entries(VENUE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        ) : (
          <Input label="Alan (m²)" name="venue-area" inputMode="decimal" value={values.areaSqm} onChange={set('areaSqm')} error={errors.areaSqm} disabled={busy} />
        )}
        <Input label="Saatlik fiyat" name="venue-hourly" inputMode="decimal" value={values.hourlyRate} onChange={set('hourlyRate')} error={errors.hourlyRate} disabled={busy} />
        <Input label="Yarım gün fiyatı" name="venue-half" inputMode="decimal" value={values.halfDayRate} onChange={set('halfDayRate')} error={errors.halfDayRate} disabled={busy} />
        <Input label="Tam gün fiyatı" name="venue-day" inputMode="decimal" value={values.dayRate} onChange={set('dayRate')} error={errors.dayRate} disabled={busy} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Kurulum (dk)" name="venue-setup" type="number" min={0} max={720} value={values.setupMinutes} onChange={set('setupMinutes')} error={errors.setupMinutes} disabled={busy} />
          <Input label="Söküm (dk)" name="venue-teardown" type="number" min={0} max={720} value={values.teardownMinutes} onChange={set('teardownMinutes')} error={errors.teardownMinutes} disabled={busy} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Kapasite (düzene göre; boş = bu düzen yok)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {VENUE_LAYOUTS.map((layout) => (
              <Input key={layout} label={VENUE_LAYOUT_LABELS[layout]} name={`venue-capacity-${layout}`} type="number" min={1} value={capacityOf(layout)} onChange={(changeEvent) => setCapacity(layout, changeEvent.target.value)} disabled={busy} />
            ))}
          </div>
          {errors.capacities && <p className="mt-1 text-xs font-semibold text-sec-strong">{errors.capacities}</p>}
        </fieldset>
        <Textarea label="Açıklama" name="venue-description" rows={2} value={values.description} onChange={set('description')} error={errors.description} className="sm:col-span-2" disabled={busy} />
        {venue && values.status === 'PASSIVE' && venue.status === 'ACTIVE' && (
          <Alert tone="warning" title="Pasif salon" className="sm:col-span-2">
            Yeni oturuma seçilemez; kesin etkinlikler etkilenmez, bu salondaki talep / opsiyonlar başka salona alınmadan kesinleşemez.
          </Alert>
        )}
      </form>
    </Modal>
  );
}

/* ══════════════════ Ekipman ══════════════════ */

function EquipmentSection() {
  const can = useCan();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search]);
  const list = useQuery({
    queryKey: banquetKeys.equipment({ search, page }),
    queryFn: () => api(withQuery('/banquet/equipment', { search: search || undefined, page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const canSetup = can(PERMISSIONS.BANQUET_SETUP);
  const columns = [
    { key: 'name', header: 'Ekipman', render: (row) => <span className="block"><span className="block font-semibold">{row.name}</span><span className="block font-mono text-xs text-ink-muted">{row.code}</span></span> },
    { key: 'price', header: 'Birim fiyat', className: 'text-right tabular-nums', render: (row) => formatMoney(row.unitPrice) },
    { key: 'stock', header: 'Stok', className: 'text-right tabular-nums', render: (row) => row.stockQuantity },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Kullanımda' : 'Pasif'}</Badge> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input label="Ara" name="equipment-search" placeholder="Ad ya da kod" value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} className="w-full sm:max-w-xs" />
        {canSetup && (
          <Button type="button" icon="plus" onClick={() => setEditing('new')}>
            Ekipman ekle
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search ? 'Eşleşen ekipman yok' : 'Ekipman tanımlı değil'}
        emptyHint={canSetup && !search ? 'Projeksiyon, mikrofon, sahne gibi stoklu ekipmanı tanımlayın: kesin etkinliklerde aynı saatte stoktan fazlası ayrılamaz.' : undefined}
        rowActions={
          canSetup
            ? (row) => (
                <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
              )
            : undefined
        }
      />
      {editing && <EquipmentDialog equipment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ equipment: any | null, onClose: () => void }} props */
function EquipmentDialog({ equipment, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() =>
    equipment ? { code: equipment.code, name: equipment.name, unitPrice: equipment.unitPrice, stockQuantity: String(equipment.stockQuantity), isActive: equipment.isActive } : { code: '', name: '', unitPrice: '', stockQuantity: '', isActive: true },
  );
  const [errors, setErrors] = useState({});
  const set = (key) => (changeEvent) => setValues((current) => ({ ...current, [key]: changeEvent.target.value }));
  const save = useMutation({
    mutationFn: (body) => (equipment ? api(`/banquet/equipment/${equipment.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/banquet/equipment', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(equipment ? 'Ekipman güncellendi' : 'Ekipman eklendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = equipment ? { ...values, expectedUpdatedAt: equipment.updatedAt } : values;
    const checked = validateWith(equipment ? updateEquipmentSchema : createEquipmentSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="sm"
      title={equipment ? equipment.name : 'Yeni ekipman'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="equipment-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="equipment-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Kod" name="equipment-code" value={values.code} onChange={set('code')} error={errors.code} required disabled={busy} />
        <Input label="Ad" name="equipment-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} />
        <Input label="Birim fiyat (vergi dahil)" name="equipment-price" inputMode="decimal" value={values.unitPrice} onChange={set('unitPrice')} error={errors.unitPrice} required disabled={busy} />
        <Input label="Stok" name="equipment-stock" type="number" min={0} value={values.stockQuantity} onChange={set('stockQuantity')} error={errors.stockQuantity} required disabled={busy} />
        <Checkbox label="Kullanımda" hint="Pasif ekipman yeni kaleme seçilmez; kayıtlı kalemler etkilenmez." checked={values.isActive} onChange={(changeEvent) => setValues((current) => ({ ...current, isActive: changeEvent.target.checked }))} disabled={busy} />
      </form>
    </Modal>
  );
}

/* ══════════════════ Müşteriler ══════════════════ */

function ClientsSection() {
  const can = useCan();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search]);
  const list = useQuery({
    queryKey: banquetKeys.clients({ search, page }),
    queryFn: () => api(withQuery('/banquet/clients', { search: search || undefined, page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const canManage = can(PERMISSIONS.BANQUET_MANAGE);
  const columns = [
    { key: 'name', header: 'Müşteri', render: (row) => <span className="block"><span className="block font-semibold">{row.name}</span><span className="block text-xs text-ink-muted">{row.type === 'COMPANY' ? 'Kurumsal' : 'Bireysel'}{row.taxNumber ? ` · ${row.taxNumber}` : ''}</span></span> },
    { key: 'contact', header: 'Yetkili / iletişim', render: (row) => <span className="block text-xs"><span className="block">{row.contactName ?? '—'}</span><span className="block text-ink-muted">{[row.phone, row.email].filter(Boolean).join(' · ')}</span></span> },
    { key: 'events', header: 'Etkinlik', className: 'text-right tabular-nums', render: (row) => row.eventCount },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input label="Ara" name="client-search" placeholder="Ad, yetkili, telefon ya da vergi no" value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} className="w-full sm:max-w-xs" />
        {canManage && (
          <Button type="button" icon="plus" onClick={() => setEditing('new')}>
            Müşteri ekle
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search ? 'Eşleşen müşteri yok' : 'Müşteri kartı yok'}
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
      {editing && <ClientDialog client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </div>
  );
}

/* ══════════════════ Politika ══════════════════ */

function PolicySection() {
  const can = useCan();
  const queryClient = useQueryClient();
  const settings = useBanquetSettings();
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (settings.data && values === null) {
      setValues({
        optionDays: String(settings.data.optionDays),
        offerValidityDays: String(settings.data.offerValidityDays),
        depositPct: settings.data.depositPct,
        requireSignedContract: settings.data.requireSignedContract,
        cancellationTiers: settings.data.cancellationTiers.map((tier) => ({ daysBefore: String(tier.daysBefore), feePct: tier.feePct })),
        contractTerms: settings.data.contractTerms ?? '',
      });
    }
  }, [settings.data, values]);
  const save = useMutation({
    mutationFn: (body) => api('/banquet/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      setValues(null);
      toastSuccess('Banket politikası kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') {
        setValues(null);
        queryClient.invalidateQueries({ queryKey: banquetKeys.settings });
      }
      toastError(error.message);
    },
  });

  if (settings.isPending || settings.isError) return <QueryFallback query={settings} errorTitle="Politika yüklenemedi" />;
  if (!values) return <Spinner className="py-6" />;
  const canSetup = can(PERMISSIONS.BANQUET_SETUP);
  const busy = save.isPending;
  const set = (key) => (changeEvent) => setValues((current) => ({ ...current, [key]: changeEvent.target.value }));
  const setTier = (index, key, value) => setValues((current) => ({ ...current, cancellationTiers: current.cancellationTiers.map((tier, position) => (position === index ? { ...tier, [key]: value } : tier)) }));
  const validTiers = values.cancellationTiers.filter((tier) => tier.daysBefore !== '' && tier.feePct !== '').map((tier) => ({ daysBefore: Number(tier.daysBefore), feePct: tier.feePct }));

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { ...values, expectedUpdatedAt: settings.data.updatedAt };
    const checked = validateWith(updateEventSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Card title="Opsiyon, teklif ve depozito">
        <fieldset disabled={!canSetup || busy} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Opsiyon süresi (gün)" name="policy-option-days" type="number" min={1} value={values.optionDays} onChange={set('optionDays')} error={errors.optionDays} />
          <Input label="Teklif geçerliliği (gün)" name="policy-offer-days" type="number" min={1} value={values.offerValidityDays} onChange={set('offerValidityDays')} error={errors.offerValidityDays} />
          <Input label="Depozito (%)" name="policy-deposit" inputMode="decimal" value={values.depositPct} onChange={set('depositPct')} error={errors.depositPct} />
          <Checkbox
            className="sm:col-span-3"
            label="Kesinleştirmek için imzalı sözleşme şart"
            hint="Açıkken etkinlik ancak güncel sözleşmesi imzalandı olarak işaretlenince kesinleşir."
            checked={values.requireSignedContract}
            onChange={(changeEvent) => setValues((current) => ({ ...current, requireSignedContract: changeEvent.target.checked }))}
          />
        </fieldset>
      </Card>
      <Card title="İptal kademeleri" description="Eşik alt sınırdır: etkinliğe en az N gün kala iptalde bedel yüzdesi. En küçük eşik 0 gün olmalı. Kesinleşen etkinlik o anki kademeleri kopyalar.">
        <fieldset disabled={!canSetup || busy} className="flex flex-col gap-2">
          {values.cancellationTiers.map((tier, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Input label={index === 0 ? 'En az kaç gün kala' : undefined} aria-label={`${index + 1}. kademe gün`} type="number" min={0} value={tier.daysBefore} onChange={(changeEvent) => setTier(index, 'daysBefore', changeEvent.target.value)} error={errors[`cancellationTiers.${index}.daysBefore`]} />
              <Input label={index === 0 ? 'Bedel (%)' : undefined} aria-label={`${index + 1}. kademe yüzde`} inputMode="decimal" value={tier.feePct} onChange={(changeEvent) => setTier(index, 'feePct', changeEvent.target.value)} error={errors[`cancellationTiers.${index}.feePct`]} />
              <Button type="button" variant="ghost" icon="trash" aria-label={`${index + 1}. kademeyi kaldır`} onClick={() => setValues((current) => ({ ...current, cancellationTiers: current.cancellationTiers.filter((_, position) => position !== index) }))} />
            </div>
          ))}
          <div>
            <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setValues((current) => ({ ...current, cancellationTiers: [...current.cancellationTiers, { daysBefore: '', feePct: '' }] }))} disabled={values.cancellationTiers.length >= MAX_POLICY_TIERS}>
              Kademe ekle
            </Button>
          </div>
        </fieldset>
        {validTiers.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 rounded-item bg-surface-muted p-3 text-sm">
            {cancellationTierRanges(validTiers).map((tier) => (
              <li key={tier.daysBefore} className="flex justify-between gap-3">
                <span className="text-ink-soft">{tier.label}</span>
                <span className="font-semibold">%{tier.feePct}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Sözleşme şartları" description="Sözleşme PDF'inin sonunda basılır.">
        <Textarea label="Şartlar" name="policy-terms" rows={8} maxLength={MAX_CONTRACT_TERMS_LENGTH} value={values.contractTerms} onChange={set('contractTerms')} error={errors.contractTerms} disabled={!canSetup || busy} />
      </Card>
      {canSetup && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface px-6 py-4 shadow-card">
          <p className="text-xs text-ink-muted">{settings.data.updatedAt ? `Son güncelleme: ${new Date(settings.data.updatedAt).toLocaleString('tr-TR')}` : 'Henüz kaydedilmedi: varsayılanlar geçerli.'}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setValues(null)} disabled={busy}>
              Değişiklikleri at
            </Button>
            <Button type="submit" icon="check" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
