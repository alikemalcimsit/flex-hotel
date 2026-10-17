import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EVENT_TYPES, EVENT_TYPE_LABELS, MAX_EVENT_PAX, createEventSchema, updateEventSchema } from '@hotelos/hotel-contracts';
import { Button, Card, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { apiPost, api } from '../../lib/api.js';
import { banquetKeys, eventPath } from '../../lib/banquet.js';
import { EMPTY_EVENT_FORM, eventFormOf, eventPayloadOf } from '../../lib/banquetForm.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';
import { ClientPicker } from './ClientPicker.jsx';

const TYPE_OPTIONS = EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_LABELS[value] }));

/**
 * Etkinlik dosyasının başlık alanları (yeni dosya ve düzenleme ortak).
 * @param {{ values: typeof EMPTY_EVENT_FORM, setValues: Function, errors: Record<string, string>, busy: boolean }} props
 */
function EventFields({ values, setValues, errors, busy }) {
  const can = useCan();
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input label="Etkinlik adı" name="event-name" value={values.name} onChange={set('name')} error={errors.name} placeholder="Ör. Yılmaz – Kaya düğünü" required className="sm:col-span-2" disabled={busy} />
      <div className="sm:col-span-2">
        <ClientPicker
          value={values.client}
          onChange={(client) => setValues((current) => ({ ...current, client }))}
          error={errors.clientId}
          disabled={busy}
          canCreate={can(PERMISSIONS.BANQUET_MANAGE)}
        />
      </div>
      <Select label="Tür" name="event-type" options={TYPE_OPTIONS} value={values.type} onChange={set('type')} error={errors.type} disabled={busy} />
      <Input label="Satış sorumlusu (e-posta)" name="event-owner" type="email" value={values.ownerEmail} onChange={set('ownerEmail')} error={errors.ownerEmail} placeholder="Boşsa siz" disabled={busy} />
      <Input label="Tahmini kişi" name="event-expected" type="number" min={1} max={MAX_EVENT_PAX} value={values.expectedPax} onChange={set('expectedPax')} error={errors.expectedPax} required disabled={busy} />
      <Input
        label="Garanti kişi"
        name="event-guaranteed"
        type="number"
        min={1}
        max={MAX_EVENT_PAX}
        value={values.guaranteedPax}
        onChange={set('guaranteedPax')}
        error={errors.guaranteedPax}
        placeholder="Müşteri bildirince"
        disabled={busy}
      />
      <p className="text-xs text-ink-muted sm:col-span-2">
        Kişi başı kalemler garanti kişiyle (yoksa tahmini) faturalanır; etkinlik gerçekleşince gerçekleşen kişi garantiyi aşarsa o sayı faturalanır.
      </p>
      <Textarea label="Not" name="event-notes" rows={3} value={values.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" disabled={busy} />
    </div>
  );
}

/** Yeni etkinlik dosyası (talep): açılınca dosyanın ekranına gidilir, program orada eklenir. */
export function NewEventPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(EMPTY_EVENT_FORM);
  const [errors, setErrors] = useState({});
  const create = useMutation({
    mutationFn: (body) => apiPost('/banquet/events', body),
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(`${event.code} açıldı: programa salon ve saat ekleyin`);
      navigate(eventPath(event.id, 'program'));
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = eventPayloadOf(values);
    const checked = validateWith(createEventSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(body);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/etkinlikler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
        <Icon name="arrowLeft" className="size-4" /> Etkinlikler
      </Link>
      <PageHeader title="Yeni etkinlik" description="Müşterinin talebini dosyaya alın. Salon ve saat (program), fiyat kalemleri, opsiyon ve belgeler dosyanın ekranında." />
      <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6">
        <Card title="Dosya">
          <EventFields values={values} setValues={setValues} errors={errors} busy={create.isPending} />
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/etkinlikler')} disabled={create.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" icon="check" disabled={create.isPending}>
            {create.isPending ? 'Açılıyor…' : 'Dosyayı aç'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Dosya başlığını düzenler (ad, tür, müşteri, sorumlu, kişi, not). Kişi değişince
 * kişi başı kalemler sunucuda yeniden fiyatlanır.
 * @param {{ event: any, onClose: () => void }} props
 */
export function EventHeaderDialog({ event, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => eventFormOf(event));
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => api(`/banquet/events/${event.id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.event(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess('Dosya güncellendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.event(event.id) });
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = eventPayloadOf(values, event.updatedAt);
    const checked = validateWith(updateEventSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title="Dosyayı düzenle"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-header-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="event-header-form" onSubmit={submit} noValidate>
        <EventFields values={values} setValues={setValues} errors={errors} busy={busy} />
      </form>
    </Modal>
  );
}
