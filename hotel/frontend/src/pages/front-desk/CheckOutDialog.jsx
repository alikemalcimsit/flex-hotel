import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEPOSIT_METHOD_LABELS, checkOutSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Icon, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Bu kodlarla dönen hata önizlemeyi tazeler (tutar, tarih ya da durum değişti). */
const REFRESH_CODES = new Set(['STALE_WRITE', 'INVALID_STATUS', 'FEE_CHANGED', 'EARLY_DEPARTURE', 'BALANCE_DUE']);

/**
 * Check-out formu (modül 6).
 *
 * Ekran çıkıştan önce her şeyi gösterir: erken ayrılışta bırakılacak geceler ve
 * yeni tutar, geç çıkış ücreti, folyo bakiyesi, girişte alınan teminat (iade
 * hatırlatması). Bakiye kapanmamışsa çıkış olmaz; tahsilat ödeme ekranında
 * (modül 17) yapılır. Yetkili kişi gerekçe yazarak bakiyeyle çıkış yapabilir.
 *
 * Folyosu olmayan konaklamada bakiye bilinmez: ekran bunu açıkça söyler,
 * sıfır saymaz.
 *
 * @param {{ reservationId: string, onClose: () => void, onDone?: (reservation: object) => void }} props
 */
export function CheckOutDialog({ reservationId, onClose, onDone }) {
  const queryClient = useQueryClient();
  const can = useCan();
  const canOpenBalance = can(PERMISSIONS.STAYS_OPEN_BALANCE);
  const preview = useQuery({
    queryKey: frontDeskKeys.checkOut(reservationId),
    queryFn: () => api(`/front-desk/stays/${reservationId}/check-out`),
    staleTime: 0,
  });

  const [confirmEarly, setConfirmEarly] = useState(false);
  const [waiveLateFee, setWaiveLateFee] = useState(false);
  const [allowOpenBalance, setAllowOpenBalance] = useState(false);
  const [openBalanceReason, setOpenBalanceReason] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/front-desk/stays/${reservationId}/check-out`, body),
    onSuccess: (updated) => {
      toastSuccess(`Çıkış yapıldı — ${updated.guest?.name ?? ''}${updated.room ? `, oda ${updated.room.number} kirli olarak işaretlenecek` : ''}`);
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.all });
      queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      onDone?.(updated);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (REFRESH_CODES.has(error.code)) preview.refetch();
    },
  });
  const busy = mutation.isPending;

  if (preview.isPending) {
    return (
      <Modal open size="md" title="Check-out" onClose={onClose}>
        <Spinner label="Hesap hazırlanıyor…" className="py-10" />
      </Modal>
    );
  }
  if (preview.isError) {
    return (
      <Modal open size="md" title="Check-out" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
        <Alert tone="danger" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => preview.refetch()}>Tekrar dene</Button>}>
          {preview.error.message}
        </Alert>
      </Modal>
    );
  }

  const data = preview.data;
  const { reservation, departure, lateCheckOut, folio, deposit, currency } = data;
  const title = `Check-out — ${reservation.confirmationCode}${reservation.room ? ` · oda ${reservation.room.number}` : ''}`;

  if (data.blocker) {
    return (
      <Modal open size="md" title={title} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
        <Alert tone="warning" title="Çıkış yapılamaz">{data.blocker}</Alert>
      </Modal>
    );
  }

  const early = departure.kind === 'EARLY';
  const lateFee = lateCheckOut.applies ? lateCheckOut.fee : null;
  const appliedLateFee = lateFee && !waiveLateFee ? lateFee : null;
  // Ödenecek: sunucunun hesabı (bakiye + geç çıkış ücreti); ücret uygulanmazsa yalnız bakiye.
  const due = folio ? (appliedLateFee ? data.due : folio.balance) : null;
  const balanceOpen = due !== null && Number(due) !== 0;

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      expectedUpdatedAt: reservation.updatedAt,
      confirmEarlyDeparture: early && confirmEarly,
      waiveLateFee: Boolean(lateFee && waiveLateFee),
      expectedLateFee: appliedLateFee,
      allowOpenBalance: balanceOpen && allowOpenBalance,
      openBalanceReason: balanceOpen && allowOpenBalance ? openBalanceReason : null,
    };
    const result = validateWith(checkOutSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const blockedByBalance = balanceOpen && !(allowOpenBalance && canOpenBalance);
  const blockedByEarly = early && !confirmEarly;

  return (
    <Modal
      open
      size="md"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="check-out-form" icon="logout" disabled={busy || blockedByBalance || blockedByEarly}>
            {busy ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
          </Button>
        </>
      }
    >
      <form id="check-out-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="flex items-start gap-3 rounded-panel border border-line bg-surface-muted p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-item bg-ink text-white">
            <Icon name="user" className="size-5" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-bold text-ink">{reservation.guest.name}</p>
            <p className="text-xs text-ink-muted">
              {formatDate(reservation.checkIn)} → {formatDate(departure.plannedCheckOut)} · {reservation.nights} gece · giriş {reservation.checkedInTime ?? '—'}
            </p>
          </div>
        </div>

        {serverError && (
          <Alert tone={['FEE_CHANGED', 'EARLY_DEPARTURE', 'BALANCE_DUE'].includes(serverError.code) ? 'warning' : 'danger'} title="Çıkış yapılmadı">
            {serverError.message}
          </Alert>
        )}

        {early && (
          <div className="flex flex-col gap-2">
            <Alert tone="warning" title={`Erken ayrılış: ${departure.releasedNights.length} gece bırakılacak`}>
              Planlanan çıkış {formatDate(departure.plannedCheckOut)}. Bugünden sonraki geceler satışa döner; konaklama tutarı{' '}
              <strong>{formatMoney(reservation.totalPrice, currency)}</strong> yerine <strong>{formatMoney(departure.totalPrice, currency)}</strong> olur
              ({formatMoney(departure.releasedAmount, currency)} düşer).
            </Alert>
            <Checkbox label="Misafir bugün ayrılıyor; kalan geceleri bırak" checked={confirmEarly} onChange={(e) => setConfirmEarly(e.target.checked)} disabled={busy} />
          </div>
        )}
        {departure.kind === 'OVERDUE' && (
          <Alert tone="warning" title={`Çıkış ${departure.overdueDays} gün gecikmiş`}>
            Planlanan çıkış {formatDate(departure.plannedCheckOut)}. Misafir o tarihte ayrıldıysa çıkışı şimdi kaydedin; hâlâ kalıyorsa önce konaklamayı uzatın.
          </Alert>
        )}

        {lateCheckOut.applies &&
          (lateFee ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warning" title={`Geç çıkış ücreti: ${formatMoney(lateFee, currency)}`}>
                Çıkış saati {lateCheckOut.checkOutTime} geçti. Ücret konaklamaya yazılır, folyoya işlenir.
              </Alert>
              <Checkbox label="Ücret uygulama" hint="Geç çıkış önceden verilmişti, iyi niyet. Denetim izine yazılır." checked={waiveLateFee} onChange={(e) => setWaiveLateFee(e.target.checked)} disabled={busy} />
            </div>
          ) : (
            <Alert tone="info" title="Geç çıkış">Çıkış saati {lateCheckOut.checkOutTime} geçti; otelin geç çıkış ücreti tanımlı değil.</Alert>
          ))}

        <section className="flex flex-col gap-2 rounded-panel border border-line p-4" aria-labelledby="check-out-balance">
          <h3 id="check-out-balance" className="text-sm font-bold text-ink">Hesap</h3>
          {folio ? (
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-muted">Harcamalar</dt>
              <dd className="text-right tabular-nums">{formatMoney(folio.charges, currency)}</dd>
              <dt className="text-ink-muted">Ödenen</dt>
              <dd className="text-right tabular-nums">{formatMoney(folio.paid, currency)}</dd>
              {appliedLateFee && (
                <>
                  <dt className="text-ink-muted">Geç çıkış ücreti</dt>
                  <dd className="text-right tabular-nums">{formatMoney(appliedLateFee, currency)}</dd>
                </>
              )}
              <dt className="font-bold text-ink">{Number(due) < 0 ? 'İade edilecek' : 'Ödenecek'}</dt>
              <dd className={`text-right font-bold tabular-nums ${balanceOpen ? 'text-sec-strong' : 'text-success-ink'}`}>
                {formatMoney(due.replace('-', ''), currency)}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">
              Bu konaklamanın folyosu yok; bakiye buradan denetlenemiyor. Tahsilatın tamamlandığından emin olun.
            </p>
          )}
          {balanceOpen && (
            <Alert tone="danger" title={Number(due) > 0 ? 'Ödenmemiş bakiye var' : 'Misafire iade yapılacak'}>
              Hesap kapanmadan çıkış yapılmaz. Tahsilatı / iadeyi kasadan yapıp tekrar deneyin.
            </Alert>
          )}
          {balanceOpen && canOpenBalance && (
            <div className="flex flex-col gap-2">
              <Checkbox
                label="Bakiyeyle çıkış yap"
                hint="Şirket faturası, acente ödemesi gibi. Yönetime uyarı düşer, denetim izine yazılır."
                checked={allowOpenBalance}
                onChange={(e) => setAllowOpenBalance(e.target.checked)}
                disabled={busy}
              />
              {allowOpenBalance && (
                <Textarea
                  label="Gerekçe"
                  rows={2}
                  maxLength={500}
                  value={openBalanceReason}
                  onChange={(e) => setOpenBalanceReason(e.target.value)}
                  error={errors.openBalanceReason}
                  placeholder="ör. Şirket faturası ay sonunda ödenecek"
                  disabled={busy}
                />
              )}
            </div>
          )}
        </section>

        {deposit && (
          <Alert tone="info" title={`Girişte teminat alındı: ${DEPOSIT_METHOD_LABELS[deposit.method]} · ${formatMoney(deposit.amount, currency)}`}>
            {deposit.method === 'CARD_PREAUTH'
              ? 'Kart provizyonunu kapatmayı unutmayın.'
              : 'Teminatı iade edin ya da hesaba mahsup edin.'}
            {deposit.reference ? ` Referans: ${deposit.reference}` : ''}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
