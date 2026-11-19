import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SPA_CATEGORIES,
  SPA_CATEGORY_LABELS,
  SPA_GENDERS,
  SPA_GENDER_LABELS,
  SPA_MAX_DAILY_SLICES,
  SPA_ROOM_KINDS,
  SPA_ROOM_KIND_LABELS,
  SPA_SERVICE_KINDS,
  SPA_SERVICE_KIND_LABELS,
  SPA_TRANSLATION_LANGUAGES,
  SPA_WEEKDAYS,
  SPA_WEEKDAY_LABELS,
  SPA_WEEKDAY_SHORT,
  spaBlockInputSchema,
  spaRoomInputSchema,
  spaServiceInputSchema,
  spaTherapistInputSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { dayFromToday, spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const SECTIONS = Object.freeze([
  { value: 'hizmetler', label: 'Hizmetler' },
  { value: 'ekip', label: 'Ekip' },
  { value: 'odalar', label: 'Odalar' },
  { value: 'bloklar', label: 'İzin ve bakım' },
]);
const LANGUAGE_LABELS = Object.freeze({ en: 'İngilizce', de: 'Almanca', ru: 'Rusça' });
const options = (values, labels) => values.map((value) => ({ value, label: labels[value] }));
const BLOCK_PAGE_SIZE = 50;

/**
 * Spa tanımları (modül 57): hizmetler (süre, temizlik arası, fiyat, gereken terapist, uygun terapist ve odalar, dört
 * dilde ad), ekip (cinsiyet, haftalık çalışma saatleri, verebildiği hizmetler), odalar ve izin / bakım blokları. Herkes
 * görür; değiştirmek `spa.setup` ister. İleri tarihli işi olan kayıt silinmez (kullanımdan kaldırılır).
 */
export function SpaSetupPage() {
  const canSetup = useCan()(PERMISSIONS.SPA_SETUP);
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((item) => item.value === params.get('bolum')) ? params.get('bolum') : 'hizmetler';
  const query = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup') });

  return (
    <div className="flex flex-col gap-4">
      <ChoiceChips label="Tanım bölümü" options={SECTIONS} value={section} onChange={(value) => setParams(value === 'hizmetler' ? {} : { bolum: value })} required />
      {query.isPending && <Spinner className="py-10" label="Tanımlar yükleniyor…" />}
      {query.isError && (
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      )}
      {query.data && section === 'hizmetler' && <ServicesSection setup={query.data} canSetup={canSetup} />}
      {query.data && section === 'ekip' && <TherapistsSection setup={query.data} canSetup={canSetup} />}
      {query.data && section === 'odalar' && <RoomsSection setup={query.data} canSetup={canSetup} />}
      {query.data && section === 'bloklar' && <BlocksSection setup={query.data} canSetup={canSetup} />}
    </div>
  );
}

/**
 * Kaydet / sil mutasyonlarının ortak kalıbı: tanımlar yenilenir; sürüm bayatsa pencere kapanır ve liste tazelenir.
 * @param {{ onDone: () => void, setErrors?: (errors: Record<string, string>) => void }} options
 */
function useSetupMutation(request, message, { onDone, setErrors }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      toastSuccess(message);
      onDone();
    },
    onError: (error) => {
      if (error.fields) setErrors?.(error.fields);
      toastError(error.message);
      if (error.code === 'STALE_WRITE') {
        queryClient.invalidateQueries({ queryKey: spaKeys.setup });
        onDone();
      }
    },
  });
}

/** Silme onayı (iyimser kilit sorgu parametresinde). */
function DeleteDialog({ target, path, label, onClose }) {
  const [error, setError] = useState(null);
  useEffect(() => setError(null), [target?.id]);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => apiDelete(withQuery(`${path}/${target.id}`, { expectedUpdatedAt: target.updatedAt })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      toastSuccess(`${label} silindi`);
      onClose();
    },
    onError: setError,
  });
  return (
    <ConfirmDialog
      open={Boolean(target)}
      title={`${label} silinsin mi?`}
      message={target ? `"${target.name}" silinecek. Geçmiş randevular etkilenmez. İleri tarihli işi varsa silinmez; onun yerine kullanımdan kaldırabilirsiniz.` : ''}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
      isPending={remove.isPending}
      error={error}
    />
  );
}

