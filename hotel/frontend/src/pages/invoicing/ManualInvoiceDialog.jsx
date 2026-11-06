import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceDraftCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { invoiceKeys } from '../../lib/invoicing.js';
import { validateWith } from '../../lib/validate.js';
import { LedgerAccountField } from '../accounting/LedgerAccountField.jsx';
import { LinesEditor, emptyInvoiceLine } from './LinesEditor.jsx';

/**
 * Cariye serbest fatura taslağı (modül 16 / 49): toplantı salonu kirası, komisyon dışı hizmet gibi folyo ve etkinlik
 * dışı satışlar. Kesilince cariye vadeli alacak yazılır (ön muhasebe). Alıcı carinin kartından gelir; taslakta
 * düzenlenir.
 *
 * @param {{ onClose: () => void }} props
 */
export function ManualInvoiceDialog({ onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState(null);
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPost('/invoices', body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      navigate(`/faturalar/${data.invoice.id}`);
    },
    onError: (error) => setServerError(error),
  });
  function submit(event) {
    event.preventDefault();
    const body = { source: 'MANUAL', ledgerAccountId: account?.id, lines, note };
    const checked = validateWith(invoiceDraftCreateSchema, body);
    if (!checked.ok) return setErrors({ ...checked.errors, ...(account ? {} : { ledgerAccountId: 'Cari seçin' }) });
    setErrors({});
    save.mutate(checked.data);
  }
  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title="Serbest fatura"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="manual-invoice-form" icon="check" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Taslak aç'}
          </Button>
        </>
      }
    >
      <form id="manual-invoice-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="Taslak açılmadı">
            {serverError.message}
          </Alert>
        )}
        <LedgerAccountField label="Alıcı cari" value={account} onChange={setAccount} error={errors.ledgerAccountId} disabled={busy} />
        <LinesEditor lines={lines} onChange={setLines} errors={errors} disabled={busy} />
        <Textarea label="Not (faturada görünür)" rows={2} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
        <p className="text-xs text-ink-muted">Taslak kesilmeden önce alıcı bilgileri (adres, vergi dairesi) ve toplamlar fatura ekranında kontrol edilir. Kesilince cariye vadeli alacak yazılır.</p>
      </form>
    </Modal>
  );
}
