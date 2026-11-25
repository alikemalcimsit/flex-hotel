import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GL_ACCOUNT_CLASS_LABELS, GL_CODE_PATTERN, GL_DEPARTMENTS, GL_DEPARTMENT_LABELS, glAccountCreateSchema, glAccountUpdateSchema, glClassOfCode, parentCodeOf } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost, apiPut } from '../../lib/api.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const DEPARTMENT_OPTIONS = [{ value: '', label: 'Departmansız' }, ...GL_DEPARTMENTS.map((value) => ({ value, label: GL_DEPARTMENT_LABELS[value] }))];

/**
 * Hesap aç / düzenle (modül 48, `ledger.setup`). Açarken kod üst hesabı belirler ("100.01" → 100 altı) ve sınıf
 * koddan türer; üst hesap yoksa uyarılır. Düzenlemede kod ve üst değişmez (hareket izi); ad, departman ve
 * etkinlik değişir.
 *
 * @param {{ account: any | null, parentCode?: string, accounts: Array<{ code: string, name: string, hasLines?: boolean }>, onClose: () => void }} props
 */
export function GlAccountDialog({ account, parentCode, accounts, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => ({
    code: account?.code ?? (parentCode ? `${parentCode}.` : ''),
    name: account?.name ?? '',
    department: account?.department ?? '',
    isActive: account?.isActive ?? true,
  }));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (account ? apiPut(`/ledger/chart/${account.id}`, body) : apiPost('/ledger/chart', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(account ? `${result.account.code} güncellendi` : `${result.account.code} ${result.account.name} açıldı`);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? 'Hesap bu arada değişti; yenileyip tekrar açın.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const department = values.department || null;
    const body = account
      ? { expectedUpdatedAt: account.updatedAt, name: values.name, department, isActive: values.isActive }
      : { code: values.code.trim(), name: values.name, department };
    const checked = validateWith(account ? glAccountUpdateSchema : glAccountCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const code = values.code.trim();
  const isCodeValid = GL_CODE_PATTERN.test(code);
  const parentCodeValue = isCodeValid ? parentCodeOf(code) : null;
  const parent = parentCodeValue ? accounts.find((row) => row.code === parentCodeValue) : null;
  const busy = save.isPending;
  return (
    <Modal
      open
      size="md"
      title={account ? `${account.code} · ${account.name}` : 'Hesap aç'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="gl-account-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="gl-account-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {account ? (
          <p className="text-sm text-ink-soft sm:col-span-2">
            Kod ve üst hesap değişmez. Sınıf: {GL_ACCOUNT_CLASS_LABELS[account.class] ?? account.class}
            {account.isSystem ? ' · sistem hesabı' : ''}
          </p>
        ) : (
          <>
            <Input label="Hesap kodu" value={values.code} onChange={set('code')} placeholder='"100.01", "600.02"' error={errors.code} disabled={busy} />
            <div className="flex flex-col justify-end gap-1 text-xs text-ink-muted">
              {isCodeValid && <span>Sınıf: {GL_ACCOUNT_CLASS_LABELS[glClassOfCode(code)]}</span>}
              {parentCodeValue && (parent ? <span>Üst hesap: {parent.code} {parent.name}</span> : <span className="font-semibold text-warning-ink">Üst hesap ({parentCodeValue}) yok — önce onu açın.</span>)}
              {parent?.hasLines && <span className="font-semibold text-warning-ink">Üst hesabın hareketi var; alt hesap açılamaz.</span>}
            </div>
          </>
        )}
        <Input label="Hesap adı" value={values.name} onChange={set('name')} error={errors.name} disabled={busy} className="sm:col-span-2" />
        <Select label="Departman (USALI)" value={values.department} onChange={set('department')} options={DEPARTMENT_OPTIONS} error={errors.department} disabled={busy} />
        {account && (
          <Checkbox
            label="Etkin"
            hint="Pasif hesap seçicide görünmez; geçmiş hareketleri ve ekstresi durur."
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy}
            className="sm:col-span-2"
          />
        )}
        {!account && (
          <Alert tone="info" className="sm:col-span-2">
            Yalnız yaprak hesaba (altı olmayan) fiş satırı yazılır. Üst hesap alt hesap açılınca kendiliğinden toplam hesabı olur.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
