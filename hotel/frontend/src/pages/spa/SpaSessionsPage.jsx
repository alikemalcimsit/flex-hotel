import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPA_SESSION_STATUS_LABELS, SPA_SESSION_STATUS_TONES, SPA_WEEKDAYS, SPA_WEEKDAY_SHORT, spaSessionCreateSchema, spaWeekday } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { SPA_RANGES, dottedDay, rangeOf, sessionPath, shiftDay, shortDayLabel, spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 50;
const WEEKDAY_OPTIONS = SPA_WEEKDAYS.map((weekday) => ({ value: String(weekday), label: SPA_WEEKDAY_SHORT[weekday] }));

/**
 * Grup dersleri (modül 57): seansların listesi (gün aralığı) ve yeni seans. Seans eğitmeni ve salonu takvimde tutar;
 * kontenjan dolunca kayıtlar yedek listeye yazılır. Satır seansın sayfasını (kayıtlar, yoklama, iptal) açar.
 */
export function SpaSessionsPage() {
  const can = useCan();
  const canSetup = can(PERMISSIONS.SPA_SETUP);
  const [range, setRange] = useState('week');
  const [serviceId, setServiceId] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => setPage(1), [range, serviceId]);

  const setup = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup') });
  const classes = useMemo(() => (setup.data?.services ?? []).filter((service) => service.kind === 'GROUP'), [setup.data]);
  const filters = { ...rangeOf(range), serviceId: serviceId || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: spaKeys.sessions(filters), queryFn: () => api(withQuery('/spa/sessions', filters)), placeholderData: keepPreviousData });
  const currency = list.data?.currency ?? '';

  const columns = [
    {
      key: 'when',
      header: 'Gün ve saat',
      className: 'whitespace-nowrap',
      render: (row) => (
        <Link to={sessionPath(row.id)} className="block hover:underline">
          <span className="block font-semibold tabular-nums text-ink">
            {row.time}–{row.endTime}
          </span>
          <span className="block text-xs text-ink-muted">{shortDayLabel(row.day)}</span>
        </Link>
      ),
    },
    {
      key: 'class',
      header: 'Ders',
      render: (row) => (
        <Link to={sessionPath(row.id)} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.serviceName}</span>
          <span className="block text-xs text-ink-muted">
            {row.instructor?.name ?? 'Eğitmensiz'}
            {row.room ? ` · ${row.room.name}` : ''}
          </span>
        </Link>
      ),
    },
    {
      key: 'seats',
      header: 'Kontenjan',
      render: (row) => (
        <>
          <span className="block tabular-nums">
            {row.bookedCount} / {row.capacity}
          </span>
          {row.status === 'SCHEDULED' && (row.waitlistCount > 0 ? <Badge tone="warning">{row.waitlistCount} yedekte</Badge> : row.free === 0 ? <Badge tone="info">Dolu</Badge> : <span className="text-xs text-ink-muted">{row.free} yer var</span>)}
        </>
      ),
    },
    { key: 'price', header: 'Kişi başı', className: 'text-right whitespace-nowrap', render: (row) => <span className="tabular-nums">{formatMoney(row.priceTotal, currency)}</span> },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={SPA_SESSION_STATUS_TONES[row.status]}>{SPA_SESSION_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {setup.data && classes.length === 0 && (
        <Alert tone="info" title="Grup dersi tanımlı değil">
          Yoga, pilates gibi kontenjanlı dersler için Tanımlar → Hizmetler'den türü "Grup dersi" olan bir hizmet açın; sonra burada seanslarını planlayın.
        </Alert>
      )}
      <Toolbar
        actions={
          canSetup && (
            <Button type="button" icon="plus" onClick={() => setFormOpen(true)} disabled={classes.filter((service) => service.isActive).length === 0}>
              Yeni seans
            </Button>
          )
        }
      >
        <Select label="Dönem" compact options={SPA_RANGES.map(({ value, label }) => ({ value, label }))} value={range} onChange={(event) => setRange(event.target.value)} className="w-48" />
        <Select label="Ders" compact options={[{ value: '', label: 'Bütün dersler' }, ...classes.map((service) => ({ value: service.id, label: service.name }))]} value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="w-52" />
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
        emptyTitle="Bu dönemde seans yok"
        emptyHint={canSetup ? '"Yeni seans" ile tek bir ders ya da her hafta tekrarlanan dersler açın.' : 'Ders programını spa yöneticisi açar.'}
      />
      {setup.data && <SessionFormDialog open={formOpen} onClose={() => setFormOpen(false)} setup={setup.data} classes={classes.filter((service) => service.isActive)} />}
    </div>
  );
}

/**
 * Yeni seans: ders, gün ve saat, eğitmen, salon; kontenjan ve fiyat boşsa dersin tanımından. "Her hafta tekrarla"
 * seçilen günlere bitiş gününe kadar ayrı seanslar açar; eğitmenin ya da salonun dolu olduğu gün atlanır ve sonuçta
 * sebebiyle listelenir.
 *
 * @param {{ open: boolean, onClose: () => void, setup: any, classes: any[] }} props
 */
