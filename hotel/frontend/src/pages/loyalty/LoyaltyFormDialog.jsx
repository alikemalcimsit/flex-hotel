import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { loyaltyKeys } from '../../lib/loyalty.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * Sadakat iletişim kutularının ortak kabuğu ve gönderimi (modül 56): şemayla doğrula → istek → `loyalty` sorgularını
 * tazele → kapat. Sunucunun alan hataları alanların altına, genel hata (bakiye, sınır, açık folyo yok) üstteki uyarıya.
 * @param {{
 *   title: string, formId: string, busy: boolean, onClose: () => void, submitLabel: string, submitIcon?: string,
 *   serverError?: Error | null, submitDisabled?: boolean, children: React.ReactNode,
 * }} props
 */
export function LoyaltyFormDialog({ title, formId, busy, onClose, submitLabel, submitIcon = 'check', serverError, submitDisabled = false, children }) {
  return (
    <Modal
      open
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} icon={submitIcon} disabled={busy || submitDisabled}>
            {busy ? 'Kaydediliyor…' : submitLabel}
          </Button>
        </>
      }
    >
      {serverError && (
        <Alert tone="danger" title="Yapılmadı" className="mb-4">
          {serverError.message}
        </Alert>
      )}
      {children}
    </Modal>
  );
}

/**
 * @param {{
 *   schema?: { safeParse: (input: unknown) => any } | null,
 *   request: (body: any) => Promise<any>,
 *   success: string | ((result: any) => string),
 *   onClose: () => void,
 *   onSuccess?: (result: any) => void,
 *   invalidate?: unknown[][],
 * }} options `invalidate`: `loyalty` dışında tazelenecek anahtarlar (örn. folyo)
 */
export function useLoyaltySubmit({ schema = null, request, success, onClose, onSuccess, invalidate = [] }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      onSuccess?.(result);
      for (const queryKey of [loyaltyKeys.all, ...invalidate]) queryClient.invalidateQueries({ queryKey });
      toastSuccess(typeof success === 'function' ? success(result) : success);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      const fields = error.fields && Object.keys(error.fields).length ? error.fields : error.details?.fields;
      if (fields) setErrors(fields);
    },
  });
  /** @param {unknown} body */
  const submit = (body) => {
    const checked = schema ? validateWith(schema, body) : { ok: true, data: body };
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setServerError(null);
    mutation.mutate(checked.data);
  };
  return { submit, errors, serverError, busy: mutation.isPending };
}
