import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MAX_AGENCY_CODE_LENGTH,
  MAX_COMMISSION_PCT,
  MAX_CONTRACT_END_REASON_LENGTH,
  MAX_PAYMENT_TERM_DAYS,
  MAX_STOP_SALE_REASON_LENGTH,
  addStopSaleSchema,
  createAgencySchema,
  createContractSchema,
  endContractSchema,
  updateAgencySchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { agencyKeys } from '../../lib/agencies.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';

const STALE_TEXT = 'Kayıt bu arada başkası tarafından değiştirildi; ekran yenilendi, değişikliğinizi kontrol edip tekrar deneyin.';

/** Sunucu hatasını form alanlarına ya da bildirime dağıtır. @param {Error & { fields?: object, code?: string }} error @param {(fields: object) => void} setErrors */
function handleError(error, setErrors) {
  if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
  toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
}

/* ══════════════════ Acente kartı ══════════════════ */

const EMPTY_AGENCY = Object.freeze({
  code: '',
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  taxOffice: '',
  taxNumber: '',
  commissionPct: '0',
  paymentTermDays: '0',
  notes: '',
});

/** @param {any} agency */
const draftOf = (agency) =>
  agency
    ? {
        code: agency.code,
        name: agency.name,
        contactName: agency.contactName ?? '',
        phone: agency.phone ?? '',
        email: agency.email ?? '',
        address: agency.address ?? '',
        taxOffice: agency.taxOffice ?? '',
        taxNumber: agency.taxNumber ?? '',
        commissionPct: String(agency.commissionPct),
        paymentTermDays: String(agency.paymentTermDays),
        notes: agency.notes ?? '',
      }
    : { ...EMPTY_AGENCY };

/**
 * Acente kartı: açma ve düzenleme (modül 29). Komisyon oranı rezervasyon
 * açılırken rezervasyona kopyalanır; kartta değişirse açılmış rezervasyonlar
 * etkilenmez.
 *
 * @param {{ agency?: any, onClose: () => void, onSaved: (agency: any) => void }} props
 */
export function AgencyFormDialog({ agency, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => draftOf(agency));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: (payload) => (agency ? apiPatch(`/agencies/${agency.id}`, payload) : apiPost('/agencies', payload)),
    onSuccess: (saved) => {
      toastSuccess(agency ? 'Acente kartı güncellendi' : 'Acente açıldı');
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      onSaved(saved);
    },
    onError: (error) => {
      handleError(error, setErrors);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: agencyKeys.all });
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = { ...values, ...(agency ? { expectedUpdatedAt: agency.updatedAt } : {}) };
    // Boş komisyon "0" sayılır (şema varsayılanı); boş vade 0 gündür.
    if (payload.commissionPct === '') payload.commissionPct = undefined;
    const checked = validateWith(agency ? updateAgencySchema : createAgencySchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={agency ? `${agency.name} — kartı düzenle` : 'Yeni acente'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="agency-form" icon="check" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </>
      }
    >
      <form id="agency-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Kod" name="agency-code" value={values.code} onChange={set('code')} error={errors.code} maxLength={MAX_AGENCY_CODE_LENGTH} placeholder="TUI" disabled={busy} className="uppercase" required />
          <Input label="Firma adı" name="agency-name" value={values.name} onChange={set('name')} error={errors.name} disabled={busy} className="sm:col-span-2" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Yetkili" name="agency-contact" value={values.contactName} onChange={set('contactName')} error={errors.contactName} disabled={busy} />
          <Input label="Telefon" name="agency-phone" type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} disabled={busy} />
          <Input label="E-posta" name="agency-email" type="email" value={values.email} onChange={set('email')} error={errors.email} disabled={busy} />
        </div>
        <Input label="Adres" name="agency-address" value={values.address} onChange={set('address')} error={errors.address} disabled={busy} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Vergi dairesi" name="agency-tax-office" value={values.taxOffice} onChange={set('taxOffice')} error={errors.taxOffice} disabled={busy} />
          <Input label="Vergi numarası" name="agency-tax-number" value={values.taxNumber} onChange={set('taxNumber')} error={errors.taxNumber} disabled={busy} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Input label="Komisyon (%)" name="agency-commission" type="number" inputMode="decimal" min={0} max={MAX_COMMISSION_PCT} step="0.01" value={values.commissionPct} onChange={set('commissionPct')} error={errors.commissionPct} disabled={busy} />
            <p className="text-xs text-ink-muted">Rezervasyon toplamı üzerinden. Açılmış rezervasyonlar açıldıkları günkü oranı korur.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input label="Vade (gün)" name="agency-term" type="number" inputMode="numeric" min={0} max={MAX_PAYMENT_TERM_DAYS} step="1" value={values.paymentTermDays} onChange={set('paymentTermDays')} error={errors.paymentTermDays} disabled={busy} />
            <p className="text-xs text-ink-muted">Çıkış gününden sonra ödeme günü.</p>
          </div>
        </div>
        <Textarea label="Not" name="agency-notes" rows={3} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} />
      </form>
    </Modal>
  );
}

/* ══════════════════ Kontrat ══════════════════ */

/**
 * Yeni taslak kontrat: ad ve dönem. Fiyatlar kontrat ekranında girilir.
 *
 * @param {{ agencyId: string, onClose: () => void, onCreated: (contract: any) => void }} props
 */
