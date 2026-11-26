import { useState } from 'react';
import { FOLIO_DISCOUNT_CATEGORIES, FOLIO_ITEM_TYPE_LABELS, loyaltyRedeemSchema, pointsValue } from '@hotelos/hotel-contracts';
import { Input, Select } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { folioKeys } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { pointsText } from '../../lib/loyalty.js';
import { newRequestId } from '../../lib/reservations.js';
import { LoyaltyFormDialog, useLoyaltySubmit } from './LoyaltyFormDialog.jsx';

const CATEGORY_OPTIONS = FOLIO_DISCOUNT_CATEGORIES.map((value) => ({ value, label: FOLIO_ITEM_TYPE_LABELS[value] ?? value }));

/**
 * Puan kullan (modül 56, `loyalty.redeem`): konaklamanın açık folyosuna puan × puan değeri tutarında indirim kalemi.
 * İstek kimliği pencere açılırken üretilir: çift tıklama / yeniden deneme ikinci indirim yazmaz.
 * @param {{
 *   reservationId: string, folio: { id: string, window: number, chargesTotal: string, maxPoints: number, maxAmount: string },
 *   program: { pointValue: string, minRedeemPoints: number, maxRedeemPct: number }, balance: number, currency: string, onClose: () => void,
 * }} props
 */
export function RedeemDialog({ reservationId, folio, program, balance, currency, onClose }) {
  const [requestId] = useState(newRequestId);
  const [values, setValues] = useState({ points: String(folio.maxPoints), category: 'ROOM' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const points = Math.trunc(Number(values.points.replace(/\D/g, ''))) || 0;
  const tooMany = points > folio.maxPoints;
  const tooFew = points > 0 && points < program.minRedeemPoints;
  const { submit, errors, serverError, busy } = useLoyaltySubmit({
    schema: loyaltyRedeemSchema,
    request: (body) => apiPost(`/loyalty/reservations/${reservationId}/redeem`, body),
    success: (result) => (result.created === false ? 'Bu kullanım zaten işlenmişti' : `${pointsText(points)} kullanıldı; folyoya ${formatMoney(pointsValue(points, program.pointValue), currency)} indirim`),
    invalidate: [folioKeys.all],
    onClose,
  });
  const pointsError = errors.points ?? (tooMany ? `Bu folyoda en çok ${pointsText(folio.maxPoints)}` : tooFew ? `En az ${pointsText(program.minRedeemPoints)}` : undefined);

  return (
    <LoyaltyFormDialog title={`Puan kullan: folyo ${folio.window}`} formId="loyalty-redeem-form" busy={busy} onClose={onClose} submitLabel="İndirimi işle" submitIcon="star" serverError={serverError} submitDisabled={points <= 0 || tooMany || tooFew}>
      <form
        id="loyalty-redeem-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ requestId, points, category: values.category, folioId: folio.id });
        }}
      >
        <Input label="Puan" name="loyalty-redeem-points" inputMode="numeric" value={values.points} onChange={set('points')} error={pointsError} disabled={busy} />
        <Select label="Gelir türü" name="loyalty-redeem-category" options={CATEGORY_OPTIONS} value={values.category} onChange={set('category')} error={errors.category} disabled={busy} />
        <p className="rounded-item bg-surface-muted px-3 py-2 text-sm text-ink-soft sm:col-span-2">
          İndirim: <span className="font-bold tabular-nums text-ink">{formatMoney(pointsValue(points, program.pointValue), currency)}</span>
        </p>
        <p className="text-xs text-ink-muted sm:col-span-2">
          Bakiye {pointsText(balance)} · folyo harcaması {formatMoney(folio.chargesTotal, currency)} · en çok %{program.maxRedeemPct} ({pointsText(folio.maxPoints)}, {formatMoney(folio.maxAmount, currency)}) · en az {pointsText(program.minRedeemPoints)}. İndirim kalemi iptal edilirse puan iade edilir.
        </p>
      </form>
    </LoyaltyFormDialog>
  );
}
