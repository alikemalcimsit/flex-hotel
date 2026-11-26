import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { BOARD_TYPES, reservationUpdatePreviewSchema, updateReservationSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Textarea } from '@hotelos/ui';
import { AgencyPicker } from '../../components/AgencyPicker.jsx';
import { CouponField } from '../../components/CouponField.jsx';
import { Modal } from '../../components/Modal.jsx';
import { agencyIssueText } from '../../lib/agencies.js';
import { useT } from '../../i18n/index.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { addDaysIso, reservationKeys } from '../../lib/reservations.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { boardLong } from './reservationTheme.js';

const QUOTE_DEBOUNCE_MS = 250;

/** İndirim kararının tonu (bkz. sunucu `discountMessage`). */
const OUTCOME_TONES = Object.freeze({ KEPT: 'info', REVOKED: 'warning', REMOVED: 'warning', APPLIED: 'success', REPLACED: 'success' });

/**
 * Rezervasyonu düzenler.
 *
 * - İçerideki misafirde giriş tarihi ve oda tipi kilitlidir (oda değişikliği
 *   oda planından yapılır); çıkış tarihi uzatılıp kısaltılabilir.
 * - Fiyat kararı: **anlaşılanı koru** (yalnızca eklenen geceler güncel
 *   fiyatla), **sistem fiyatıyla yeniden hesapla** ya da (yetkiliyse) **elle**.
 *   Elle fiyatlı rezervasyonda konaklama değişirse sunucu karar ister.
 * - İndirim (modül 31): promosyonun koşulları konaklama ya da pansiyon
 *   değişince yeniden denetlenir; şart bozulursa indirim kalkar. Kupon
 *   eklenebilir (daha avantajlıysa yerine geçer), indirim kaldırılabilir. Yeni
 *   toplam ve indirimin ne olacağı kaydetmeden önce sunucunun aynı hesabıyla
 *   gösterilir (önizleme ucu).
 * - Yalnızca değişen alanlar gönderilir; kayıt bu arada değiştiyse sunucu
 *   409 döner, sayfa tazelenir.
 * - Yeni tarihler için müsaitlik önizlemesi (rezervasyonun kendi yeri boş sayılır).
 *
 * @param {{ reservation: object, onClose: () => void, onSaved: (updated: object) => void, onError: (error: Error) => void }} props
 */
