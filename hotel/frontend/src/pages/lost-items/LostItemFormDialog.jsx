import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_MAX_PHOTOS,
  LOST_ITEM_VALUABLE_CATEGORIES,
  lostItemInputSchema,
  updateLostItemSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { apiPost, apiPut } from '../../lib/api.js';
import { toLocalInput } from '../../lib/extras.js';
import { categoryLabel } from '../../lib/lost-items.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { PhotoPicker } from './LostItemPhotos.jsx';

const PLACE_OPTIONS = Object.freeze([
  { value: 'ROOM', label: 'Odada' },
  { value: 'AREA', label: 'Ortak alanda' },
]);

const CATEGORY_OPTIONS = LOST_ITEM_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }));

/** `datetime-local` (yerel saat) → ISO; boşsa boş. */
const localToIso = (value) => (value ? new Date(value).toISOString() : '');

/**
 * Bulunan eşya formu (modül 21): yeni kayıt (fotoğraflarla) ya da açık eşyanın
 * bilgilerini düzeltme. Telefonda kullanılır: kamera tek dokunuşla açılır.
 *
 * Yeni kayıtta eşya önce kaydedilir, fotoğraflar sonra yüklenir; bir fotoğraf
 * yüklenemezse eşya yine kayıtlıdır (eşya ekranından yeniden eklenir). Aynı
 * form iki kez gönderilse de tek kayıt açılır (istek kimliği).
 *
 * @param {{ item?: any, onClose: () => void, onSaved: (item: any) => void }} props
 */