function SectionHeader({ title, description, canSetup, onAdd, addLabel }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-bold text-ink">{title}</h3>
        <p className="text-sm text-ink-soft">{description}</p>
      </div>
      {canSetup && (
        <Button type="button" icon="plus" onClick={onAdd}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}

const rowActions = (canSetup, onEdit, onDelete) =>
  canSetup
    ? (row) => (
        <span className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" icon="pencil" aria-label={`${row.name}: düzenle`} onClick={() => onEdit(row)} />
          <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={`${row.name}: sil`} onClick={() => onDelete(row)} />
        </span>
      )
    : undefined;

/* ══════════════════ Hizmetler ══════════════════ */

function ServicesSection({ setup, canSetup }) {
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const names = (ids, rows) => rows.filter((row) => ids.includes(row.id)).map((row) => row.name);
  const columns = [
    {
      key: 'name',
      header: 'Hizmet',
      render: (row) => (
        <>
          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
            {row.name}
            {!row.isActive && <Badge tone="neutral">Kullanımda değil</Badge>}
            {row.staffingIssue && row.isActive && <Badge tone="danger">Kadro eksik</Badge>}
          </span>
          <span className="block text-xs text-ink-muted">
            {SPA_CATEGORY_LABELS[row.category]} · {SPA_SERVICE_KIND_LABELS[row.kind]}
            {row.kind === 'GROUP' ? ` · kontenjan ${row.capacity}` : ''}
            {row.missingTranslations.length ? ` · çevirisi eksik: ${row.missingTranslations.join(', ').toUpperCase()}` : ''}
          </span>
        </>
      ),
    },
    { key: 'time', header: 'Süre', className: 'whitespace-nowrap', render: (row) => `${row.durationMinutes} dk${row.bufferMinutes ? ` + ${row.bufferMinutes} ara` : ''}` },
    {
      key: 'price',
      header: 'Fiyat',
      className: 'text-right whitespace-nowrap',
      render: (row) => (
        <>
          <span className="block tabular-nums">{formatMoney(row.bookingTotal, setup.currency)}</span>
          {row.guestCount > 1 && <span className="block text-xs text-ink-muted">{row.guestCount} kişi</span>}
          {row.kind === 'GROUP' && <span className="block text-xs text-ink-muted">kişi başı</span>}
        </>
      ),
    },
    {
      key: 'staff',
      header: 'Terapist ve oda',
      render: (row) => (
        <span className="block max-w-xs text-xs text-ink-soft">
          {row.therapistCount > 1 ? `${row.therapistCount} terapist birlikte · ` : ''}
          {names(row.therapistIds, setup.therapists).join(', ') || (row.therapistCount ? 'terapist seçilmedi' : 'terapistsiz')}
          <span className="block text-ink-muted">{row.requiresRoom ? names(row.roomIds, setup.rooms).join(', ') || 'oda seçilmedi' : 'oda gerekmez'}</span>
        </span>
      ),
    },
    { key: 'portal', header: 'Portal', render: (row) => (row.portalBookable ? <Badge tone="sky">Açık</Badge> : <span className="text-xs text-ink-muted">Kapalı</span>) },
  ];
  return (
    <>
      <SectionHeader title="Hizmetler" description="Birebir randevular ve grup dersleri. Süre ve fiyat değişince mevcut randevular değişmez." canSetup={canSetup} onAdd={() => setEditing({})} addLabel="Yeni hizmet" />
      <DataTable columns={columns} rows={setup.services} emptyTitle="Hizmet tanımlı değil" emptyHint="Önce Ekip ve Odalar bölümlerinden terapistleri ve odaları, sonra hizmetleri tanımlayın." rowActions={rowActions(canSetup, setEditing, setDeleting)} />
      <ServiceDialog target={editing} setup={setup} onClose={() => setEditing(null)} />
      <DeleteDialog target={deleting} path="/spa/services" label="Hizmet" onClose={() => setDeleting(null)} />
    </>
  );
}

function ServiceDialog({ target, setup, onClose }) {
  const isNew = target && !target.id;
  const toForm = (row) => ({
    name: row.name ?? '',
    description: row.description ?? '',
    translations: Object.fromEntries(SPA_TRANSLATION_LANGUAGES.map((language) => [language, { name: row.translations?.[language]?.name ?? '', description: row.translations?.[language]?.description ?? '' }])),
    category: row.category ?? 'MASSAGE',
    kind: row.kind ?? 'PRIVATE',
    durationMinutes: String(row.durationMinutes ?? 60),
    bufferMinutes: String(row.bufferMinutes ?? 15),
    price: row.price ?? '',
    therapistCount: String(row.therapistCount ?? 1),
    guestCount: String(row.guestCount ?? 1),
    capacity: row.capacity ? String(row.capacity) : '',
    requiresRoom: row.requiresRoom ?? true,
    portalBookable: row.portalBookable ?? true,
    isActive: row.isActive ?? true,
    sortOrder: String(row.sortOrder ?? 0),
    therapistIds: row.therapistIds ?? [],
    roomIds: row.roomIds ?? [],
  });
  const [form, setForm] = useState(() => toForm({}));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (target) {
      setForm(toForm(target));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const save = useSetupMutation((body) => (isNew ? apiPost('/spa/services', body) : apiPut(`/spa/services/${target.id}`, { ...body, expectedUpdatedAt: target.updatedAt })), 'Hizmet kaydedildi', { onDone: onClose, setErrors });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const group = form.kind === 'GROUP';
  function submit(event) {
    event.preventDefault();
    const body = { ...form, capacity: group ? form.capacity : null, guestCount: group ? 1 : form.guestCount, therapistCount: group ? Math.min(Number(form.therapistCount), 1) : form.therapistCount, roomIds: form.requiresRoom ? form.roomIds : [] };
    const checked = validateWith(spaServiceInputSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(body);
  }
  const busy = save.isPending;
  const active = (rows) => rows.filter((row) => row.isActive || form.therapistIds.includes(row.id) || form.roomIds.includes(row.id));
  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'Yeni hizmet' : 'Hizmeti düzenle'}
      onClose={busy ? () => {} : onClose}
      size="xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-service-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="spa-service-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Input label="Hizmet adı" value={form.name} onChange={set('name')} error={errors.name} disabled={busy} />
          <Select label="Kategori" value={form.category} onChange={set('category')} error={errors.category} disabled={busy} options={options(SPA_CATEGORIES, SPA_CATEGORY_LABELS)} />
          <Select label="Tür" value={form.kind} onChange={set('kind')} error={errors.kind} disabled={busy} options={options(SPA_SERVICE_KINDS, SPA_SERVICE_KIND_LABELS)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Input label="Süre (dk)" inputMode="numeric" value={form.durationMinutes} onChange={set('durationMinutes')} error={errors.durationMinutes} disabled={busy} />
          <Input label="Temizlik arası (dk)" inputMode="numeric" value={form.bufferMinutes} onChange={set('bufferMinutes')} error={errors.bufferMinutes} disabled={busy} />
          <Input label={`Kişi başı fiyat (${setup.currency})`} inputMode="decimal" value={form.price} onChange={set('price')} error={errors.price} disabled={busy} />
          {group ? (
            <Input label="Kontenjan" inputMode="numeric" value={form.capacity} onChange={set('capacity')} error={errors.capacity} disabled={busy} />
          ) : (
            <Select label="Randevu başına misafir" value={form.guestCount} onChange={set('guestCount')} error={errors.guestCount} disabled={busy} options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: count === 2 ? '2 kişi (çift)' : `${count} kişi` }))} />
          )}
        </div>
        <p className="-mt-2 text-xs text-ink-muted">Fiyat otelin vergi ayarına göre girilir (spa kalemi); misafirin ödeyeceği toplam listede görünür. Temizlik arası, bitişten sonra terapisti ve odayı dolu tutar.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={group ? 'Eğitmen' : 'Gereken terapist'}
            value={form.therapistCount}
            onChange={set('therapistCount')}
            error={errors.therapistCount}
            disabled={busy}
            options={(group ? [0, 1] : [0, 1, 2, 3, 4]).map((count) => ({ value: String(count), label: count === 0 ? 'Gerekmez' : group ? 'Bir eğitmen' : `${count} terapist${count > 1 ? ' birlikte' : ''}` }))}
          />
          <Input label="Sıra" inputMode="numeric" value={form.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        </div>
        {Number(form.therapistCount) > 0 && (
          <MultiChips label={group ? 'Dersi verebilen eğitmenler' : 'Hizmeti verebilen terapistler'} options={active(setup.therapists).map((row) => ({ value: row.id, label: row.name }))} values={form.therapistIds} onChange={(therapistIds) => setForm((current) => ({ ...current, therapistIds }))} disabled={busy} error={errors.therapistIds} />
        )}
        <Checkbox label={group ? 'Salon tutar' : 'Oda tutar'} hint="İşaretli değilse hizmet yalnız terapisti tutar (ör. spor salonunda PT)." checked={form.requiresRoom} onChange={set('requiresRoom')} disabled={busy} />
        {form.requiresRoom && <MultiChips label="Verilebildiği odalar" options={active(setup.rooms).map((row) => ({ value: row.id, label: row.name }))} values={form.roomIds} onChange={(roomIds) => setForm((current) => ({ ...current, roomIds }))} disabled={busy} error={errors.roomIds} />}
        <Textarea label="Açıklama (misafire gösterilir)" rows={2} value={form.description} onChange={set('description')} error={errors.description} disabled={busy} />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPA_TRANSLATION_LANGUAGES.map((language) => (
            <Input
              key={language}
              label={`${LANGUAGE_LABELS[language]} adı`}
              value={form.translations[language].name}
              onChange={(event) => setForm((current) => ({ ...current, translations: { ...current.translations, [language]: { ...current.translations[language], name: event.target.value } } }))}
              error={errors[`translations.${language}.name`]}
              disabled={busy}
              placeholder="Boşsa Türkçesi gösterilir"
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Portaldan alınabilir" checked={form.portalBookable} onChange={set('portalBookable')} disabled={busy} />
          <Checkbox label="Kullanımda" hint="Kapalıysa yeni randevu verilmez." checked={form.isActive} onChange={set('isActive')} disabled={busy} />
        </div>
      </form>
    </Modal>
  );
}

/* ══════════════════ Ekip ══════════════════ */

const hoursText = (hours) => {
  if (!hours.length) return 'Çalışma saati girilmedi';
  return SPA_WEEKDAYS.filter((weekday) => hours.some((row) => row.weekday === weekday))
    .map((weekday) => `${SPA_WEEKDAY_SHORT[weekday]} ${hours.filter((row) => row.weekday === weekday).map((row) => `${row.start}–${row.end}`).join(', ')}`)
    .join(' · ');
};

function TherapistsSection({ setup, canSetup }) {
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const columns = [
    {
      key: 'name',
      header: 'Ad',
      render: (row) => (
        <>
          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
            {row.name}
            {!row.isActive && <Badge tone="neutral">Kullanımda değil</Badge>}
          </span>
          <span className="block text-xs text-ink-muted">
            {[row.title, row.gender ? SPA_GENDER_LABELS[row.gender] : null, row.phone].filter(Boolean).join(' · ') || '—'}
          </span>
        </>
      ),
    },
    { key: 'hours', header: 'Çalışma saatleri', render: (row) => <span className={`block max-w-md text-xs ${row.hours.length ? 'text-ink-soft' : 'font-semibold text-warning-ink'}`}>{hoursText(row.hours)}</span> },
    { key: 'services', header: 'Hizmetler', render: (row) => <span className="block max-w-xs text-xs text-ink-soft">{setup.services.filter((service) => row.serviceIds.includes(service.id)).map((service) => service.name).join(', ') || 'Hizmet atanmadı'}</span> },
  ];
  return (
    <>
      <SectionHeader title="Ekip" description="Terapistler, antrenörler ve eğitmenler. Çalışma saati olmayan kişiye randevu verilmez." canSetup={canSetup} onAdd={() => setEditing({})} addLabel="Yeni kişi" />
      <DataTable columns={columns} rows={setup.therapists} emptyTitle="Ekipte kimse yok" emptyHint="Terapistleri haftalık çalışma saatleriyle ekleyin." rowActions={rowActions(canSetup, setEditing, setDeleting)} />
      <TherapistDialog target={editing} setup={setup} onClose={() => setEditing(null)} />
      <DeleteDialog target={deleting} path="/spa/therapists" label="Terapist" onClose={() => setDeleting(null)} />
    </>
  );
}

/** Yeni kişinin varsayılan saatleri: açılıştan kapanışa değil, yaygın tek vardiya. */
const DEFAULT_HOURS = SPA_WEEKDAYS.slice(0, 6).map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));

