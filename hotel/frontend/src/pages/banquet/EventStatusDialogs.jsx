import { useState } from 'react';
import { MAX_EVENT_PAX, MAX_EVENT_REASON_LENGTH, cancelEventSchema, completeEventSchema, tentativeEventSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { dayText, shiftDay, useBanquetSettings } from '../../lib/banquet.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';

/**
 * Etkinlik durum diyalogları (modül 37). Mutasyonu sayfa yapar; diyalog girdiyi
 * sözleşmenin şemasıyla doğrular, sunucunun ek kuralını (opsiyon günü ilk oturum
 * gününü geçmez) önceden söyler.
 */

/** @param {{ title: string, busy: boolean, formId: string, confirmLabel: string, confirmIcon?: string, confirmVariant?: string, onClose: () => void, children: React.ReactNode }} props */
function DialogFrame({ title, busy, formId, confirmLabel, confirmIcon = 'check', confirmVariant = 'primary', onClose, children }) {
  return (
    <Modal
      open
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
      {children}
    </Modal>
  );
}

/**
 * Opsiyona alma / uzatma: son gün (dahil). Varsayılan politika süresi; ilk oturum
 * gününü geçemez.
 * @param {{ event: any, busy: boolean, onConfirm: (body: { optionUntil: string }) => void, onClose: () => void }} props
 */
export function TentativeDialog({ event, busy, onConfirm, onClose }) {
  const { today } = useHotelToday();
  const settings = useBanquetSettings();
  const firstDay = event.firstStartLocal?.slice(0, 10) ?? null;
  const suggested = event.optionUntil ?? (() => {
    const byPolicy = shiftDay(today, settings.data?.optionDays ?? 7);
    return firstDay && firstDay < byPolicy ? firstDay : byPolicy;
  })();
  const [optionUntil, setOptionUntil] = useState(suggested);
  const [error, setError] = useState(null);
  const extending = event.status === 'TENTATIVE';

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const checked = validateWith(tentativeEventSchema, { expectedUpdatedAt: event.updatedAt, optionUntil });
    if (!checked.ok) return setError(checked.errors.optionUntil ?? 'Tarih geçersiz');
    if (optionUntil < today) return setError('Opsiyon tarihi geçmiş olamaz');
    if (firstDay && optionUntil > firstDay) return setError(`Opsiyon en geç ilk oturum günü (${dayText(firstDay)}) olabilir`);
    setError(null);
    onConfirm({ optionUntil });
  }

  return (
    <DialogFrame title={extending ? 'Opsiyonu uzat' : 'Opsiyonla'} busy={busy} formId="event-tentative-form" confirmLabel={extending ? 'Uzat' : 'Opsiyonla'} confirmIcon="clock" onClose={onClose}>
      <form id="event-tentative-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!event.sessions.length ? (
          <Alert tone="warning" title="Program boş">
            Opsiyon salon tutar: önce programa salon ve saat ekleyin.
          </Alert>
        ) : (
          <p className="text-sm text-ink-soft">
            {extending
              ? 'Opsiyonun son günü değişir; sıradaki yeriniz korunur.'
              : 'Programdaki salonlar opsiyonla tutulur. Aynı saatte önce opsiyon alan varsa sıraya girersiniz (1. opsiyon kesinleştirebilir).'}{' '}
            Son gün geçince opsiyon kendiliğinden düşer.
          </p>
        )}
        <Input
          label="Opsiyonun son günü"
          name="option-until"
          type="date"
          value={optionUntil}
          min={today}
          max={firstDay ?? undefined}
          onChange={(changeEvent) => setOptionUntil(changeEvent.target.value)}
          error={error ?? undefined}
          disabled={busy || !event.sessions.length}
          required
        />
      </form>
    </DialogFrame>
  );
}

/**
 * Kesinleştirme: ön koşulları listeler; sunucu kilit altında yeniden denetler.
 * @param {{ event: any, busy: boolean, onConfirm: () => void, onClose: () => void }} props
 */