export function EditReservationDialog({ reservation, onClose, onSaved, onError }) {
  const t = useT();
  const boardOptions = BOARD_TYPES.map((value) => ({ value, label: boardLong(value) }));
  const can = useCan();
  const canOverridePrice = can(PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE);
  const { today } = useHotelToday();
  const { options: roomTypeOptions } = useRoomTypes();
  const inHouse = reservation.status === 'CHECKED_IN';

  const [form, setForm] = useState({
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    roomTypeId: reservation.roomType.id,
    adults: String(reservation.adults),
    children: String(reservation.children),
    boardType: reservation.boardType,
    notes: reservation.notes ?? '',
  });
  /** `KEEP` | `CALCULATED` | `MANUAL` */
  const [priceMode, setPriceMode] = useState('KEEP');
  const [manual, setManual] = useState({ total: '', note: '' });
  /** İndirim kararı: `null` (kopyadaki koşullarla yeniden denetlenir) | `{ mode: 'REMOVE' }` | `{ mode: 'COUPON', code }` */
  const [discount, setDiscount] = useState(null);
  const [errors, setErrors] = useState({});
  const [decisionRequired, setDecisionRequired] = useState(false);
  // Acente (modül 29): atanabilir, değiştirilebilir, kaldırılabilir; içerideki misafirde sabit.
  const [agency, setAgency] = useState(reservation.agency ?? null);
  const agencyChanged = (agency?.id ?? null) !== (reservation.agency?.id ?? null);
  const boardChanged = form.boardType !== reservation.boardType;

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const stayChanged = form.checkIn !== reservation.checkIn || form.checkOut !== reservation.checkOut || form.roomTypeId !== reservation.roomType.id;
  const stayValid = form.checkIn && form.checkOut && form.checkOut > form.checkIn;
  // Müsaitlik önizlemesi: konaklama, acente ya da acente kontratında pansiyon değiştiyse.
  const availabilityNeeded = stayChanged || agencyChanged || Boolean(agency && boardChanged);

  /** Değişen alanlar (sürüm damgası olmadan): kayıt ve fiyat önizlemesi aynı gövdeyi kullanır. */
  function changes() {
    const body = {};
    if (form.checkIn !== reservation.checkIn) body.checkIn = form.checkIn;
    if (form.checkOut !== reservation.checkOut) body.checkOut = form.checkOut;
    if (form.roomTypeId !== reservation.roomType.id) body.roomTypeId = form.roomTypeId;
    if (form.adults !== String(reservation.adults)) body.adults = form.adults;
    if (form.children !== String(reservation.children)) body.children = form.children;
    if (form.boardType !== reservation.boardType) body.boardType = form.boardType;
    if (form.notes !== (reservation.notes ?? '')) body.notes = form.notes;
    if (agencyChanged) body.agencyId = agency?.id ?? null;
    if (priceMode === 'CALCULATED') body.price = { mode: 'CALCULATED' };
    if (priceMode === 'MANUAL') body.price = { mode: 'MANUAL', total: manual.total, note: manual.note };
    if (discount) body.discount = discount;
    return body;
  }

  const [quoteInput, setQuoteInput] = useState(null);
  useEffect(() => {
    if (!availabilityNeeded || !stayValid) {
      setQuoteInput(null);
      return undefined;
    }
    const timer = setTimeout(
      () =>
        setQuoteInput({
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          lines: [{ roomTypeId: form.roomTypeId, quantity: 1, adults: Number(form.adults) || 1, children: Number(form.children) || 0 }],
          excludeReservationId: reservation.id,
          ...(agency ? { agencyId: agency.id, boardType: form.boardType } : {}),
        }),
      QUOTE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [availabilityNeeded, stayValid, form.checkIn, form.checkOut, form.roomTypeId, form.adults, form.children, form.boardType, agency, reservation.id]);
  const quote = useQuery({
    queryKey: reservationKeys.quote(quoteInput ?? {}),
    queryFn: () => apiPost('/reservations/quote', quoteInput),
    enabled: Boolean(quoteInput),
  });
  const typeQuote = quote.data?.roomTypes.find((type) => type.id === form.roomTypeId);

  // Fiyat önizlemesi: fiyatı ya da indirimi etkileyen bir değişiklik varsa (elle fiyatta toplam zaten bellidir).
  const priceChanges = stayValid && priceMode !== 'MANUAL' && (stayChanged || agencyChanged || boardChanged || priceMode === 'CALCULATED' || discount) ? changes() : null;
  const priceKey = priceChanges ? JSON.stringify(priceChanges) : null;
  const [previewInput, setPreviewInput] = useState(null);
  useEffect(() => {
    if (!priceKey) {
      setPreviewInput(null);
      return undefined;
    }
    const body = JSON.parse(priceKey);
    if (!validateWith(reservationUpdatePreviewSchema, body).ok) {
      setPreviewInput(null);
      return undefined;
    }
    const timer = setTimeout(() => setPreviewInput(body), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [priceKey]);
  const preview = useQuery({
    queryKey: reservationKeys.updatePreview(reservation.id, previewInput ?? {}),
    queryFn: () => apiPost(`/reservations/${reservation.id}/preview`, previewInput),
    enabled: Boolean(previewInput),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const plan = previewInput && preview.data && !preview.isPlaceholderData ? preview.data : null;
  const previewFieldErrors = preview.isError ? (preview.error.fields ?? {}) : {};
  const couponError = errors['discount.code'] ?? previewFieldErrors['discount.code'];

  const mutation = useMutation({
    mutationFn: (body) => apiPatch(`/reservations/${reservation.id}`, body),
    onSuccess: (updated) => {
      toastSuccess(t('reservations.edit.saved'));
      onSaved(updated);
    },
    onError: (error) => {
      if (error.code === 'PRICE_DECISION_REQUIRED') {
        setDecisionRequired(true);
        return;
      }
      if (error.fields && Object.keys(error.fields).length) {
        setErrors(error.fields);
        return;
      }
      onError(error);
      if (error.code === 'STALE_WRITE') onClose();
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: reservation.updatedAt, ...changes() };
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    const result = validateWith(updateReservationSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const busy = mutation.isPending;
  const currency = reservation.currency;
  const promotion = reservation.promotion;
  // Acente satışında ve elle fiyatta indirim yoktur: kupon alanı gizli, mevcut indirimin kalkacağı söylenir.
  const discountClosed = Boolean(agency) || priceMode === 'MANUAL';
  return (
    <Modal
      open
      size="lg"
      title={t('reservations.edit.title', { code: reservation.confirmationCode })}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="edit-reservation-form" icon="check" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="edit-reservation-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {inHouse && (
          <Alert tone="info" title={t('reservations.detail.inHouseTitle')}>
            {t('reservations.edit.inHouseHint')}
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Input label={t('reservations.form.checkIn')} type="date" min={inHouse ? undefined : today} value={form.checkIn} onChange={set('checkIn')} disabled={busy || inHouse} error={errors.checkIn} className="w-full sm:w-44" />
          <Input label={t('reservations.form.checkOut')} type="date" min={addDaysIso(form.checkIn || today, 1)} value={form.checkOut} onChange={set('checkOut')} disabled={busy} error={errors.checkOut} className="w-full sm:w-44" />
          <Select label={t('reservations.form.roomType')} value={form.roomTypeId} onChange={set('roomTypeId')} options={roomTypeOptions} disabled={busy || inHouse} error={errors.roomTypeId} className="w-full sm:w-64" />
        </div>
        {(!inHouse || agency) && (
          <div className="flex flex-col gap-2">
            <AgencyPicker value={agency} onChange={setAgency} error={errors.agencyId} disabled={busy || inHouse} label={t('reservations.form.agencyOptional')} />
            {agencyChanged && (
              <p className="text-xs text-ink-muted">
                {agency
                  ? t('reservations.edit.agencySet')
                  : t('reservations.edit.agencyRemoved')}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Input label={t('reservations.form.adults')} type="number" min={1} max={20} value={form.adults} onChange={set('adults')} disabled={busy} error={errors.adults} className="w-28" />
          <Input label={t('reservations.form.children')} type="number" min={0} max={20} value={form.children} onChange={set('children')} disabled={busy} error={errors.children} className="w-28" />
          <Select label={t('reservations.form.board')} value={form.boardType} onChange={set('boardType')} options={boardOptions} disabled={busy} className="w-full sm:w-64" />
        </div>

        {availabilityNeeded && stayValid && (
          <div className="rounded-item border border-line bg-canvas p-3 text-sm">
            {quote.isPending && t('reservations.form.checkingAvailability')}
            {quote.isError && <span className="text-sec-strong">{quote.error.message}</span>}
            {typeQuote && (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={typeQuote.available > 0 ? 'success' : 'danger'}>
                  {typeQuote.available > 0
                    ? t(stayChanged ? 'reservations.edit.availableNew' : 'reservations.edit.availableSame', { count: typeQuote.available })
                    : t(stayChanged ? 'reservations.edit.noAvailabilityNew' : 'reservations.edit.noAvailabilitySame')}
                </Badge>
                {typeQuote.agency && !typeQuote.agency.sellable && (
                  <span className="font-semibold text-sec-strong">{agencyIssueText(typeQuote.agency.issue, canOverridePrice)}</span>
                )}
                {reservation.room && <span className="text-ink-muted">· {t('reservations.edit.roomMayUnassign')}</span>}
              </span>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">{t('reservations.edit.discount')}</legend>
          {promotion ? (
            <div className={`flex flex-wrap items-center justify-between gap-2 rounded-item border p-2.5 text-sm ${discount?.mode === 'REMOVE' ? 'border-line opacity-60' : 'border-line-strong'}`}>
              <span className="min-w-0">
                <span className="font-semibold text-ink">{promotion.name}</span>
                {promotion.couponCode && <span className="ml-2 font-mono text-xs text-ink-muted">{t('reservations.edit.coupon', { code: promotion.couponCode })}</span>}
                <span className="ml-2 text-success-ink">−{formatMoney(reservation.discountTotal, currency)}</span>
              </span>
              {!discountClosed &&
                (discount?.mode === 'REMOVE' ? (
                  <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setDiscount(null)} disabled={busy}>{t('common.cancel')}</Button>
                ) : (
                  <Button size="sm" variant="outline" icon="close" onClick={() => setDiscount({ mode: 'REMOVE' })} disabled={busy}>{t('reservations.edit.removeDiscount')}</Button>
                ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">{t('reservations.edit.noDiscount')}</p>
          )}
          {discountClosed ? (
            promotion && (
              <p className="text-xs text-warning-ink">
                {agency ? t('reservations.edit.agencyNoPromotion') : t('reservations.edit.manualNoPromotion')}
              </p>
            )
          ) : (
            discount?.mode !== 'REMOVE' && (
              <CouponField
                value={discount?.mode === 'COUPON' ? discount.code : null}
                onChange={(code) => {
                  setDiscount(code ? { mode: 'COUPON', code } : null);
                  setErrors((current) => ({ ...current, 'discount.code': undefined }));
                }}
                coupon={
                  plan?.discount && ['APPLIED', 'REPLACED'].includes(plan.discount.outcome)
                    ? { status: 'APPLIED', issue: null, promotion: plan.after.promotion, remainingUses: null }
                    : null
                }
                checking={discount?.mode === 'COUPON' && preview.isFetching}
                error={couponError}
                disabled={busy}
                label={promotion ? t('reservations.edit.couponReplace') : t('reservations.edit.addCoupon')}
              />
            )
          )}
        </fieldset>

        {priceChanges && (
          <div className="rounded-item border border-line bg-canvas p-3 text-sm" aria-live="polite">
            {preview.isFetching && !plan && t('reservations.edit.calculating')}
            {preview.isError && !previewFieldErrors['discount.code'] && <span className="text-sec-strong">{preview.error.message}</span>}
            {plan && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{t('reservations.edit.newTotal')}</span>
                  <span className="text-lg font-bold">{formatMoney(plan.after.total, currency)}</span>
                </div>
                <p className="text-xs text-ink-muted">
                  {t('reservations.edit.currentTotal', { amount: formatMoney(plan.before.total, currency) })}
                  {plan.after.discountTotal !== '0.00' &&
                    ` · ${t('reservations.edit.discountAmount', { amount: formatMoney(plan.after.discountTotal, currency) })}${plan.after.promotion ? ` (${plan.after.promotion.name})` : ''}`}
                </p>
                {plan.discount && (
                  <Alert tone={OUTCOME_TONES[plan.discount.outcome] ?? 'info'} title={t('reservations.edit.discount')}>
                    {plan.discount.message}
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">{t('reservations.detail.priceCard')}</legend>
          {decisionRequired && (
            <Alert tone="warning" title={t('reservations.edit.decisionTitle')}>
              {t('reservations.edit.decisionText')}
            </Alert>
          )}
          <PriceOption checked={priceMode === 'KEEP'} onChange={() => setPriceMode('KEEP')} disabled={busy} label={t('reservations.edit.keepPrice')} hint={agencyChanged || (agency && boardChanged) ? t('reservations.edit.keepPriceAgencyHint') : t('reservations.edit.keepPriceHint')} />
          <PriceOption checked={priceMode === 'CALCULATED'} onChange={() => setPriceMode('CALCULATED')} disabled={busy} label={agency ? t('reservations.edit.recalcContract') : t('reservations.edit.recalcSystem')} hint={inHouse ? t('reservations.edit.recalcInHouseHint') : agency ? t('reservations.edit.recalcContractHint', { agency: agency.name }) : t('reservations.edit.recalcSystemHint')} />
          {canOverridePrice && (
            <PriceOption checked={priceMode === 'MANUAL'} onChange={() => setPriceMode('MANUAL')} disabled={busy} label={t('reservations.edit.manualPrice')} hint={t('reservations.edit.manualPriceHint')} />
          )}
          {priceMode === 'MANUAL' && (
            <div className="flex flex-wrap gap-3 pl-6">
              <Input label={t('reservations.form.totalWithCurrency', { currency: reservation.currency })} inputMode="decimal" value={manual.total} onChange={(e) => setManual((c) => ({ ...c, total: e.target.value }))} error={errors['price.total']} disabled={busy} className="w-40" />
              <Input label={t('reservations.form.justification')} value={manual.note} onChange={(e) => setManual((c) => ({ ...c, note: e.target.value }))} error={errors['price.note']} disabled={busy} className="w-full sm:w-72" />
            </div>
          )}
        </fieldset>

        <Textarea label={t('reservations.form.notes')} rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} disabled={busy} error={errors.notes} />
      </form>
    </Modal>
  );
}

/** @param {{ checked: boolean, onChange: () => void, disabled: boolean, label: string, hint: string }} props */
function PriceOption({ checked, onChange, disabled, label, hint }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-item border p-2.5 ${checked ? 'border-ink' : 'border-line'}`}>
      <input type="radio" name="price-mode" className="mt-1" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}
