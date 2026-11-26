import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JOURNAL_ENTRY_STATUS_LABELS, JOURNAL_ENTRY_TYPE_LABELS, JOURNAL_SOURCE_LABELS, journalVoidSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format.js';
import { JOURNAL_STATUS_TONES, ledgerKeys, useLedgerLive } from '../../lib/ledger.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Bağlı kayıt sayısı: sunucu sayı ya da liste verebilir. @param {unknown} value */
const countOf = (value) => (Array.isArray(value) ? value.length : Number(value ?? 0));

/**
 * Yevmiye fişi (modül 48): başlık (numara, tür, durum, gün, kaynak ve kaynak belgeye bağlantı), satırlar
 * (hesap kodu + adı, cari / kasa izi, borç, alacak) ve toplam. "İptal et" (`ledger.setup`) sebep ve günle ters
 * fiş yazar; iptal edilen fiş ters fişine, ters fiş asıl fişine bağlanır.
 */
export function JournalPage() {
  useLedgerLive();
  const { journalId } = useParams();
  const can = useCan();
  const canSetup = can(PERMISSIONS.LEDGER_SETUP);
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency ?? '';
  const [voiding, setVoiding] = useState(false);
  const query = useQuery({ queryKey: ledgerKeys.journal(journalId), queryFn: () => api(`/ledger/journals/${journalId}`) });
  if (!query.data) return <QueryFallback query={query} errorTitle="Fiş yüklenemedi" />;
  const { entry, lines, sourceLink, linked } = query.data;
  const linkedEntries = countOf(linked?.ledgerEntries);
  const linkedMovements = countOf(linked?.treasuryMovements);
  const money = (value) => (Number(value) ? formatMoney(value) : '');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${entry.number} · ${JOURNAL_ENTRY_TYPE_LABELS[entry.type]}`}
        description={`${formatDate(entry.date)} · ${entry.description}${entry.reference ? ` · belge ${entry.reference}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/genel-muhasebe/yevmiye" className="text-sm font-semibold text-ink-soft hover:underline">
              ← Yevmiye
            </Link>
            <Badge tone="info">{JOURNAL_SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
            <Badge tone={JOURNAL_STATUS_TONES[entry.status]}>{JOURNAL_ENTRY_STATUS_LABELS[entry.status]}</Badge>
            {canSetup && entry.status === 'POSTED' && (
              <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setVoiding(true)}>
                İptal et
              </Button>
            )}
          </div>
        }
      />

      {entry.status === 'VOIDED' && (
        <Alert tone="info" title="İptal edildi">
          {formatDateTime(entry.voidedAt)} · {entry.voidedBy}: {entry.voidReason}.{' '}
          {entry.reversal && (
            <>
              Ters fiş:{' '}
              <Link to={`/genel-muhasebe/yevmiye/${entry.reversal.id}`} className="font-semibold hover:underline">
                {entry.reversal.number}
              </Link>
            </>
          )}
        </Alert>
      )}
      {entry.reversalOfId && (
        <Alert tone="info" title="Ters kayıt">
          Bu fiş iptal edilen bir fişin ters kaydıdır.{' '}
          <Link to={`/genel-muhasebe/yevmiye/${entry.reversalOfId}`} className="font-semibold hover:underline">
            Asıl fişe git →
          </Link>
        </Alert>
      )}

      <Card
        title="Satırlar"
        description={`${entry.createdBy ?? '—'} · ${formatDateTime(entry.createdAt)}${linkedEntries || linkedMovements ? ` · ${linkedEntries} cari, ${linkedMovements} kasa / banka hareketi bu fişe bağlı` : ''}`}
        actions={
          sourceLink && (
            sourceLink.to ? (
              <Link to={sourceLink.to} className="text-sm font-semibold text-ink-soft hover:underline">
                {sourceLink.label} →
              </Link>
            ) : (
              <span className="text-sm text-ink-muted">{sourceLink.label}</span>
            )
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="px-3 py-2">Hesap</th>
                <th className="px-3 py-2">Açıklama</th>
                <th className="px-3 py-2">Cari / kasa</th>
                <th className="px-3 py-2 text-right">Borç</th>
                <th className="px-3 py-2 text-right">Alacak</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    <Link to={`/genel-muhasebe/hesaplar/${line.accountId}`} className="hover:underline">
                      <span className="font-semibold tabular-nums">{line.account.code}</span> {line.account.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{line.description ?? ''}</td>
                  <td className="px-3 py-2 text-ink-soft">
                    {line.ledgerAccount && (
                      <Link to={`/muhasebe/cariler/${line.ledgerAccount.id}`} className="hover:underline">
                        {line.ledgerAccount.name}
                      </Link>
                    )}
                    {line.treasuryAccount && <span>{line.treasuryAccount.name}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(line.debit)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(line.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line-strong font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  Toplam ({lines.length} satır){currency ? ` · ${currency}` : ''}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(entry.total)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(entry.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      {voiding && <VoidDialog entry={entry} onClose={() => setVoiding(false)} />}
    </div>
  );
}

/** Fiş iptali: sebep + ters kaydın günü (varsayılan bugün). @param {{ entry: any, onClose: () => void }} props */
function VoidDialog({ entry, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPost(`/ledger/journals/${entry.id}/void`, body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(`${entry.number} iptal edildi; ters fiş ${result.reversal?.number ?? ''} yazıldı`.trim());
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });
  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = { expectedUpdatedAt: entry.updatedAt, reason, date: date || undefined };
    const checked = validateWith(journalVoidSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }
  const busy = save.isPending;
  return (
    <Modal
      open
      size="md"
      title={`${entry.number} iptali`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="journal-void-form" icon="rotateCcw" disabled={busy}>
            {busy ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      <form id="journal-void-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="İptal edilmedi">
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">Fiş silinmez: durumu "İptal edildi" olur ve seçilen günde bütün satırları ters çeviren bir fiş yazılır. Dönem kilidi içindeki güne ters fiş yazılamaz.</p>
        <Input label="Ters kaydın günü" type="date" value={date} min={entry.date} max={today} onChange={(event) => setDate(event.target.value)} error={errors.date} disabled={busy} className="sm:w-48" />
        <Textarea label="İptal sebebi" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
      </form>
    </Modal>
  );
}
