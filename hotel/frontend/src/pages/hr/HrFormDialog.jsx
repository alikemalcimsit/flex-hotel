import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { hrKeys } from '../../lib/hr.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * İK iletişim kutularının ortak kabuğu ve gönderimi (modül 52): şemayla doğrula → istek → `hr` sorgularını tazele →
 * kapat. Sunucunun alan hataları alanların altına, genel hata üstteki uyarıya düşer.
 */

/**
 * @param {{
 *   title: string, formId: string, busy: boolean, onClose: () => void, submitLabel: string,
 *   serverError?: Error | null, children: React.ReactNode, size?: 'sm' | 'md' | 'lg' | 'xl',
 *   submitDisabled?: boolean, submitIcon?: string, submitVariant?: 'primary' | 'danger',
 * }} props
 */
export function HrFormDialog({ title, formId, busy, onClose, submitLabel, serverError, children, size = 'md', submitDisabled = false, submitIcon = 'check', submitVariant = 'primary' }) {
  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} variant={submitVariant} icon={submitIcon} disabled={busy || submitDisabled}>
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
 * }} options
 */
export function useHrDialogSubmit({ schema = null, request, success, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toastSuccess(typeof success === 'function' ? success(result) : success);
      onSuccess?.(result);
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
  return { submit, errors, setErrors, serverError, busy: mutation.isPending };
}
