import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CALL_CHANNEL_LABELS,
  CALL_DIRECTION_LABELS,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  createCallLogSchema,
  leadStatusSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { openQuotePdf, salesKeys } from '../../lib/sales.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { LeadFormModal } from './LeadFormModal.jsx';
import { QuoteFormModal } from './QuoteFormModal.jsx';

const STATUS_TONES = Object.freeze({ NEW: 'info', QUOTED: 'warning', WAITING: 'neutral', WON: 'success', LOST: 'neutral' });
const QUOTE_TONES = Object.freeze({ DRAFT: 'neutral', SENT: 'warning', ACCEPTED: 'success', REJECTED: 'neutral', EXPIRED: 'neutral' });
/** Panodan elle gidilebilen durumlar (WON yalnız teklif kabulüyle — sunucu da reddeder). */
const MANUAL_TARGETS = Object.freeze({ NEW: ['QUOTED', 'WAITING'], QUOTED: ['WAITING'], WAITING: ['QUOTED'] });

/**
 * Fırsat dosyası (modül 36): kart + arama günlüğü + teklifler. Teklif kabulü
 * rezervasyonu teklifin kilitli fiyatıyla açar ve fırsatı "kazanıldı" yapar.
 */
export function SalesLeadPage() {
  const { leadId } = useParams();
  const can = useCan();
  const canManage = can(PERMISSIONS.SALES_MANAGE);
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [addingCall, setAddingCall] = useState(false);
  const [quoteModal, setQuoteModal] = useState(null); // { quote? } — null kapalı, {} yeni
  const [losing, setLosing] = useState(false);

  const query = useQuery({ queryKey: salesKeys.lead(leadId), queryFn: () => api(`/sales/leads/${leadId}`) });
  const lead = query.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: salesKeys.all });
  };

  const statusMutation = useMutation({
    mutationFn: (values) => apiPost(`/sales/leads/${leadId}/status`, values),
    onSuccess: () => {
      toastSuccess('Durum güncellendi');
      setLosing(false);
      refresh();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') refresh();
    },
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (query.error) return <QueryFallback query={query} errorTitle="Fırsat yüklenemedi" />;

  const open = ['NEW', 'QUOTED', 'WAITING'].includes(lead.status);
  const targets = MANUAL_TARGETS[lead.status] ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={lead.name}
        description={lead.company ?? 'Satış fırsatı dosyası'}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage && open && (
              <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            )}
            {canManage && open && (
              <Button icon="plus" onClick={() => setQuoteModal({})}>
                Teklif hazırla
              </Button>
            )}
          </div>
        }
      />

      {/* Kimlik kartı */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[lead.status]} dot={false}>
            {LEAD_STATUS_LABELS[lead.status]}
          </Badge>
          <Badge tone="neutral" dot={false}>
            {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
          </Badge>
          {lead.followUpAt && (
            <Badge tone="info" dot={false}>
              Takip: {formatDate(lead.followUpAt)}
            </Badge>
          )}
          {canManage &&
            targets.map((target) => (
              <Button
                key={target}
                variant="outline"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ status: target, lostReason: null, expectedUpdatedAt: lead.updatedAt })}
              >
                → {LEAD_STATUS_LABELS[target]}
              </Button>
            ))}
          {canManage && open && (
            <Button variant="dangerSoft" size="sm" icon="close" disabled={statusMutation.isPending} onClick={() => setLosing(true)}>
              Kaybedildi
            </Button>
          )}
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Pair label="Telefon" value={lead.phone} mono />
          <Pair label="E-posta" value={lead.email} mono />
          <Pair label="Misafir kartı" value={lead.guestName} />
          <Pair
            label="İstenen konaklama"
            value={lead.checkIn ? `${formatDate(lead.checkIn)} – ${formatDate(lead.checkOut)}` : null}
          />
          <Pair label="Oda tipi" value={lead.roomTypeName} />
          <Pair label="Kişi" value={lead.adults ? `${lead.adults} yetişkin${lead.children ? `, ${lead.children} çocuk` : ''}` : null} />
          <Pair label="Açan" value={lead.createdBy} />
          <Pair label="Açılış" value={formatDateTime(lead.createdAt)} />
        </dl>

        {lead.notes && (
          <Alert tone="info" title="Not" className="mt-4">
            {lead.notes}
          </Alert>
        )}
        {lead.status === 'WON' && lead.wonReservationId && (
          <Alert tone="success" title="Kazanıldı" className="mt-4">
            <Link to={`/rezervasyonlar/${lead.wonReservationId}`} className="font-semibold underline">
              Rezervasyona git
            </Link>
          </Alert>
        )}
        {lead.status === 'LOST' && (
          <Alert tone="warning" title="Kaybedildi" className="mt-4">
            {lead.lostReason}
          </Alert>
        )}
      </Card>

      {/* Teklifler */}
      <Card
        title={`Teklifler (${lead.quotes.length})`}
        actions={
          canManage &&
          open && (
            <Button variant="outline" size="sm" icon="plus" onClick={() => setQuoteModal({})}>
              Teklif hazırla
            </Button>
          )
        }
      >
        {lead.quotes.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz teklif yok. "Teklif hazırla" ile fiyatı kilitleyip müşteriye gönderin.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {lead.quotes.map((quote) => (
              <QuoteRow
                key={quote.id}
                quote={quote}
                canManage={canManage}
                leadOpen={open}
                onEdit={() => setQuoteModal({ quote })}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Arama günlüğü */}
      <Card
        title={`Arama kayıtları (${lead.calls.length})`}
        actions={
          canManage && (
            <Button variant="outline" size="sm" icon="phone" onClick={() => setAddingCall(true)}>
              Arama ekle
            </Button>
          )
        }
      >
        {lead.calls.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz arama kaydı yok.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {lead.calls.map((call) => (
              <li key={call.id} className="rounded-control border border-line p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={call.direction === 'INBOUND' ? 'info' : 'neutral'} dot={false}>
                    {CALL_DIRECTION_LABELS[call.direction]}
                  </Badge>
                  <Badge tone={call.channel === 'VOICE_AI' ? 'violet' : 'neutral'} dot={false}>
                    {CALL_CHANNEL_LABELS[call.channel]}
                  </Badge>
                  <Badge tone="warning" dot={false}>
                    {CALL_OUTCOME_LABELS[call.outcome] ?? call.outcome}
                  </Badge>
                  <span className="ml-auto text-ink-muted">
                    {formatDateTime(call.calledAt)} · {call.createdBy}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink">{call.summary}</p>
                {call.recordingRef && <p className="mt-1 font-mono text-xs text-ink-muted">Kayıt: {call.recordingRef}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {editing && (
        <LeadFormModal
          lead={lead}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {addingCall && (
        <CallFormModal
          leadId={lead.id}
          defaultPhone={lead.phone}
          onSaved={() => {
            setAddingCall(false);
            refresh();
          }}
          onClose={() => setAddingCall(false)}
        />
      )}

      {quoteModal && (
        <QuoteFormModal
          lead={lead}
          quote={quoteModal.quote ?? null}
          onSaved={() => {
            setQuoteModal(null);
            refresh();
          }}
          onClose={() => setQuoteModal(null)}
        />
      )}

      {losing && (
        <LostReasonModal
          isPending={statusMutation.isPending}
          onConfirm={(reason) => statusMutation.mutate({ status: 'LOST', lostReason: reason, expectedUpdatedAt: lead.updatedAt })}
          onClose={() => setLosing(false)}
        />
      )}
    </div>
  );
}

function Pair({ label, value, mono = false }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`text-ink ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

/** Teklif satırı: duruma göre Gönder / Kabul / Reddet / PDF aksiyonları. */
function QuoteRow({ quote, canManage, leadOpen, onEdit, onChanged }) {
  const [confirming, setConfirming] = useState(null); // 'send' | 'accept'
  const [rejecting, setRejecting] = useState(false);

  const act = useMutation({
    mutationFn: ({ action, body }) => apiPost(`/sales/quotes/${quote.id}/${action}`, body),
    onSuccess: (saved, { action }) => {
      if (action === 'accept') {
        toastSuccess(`Rezervasyon açıldı: ${saved.reservation?.confirmationCode ?? ''}`);
      } else {
        toastSuccess(action === 'send' ? 'Teklif gönderildi olarak işaretlendi' : 'Teklif reddedildi');
      }
      setConfirming(null);
      setRejecting(false);
      onChanged();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') onChanged();
    },
  });

  return (
    <div className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{quote.code}</span>
        <Badge tone={QUOTE_TONES[quote.status]} dot={false}>
          {QUOTE_STATUS_LABELS[quote.status]}
        </Badge>
        <span className="text-sm text-ink-muted">
          {formatDate(quote.checkIn)} – {formatDate(quote.checkOut)} · {quote.roomTypeName} · {quote.adults}+{quote.children}
        </span>
        <span className="ml-auto text-sm font-bold tabular-nums text-ink">{formatMoney(quote.total, quote.currency)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Geçerlilik: {formatDate(quote.validUntil)}</span>
        {quote.sentAt && <span>· Gönderildi: {formatDateTime(quote.sentAt)}</span>}
        {quote.rejectReason && <span>· Sebep: {quote.rejectReason}</span>}
        {quote.status === 'ACCEPTED' && quote.reservationId && (
          <Link to={`/rezervasyonlar/${quote.reservationId}`} className="font-semibold text-ink underline">
            Rezervasyona git
          </Link>
        )}
        <span className="ml-auto flex gap-2">
          {canManage && quote.status === 'DRAFT' && (
            <>
              <Button variant="outline" size="sm" icon="pencil" onClick={onEdit}>
                Düzenle
              </Button>
              <Button size="sm" icon="check" disabled={act.isPending} onClick={() => setConfirming('send')}>
                Gönder
              </Button>
            </>
          )}
          {canManage && leadOpen && quote.status === 'SENT' && (
            <>
              <Button size="sm" icon="check" disabled={act.isPending} onClick={() => setConfirming('accept')}>
                Kabul
              </Button>
              <Button variant="dangerSoft" size="sm" icon="close" disabled={act.isPending} onClick={() => setRejecting(true)}>
                Reddet
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" icon="download" onClick={() => openQuotePdf(quote.id, quote.code)}>
            PDF
          </Button>
        </span>
      </div>

      <ConfirmDialog
        open={confirming === 'send'}
        title="Teklif gönderildi olarak işaretlensin mi?"
        message="PDF'i indirip müşteriye iletin; kayıt burada 'gönderildi' olur ve fırsat panoda ilerler."
        confirmLabel="Gönderildi işaretle"
        confirmVariant="primary"
        confirmIcon="check"
        isPending={act.isPending}
        onConfirm={() => act.mutate({ action: 'send', body: { expectedUpdatedAt: quote.updatedAt } })}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'accept'}
        title="Teklif kabul edilsin mi?"
        message={`${formatMoney(quote.total, quote.currency)} toplamla rezervasyon açılacak (teklifin kilitli fiyatı) ve fırsat "kazanıldı" olacak.`}
        confirmLabel="Kabul et ve rezervasyon aç"
        confirmVariant="primary"
        confirmIcon="check"
        isPending={act.isPending}
        onConfirm={() => act.mutate({ action: 'accept', body: { expectedUpdatedAt: quote.updatedAt } })}
        onClose={() => setConfirming(null)}
      />

      {rejecting && (
        <RejectQuoteModal
          isPending={act.isPending}
          onConfirm={(reason) => act.mutate({ action: 'reject', body: { expectedUpdatedAt: quote.updatedAt, reason } })}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
}

/** Arama kaydı ekleme (FOLLOW_UP seçilince takip tarihi alanı açılır). */
function CallFormModal({ leadId, defaultPhone, onSaved, onClose }) {
  const [form, setForm] = useState({
    channel: 'STAFF',
    direction: 'INBOUND',
    phone: defaultPhone ?? '',
    outcome: 'INFO',
    summary: '',
    recordingRef: '',
    followUpAt: '',
  });
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: (values) => apiPost(`/sales/leads/${leadId}/calls`, values),
    onSuccess: () => {
      toastSuccess('Arama kaydedildi');
      onSaved();
    },
    onError: (error) => toastError(error.message),
  });

  const setField = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));

  function save() {
    const body = {
      channel: form.channel,
      direction: form.direction,
      phone: form.phone,
      outcome: form.outcome,
      summary: form.summary,
      recordingRef: form.recordingRef,
      followUpAt: form.outcome === 'FOLLOW_UP' && form.followUpAt ? form.followUpAt : null,
    };
    const result = validateWith(createCallLogSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      title="Arama kaydı"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="check" disabled={mutation.isPending} onClick={save}>
            {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Yön"
            name="direction"
            value={form.direction}
            onChange={setField('direction')}
            options={Object.entries(CALL_DIRECTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Sonuç"
            name="outcome"
            value={form.outcome}
            onChange={setField('outcome')}
            options={CALL_OUTCOMES.map((value) => ({ value, label: CALL_OUTCOME_LABELS[value] }))}
          />
        </div>
        {form.outcome === 'FOLLOW_UP' && (
          <Input
            label="Takip tarihi (fırsata da işlenir)"
            name="followUpAt"
            type="date"
            value={form.followUpAt}
            error={errors.followUpAt}
            onChange={setField('followUpAt')}
          />
        )}
        <Input label="Telefon" name="phone" value={form.phone} error={errors.phone} onChange={setField('phone')} />
        <Textarea
          label="Özet"
          name="summary"
          rows={3}
          placeholder="Konuşmanın kısa özeti (rapor ve sesli AI kayıtları buna dayanır)…"
          value={form.summary}
          error={errors.summary}
          onChange={setField('summary')}
        />
      </div>
    </Modal>
  );
}

function LostReasonModal({ isPending, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function save() {
    const result = validateWith(leadStatusSchema, { status: 'LOST', lostReason: reason, expectedUpdatedAt: new Date().toISOString() });
    if (!result.ok) {
      setError(result.errors.lostReason ?? 'Sebep geçersiz');
      return;
    }
    setError('');
    onConfirm(result.data.lostReason);
  }

  return (
    <Modal
      open
      title="Fırsat kaybedildi"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" icon="close" disabled={isPending} onClick={save}>
            {isPending ? 'Kaydediliyor…' : 'Kaybedildi işaretle'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Sebep (raporlar buna dayanır)"
        name="lostReason"
        rows={3}
        placeholder="Örn. rakip otel daha uygun fiyat verdi…"
        value={reason}
        error={error}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}

function RejectQuoteModal({ isPending, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title="Teklif reddedildi"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" icon="close" disabled={isPending} onClick={() => onConfirm(reason)}>
            {isPending ? 'Kaydediliyor…' : 'Reddedildi işaretle'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Sebep (isteğe bağlı)"
        name="reason"
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}
