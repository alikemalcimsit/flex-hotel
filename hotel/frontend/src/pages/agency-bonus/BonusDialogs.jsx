import { useState } from 'react';
import {
  MAX_BONUS_REASON_LENGTH,
  MAX_PAYMENT_REF_LENGTH,
  cancelAgencyBonusRuleSchema,
  markAgencyBonusPaidSchema,
  submitAgencyBonusSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';

/**
 * Acente primi (modül 35) diyalogları. Mutasyonu çağıran sayfa yapar; diyalog
 * yalnızca girdiyi toplar ve sözleşmenin şemasıyla doğrular (sunucuyla aynı
 * kural). Sunucu hatası alanın altına bağlanır (`error.fields`).
 */

/**
 * Gerekçeli işlem: kural iptali, hak edişi yeniden açma, ödeme işaretini geri alma.
 *
 * @param {{
 *   open: boolean, title: string, intro: React.ReactNode, label: string, confirmLabel: string,
 *   confirmVariant?: 'danger' | 'primary', confirmIcon?: string, version: string,
 *   busy: boolean, serverErrors?: Record<string, string>, onConfirm: (body: { expectedUpdatedAt: string, reason: string }) => void, onClose: () => void,
 * }} props
 */
export function ReasonDialog({ open, title, intro, label, confirmLabel, confirmVariant = 'danger', confirmIcon = 'check', version, busy, serverErrors = {}, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const formId = `reason-${title.replace(/\W+/g, '-')}`;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: version, reason };
    // İptal / yeniden açma / ödeme geri alma: hepsinin gerekçe kuralı aynı (5–300 karakter).
    const checked = validateWith(cancelAgencyBonusRuleSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    onConfirm(body);
  }

  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} variant={confirmVariant} icon={confirmIcon} disabled={busy}>
            {busy ? 'İşleniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="text-sm text-ink-soft">{intro}</div>
        <Textarea
          label={label}
          name={`${formId}-reason`}
          rows={3}
          maxLength={MAX_BONUS_REASON_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason ?? serverErrors.reason}
          disabled={busy}
          required
        />
      </form>
    </Modal>
  );
}

/**
 * Hak edişi onaya gönderir (not isteğe bağlı). Prim sıfırsa onaya gitmez,
 * doğrudan kapanır — diyalog bunu söyler.
 *
 * @param {{ open: boolean, bonus: any, busy: boolean, onConfirm: (body: { expectedUpdatedAt: string, note: string | null }) => void, onClose: () => void }} props
 */
export function SubmitDialog({ open, bonus, busy, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const zero = Number(bonus.amount) <= 0;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: bonus.updatedAt, note: note.trim() || null };
    const checked = validateWith(submitAgencyBonusSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    onConfirm(body);
  }

  return (
    <Modal
      open={open}
      size="sm"
      title={zero ? 'Hak edişi kapat' : 'Onaya gönder'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="bonus-submit-form" icon={zero ? 'check' : 'send'} disabled={busy}>
            {busy ? 'Gönderiliyor…' : zero ? 'Kapat (prim yok)' : 'Onaya gönder'}
          </Button>
        </>
      }
    >
      <form id="bonus-submit-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {zero ? (
          <Alert tone="info" title="Prim doğmadı">
            Acente kademeye ulaşmadı; ödenecek prim yok. Hak ediş onay kuyruğuna gitmeden &quot;onaylandı (prim yok)&quot; olarak kapanır.
          </Alert>
        ) : (
          <Alert tone="info" title={`${formatMoney(bonus.amount, bonus.currency)} onaya gidecek`}>
            Onay kuyruğuna düşer; siz onaylayamazsınız (dört göz), başka bir yetkili onaylar. Onay bir hafta içinde verilmezse düşer ve hak ediş yeniden gönderilir.
          </Alert>
        )}
        <Textarea
          label="Not (isteğe bağlı)"
          name="bonus-submit-note"
          rows={2}
          maxLength={MAX_BONUS_REASON_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={errors.note}
          disabled={busy}
        />
      </form>
    </Modal>
  );
}

/**
 * Onaylı hak edişi ödendi işaretler: ödeme günü (iş gününden sonra ve onay
 * gününden önce olamaz), belge / dekont numarası, not.
 *
 * @param {{ open: boolean, bonus: any, today: string, busy: boolean, serverErrors?: Record<string, string>, onConfirm: (body: object) => void, onClose: () => void }} props
 */
export function PayDialog({ open, bonus, today, busy, serverErrors = {}, onConfirm, onClose }) {
  const [values, setValues] = useState({ paidAt: today, paymentRef: '', note: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const approvedDay = bonus.approvedAt ? bonus.approvedAt.slice(0, 10) : undefined;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: bonus.updatedAt, paidAt: values.paidAt, paymentRef: values.paymentRef, note: values.note.trim() || null };
    const checked = validateWith(markAgencyBonusPaidSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (today && values.paidAt > today) {
      setErrors({ paidAt: 'Ödeme tarihi ileri bir gün olamaz' });
      return;
    }
    setErrors({});
    onConfirm(body);
  }

  return (
    <Modal
      open={open}
      size="sm"
      title="Ödendi işaretle"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="bonus-pay-form" icon="banknote" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Ödendi'}
          </Button>
        </>
      }
    >
      <form id="bonus-pay-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">{formatMoney(bonus.amount, bonus.currency)}</strong> · {bonus.agency.name}. Kayıt yalnızca işarettir; acente carisinden düşüm ön muhasebe modülüyle bağlanacak.
        </p>
        <Input label="Ödeme günü" name="bonus-paid-at" type="date" value={values.paidAt} min={approvedDay} max={today} onChange={set('paidAt')} error={errors.paidAt ?? serverErrors.paidAt} disabled={busy} required />
        <Input
          label="Belge / dekont no"
          name="bonus-payment-ref"
          value={values.paymentRef}
          maxLength={MAX_PAYMENT_REF_LENGTH}
          onChange={set('paymentRef')}
          error={errors.paymentRef ?? serverErrors.paymentRef}
          placeholder="Ör. DK-2027-118"
          disabled={busy}
          required
        />
        <Textarea label="Not (isteğe bağlı)" name="bonus-payment-note" rows={2} maxLength={MAX_BONUS_REASON_LENGTH} value={values.note} onChange={set('note')} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
