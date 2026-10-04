import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LOST_ITEM_MAX_PHOTOS } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiDelete, apiPost } from '../../lib/api.js';
import { photoPath, preparePhoto, useProtectedImage } from '../../lib/lost-items.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Kayıp eşya fotoğrafları (modül 21): oturumla okunan önizleme, büyük
 * görünüm, ekleme (telefonda kamerayı açar) ve silme.
 */

/**
 * Liste satırının küçük görüntüsü (yoksa kategori simgesi).
 * @param {{ itemId: string, photoId: string | null, alt: string, className?: string }} props
 */
export function LostItemThumb({ itemId, photoId, alt, className = 'size-14' }) {
  const image = useProtectedImage(photoId ? photoPath(itemId, photoId, 'thumb') : null);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-item border border-line bg-surface-muted ${className}`}>
      {image.url ? (
        <img src={image.url} alt={alt} className="size-full object-cover" />
      ) : image.isPending ? (
        <Spinner />
      ) : (
        <Icon name={image.isError ? 'alertTriangle' : 'package'} className="size-5 text-ink-muted" />
      )}
    </span>
  );
}

/**
 * Fotoğraf seçici: telefonda arka kamerayı açar, masaüstünde dosya seçtirir.
 * Seçilen her fotoğraf tarayıcıda küçültülüp `onPrepared`'a verilir.
 *
 * @param {{ remaining: number, disabled?: boolean, onPrepared: (photo: { contentType: string, image: string, thumbnail: string }) => Promise<void> | void, label?: string }} props
 */
export function PhotoPicker({ remaining, disabled = false, onPrepared, label = 'Fotoğraf ekle' }) {
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
      <Button
        type="button"
        variant="outline"
        icon="camera"
        disabled={disabled || busy || remaining <= 0}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Fotoğraf hazırlanıyor…' : remaining <= 0 ? `En fazla ${LOST_ITEM_MAX_PHOTOS} fotoğraf` : label}
      </Button>
    </>
  );
}

/**
 * Eşya ekranının galerisi.
 * @param {{ item: any, canEdit: boolean, onChanged: () => void }} props
 */
export function LostItemGallery({ item, canEdit, onChanged }) {
  const [viewing, setViewing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const remaining = LOST_ITEM_MAX_PHOTOS - item.photos.length;

  const remove = useMutation({
    mutationFn: (photoId) => apiDelete(`/lost-items/${item.id}/photos/${photoId}`),
    onSuccess: () => {
      toastSuccess('Fotoğraf silindi');
      setRemoving(null);
      onChanged();
    },
  });

  async function upload(photo) {
    await apiPost(`/lost-items/${item.id}/photos`, photo);
    toastSuccess('Fotoğraf eklendi');
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      {item.photos.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-item border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-muted">
          <Icon name="camera" className="size-6" />
          {item.photosPurgedAt ? 'Fotoğraflar saklama süresi dolduğu için silindi.' : 'Fotoğraf yok.'}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {item.photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              <button type="button" className="block w-full" onClick={() => setViewing(photo)} aria-label={`Fotoğraf ${index + 1}: büyüt`}>
                <LostItemThumb itemId={item.id} photoId={photo.id} alt={`${item.description} — fotoğraf ${index + 1}`} className="aspect-square w-full" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Fotoğraf ${index + 1}: sil`}
                  onClick={() => setRemoving(photo)}
                  className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div>
          <PhotoPicker remaining={remaining} onPrepared={upload} />
        </div>
      )}

      {viewing && <PhotoViewer item={item} photo={viewing} onClose={() => setViewing(null)} />}
      {removing && (
        <ConfirmDialog
          open
          title="Fotoğraf silinsin mi?"
          message="Yanlış çekilen fotoğrafı siler; geri alınamaz."
          confirmLabel="Sil"
          confirmIcon="trash"
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
          isPending={remove.isPending}
          error={remove.error}
        />
      )}
    </div>
  );
}

/** @param {{ item: any, photo: any, onClose: () => void }} props */
function PhotoViewer({ item, photo, onClose }) {
  const image = useProtectedImage(photoPath(item.id, photo.id, 'full'));
  return (
    <Modal open size="lg" title={`${item.reference} · fotoğraf`} onClose={onClose}>
      {image.url ? (
        <img src={image.url} alt={item.description} className="mx-auto max-h-[70vh] w-auto rounded-item" />
      ) : image.isError ? (
        <Alert tone="danger" title="Fotoğraf açılamadı">Dosya bulunamadı ya da bağlantı kesildi.</Alert>
      ) : (
        <Spinner className="py-10" />
      )}
    </Modal>
  );
}
