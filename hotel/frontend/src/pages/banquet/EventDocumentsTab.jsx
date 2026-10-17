import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EVENT_DOCUMENT_KIND_LABELS, EVENT_DOCUMENT_STATUS_LABELS, decideEventDocumentSchema, issueEventDocumentSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiBlob, apiPost } from '../../lib/api.js';
import { DOCUMENT_STATUS_TONES, banquetKeys, dayText } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';

/** Hangi durumda hangi belge üretilebilir (sunucu aynı kuralı denetler: `documentIssueError`). */
const ISSUABLE = Object.freeze({
  OFFER: ['INQUIRY', 'TENTATIVE'],
  CONTRACT: ['INQUIRY', 'TENTATIVE', 'DEFINITE'],
  PROFORMA: ['COMPLETED', 'CANCELLED'],
});

const DECISIONS = Object.freeze({
  OFFER: [
    { decision: 'ACCEPTED', label: 'Kabul edildi', icon: 'checkCircle' },
    { decision: 'DECLINED', label: 'Reddedildi', icon: 'close' },
  ],
  CONTRACT: [{ decision: 'SIGNED', label: 'İmzalandı', icon: 'pencil' }],
  PROFORMA: [],
});

/**
 * Belgeler (modül 37): teklif → sözleşme → proforma. Her tür yeni sürümle
 * güncellenir (öncekisi "yenisiyle değişti"); PDF üretildiği anın görüntüsüdür.
 * Teklif kabul / ret, sözleşme imza tarihiyle işaretlenir.
 *
 * @param {{ event: any, canManage: boolean }} props
 */
