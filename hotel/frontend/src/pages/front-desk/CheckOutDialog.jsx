import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkOutSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Icon, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { MoneyText } from '../../components/MoneyText.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost } from '../../lib/api.js';
import { folioKeys, folioPath } from '../../lib/folios.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { cashKeys } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { PaymentDialog } from '../folios/PaymentDialogs.jsx';

/** Bu kodlarla dönen hata önizlemeyi tazeler (tutar, tarih ya da durum değişti). */
const REFRESH_CODES = new Set(['STALE_WRITE', 'INVALID_STATUS', 'FEE_CHANGED', 'EARLY_DEPARTURE', 'BALANCE_DUE']);

/**
 * Çevrilmiş cümledeki `{ad}` yer tutucularını React düğümüyle doldurur (cümle bölünmeden kalın tutar).
 * @param {string} text @param {Record<string, React.ReactNode>} nodes
 */
function fillNodes(text, nodes) {
  return text.split(/\{(\w+)\}/g).map((part, index) => (index % 2 ? <Fragment key={index}>{nodes[part] ?? `{${part}}`}</Fragment> : part));
}

/**
 * Check-out formu (modül 6).
 *
 * Ekran çıkıştan önce her şeyi gösterir: erken ayrılışta bırakılacak geceler ve
 * yeni tutar, geç çıkış ücreti, folyo bakiyesi, çıkışta folyoya işlenecek
 * tutarlar (kalan geceler, geç çıkış — vergileriyle; modül 15), girişte alınan
 * teminat (iade hatırlatması). Bakiye kapanmamışsa çıkış olmaz; ödeme buradan
 * alınır (modül 17: konaklamanın ilk açık folyosuna; eşik üstüyse onaya gider,
 * onaylanana kadar ödenecekten düşmez), iade folyo ekranından (onaylı). Yetkili
 * kişi gerekçe yazarak bakiyeyle çıkış
 * yapabilir. Yönlendirmeyle başka folyoya (ör. grup hesabı) düşecek tutar
 * misafirin borcu değildir; ayrıca gösterilir.
 *
 * @param {{ reservationId: string, onClose: () => void, onDone?: (reservation: object) => void }} props
 */
