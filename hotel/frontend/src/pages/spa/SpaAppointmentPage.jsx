import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  SPA_CATEGORY_LABELS,
  SPA_GENDER_LABELS,
  SPA_PAYMENT_METHODS,
  SPA_SETTLE_MODE_LABELS,
  SPA_SOURCE_LABELS,
  spaAppointmentPriceSchema,
  spaCancelSchema,
  spaPaymentSchema,
  spaPaymentVoidSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatDateTime, formatMoney, formatPercent } from '../../lib/format.js';
import { PAYMENT_METHOD_ICONS, PAYMENT_STATUS_TONES, absolute, methodLabel } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { dayLabel, sessionPath, spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AppointmentStatusBadge, SlotPicker } from './SpaShared.jsx';

const METHOD_OPTIONS = SPA_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));
const POSTING_LABELS = Object.freeze({ POSTED: 'Folyoya işlendi', MANUAL: 'Folyoya elle işlenecek (görev açık)', PENDING: 'Folyoya işleniyor…' });
const POSTING_TONES = Object.freeze({ POSTED: 'success', MANUAL: 'warning', PENDING: 'neutral' });

/**
 * Randevunun sayfası (modül 57): kayıt, hesap (fiyat, borç, alınan, odaya yazılan, bakiye), ödeme satırları ve
 * işlemler. Her işlem randevunun gördüğümüz sürümüyle gider; kayıt bu arada değiştiyse sayfa yenilenir. Grup dersi
 * kaydında saat seansa bağlıdır (yeniden planlama yok).
 */
