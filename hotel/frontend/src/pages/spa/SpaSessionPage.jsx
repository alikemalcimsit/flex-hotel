import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPA_MAX_ENROLL_GUESTS, SPA_SESSION_STATUS_LABELS, SPA_SESSION_STATUS_TONES, spaEnrollSchema, spaSessionCancelSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { appointmentPath, dayLabel, spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AppointmentStatusBadge, CustomerField, customerPayload, emptyCustomer } from './SpaShared.jsx';

/**
 * Grup dersinin seansı (modül 57): kayıtlar (asıl, yedek, kapananlar), kayıt ekleme, seansı düzenleme / iptal etme ve
 * dersi tamamlama. Tamamlamak asıl listedekilerin ücretini işler (oteldeki misafirin odasına, diğerlerinin bakiyesine);
 * kalabalık derste iş parça parça yürür ve ekran kendiliğinden devam eder. Kayıt satırı kaydın sayfasını (ödeme,
 * gelmedi, iptal) açar.
 */
export function SpaSessionPage() {
  const { sessionId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: spaKeys.session(sessionId), queryFn: () => api(`/spa/sessions/${sessionId}`) });
  const [dialog, setDialog] = useState(null);
  const [progress, setProgress] = useState(null);

  const applied = (message) => (data) => {
    queryClient.setQueryData(spaKeys.session(sessionId), { session: data.session, enrollments: data.enrollments, currency: data.currency });
    queryClient.invalidateQueries({ queryKey: spaKeys.all });
    setDialog(null);
    if (message) toastSuccess(typeof message === 'function' ? message(data) : message);
  };
  const failed = (error) => {
    toastError(error.message);
    if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: spaKeys.session(sessionId) });
  };

  /** Dersi tamamla: sunucu süre bütçesiyle çalışır; kalan varsa aynı istek yinelenir. */
  const complete = useMutation({
    mutationFn: async (expectedUpdatedAt) => {
      let totals = { completed: 0, charged: 0, failed: [] };
      for (;;) {
        const data = await apiPost(`/spa/sessions/${sessionId}/complete`, { expectedUpdatedAt });
        totals = { completed: totals.completed + data.completed, charged: totals.charged + data.charged, failed: [...totals.failed, ...data.failed] };
        setProgress({ ...totals, pending: data.pending });
        // Bütçe dolduysa kalanlar için yinele; ilerleme yoksa (hepsi hata) dur.
        if (!data.pending || data.completed === 0) return { ...data, ...totals };
      }
    },
    onSuccess: (data) => {
      applied()(data);
      setProgress(null);
      if (data.failed.length) toastError(`${data.failed.length} kayıt tamamlanamadı: ${data.failed[0].message}`);
      else toastSuccess(`Ders tamamlandı: ${data.completed} kayıt işlendi, ${data.charged} tanesi odaya yazıldı`);
    },
    onError: (error) => {
      setProgress(null);
      failed(error);
    },
  });

  if (!query.data) return <QueryFallback query={query} errorTitle="Seans bulunamadı" />;
  const { session, enrollments, currency } = query.data;
  const money = (value) => formatMoney(value, currency);
  const scheduled = session.status === 'SCHEDULED';
  const canBook = can(PERMISSIONS.SPA_BOOK);
  const canSetup = can(PERMISSIONS.SPA_SETUP);
  const context = { session, applied, failed, onClose: () => setDialog(null) };
  const openBalances = enrollments.filter((row) => !['BOOKED', 'WAITLISTED'].includes(row.status) && Number(row.balance) !== 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/spa/dersler" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
            <Icon name="arrowLeft" className="size-4" /> Dersler
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
            {session.serviceName}
            <Badge tone={SPA_SESSION_STATUS_TONES[session.status]}>{SPA_SESSION_STATUS_LABELS[session.status]}</Badge>
          </h2>
          <p className="text-sm text-ink-soft">
            {dayLabel(session.day)} {session.time}–{session.endTime} · {session.instructor?.name ?? 'eğitmensiz'}
            {session.room ? ` · ${session.room.name}` : ''} · kişi başı {money(session.priceTotal)}
          </p>
          {session.note && <p className="text-sm text-ink-muted">{session.note}</p>}
        </div>
        {scheduled && (
          <div className="flex flex-wrap gap-2">
            {canBook && (
              <Button type="button" icon="plus" onClick={() => setDialog('enroll')}>
                Kayıt ekle
              </Button>
            )}
            {canBook && (
              <Button type="button" variant="outline" icon="checkCheck" onClick={() => complete.mutate(session.updatedAt)} disabled={!session.started || complete.isPending} title={session.started ? undefined : 'Dersin saati gelince tamamlanır'}>
                {complete.isPending ? 'Tamamlanıyor…' : 'Dersi tamamla'}
              </Button>
            )}
            {canSetup && (
              <Button type="button" variant="outline" icon="pencil" onClick={() => setDialog('edit')}>
                Düzenle
              </Button>
            )}
            {canSetup && (
              <Button type="button" variant="outline" icon="close" onClick={() => setDialog('cancel')}>
                Seansı iptal et
              </Button>
            )}
          </div>
        )}
      </div>

      {progress && (
        <Alert tone="info">
          Kayıtlar işleniyor: {progress.completed} tamamlandı{progress.pending ? `, ${progress.pending} sırada` : ''}…
        </Alert>
      )}
      {session.status === 'CANCELLED' && (
        <Alert tone="warning" title="Seans iptal edildi">
          {session.cancelReason} ({session.cancelledBy}). Kayıtlar bedelsiz kapandı; ön ödemesi olanların iadesi kayıt sayfasından yapılır.
        </Alert>
      )}
      {session.status === 'COMPLETED' && enrollments.some((row) => row.status === 'BOOKED') && (
        <Alert tone="warning" action={canBook && <Button type="button" size="sm" variant="outline" onClick={() => complete.mutate(session.updatedAt)} disabled={complete.isPending}>Kalanları işle</Button>}>
          Ders yapıldı ama bazı kayıtların ücreti işlenmedi. Tek tek açıp tamamlayın ya da yeniden deneyin.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Asıl liste" value={session.bookedCount} hint={`Kontenjan ${session.capacity}`} icon="users" />
        <SummaryTile label="Boş yer" value={session.free} hint={session.free ? 'Kayıt alınabilir' : 'Dolu'} icon="plus" />
        <SummaryTile label="Yedek" value={session.waitlistCount} hint="Yer açılınca sırayla geçer" icon="clock" tone={session.waitlistCount ? 'warning' : 'neutral'} />
        <SummaryTile label="Açık bakiye" value={openBalances} hint="Tahsil / iade edilecek kayıt" icon="wallet" tone={openBalances ? 'warning' : 'neutral'} />
      </div>

      <Card title="Kayıtlar" description="Asıl liste, yedekler ve kapanan kayıtlar. Ödeme, gelmedi ve iptal kaydın sayfasından yapılır.">
        {enrollments.length === 0 ? (
          <EmptyState icon="users" title="Henüz kayıt yok" description={scheduled ? 'Misafirler portaldan kaydolabilir; siz de "Kayıt ekle" ile yazabilirsiniz.' : 'Bu seansa kayıt alınmadı.'} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-bold">Misafir</th>
                  <th scope="col" className="px-3 py-2 font-bold">Kişi</th>
                  <th scope="col" className="px-3 py-2 font-bold">Durum</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {enrollments.map((row) => {
                  const closed = !['BOOKED', 'WAITLISTED'].includes(row.status);
                  const balance = Number(row.balance);
                  return (
                    <tr key={row.id} className={row.status === 'CANCELLED' ? 'text-ink-muted' : ''}>
                      <td className="px-3 py-2">
                        <Link to={appointmentPath(row.id)} className="font-semibold text-ink hover:underline">
                          {row.customerName}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {row.code}
                          {row.roomNumber ? ` · oda ${row.roomNumber}` : row.reservationId ? '' : ' · dışarıdan'}
                          {row.source === 'PORTAL' ? ' · portaldan' : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.guestCount}</td>
                      <td className="px-3 py-2">
                        <AppointmentStatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(closed ? row.totalDue : row.priceTotal)}
                        {closed && balance !== 0 && <span className={`block text-xs ${balance > 0 ? 'text-warning-ink' : 'text-info-ink'}`}>{balance > 0 ? `${money(row.balance)} açık` : `${money(String(-balance))} iade`}</span>}
                        {!closed && Number(row.paidTotal) > 0 && <span className="block text-xs text-ink-muted">{money(row.paidTotal)} ön ödeme</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link to={appointmentPath(row.id)} className="text-sm font-semibold text-info-ink hover:underline">
                          Aç
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <EnrollDialog open={dialog === 'enroll'} {...context} />
      <EditDialog open={dialog === 'edit'} {...context} />
      <CancelDialog open={dialog === 'cancel'} enrolled={session.bookedCount + session.waitlistCount} {...context} />
    </div>
  );
}

/** Kayıt ekleme: misafir, kişi sayısı; ders doluysa yedek listeye. */
function EnrollDialog({ open, session, applied, failed, onClose }) {
  const [form, setForm] = useState({ customer: emptyCustomer(), guestCount: '1', waitlist: false, note: '' });
  const [errors, setErrors] = useState({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) {
      setForm({ customer: emptyCustomer(), guestCount: '1', waitlist: false, note: '' });
      setErrors({});
      setRequestId(crypto.randomUUID());
    }
  }, [open]);
  const enroll = useMutation({
    mutationFn: (body) => apiPost(`/spa/sessions/${session.id}/enroll`, body),
    onSuccess: applied((data) => (data.waitlisted ? 'Yedek listeye yazıldı' : 'Kayıt alındı')),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      // Ders doluysa yedek seçeneği işaretlenmiş olarak yeniden sorulur.
      if (error.code === 'SPA_SESSION_FULL') setErrors({ guestCount: error.message });
      failed(error);
    },
  });
  const full = Number(form.guestCount) > session.free;
  function submit(event) {
    event.preventDefault();
    const body = { requestId, ...customerPayload(form.customer), guestCount: form.guestCount, waitlist: full && form.waitlist, note: form.note };
    const checked = validateWith(spaEnrollSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    if (full && !form.waitlist) {
      setErrors({ guestCount: session.free ? `Derste ${session.free} kişilik yer var; yedek listeye yazmak için aşağıyı işaretleyin.` : 'Ders dolu; yedek listeye yazmak için aşağıyı işaretleyin.' });
      return;
    }
    enroll.mutate(body);
  }
  const busy = enroll.isPending;
  return (
    <Modal
      open={open}
      title="Derse kayıt"
      onClose={busy ? () => {} : onClose}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-enroll-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : full && form.waitlist ? 'Yedeğe yaz' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="spa-enroll-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <CustomerField value={form.customer} onChange={(customer) => setForm((current) => ({ ...current, customer }))} errors={errors} disabled={busy} />
        <Select
          label="Kişi sayısı"
          value={form.guestCount}
          onChange={(event) => setForm((current) => ({ ...current, guestCount: event.target.value }))}
          error={errors.guestCount}
          disabled={busy}
          options={Array.from({ length: SPA_MAX_ENROLL_GUESTS }, (_, index) => ({ value: String(index + 1), label: `${index + 1} kişi` }))}
        />
        {full && <Checkbox label="Yedek listeye yaz" hint="Yer açılınca sırayla asıla geçer; misafire onay bildirimi gider." checked={form.waitlist} onChange={(event) => setForm((current) => ({ ...current, waitlist: event.target.checked }))} disabled={busy} />}
        <Textarea label="Not (isteğe bağlı)" rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}

/** Seansı düzenle: gün ve saat, eğitmen, salon, kontenjan, not. */
function EditDialog({ open, session, applied, failed, onClose }) {
  const setup = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup'), enabled: open });
  const initial = () => ({ day: session.day, time: session.time, therapistId: session.instructor?.id ?? '', roomId: session.room?.id ?? '', capacity: String(session.capacity), note: session.note ?? '' });
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(initial());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.updatedAt]);
  const save = useMutation({
    mutationFn: (body) => apiPut(`/spa/sessions/${session.id}`, body),
    onSuccess: applied('Seans güncellendi'),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      failed(error);
    },
  });
  const service = setup.data?.services.find((item) => item.id === session.serviceId);
  const pick = (rows, ids) => (rows ?? []).filter((row) => row.isActive && (!ids || ids.includes(row.id)));
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  function submit(event) {
    event.preventDefault();
    const moved = form.day !== session.day || form.time !== session.time;
    save.mutate({
      expectedUpdatedAt: session.updatedAt,
      ...(moved ? { startsAt: `${form.day}T${form.time}` } : {}),
      ...(session.instructor && form.therapistId !== session.instructor.id ? { therapistId: form.therapistId } : {}),
      ...(session.room && form.roomId !== session.room.id ? { roomId: form.roomId } : {}),
      capacity: form.capacity,
      note: form.note,
    });
  }
  const busy = save.isPending;
  return (
    <Modal
      open={open}
      title="Seansı düzenle"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-session-edit-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="spa-session-edit-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {session.bookedCount > 0 && <Alert tone="info">Saat değişirse {session.bookedCount} kayıtlı kişinin kaydı da taşınır ve iletişimi olan misafirlere yeni saatle onay gider.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Gün" type="date" value={form.day} onChange={set('day')} error={errors.startsAt} disabled={busy} />
          <Input label="Saat" type="time" step={300} value={form.time} onChange={set('time')} disabled={busy} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {session.instructor && <Select label="Eğitmen" value={form.therapistId} onChange={set('therapistId')} error={errors.therapistId ?? errors.therapistIds} disabled={busy} options={pick(setup.data?.therapists, service?.therapistIds).map((item) => ({ value: item.id, label: item.name }))} />}
          {session.room && <Select label="Salon" value={form.roomId} onChange={set('roomId')} error={errors.roomId} disabled={busy} options={pick(setup.data?.rooms, service?.roomIds).map((item) => ({ value: item.id, label: item.name }))} />}
        </div>
        <Input label="Kontenjan" inputMode="numeric" value={form.capacity} onChange={set('capacity')} error={errors.capacity} disabled={busy} />
        <Textarea label="Not" rows={2} value={form.note} onChange={set('note')} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}

/** Seans iptali: kayıtlar bedelsiz kapanır. */
function CancelDialog({ open, session, enrolled, applied, failed, onClose }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setReason('');
      setErrors({});
    }
  }, [open]);
  const cancel = useMutation({
    mutationFn: (body) => apiPost(`/spa/sessions/${session.id}/cancel`, body),
    onSuccess: applied((data) => `Seans iptal edildi: ${data.closed} kayıt bedelsiz kapandı${data.prepaid ? `, ${data.prepaid} kaydın ön ödemesi iade edilecek` : ''}`),
    onError: failed,
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: session.updatedAt, reason };
    const checked = validateWith(spaSessionCancelSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) cancel.mutate(body);
  }
  const busy = cancel.isPending;
  return (
    <Modal
      open={open}
      title="Seansı iptal et"
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="spa-session-cancel-form" variant="danger" icon="close" disabled={busy}>
            {busy ? 'İptal ediliyor…' : 'Seansı iptal et'}
          </Button>
        </>
      }
    >
      <form id="spa-session-cancel-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Alert tone="warning">
          {enrolled ? `${enrolled} kayıt bedelsiz kapanacak; misafirlere haber vermeniz gerekir (otomatik iptal bildirimi gitmez).` : 'Bu seansta kayıt yok.'} Eğitmen ve salon o saatte boşalır. Geri alınamaz.
        </Alert>
        <Textarea label="İptal gerekçesi" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
      </form>
    </Modal>
  );
}