export function LostItemFormDialog({ item, onClose, onSaved }) {
  const editing = Boolean(item);
  const userName = useAuthStore((state) => state.user?.name ?? '');
  const [requestId] = useState(newRequestId);
  const [values, setValues] = useState(() => ({
    description: item?.description ?? '',
    category: item?.category ?? '',
    valuable: item?.valuable ?? false,
    place: item && !item.roomId ? 'AREA' : 'ROOM',
    room: item?.roomId ? { id: item.roomId, number: item.roomNumber } : null,
    locationText: item?.locationText ?? '',
    foundAt: toLocalInput(item ? new Date(item.foundAt) : new Date()),
    foundByName: item?.foundByName ?? userName,
    storageLocation: item?.storageLocation ?? '',
    note: '',
  }));
  const [valuableTouched, setValuableTouched] = useState(editing);
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [uploading, setUploading] = useState(false);

  const set = (field) => (value) => setValues((current) => ({ ...current, [field]: value }));

  function changeCategory(category) {
    setValues((current) => ({
      ...current,
      category,
      // Elektronik, takı, cüzdan kendiliğinden değerli (personel değiştirebilir).
      valuable: valuableTouched ? current.valuable : LOST_ITEM_VALUABLE_CATEGORIES.includes(category),
    }));
  }

  const mutation = useMutation({
    mutationFn: (body) => (editing ? apiPut(`/lost-items/${item.id}`, body) : apiPost('/lost-items', body)),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
    },
  });

  async function uploadPhotos(saved) {
    let failed = 0;
    setUploading(true);
    for (const photo of photos) {
      try {
        await apiPost(`/lost-items/${saved.id}/photos`, photo);
      } catch {
        failed += 1;
      }
    }
    setUploading(false);
    if (failed > 0) toastError(`${failed} fotoğraf yüklenemedi; eşya ekranından yeniden ekleyin`);
  }

  async function submit(event) {
    event.preventDefault();
    const body = {
      ...(editing ? { expectedUpdatedAt: item.updatedAt } : { requestId, note: values.note }),
      description: values.description,
      category: values.category,
      valuable: values.valuable,
      roomId: values.place === 'ROOM' ? (values.room?.id ?? null) : null,
      locationText: values.place === 'AREA' ? values.locationText : null,
      foundAt: localToIso(values.foundAt),
      foundByName: values.foundByName,
      storageLocation: values.storageLocation,
    };
    const checked = validateWith(editing ? updateLostItemSchema : lostItemInputSchema, body);
    // Oda seçilmediyse şema "yer yazın" der; odada modunda doğru alanın altında "odayı seçin" görünsün.
    const roomMissing = values.place === 'ROOM' && !values.room;
    if (!checked.ok || roomMissing) {
      const { locationText, ...schemaErrors } = checked.ok ? {} : checked.errors;
      setErrors({ ...schemaErrors, ...(roomMissing ? { roomId: 'Odayı seçin' } : locationText ? { locationText } : {}) });
      return;
    }
    setErrors({});
    try {
      const result = await mutation.mutateAsync(body);
      const saved = editing ? result : result.item;
      if (!editing && photos.length) await uploadPhotos(saved);
      toastSuccess(editing ? 'Eşya bilgileri güncellendi' : `Kaydedildi: ${saved.reference} — bu numarayı poşetin üstüne yazın`);
      onSaved(saved);
    } catch {
      // Hata formun üstünde gösterilir (mutation.error).
    }
  }

  const busy = mutation.isPending || uploading;

  return (
    <Modal
      open
      size="lg"
      title={editing ? `${item.reference} · bilgileri düzelt` : 'Bulunan eşya kaydı'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="lost-item-form" icon="check" disabled={busy}>
            {uploading ? 'Fotoğraflar yükleniyor…' : mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="lost-item-form" className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {mutation.error && !mutation.error.fields && (
          <Alert tone="danger" title={editing ? 'Kaydedilemedi' : 'Eşya kaydedilemedi'}>
            {mutation.error.code === 'STALE_WRITE' ? 'Eşya siz düzenlerken değişti; pencereyi kapatıp yeniden açın.' : mutation.error.message}
          </Alert>
        )}

        <Textarea
          label="Açıklama"
          rows={2}
          placeholder="Ör. siyah deri cüzdan, içinde kimlik var"
          value={values.description}
          onChange={(event) => set('description')(event.target.value)}
          error={errors.description}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Kategori"
            value={values.category}
            onChange={(event) => changeCategory(event.target.value)}
            options={[{ value: '', label: 'Seçin', disabled: true }, ...CATEGORY_OPTIONS]}
            error={errors.category}
          />
          <div className="flex items-end pb-1">
            <Checkbox
              label="Değerli eşya"
              hint="Kasada saklanır, daha uzun tutulur; elden teslimde kimlik görülür."
              checked={values.valuable}
              onChange={(event) => {
                setValuableTouched(true);
                set('valuable')(event.target.checked);
              }}
            />
          </div>
        </div>

        <ChoiceChips label="Bulunduğu yer" required options={PLACE_OPTIONS} value={values.place} onChange={set('place')} />
        {values.place === 'ROOM' ? (
          <RoomPicker label="Oda" value={values.room} onChange={set('room')} error={errors.roomId} />
        ) : (
          <Input
            label="Yer"
            placeholder="Ör. lobi, havuz barı, spa soyunma odası"
            value={values.locationText}
            onChange={(event) => set('locationText')(event.target.value)}
            error={errors.locationText}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Bulunma zamanı" type="datetime-local" value={values.foundAt} onChange={(event) => set('foundAt')(event.target.value)} error={errors.foundAt} />
          <Input label="Bulan" value={values.foundByName} onChange={(event) => set('foundByName')(event.target.value)} error={errors.foundByName} />
          <Input
            label="Saklandığı yer"
            placeholder={values.valuable ? 'Ör. kasa' : 'Ör. depo raf B3'}
            value={values.storageLocation}
            onChange={(event) => set('storageLocation')(event.target.value)}
            error={errors.storageLocation}
          />
        </div>

        {!editing && (
          <>
            <Textarea label="Not (isteğe bağlı)" rows={2} placeholder="Ör. yatağın altında bulundu" value={values.note} onChange={(event) => set('note')(event.target.value)} error={errors.note} />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">Fotoğraflar</span>
              {photos.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {photos.map((photo, index) => (
                    <li key={index} className="relative">
                      <img src={`data:${photo.contentType};base64,${photo.thumbnail}`} alt={`Fotoğraf ${index + 1}`} className="size-20 rounded-item border border-line object-cover" />
                      <button
                        type="button"
                        aria-label={`Fotoğraf ${index + 1}: çıkar`}
                        disabled={busy}
                        onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}
                        className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-ink text-white"
                      >
                        <Icon name="close" className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <PhotoPicker
                  remaining={LOST_ITEM_MAX_PHOTOS - photos.length}
                  disabled={busy}
                  label={photos.length ? 'Bir fotoğraf daha' : 'Fotoğraf çek / seç'}
                  onPrepared={(photo) => setPhotos((current) => [...current, photo].slice(0, LOST_ITEM_MAX_PHOTOS))}
                />
              </div>
              <p className="text-xs text-ink-muted">Fotoğraf telefonda küçültülür; konum bilgisi silinir.</p>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
