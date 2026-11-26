import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_JOURNAL_LINES, journalBalance, journalCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { newRequestId } from '../../lib/reservations.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { GlAccountField } from './GlAccountField.jsx';

let lineKey = 0;
const emptyLine = () => ({ key: ++lineKey, account: null, debit: '', credit: '', description: '' });
const normalizeAmount = (value) => String(value ?? '').trim().replace(',', '.');

/**
 * Elle yevmiye fişi (modül 48): gün, açıklama, belge no ve satırlar — hesap seçici, borç ya da alacak (biri dolu),
 * satır açıklaması. Alt bilgide canlı toplam borç / alacak / fark; borç = alacak değilse Kaydet kapalı. Form
 * açılırken üretilen istek kimliği çift gönderimde ikinci fişi engeller; başarıda fiş sayfasına gidilir.
 *
 * @param {{ onClose: () => void }} props
 */
export function JournalDialog({ onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { today } = useHotelToday();
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency ?? '';
  const [requestId] = useState(newRequestId);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState(() => [emptyLine(), emptyLine()]);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const balance = journalBalance(lines.map((line) => ({ debit: normalizeAmount(line.debit), credit: normalizeAmount(line.credit) })));
  const setLine = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const save = useMutation({
    mutationFn: (body) => apiPost('/ledger/journals', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(result.created ? `${result.entry.number} işlendi` : 'Bu fiş zaten kaydedilmişti; ikinci kez yazılmadı');
      onClose();
      navigate(`/genel-muhasebe/yevmiye/${result.entry.id}`);
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      requestId,
      date,
      description,
      reference: reference || null,
      lines: lines.map((line) => ({
        accountId: line.account?.id ?? '',
        debit: normalizeAmount(line.debit) || null,
        credit: normalizeAmount(line.credit) || null,
        description: line.description || null,
      })),
    };
    const checked = validateWith(journalCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const canSubmit = balance.balanced && !busy;
  return (
    <Modal
      open
      size="xl"
      title="Yevmiye fişi gir"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <dl className="mr-auto grid grid-cols-3 gap-x-5 text-sm tabular-nums">
            <dt className="text-xs uppercase tracking-[0.06em] text-ink-muted">Borç</dt>
            <dt className="text-xs uppercase tracking-[0.06em] text-ink-muted">Alacak</dt>
            <dt className="text-xs uppercase tracking-[0.06em] text-ink-muted">Fark</dt>
            <dd className="font-semibold text-ink">{formatMoney(balance.debit, currency)}</dd>
            <dd className="font-semibold text-ink">{formatMoney(balance.credit, currency)}</dd>
            <dd className={`font-semibold ${balance.balanced ? 'text-success-ink' : 'text-sec-strong'}`}>{balance.balanced ? 'Dengeli' : formatMoney(balance.difference, currency)}</dd>
          </dl>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="journal-form" icon="check" disabled={!canSubmit}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="journal-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="Fiş işlenmedi">
            {serverError.message}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Input label="Fiş günü" type="date" name="journal-date" value={date} max={today} onChange={(event) => setDate(event.target.value)} error={errors.date} disabled={busy} />
          <Input label="Açıklama" name="journal-description" value={description} onChange={(event) => setDescription(event.target.value)} error={errors.description} disabled={busy} className="sm:col-span-2" />
          <Input label="Belge no (isteğe bağlı)" name="journal-reference" value={reference} onChange={(event) => setReference(event.target.value)} error={errors.reference} disabled={busy} />
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-1 gap-3 rounded-item border border-line bg-surface-muted p-3 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <GlAccountField label={`Satır ${index + 1} · hesap`} value={line.account} onChange={(account) => setLine(line.key, { account })} error={errors[`lines.${index}.accountId`]} disabled={busy} />
              </div>
              <Input label="Borç" inputMode="decimal" value={line.debit} onChange={(event) => setLine(line.key, { debit: event.target.value, credit: event.target.value ? '' : line.credit })} error={errors[`lines.${index}.debit`]} disabled={busy} className="sm:col-span-2" />
              <Input label="Alacak" inputMode="decimal" value={line.credit} onChange={(event) => setLine(line.key, { credit: event.target.value, debit: event.target.value ? '' : line.debit })} error={errors[`lines.${index}.credit`]} disabled={busy} className="sm:col-span-2" />
              <Input label="Satır açıklaması" value={line.description} onChange={(event) => setLine(line.key, { description: event.target.value })} error={errors[`lines.${index}.description`]} disabled={busy} className="sm:col-span-2" />
              <div className="flex items-end justify-end sm:col-span-1">
                <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={`Satır ${index + 1} sil`} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} disabled={busy || lines.length <= 2} />
              </div>
            </div>
          ))}
          {errors.lines && <p className="text-xs font-semibold text-sec-strong">{errors.lines}</p>}
          <div>
            <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setLines((current) => [...current, emptyLine()])} disabled={busy || lines.length >= MAX_JOURNAL_LINES}>
              Satır ekle
            </Button>
          </div>
        </div>
        <p className="text-xs text-ink-muted">Her satırda borç ya da alacaktan yalnız biri dolu olur. Dönem kilidi öncesine fiş girilemez; fiş silinmez, gerekirse iptal edilip ters fişi yazılır.</p>
      </form>
    </Modal>
  );
}