export function CreateContractDialog({ agencyId, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', startDate: '', endDate: '', notes: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: (payload) => apiPost(`/agencies/${agencyId}/contracts`, payload),
    onSuccess: (contract) => {
      toastSuccess('Taslak kontrat açıldı; fiyatları girip satışa açın');
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      onCreated(contract);
    },
    onError: (error) => handleError(error, setErrors),
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createContractSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(values);
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      size="md"
      title="Yeni kontrat"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="contract-form" icon="check" disabled={busy}>{busy ? 'Açılıyor…' : 'Taslak aç'}</Button>
        </>
      }
    >
      <form id="contract-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Kontrat adı" name="new-contract-name" value={values.name} onChange={set('name')} error={errors.name} placeholder="Yaz 2027" disabled={busy} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Başlangıç" name="new-contract-start" type="date" value={values.startDate} onChange={set('startDate')} error={errors.startDate} disabled={busy} required />
          <Input label="Bitiş (dahil)" name="new-contract-end" type="date" min={values.startDate || undefined} value={values.endDate} onChange={set('endDate')} error={errors.endDate} disabled={busy} required />
        </div>
        <Textarea label="Not" name="new-contract-notes" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} />
        <Alert tone="info" title="Taslak satışa kapalıdır">
          Fiyatları girip &quot;Satışa aç&quot; deyince acente adına açılan rezervasyonlar bu kontratın fiyatını alır.
        </Alert>
      </form>
    </Modal>
  );
}

/**
 * Satıştaki kontratı sonlandırır (geri açılmaz).
 *
 * @param {{ contract: any, onClose: () => void, onDone: () => void }} props
 */
export function EndContractDialog({ contract, onClose, onDone }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const end = useMutation({
    mutationFn: (payload) => apiPost(`/agencies/contracts/${contract.id}/end`, payload),
    onSuccess: () => {
      toastSuccess('Kontrat sonlandırıldı');
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      onDone();
    },
    onError: (error) => handleError(error, setErrors),
  });

  function submit(event) {
    event.preventDefault();
    const payload = { expectedUpdatedAt: contract.updatedAt, reason };
    const checked = validateWith(endContractSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    end.mutate(payload);
  }

  const busy = end.isPending;
  return (
    <Modal
      open
      size="sm"
      title="Kontratı sonlandır"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="end-contract-form" variant="danger" icon="lock" disabled={busy}>{busy ? 'Sonlandırılıyor…' : 'Sonlandır'}</Button>
        </>
      }
    >
      <form id="end-contract-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Alert tone="warning" title="Geri açılamaz">
          &quot;{contract.name}&quot; artık yeni rezervasyon almaz. Açılmış rezervasyonlar fiyatını korur. Devam etmek için yeni bir kontrat açmanız gerekir.
        </Alert>
        <Textarea label="Sebep" name="end-contract-reason" rows={3} maxLength={MAX_CONTRACT_END_REASON_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} required />
      </form>
    </Modal>
  );
}

/**
 * Stop-sale ekler. Açılmış rezervasyonlar iptal edilmez; kaç tanesinin etkilenmediği bildirilir.
 *
 * @param {{ contract: any, onClose: () => void, onDone: () => void }} props
 */
export function StopSaleDialog({ contract, onClose, onDone }) {
  const queryClient = useQueryClient();
  const { roomTypes } = useRoomTypes();
  const [values, setValues] = useState({ roomTypeId: '', startDate: contract.startDate, endDate: contract.startDate, reason: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const add = useMutation({
    mutationFn: (payload) => apiPost(`/agencies/contracts/${contract.id}/stop-sales`, payload),
    onSuccess: (result) => {
      toastSuccess(
        result.existingReservations > 0
          ? `Stop-sale eklendi. Bu günlerde açılmış ${result.existingReservations} rezervasyon var; onlar etkilenmez.`
          : 'Stop-sale eklendi',
      );
      queryClient.invalidateQueries({ queryKey: agencyKeys.all });
      onDone();
    },
    onError: (error) => handleError(error, setErrors),
  });

  function submit(event) {
    event.preventDefault();
    const payload = { ...values, roomTypeId: values.roomTypeId || null };
    const checked = validateWith(addStopSaleSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (values.startDate < contract.startDate || values.endDate > contract.endDate) {
      setErrors({ startDate: 'Stop-sale kontrat dönemi içinde olmalı' });
      return;
    }
    setErrors({});
    add.mutate(payload);
  }

  const busy = add.isPending;
  const options = [{ value: '', label: 'Tüm oda tipleri' }, ...roomTypes.map((type) => ({ value: type.id, label: type.name }))];
  return (
    <Modal
      open
      size="md"
      title="Stop-sale ekle"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="stop-sale-form" icon="alertTriangle" disabled={busy}>{busy ? 'Ekleniyor…' : 'Stop-sale ekle'}</Button>
        </>
      }
    >
      <form id="stop-sale-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select label="Kapsam" name="stop-scope" value={values.roomTypeId} onChange={set('roomTypeId')} options={options} error={errors.roomTypeId} disabled={busy} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Başlangıç" name="stop-start" type="date" min={contract.startDate} max={contract.endDate} value={values.startDate} onChange={set('startDate')} error={errors.startDate} disabled={busy} required />
          <Input label="Bitiş (dahil)" name="stop-end" type="date" min={values.startDate || contract.startDate} max={contract.endDate} value={values.endDate} onChange={set('endDate')} error={errors.endDate} disabled={busy} required />
        </div>
        <Input label="Sebep" name="stop-reason" maxLength={MAX_STOP_SALE_REASON_LENGTH} value={values.reason} onChange={set('reason')} error={errors.reason} placeholder="İsteğe bağlı" disabled={busy} />
        <p className="text-xs text-ink-muted">
          Bu günlerde bu acente adına yeni rezervasyon açılamaz (elle fiyatla da). Açılmış rezervasyonlar iptal edilmez.
        </p>
      </form>
    </Modal>
  );
}
