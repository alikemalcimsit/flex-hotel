import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_SUPPLIER_LEAD_DAYS,
  MAX_SUPPLIER_PAYMENT_TERM_DAYS,
  PURCHASE_TAX_RATES,
  STOCK_ITEM_GROUPS,
  STOCK_ITEM_GROUP_LABELS,
  createSupplierSchema,
  updatePurchaseSettingsSchema,
  updateSupplierSchema,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Card, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Etkin' },
  { value: 'false', label: 'Pasif' },
  { value: '', label: 'Hepsi' },
];

/**
 * Tedarikçiler (modül 45): kart (vergi, yetkili, ödeme vadesi, olağan termin, tedarik ettiği
 * gruplar), açık sipariş ve son sipariş. Düzenleme ve satın alma politikası (sipariş onay eşiği,
 * varsayılan KDV) `purchasing.manage`.
 */
export function SuppliersPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [group, setGroup] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search, group, active]);

  const filters = { search: search || undefined, group: group || undefined, active: active || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.suppliers(filters), queryFn: () => api(withQuery('/purchasing/suppliers', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'name',
      header: 'Tedarikçi',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, row.contactName, row.phone].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    { key: 'groups', header: 'Gruplar', render: (row) => <span className="text-xs text-ink-soft">{row.groups.map((entry) => STOCK_ITEM_GROUP_LABELS[entry]).join(', ') || '—'}</span> },
    { key: 'terms', header: 'Vade / termin', render: (row) => `${row.paymentTermDays} gün / ${row.leadTimeDays} gün` },
    { key: 'open', header: 'Açık sipariş', className: 'text-right tabular-nums', render: (row) => row.openOrders },
    { key: 'last', header: 'Son sipariş', render: (row) => (row.lastOrderAt ? formatDate(row.lastOrderAt) : '—') },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Etkin' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PurchaseSettingsCard canManage={canManage} />
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setEditing('new')}>
              Tedarikçi ekle
            </Button>
          )
        }
      >
        <Input label="Ara" name="supplier-search" placeholder="Ad, kod, vergi no, yetkili" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Select label="Grup" name="supplier-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-52" />
        <Select label="Durum" name="supplier-active" options={ACTIVE_OPTIONS} value={active} onChange={(event) => setActive(event.target.value)} className="w-full sm:w-36" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || group ? 'Eşleşen tedarikçi yok' : 'Tedarikçi yok'}
        emptyHint={canManage && !search && !group ? 'Kasap, hal, toptancı… tedarikçileri vergi bilgisi, ödeme vadesi ve tedarik ettiği gruplarla ekleyin.' : undefined}
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
      {editing && <SupplierDialog supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ supplier: any | null, onClose: () => void }} props */