export function EventDocumentsTab({ event, canManage }) {
  const queryClient = useQueryClient();
  const [issuing, setIssuing] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [opening, setOpening] = useState(null);
  const ready = event.sessions.length > 0 && event.items.length > 0;
  const proformaAllowed = event.status === 'COMPLETED' || (event.status === 'CANCELLED' && Number(event.cancellationFee) > 0);
  const can = (kind) => canManage && ISSUABLE[kind].includes(event.status) && (kind === 'PROFORMA' ? proformaAllowed : ready);

  async function open(document) {
    setOpening(document.id);
    // Sekme tıklamayla açılır (açılır pencere engeline takılmasın); PDF gelince adresi verilir.
    const tab = window.open('', '_blank');
    try {
      const blob = await apiBlob(`/banquet/events/${event.id}/documents/${document.id}/file`);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else {
        // Açılır pencere engellendi: uygulamadan çıkmadan dosya indirilir.
        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${document.kindLabel}-${document.number.replace(/\//g, '-')}.pdf`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      toastError(error.message);
    } finally {
      setOpening(null);
    }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: banquetKeys.all });
  return (
    <Card
      title="Belgeler"
      description="Teklif ve sözleşme müşteriye gider; proforma faturaya hazır dosyanın tutarıdır (resmî fatura fatura modülünde)."
      actions={
        canManage && (
          <div className="flex flex-wrap gap-2">
            {['OFFER', 'CONTRACT', 'PROFORMA'].map((kind) => (
              <Button key={kind} type="button" size="sm" variant={kind === 'CONTRACT' && event.status !== 'INQUIRY' ? 'primary' : 'outline'} icon="fileText" onClick={() => setIssuing(kind)} disabled={!can(kind)}>
                {EVENT_DOCUMENT_KIND_LABELS[kind]} üret
              </Button>
            ))}
          </div>
        )
      }
    >
      {canManage && !ready && ['INQUIRY', 'TENTATIVE', 'DEFINITE'].includes(event.status) && (
        <Alert tone="info" title="Belge için program ve kalem gerekli" className="mb-3">
          Teklif ve sözleşme, programdaki oturumlar ve fiyat kalemlerinden üretilir.
        </Alert>
      )}
      {event.documents.length === 0 ? (
        <EmptyState icon="fileText" title="Belge yok" description="Teklif üretip müşteriye gönderin; kabulden sonra sözleşme." />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Belge</th>
                <th scope="col" className="px-3 py-2 font-bold">Durum</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
                <th scope="col" className="px-3 py-2 font-bold">Üreten</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">İşlemler</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {event.documents.map((document) => {
                const current = document.status !== 'SUPERSEDED';
                return (
                  <tr key={document.id} className={current ? '' : 'text-ink-muted'}>
                    <td className="px-3 py-2">
                      <span className="block font-semibold">
                        {document.kindLabel} <span className="font-mono text-xs">{document.number}</span>
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {new Date(document.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                        {document.validUntil ? ` · geçerli ${dayText(document.validUntil)}` : ''}
                      </span>
                      {document.note && <span className="block text-xs text-ink-muted">{document.note}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={DOCUMENT_STATUS_TONES[document.status]}>{EVENT_DOCUMENT_STATUS_LABELS[document.status]}</Badge>
                      {document.decisionDate && (
                        <span className="block text-xs text-ink-muted">
                          {dayText(document.decisionDate)} · {document.decidedBy}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(document.grandTotal, event.currency)}</td>
                    <td className="px-3 py-2 text-xs">{document.issuedBy}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button type="button" size="sm" variant="ghost" icon="download" onClick={() => open(document)} disabled={opening === document.id}>
                        {opening === document.id ? 'Açılıyor…' : 'PDF'}
                      </Button>
                      {canManage &&
                        current &&
                        document.status === 'ISSUED' &&
                        DECISIONS[document.kind].map((entry) => (
                          <Button key={entry.decision} type="button" size="sm" variant="ghost" icon={entry.icon} onClick={() => setDeciding({ document, ...entry })}>
                            {entry.label}
                          </Button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {issuing && (
        <IssueDialog
          event={event}
          kind={issuing}
          onClose={() => setIssuing(null)}
          onDone={(document) => {
            setIssuing(null);
            refresh();
            toastSuccess(`${document.kindLabel} ${document.number} üretildi`);
            open(document);
          }}
        />
      )}
      {deciding && (
        <DecisionDialog
          event={event}
          choice={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            refresh();
            toastSuccess(`${deciding.document.kindLabel} ${deciding.label.toLocaleLowerCase('tr')} olarak işaretlendi`);
          }}
        />
      )}
    </Card>
  );
}

/** @param {{ event: any, kind: string, onClose: () => void, onDone: (document: any) => void }} props */
function IssueDialog({ event, kind, onClose, onDone }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const current = event.documents.find((document) => document.kind === kind && document.status !== 'SUPERSEDED');
  const issue = useMutation({
    mutationFn: (body) => apiPost(`/banquet/events/${event.id}/documents`, body),
    onSuccess: onDone,
    onError: (failure) => {
      if (failure.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.event(event.id) });
      setError(failure.fields?.note ?? null);
      toastError(failure.code === 'STALE_WRITE' ? 'Dosya bu arada değişti; ekran yenilendi, belgeyi güncel haliyle yeniden üretin.' : failure.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { expectedUpdatedAt: event.updatedAt, kind, note };
    const checked = validateWith(issueEventDocumentSchema, body);
    if (!checked.ok) return setError(checked.errors.note ?? 'Geçersiz');
    issue.mutate(body);
  }

  const busy = issue.isPending;
  return (
    <Modal
      open
      size="sm"
      title={`${EVENT_DOCUMENT_KIND_LABELS[kind]} üret`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-issue-form" icon="fileText" disabled={busy}>
            {busy ? 'Üretiliyor…' : 'Üret'}
          </Button>
        </>
      }
    >
      <form id="event-issue-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Belge şu anki dosyadan üretilir: {formatMoney(event.status === 'CANCELLED' ? event.cancellationFee : event.grandTotal, event.currency)}.
          {current ? ` ${current.number} "yenisiyle değişti" olur${current.status !== 'ISSUED' ? ` (şu an: ${EVENT_DOCUMENT_STATUS_LABELS[current.status].toLocaleLowerCase('tr')})` : ''}.` : ''}
          {kind === 'CONTRACT' && event.requireSignedContract ? ' Kesinleştirme için yeni sözleşmenin imzalanması gerekir.' : ''}
        </p>
        <Textarea label="Belgeye not (isteğe bağlı)" name="event-issue-note" rows={3} value={note} onChange={(changeEvent) => setNote(changeEvent.target.value)} error={error ?? undefined} disabled={busy} />
      </form>
    </Modal>
  );
}

/** @param {{ event: any, choice: { document: any, decision: string, label: string }, onClose: () => void, onDone: () => void }} props */
function DecisionDialog({ event, choice, onClose, onDone }) {
  const { today } = useHotelToday();
  const [values, setValues] = useState({ date: today, note: '' });
  const [errors, setErrors] = useState({});
  const decide = useMutation({
    mutationFn: (body) => apiPost(`/banquet/events/${event.id}/documents/${choice.document.id}/decision`, body),
    onSuccess: onDone,
    onError: (failure) => {
      if (failure.fields) setErrors(failure.fields);
      toastError(failure.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { decision: choice.decision, date: values.date, note: values.note };
    const checked = validateWith(decideEventDocumentSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (values.date > today) return setErrors({ date: 'Karar günü ileri bir tarih olamaz' });
    setErrors({});
    decide.mutate(body);
  }

  const busy = decide.isPending;
  const issuedDay = choice.document.createdAt.slice(0, 10);
  return (
    <Modal
      open
      size="sm"
      title={`${choice.document.kindLabel} ${choice.document.number}: ${choice.label.toLocaleLowerCase('tr')}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-decision-form" icon={choice.icon} variant={choice.decision === 'DECLINED' ? 'danger' : 'primary'} disabled={busy}>
            {busy ? 'Kaydediliyor…' : choice.label}
          </Button>
        </>
      }
    >
      <form id="event-decision-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {choice.document.validUntil && choice.decision === 'ACCEPTED' && (
          <p className="text-sm text-ink-soft">Teklif {dayText(choice.document.validUntil)} tarihine kadar geçerli; sonrasında kabul işaretlenmez, yeni sürüm üretilir.</p>
        )}
        <Input label="Gün" name="decision-date" type="date" value={values.date} min={issuedDay} max={today} onChange={(changeEvent) => setValues((current) => ({ ...current, date: changeEvent.target.value }))} error={errors.date} required disabled={busy} />
        <Textarea label="Not" name="decision-note" rows={2} value={values.note} onChange={(changeEvent) => setValues((current) => ({ ...current, note: changeEvent.target.value }))} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
