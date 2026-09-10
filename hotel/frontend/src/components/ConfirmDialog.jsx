import { Button } from '@hotelos/ui';
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
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'İşleniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">{message}</p>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error.message}</p>
          {usage && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600">
              {Object.entries(usage).map(([key, count]) => (
                <li key={key}>
                  {key}: {count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
