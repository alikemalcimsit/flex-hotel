import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_ACTOR_NOTE_LENGTH, actorToggleSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { actorKeys, taskKeys } from '../../lib/actors.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Aktörü açma / kapama isteği. Sunucu güncel detayı döndürür; liste ve detay
 * aynı anda tazelenir. Açık/kapalı açıkça gönderilir (anahtar değil): iki
 * yönetici aynı anda "kapat" derse sonuç yine kapalıdır.
 */
export function useActorToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled, note }) => apiPost(`/actors/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`, note ? { note } : {}),
    onSuccess: (detail, { enabled }) => {
      queryClient.setQueryData(actorKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: actorKeys.list });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      toastSuccess(enabled ? `${detail.title} açıldı; işleri yeniden kendisi yapıyor` : `${detail.title} kapatıldı; işleri manuel göreve düşecek`);
    },
    onError: (error) => toastError(error.message),
  });
}

/**
 * Kapatma onayı: yöneticiye neyin duracağını söyler ve gerekçe ister
 * (isteğe bağlı; aktörün kartında ve denetim izinde görünür).
 *
 * @param {{
 *   actor: { name: string, title: string, type: string, fallbackModule: string, registered: boolean },
 *   downstream?: Array<{ name: string, title: string }> | null,
 *   onClose: () => void,
 * }} props
 */
export function DisableActorDialog({ actor, downstream = null, onClose }) {
  const toggle = useActorToggle();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const busy = toggle.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(actorToggleSchema, { note });
    if (!result.ok) {
      setError(result.errors.note ?? 'Gerekçe geçersiz');
      return;
    }
    setError('');
    toggle.mutate({ name: actor.name, enabled: false, note: result.data.note }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      size="md"
      title={`${actor.title} kapatılsın mı?`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="disable-actor-form" variant="danger" icon="close" disabled={busy}>
            {busy ? 'Kapatılıyor…' : 'Kapat'}
          </Button>
        </>
      }
    >
      <form id="disable-actor-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert tone="warning" title="Kapatınca ne olur">
          <ul className="list-inside list-disc space-y-1">
            <li>
              Bu aktörün yapacağı işler <strong>“{actor.fallbackModule}”</strong> manuel görevi olarak yetkili personelin önüne düşer;
              hiçbir iş kaybolmaz.
            </li>
            {actor.type === 'agent' && <li>AI misafire cevap vermez: yeni konuşmalar personelde açılır.</li>}
            {downstream && downstream.length > 0 && (
              <li>Bu aktörün yayınladığı olayları bekleyenler ({downstream.map((other) => other.title).join(', ')}) bu olayları ondan almaz.</li>
            )}
            <li>Personel onayı verilmiş işler aktör kapalı olsa da yapılır.</li>
          </ul>
        </Alert>
        {!actor.registered && <p className="text-sm text-ink-soft">Aktör şu an sunucuda kurulu değil; ayar kurulduğu gün geçerli olur.</p>}
        <Textarea
          label="Gerekçe (isteğe bağlı)"
          name="actor-note"
          rows={3}
          maxLength={MAX_ACTOR_NOTE_LENGTH}
          placeholder="Ör. OTA entegrasyonu bakımda"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={error || undefined}
          disabled={busy}
        />
        <p className="text-right text-xs text-ink-muted">
          {note.length}/{MAX_ACTOR_NOTE_LENGTH}
        </p>
      </form>
    </Modal>
  );
}
