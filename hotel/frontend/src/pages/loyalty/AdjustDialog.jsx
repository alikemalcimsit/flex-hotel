import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loyaltyAdjustSchema } from '@hotelos/hotel-contracts';
import { Input, Textarea } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { loyaltyKeys, pointsText } from '../../lib/loyalty.js';
import { LoyaltyFormDialog, useLoyaltySubmit } from './LoyaltyFormDialog.jsx';

/**
 * Elle puan düzeltmesi (modül 56, `loyalty.manage`): artı yeni puan lotu açar, eksi en eski puandan düşer.
 * Gerekçe zorunlu; hareketlerde "Elle düzeltme" olarak görünür.
 * @param {{ account: { id: string, number: string, balance: number }, onClose: () => void }} props
 */
export function AdjustDialog({ account, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ points: '', reason: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useLoyaltySubmit({
    schema: loyaltyAdjustSchema,
    request: (body) => apiPost(`/loyalty/accounts/${account.id}/adjust`, body),
    success: (result) => `Düzeltme kaydedildi; yeni bakiye ${pointsText(result.account.balance)}`,
    onSuccess: (result) => queryClient.setQueryData(loyaltyKeys.account(account.id), result),
    onClose,
  });
  return (
    <LoyaltyFormDialog title={`Puan düzeltmesi: ${account.number}`} formId="loyalty-adjust-form" busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError}>
      <form
        id="loyalty-adjust-form"
        noValidate
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ points: values.points.trim().replace('−', '-'), reason: values.reason });
        }}
      >
        <Input label="Puan (+ ekler, − düşer)" name="loyalty-adjust-points" inputMode="numeric" placeholder="örn. 500 ya da -200" value={values.points} onChange={set('points')} error={errors.points} disabled={busy} />
        <Textarea label="Gerekçe" name="loyalty-adjust-reason" rows={2} placeholder="Şikâyet telafisi, hatalı kazanma düzeltmesi…" value={values.reason} onChange={set('reason')} error={errors.reason} disabled={busy} />
        <p className="text-xs text-ink-muted">Şu anki bakiye {pointsText(account.balance)}. Eksi düzeltme bakiyeden fazla olamaz.</p>
      </form>
    </LoyaltyFormDialog>
  );
}
