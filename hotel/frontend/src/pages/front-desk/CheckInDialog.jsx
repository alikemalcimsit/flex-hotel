import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEPOSIT_METHODS, checkInSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { IdReadBadge, IdScanDialog } from '../../components/IdScanDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useI18n, useT } from '../../i18n/index.jsx';
import { api, apiPost } from '../../lib/api.js';
import { READINESS, frontDeskKeys } from '../../lib/front-desk.js';
import { documentPath, guestPortalKeys } from '../../lib/guestPortal.js';
import { isMinor, stillFromDocument } from '../../lib/idScan.js';
import { EMPTY_KBS_EXTRAS, kbsExtrasBody, kbsExtrasForm, kbsRequiredExtras } from '../../lib/kbsFormat.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { EMPTY_IDENTITY, IdentityFields, identityBody, toIdentityForm } from './IdentityFields.jsx';
import { KbsIdentityFields } from './KbsIdentityFields.jsx';
import { RoomChoice } from './RoomChoice.jsx';

const NOT_READY = new Set(['DIRTY', 'CLEANING']);
/** Formda kalan (yeniden gönderilebilir) hatalar; diğerleri de form içinde gösterilir. */
const REFRESH_CODES = new Set(['STALE_WRITE', 'INVALID_STATUS', 'FEE_CHANGED', 'ROOM_OCCUPIED', 'ROOM_NOT_FREE']);

const emptyCompanion = () => ({ key: globalThis.crypto.randomUUID(), firstName: '', lastName: '', isChild: false, identity: { ...EMPTY_IDENTITY }, extras: { ...EMPTY_KBS_EXTRAS }, read: null, savedRead: null });

/** Okumanın formdaki kimlikle hâlâ geçerli olan kısmı (personel sonradan elle değiştirdiyse düşer). */
const liveRead = (identity, read) => (read && stillFromDocument(identityBody(identity), read.snapshot) ? read.documentRead : null);

/**
 * Check-in formu (modül 6). Tek pencerede: oda (verilmemişse ya da değişecekse
 * seçilir, girişle aynı işlemde atanır), misafirin kimliği (KBS), refakatçiler,
 * araç plakası, teminat, erken giriş ücreti.
 *
 * Sunucu her şeyi yeniden denetler; buradaki kontroller kullanıcıya erken söylemek
 * içindir. Sunucu "ücret değişti", "oda hazır değil" gibi bir sebeple durursa form
 * kapanmaz: önizleme tazelenir, personel gördükten sonra yeniden onaylar.
 *
 * @param {{ reservationId: string, onClose: () => void, onDone?: (reservation: object) => void }} props
 */