export function CheckOutDialog({ reservationId, onClose, onDone }) {
  const t = useT();
  const queryClient = useQueryClient();
  const can = useCan();
  const canOpenBalance = can(PERMISSIONS.STAYS_OPEN_BALANCE);
  const canViewFolio = can(PERMISSIONS.FOLIO_VIEW);
  const canReceive = can(PERMISSIONS.PAYMENT_RECEIVE);
  const [paying, setPaying] = useState(false);
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
      toastSuccess(
        updated.room
          ? t('frontDesk.checkOut.doneRoom', { name: updated.guest?.name ?? '', room: updated.room.number })
          : t('frontDesk.checkOut.done', { name: updated.guest?.name ?? '' }),
      );
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.all });
      queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      queryClient.invalidateQueries({ queryKey: folioKeys.all });
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
      <Modal open size="md" title={t('frontDesk.checkOut.title')} onClose={onClose}>
        <Spinner label={t('frontDesk.checkOut.loading')} className="py-10" />
      </Modal>
    );
  }
  if (preview.isError) {
    return (
      <Modal open size="md" title={t('frontDesk.checkOut.title')} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
        <Alert tone="danger" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => preview.refetch()}>{t('common.retry')}</Button>}>
          {preview.error.message}
        </Alert>
      </Modal>
    );
  }

  const data = preview.data;
  const { reservation, departure, lateCheckOut, folio, deposit, currency, pendingCharges } = data;
  const title = reservation.room
    ? t('frontDesk.checkOut.titleCodeRoom', { code: reservation.confirmationCode, room: reservation.room.number })
    : t('frontDesk.checkOut.titleCode', { code: reservation.confirmationCode });

  if (data.blocker) {
    return (
      <Modal open size="md" title={title} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
        <Alert tone="warning" title={t('frontDesk.checkOut.blocked')}>{data.blocker}</Alert>
      </Modal>
    );
  }

  const early = departure.kind === 'EARLY';
  const lateFee = lateCheckOut.applies ? lateCheckOut.fee : null;
  const appliedLateFee = lateFee && !waiveLateFee ? lateFee : null;
  // Ödenecek: sunucunun hesabı (bakiye + çıkışta işlenecekler); ücret uygulanmazsa geç çıkışsız hesap.
  const due = appliedLateFee ? data.due : data.dueWithoutLateFee;
  const balanceOpen = Number(due) !== 0;
  const pendingLines = pendingCharges.own.filter((line) => line.source !== 'LATE_CHECK_OUT' || appliedLateFee);

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
  // Birden fazla açık folyoda (pencere) para doğru pencereye düşmeli: ödeme folyo ekranından alınır.
  const multiWindow = (folio?.openFolios ?? 0) > 1;
  const blockedByEarly = early && !confirmEarly;

  // Ödeme formu çıkış penceresinin yerine açılır (iki pencere üst üste değil); kapanınca hesap tazelenir.
  if (paying) {
    return (
      <PaymentDialog
        mode="payment"
        target={{ reservationId: reservation.id, name: reservation.guest.name, currency, balance: due }}
        onClose={() => setPaying(false)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: folioKeys.all });
          queryClient.invalidateQueries({ queryKey: cashKeys.all });
          setServerError(null);
          preview.refetch();
        }}
      />
    );
  }

  return (
    <Modal
      open
      size="md"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="check-out-form" icon="logout" disabled={busy || blockedByBalance || blockedByEarly}>
            {busy ? t('frontDesk.checkOut.busy') : t('frontDesk.checkOut.submit')}
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
              {t('frontDesk.checkOut.stayLine', { from: formatDate(reservation.checkIn), to: formatDate(departure.plannedCheckOut), nights: reservation.nights, time: reservation.checkedInTime ?? '—' })}
            </p>
          </div>
        </div>

        {serverError && (
          <Alert tone={['FEE_CHANGED', 'EARLY_DEPARTURE', 'BALANCE_DUE'].includes(serverError.code) ? 'warning' : 'danger'} title={t('frontDesk.checkOut.failed')}>
            {serverError.message}
          </Alert>
        )}

        {early && (
          <div className="flex flex-col gap-2">
            <Alert tone="warning" title={t('frontDesk.checkOut.earlyTitle', { count: departure.releasedNights.length })}>
              {fillNodes(t(departure.promotion ? 'frontDesk.checkOut.earlyBody' : 'frontDesk.checkOut.earlyBodyReleased'), {
                date: formatDate(departure.plannedCheckOut),
                from: <strong>{formatMoney(reservation.totalPrice, currency)}</strong>,
                to: <strong>{formatMoney(departure.totalPrice, currency)}</strong>,
                released: formatMoney(departure.releasedAmount, currency),
              })}
              {/* Promosyonlu konaklama (modül 31): kalan gecelerle şart yeniden denetlenir. */}
              {departure.promotion && (
                <span className="mt-1 block">
                  {departure.promotion.kept
                    ? t('frontDesk.checkOut.promotionKept', { name: departure.promotion.name, amount: formatMoney(departure.promotion.discountAfter, currency) })
                    : t('frontDesk.checkOut.promotionLost', { message: departure.promotion.message, amount: formatMoney(departure.promotion.discountBefore, currency) })}
                </span>
              )}
            </Alert>
            <Checkbox label={t('frontDesk.checkOut.confirmEarly')} checked={confirmEarly} onChange={(e) => setConfirmEarly(e.target.checked)} disabled={busy} />
          </div>
        )}
        {departure.kind === 'OVERDUE' && (
          <Alert tone="warning" title={t('frontDesk.checkOut.overdueTitle', { count: departure.overdueDays })}>
            {t('frontDesk.checkOut.overdueBody', { date: formatDate(departure.plannedCheckOut) })}
          </Alert>
        )}

        {lateCheckOut.applies &&
          (lateFee ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warning" title={t('frontDesk.checkOut.lateFeeTitle', { amount: formatMoney(lateFee, currency) })}>
                {t('frontDesk.checkOut.lateFeeBody', { time: lateCheckOut.checkOutTime })}
              </Alert>
              <Checkbox label={t('frontDesk.stay.waiveFee')} hint={t('frontDesk.checkOut.waiveLateFeeHint')} checked={waiveLateFee} onChange={(e) => setWaiveLateFee(e.target.checked)} disabled={busy} />
            </div>
          ) : (
            <Alert tone="info" title={t('frontDesk.checkOut.lateTitle')}>{t('frontDesk.checkOut.lateNoFee', { time: lateCheckOut.checkOutTime })}</Alert>
          ))}

        <section className="flex flex-col gap-2 rounded-panel border border-line p-4" aria-labelledby="check-out-balance">
          <div className="flex items-center justify-between gap-2">
            <h3 id="check-out-balance" className="text-sm font-bold text-ink">{t('frontDesk.checkOut.account')}</h3>
            {canViewFolio && (
              <Link to={folioPath(reservation.id)} className="text-xs font-semibold text-info-ink underline-offset-2 hover:underline" onClick={onClose}>
                {t('frontDesk.stay.openFolio')}
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-ink-muted">{t('frontDesk.checkOut.charges')}</dt>
            <dd className="text-right tabular-nums"><MoneyText value={folio?.charges ?? '0'} currency={currency} /></dd>
            <dt className="text-ink-muted">{t('frontDesk.checkOut.paid')}</dt>
            <dd className="text-right tabular-nums"><MoneyText value={folio?.paid ?? '0'} currency={currency} /></dd>
            {pendingLines.map((line) => (
              <PendingRow key={`${line.source}-${line.label}`} label={t('frontDesk.checkOut.pendingLine', { label: line.label })} value={<MoneyText value={line.total} currency={currency} />} />
            ))}
            {Number(data.pendingPayments) !== 0 && (
              <PendingRow label={t('frontDesk.checkOut.pendingPayments')} value={<MoneyText value={data.pendingPayments} currency={currency} />} />
            )}
            <dt className="font-bold text-ink">{Number(due) < 0 ? t('frontDesk.checkOut.toRefund') : t('frontDesk.checkOut.due')}</dt>
            <dd className={`text-right font-bold tabular-nums ${balanceOpen ? 'text-sec-strong' : 'text-success-ink'}`}>
              <MoneyText value={String(due).replace('-', '')} currency={currency} />
            </dd>
          </dl>
          {pendingCharges.elsewhere.length > 0 && (
            <p className="text-xs text-ink-muted">
              {t('frontDesk.checkOut.elsewhere', {
                lines: pendingCharges.elsewhere.map((line) => `${line.label} (${formatMoney(line.total, currency)})`).join(', '),
                room: pendingCharges.elsewhere[0].folio.roomNumber ?? '—',
                folio: pendingCharges.elsewhere[0].folio.name,
              })}
            </p>
          )}
          {balanceOpen && (
            <Alert
              tone="danger"
              title={Number(due) > 0 ? t('frontDesk.checkOut.balanceDueTitle') : t('frontDesk.checkOut.refundDueTitle')}
              action={
                Number(due) > 0 && canReceive && !multiWindow && (
                  <Button size="sm" icon="wallet" onClick={() => setPaying(true)} disabled={busy}>
                    {t('frontDesk.checkOut.takePayment')}
                  </Button>
                )
              }
            >
              {Number(due) > 0
                ? multiWindow
                  ? t('frontDesk.checkOut.balanceDueMulti', { count: folio.openFolios })
                  : t('frontDesk.checkOut.balanceDueBody')
                : t('frontDesk.checkOut.refundDueBody')}
            </Alert>
          )}
          {balanceOpen && canOpenBalance && (
            <div className="flex flex-col gap-2">
              <Checkbox
                label={t('frontDesk.checkOut.allowOpenBalance')}
                hint={t('frontDesk.checkOut.allowOpenBalanceHint')}
                checked={allowOpenBalance}
                onChange={(e) => setAllowOpenBalance(e.target.checked)}
                disabled={busy}
              />
              {allowOpenBalance && (
                <Textarea
                  label={t('frontDesk.checkOut.openBalanceReason')}
                  rows={2}
                  maxLength={500}
                  value={openBalanceReason}
                  onChange={(e) => setOpenBalanceReason(e.target.value)}
                  error={errors.openBalanceReason}
                  placeholder={t('frontDesk.checkOut.openBalanceReasonPlaceholder')}
                  disabled={busy}
                />
              )}
            </div>
          )}
        </section>

        {data.openLaundry?.length > 0 && (
          <Alert tone="warning" title={t('frontDesk.checkOut.laundryTitle', { count: data.openLaundry.length })}>
            {t('frontDesk.checkOut.laundryBody', { orders: data.openLaundry.map((order) => `${order.reference} (${formatMoney(order.total, currency)})`).join(', ') })}
          </Alert>
        )}

        {data.lostItems?.matched?.length > 0 && (
          <Alert tone="warning" title={t('frontDesk.checkOut.lostTitle', { count: data.lostItems.matched.length })}>
            {t('frontDesk.checkOut.lostBody', { items: data.lostItems.matched.map((item) => `${item.reference} ${item.description} (${item.storageLocation})`).join(', ') })}
          </Alert>
        )}
        {data.lostItems?.foundInRoom?.length > 0 && (
          <Alert tone="info" title={t('frontDesk.checkOut.foundTitle', { count: data.lostItems.foundInRoom.length })}>
            {t('frontDesk.checkOut.foundBody', { items: data.lostItems.foundInRoom.map((item) => `${item.reference} ${item.description}`).join(', ') })}
          </Alert>
        )}

        {deposit && (
          <Alert tone="info" title={t('frontDesk.checkOut.depositTitle', { method: t(`frontDesk.depositMethod.${deposit.method}`), amount: formatMoney(deposit.amount, currency) })}>
            {deposit.method === 'CARD_PREAUTH'
              ? t('frontDesk.checkOut.depositPreauth')
              : deposit.recorded === 'POSTED'
                ? t('frontDesk.checkOut.depositPosted')
                : deposit.recorded === 'PENDING'
                  ? t('frontDesk.checkOut.depositPending')
                  : t('frontDesk.checkOut.depositNotRecorded')}
            {deposit.reference ? ` ${t('frontDesk.checkOut.depositReference', { reference: deposit.reference })}` : ''}
          </Alert>
        )}
      </form>
    </Modal>
  );
}

/** @param {{ label: string, value: React.ReactNode }} props */
function PendingRow({ label, value }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
