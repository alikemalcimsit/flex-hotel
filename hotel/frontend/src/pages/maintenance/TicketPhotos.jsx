import { useRef, useState } from 'react';
import { MAINTENANCE_MAX_PHOTOS } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useProtectedImage } from '../../lib/lost-items.js';
import { photoPath, preparePhoto } from '../../lib/maintenance.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Liste / galeri küçük görüntüsü. */
export function TicketThumb({ ticketId, photoId, alt, className = 'size-14' }) {
  const image = useProtectedImage(photoId ? photoPath(ticketId, photoId, 'thumb') : null);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-item border border-line bg-surface-muted ${className}`}>
      {image.url ? (
        <img src={image.url} alt={alt} className="size-full object-cover" />
      ) : image.isPending ? (
        <Spinner />
      ) : (
        <Icon name={image.isError ? 'alertTriangle' : 'wrench'} className="size-5 text-ink-muted" />
      )}
    </span>
  );
}

/**
 * Fotoğraf seçici: telefonda arka kamerayı açar, masaüstünde dosya seçtirir.
 * @param {{ remaining: number, disabled?: boolean, onPrepared: (photo: any) => Promise<void> | void }} props
 */
export function PhotoPicker({ remaining, disabled = false, onPrepared }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(event) {
    const files = [...(event.target.files ?? [])].slice(0, remaining);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (const file of files) {
        try {
          await onPrepared(await preparePhoto(file));
        } catch (error) {
          toastError(error.message || 'Fotoğraf eklenemedi');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onFiles} />
      <Button type="button" variant="outline" icon="camera" disabled={disabled || busy || remaining <= 0} onClick={() => inputRef.current?.click()}>
        {busy ? 'Fotoğraf hazırlanıyor…' : remaining <= 0 ? `En fazla ${MAINTENANCE_MAX_PHOTOS} fotoğraf` : 'Fotoğraf ekle'}
      </Button>
    </>
  );
}

/**
 * Bilet fotoğraf galerisi.
 * @param {{ ticket: any, canEdit: boolean, onUpload: (photo: any) => Promise<void>, onRemove: (photoId: string) => Promise<void>, removing?: boolean }} props
 */
export function TicketGallery({ ticket, canEdit, onUpload, onRemove, removing = false }) {
  const [viewing, setViewing] = useState(null);
  const [toRemove, setToRemove] = useState(null);
  const remaining = MAINTENANCE_MAX_PHOTOS - ticket.photos.length;

  async function upload(photo) {
    await onUpload(photo);
    toastSuccess('Fotoğraf eklendi');
  }

  async function confirmRemove() {
    await onRemove(toRemove.id);
    toastSuccess('Fotoğraf silindi');
    setToRemove(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {ticket.photos.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-item border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-muted">
          <Icon name="camera" className="size-6" />
          Fotoğraf yok.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ticket.photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              <button type="button" className="block w-full" onClick={() => setViewing(photo)} aria-label={`Fotoğraf ${index + 1}: büyüt`}>
                <TicketThumb ticketId={ticket.id} photoId={photo.id} alt={`${ticket.title} — fotoğraf ${index + 1}`} className="aspect-square w-full" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Fotoğraf ${index + 1}: sil`}
                  onClick={() => setToRemove(photo)}
                  className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <div><PhotoPicker remaining={remaining} onPrepared={upload} /></div>}

      {viewing && <PhotoViewer ticket={ticket} photo={viewing} onClose={() => setViewing(null)} />}
      {toRemove && (
        <ConfirmDialog
          open
          title="Fotoğraf silinsin mi?"
          message="Yanlış çekilen fotoğrafı siler; geri alınamaz."
          confirmLabel="Sil"
          confirmIcon="trash"
          onConfirm={confirmRemove}
          onClose={() => setToRemove(null)}
          isPending={removing}
        />
      )}
    </div>
  );
}

function PhotoViewer({ ticket, photo, onClose }) {
  const image = useProtectedImage(photoPath(ticket.id, photo.id, 'full'));
  return (
    <Modal open size="lg" title={`${ticket.title} · fotoğraf`} onClose={onClose}>
      {image.url ? (
        <img src={image.url} alt={ticket.title} className="mx-auto max-h-[70vh] w-auto rounded-item" />
      ) : image.isError ? (
        <Alert tone="danger" title="Fotoğraf açılamadı">Dosya bulunamadı ya da bağlantı kesildi.</Alert>
      ) : (
        <Spinner className="py-10" />
      )}
    </Modal>
  );
}
