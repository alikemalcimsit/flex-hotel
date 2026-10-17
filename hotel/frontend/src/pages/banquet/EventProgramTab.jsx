import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_EVENT_PAX, VENUE_LAYOUT_LABELS, VENUE_PRICE_BASIS_LABELS, createSessionSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { banquetKeys, eventPath, useVenues, wallRange } from '../../lib/banquet.js';
import { sessionFormOf, sessionPayloadOf, venueLayouts } from '../../lib/banquetForm.js';
import { formatMoney } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';

const AVAILABILITY_DEBOUNCE_MS = 400;

/**
 * Program (modül 37): oturumlar — salon, düzen, kişi, saat (otelin saatiyle),
 * kurulum / söküm. Talep ve opsiyonda serbestçe, kesin etkinlikte salon boşsa
 * değişir; gerçekleşmiş / kapanmış dosyada salt okunur.
 *
 * @param {{ event: any, canManage: boolean }} props
 */
export function EventProgramTab({ event, canManage }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const editable = canManage && ['INQUIRY', 'TENTATIVE', 'DEFINITE'].includes(event.status);
  const linkedItems = (sessionId) => event.items.filter((item) => item.sessionId === sessionId).length;

  const remove = useMutation({
    mutationFn: (session) => api(`/banquet/events/${event.id}/sessions/${session.id}`, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: event.updatedAt }) }),
    onSuccess: (result) => {
      setRemoving(null);
      queryClient.setQueryData(banquetKeys.event(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess('Oturum kaldırıldı');
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Card
      title="Program"
      description="Salon, düzen ve saat. Kurulum / söküm süresince salon doludur."
      actions={
        editable && (
          <Button type="button" size="sm" icon="plus" onClick={() => setEditing('new')}>
            Oturum ekle
          </Button>
        )
      }
    >
      {event.sessions.length === 0 ? (
        <EmptyState icon="calendar" title="Program boş" description={editable ? 'Oturum ekleyerek salon ve saati seçin; opsiyon ve kesinleştirme salonları bu programla tutar.' : 'Bu dosyada oturum yok.'} />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Oturum</th>
                <th scope="col" className="px-3 py-2 font-bold">Salon / düzen</th>
                <th scope="col" className="px-3 py-2 font-bold">Saat</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Kişi</th>
                <th scope="col" className="px-3 py-2 font-bold">Hazırlık</th>
                {editable && <th scope="col" className="px-3 py-2"><span className="sr-only">İşlemler</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {event.sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-3 py-2.5 align-top">
                    <span className="block font-semibold text-ink">{session.title}</span>
                    {session.notes && <span className="block text-xs text-ink-muted">{session.notes}</span>}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="block">{session.venue.name}</span>
                    <span className="block text-xs text-ink-muted">{VENUE_LAYOUT_LABELS[session.layout]}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums">{wallRange(session.startLocal, session.endLocal)}</td>
                  <td className="px-3 py-2.5 text-right align-top tabular-nums">{session.pax}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs text-ink-muted">
                    {session.setupMinutes} dk kurulum · {session.teardownMinutes} dk söküm
                  </td>
                  {editable && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                      <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(session)}>
                        Düzenle
                      </Button>
                      <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(session)} disabled={linkedItems(session.id) > 0} title={linkedItems(session.id) > 0 ? 'Bu oturuma bağlı kalem var' : undefined}>
                        Kaldır
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SessionDialog event={event} session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Oturumu kaldır"
        message={removing ? `"${removing.title}" programdan kalkar${event.status !== 'INQUIRY' ? '; salon tutması bırakılır' : ''}.` : ''}
        confirmLabel="Kaldır"
        onConfirm={() => remove.mutate(removing)}
        onClose={() => setRemoving(null)}
        isPending={remove.isPending}
        error={remove.error}
      />
    </Card>
  );
}

/**
 * Oturum ekle / düzenle. Salon, gün ve saat seçilince sunucuya "bu salon bu saatte
 * (kurulum / söküm dahil) kimde, bu oturum kaçıncı opsiyon olur, önerilen kira"
 * sorulur.
 *
 * @param {{ event: any, session: any | null, onClose: () => void }} props
 */
function SessionDialog({ event, session, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const venues = useVenues();
  const defaultDay = event.firstStartLocal?.slice(0, 10) ?? today;
  const [values, setValues] = useState(() => sessionFormOf(session, { day: defaultDay }));
  const [errors, setErrors] = useState({});
  const set = (key) => (changeEvent) => setValues((current) => ({ ...current, [key]: changeEvent.target.value }));
  const venueList = (venues.data?.items ?? []).filter((venue) => venue.status === 'ACTIVE' || venue.id === session?.venueId);
  const venue = venueList.find((entry) => entry.id === values.venueId);
  const layouts = venueLayouts(venue);
  const capacity = venue?.capacities.find((entry) => entry.layout === values.layout)?.capacity;

  // Salon değişince düzen salonun tanımlı düzenlerinden birine çekilir.
  const layoutKey = layouts.join(',');
  useEffect(() => {
    const available = layoutKey ? layoutKey.split(',') : [];
    if (available.length && !available.includes(values.layout)) setValues((current) => ({ ...current, layout: available[0] }));
  }, [layoutKey, values.layout]);

  const body = sessionPayloadOf(values, event.updatedAt);
  const [probe, setProbe] = useState(null);
  useEffect(() => {
    const ready = values.venueId && body.startAt && body.endAt && body.endAt > body.startAt;
    const timer = setTimeout(
      () =>
        setProbe(
          ready
            ? {
                venueId: values.venueId,
                startAt: body.startAt,
                endAt: body.endAt,
                setupMinutes: body.setupMinutes ?? undefined,
                teardownMinutes: body.teardownMinutes ?? undefined,
                excludeSessionId: session?.id,
                eventId: event.id,
              }
            : null,
        ),
      AVAILABILITY_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [values.venueId, body.startAt, body.endAt, body.setupMinutes, body.teardownMinutes, session?.id, event.id]);
  const availability = useQuery({
    queryKey: banquetKeys.availability(probe ?? {}),
    queryFn: () => api(withQuery('/banquet/availability', probe)),
    enabled: Boolean(probe),
  });

  const save = useMutation({
    mutationFn: (payload) =>
      session ? api(`/banquet/events/${event.id}/sessions/${session.id}`, { method: 'PUT', body: JSON.stringify(payload) }) : apiPost(`/banquet/events/${event.id}/sessions`, payload),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.event(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(session ? 'Oturum güncellendi' : 'Oturum eklendi');
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
    const checked = validateWith(createSessionSchema, body);
    const next = checked.ok ? {} : { ...checked.errors };
    if (capacity && Number(values.pax) > capacity) next.pax = `Bu düzende kapasite ${capacity} kişi`;
    if (!session && values.startDate && values.startDate < today) next.startAt = 'Geçmiş güne oturum açılmaz';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const data = availability.data;
  return (
    <Modal
      open
      size="lg"
      title={session ? 'Oturumu düzenle' : 'Oturum ekle'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-session-form" icon="check" disabled={busy || venues.isPending}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="event-session-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Oturum adı" name="session-title" value={values.title} onChange={set('title')} error={errors.title} placeholder="Ör. Nikâh, gala yemeği, sabah oturumu" required className="sm:col-span-2" disabled={busy} />
        {venues.isError ? (
          <p className="text-sm text-sec-strong sm:col-span-2">Salonlar yüklenemedi: {venues.error.message}</p>
        ) : (
          <Select
            label="Salon"
            name="session-venue"
            value={values.venueId}
            onChange={set('venueId')}
            error={errors.venueId}
            disabled={busy || venues.isPending}
            options={[
              { value: '', label: venues.isPending ? 'Yükleniyor…' : 'Salon seçin' },
              ...venueList.map((entry) => ({ value: entry.id, label: `${entry.parentId ? '— ' : ''}${entry.name}${entry.partCount ? ' (bütün)' : ''}${entry.status === 'PASSIVE' ? ' · pasif' : ''}` })),
            ]}
            required
          />
        )}
        <Select
          label="Düzen"
          name="session-layout"
          value={values.layout}
          onChange={set('layout')}
          error={errors.layout}
          disabled={busy || !venue}
          options={(layouts.length ? layouts : [values.layout]).map((layout) => ({
            value: layout,
            label: `${VENUE_LAYOUT_LABELS[layout]}${venue ? ` · en fazla ${venue.capacities.find((entry) => entry.layout === layout)?.capacity ?? '—'}` : ''}`,
          }))}
        />
        <Input label="Kişi" name="session-pax" type="number" min={1} max={capacity ?? MAX_EVENT_PAX} value={values.pax} onChange={set('pax')} error={errors.pax} required disabled={busy} />
        <div />
        <Input label="Başlangıç günü" name="session-start-date" type="date" value={values.startDate} min={session ? undefined : today} onChange={(changeEvent) => setValues((current) => ({ ...current, startDate: changeEvent.target.value, endDate: current.endDate < changeEvent.target.value ? changeEvent.target.value : current.endDate }))} error={errors.startAt} required disabled={busy} />
        <Input label="Başlangıç saati" name="session-start-time" type="time" value={values.startTime} onChange={set('startTime')} required disabled={busy} />
        <Input label="Bitiş günü" name="session-end-date" type="date" value={values.endDate} min={values.startDate} onChange={set('endDate')} error={errors.endAt} required disabled={busy} />
        <Input label="Bitiş saati" name="session-end-time" type="time" value={values.endTime} onChange={set('endTime')} required disabled={busy} />
        <Input label="Kurulum (dk)" name="session-setup" type="number" min={0} max={720} value={values.setupMinutes} onChange={set('setupMinutes')} error={errors.setupMinutes} placeholder={venue ? `Salonun: ${venue.setupMinutes}` : 'Salonun varsayılanı'} disabled={busy} />
        <Input label="Söküm (dk)" name="session-teardown" type="number" min={0} max={720} value={values.teardownMinutes} onChange={set('teardownMinutes')} error={errors.teardownMinutes} placeholder={venue ? `Salonun: ${venue.teardownMinutes}` : 'Salonun varsayılanı'} disabled={busy} />
        <Textarea label="Not" name="session-notes" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" disabled={busy} />

        <div className="sm:col-span-2" aria-live="polite">
          {availability.isFetching && !data && <Spinner label="Salon durumu soruluyor…" />}
          {availability.isError && <p className="text-sm text-sec-strong">Salon durumu alınamadı: {availability.error.message}</p>}
          {data && probe && (
            <Alert
              tone={data.definiteTaken ? 'danger' : data.conflicts.length ? 'warning' : 'success'}
              title={
                data.definiteTaken
                  ? 'Salon bu saatte kesin dolu'
                  : data.conflicts.length
                    ? `Salon opsiyonlu: bu oturum ${data.wouldBeRank}. opsiyon olur`
                    : 'Salon bu saatte boş'
              }
            >
              <span className="block text-xs">Salon (kurulum / söküm dahil) {wallRange(data.occupiedFromLocal, data.occupiedUntilLocal)} arası dolu sayılır.</span>
              {data.conflicts.map((entry) => (
                <span key={entry.eventId} className="block text-sm">
                  <Link to={eventPath(entry.eventId)} className="font-semibold underline-offset-2 hover:underline">
                    {entry.name} ({entry.code})
                  </Link>{' '}
                  · {entry.venueName} · {wallRange(entry.startLocal, entry.endLocal)} · <Badge tone={entry.status === 'DEFINITE' ? 'danger' : 'warning'}>{entry.status === 'DEFINITE' ? 'kesin' : 'opsiyon'}</Badge>
                </span>
              ))}
              {data.priceSuggestion && (
                <span className="mt-1 block text-sm">
                  Önerilen kira: <strong>{formatMoney(data.priceSuggestion.total, event.currency)}</strong> ({VENUE_PRICE_BASIS_LABELS[data.priceSuggestion.basis]} {data.priceSuggestion.quantity} ×{' '}
                  {formatMoney(data.priceSuggestion.unitPrice, event.currency)}) — fiyat kalemlerine "Salon kirası" olarak ekleyebilirsiniz.
                </span>
              )}
            </Alert>
          )}
        </div>
      </form>
    </Modal>
  );
}
