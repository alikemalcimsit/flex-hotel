import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SPA_CATEGORY_LABELS, spaAppointmentCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { CustomerField, GENDER_OPTIONS, SlotPicker, customerPayload, emptyCustomer } from './SpaShared.jsx';

/**
 * Yeni randevu (modül 57): misafir (otel misafiri ya da dışarıdan), hizmet, gün ve boş saatlerden biri. Terapist
 * seçilmezse uygun olan atanır (isteğe bağlı kadın / erkek tercihiyle); oda her zaman otomatik atanır (randevunun
 * sayfasından değiştirilebilir). Takvimden açıldıysa gün, saat ve terapist dolu gelir.
 *
 * @param {{
 *   open: boolean, onClose: () => void, setup: any,
 *   initial?: { day?: string, time?: string, therapistId?: string },
 *   onCreated?: (appointment: any) => void,
 * }} props
 */
export function AppointmentFormDialog({ open, onClose, setup, initial = {}, onCreated }) {
  const queryClient = useQueryClient();
  const services = useMemo(() => setup.services.filter((service) => service.kind === 'PRIVATE' && service.isActive), [setup.services]);
  const blank = () => ({ customer: emptyCustomer(), serviceId: '', day: initial.day ?? setup.today, time: initial.time ?? '', therapistId: initial.therapistId ?? '', gender: '', note: '' });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  // Aynı pencereden iki kez gönderilen istek tek randevu açar.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) {
      setForm(blank());
      setErrors({});
      setRequestId(crypto.randomUUID());
    }
    // Pencere her açılışta takvimden gelen değerlerle sıfırlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const service = services.find((item) => item.id === form.serviceId);
  const therapists = useMemo(
    () => (service ? setup.therapists.filter((therapist) => therapist.isActive && service.therapistIds.includes(therapist.id)) : []),
    [service, setup.therapists],
  );
  const pickTherapist = service?.therapistCount === 1;
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const create = useMutation({
    mutationFn: (body) => apiPost('/spa/appointments', body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      toastSuccess(`Randevu açıldı: ${data.appointment.code} · ${data.appointment.time}`);
      onCreated?.(data.appointment);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      // Saat bu arada dolduysa boş saatler yenilenir, seçim kalkar.
      if (error.code === 'SPA_SLOT_TAKEN') {
        queryClient.invalidateQueries({ queryKey: ['spa', 'availability'] });
        set({ time: '' });
      }
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      requestId,
      serviceId: form.serviceId,
      startsAt: form.time ? `${form.day}T${form.time}` : '',
      ...customerPayload(form.customer),
      therapistIds: pickTherapist && form.therapistId ? [form.therapistId] : null,
      therapistPreference: form.therapistId ? null : form.gender || null,
      note: form.note,
    };
    // Bütün alanlar birlikte denetlenir (misafir, hizmet, saat); saat hatası yalnız hizmet seçiliyken (seçici o zaman görünür).
    const checked = validateWith(spaAppointmentCreateSchema, body);
    const found = checked.ok ? {} : { ...checked.errors };
    if (form.serviceId && !form.time) found.startsAt = 'Boş saatlerden birini seçin';
    // Misafir kuralı şemada nesne düzeyinde: diğer alanlar hatalıyken zod onu çalıştırmaz, burada da söylenir.
    if (!body.reservationId && (body.customerName?.length ?? 0) < 2 && !found.customerName) found.customerName = 'Misafiri seçin ya da dışarıdan gelenin adını yazın';
    if (!form.serviceId) delete found.startsAt;
    setErrors(found);
    if (Object.keys(found).length === 0) create.mutate(body);
  }

  const busy = create.isPending;
  return (
    <Modal
      open={open}
      title="Yeni randevu"
      onClose={busy ? () => {} : onClose}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-appointment-form" icon="check" disabled={busy || !services.length}>
            {busy ? 'Açılıyor…' : 'Randevuyu aç'}
          </Button>
        </>
      }
    >
      {services.length === 0 ? (
        <Alert tone="warning">Kullanımda birebir hizmet yok. Önce Tanımlar → Hizmetler'den hizmet, terapist ve oda tanımlayın.</Alert>
      ) : (
        <form id="spa-appointment-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <CustomerField value={form.customer} onChange={(customer) => set({ customer })} errors={errors} disabled={busy} />
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <Select
              label="Hizmet"
              value={form.serviceId}
              onChange={(event) => set({ serviceId: event.target.value, time: '', therapistId: '' })}
              error={errors.serviceId}
              disabled={busy}
              options={[{ value: '', label: 'Hizmet seçin' }, ...services.map((item) => ({ value: item.id, label: `${item.name} · ${item.durationMinutes} dk`, disabled: item.staffingIssue }))]}
            />
            <Input label="Gün" type="date" min={setup.today} value={form.day} onChange={(event) => set({ day: event.target.value, time: '' })} disabled={busy} />
          </div>
          {service && (
            <p className="text-sm text-ink-soft">
              {SPA_CATEGORY_LABELS[service.category]} · {service.durationMinutes} dk{service.bufferMinutes ? ` + ${service.bufferMinutes} dk ara` : ''} ·{' '}
              <strong className="text-ink">{formatMoney(service.bookingTotal, setup.currency)}</strong>
              {service.guestCount > 1 ? ` (${service.guestCount} kişi)` : ''}
              {service.therapistCount > 1 ? ` · ${service.therapistCount} terapist` : ''}
            </p>
          )}
          {service && pickTherapist && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Terapist"
                value={form.therapistId}
                onChange={(event) => set({ therapistId: event.target.value, time: '' })}
                error={errors.therapistIds}
                disabled={busy}
                options={[{ value: '', label: 'Uygun olan atansın' }, ...therapists.map((therapist) => ({ value: therapist.id, label: therapist.name }))]}
              />
              {!form.therapistId && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Misafirin tercihi</span>
                  <ChoiceChips label="Terapist tercihi" options={GENDER_OPTIONS} value={form.gender} onChange={(gender) => set({ gender, time: '' })} disabled={busy} />
                </div>
              )}
            </div>
          )}
          <SlotPicker serviceId={form.serviceId} day={form.day} therapistId={pickTherapist ? form.therapistId : ''} gender={form.therapistId ? '' : form.gender} value={form.time} onChange={(time) => set({ time })} error={errors.startsAt} />
          <Textarea label="Not (isteğe bağlı)" rows={2} value={form.note} onChange={(event) => set({ note: event.target.value })} error={errors.note} disabled={busy} placeholder="Alerji, hassas bölge, özel istek…" />
        </form>
      )}
    </Modal>
  );
}