export function CheckInDialog({ reservationId, onClose, onDone }) {
  const t = useT();
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const can = useCan();
  const canAssignRoom = can(PERMISSIONS.ROOMS_OPERATE);
  // Online check-in (modül 53): misafir gönderdiyse form onun verisiyle dolu açılır; personel belgeyi görüp doğrular.
  const canSeeOnline = can(PERMISSIONS.GUEST_PORTAL_VIEW);
  const online = useQuery({
    queryKey: guestPortalKeys.byReservation(reservationId),
    queryFn: () => api(`/guest-portal/online-checkins/by-reservation/${reservationId}`),
    enabled: canSeeOnline,
    staleTime: 0,
  });
  const onlineCheckin = online.data?.onlineCheckin && online.data.onlineCheckin.status !== 'COMPLETED' ? online.data.onlineCheckin : null;
  const onlineSettled = !canSeeOnline || !online.isPending;
  const preview = useQuery({
    queryKey: frontDeskKeys.checkIn(reservationId),
    queryFn: () => api(`/front-desk/stays/${reservationId}/check-in`),
    staleTime: 0,
  });
  const data = preview.data;

  const [guest, setGuest] = useState(EMPTY_IDENTITY);
  // KBS ek alanları (modül 58): cinsiyet, anne / baba adı, doğum yeri; boş bırakılan kayıtlı değeri değiştirmez.
  const [guestExtras, setGuestExtras] = useState(EMPTY_KBS_EXTRAS);
  const [companions, setCompanions] = useState([]);
  const [plate, setPlate] = useState('');
  const [deposit, setDeposit] = useState({ method: 'NONE', amount: '', reference: '' });
  const [pickedRoom, setPickedRoom] = useState(null);
  const [choosingRoom, setChoosingRoom] = useState(false);
  const [acceptNotReady, setAcceptNotReady] = useState(false);
  const [waiveEarlyFee, setWaiveEarlyFee] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  /** Sunucunun "hazır değil" dediği oda (önizlemeden sonra kirlenmiş olabilir). */
  const [serverNotReadyRoom, setServerNotReadyRoom] = useState(null);
  // Kimlik tarama (modül 59): kimin için açık ('guest' | refakatçi anahtarı | 'new'), okuma ve ad düzeltmesi.
  const [scanFor, setScanFor] = useState(null);
  const [guestRead, setGuestRead] = useState(null);
  const [guestName, setGuestName] = useState(null);

  // Form önizleme ilk geldiğinde doldurulur; sonraki tazelemeler yazılanı silmez.
  const initialized = useRef(false);
  useEffect(() => {
    if (!data || !onlineSettled || initialized.current) return;
    initialized.current = true;
    const fromOnline = onlineCheckin?.checkInValues ?? null;
    setGuest(toIdentityForm(fromOnline ? { ...data.guest, ...fromOnline.guest } : data.guest, data.guest.nationality));
    setGuestExtras(kbsExtrasForm(data.guest));
    // Refakatçide yaş tutulmaz; belgesiz kaydedilebilen yalnızca çocuktur (online check-in'de misafir işaretler).
    setCompanions(
      fromOnline
        ? fromOnline.companions.map((companion) => ({ ...emptyCompanion(), firstName: companion.firstName, lastName: companion.lastName, isChild: companion.isChild, identity: toIdentityForm(companion), extras: kbsExtrasForm(companion) }))
        : data.companions.map((companion) => ({ ...emptyCompanion(), ...companion, isChild: !companion.idNumber, identity: toIdentityForm(companion), extras: kbsExtrasForm(companion), savedRead: companion.idRead ?? null })),
    );
    setPlate(fromOnline?.vehiclePlate ?? data.reservation.vehiclePlate ?? '');
    setChoosingRoom(!data.room && canAssignRoom);
  }, [data, onlineSettled]);

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/front-desk/stays/${reservationId}/check-in`, body),
    onSuccess: (updated) => {
      toastSuccess(
        updated.room
          ? t('frontDesk.checkIn.doneRoom', { name: updated.guest?.name ?? '', room: updated.room.number })
          : t('frontDesk.checkIn.done', { name: updated.guest?.name ?? '' }),
      );
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.all });
      queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      onDone?.(updated);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'ROOM_NOT_READY') {
        setAcceptNotReady(false);
        setServerNotReadyRoom(error.details?.roomNumber ?? null);
      }
      if (REFRESH_CODES.has(error.code)) preview.refetch();
    },
  });
  const busy = mutation.isPending;

  if (preview.isPending || !onlineSettled) {
    return (
      <Modal open size="lg" title={t('frontDesk.checkIn.title')} onClose={onClose}>
        <Spinner label={t('frontDesk.checkIn.loading')} className="py-10" />
      </Modal>
    );
  }
  if (preview.isError) {
    return (
      <Modal open size="md" title={t('frontDesk.checkIn.title')} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
        <Alert tone="danger" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => preview.refetch()}>{t('common.retry')}</Button>}>
          {preview.error.message}
        </Alert>
      </Modal>
    );
  }

  const { reservation, room, earlyCheckIn, identityPolicy, currency } = data;
  const title = t('frontDesk.checkIn.titleCode', { code: reservation.confirmationCode });

  if (data.blocker) {
    return (
      <Modal open size="md" title={title} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
        <Alert tone="warning" title={t('frontDesk.checkIn.blocked')}>{data.blocker}</Alert>
      </Modal>
    );
  }

  const targetRoom = pickedRoom
    ? { id: pickedRoom.id, number: pickedRoom.number, housekeepingStatus: pickedRoom.housekeepingStatus, readiness: NOT_READY.has(pickedRoom.housekeepingStatus) ? pickedRoom.housekeepingStatus : 'READY' }
    : room;
  const roomBlocked = !pickedRoom && room && ['OCCUPIED', 'BLOCKED'].includes(room.readiness);
  const roomNotReady = Boolean(targetRoom && (NOT_READY.has(targetRoom.housekeepingStatus) || serverNotReadyRoom === targetRoom.number));
  const partySize = reservation.adults + reservation.children;
  const maxCompanions = partySize - 1;
  const earlyFee = earlyCheckIn.applies ? earlyCheckIn.fee : null;

  function updateCompanion(key, changes) {
    setCompanions((list) => list.map((companion) => (companion.key === key ? { ...companion, ...changes } : companion)));
  }

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      expectedUpdatedAt: reservation.updatedAt,
      roomId: pickedRoom?.id ?? null,
      acceptRoomNotReady: roomNotReady && acceptNotReady,
      guest: { ...identityBody(guest), ...kbsExtrasBody(guestExtras), documentRead: liveRead(guest, guestRead) },
      guestName,
      companions: companions.map((companion) => ({
        firstName: companion.firstName,
        lastName: companion.lastName,
        isChild: companion.isChild,
        ...identityBody(companion.identity),
        ...kbsExtrasBody(companion.extras),
        documentRead: liveRead(companion.identity, companion.read),
      })),
      vehiclePlate: plate.trim() || null,
      deposit:
        deposit.method === 'NONE'
          ? { method: 'NONE' }
          : { method: deposit.method, amount: deposit.amount, reference: deposit.reference.trim() || null },
      waiveEarlyFee: Boolean(earlyFee && waiveEarlyFee),
      expectedEarlyFee: earlyFee && !waiveEarlyFee ? earlyFee : null,
    };
    const result = validateWith(checkInSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (!targetRoom) {
      setErrors({ roomId: t('frontDesk.checkIn.roomRequired') });
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const errorCount = Object.keys(errors).length;
  const today = data.businessDate;
  // Online check-in'de misafirin yüklediği belgeler: tarayıcının okuma kaynağı (görüntü yine cihazda okunur).
  const onlineDocuments = (onlineCheckin?.documents ?? [])
    .filter((doc) => !doc.purged)
    .map((doc, index) => ({ id: doc.id, label: doc.person === 0 ? t('frontDesk.checkIn.docOwner', { n: index + 1 }) : t('frontDesk.checkIn.docCompanion', { person: doc.person, n: index + 1 }), path: documentPath(onlineCheckin.id, doc.id, 'full') }));
  const scanCompanion = scanFor && scanFor !== 'guest' && scanFor !== 'new' ? companions.find((companion) => companion.key === scanFor) : null;
  const guestCardName = { firstName: data.guest.firstName, lastName: data.guest.lastName };
  const guestReadLive = liveRead(guest, guestRead);
  // KBS (modül 58): açıksa ayarın istediği ek alanlar yıldızlı; kapalıyken alanlar katlanır bölümde isteğe bağlı.
  const kbs = data.kbs ?? null;
  const kbsCollapsed = !kbs?.isEnabled;
  const guestKbsRequired = kbsRequiredExtras(guest, kbs);
  const companionKbsRequired = (companion) => (companion.isChild && !companion.identity.idNumber.trim() ? [] : kbsRequiredExtras(companion.identity, kbs));
  const guestSavedRead = !guestRead && data.guest.idRead && stillFromDocument(identityBody(guest), toIdentityForm(data.guest)) ? data.guest.idRead : null;

  /** Taramanın sonucu → forma. @param {'guest' | string} target @param {ReturnType<typeof import('../../lib/idScan.js').applyScan>} result */
  function applyScan(target, { values, documentRead }) {
    const identity = { idType: values.idType ?? '', idNumber: values.idNumber ?? '', nationality: values.nationality ?? '', birthDate: values.birthDate ?? '' };
    const read = documentRead ? { snapshot: identityBody(identity), documentRead } : null;
    setErrors({});
    if (target === 'guest') {
      setGuest(identity);
      setGuestRead(read);
      const renamed = values.firstName !== guestCardName.firstName || values.lastName !== guestCardName.lastName;
      setGuestName(renamed ? { firstName: values.firstName, lastName: values.lastName } : null);
      return;
    }
    const changes = { firstName: values.firstName, lastName: values.lastName, identity, read, isChild: isMinor(values.birthDate, today) };
    if (target === 'new') setCompanions((list) => [...list, { ...emptyCompanion(), ...changes }]);
    else updateCompanion(target, changes);
  }

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="check-in-form" icon="key" disabled={busy || roomBlocked}>
            {busy ? t('frontDesk.checkIn.busy') : earlyFee && !waiveEarlyFee ? t('frontDesk.checkIn.submitWithFee', { amount: formatMoney(earlyFee, currency) }) : t('frontDesk.checkIn.submit')}
          </Button>
        </>
      }
    >
      <form id="check-in-form" onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <div className="flex items-start gap-3 rounded-panel border border-line bg-surface-muted p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-item bg-ink text-white">
            <Icon name="user" className="size-5" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-bold text-ink">
              {guestName ? `${guestName.firstName} ${guestName.lastName}` : reservation.guest.name}
              {guestName && <span className="ml-2 text-xs font-normal text-ink-muted line-through">{reservation.guest.name}</span>}
            </p>
            <p className="text-xs text-ink-muted">
              {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} · {t('frontDesk.checkIn.nights', { count: reservation.nights })} · {reservation.roomType.name} ·{' '}
              {partyLabel(reservation.adults, reservation.children)} · {reservation.boardType}
            </p>
            {reservation.lateArrival && <Badge tone="warning" className="mt-1">{t('frontDesk.checkIn.lateArrival', { date: formatDate(reservation.checkIn) })}</Badge>}
            {reservation.notes && <p className="mt-1 text-xs text-ink-soft">{t('frontDesk.checkIn.note', { notes: reservation.notes })}</p>}
          </div>
        </div>

        {onlineCheckin && (
          <Alert tone={onlineCheckin.status === 'APPROVED' ? 'info' : 'warning'} title={t('frontDesk.checkIn.onlineTitle')}>
            {onlineCheckin.status === 'APPROVED'
              ? t('frontDesk.checkIn.onlineApproved', { by: onlineCheckin.reviewedBy ?? t('frontDesk.checkIn.onlineReception') })
              : onlineCheckin.status === 'REJECTED'
                ? t('frontDesk.checkIn.onlineRejected')
                : t('frontDesk.checkIn.onlinePending')}
            {onlineCheckin.arrivalTime ? ` ${t('frontDesk.checkIn.onlineArrival', { time: onlineCheckin.arrivalTime })}` : ''}
          </Alert>
        )}
        {serverError && (
          <Alert tone={serverError.code === 'FEE_CHANGED' || serverError.code === 'ROOM_NOT_READY' ? 'warning' : 'danger'} title={t('frontDesk.checkIn.failed')}>
            {serverError.message}
          </Alert>
        )}
        {errorCount > 0 && !serverError && (
          <Alert tone="danger" title={t('frontDesk.checkIn.invalidTitle')}>{t('frontDesk.checkIn.invalidBody')}</Alert>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="check-in-room">
          <h3 id="check-in-room" className="text-sm font-bold text-ink">{t('frontDesk.checkIn.room')}</h3>
          {targetRoom ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold tabular-nums text-ink">{targetRoom.number}</span>
              <Badge tone={READINESS[targetRoom.readiness]?.tone ?? 'neutral'}>{READINESS[targetRoom.readiness] ? t(`frontDesk.readiness.${targetRoom.readiness}`) : targetRoom.readiness}</Badge>
              {pickedRoom && <Badge tone="info" dot={false}>{t('frontDesk.checkIn.assignOnCheckIn')}</Badge>}
              {!choosingRoom && canAssignRoom && (
                <Button type="button" size="sm" variant="outline" icon="bed" onClick={() => setChoosingRoom(true)} disabled={busy}>
                  {t('frontDesk.checkIn.otherRoom')}
                </Button>
              )}
            </div>
          ) : (
            <Alert tone={canAssignRoom ? 'info' : 'warning'} title={t('frontDesk.checkIn.noRoomTitle')}>
              {canAssignRoom
                ? t('frontDesk.checkIn.noRoomPick')
                : t('frontDesk.checkIn.noRoomNoPermission')}
            </Alert>
          )}
          {roomBlocked && room.occupant && (
            <Alert tone="danger" title={t('frontDesk.checkIn.occupiedTitle')}>
              {t('frontDesk.checkIn.occupiedBody', { name: room.occupant.guestName, code: room.occupant.confirmationCode })}
            </Alert>
          )}
          {roomBlocked && room.block && (
            <Alert tone="danger" title={t('frontDesk.checkIn.blockedRoomTitle')}>
              {room.block.reason}
              {room.block.until ? ` ${t('frontDesk.checkIn.blockedUntil', { date: formatDate(room.block.until) })}` : ''}. {t('frontDesk.checkIn.pickAnotherRoom')}
            </Alert>
          )}
          {roomNotReady && (
            <Checkbox
              label={
                NOT_READY.has(targetRoom.housekeepingStatus)
                  ? t('frontDesk.checkIn.notReadyAcceptStatus', { status: t(`frontDesk.readiness.${targetRoom.housekeepingStatus}`).toLocaleLowerCase(locale) })
                  : t('frontDesk.checkIn.notReadyAccept')
              }
              hint={t('frontDesk.checkIn.notReadyHint')}
              checked={acceptNotReady}
              onChange={(event) => setAcceptNotReady(event.target.checked)}
              disabled={busy}
            />
          )}
          {errors.roomId && <p className="text-xs font-semibold text-sec-strong">{errors.roomId}</p>}
          {choosingRoom && (
            <RoomChoice
              reservationId={reservationId}
              currentRoomId={room?.id ?? null}
              selectedId={pickedRoom?.id ?? null}
              onSelect={(picked) => {
                setPickedRoom(picked);
                setAcceptNotReady(false);
                setServerNotReadyRoom(null);
              }}
              disabled={busy}
            />
          )}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="check-in-identity">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="check-in-identity" className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
              {t('frontDesk.checkIn.guestIdentity')}
              <IdReadBadge read={guestReadLive ? { at: null } : guestSavedRead} />
              {guestRead && !guestReadLive && <Badge tone="warning">{t('frontDesk.checkIn.editedAfterRead')}</Badge>}
            </h3>
            <Button type="button" size="sm" variant="outline" icon="camera" onClick={() => setScanFor('guest')} disabled={busy}>
              {t('frontDesk.checkIn.scan')}
            </Button>
          </div>
          {guestName && (
            <Alert tone="info" title={t('frontDesk.checkIn.renameTitle')} action={<Button type="button" size="sm" variant="outline" icon="rotateCcw" onClick={() => setGuestName(null)} disabled={busy}>{t('frontDesk.list.revert')}</Button>}>
              {t('frontDesk.checkIn.renameBody', { from: `${guestCardName.firstName} ${guestCardName.lastName}`, to: `${guestName.firstName} ${guestName.lastName}` })}
            </Alert>
          )}
          {errors['guest.documentRead'] && <p className="text-xs font-semibold text-sec-strong">{errors['guest.documentRead']}</p>}
          <IdentityFields value={guest} onChange={setGuest} errors={errors} prefix="guest" birthDateRequired={guestKbsRequired.includes('birthDate')} disabled={busy} />
          <KbsIdentityFields value={guestExtras} onChange={setGuestExtras} errors={errors} prefix="guest" required={guestKbsRequired} collapsed={kbsCollapsed} disabled={busy} />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="check-in-companions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="check-in-companions" className="text-sm font-bold text-ink">
              {t('frontDesk.checkIn.companions')} <span className="font-normal text-ink-muted">({companions.length} / {maxCompanions})</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" icon="camera" onClick={() => setScanFor('new')} disabled={busy || companions.length >= maxCompanions}>
                {t('frontDesk.checkIn.scanAdd')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                icon="plus"
                onClick={() => setCompanions((list) => [...list, emptyCompanion()])}
                disabled={busy || companions.length >= maxCompanions}
              >
                {t('frontDesk.checkIn.addPerson')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            {t('frontDesk.checkIn.identityPolicy')} <strong>{t(`frontDesk.identityPolicy.${identityPolicy}`)}</strong>
            {identityPolicy === 'ALL_ADULTS' && reservation.adults > 1 ? ` — ${t('frontDesk.checkIn.moreAdultIds', { count: reservation.adults - 1 })}` : '.'}
          </p>
          {errors.companions && <p className="text-xs font-semibold text-sec-strong">{errors.companions}</p>}
          {companions.map((companion, index) => (
            <fieldset key={companion.key} className="flex flex-col gap-3 rounded-panel border border-line p-4">
              <legend className="px-1 text-xs font-bold text-ink-muted">{t('frontDesk.checkIn.person', { n: index + 1 })}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <IdReadBadge read={liveRead(companion.identity, companion.read) ? { at: null } : !companion.read && companion.savedRead ? companion.savedRead : null} />
                  {companion.read && !liveRead(companion.identity, companion.read) && <Badge tone="warning">{t('frontDesk.checkIn.editedAfterRead')}</Badge>}
                </span>
                <Button type="button" size="sm" variant="outline" icon="camera" onClick={() => setScanFor(companion.key)} disabled={busy}>
                  {t('frontDesk.checkIn.scan')}
                </Button>
              </div>
              {errors[`companions.${index}.documentRead`] && <p className="text-xs font-semibold text-sec-strong">{errors[`companions.${index}.documentRead`]}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={t('frontDesk.checkIn.firstName')} value={companion.firstName} onChange={(e) => updateCompanion(companion.key, { firstName: e.target.value })} error={errors[`companions.${index}.firstName`]} disabled={busy} />
                <Input label={t('frontDesk.checkIn.lastName')} value={companion.lastName} onChange={(e) => updateCompanion(companion.key, { lastName: e.target.value })} error={errors[`companions.${index}.lastName`]} disabled={busy} />
              </div>
              <Checkbox label={t('frontDesk.checkIn.child')} checked={companion.isChild} onChange={(e) => updateCompanion(companion.key, { isChild: e.target.checked })} disabled={busy} />
              <IdentityFields
                value={companion.identity}
                onChange={(identity) => updateCompanion(companion.key, { identity })}
                errors={errors}
                prefix={`companions.${index}`}
                optional={companion.isChild}
                birthDateRequired={companionKbsRequired(companion).includes('birthDate')}
                disabled={busy}
              />
              <KbsIdentityFields
                value={companion.extras}
                onChange={(extras) => updateCompanion(companion.key, { extras })}
                errors={errors}
                prefix={`companions.${index}`}
                required={companionKbsRequired(companion)}
                collapsed={kbsCollapsed}
                disabled={busy}
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => setCompanions((list) => list.filter((item) => item.key !== companion.key))} disabled={busy}>
                  {t('frontDesk.checkIn.remove')}
                </Button>
              </div>
            </fieldset>
          ))}
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-label={t('frontDesk.checkIn.vehicleDeposit')}>
          <Input label={t('frontDesk.checkIn.plate')} value={plate} onChange={(e) => setPlate(e.target.value)} error={errors.vehiclePlate} placeholder="34 ABC 123" maxLength={20} disabled={busy} />
          <Select
            label={t('frontDesk.checkIn.deposit')}
            value={deposit.method}
            onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}
            options={DEPOSIT_METHODS.map((method) => ({ value: method, label: t(`frontDesk.depositMethod.${method}`) }))}
            error={errors['deposit.method']}
            disabled={busy}
          />
          {deposit.method !== 'NONE' && (
            <>
              <Input
                label={t('frontDesk.checkIn.depositAmount', { currency })}
                inputMode="decimal"
                value={deposit.amount}
                onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })}
                error={errors['deposit.amount']}
                placeholder="1000"
                disabled={busy}
              />
              <Input
                label={t('frontDesk.checkIn.depositReference')}
                value={deposit.reference}
                onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })}
                error={errors['deposit.reference']}
                placeholder={t('frontDesk.checkIn.depositReferencePlaceholder')}
                maxLength={40}
                disabled={busy}
              />
            </>
          )}
        </section>

        {earlyCheckIn.applies && (
          earlyFee ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warning" title={t('frontDesk.checkIn.earlyFeeTitle', { amount: formatMoney(earlyFee, currency) })}>
                {t('frontDesk.checkIn.earlyFeeBody', { time: earlyCheckIn.checkInTime })}
              </Alert>
              <Checkbox label={t('frontDesk.stay.waiveFee')} hint={t('frontDesk.checkIn.waiveEarlyFeeHint')} checked={waiveEarlyFee} onChange={(e) => setWaiveEarlyFee(e.target.checked)} disabled={busy} />
            </div>
          ) : (
            <Alert tone="info" title={t('frontDesk.checkIn.earlyTitle')}>{t('frontDesk.checkIn.earlyNoFee', { time: earlyCheckIn.checkInTime })}</Alert>
          )
        )}
      </form>
      {scanFor && (
        <IdScanDialog
          title={
            scanFor === 'guest'
              ? t('frontDesk.checkIn.scanTitle', { name: `${guestCardName.firstName} ${guestCardName.lastName}` })
              : scanFor === 'new'
                ? t('frontDesk.checkIn.scanTitleNew')
                : t('frontDesk.checkIn.scanTitle', { name: scanCompanion?.firstName || t('frontDesk.checkIn.companion') })
          }
          current={
            scanFor === 'guest'
              ? { ...(guestName ?? guestCardName), ...guest }
              : scanCompanion
                ? { firstName: scanCompanion.firstName, lastName: scanCompanion.lastName, ...scanCompanion.identity }
                : {}
          }
          today={today}
          onlineDocuments={onlineDocuments}
          matchEndpoint="/front-desk/identity-matches"
          excludeGuestIds={scanFor === 'guest' ? [data.guest.id] : []}
          onApply={(result) => applyScan(scanFor, result)}
          onClose={() => setScanFor(null)}
        />
      )}
    </Modal>
  );
}