export function ConfirmEventDialog({ event, busy, onConfirm, onClose }) {
  const checks = [
    { ok: event.sessions.length > 0, text: 'Programda en az bir oturum (salon ve saat)' },
    { ok: event.items.length > 0, text: 'Fiyat kalemleri girildi' },
    ...(event.requireSignedContract ? [{ ok: event.contractSigned, text: 'Güncel sözleşme imzalı (banket politikası)' }] : []),
    { ok: event.status !== 'TENTATIVE' || event.optionRank === 1, text: event.status === 'TENTATIVE' ? `Salonda 1. opsiyon (şu an ${event.optionRank}.)` : 'Salonda önde kimse yok (kilit altında denetlenir)' },
    { ok: event.equipmentShortages.length === 0, text: 'Ekipman stoğu yetiyor' },
  ];
  const blocked = checks.some((check) => !check.ok);
  return (
    <DialogFrame
      title="Etkinliği kesinleştir"
      busy={busy}
      formId="event-confirm-form"
      confirmLabel="Kesinleştir"
      confirmIcon="checkCircle"
      onClose={onClose}
    >
      <form
        id="event-confirm-form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (!blocked) onConfirm();
        }}
        className="flex flex-col gap-4"
      >
        <ul className="flex flex-col gap-2 text-sm">
          {checks.map((check) => (
            <li key={check.text} className="flex items-start gap-2">
              <Icon name={check.ok ? 'checkCircle' : 'alertCircle'} className={`mt-0.5 size-4 shrink-0 ${check.ok ? 'text-success-ink' : 'text-sec-strong'}`} />
              <span className={check.ok ? 'text-ink' : 'font-semibold text-sec-strong'}>{check.text}</span>
            </li>
          ))}
        </ul>
        {blocked ? (
          <Alert tone="warning" title="Kesinleşemez">
            Eksik koşulları tamamlayın.
          </Alert>
        ) : (
          <p className="text-sm text-ink-soft">
            Salonlar kesin olarak tutulur (aynı saate ikinci kesin olamaz), iptal kademeleri dosyaya kopyalanır; aynı saatte opsiyonu olanlara haber gider.
          </p>
        )}
      </form>
    </DialogFrame>
  );
}

/**
 * Gerçekleşti: gerçekleşen kişi. Kişi başı kalemler en çok (garanti, gerçekleşen) ile faturalanır.
 * @param {{ event: any, busy: boolean, onConfirm: (body: { actualPax: string }) => void, onClose: () => void }} props
 */
export function CompleteDialog({ event, busy, onConfirm, onClose }) {
  const [actualPax, setActualPax] = useState(String(event.guaranteedPax ?? event.expectedPax));
  const [error, setError] = useState(null);
  const billable = Math.max(event.guaranteedPax ?? 0, Number(actualPax) || 0);

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const checked = validateWith(completeEventSchema, { expectedUpdatedAt: event.updatedAt, actualPax });
    if (!checked.ok) return setError(checked.errors.actualPax ?? 'Kişi sayısı geçersiz');
    setError(null);
    onConfirm({ actualPax });
  }

  return (
    <DialogFrame title="Etkinlik gerçekleşti" busy={busy} formId="event-complete-form" confirmLabel="Gerçekleşti" confirmIcon="checkCheck" onClose={onClose}>
      <form id="event-complete-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Gerçekleşen kişi" name="actual-pax" type="number" min={0} max={MAX_EVENT_PAX} value={actualPax} onChange={(changeEvent) => setActualPax(changeEvent.target.value)} error={error ?? undefined} disabled={busy} required />
        <p className="text-sm text-ink-soft">
          Faturalanacak kişi: <strong>{billable.toLocaleString('tr-TR')}</strong>
          {event.guaranteedPax ? ` (garanti ${event.guaranteedPax} altına düşülmez)` : ''}. Toplam yeniden hesaplanır; dosya faturaya hazır olur, proforma üretilebilir.
        </p>
      </form>
    </DialogFrame>
  );
}

/**
 * Gerekçeli durum işlemi: iptal, kaybedildi, opsiyonu bırak.
 * @param {{ title: string, intro: React.ReactNode, label: string, confirmLabel: string, busy: boolean, onConfirm: (body: { reason: string }) => void, onClose: () => void }} props
 */
export function EventReasonDialog({ title, intro, label, confirmLabel, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const formId = `event-reason-${title.replace(/\W+/g, '-')}`;

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const checked = validateWith(cancelEventSchema, { expectedUpdatedAt: new Date().toISOString(), reason });
    if (!checked.ok) return setError(checked.errors.reason ?? 'Gerekçe geçersiz');
    setError(null);
    onConfirm({ reason });
  }

  return (
    <DialogFrame title={title} busy={busy} formId={formId} confirmLabel={confirmLabel} confirmIcon="close" confirmVariant="danger" onClose={onClose}>
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="text-sm text-ink-soft">{intro}</div>
        <Textarea label={label} name={`${formId}-reason`} rows={3} maxLength={MAX_EVENT_REASON_LENGTH} value={reason} onChange={(changeEvent) => setReason(changeEvent.target.value)} error={error ?? undefined} disabled={busy} required />
      </form>
    </DialogFrame>
  );
}
