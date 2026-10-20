import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { openPosShiftSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { posKeys, shiftPath, timeText, useCurrentShift } from '../../lib/pos.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Garsonun vardiya çubuğu (modül 39): vardiya yoksa "vardiya aç" (kasa avansıyla); varsa
 * açılış saati, avans, beklenen nakit, açık adisyon ve onay bekleyenler, kapanış bağlantısı.
 * Vardiyasız garson adisyon açamaz, ödeme alamaz (sunucu da reddeder).
 *
 * @param {{ outlets: Array<{ id: string, name: string }>, currency: string }} props
 */
export function ShiftBar({ outlets, currency }) {
  const query = useCurrentShift();
  const [opening, setOpening] = useState(false);
  if (query.isPending) return <Spinner className="py-2" />;
  if (query.isError) {
    return (
      <Alert tone="danger" title="Vardiya okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const shift = query.data.shift;
  if (!shift) {
    return (
      <>
        <Alert
          tone="warning"
          title="Vardiyanız kapalı"
          action={
            <Button type="button" size="sm" icon="play" onClick={() => setOpening(true)}>
              Vardiya aç
            </Button>
          }
        >
          Adisyon açmak ve ödeme almak için kasa avansıyla vardiya açın. Aldığınız nakit vardiyanızın kasasına yazılır; kapanışta sayılır.
        </Alert>
        {opening && <OpenShiftDialog outlets={outlets} currency={currency} onClose={() => setOpening(false)} />}
      </>
    );
  }
  const waiting = shift.blockers.pendingPayments + shift.blockers.pendingVoids;
  return (
    <section aria-label="Vardiyam" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm shadow-soft">
      <span className="flex items-center gap-2 font-semibold text-ink">
        <Icon name="clock" className="size-4 text-info-ink" />
        Vardiyam · açılış {timeText(shift.openedAt)}
        {shift.outletName && <span className="text-ink-muted">· {shift.outletName}</span>}
      </span>
      <span className="text-ink-soft">
        Avans <strong className="tabular-nums text-ink">{formatMoney(shift.openingFloat, currency)}</strong>
      </span>
      <span className="text-ink-soft">
        Kasada olması gereken <strong className="tabular-nums text-ink">{formatMoney(shift.cash.expectedCash, currency)}</strong>
      </span>
      <span className="text-ink-soft">
        Açık adisyon <strong className="tabular-nums text-ink">{shift.blockers.openChecks}</strong>
      </span>
      {waiting > 0 && <span className="font-semibold text-warning-ink">{waiting} ödeme onay bekliyor</span>}
      <Link to={shiftPath(shift.id)} className="ml-auto font-semibold text-info-ink underline-offset-2 hover:underline">
        Vardiya ve kapanış
      </Link>
    </section>
  );
}

/**
 * Vardiya aç: kasa avansı (bozuk para; sıfır olabilir) ve isteğe bağlı satış noktası.
 * @param {{ outlets: Array<{ id: string, name: string }>, currency: string, onClose: () => void }} props
 */
function OpenShiftDialog({ outlets, currency, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ openingFloat: '', outletId: outlets.length === 1 ? outlets[0].id : '' });
  const [errors, setErrors] = useState({});
  const open = useMutation({
    mutationFn: (body) => apiPost('/pos/shifts', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastSuccess('Vardiya açıldı');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'SHIFT_OPEN') queryClient.invalidateQueries({ queryKey: posKeys.currentShift });
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { openingFloat: values.openingFloat, outletId: values.outletId || null };
    const checked = validateWith(openPosShiftSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    open.mutate(body);
  }

  const busy = open.isPending;
  return (
    <Modal
      open
      size="sm"
      title="Vardiya aç"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="pos-open-shift" icon="play" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Vardiyayı aç'}
          </Button>
        </>
      }
    >
      <form id="pos-open-shift" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label={`Kasa avansı (${currency})`}
          name="pos-opening-float"
          inputMode="decimal"
          value={values.openingFloat}
          onChange={(event) => setValues((current) => ({ ...current, openingFloat: event.target.value }))}
          error={errors.openingFloat}
          placeholder="Çekmecedeki bozuk para; yoksa 0"
          required
          disabled={busy}
        />
        {outlets.length > 1 && (
          <Select
            label="Satış noktası (isteğe bağlı)"
            value={values.outletId}
            onChange={(event) => setValues((current) => ({ ...current, outletId: event.target.value }))}
            options={[{ value: '', label: 'Hepsi' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
            error={errors.outletId}
            disabled={busy}
          />
        )}
      </form>
    </Modal>
  );
}