function TherapistDialog({ target, setup, onClose }) {
  const isNew = target && !target.id;
  const toForm = (row) => ({
    name: row.name ?? '',
    title: row.title ?? '',
    gender: row.gender ?? '',
    phone: row.phone ?? '',
    isActive: row.isActive ?? true,
    sortOrder: String(row.sortOrder ?? 0),
    hours: (row.hours ?? DEFAULT_HOURS).map((hour, index) => ({ ...hour, key: `${index}-${hour.weekday}-${hour.start}` })),
    serviceIds: row.serviceIds ?? [],
  });
  const [form, setForm] = useState(() => toForm({}));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (target) {
      setForm(toForm(target));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const save = useSetupMutation((body) => (isNew ? apiPost('/spa/therapists', body) : apiPut(`/spa/therapists/${target.id}`, { ...body, expectedUpdatedAt: target.updatedAt })), 'Kişi kaydedildi', { onDone: onClose, setErrors });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const setHour = (key, field) => (event) => setForm((current) => ({ ...current, hours: current.hours.map((hour) => (hour.key === key ? { ...hour, [field]: event.target.value } : hour)) }));
  const addSlice = (weekday) => setForm((current) => ({ ...current, hours: [...current.hours, { weekday, start: '09:00', end: '18:00', key: `new-${Date.now()}-${weekday}` }] }));
  const removeSlice = (key) => setForm((current) => ({ ...current, hours: current.hours.filter((hour) => hour.key !== key) }));
  function submit(event) {
    event.preventDefault();
    const body = { ...form, gender: form.gender || null, hours: form.hours.map(({ weekday, start, end }) => ({ weekday, start, end })) };
    const checked = validateWith(spaTherapistInputSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(body);
  }
  const busy = save.isPending;
  const hourError = Object.entries(errors).find(([key]) => key.startsWith('hours'))?.[1];
  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'Yeni kişi' : 'Kişiyi düzenle'}
      onClose={busy ? () => {} : onClose}
      size="xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-therapist-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="spa-therapist-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Ad soyad" value={form.name} onChange={set('name')} error={errors.name} disabled={busy} />
          <Input label="Unvan (isteğe bağlı)" value={form.title} onChange={set('title')} error={errors.title} disabled={busy} placeholder="Masör, PT, yoga eğitmeni…" />
          <Select label="Cinsiyet" value={form.gender} onChange={set('gender')} error={errors.gender} disabled={busy} options={[{ value: '', label: 'Belirtilmedi' }, ...options(SPA_GENDERS, SPA_GENDER_LABELS)]} />
          <Input label="Telefon (isteğe bağlı)" inputMode="tel" value={form.phone} onChange={set('phone')} error={errors.phone} disabled={busy} />
        </div>
        <p className="-mt-2 text-xs text-ink-muted">Cinsiyet, misafirin "kadın / erkek terapist" tercihiyle eşleşir; belirtilmeyen kişi tercihli randevuya atanmaz.</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Haftalık çalışma saatleri</legend>
          {SPA_WEEKDAYS.map((weekday) => {
            const slices = form.hours.filter((hour) => hour.weekday === weekday);
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-b-0">
                <span className="w-24 text-sm font-semibold text-ink">{SPA_WEEKDAY_LABELS[weekday]}</span>
                {slices.length === 0 && <span className="text-sm text-ink-muted">Çalışmıyor</span>}
                {slices.map((slice) => (
                  <span key={slice.key} className="flex items-center gap-1">
                    <Input type="time" step={300} aria-label={`${SPA_WEEKDAY_LABELS[weekday]} başlangıç`} value={slice.start} onChange={setHour(slice.key, 'start')} disabled={busy} className="w-28" />
                    <span className="text-ink-muted">–</span>
                    <Input type="time" step={300} aria-label={`${SPA_WEEKDAY_LABELS[weekday]} bitiş`} value={slice.end} onChange={setHour(slice.key, 'end')} disabled={busy} className="w-28" />
                    <Button type="button" size="sm" variant="ghost" icon="close" aria-label={`${SPA_WEEKDAY_LABELS[weekday]} dilimini kaldır`} onClick={() => removeSlice(slice.key)} disabled={busy} />
                  </span>
                ))}
                {slices.length < SPA_MAX_DAILY_SLICES && (
                  <Button type="button" size="sm" variant="ghost" icon="plus" onClick={() => addSlice(weekday)} disabled={busy}>
                    {slices.length ? 'Dilim' : 'Saat ekle'}
                  </Button>
                )}
              </div>
            );
          })}
          {hourError && <p className="text-xs font-semibold text-sec-strong">{hourError}</p>}
        </fieldset>
        <MultiChips label="Verebildiği hizmetler" options={setup.services.map((service) => ({ value: service.id, label: service.name }))} values={form.serviceIds} onChange={(serviceIds) => setForm((current) => ({ ...current, serviceIds }))} disabled={busy} error={errors.serviceIds} />
        <div className="flex flex-wrap items-end gap-6">
          <Input label="Sıra" inputMode="numeric" value={form.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} className="w-28" />
          <Checkbox label="Kullanımda" hint="Kapalıysa yeni randevu verilmez; mevcut randevuları kalır." checked={form.isActive} onChange={set('isActive')} disabled={busy} />
        </div>
      </form>
    </Modal>
  );
}

