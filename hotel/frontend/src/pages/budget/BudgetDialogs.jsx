import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUDGET_MAX_EXPENSE_ITEMS,
  BUDGET_REASON_MAX,
  budgetExpenseItemSchema,
  reviseBudgetSchema,
  updateBudgetExpenseItemSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiDelete, apiPatch, apiPost } from '../../lib/api.js';
import { budgetKeys } from '../../lib/budget.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const staleText = 'Kalem bu arada başkası tarafından değiştirildi; liste yenilendi, tekrar deneyin.';

/**
 * Gider kalemleri (modül 27): ekle, adını değiştir, kaldır (arşiv: açık
 * taslaklardan düşer, onaylı bütçelerde ve gerçekleşenlerde kalır).
 * @param {{ onClose: () => void }} props
 */
export function ExpenseItemsDialog({ onClose }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: budgetKeys.expenseItems, queryFn: () => api('/budgets/expense-items') });
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: budgetKeys.all });
  const add = useMutation({
    mutationFn: (body) => apiPost('/budgets/expense-items', body),
    onSuccess: () => {
      setLabel('');
      toastSuccess('Gider kalemi eklendi');
      refresh();
    },
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(budgetExpenseItemSchema, { label });
    if (!checked.ok) return setError(checked.errors.label);
    setError('');
    add.mutate(checked.data);
  }

  const items = list.data ?? [];
  return (
    <Modal open size="md" title="Gider kalemleri" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Otelin gider kalemleri bütün yıllarda ortaktır. Kaldırılan kalem açık taslaklardan düşer; onaylı bütçelerde ve girilmiş gerçekleşenlerde
          kalır. En fazla {BUDGET_MAX_EXPENSE_ITEMS} kalem.
        </p>
        {list.isPending && <Spinner className="py-6" />}
        {list.isError && <Alert tone="danger" title="Kalemler yüklenemedi">{list.error.message}</Alert>}
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <ExpenseItemRow key={item.item} item={item} onChanged={refresh} />
          ))}
        </ul>
        <form className="flex items-end gap-2" onSubmit={submit} noValidate>
          <Input label="Yeni kalem" value={label} onChange={(event) => setLabel(event.target.value)} error={error || add.error?.message} className="flex-1" />
          <Button type="submit" icon="plus" disabled={add.isPending || items.length >= BUDGET_MAX_EXPENSE_ITEMS}>
            Ekle
          </Button>
        </form>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** @param {{ item: { item: string, label: string, updatedAt: string }, onChanged: () => void }} props */
function ExpenseItemRow({ item, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const rename = useMutation({
    mutationFn: (body) => apiPatch(`/budgets/expense-items/${item.item}`, body),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (failure) => {
      setError(failure.code === 'STALE_WRITE' ? staleText : failure.message);
      if (failure.code === 'STALE_WRITE') onChanged();
    },
  });
  const archive = useMutation({
    mutationFn: () => apiDelete(`/budgets/expense-items/${item.item}`),
    onSuccess: () => {
      toastSuccess(`"${item.label}" kaldırıldı`);
      onChanged();
    },
    onError: (failure) => setError(failure.message),
  });

  function save(event) {
    event.preventDefault();
    const checked = validateWith(updateBudgetExpenseItemSchema, { label, expectedUpdatedAt: item.updatedAt });
    if (!checked.ok) return setError(checked.errors.label ?? 'Geçersiz');
    setError('');
    rename.mutate(checked.data);
  }

  if (editing) {
    return (
      <li className="py-2">
        <form className="flex items-end gap-2" onSubmit={save} noValidate>
          <Input label="Kalem adı" value={label} onChange={(event) => setLabel(event.target.value)} error={error} className="flex-1" />
          <Button type="submit" size="sm" icon="check" disabled={rename.isPending}>
            Kaydet
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Vazgeç
          </Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="font-semibold text-ink">{item.label}</span>
      {confirming ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Kaldırılsın mı?</span>
          <Button size="sm" variant="danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            Kaldır
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(true)} aria-label={`${item.label} adını değiştir`}>
            Ad
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirming(true)} aria-label={`${item.label} kalemini kaldır`}>
            Kaldır
          </Button>
        </span>
      )}
      {error && <p className="w-full text-sm text-danger-ink">{error}</p>}
    </li>
  );
}

/**
 * Onaylı bütçenin revize taslağını açar (gerekçe zorunlu; onaylı satırlar kopyalanır).
 * @param {{ year: number, onClose: () => void, onDone: () => void }} props
 */
export function ReviseDialog({ year, onClose, onDone }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const revise = useMutation({
    mutationFn: (body) => apiPost(`/budgets/${year}/revise`, body),
    onSuccess: () => {
      toastSuccess('Revize taslağı açıldı; onaylanana kadar onaylı bütçe geçerli');
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      onDone();
      onClose();
    },
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(reviseBudgetSchema, { reason });
    if (!checked.ok) return setError(checked.errors.reason);
    setError('');
    revise.mutate(checked.data);
  }

  return (
    <Modal open size="sm" title={`${year} bütçesini revize et`} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {revise.error && <Alert tone="danger" title="Revize açılamadı">{revise.error.message}</Alert>}
        <p className="text-sm text-ink-soft">
          Onaylı bütçenin kopyası taslak olarak açılır. Revize onaylanana kadar sapma raporu onaylı bütçeye göre çıkar; onaylanınca eski sürüm
          saklanır.
        </p>
        <Textarea label="Revize gerekçesi" value={reason} onChange={(event) => setReason(event.target.value)} error={error} maxLength={BUDGET_REASON_MAX} rows={3} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" icon="pencil" disabled={revise.isPending}>
            Revize aç
          </Button>
        </div>
      </form>
    </Modal>
  );
}
