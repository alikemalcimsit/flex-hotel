import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createLeadSchema, LEAD_SOURCES, LEAD_SOURCE_LABELS, updateLeadSchema } from '@hotelos/hotel-contracts';
import { Button, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const SOURCE_OPTIONS = LEAD_SOURCES.map((value) => ({ value, label: LEAD_SOURCE_LABELS[value] }));

const EMPTY = {
  name: '',
  company: '',
  phone: '',
  email: '',
  source: 'PHONE',
  checkIn: '',
  checkOut: '',
  roomTypeId: '',
  adults: '',
  children: '',
  notes: '',
  followUpAt: '',
};

/** Fırsat DTO'su → form değerleri. */
function formOf(lead) {
  if (!lead) return EMPTY;
  return {
    name: lead.name,
    company: lead.company ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    source: lead.source,
    checkIn: lead.checkIn ?? '',
    checkOut: lead.checkOut ?? '',
    roomTypeId: lead.roomTypeId ?? '',
    adults: lead.adults === null ? '' : String(lead.adults),
    children: lead.children === null ? '' : String(lead.children),
    notes: lead.notes ?? '',
    followUpAt: lead.followUpAt ?? '',
  };
}

/** Form değerleri → sözleşme gövdesi (boş metinler null/undefined'a iner). */
function payloadOf(form) {
  return {
    name: form.name,
    company: form.company,
    phone: form.phone,
    email: form.email,
    source: form.source,
    guestId: null,
    checkIn: form.checkIn || null,
    checkOut: form.checkOut || null,
    roomTypeId: form.roomTypeId || null,
    adults: form.adults === '' ? null : form.adults,
    children: form.children === '' ? null : form.children,
    notes: form.notes,
    followUpAt: form.followUpAt || null,
  };
}

/**
 * Fırsat aç / düzenle modalı (modül 36). Aynı form iki modda: `lead` verilirse
 * düzenleme (optimistic-lock sürümüyle), verilmezse yeni kayıt.
 *
 * @param {{ lead?: object | null, onSaved: (lead: object) => void, onClose: () => void }} props
 */
export function LeadFormModal({ lead = null, onSaved, onClose }) {
  const [form, setForm] = useState(() => formOf(lead));
  const [errors, setErrors] = useState({});

  const roomTypes = useQuery({ queryKey: ['settings', 'room-types', 'all'], queryFn: () => api('/settings/room-types?pageSize=200') });

  const mutation = useMutation({
    mutationFn: (values) => (lead ? apiPut(`/sales/leads/${lead.id}`, values) : apiPost('/sales/leads', values)),
    onSuccess: (saved) => {
      toastSuccess(lead ? 'Fırsat güncellendi' : 'Fırsat açıldı');
      onSaved(saved);
    },
    onError: (error) => toastError(error.message),
  });

  const setField = (name) => (event) => {
    const value = event?.target ? event.target.value : event;
    setForm((current) => ({ ...current, [name]: value }));
  };

  function save() {
    const schema = lead ? updateLeadSchema : createLeadSchema;
    const body = lead ? { ...payloadOf(form), expectedUpdatedAt: lead.updatedAt } : payloadOf(form);
    const result = validateWith(schema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      title={lead ? 'Fırsatı düzenle' : 'Yeni fırsat'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="check" disabled={mutation.isPending} onClick={save}>
            {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Ad soyad / başlık" name="name" value={form.name} error={errors.name} onChange={setField('name')} />
          <Input label="Firma (isteğe bağlı)" name="company" value={form.company} error={errors.company} onChange={setField('company')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Telefon" name="phone" value={form.phone} error={errors.phone} onChange={setField('phone')} />
          <Input label="E-posta" name="email" value={form.email} error={errors.email} onChange={setField('email')} />
          <Select label="Kaynak" name="source" value={form.source} error={errors.source} onChange={setField('source')} options={SOURCE_OPTIONS} />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">İstenen konaklama (teklifi önceden doldurur)</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Giriş" name="checkIn" type="date" value={form.checkIn} error={errors.checkIn} onChange={setField('checkIn')} />
          <Input label="Çıkış" name="checkOut" type="date" value={form.checkOut} error={errors.checkOut} onChange={setField('checkOut')} />
          <Select
            label="Oda tipi"
            name="roomTypeId"
            value={form.roomTypeId}
            error={errors.roomTypeId}
            onChange={setField('roomTypeId')}
            options={[{ value: '', label: 'Seçilmedi' }, ...(roomTypes.data?.items ?? []).map((type) => ({ value: type.id, label: type.name }))]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Yetişkin" name="adults" type="number" min="1" value={form.adults} error={errors.adults} onChange={setField('adults')} />
          <Input label="Çocuk" name="children" type="number" min="0" value={form.children} error={errors.children} onChange={setField('children')} />
          <Input
            label="Takip tarihi"
            name="followUpAt"
            type="date"
            value={form.followUpAt}
            error={errors.followUpAt}
            onChange={setField('followUpAt')}
          />
        </div>
        <Textarea label="Not" name="notes" rows={3} value={form.notes} error={errors.notes} onChange={setField('notes')} />
      </div>
    </Modal>
  );
}