/* ══════════════════ Odalar ══════════════════ */

function RoomsSection({ setup, canSetup }) {
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const columns = [
    {
      key: 'name',
      header: 'Oda',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
          {row.name}
          {!row.isActive && <Badge tone="neutral">Kullanımda değil</Badge>}
        </span>
      ),
    },
    { key: 'kind', header: 'Tür', render: (row) => SPA_ROOM_KIND_LABELS[row.kind] ?? row.kind },
    { key: 'services', header: 'Verilen hizmetler', render: (row) => <span className="block max-w-md text-xs text-ink-soft">{setup.services.filter((service) => service.roomIds.includes(row.id)).map((service) => service.name).join(', ') || 'Hizmet atanmadı'}</span> },
  ];
  return (
    <>
      <SectionHeader title="Odalar" description="Bakım odaları, hamam, stüdyo ve salonlar. Bir oda aynı saatte tek randevuya ya da derse verilir." canSetup={canSetup} onAdd={() => setEditing({})} addLabel="Yeni oda" />
      <DataTable columns={columns} rows={setup.rooms} emptyTitle="Oda tanımlı değil" emptyHint="Bakım odalarını ve ders salonlarını ekleyin; hizmetlere Hizmetler bölümünden bağlanır." rowActions={rowActions(canSetup, setEditing, setDeleting)} />
      <RoomDialog target={editing} onClose={() => setEditing(null)} />
      <DeleteDialog target={deleting} path="/spa/rooms" label="Oda" onClose={() => setDeleting(null)} />
    </>
  );
}