function SupplierDialog({ supplier, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => ({
    code: supplier?.code ?? '',
    name: supplier?.name ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    taxOffice: supplier?.taxOffice ?? '',
    taxNumber: supplier?.taxNumber ?? '',
    address: supplier?.address ?? '',
    paymentTermDays: String(supplier?.paymentTermDays ?? 30),
    leadTimeDays: String(supplier?.leadTimeDays ?? 1),
    groups: supplier?.groups ?? [],
    notes: supplier?.notes ?? '',
    isActive: supplier?.isActive ?? true,
  }));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (supplier ? apiPut(`/purchasing/suppliers/${supplier.id}`, body) : apiPost('/purchasing/suppliers', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastSuccess(supplier ? `${result.name} güncellendi` : `${result.name} eklendi`);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastError(error.code === 'STALE_WRITE' ? 'Tedarikçi bu arada değişti; liste yenilendi, tekrar açın.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const { isActive, ...rest } = values;
    const body = supplier ? { ...rest, isActive, expectedUpdatedAt: supplier.updatedAt } : rest;
    if (String(values.paymentTermDays).trim() === '' || String(values.leadTimeDays).trim() === '') {
      return setErrors({ ...(String(values.paymentTermDays).trim() === '' ? { paymentTermDays: 'Vade yazın' } : {}), ...(String(values.leadTimeDays).trim() === '' ? { leadTimeDays: 'Termin yazın' } : {}) });
    }
    const checked = validateWith(supplier ? updateSupplierSchema : createSupplierSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={supplier ? supplier.name : 'Yeni tedarikçi'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="supplier-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Unvan" name="supplier-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} className="sm:col-span-2" />
        <Input label="Kod (isteğe bağlı)" name="supplier-code" value={values.code} onChange={set('code')} error={errors.code} disabled={busy} />
        <Input label="Yetkili" name="supplier-contact" value={values.contactName} onChange={set('contactName')} error={errors.contactName} disabled={busy} />
        <Input label="Telefon" name="supplier-phone" type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} disabled={busy} />
        <Input label="E-posta" name="supplier-email" type="email" value={values.email} onChange={set('email')} error={errors.email} disabled={busy} />
        <Input label="Vergi dairesi" name="supplier-tax-office" value={values.taxOffice} onChange={set('taxOffice')} error={errors.taxOffice} disabled={busy} />
        <Input label="Vergi no / T.C. kimlik no" name="supplier-tax-number" inputMode="numeric" value={values.taxNumber} onChange={set('taxNumber')} error={errors.taxNumber} disabled={busy} />
        <Input label={`Ödeme vadesi (gün, en fazla ${MAX_SUPPLIER_PAYMENT_TERM_DAYS})`} name="supplier-term" inputMode="numeric" value={values.paymentTermDays} onChange={set('paymentTermDays')} error={errors.paymentTermDays} required disabled={busy} />
        <Input label={`Olağan termin (gün, en fazla ${MAX_SUPPLIER_LEAD_DAYS})`} name="supplier-lead" inputMode="numeric" value={values.leadTimeDays} onChange={set('leadTimeDays')} error={errors.leadTimeDays} required disabled={busy} />
        <Textarea label="Adres" name="supplier-address" rows={2} value={values.address} onChange={set('address')} error={errors.address} disabled={busy} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <MultiChips
            label="Tedarik ettiği gruplar (teklif turunda öneri)"
            options={STOCK_ITEM_GROUPS.map((value) => ({ value, label: STOCK_ITEM_GROUP_LABELS[value] }))}
            values={values.groups}
            onChange={(groups) => setValues((current) => ({ ...current, groups }))}
            disabled={busy}
            error={errors.groups}
          />
        </div>
        <Textarea label="Not" name="supplier-notes" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} className="sm:col-span-2" />
        {supplier && (
          <Checkbox
            label="Etkin"
            hint="Pasif tedarikçi yeni teklife ve kazanan seçimine alınmaz; açık siparişleri sürer."
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy}
            className="sm:col-span-2"
          />
        )}
      </form>
    </Modal>
  );
}

/** Satın alma politikası: sipariş onay eşiği (KDV dahil; 0 = onay yok) ve tekliflerde varsayılan KDV. */
function PurchaseSettingsCard({ canManage }) {
  const queryClient = useQueryClient();
  const { data: hotel } = useHotelContext();
  const query = useQuery({ queryKey: purchasingKeys.settings, queryFn: () => api('/purchasing/settings') });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ orderApprovalAmount: '', defaultTaxRatePct: '10' });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => apiPut('/purchasing/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(purchasingKeys.settings, result);
      setEditing(false);
      toastSuccess('Satın alma politikası kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: purchasingKeys.settings });
      toastError(error.code === 'STALE_WRITE' ? 'Politika bu arada değişti; yenilendi.' : error.message);
    },
  });
  const settings = query.data;

  function start() {
    setValues({ orderApprovalAmount: settings.orderApprovalAmount, defaultTaxRatePct: settings.defaultTaxRatePct });
    setErrors({});
    setEditing(true);
  }
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: settings.updatedAt, ...values };
    const checked = validateWith(updatePurchaseSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    save.mutate(body);
  }

  return (
    <Card
      title="Satın alma politikası"
      description="KDV dahil tutarı eşik ve üstündeki sipariş onay kuyruğuna gider; başka bir yetkili onaylar (isteyen kendi siparişini onaylayamaz)."
      actions={
        canManage &&
        settings &&
        !editing && (
          <Button type="button" size="sm" variant="outline" icon="pencil" onClick={start}>
            Düzenle
          </Button>
        )
      }
    >
      {query.isPending ? (
        <p className="text-sm text-ink-muted">Yükleniyor…</p>
      ) : query.isError ? (
        <p className="text-sm text-sec-strong">Politika yüklenemedi: {query.error.message}</p>
      ) : editing ? (
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
          <Input label={`Onay eşiği (${hotel?.currency ?? ''}, 0 = onay yok)`} name="settings-threshold" inputMode="decimal" value={values.orderApprovalAmount} onChange={(event) => setValues((current) => ({ ...current, orderApprovalAmount: event.target.value }))} error={errors.orderApprovalAmount} disabled={save.isPending} className="w-full sm:w-56" />
          <Select
            label="Varsayılan KDV"
            name="settings-tax"
            options={PURCHASE_TAX_RATES.map((rate) => ({ value: rate, label: `%${rate}` }))}
            value={values.defaultTaxRatePct}
            onChange={(event) => setValues((current) => ({ ...current, defaultTaxRatePct: event.target.value }))}
            error={errors.defaultTaxRatePct}
            disabled={save.isPending}
            className="w-full sm:w-36"
          />
          <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" icon="check" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </form>
      ) : (
        <dl className="flex flex-wrap gap-8 text-sm">
          <div>
            <dt className="text-ink-muted">Onay eşiği (KDV dahil)</dt>
            <dd className="text-lg font-semibold tabular-nums">{Number(settings.orderApprovalAmount) > 0 ? formatMoney(settings.orderApprovalAmount, hotel?.currency) : 'Onay yok'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Tekliflerde varsayılan KDV</dt>
            <dd className="text-lg font-semibold">%{settings.defaultTaxRatePct}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
