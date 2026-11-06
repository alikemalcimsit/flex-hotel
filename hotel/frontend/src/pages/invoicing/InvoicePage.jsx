import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EDOC_REACHED_STATES,
  EDOC_RESENDABLE_STATES,
  EDOC_STATE_LABELS,
  FOREIGN_COMPANY_BUYER_ID,
  INVOICE_BUYER_TYPES,
  INVOICE_BUYER_TYPE_LABELS,
  INVOICE_DOCUMENT_TYPE_LABELS,
  INVOICE_SOURCE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_UNIT_LABELS,
  invoiceCancelSchema,
  invoiceDraftUpdateSchema,
  isCompanyBuyer,
  isForeignBuyer,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { EDOC_STATE_TONES, INVOICE_LOG_LABELS, INVOICE_STATUS_TONES, buyerDisplayName, invoiceKeys, openInvoicePdf, useInvoicesLive } from '../../lib/invoicing.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { actorLabel } from '../../lib/activity.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { LinesEditor } from './LinesEditor.jsx';

const CANCEL_METHOD_LABELS = Object.freeze({ LOCAL: "GİB'e ulaşmadan iptal", INTEGRATOR: 'e-Arşiv entegratörden iptal', PORTAL: 'GİB portalında iptal' });

/**
 * Fatura ekranı (modül 16 / 49). Taslakta alıcı (ve serbest fatura / iptal bedelinde satırlar) düzenlenir, kesimi
 * durduranlar listelenir, yasal süre gösterilir; kesilmişte e-belge durumu, zaman çizelgesi, PDF, tekrar gönderim
 * ve iptal isteği (onay kuyruğu); iptal edilmişten yeni taslak.
 */