function RoomDialog({ target, onClose }) {
  const isNew = target && !target.id;
  const toForm = (row) => ({ name: row.name ?? '', kind: row.kind ?? 'TREATMENT', isActive: row.isActive ?? true, sortOrder: String(row.sortOrder ?? 0) });
  const [form, setForm] = useState(() => toForm({}));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (target) {
      setForm(toForm(target));
      setErrors({});
    }
  }, [target]);
  const save = useSetupMutation((body) => (isNew ? apiPost('/spa/rooms', body) : apiPut(`/spa/rooms/${target.id}`, { ...body, expectedUpdatedAt: target.updatedAt })), 'Oda kaydedildi', { onDone: onClose, setErrors });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(spaRoomInputSchema, form);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(form);
  }
  const busy = save.isPending;
  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'Yeni oda' : 'Odayı düzenle'}
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-room-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="spa-room-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Input label="Oda adı" value={form.name} onChange={set('name')} error={errors.name} disabled={busy} />
        <Select label="Tür" value={form.kind} onChange={set('kind')} error={errors.kind} disabled={busy} options={options(SPA_ROOM_KINDS, SPA_ROOM_KIND_LABELS)} />
        <Input label="Sıra" inputMode="numeric" value={form.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Kullanımda" checked={form.isActive} onChange={set('isActive')} disabled={busy} />
      </form>
    </Modal>
  );
}

