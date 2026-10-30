import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LEDGER_ACCOUNT_TYPE_LABELS, MANUAL_LEDGER_ACCOUNT_TYPES, MAX_LEDGER_TERM_DAYS, ledgerAccountCreateSchema, ledgerAccountUpdateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { accountingKeys } from '../../lib/accounting.js';
import { apiPost, apiPut } from '../../lib/api.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Cari aç / düzenle (modül 47). Elle açılan cari şirket, şahıs ya da diğer olur; acente / tedarikçi / etkinlik
 * müşterisinin carisi kartından bağlanır — onun ünvan, vergi ve iletişim bilgisi kartından gelir, burada yalnız
 * not, kullanım ve (etkinlik müşterisinde) vade değişir.
 *
 * @param {{ account: any | null, onClose: () => void, onSaved?: (result: any) => void }} props
 */
export function AccountDialog({ account, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const linked = Boolean(account?.linked);
  const termEditable = !linked || account?.linked?.kind === 'EVENT_CLIENT';
  const [values, setValues] = useState(() => ({
    type: account?.type ?? 'COMPANY',
    code: account?.code ?? '',
    name: account?.name ?? '',
    taxOffice: account?.taxOffice ?? '',
    taxNumber: account?.taxNumber ?? '',
    contactName: account?.contactName ?? '',
    phone: account?.phone ?? '',
    email: account?.email ?? '',
    address: account?.address ?? '',
    paymentTermDays: String(account?.paymentTermDays ?? 0),
    notes: account?.notes ?? '',
    isActive: account?.isActive ?? true,
  }));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (account ? apiPut(`/accounting/accounts/${account.id}`, body) : apiPost('/accounting/accounts', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(account ? `${result.account.name} güncellendi` : `${result.account.name} carisi açıldı (${result.account.code})`);
      onSaved?.(result);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') {
        queryClient.invalidateQueries({ queryKey: accountingKeys.all });
        toastError('Cari bu arada değişti; ekran yenilendi, tekrar açın.');
      }
    },
  });

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    if (String(values.paymentTermDays).trim() === '') return setErrors({ paymentTermDays: 'Vade yazın (0 = peşin)' });
    const { type, isActive, ...rest } = values;
    const body = account ? { ...rest, isActive, expectedUpdatedAt: account.updatedAt } : { ...rest, type };
    const checked = validateWith(account ? ledgerAccountUpdateSchema : ledgerAccountCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={account ? `${account.name} · ${account.code}` : 'Yeni cari'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="ledger-account-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="ledger-account-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {serverError && !serverError.fields && (
          <Alert tone="danger" title="Kaydedilmedi" className="sm:col-span-2">
            {serverError.message}
          </Alert>
        )}
        {linked && (
          <Alert tone="info" title="Karta bağlı cari" className="sm:col-span-2">
            Ünvan, vergi ve iletişim bilgisi {account.linked.kind === 'AGENCY' ? 'acente' : account.linked.kind === 'SUPPLIER' ? 'tedarikçi' : 'etkinlik müşterisi'} kartından gelir; orada değişince cariye de yansır.
          </Alert>
        )}
        {!account && (
          <Select
            label="Tür"
            name="account-type"
            value={values.type}
            onChange={set('type')}
            options={MANUAL_LEDGER_ACCOUNT_TYPES.map((value) => ({ value, label: LEDGER_ACCOUNT_TYPE_LABELS[value] }))}
            error={errors.type}
            disabled={busy}
          />
        )}
        <Input label="Cari kodu (boşsa otomatik)" name="account-code" value={values.code} onChange={set('code')} error={errors.code} disabled={busy || linked} />
        <Input label="Ünvan" name="account-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy || linked} className="sm:col-span-2" />
        <Input label="Vergi dairesi" name="account-tax-office" value={values.taxOffice} onChange={set('taxOffice')} error={errors.taxOffice} disabled={busy || linked} />
        <Input label="Vergi no / T.C. kimlik no" name="account-tax-number" inputMode="numeric" value={values.taxNumber} onChange={set('taxNumber')} error={errors.taxNumber} disabled={busy || linked} />
        <Input label="Yetkili" name="account-contact" value={values.contactName} onChange={set('contactName')} error={errors.contactName} disabled={busy || linked} />
        <Input label="Telefon" name="account-phone" type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} disabled={busy || linked} />
        <Input label="E-posta" name="account-email" type="email" value={values.email} onChange={set('email')} error={errors.email} disabled={busy || linked} />
        <Input
          label={`Alacak vadesi (gün, en fazla ${MAX_LEDGER_TERM_DAYS})`}
          name="account-term"
          inputMode="numeric"
          value={values.paymentTermDays}
          onChange={set('paymentTermDays')}
          error={errors.paymentTermDays}
          disabled={busy || !termEditable}
        />
        <Textarea label="Adres" name="account-address" rows={2} value={values.address} onChange={set('address')} error={errors.address} disabled={busy || linked} className="sm:col-span-2" />
        <Textarea label="Not" name="account-notes" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} className="sm:col-span-2" />
        {account && (
          <Checkbox
            label="Kullanımda"
            hint="Kullanımdan kalkan cari seçicide görünmez; bakiyesi olan cari kaldırılamaz."
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy}
            className="sm:col-span-2"
          />
        )}
      </form>
    </Modal>
  );
}
