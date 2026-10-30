import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPENING_SIDES, OPENING_SIDE_LABELS, openingBalanceSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { accountingKeys } from '../../lib/accounting.js';
import { api, apiPost } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * Açılış bakiyesi (modül 47): başlangıç gününden önceki durum — cariye borç / alacak (vadesiyle), kasa / bankaya
 * giriş. Başlangıç gününden bir gün önce tarihli yazılır; hesap başına bir tane (düzeltmek için fişi iptal edin).
 *
 * @param {{ target: { kind: 'ledger' | 'treasury', id: string, name: string }, onClose: () => void }} props
 */
export function OpeningDialog({ target, onClose }) {
  const queryClient = useQueryClient();
  const [requestId] = useState(newRequestId);
  const [side, setSide] = useState('DEBIT');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const settings = useQuery({ queryKey: accountingKeys.settings, queryFn: () => api('/accounting/settings') });
  const ledger = target.kind === 'ledger';
  const save = useMutation({
    mutationFn: (body) => apiPost('/accounting/vouchers/opening', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(`${target.name} açılış bakiyesi işlendi (${result.voucher.number})`);
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
    const body = {
      requestId,
      ...(ledger ? { ledgerAccountId: target.id, side, dueDate: side === 'DEBIT' && dueDate ? dueDate : null } : { treasuryAccountId: target.id, side: 'DEBIT' }),
      amount: String(amount).trim().replace(',', '.'),
      description: description || null,
    };
    const checked = validateWith(openingBalanceSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const startDate = settings.data?.settings.startDate;
  return (
    <Modal
      open
      size="md"
      title={`Açılış bakiyesi — ${target.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="opening-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'İşle'}
          </Button>
        </>
      }
    >
      <form id="opening-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="İşlenmedi">
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">
          Muhasebe başlangıç günü {startDate ? formatDate(startDate) : '…'}; bundan önceki tahsilat, mal kabul ve aktarımlar otomatik işlenmez. Hesabın o günden önceki durumunu buraya girin.
        </p>
        {ledger && (
          <Select label="Yön" value={side} onChange={(event) => setSide(event.target.value)} options={OPENING_SIDES.map((value) => ({ value, label: OPENING_SIDE_LABELS[value] }))} error={errors.side} disabled={busy} />
        )}
        <Input label={ledger ? 'Tutar' : 'Kasa / banka bakiyesi'} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} error={errors.amount} disabled={busy} autoFocus />
        {ledger && side === 'DEBIT' && (
          <Input label="Vade (yaşlandırma için, isteğe bağlı)" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} error={errors.dueDate} disabled={busy} />
        )}
        <Input label="Açıklama (isteğe bağlı)" value={description} onChange={(event) => setDescription(event.target.value)} error={errors.description} disabled={busy} />
      </form>
    </Modal>
  );
}
