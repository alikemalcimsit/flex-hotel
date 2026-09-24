import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IDENTITY_POLICY_LABELS, checkInSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { DEPOSIT_OPTIONS, READINESS, frontDeskKeys } from '../../lib/front-desk.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { EMPTY_IDENTITY, IdentityFields, identityBody, toIdentityForm } from './IdentityFields.jsx';
import { RoomChoice } from './RoomChoice.jsx';

const NOT_READY = new Set(['DIRTY', 'CLEANING']);
/** Formda kalan (yeniden gönderilebilir) hatalar; diğerleri de form içinde gösterilir. */
const REFRESH_CODES = new Set(['STALE_WRITE', 'INVALID_STATUS', 'FEE_CHANGED', 'ROOM_OCCUPIED', 'ROOM_NOT_FREE']);

const emptyCompanion = () => ({ key: globalThis.crypto.randomUUID(), firstName: '', lastName: '', isChild: false, identity: { ...EMPTY_IDENTITY } });

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
  const queryClient = useQueryClient();
  const canAssignRoom = useCan()(PERMISSIONS.ROOMS_OPERATE);
  const preview = useQuery({
    queryKey: frontDeskKeys.checkIn(reservationId),
    queryFn: () => api(`/front-desk/stays/${reservationId}/check-in`),
    staleTime: 0,
  });
  const data = preview.data;

  const [guest, setGuest] = useState(EMPTY_IDENTITY);
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

  // Form önizleme ilk geldiğinde doldurulur; sonraki tazelemeler yazılanı silmez.
  const initialized = useRef(false);
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    setGuest(toIdentityForm(data.guest, data.guest.nationality));
    // Refakatçide yaş tutulmaz; belgesiz kaydedilebilen yalnızca çocuktur.
    setCompanions(
      data.companions.map((companion) => ({ ...emptyCompanion(), ...companion, isChild: !companion.idNumber, identity: toIdentityForm(companion) })),
    );
    setPlate(data.reservation.vehiclePlate ?? '');
    setChoosingRoom(!data.room && canAssignRoom);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/front-desk/stays/${reservationId}/check-in`, body),
    onSuccess: (updated) => {
      toastSuccess(`Giriş yapıldı — ${updated.guest?.name ?? ''}${updated.room ? `, oda ${updated.room.number}` : ''}`);
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

  if (preview.isPending) {
    return (
      <Modal open size="lg" title="Check-in" onClose={onClose}>
        <Spinner label="Konaklama yükleniyor…" className="py-10" />
      </Modal>
    );
  }
  if (preview.isError) {
    return (
      <Modal open size="md" title="Check-in" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
        <Alert tone="danger" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => preview.refetch()}>Tekrar dene</Button>}>
          {preview.error.message}
        </Alert>
      </Modal>
    );
  }

  const { reservation, room, earlyCheckIn, identityPolicy, currency } = data;
  const title = `Check-in — ${reservation.confirmationCode}`;

  if (data.blocker) {
    return (
      <Modal open size="md" title={title} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
        <Alert tone="warning" title="Giriş yapılamaz">{data.blocker}</Alert>
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
      guest: identityBody(guest),
      companions: companions.map((companion) => ({
        firstName: companion.firstName,
        lastName: companion.lastName,
        isChild: companion.isChild,
        ...identityBody(companion.identity),
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
      setErrors({ roomId: 'Misafire oda seçin' });
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const errorCount = Object.keys(errors).length;

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="check-in-form" icon="key" disabled={busy || roomBlocked}>
            {busy ? 'Giriş yapılıyor…' : earlyFee && !waiveEarlyFee ? `Giriş yap (${formatMoney(earlyFee, currency)} erken giriş)` : 'Giriş yap'}
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
            <p className="font-bold text-ink">{reservation.guest.name}</p>
            <p className="text-xs text-ink-muted">
              {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} · {reservation.nights} gece · {reservation.roomType.name} ·{' '}
              {partyLabel(reservation.adults, reservation.children)} · {reservation.boardType}
            </p>
            {reservation.lateArrival && <Badge tone="warning" className="mt-1">Geç geldi (giriş günü {formatDate(reservation.checkIn)})</Badge>}
            {reservation.notes && <p className="mt-1 text-xs text-ink-soft">Not: {reservation.notes}</p>}
          </div>
        </div>

        {serverError && (
          <Alert tone={serverError.code === 'FEE_CHANGED' || serverError.code === 'ROOM_NOT_READY' ? 'warning' : 'danger'} title="Giriş yapılmadı">
            {serverError.message}
          </Alert>
        )}
        {errorCount > 0 && !serverError && (
          <Alert tone="danger" title="Eksik ya da hatalı bilgi">İşaretli alanları düzeltin.</Alert>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="check-in-room">
          <h3 id="check-in-room" className="text-sm font-bold text-ink">Oda</h3>
          {targetRoom ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold tabular-nums text-ink">{targetRoom.number}</span>
              <Badge tone={READINESS[targetRoom.readiness]?.tone ?? 'neutral'}>{READINESS[targetRoom.readiness]?.label ?? targetRoom.readiness}</Badge>
              {pickedRoom && <Badge tone="info" dot={false}>Girişte verilecek</Badge>}
              {!choosingRoom && canAssignRoom && (
                <Button type="button" size="sm" variant="outline" icon="bed" onClick={() => setChoosingRoom(true)} disabled={busy}>
                  Başka oda
                </Button>
              )}
            </div>
          ) : (
            <Alert tone={canAssignRoom ? 'info' : 'warning'} title="Oda verilmemiş">
              {canAssignRoom
                ? 'Aşağıdan misafire oda seçin; giriş ile aynı işlemde atanır.'
                : 'Oda atama yetkiniz yok; odayı oda planından atayacak birine haber verin.'}
            </Alert>
          )}
          {roomBlocked && room.occupant && (
            <Alert tone="danger" title="Odada önceki misafir hâlâ içeride">
              {room.occupant.guestName} ({room.occupant.confirmationCode}) çıkış yapmadı. Önce onun çıkışını yapın ya da başka oda seçin.
            </Alert>
          )}
          {roomBlocked && room.block && (
            <Alert tone="danger" title="Oda arızalı / hizmet dışı">
              {room.block.reason}
              {room.block.until ? ` (${formatDate(room.block.until)} tarihine kadar)` : ''}. Başka oda seçin.
            </Alert>
          )}
          {roomNotReady && (
            <Checkbox
              label={`Oda henüz hazır değil${NOT_READY.has(targetRoom.housekeepingStatus) ? ` (${READINESS[targetRoom.housekeepingStatus].label.toLocaleLowerCase('tr')})` : ''}; yine de giriş yap`}
              hint="Misafir odaya temizlik bitince çıkacaksa. Denetim izine yazılır."
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
          <h3 id="check-in-identity" className="text-sm font-bold text-ink">Misafirin kimliği</h3>
          <IdentityFields value={guest} onChange={setGuest} errors={errors} prefix="guest" disabled={busy} />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="check-in-companions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="check-in-companions" className="text-sm font-bold text-ink">
              Refakatçiler <span className="font-normal text-ink-muted">({companions.length} / {maxCompanions})</span>
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() => setCompanions((list) => [...list, emptyCompanion()])}
              disabled={busy || companions.length >= maxCompanions}
            >
              Kişi ekle
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            Kimlik politikası: <strong>{IDENTITY_POLICY_LABELS[identityPolicy]}</strong>
            {identityPolicy === 'ALL_ADULTS' && reservation.adults > 1 ? ` — ${reservation.adults - 1} yetişkinin kimliği daha gerekli.` : '.'}
          </p>
          {errors.companions && <p className="text-xs font-semibold text-sec-strong">{errors.companions}</p>}
          {companions.map((companion, index) => (
            <fieldset key={companion.key} className="flex flex-col gap-3 rounded-panel border border-line p-4">
              <legend className="px-1 text-xs font-bold text-ink-muted">{index + 1}. kişi</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Ad" value={companion.firstName} onChange={(e) => updateCompanion(companion.key, { firstName: e.target.value })} error={errors[`companions.${index}.firstName`]} disabled={busy} />
                <Input label="Soyad" value={companion.lastName} onChange={(e) => updateCompanion(companion.key, { lastName: e.target.value })} error={errors[`companions.${index}.lastName`]} disabled={busy} />
              </div>
              <Checkbox label="Çocuk (belge isteğe bağlı)" checked={companion.isChild} onChange={(e) => updateCompanion(companion.key, { isChild: e.target.checked })} disabled={busy} />
              <IdentityFields
                value={companion.identity}
                onChange={(identity) => updateCompanion(companion.key, { identity })}
                errors={errors}
                prefix={`companions.${index}`}
                optional={companion.isChild}
                disabled={busy}
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => setCompanions((list) => list.filter((item) => item.key !== companion.key))} disabled={busy}>
                  Kaldır
                </Button>
              </div>
            </fieldset>
          ))}
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-label="Araç ve teminat">
          <Input label="Araç plakası (isteğe bağlı)" value={plate} onChange={(e) => setPlate(e.target.value)} error={errors.vehiclePlate} placeholder="34 ABC 123" maxLength={20} disabled={busy} />
          <Select
            label="Teminat"
            value={deposit.method}
            onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}
            options={DEPOSIT_OPTIONS}
            error={errors['deposit.method']}
            disabled={busy}
          />
          {deposit.method !== 'NONE' && (
            <>
              <Input
                label={`Teminat tutarı (${currency})`}
                inputMode="decimal"
                value={deposit.amount}
                onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })}
                error={errors['deposit.amount']}
                placeholder="1000"
                disabled={busy}
              />
              <Input
                label="Provizyon / dekont no (isteğe bağlı)"
                value={deposit.reference}
                onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })}
                error={errors['deposit.reference']}
                placeholder="Kart numarası yazmayın"
                maxLength={40}
                disabled={busy}
              />
            </>
          )}
        </section>

        {earlyCheckIn.applies && (
          earlyFee ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warning" title={`Erken giriş ücreti: ${formatMoney(earlyFee, currency)}`}>
                Giriş saati {earlyCheckIn.checkInTime}; misafir daha önce giriyor. Ücret konaklamaya yazılır, folyoya işlenir.
              </Alert>
              <Checkbox label="Ücret uygulama" hint="Oda hazırdı, iyi niyet. Denetim izine yazılır." checked={waiveEarlyFee} onChange={(e) => setWaiveEarlyFee(e.target.checked)} disabled={busy} />
            </div>
          ) : (
            <Alert tone="info" title="Erken giriş">Giriş saati {earlyCheckIn.checkInTime}; otelin erken giriş ücreti tanımlı değil.</Alert>
          )
        )}
      </form>
    </Modal>
  );
}
