import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { reviewKeys } from '../../lib/reviews.js';
import { validateWith } from '../../lib/validate.js';

/**
 * Yorum iletişim kutularının ortak kabuğu (modül 54): Vazgeç + gönder düğmesi, sunucunun genel hatası üstte.
 * @param {{
 *   title: string, formId?: string, busy?: boolean, onClose: () => void, submitLabel?: string, submitIcon?: string,
 *   serverError?: Error | null, submitDisabled?: boolean, size?: 'sm' | 'md' | 'lg' | 'xl', footer?: React.ReactNode, children: React.ReactNode,
 * }} props
 */
export function ReviewDialog({ title, formId, busy = false, onClose, submitLabel, submitIcon = 'check', serverError, submitDisabled = false, size = 'md', footer, children }) {
  return (
    <Modal
      open
      title={title}
      size={size}
      onClose={busy ? () => {} : onClose}
      footer={
        footer ?? (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {submitLabel ? 'Vazgeç' : 'Kapat'}
            </Button>
            {submitLabel && (
              <Button type="submit" form={formId} icon={submitIcon} disabled={busy || submitDisabled}>
                {busy ? 'Kaydediliyor…' : submitLabel}
              </Button>
            )}
          </>
        )
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
 * Şemayla doğrula → istek → `reviews` sorgularını tazele → `onSuccess`. Alan hataları alanların altına.
 * @param {{ schema: { safeParse: (input: unknown) => any }, request: (body: any) => Promise<any>, onSuccess: (result: any) => void }} options
 */
export function useReviewSubmit({ schema, request, onSuccess }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(/** @type {Error | null} */ (null));
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      onSuccess(result);
    },
    onError: (error) => {
      setServerError(error);
      const fields = error.fields && Object.keys(error.fields).length ? error.fields : error.details?.fields;
      if (fields) setErrors(fields);
    },
  });
  /** @param {unknown} body */
  const submit = (body) => {
    const checked = validateWith(schema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setServerError(null);
    mutation.mutate(checked.data);
  };
  return { submit, errors, serverError, busy: mutation.isPending };
}