export function SpaAppointmentPage() {
  const { appointmentId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: spaKeys.appointment(appointmentId), queryFn: () => api(`/spa/appointments/${appointmentId}`) });
  const [dialog, setDialog] = useState(null);

  /** İşlem bitince sayfanın verisi sunucunun döndüğüyle değişir; listeler ve takvim yenilenir. */
  const applied = (message) => (data) => {
    queryClient.setQueryData(spaKeys.appointment(appointmentId), data);
    queryClient.invalidateQueries({ queryKey: spaKeys.all });
    setDialog(null);
    if (message) toastSuccess(message);
  };
  const failed = (error) => {
    toastError(error.message);
    if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: spaKeys.appointment(appointmentId) });
  };
  const restore = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointmentId}/restore`, body),
    onSuccess: applied('Randevu yeniden açıldı'),
    onError: failed,
  });
  const roomCharge = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointmentId}/room-charge`, body),
    onSuccess: applied('Tutar oda hesabına yazıldı'),
    onError: failed,
  });

  if (!query.data) return <QueryFallback query={query} errorTitle="Randevu bulunamadı" />;
  const { appointment, payments, roomCharges, summary, currency } = query.data;
  const money = (value) => formatMoney(value, currency);
  const open = appointment.status === 'BOOKED' || appointment.status === 'WAITLISTED';
  const closed = !open;
  const canBook = can(PERMISSIONS.SPA_BOOK);
  const canPay = can(PERMISSIONS.SPA_PAYMENT);
  const canSupervise = can(PERMISSIONS.SPA_SUPERVISE);
  const balance = Number(appointment.balance);
  const noDeskMoney = Number(summary.postedNet) === 0 && Number(summary.pendingPayments) === 0 && Number(summary.pendingRefunds) === 0;
  const canChargeRoom = closed && Number(appointment.amountDue) > 0 && Number(appointment.roomChargeTotal) === 0 && noDeskMoney && appointment.inHouse;
  const context = { appointment, summary, currency, money, applied, failed, onClose: () => setDialog(null) };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={appointment.sessionId ? sessionPath(appointment.sessionId) : '/spa/randevular'} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
            <Icon name="arrowLeft" className="size-4" /> {appointment.sessionId ? 'Derse dön' : 'Randevular'}
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
            {appointment.customerName}
            <AppointmentStatusBadge status={appointment.status} />
            {appointment.source === 'PORTAL' && <Badge tone="sky">{SPA_SOURCE_LABELS.PORTAL}</Badge>}
          </h2>
          <p className="text-sm text-ink-soft">
            {appointment.code} · {appointment.serviceName} · {dayLabel(appointment.day)} {appointment.time}–{appointment.endTime}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && canBook && !appointment.sessionId && (
            <Button type="button" variant="outline" icon="calendar" onClick={() => setDialog('move')}>
              Yeniden planla
            </Button>
          )}
          {appointment.status === 'BOOKED' && canBook && (
            <Button type="button" icon="check" onClick={() => setDialog('complete')} disabled={!appointment.started} title={appointment.started ? undefined : 'Randevunun saati gelince tamamlanır'}>
              {appointment.sessionId ? 'Katıldı' : 'Tamamla'}
            </Button>
          )}
          {appointment.status === 'BOOKED' && canBook && appointment.started && (
            <Button type="button" variant="outline" icon="alertCircle" onClick={() => setDialog('no-show')}>
              Gelmedi
            </Button>
          )}
          {open && canBook && (
            <Button type="button" variant="outline" icon="close" onClick={() => setDialog('cancel')}>
              İptal et
            </Button>
          )}
          {closed && canBook && (
            <Button
              type="button"
              variant="outline"
              icon="rotateCcw"
              onClick={() => restore.mutate({ expectedUpdatedAt: appointment.updatedAt })}
              disabled={restore.isPending || Boolean(summary.restoreBlock)}
              title={summary.restoreBlock ?? 'Yanlışlıkla kapatılan randevuyu yeniden açar'}
            >
              Geri al
            </Button>
          )}
        </div>
      </div>

      {appointment.status === 'WAITLISTED' && <Alert tone="warning">Bu kayıt yedek listede: derste yer açılınca sırayla asıla geçer ve misafire onay gider.</Alert>}
      {closed && balance > 0 && (
        <Alert tone="warning" title={`Ödenmemiş bakiye: ${money(appointment.balance)}`}>
          {canChargeRoom ? 'Misafir içeride: tutarı oda hesabına yazabilir ya da spa kasasında tahsil edebilirsiniz.' : 'Tutarı spa kasasında tahsil edin.'}
        </Alert>
      )}
      {balance < 0 && closed && (
        <Alert tone="info" title={`Fazla ödeme: ${money(absolute(appointment.balance))}`}>
          Alınan para borcun üstünde; farkı iade edin (iade onaya gider).
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Randevu">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
            <Row label="Hizmet">
              {appointment.serviceName} <span className="text-ink-muted">· {SPA_CATEGORY_LABELS[appointment.category] ?? appointment.category} · {appointment.durationMinutes} dk</span>
            </Row>
            <Row label="Misafir">
              {appointment.customerName}
              {appointment.guestCount > 1 ? ` · ${appointment.guestCount} kişi` : ''}
              {appointment.reservation ? (
                <span className="block text-xs text-ink-muted">
                  {appointment.reservation.confirmationCode}
                  {appointment.reservation.roomNumber ? ` · oda ${appointment.reservation.roomNumber}` : ''} · {appointment.inHouse ? 'içeride' : appointment.reservation.status === 'CHECKED_OUT' ? 'çıkış yaptı' : 'henüz gelmedi'}
                </span>
              ) : (
                <span className="block text-xs text-ink-muted">Dışarıdan gelen{appointment.customerPhone ? ` · ${appointment.customerPhone}` : ''}</span>
              )}
            </Row>
            <Row label={appointment.sessionId ? 'Eğitmen' : 'Terapist'}>{appointment.therapists.length ? appointment.therapists.map((item) => item.name).join(', ') : '—'}</Row>
            <Row label={appointment.sessionId ? 'Salon' : 'Oda'}>{appointment.room?.name ?? '—'}</Row>
            {appointment.therapistPreference && <Row label="Tercih">{SPA_GENDER_LABELS[appointment.therapistPreference]} terapist</Row>}
            {appointment.note && <Row label="Not">{appointment.note}</Row>}
            <Row label="Açan">
              {appointment.createdBy} · {formatDateTime(appointment.createdAt)}
            </Row>
            {appointment.completedAt && (
              <Row label="Tamamlayan">
                {appointment.completedBy} · {formatDateTime(appointment.completedAt)}
              </Row>
            )}
            {appointment.cancelledAt && (
              <Row label={appointment.status === 'NO_SHOW' ? 'Gelmedi' : 'İptal'}>
                {appointment.cancelledBy} · {formatDateTime(appointment.cancelledAt)}
                <span className="block text-xs text-ink-muted">{appointment.cancelReason}</span>
              </Row>
            )}
          </dl>
        </Card>

        <Card
          title="Hesap"
          actions={
            <div className="flex flex-wrap gap-2">
              {canSupervise && (appointment.status === 'BOOKED' || (appointment.status === 'COMPLETED' && Number(appointment.roomChargeTotal) === 0)) && (
                <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setDialog('price')}>
                  Fiyat
                </Button>
              )}
              {canChargeRoom && canBook && (
                <Button type="button" size="sm" variant="outline" icon="bed" onClick={() => roomCharge.mutate({ requestId: crypto.randomUUID(), expectedUpdatedAt: appointment.updatedAt })} disabled={roomCharge.isPending}>
                  Odaya yaz
                </Button>
              )}
              {canPay && Number(summary.payable) > 0 && (
                <Button type="button" size="sm" icon="wallet" onClick={() => setDialog('pay')}>
                  Tahsilat
                </Button>
              )}
              {canPay && Number(summary.refundable) > 0 && (
                <Button type="button" size="sm" variant="outline" icon="rotateCcw" onClick={() => setDialog('refund')}>
                  İade
                </Button>
              )}
            </div>
          }
        >
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
            <Row label="Fiyat" plain>
              <span className="tabular-nums">{money(appointment.priceTotal)}</span>
              {appointment.price !== appointment.listPrice && (
                <span className="block text-right text-xs text-ink-muted">
                  liste {money(appointment.listPrice)} · {appointment.priceReason} ({appointment.priceBy})
                </span>
              )}
            </Row>
            {closed && (
              <Row label={appointment.status === 'COMPLETED' ? 'Borç' : `Bedel (${formatPercent(Number(appointment.feePct ?? 0))})`} plain>
                <span className="tabular-nums">{money(appointment.totalDue)}</span>
                {appointment.feeWaivedBy && (
                  <span className="block text-right text-xs text-ink-muted">
                    bedel silindi: {appointment.feeWaiveReason} ({appointment.feeWaivedBy})
                  </span>
                )}
              </Row>
            )}
            <Row label={open ? 'Ön ödeme (kasa)' : 'Kasada alınan'} plain>
              <span className="tabular-nums">{money(appointment.paidTotal)}</span>
            </Row>
            {Number(appointment.roomChargeTotal) > 0 && (
              <Row label="Odaya yazılan" plain>
                <span className="tabular-nums">{money(appointment.roomChargeTotal)}</span>
              </Row>
            )}
            {closed && (
              <Row label="Bakiye" plain>
                <strong className={`tabular-nums ${balance > 0 ? 'text-warning-ink' : balance < 0 ? 'text-info-ink' : 'text-ink'}`}>{money(appointment.balance)}</strong>
              </Row>
            )}
            {open && appointment.cancelFee && Number(appointment.cancelFee.total) > 0 && (
              <Row label="Şimdi iptal edilirse" plain>
                <span className="tabular-nums text-warning-ink">
                  {money(appointment.cancelFee.total)} bedel ({formatPercent(Number(appointment.cancelFee.pct))})
                </span>
              </Row>
            )}
          </dl>
          {roomCharges.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
              {roomCharges.map((charge) => (
                <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Oda {charge.roomNumber} · {charge.guestName} · <span className="tabular-nums">{money(charge.total)}</span>
                    <span className="block text-xs text-ink-muted">
                      {charge.chargedBy} · {formatDateTime(charge.chargedAt)}
                    </span>
                  </span>
                  <Badge tone={POSTING_TONES[charge.posting.status]}>{POSTING_LABELS[charge.posting.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Spa kasası" description="Bu randevu için kasada alınan ödemeler. Büyük ödeme, iade ve hatalı girişin iptali ikinci bir yetkilinin onayına gider.">
        {payments.length === 0 ? (
          <EmptyState icon="wallet" title="Kasada ödeme yok" description={Number(appointment.roomChargeTotal) > 0 ? 'Bu randevunun ücreti oda hesabına yazıldı.' : 'Tahsilat alındığında burada görünür.'} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-bold">Tür</th>
                  <th scope="col" className="px-3 py-2 font-bold">Yöntem</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
                  <th scope="col" className="px-3 py-2 font-bold">Durum</th>
                  <th scope="col" className="px-3 py-2 font-bold">Alan</th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((row) => (
                  <tr key={row.id} className={row.voided || row.status === 'DECLINED' ? 'text-ink-muted' : ''}>
                    <td className="px-3 py-2 font-semibold">
                      {PAYMENT_KIND_LABELS[row.kind]}
                      {row.note && <span className="block text-xs font-normal text-ink-muted">{row.note}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name={PAYMENT_METHOD_ICONS[row.method] ?? 'wallet'} className="size-4 text-ink-muted" /> {methodLabel(row.method)}
                      </span>
                      {row.reference && <span className="block text-xs text-ink-muted">{row.reference}</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.voided ? 'line-through' : ''}`}>{money(row.amount)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={row.voided ? 'neutral' : PAYMENT_STATUS_TONES[row.status]}>{row.voided ? 'İptal edildi' : PAYMENT_STATUS_LABELS[row.status]}</Badge>
                      {row.voidPending && <span className="block text-xs text-warning-ink">iptali onay bekliyor</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.receivedBy}
                      <span className="block text-ink-muted">{formatDateTime(row.receivedAt)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canPay && row.kind !== 'REVERSAL' && row.status === 'POSTED' && !row.voided && !row.voidPending && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ void: row })}>
                          Hatalı giriş
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <MoveDialog open={dialog === 'move'} {...context} />
      <CompleteDialog open={dialog === 'complete'} canChargeRoom={appointment.inHouse && noDeskMoney && Number(appointment.price) > 0} {...context} />
      <CloseDialog open={dialog === 'cancel' || dialog === 'no-show'} outcome={dialog === 'no-show' ? 'no-show' : 'cancel'} canWaive={canSupervise} {...context} />
      <PriceDialog open={dialog === 'price'} {...context} />
      <PaymentDialog open={dialog === 'pay' || dialog === 'refund'} kind={dialog === 'refund' ? 'REFUND' : 'PAYMENT'} {...context} />
      <VoidDialog payment={dialog?.void ?? null} {...context} />
    </div>
  );
}

/** @param {{ label: string, plain?: boolean, children: React.ReactNode }} props */
function Row({ label, plain = false, children }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={plain ? 'text-right text-ink' : 'min-w-0 text-ink'}>{children}</dd>
    </>
  );
}

/** Ortak pencere altlığı: vazgeç + gönder. */
function DialogFooter({ form, busy, onClose, label, icon = 'check', variant = 'primary' }) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} icon={icon} variant={variant} disabled={busy}>
        {busy ? 'İşleniyor…' : label}
      </Button>
    </>
  );
}

/** Yeniden planlama: gün, boş saat ve terapist (aynı kalsın / uygun olan atansın / seçilen). */
function MoveDialog({ open, appointment, applied, failed, onClose }) {
  const setup = useQuery({ queryKey: spaKeys.setup, queryFn: () => api('/spa/setup'), enabled: open });
  const single = appointment.therapists.length === 1;
  const [form, setForm] = useState({ day: appointment.day, time: '', therapist: 'KEEP' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm({ day: appointment.day, time: '', therapist: 'KEEP' });
      setError('');
    }
  }, [open, appointment.day]);
  const eligible = useMemo(() => {
    const service = setup.data?.services.find((item) => item.id === appointment.serviceId);
    return (setup.data?.therapists ?? []).filter((therapist) => therapist.isActive && (service ? service.therapistIds.includes(therapist.id) : true));
  }, [setup.data, appointment.serviceId]);
  const move = useMutation({
    mutationFn: (body) => apiPut(`/spa/appointments/${appointment.id}`, body),
    onSuccess: applied('Randevu taşındı'),
    onError: (issue) => {
      setForm((current) => ({ ...current, time: '' }));
      failed(issue);
    },
  });
  // Boş saatler: aynı terapist kalacaksa onun, seçildiyse seçilenin, otomatikte herhangi birinin.
  const therapistId = !single ? '' : form.therapist === 'KEEP' ? appointment.therapists[0].id : form.therapist === 'AUTO' ? '' : form.therapist;
  function submit(event) {
    event.preventDefault();
    if (!form.time) {
      setError('Boş saatlerden birini seçin');
      return;
    }
    move.mutate({
      expectedUpdatedAt: appointment.updatedAt,
      startsAt: `${form.day}T${form.time}`,
      ...(form.therapist === 'KEEP' ? {} : { therapistIds: form.therapist === 'AUTO' ? null : [form.therapist] }),
    });
  }
  return (
    <Modal open={open} title="Randevuyu yeniden planla" onClose={move.isPending ? () => {} : onClose} size="lg" footer={<DialogFooter form="spa-move-form" busy={move.isPending} onClose={onClose} label="Taşı" />}>
      <form id="spa-move-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Şu an: {dayLabel(appointment.day)} {appointment.time} · {appointment.therapists.map((item) => item.name).join(', ') || 'terapistsiz'}
          {appointment.room ? ` · ${appointment.room.name}` : ''}. Oda aynı kalır; doluysa randevu taşınmaz.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Gün" type="date" min={setup.data?.today} value={form.day} onChange={(event) => setForm((current) => ({ ...current, day: event.target.value, time: '' }))} disabled={move.isPending} />
          {single && (
            <Select
              label="Terapist"
              value={form.therapist}
              onChange={(event) => setForm((current) => ({ ...current, therapist: event.target.value, time: '' }))}
              disabled={move.isPending}
              options={[
                { value: 'KEEP', label: `Aynı kalsın (${appointment.therapists[0].name})` },
                { value: 'AUTO', label: 'Uygun olan atansın' },
                ...eligible.filter((therapist) => therapist.id !== appointment.therapists[0].id).map((therapist) => ({ value: therapist.id, label: therapist.name })),
              ]}
            />
          )}
        </div>
        <SlotPicker serviceId={appointment.serviceId} day={form.day} therapistId={therapistId} ignoreAppointmentId={appointment.id} value={form.time} onChange={(time) => setForm((current) => ({ ...current, time }))} error={error} />
      </form>
    </Modal>
  );
}

/** Tamamlama: ücret oda hesabına mı, spa kasasına mı. */
function CompleteDialog({ open, appointment, canChargeRoom, money, applied, failed, onClose }) {
  const [settle, setSettle] = useState('DESK');
  useEffect(() => {
    if (open) setSettle(canChargeRoom ? 'ROOM' : 'DESK');
  }, [open, canChargeRoom]);
  const complete = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointment.id}/complete`, body),
    onSuccess: applied(appointment.sessionId ? 'Katılım işlendi' : 'Randevu tamamlandı'),
    onError: failed,
  });
  const free = Number(appointment.price) === 0;
  return (
    <Modal
      open={open}
      title={appointment.sessionId ? 'Katılımı işle' : 'Randevuyu tamamla'}
      onClose={complete.isPending ? () => {} : onClose}
      size="sm"
      footer={<DialogFooter form="spa-complete-form" busy={complete.isPending} onClose={onClose} label="Tamamla" />}
    >
      <form
        id="spa-complete-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          complete.mutate({ expectedUpdatedAt: appointment.updatedAt, settle });
        }}
      >
        <p className="text-sm text-ink-soft">
          {appointment.serviceName} · {appointment.customerName}. Ücret: <strong className="text-ink">{money(appointment.priceTotal)}</strong>
          {Number(appointment.paidTotal) > 0 ? ` (ön ödeme ${money(appointment.paidTotal)} düşülür)` : ''}
        </p>
        {free ? (
          <Alert tone="info">Bu randevu ücretsiz (ikram / paket); borç doğmaz.</Alert>
        ) : (
          <>
            <ChoiceChips
              label="Ücretin gideceği yer"
              options={[
                { value: 'ROOM', label: SPA_SETTLE_MODE_LABELS.ROOM },
                { value: 'DESK', label: SPA_SETTLE_MODE_LABELS.DESK },
              ].filter((option) => option.value === 'DESK' || canChargeRoom)}
              value={settle}
              onChange={setSettle}
              required
            />
            {!canChargeRoom && (
              <p className="text-xs text-ink-muted">
                {appointment.inHouse ? 'Kasada ödeme alındığı için kalan da kasada kapanır.' : 'Misafir otelde konaklamıyor (ya da henüz giriş yapmadı): ücret spa kasasında tahsil edilir.'}
              </p>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

/** İptal / gelmedi: gerekçe; yetkili bedeli gerekçeyle silebilir. */
function CloseDialog({ open, outcome, appointment, canWaive, money, applied, failed, onClose }) {
  const noShow = outcome === 'no-show';
  const [form, setForm] = useState({ reason: '', waiveFee: false, waiveReason: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm({ reason: noShow ? 'Misafir gelmedi' : '', waiveFee: false, waiveReason: '' });
      setErrors({});
    }
  }, [open, noShow]);
  const close = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointment.id}/${outcome}`, body),
    onSuccess: applied(noShow ? 'Gelmedi olarak işaretlendi' : 'Randevu iptal edildi'),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      failed(error);
    },
  });
  const fee = appointment.cancelFee && Number(appointment.cancelFee.total) > 0 ? appointment.cancelFee : null;
  const waitlisted = appointment.status === 'WAITLISTED';
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: appointment.updatedAt, reason: form.reason, waiveFee: form.waiveFee, waiveReason: form.waiveFee ? form.waiveReason : null };
    const checked = validateWith(spaCancelSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) close.mutate(body);
  }
  return (
    <Modal
      open={open}
      title={noShow ? 'Gelmedi olarak işaretle' : 'Randevuyu iptal et'}
      onClose={close.isPending ? () => {} : onClose}
      footer={<DialogFooter form="spa-close-form" busy={close.isPending} onClose={onClose} label={noShow ? 'Gelmedi işaretle' : 'İptal et'} variant="danger" icon={noShow ? 'alertCircle' : 'close'} />}
    >
      <form id="spa-close-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {waitlisted ? (
          <Alert tone="info">Yedek listedeki kayıt bedelsiz iptal edilir.</Alert>
        ) : noShow ? (
          <Alert tone="warning">Gelmedi bedeli ayardaki orandan hesaplanır; misafir içerideyse oda hesabına yazılır, değilse bakiyede kalır.</Alert>
        ) : fee ? (
          <Alert tone="warning" title={`Geç iptal bedeli: ${money(fee.total)} (${formatPercent(Number(fee.pct))})`}>
            Ücretsiz iptal süresi geçti. Misafir içerideyse bedel oda hesabına yazılır, değilse bakiyede kalır.
          </Alert>
        ) : (
          <Alert tone="info">Ücretsiz iptal süresi içinde: bedel doğmaz, yer açılır.</Alert>
        )}
        <Textarea label="Gerekçe" rows={2} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} error={errors.reason} disabled={close.isPending} />
        {canWaive && !waitlisted && (noShow || fee) && (
          <>
            <Checkbox label="Bedel alınmasın" hint="Yetkili kararı: gerekçesi kayıtta kalır." checked={form.waiveFee} onChange={(event) => setForm((current) => ({ ...current, waiveFee: event.target.checked }))} disabled={close.isPending} />
            {form.waiveFee && <Input label="Bedelin alınmama gerekçesi" value={form.waiveReason} onChange={(event) => setForm((current) => ({ ...current, waiveReason: event.target.value }))} error={errors.waiveReason} disabled={close.isPending} />}
          </>
        )}
      </form>
    </Modal>
  );
}

/** Fiyatı elle belirleme (ikram, paket, VIP). */
function PriceDialog({ open, appointment, money, applied, failed, onClose }) {
  const [form, setForm] = useState({ price: '', reason: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm({ price: appointment.price, reason: '' });
      setErrors({});
    }
  }, [open, appointment.price]);
  const save = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointment.id}/price`, body),
    onSuccess: applied('Fiyat güncellendi'),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      failed(error);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: appointment.updatedAt, price: form.price, reason: form.reason };
    const checked = validateWith(spaAppointmentPriceSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(body);
  }
  return (
    <Modal open={open} title="Randevunun fiyatı" onClose={save.isPending ? () => {} : onClose} size="sm" footer={<DialogFooter form="spa-price-form" busy={save.isPending} onClose={onClose} label="Kaydet" />}>
      <form id="spa-price-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">Liste fiyatı {money(appointment.listPrice)}. İkram için 0 yazın. Vergi otelin ayarına göre eklenir.</p>
        {appointment.status === 'COMPLETED' && (
          <Alert tone="info">Hizmet verildi: borç yeni fiyattan yeniden hesaplanır. Alınan para borcu aşarsa fazlası "İade" ile (onaylı) geri verilir; borç artarsa kalan kasada alınır.</Alert>
        )}
        <Input label="Fiyat" inputMode="decimal" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} error={errors.price} disabled={save.isPending} />
        <Input label="Gerekçe" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} error={errors.reason} disabled={save.isPending} placeholder="Balayı paketi, VIP ikramı…" />
      </form>
    </Modal>
  );
}

/** Tahsilat ya da iade. */
function PaymentDialog({ open, kind, appointment, summary, money, applied, failed, onClose }) {
  const refund = kind === 'REFUND';
  const limit = refund ? summary.refundable : summary.payable;
  const [form, setForm] = useState({ method: 'CASH', amount: '', reference: '', note: '' });
  const [errors, setErrors] = useState({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) {
      setForm({ method: 'CASH', amount: limit, reference: '', note: '' });
      setErrors({});
      setRequestId(crypto.randomUUID());
    }
  }, [open, limit]);
  const pay = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointment.id}/payments`, body),
    onSuccess: (data) => {
      const row = data.payments.find((item) => item.id === data.paymentId);
      applied(row?.status === 'PENDING' ? 'Onaya gönderildi: ikinci bir yetkili onaylayınca işlenir' : refund ? 'İade işlendi' : 'Tahsilat alındı')(data);
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      failed(error);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { requestId, kind, method: form.method, amount: form.amount, reference: form.reference, note: form.note };
    const checked = validateWith(spaPaymentSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) pay.mutate(body);
  }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open={open} title={refund ? 'İade' : 'Tahsilat'} onClose={pay.isPending ? () => {} : onClose} size="sm" footer={<DialogFooter form="spa-payment-form" busy={pay.isPending} onClose={onClose} label={refund ? 'İadeyi onaya gönder' : 'Tahsil et'} />}>
      <form id="spa-payment-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          {refund ? 'İade edilebilir' : appointment.status === 'BOOKED' ? 'Alınabilir ön ödeme' : 'Kalan bakiye'}: <strong className="text-ink">{money(limit)}</strong>
          {refund ? '. İade her zaman ikinci bir yetkilinin onayına gider.' : ''}
        </p>
        <ChoiceChips label="Yöntem" options={METHOD_OPTIONS} value={form.method} onChange={(method) => setForm((current) => ({ ...current, method }))} required disabled={pay.isPending} />
        <Input label="Tutar" inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} disabled={pay.isPending} />
        {form.method === 'CARD' && <Input label="Slip numarası" value={form.reference} onChange={set('reference')} error={errors.reference} disabled={pay.isPending} />}
        <Input label={refund ? 'İade sebebi' : 'Not (isteğe bağlı)'} value={form.note} onChange={set('note')} error={errors.note} disabled={pay.isPending} />
      </form>
    </Modal>
  );
}

/** Hatalı girişin iptali (onaya gider). */
function VoidDialog({ payment, appointment, money, applied, failed, onClose }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  useEffect(() => {
    setReason('');
    setErrors({});
  }, [payment?.id]);
  const request = useMutation({
    mutationFn: (body) => apiPost(`/spa/appointments/${appointment.id}/payments/${payment.id}/void`, body),
    onSuccess: applied('İptal isteği onaya gönderildi'),
    onError: failed,
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(spaPaymentVoidSchema, { reason });
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) request.mutate({ reason });
  }
  return (
    <Modal open={Boolean(payment)} title="Hatalı girişi iptal et" onClose={request.isPending ? () => {} : onClose} size="sm" footer={<DialogFooter form="spa-void-form" busy={request.isPending} onClose={onClose} label="Onaya gönder" variant="danger" icon="trash" />}>
      <form id="spa-void-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {payment && (
          <p className="text-sm text-ink-soft">
            {PAYMENT_KIND_LABELS[payment.kind]} {money(absolute(payment.amount))} · {methodLabel(payment.method)}. Yanlış tutar, yanlış yöntem ya da çift giriş içindir; misafire para geri verilecekse <strong>iade</strong> kullanın.
          </p>
        )}
        <Textarea label="İptal gerekçesi" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={request.isPending} />
      </form>
    </Modal>
  );
}