function SessionFormDialog({ open, onClose, setup, classes }) {
  const queryClient = useQueryClient();
  const blank = () => ({ serviceId: classes[0]?.id ?? '', day: setup.today, time: '09:00', therapistId: '', roomId: '', capacity: '', price: '', note: '', repeat: false, weekdays: [], until: shiftDay(setup.today, 28) });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (open) {
      setForm(blank());
      setErrors({});
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const service = classes.find((item) => item.id === form.serviceId);
  const instructors = service ? setup.therapists.filter((therapist) => therapist.isActive && service.therapistIds.includes(therapist.id)) : [];
  const rooms = service ? setup.rooms.filter((room) => room.isActive && service.roomIds.includes(room.id)) : [];
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const create = useMutation({
    mutationFn: (body) => apiPost('/spa/sessions', body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      if (data.skipped.length) {
        setResult(data);
        toastSuccess(`${data.created.length} seans açıldı, ${data.skipped.length} gün atlandı`);
      } else {
        toastSuccess(data.created.length === 1 ? 'Seans açıldı' : `${data.created.length} seans açıldı`);
        onClose();
      }
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      serviceId: form.serviceId,
      startsAt: `${form.day}T${form.time}`,
      therapistId: form.therapistId || null,
      roomId: form.roomId || null,
      capacity: form.capacity === '' ? null : form.capacity,
      price: form.price === '' ? null : form.price,
      note: form.note,
      repeat: form.repeat ? { weekdays: form.weekdays.map(Number), until: form.until } : null,
    };
    const checked = validateWith(spaSessionCreateSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) create.mutate(body);
  }

  const busy = create.isPending;
  return (
    <Modal
      open={open}
      title="Yeni seans"
      onClose={busy ? () => {} : onClose}
      size="lg"
      footer={
        result ? (
          <Button type="button" onClick={onClose}>
            Kapat
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form="spa-session-form" icon="check" disabled={busy}>
              {busy ? 'Açılıyor…' : form.repeat ? 'Seansları aç' : 'Seansı aç'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{result.created.length} seans açıldı.</Alert>
          <Alert tone="warning" title={`${result.skipped.length} gün atlandı`}>
            <ul className="mt-1 list-disc pl-5">
              {result.skipped.map((row) => (
                <li key={row.day}>
                  {dottedDay(row.day)}: {row.message}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : (
        <form id="spa-session-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Select label="Ders" value={form.serviceId} onChange={(event) => set({ serviceId: event.target.value, therapistId: '', roomId: '' })} error={errors.serviceId} disabled={busy} options={classes.map((item) => ({ value: item.id, label: `${item.name} · ${item.durationMinutes} dk` }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Gün" type="date" min={setup.today} value={form.day} onChange={(event) => set({ day: event.target.value })} error={errors.startsAt} disabled={busy} />
            <Input label="Saat" type="time" step={300} value={form.time} onChange={(event) => set({ time: event.target.value })} disabled={busy} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {service?.therapistCount > 0 && (
              <Select label="Eğitmen" value={form.therapistId} onChange={(event) => set({ therapistId: event.target.value })} error={errors.therapistId ?? errors.therapistIds} disabled={busy} options={[{ value: '', label: 'Uygun olan atansın' }, ...instructors.map((item) => ({ value: item.id, label: item.name }))]} />
            )}
            {service?.requiresRoom && (
              <Select label="Salon" value={form.roomId} onChange={(event) => set({ roomId: event.target.value })} error={errors.roomId} disabled={busy} options={[{ value: '', label: 'Uygun olan atansın' }, ...rooms.map((item) => ({ value: item.id, label: item.name }))]} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Kontenjan" inputMode="numeric" value={form.capacity} onChange={(event) => set({ capacity: event.target.value })} error={errors.capacity} disabled={busy} placeholder={service ? `Dersin tanımı: ${service.capacity}` : ''} />
            <Input label={`Kişi başı fiyat (${setup.currency})`} inputMode="decimal" value={form.price} onChange={(event) => set({ price: event.target.value })} error={errors.price} disabled={busy} placeholder={service ? `Dersin tanımı: ${service.price}` : ''} />
          </div>
          <Textarea label="Not (isteğe bağlı)" rows={2} value={form.note} onChange={(event) => set({ note: event.target.value })} error={errors.note} disabled={busy} placeholder="Bahçede, mat getirin…" />
          <Checkbox label="Her hafta tekrarla" hint="Seçilen günlerde, bitiş gününe kadar ayrı seanslar açılır." checked={form.repeat} onChange={(event) => set({ repeat: event.target.checked, weekdays: event.target.checked && form.weekdays.length === 0 ? [String(spaWeekday(form.day))] : form.weekdays })} disabled={busy} />
          {form.repeat && (
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <MultiChips label="Günler" options={WEEKDAY_OPTIONS} values={form.weekdays} onChange={(weekdays) => set({ weekdays })} disabled={busy} error={errors['repeat.weekdays']} />
              <Input label="Bitiş günü" type="date" min={form.day} value={form.until} onChange={(event) => set({ until: event.target.value })} error={errors['repeat.until']} disabled={busy} />
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
