import { Alert, Button } from '@hotelos/ui';
import { Modal } from './Modal.jsx';

/**
 * Geri alınamaz işlemler için onay diyaloğu.
 *
 * `details` alanı, silme işlemi engellendiğinde backend'in döndüğü kullanım
 * sayılarını göstermek için: kullanıcı "silinemez" cevabını alınca *neyin*
 * engellediğini görmeli.
 *
 * @param {{
 *   open: boolean, title: string, message: string, confirmLabel?: string,
 *   onConfirm: () => void, onClose: () => void, isPending?: boolean, error?: Error | null,
 * }} props
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Sil',
  onConfirm,
  onClose,
  isPending = false,
  error = null,
}) {
  const usage = error?.details?.usage;

  return (
    <Modal
      open={open}
      title={title}
      onClose={isPending ? () => {} : onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="danger" icon="trash" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'İşleniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">{message}</p>

      {error && (
        <Alert tone="danger" className="mt-5">
          <p>{error.message}</p>
          {usage && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {Object.entries(usage).map(([key, count]) => (
                <li key={key}>
                  {key}: {count}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </Modal>
  );
}