/* ══════════════════ İzin ve bakım blokları ══════════════════ */

const blockTime = (wall) => `${wall.slice(8, 10)}.${wall.slice(5, 7)}.${wall.slice(0, 4)} ${wall.slice(11)}`;

function BlocksSection({ setup, canSetup }) {
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const filters = { from: dayFromToday(0), to: dayFromToday(180), page, pageSize: BLOCK_PAGE_SIZE };
  const list = useQuery({ queryKey: spaKeys.blocks(filters), queryFn: () => api(withQuery('/spa/blocks', filters)), placeholderData: keepPreviousData });
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (block) => apiDelete(`/spa/blocks/${block.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      toastSuccess('Blok kaldırıldı');
      setDeleting(null);
    },
  });
  const columns = [
    { key: 'resource', header: 'Terapist / oda', render: (row) => <span className="font-semibold text-ink">{row.resourceName}</span> },
    { key: 'range', header: 'Aralık', className: 'whitespace-nowrap tabular-nums', render: (row) => `${blockTime(row.startsAtWall)} – ${blockTime(row.endsAtWall)}` },
    { key: 'reason', header: 'Sebep', render: (row) => row.reason },
    { key: 'by', header: 'Giren', render: (row) => <span className="text-xs text-ink-muted">{row.createdBy}</span> },
  ];
  return (
    <>
      <SectionHeader title="İzin ve bakım" description="Terapistin izni, molası ya da odanın bakımı: o aralıkta randevu verilmez. Randevusu olan aralığa blok açılmaz; önce randevular taşınır." canSetup={canSetup} onAdd={() => setAdding(true)} addLabel="Yeni blok" />
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Önümüzdeki altı ayda blok yok"
        emptyHint="Yıllık izin, eğitim, oda bakımı gibi aralıkları buradan kapatın."
        rowActions={canSetup ? (row) => <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={`${row.resourceName} bloğunu kaldır`} onClick={() => setDeleting(row)} /> : undefined}
      />
      <BlockDialog open={adding} setup={setup} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Blok kaldırılsın mı?"
        message={deleting ? `${deleting.resourceName} · ${blockTime(deleting.startsAtWall)} – ${blockTime(deleting.endsAtWall)}: bu aralık yeniden randevuya açılır.` : ''}
        confirmLabel="Kaldır"
        onConfirm={() => remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
        isPending={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

function BlockDialog({ open, setup, onClose }) {
  const blank = () => ({ target: 'THERAPIST', therapistId: '', roomId: '', startsAt: `${setup.today}T09:00`, endsAt: `${setup.today}T18:00`, reason: '' });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(blank());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useSetupMutation((body) => apiPost('/spa/blocks', body), 'Blok açıldı', { onDone: onClose, setErrors });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  function submit(event) {
    event.preventDefault();
    const body = { therapistId: form.target === 'THERAPIST' ? form.therapistId || null : null, roomId: form.target === 'ROOM' ? form.roomId || null : null, startsAt: form.startsAt, endsAt: form.endsAt, reason: form.reason };
    const checked = validateWith(spaBlockInputSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(body);
  }
  const busy = save.isPending;
  return (
    <Modal
      open={open}
      title="Yeni blok"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-block-form" icon="check" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Bloğu aç'}
          </Button>
        </>
      }
    >
      <form id="spa-block-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <ChoiceChips
          label="Blok kime"
          options={[
            { value: 'THERAPIST', label: 'Terapist (izin, mola)' },
            { value: 'ROOM', label: 'Oda (bakım)' },
          ]}
          value={form.target}
          onChange={(target) => setForm((current) => ({ ...current, target }))}
          required
          disabled={busy}
        />
        {form.target === 'THERAPIST' ? (
          <Select label="Terapist" value={form.therapistId} onChange={set('therapistId')} error={errors.therapistId} disabled={busy} options={[{ value: '', label: 'Seçin' }, ...setup.therapists.map((row) => ({ value: row.id, label: row.name }))]} />
        ) : (
          <Select label="Oda" value={form.roomId} onChange={set('roomId')} error={errors.roomId ?? errors.therapistId} disabled={busy} options={[{ value: '', label: 'Seçin' }, ...setup.rooms.map((row) => ({ value: row.id, label: row.name }))]} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Başlangıç" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} error={errors.startsAt} disabled={busy} />
          <Input label="Bitiş" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} error={errors.endsAt} disabled={busy} />
        </div>
        <Input label="Sebep" value={form.reason} onChange={set('reason')} error={errors.reason} disabled={busy} placeholder="Yıllık izin, eğitim, bakım…" />
      </form>
    </Modal>
  );
}