export function InvoicePage() {
  useInvoicesLive();
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();
  const canIssue = can(PERMISSIONS.INVOICES_ISSUE);
  const canManage = can(PERMISSIONS.INVOICES_MANAGE);
  const [cancelling, setCancelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeZone = useHotelContext().data?.timezone;
  /** @param {string | null | undefined} value */
  const at = (value) => formatDateTime(value, timeZone);
  const query = useQuery({ queryKey: invoiceKeys.detail(invoiceId), queryFn: () => api(`/invoices/${invoiceId}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: invoiceKeys.all });

  const issue = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoiceId}/issue`, { expectedUpdatedAt: query.data?.invoice.updatedAt }),
    onSuccess: (data) => {
      refresh();
      toastSuccess(`${data.invoice.number} kesildi (${INVOICE_DOCUMENT_TYPE_LABELS[data.invoice.documentType]}); gönderim sırasında`);
    },
    onError: (error) => {
      refresh();
      toastError(error.message);
    },
  });
  const resend = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoiceId}/resend`, {}),
    onSuccess: () => {
      refresh();
      toastSuccess('Yeniden gönderim sırasına alındı');
    },
    onError: (error) => toastError(error.message),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/invoices/${invoiceId}`),
    onSuccess: () => {
      refresh();
      toastSuccess('Taslak silindi');
      navigate('/faturalar/taslaklar');
    },
    onError: (error) => toastError(error.message),
  });
  const copy = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoiceId}/copy`, {}),
    onSuccess: (data) => {
      refresh();
      navigate(`/faturalar/${data.invoice.id}`);
    },
    onError: (error) => toastError(error.message),
  });

  if (!query.data) return <QueryFallback query={query} errorTitle="Fatura yüklenemedi" />;
  const { invoice, lines, logs, source, linesEditable, deadline, issueProblems, environment } = query.data;
  const draft = invoice.status === 'DRAFT';
  const currency = invoice.currency;
  const testEnvironment = (invoice.edocEnvironment ?? environment) === 'TEST';
  const sourceLink = source.folio ? (
    <Link to={`/folyolar/${source.folio.reservationId}`} className="font-semibold hover:underline">
      {source.folio.room ? `${source.folio.room} · ` : ''}
      {source.folio.guest} · {source.folio.confirmationCode}
      {source.folio.window > 1 ? ` · ${source.folio.window}. folyo` : ''}
    </Link>
  ) : source.event ? (
    <Link to={`/etkinlikler/${source.event.id}`} className="font-semibold hover:underline">
      {source.event.code} · {source.event.name}
    </Link>
  ) : source.ledgerAccount ? (
    <Link to={`/muhasebe/cariler/${source.ledgerAccount.id}`} className="font-semibold hover:underline">
      {source.ledgerAccount.code} · {source.ledgerAccount.name}
    </Link>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={draft ? 'Fatura taslağı' : `${invoice.number} · ${INVOICE_DOCUMENT_TYPE_LABELS[invoice.documentType]}`}
        description={`${INVOICE_SOURCE_LABELS[invoice.source]} · ${buyerDisplayName(invoice.buyer)} · ${formatMoney(invoice.total, currency)}${invoice.issueDate ? ` · ${formatDate(invoice.issueDate)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={draft ? '/faturalar/taslaklar' : '/faturalar/liste'} className="text-sm font-semibold text-ink-soft hover:underline">
              ← {draft ? 'Taslaklar' : 'Faturalar'}
            </Link>
            <Badge tone={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
            {invoice.edocState && <Badge tone={EDOC_STATE_TONES[invoice.edocState]}>{EDOC_STATE_LABELS[invoice.edocState]}</Badge>}
            <Button type="button" variant="outline" icon="download" onClick={() => openInvoicePdf(invoice.id, invoice.number ?? 'fatura-taslagi')}>
              PDF
            </Button>
            {draft && (canIssue || canManage) && (
              <Button type="button" variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>
                Taslağı sil
              </Button>
            )}
            {invoice.status === 'ISSUED' && canIssue && EDOC_RESENDABLE_STATES.includes(invoice.edocState) && (
              <Button type="button" variant="outline" icon="send" onClick={() => resend.mutate()} disabled={resend.isPending}>
                Tekrar gönder
              </Button>
            )}
            {invoice.status === 'ISSUED' && canManage && (
              <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setCancelling(true)}>
                İptal iste
              </Button>
            )}
            {invoice.status === 'CANCELLED' && (canIssue || canManage) && (
              <Button type="button" icon="plus" onClick={() => copy.mutate()} disabled={copy.isPending}>
                Yeni taslak
              </Button>
            )}
          </div>
        }
      />

      {testEnvironment && (
        <Alert tone="warning" title="Test ortamı">
          e-belgeler GİB'e gönderilmez; fatura ve PDF'in mali değeri yoktur. Canlıya geçiş gerçek entegratörle (Faturalar → Ayarlar).
        </Alert>
      )}
      {draft && issueProblems.length > 0 && (
        <Alert tone="warning" title="Kesmeden önce">
          <ul className="list-disc pl-5">
            {issueProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}
      {draft && query.data.beforeStart && (
        <Alert tone="warning" title="Faturalama başlangıcından önce kapandı">
          Kaynak, faturalama başlangıcından ({formatDate(query.data.beforeStart)}) önce kapanmış: önceki sistemde faturalanmış olabilir. Mükerrer fatura kesmemek için kontrol edin.
        </Alert>
      )}
      {draft && deadline && (
        <Alert tone={deadline.overdue ? 'danger' : deadline.daysLeft <= 2 ? 'warning' : 'info'} title="Yasal süre">
          Hizmetten sonra 7 gün içinde düzenlenmeli: son gün {formatDate(deadline.deadline)}
          {deadline.overdue ? ` (${-deadline.daysLeft} gün gecikti)` : deadline.daysLeft === 0 ? ' (bugün)' : ` (${deadline.daysLeft} gün kaldı)`}.
        </Alert>
      )}
      {invoice.status === 'CANCEL_PENDING' && (
        <Alert tone="warning" title="İptal onayı bekliyor">
          {invoice.cancelRequestedBy}: {invoice.cancelReason}
          {invoice.cancelReference ? ` · portal ${invoice.cancelReference}` : ''}. Başka bir yetkili{' '}
          <Link to={`/onaylar/bekleyen?onay=${invoice.cancelApprovalId}`} className="font-semibold hover:underline">
            onay kuyruğundan
          </Link>{' '}
          karar verene kadar gönderim durur.
        </Alert>
      )}
      {invoice.status === 'CANCELLED' && (
        <Alert tone="info" title="İptal edildi">
          {at(invoice.cancelledAt)} · {CANCEL_METHOD_LABELS[invoice.cancelMethod] ?? ''}
          {invoice.cancelReference ? ` (${invoice.cancelReference})` : ''} · {invoice.cancelReason}. Kaynağı yeniden faturalanabilir.
        </Alert>
      )}
      {invoice.status === 'ISSUED' && (invoice.edocState === 'FAILED' || invoice.edocState === 'REJECTED') && (
        <Alert tone="danger" title={invoice.edocState === 'FAILED' ? 'e-belge gönderilemedi' : 'e-belge reddedildi'}>
          {invoice.edocMessage && <p>{invoice.edocMessage}</p>}
          <p className={invoice.edocMessage ? 'mt-1' : undefined}>{invoice.edocState === 'FAILED' ? 'Entegratöre yeniden gönderin.' : 'Hata belgedeyse faturayı iptal edip düzeltilmiş taslaktan yeniden kesin; geçici bir sorunsa tekrar gönderin.'}</p>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {draft && (canIssue || canManage) ? (
            <DraftEditor key={invoice.updatedAt} data={query.data} canEditLines={linesEditable && canManage} onIssue={() => issue.mutate()} issuing={issue.isPending} canIssue={canIssue && issueProblems.length === 0} />
          ) : (
            <BuyerCard invoice={invoice} />
          )}
          <Card title="Satırlar" description={source.folio ? 'Folyo kalemleri gelir grubuna göre; iptal edilenler düşülmüş, indirim satır iskontosu.' : undefined}>
            <LinesTable lines={lines} currency={currency} />
          </Card>
          <Card title="Toplamlar" description="KDV ve konaklama vergisi KDV hariç bedel üzerinden; biri ötekinin matrahına girmez.">
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">Mal / hizmet toplamı</dt>
              <dd className="text-right tabular-nums">{formatMoney(invoice.grossTotal, currency)}</dd>
              {invoice.discountTotal !== '0.00' && (
                <>
                  <dt className="text-ink-muted">Toplam iskonto</dt>
                  <dd className="text-right tabular-nums">−{formatMoney(invoice.discountTotal, currency)}</dd>
                </>
              )}
              <dt className="text-ink-muted">Vergi matrahı</dt>
              <dd className="text-right tabular-nums">{formatMoney(invoice.netTotal, currency)}</dd>
              {(invoice.taxes ?? []).map((tax) => (
                <TaxRow key={`${tax.code}-${tax.rate}-${tax.exemptionCode ?? ''}`} tax={tax} currency={currency} />
              ))}
              <dt className="font-semibold text-ink">Ödenecek</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(invoice.total, currency)}</dd>
            </dl>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Kaynak">
            <p className="text-sm">{sourceLink ?? '—'}</p>
            {invoice.serviceFrom && (
              <p className="mt-1 text-xs text-ink-muted">
                Hizmet dönemi {formatDate(invoice.serviceFrom)} – {formatDate(invoice.serviceTo)}
              </p>
            )}
          </Card>
          {!draft && (
            <Card title="e-belge" description={invoice.edocEnvironment === 'TEST' ? 'Test ortamı' : 'Canlı'}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ink-muted">ETTN</dt>
                <dd className="break-all font-mono text-xs">{invoice.uuid}</dd>
                {invoice.receiverAlias && (
                  <>
                    <dt className="text-ink-muted">Posta kutusu</dt>
                    <dd className="break-all text-xs">{invoice.receiverAlias}</dd>
                  </>
                )}
                <dt className="text-ink-muted">Gönderim</dt>
                <dd>{invoice.edocSentAt ? at(invoice.edocSentAt) : invoice.edocAttempts ? `${invoice.edocAttempts} deneme` : 'Sırada'}</dd>
                {invoice.edocCompletedAt && (
                  <>
                    <dt className="text-ink-muted">Tamamlandı</dt>
                    <dd>{at(invoice.edocCompletedAt)}</dd>
                  </>
                )}
                {invoice.edocStatusCode && (
                  <>
                    <dt className="text-ink-muted">Son cevap</dt>
                    <dd className="text-xs">
                      {invoice.edocStatusCode} · {invoice.edocMessage}
                    </dd>
                  </>
                )}
                <dt className="text-ink-muted">Kesen</dt>
                <dd className="text-xs">{invoice.issuedBy}</dd>
              </dl>
            </Card>
          )}
          <Card title="Zaman çizelgesi">
            <ol className="flex flex-col gap-2 text-sm">
              {logs.map((log) => (
                <li key={log.id} className="border-l-2 border-line pl-3">
                  <span className="block font-semibold text-ink">{INVOICE_LOG_LABELS[log.kind] ?? log.kind}</span>
                  <span className="block text-xs text-ink-muted">
                    {at(log.at)} · {actorLabel(log.actor)}
                    {log.code ? ` · ${log.code}` : ''}
                  </span>
                  {log.message && <span className="block text-xs text-ink-soft">{log.message}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {cancelling && <CancelDialog invoice={invoice} onClose={() => setCancelling(false)} />}
      {confirmDelete && (
        <Modal
          open
          size="sm"
          title="Taslak silinsin mi?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                Vazgeç
              </Button>
              <Button type="button" icon="trash" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Sil
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-soft">Taslak silinir; kaynağı (folyo / etkinlik) Faturalanacaklar listesine döner, yeniden taslak açılabilir.</p>
        </Modal>
      )}
    </div>
  );
}

/** @param {{ tax: any, currency: string }} props */
function TaxRow({ tax, currency }) {
  return (
    <>
      <dt className="text-ink-muted">
        {tax.name} %{tax.rate} <span className="text-xs">(matrah {formatMoney(tax.base, currency)}{tax.exemptionCode ? ` · istisna ${tax.exemptionCode}` : ''})</span>
      </dt>
      <dd className="text-right tabular-nums">{formatMoney(tax.amount, currency)}</dd>
    </>
  );
}

/** @param {{ lines: any[], currency: string }} props */
function LinesTable({ lines, currency }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th className="py-2 pr-3">Açıklama</th>
            <th className="px-3 py-2 text-right">Miktar</th>
            <th className="px-3 py-2 text-right">Birim fiyat</th>
            <th className="px-3 py-2 text-right">İskonto</th>
            <th className="px-3 py-2">Vergiler</th>
            <th className="py-2 pl-3 text-right">Tutar</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-line align-top">
              <td className="py-2 pr-3">{line.description}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {line.quantity} {INVOICE_UNIT_LABELS[line.unitCode] ?? line.unitCode}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(line.discount !== '0.00' ? line.gross : line.unitPrice, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.discount !== '0.00' ? formatMoney(line.discount, currency) : '—'}</td>
              <td className="px-3 py-2 text-xs text-ink-soft">{line.taxes.map((tax) => `${tax.name} %${tax.rate}`).join(', ')}</td>
              <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold tabular-nums">{formatMoney(line.net, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kesilmiş faturanın alıcısı (salt okunur). @param {{ invoice: any }} props */
function BuyerCard({ invoice }) {
  const buyer = invoice.buyer ?? {};
  const rows = [
    ['Alıcı', buyerDisplayName(buyer)],
    ['Tür', INVOICE_BUYER_TYPE_LABELS[buyer.type]],
    buyer.type === 'FOREIGN'
      ? ['Uyruk / pasaport', `${buyer.nationality ?? '—'} / ${buyer.passportNo ?? '—'}`]
      : buyer.type === 'FOREIGN_COMPANY'
        ? ['Vergi no (yurt dışı)', `${buyer.foreignTaxId || '—'} · GİB kimliği ${FOREIGN_COMPANY_BUYER_ID}`]
        : ['Vergi / TC kimlik no', buyer.taxNumber],
    [buyer.type === 'FOREIGN_COMPANY' ? 'Vergi makamı' : 'Vergi dairesi', isCompanyBuyer(buyer) ? buyer.taxOffice : null],
    ['Adres', [buyer.street, [buyer.district, buyer.city].filter(Boolean).join(' / '), buyer.postalCode, buyer.country].filter(Boolean).join(' · ')],
    ['E-posta / telefon', [buyer.email, buyer.phone].filter(Boolean).join(' · ')],
  ].filter(([, value]) => value);
  return (
    <Card title="Alıcı">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const BLANK_BUYER = { type: 'PERSON', name: '', firstName: '', lastName: '', taxNumber: '', taxOffice: '', nationality: '', passportNo: '', foreignTaxId: '', street: '', district: '', city: '', postalCode: '', country: 'Türkiye', email: '', phone: '', alias: '' };

/**
 * Taslağın düzenlenmesi: alıcı, not, (izinliyse) elle girilen satırlar; kaydet ve kes.
 * @param {{ data: any, canEditLines: boolean, onIssue: () => void, issuing: boolean, canIssue: boolean }} props
 */
function DraftEditor({ data, canEditLines, onIssue, issuing, canIssue }) {
  const queryClient = useQueryClient();
  const { invoice, lines } = data;
  const initialBuyer = { ...BLANK_BUYER, ...Object.fromEntries(Object.entries(invoice.buyer ?? {}).map(([key, value]) => [key, value ?? ''])) };
  const initialLines = lines.map((line) => ({ description: line.description, quantity: line.quantity, unitCode: line.unitCode, unitAmount: line.unitAmount ?? '', taxCategory: line.taxCategory ?? 'OTHER' }));
  const [buyer, setBuyer] = useState(initialBuyer);
  const [note, setNote] = useState(invoice.note ?? '');
  const [editLines, setEditLines] = useState(initialLines);
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [invoice.updatedAt]);

  const set = (field) => (event) => {
    setBuyer((current) => ({ ...current, [field]: event.target.value }));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (body) => apiPut(`/invoices/${invoice.id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      toastSuccess('Taslak kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: invoice.updatedAt, buyer, note, ...(canEditLines ? { lines: editLines } : {}) };
    const checked = validateWith(invoiceDraftUpdateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }
  const busy = save.isPending || issuing;
  const field = (name, label, props = {}) => <Input label={label} value={buyer[name] ?? ''} onChange={set(name)} error={errors[`buyer.${name}`]} disabled={busy} {...props} />;

  return (
    <Card title="Alıcı ve taslak" description="Folyo cariye aktarıldıysa alıcı cari, değilse misafirdir; adres aynı alıcının son faturasından gelir. Kesimde alıcının e-Fatura mükellefi olup olmadığı sorgulanır.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ChoiceChips
          label="Alıcı türü"
          options={INVOICE_BUYER_TYPES.map((type) => ({ value: type, label: INVOICE_BUYER_TYPE_LABELS[type] }))}
          value={buyer.type}
          onChange={(value) => {
            if (!value) return;
            setBuyer((current) => ({ ...current, type: value, country: isForeignBuyer({ type: value }) ? (current.country === 'Türkiye' ? '' : current.country) : current.country || 'Türkiye' }));
            setDirty(true);
          }}
          disabled={busy}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {buyer.type === 'COMPANY' ? (
            <>
              {field('name', 'Ünvan', { className: 'sm:col-span-2' })}
              {field('taxNumber', 'Vergi no (şahıs işletmesinde TC kimlik no)', { inputMode: 'numeric' })}
              {field('taxOffice', 'Vergi dairesi')}
            </>
          ) : buyer.type === 'FOREIGN_COMPANY' ? (
            <>
              {field('name', 'Ünvan', { className: 'sm:col-span-2' })}
              {field('foreignTaxId', 'Kendi ülkesindeki vergi no (isteğe bağlı; faturada notta)')}
              {field('taxOffice', 'Vergi makamı (isteğe bağlı)')}
              <p className="text-xs text-ink-muted sm:col-span-2">Yurt dışındaki şirkete e-Arşiv kesilir; GİB kimliği {FOREIGN_COMPANY_BUYER_ID}.</p>
            </>
          ) : (
            <>
              {field('firstName', 'Ad')}
              {field('lastName', 'Soyad')}
              {buyer.type === 'PERSON' ? (
                field('taxNumber', 'TC kimlik no', { inputMode: 'numeric' })
              ) : (
                <>
                  {field('nationality', 'Uyruk (ülke kodu: DE, GB…)', { maxLength: 2 })}
                  {field('passportNo', 'Pasaport / belge no')}
                </>
              )}
            </>
          )}
          {field('street', 'Adres', { className: 'sm:col-span-2' })}
          {field('district', 'İlçe')}
          {field('city', 'İl / şehir')}
          {field('postalCode', 'Posta kodu')}
          {field('country', 'Ülke')}
          {field('email', 'E-posta (e-Arşiv gönderimi)', { type: 'email' })}
          {field('phone', 'Telefon')}
        </div>
        {canEditLines && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-ink">Satırlar</span>
            <LinesEditor
              lines={editLines}
              onChange={(next) => {
                setEditLines(next);
                setDirty(true);
              }}
              errors={errors}
              disabled={busy}
            />
          </div>
        )}
        <Textarea
          label="Not (faturada görünür)"
          rows={2}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setDirty(true);
          }}
          error={errors.note}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" icon="check" disabled={busy || !dirty}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          <Button type="button" icon="send" disabled={busy || dirty || !canIssue} onClick={onIssue}>
            {issuing ? 'Kesiliyor…' : 'Faturayı kes'}
          </Button>
          {dirty && <span className="text-xs text-ink-muted">Kesmeden önce değişiklikleri kaydedin.</span>}
        </div>
      </form>
    </Card>
  );
}

/** İptal isteği (onay kuyruğu). @param {{ invoice: any, onClose: () => void }} props */
function CancelDialog({ invoice, onClose }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [portalReference, setPortalReference] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const needsPortal = invoice.documentType === 'E_FATURA' && EDOC_REACHED_STATES.includes(invoice.edocState);
  const save = useMutation({
    mutationFn: (body) => apiPost(`/invoices/${invoice.id}/cancel`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      toastSuccess('İptal isteği onay kuyruğuna gitti');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      setServerError(error);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { reason, portalReference };
    const checked = validateWith(invoiceCancelSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (needsPortal && !portalReference.trim()) return setErrors({ portalReference: 'GİB portalındaki iptal / itiraz referansını yazın' });
    setErrors({});
    save.mutate(checked.data);
  }
  const busy = save.isPending;
  const route = !EDOC_REACHED_STATES.includes(invoice.edocState)
    ? "Fatura GİB'e ulaşmadı: onaylanınca yerelde iptal edilir, gönderilmez."
    : invoice.documentType === 'E_ARSIV'
      ? 'e-Arşiv: onaylanınca entegratörden iptal edilir (GİB raporuna iptal olarak geçer).'
      : "e-Fatura alıcının posta kutusuna ulaştı: iptal GİB portalında (alıcının onayıyla) yapılır; buraya portal referansını yazın, onaylanınca fatura iptal sayılır.";
  return (
    <Modal
      open
      size="md"
      title={`${invoice.number} iptali`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="invoice-cancel-form" icon="rotateCcw" disabled={busy}>
            {busy ? 'Gönderiliyor…' : 'İptal iste'}
          </Button>
        </>
      }
    >
      <form id="invoice-cancel-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="İstek gönderilmedi">
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">{route} İptali başka bir yetkili onay kuyruğundan onaylar; karar çıkana kadar gönderim durur. Kaynağı (folyo / etkinlik) sonra yeniden faturalanabilir.</p>
        <Textarea label="Gerekçe" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
        {needsPortal && <Input label="GİB portalı iptal / itiraz referansı" value={portalReference} onChange={(event) => setPortalReference(event.target.value)} error={errors.portalReference} disabled={busy} />}
      </form>
    </Modal>
  );
}
