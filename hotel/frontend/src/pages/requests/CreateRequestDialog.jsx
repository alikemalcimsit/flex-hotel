import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createGuestRequestSchema,
  createRequestFromConversationSchema,
  defaultGuestRequestPriority,
  GUEST_REQUEST_CATEGORIES,
  GUEST_REQUEST_CATEGORY_LABELS,
  GUEST_REQUEST_MANUAL_SOURCES,
  GUEST_REQUEST_PRIORITIES,
  GUEST_REQUEST_PRIORITY_LABELS,
  GUEST_REQUEST_SLA_MINUTES,
  GUEST_REQUEST_SOURCE_LABELS,
  MAX_REQUEST_DESCRIPTION_LENGTH,
  MAX_REQUEST_TITLE_LENGTH,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { Alert, Button, ERROR_CLASS, Icon, Input, LABEL_CLASS, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { inboxKeys, requestKeys, useAssignees } from '../../lib/frontOffice.js';
import { formatMinutes } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastSuccess } from '../../store/toast.js';
import { CATEGORY_ICONS } from './requestTheme.js';

/** Mesajdan başlık önerilirken kesilen uzunluk (kelime sınırında). */
const SUGGESTED_TITLE_LENGTH = 80;

/** Uyandırma için tek dokunuşla seçilen yarınki saatler. */
const WAKE_UP_TIMES = Object.freeze(['06:00', '06:30', '07:00', '07:30', '08:00', '09:00']);

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIORITY_DEFAULT = '';

const FORM_ID = 'create-request-form';

/** @param {string} text */
function suggestTitle(text) {
  const firstLine = text.trim().split('\n')[0];
  if (firstLine.length <= SUGGESTED_TITLE_LENGTH) return firstLine;
  const cut = firstLine.slice(0, SUGGESTED_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > SUGGESTED_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Otelin yarınki günü (`YYYY-MM-DD`). */
function tomorrowOf(today) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Yeni misafir isteği.
 *
 * İki yerden açılır:
 * - **İstekler sayfası:** oda seçilir, içerideki misafir kendiliğinden bağlanır
 *   (seçim anında "içeride kim var" gösterilir). Kaynak telefon / resepsiyon /
 *   personel.
 * - **Konuşma:** misafir ve konaklama konuşmadan gelir. Konaklamanın odası
 *   biliniyorsa oda sorulmaz; mesajdan açıldıysa başlık mesajdan önerilir.
 *
 * Zamanlı isteklerin saati (uyandırma) **otelin saatine** göre girilir ve
 * öyle gösterilir; bilgisayarın saat dilimi farklıysa uyarılır.
 *
 * Doğrulama sunucuyla aynı şema; sunucunun iş kuralı hatası ilgili alanın
 * altına düşer.
 *
 * @param {{
 *   conversation?: { id: string, contactName: string, stay: { roomId: string | null, roomNumber: string | null, confirmationCode: string } | null } | null,
 *   message?: { id: string, text: string } | null,
 *   onClose: () => void,
 *   onCreated?: (request: object) => void,
 * }} props
 */
export function CreateRequestDialog({ conversation = null, message = null, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const { today, timeZone } = useHotelToday();
  const { options: assigneeOptions } = useAssignees();

  const fixedRoom = conversation?.stay?.roomId
    ? { id: conversation.stay.roomId, number: conversation.stay.roomNumber }
    : null;
  const roomRequired = !conversation?.stay;

  const initialTitle = message ? suggestTitle(message.text) : '';
  const [values, setValues] = useState({
    category: '',
    title: initialTitle,
    description: message && message.text.trim() !== initialTitle ? message.text.trim() : '',
    priority: PRIORITY_DEFAULT,
    scheduledWall: '',
    assignedToId: '',
    source: 'FRONT_DESK',
  });
  const [room, setRoom] = useState(null);
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key === 'scheduledWall' ? 'scheduledFor' : key]: undefined }));
  };

  const roomContext = useQuery({
    queryKey: requestKeys.roomContext(room?.id),
    queryFn: () => api(withQuery('/guest-requests/room-context', { roomId: room.id })),
    enabled: Boolean(room?.id),
  });

  const mutation = useMutation({
    mutationFn: (payload) =>
      conversation
        ? apiPost(`/guest-requests/from-conversation/${conversation.id}`, payload)
        : apiPost('/guest-requests', payload),
    onSuccess: (created) => {
      toastSuccess(`İstek açıldı: ${created.title}${created.room ? ` (Oda ${created.room.number})` : ''}`);
      queryClient.invalidateQueries({ queryKey: requestKeys.all });
      if (conversation) queryClient.invalidateQueries({ queryKey: inboxKeys.conversation(conversation.id) });
      onCreated?.(created);
      onClose();
    },
    onError: (error) => {
      const field = error.details?.field ?? Object.keys(error.fields ?? {})[0];
      if (field) setErrors({ [field]: error.fields?.[field] ?? error.message });
    },
  });

  const effectivePriority = values.priority || (values.category ? defaultGuestRequestPriority(values.category) : 'NORMAL');
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isWakeUp = values.category === 'WAKE_UP';
  const tomorrow = tomorrowOf(today);
  const minWall = utcToZonedWallTime(new Date(), timeZone) ?? undefined;

  const submit = (event) => {
    event.preventDefault();
    const scheduledFor = values.scheduledWall ? zonedWallTimeToUtc(values.scheduledWall, timeZone) : null;
    if (values.scheduledWall && !scheduledFor) {
      setErrors({ scheduledFor: 'Geçerli bir tarih ve saat seçin' });
      return;
    }

    const common = {
      category: values.category || undefined,
      title: values.title,
      description: values.description.trim() || null,
      priority: values.priority || undefined,
      scheduledFor,
      assignedToId: values.assignedToId || null,
    };
    const payload = conversation
      ? { ...common, messageId: message?.id ?? null, roomId: fixedRoom ? null : room?.id ?? null }
      : { ...common, source: values.source, roomId: room?.id ?? null };

    const schema = conversation ? createRequestFromConversationSchema : createGuestRequestSchema;
    const result = schema.safeParse(payload);
    const nextErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? '_');
        nextErrors[key] ??= issue.message;
      }
    }
    if (roomRequired && !room) nextErrors.roomId ??= 'İsteğin odasını seçin';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    // Tarihler JSON'a ISO olarak gider; zod'un dönüştürdüğü değil, girilen değer.
    mutation.mutate({ ...payload, scheduledFor: scheduledFor?.toISOString() ?? null });
  };

  const context = roomContext.data;

  return (
    <Modal
      open
      size="lg"
      title={conversation ? `İstek oluştur — ${conversation.contactName}` : 'Yeni misafir isteği'}
      onClose={mutation.isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} icon="plus" disabled={mutation.isPending}>
            {mutation.isPending ? 'Kaydediliyor…' : 'İsteği aç'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {message && (
          <blockquote className="rounded-panel border-l-4 border-info bg-info-soft px-4 py-3 text-sm text-info-ink">
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em]">Misafirin mesajı</p>
            <p className="line-clamp-4 whitespace-pre-wrap">{message.text}</p>
          </blockquote>
        )}

        <fieldset>
          <legend className={LABEL_CLASS}>Kategori</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Kategori">
            {GUEST_REQUEST_CATEGORIES.map((category) => {
              const selected = values.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    set('category')(category);
                    setErrors((current) => ({ ...current, scheduledFor: undefined }));
                  }}
                  className={`flex items-center gap-2.5 rounded-control border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? 'border-ink bg-ink text-white'
                      : 'border-line-strong bg-surface text-ink hover:border-ink'
                  }`}
                >
                  <Icon name={CATEGORY_ICONS[category]} className={`size-4 shrink-0 ${selected ? '' : 'text-ink-muted'}`} />
                  {GUEST_REQUEST_CATEGORY_LABELS[category]}
                </button>
              );
            })}
          </div>
          {errors.category && <p className={`mt-2 ${ERROR_CLASS}`}>{errors.category}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {fixedRoom ? (
            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASS}>Oda</span>
              <p className="flex items-center gap-2 rounded-control border border-line bg-surface-muted px-4 py-2.5 text-sm">
                <Icon name="bed" className="size-4 text-ink-muted" />
                <span className="font-bold text-ink">Oda {fixedRoom.number}</span>
                <span className="text-xs text-ink-muted">konuşmanın konaklaması ({conversation.stay.confirmationCode})</span>
              </p>
            </div>
          ) : (
            <RoomPicker
              label={roomRequired ? 'Oda' : 'Oda (isteğe bağlı)'}
              value={room}
              onChange={(next) => {
                setRoom(next);
                setErrors((current) => ({ ...current, roomId: undefined }));
              }}
              error={errors.roomId ?? errors.reservationId}
              hint={
                context ? (
                  <RoomContextHint context={context} />
                ) : conversation?.stay ? (
                  `Konaklama ${conversation.stay.confirmationCode} henüz odaya atanmadı.`
                ) : (
                  'İçerideki misafir odadan kendiliğinden bulunur.'
                )
              }
            />
          )}

          <Select
            label="Öncelik"
            name="priority"
            value={values.priority}
            onChange={(event) => set('priority')(event.target.value)}
            error={errors.priority}
            options={[
              {
                value: PRIORITY_DEFAULT,
                label: `Kategoriye göre (${GUEST_REQUEST_PRIORITY_LABELS[effectivePriority]})`,
              },
              ...GUEST_REQUEST_PRIORITIES.map((priority) => ({
                value: priority,
                label: `${GUEST_REQUEST_PRIORITY_LABELS[priority]} — ${formatMinutes(GUEST_REQUEST_SLA_MINUTES[priority])} içinde`,
              })),
            ]}
          />
        </div>

        <Input
          label="Başlık"
          name="title"
          value={values.title}
          maxLength={MAX_REQUEST_TITLE_LENGTH}
          placeholder="ör. 2 havlu ve 1 yastık"
          error={errors.title}
          onChange={(event) => set('title')(event.target.value)}
        />

        <Textarea
          label="Açıklama (isteğe bağlı)"
          name="description"
          rows={3}
          value={values.description}
          maxLength={MAX_REQUEST_DESCRIPTION_LENGTH}
          error={errors.description}
          onChange={(event) => set('description')(event.target.value)}
        />

        <div className="flex flex-col gap-2">
          <Input
            label={isWakeUp ? 'Uyandırma saati' : 'Belirli bir saatte mi? (isteğe bağlı)'}
            name="scheduledFor"
            type="datetime-local"
            min={minWall}
            value={values.scheduledWall}
            error={errors.scheduledFor}
            onChange={(event) => set('scheduledWall')(event.target.value)}
            className="sm:max-w-xs"
          />
          {isWakeUp && (
            <ChoiceChips
              label="Yarın için hızlı saat"
              options={WAKE_UP_TIMES.map((time) => ({ value: `${tomorrow}T${time}`, label: `Yarın ${time}` }))}
              value={values.scheduledWall}
              onChange={set('scheduledWall')}
            />
          )}
          <p className="text-xs text-ink-muted">
            {values.scheduledWall
              ? 'Hizmet süresi bu saate göre izlenir.'
              : `Saat verilmezse hizmet süresi ${formatMinutes(GUEST_REQUEST_SLA_MINUTES[effectivePriority])}.`}{' '}
            Saatler otelin saatiyle ({timeZone}).
          </p>
          {browserTimeZone !== timeZone && (
            <Alert tone="warning">
              Bu bilgisayarın saat dilimi ({browserTimeZone}) otelinkinden farklı. Girdiğiniz saat otelin saati olarak
              kaydedilir.
            </Alert>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Atanan personel"
            name="assignedToId"
            value={values.assignedToId}
            onChange={(event) => set('assignedToId')(event.target.value)}
            error={errors.assignedToId}
            options={[{ value: '', label: 'Şimdilik atama yok' }, ...assigneeOptions]}
          />
          {!conversation && (
            <Select
              label="Nereden geldi?"
              name="source"
              value={values.source}
              onChange={(event) => set('source')(event.target.value)}
              options={GUEST_REQUEST_MANUAL_SOURCES.map((source) => ({
                value: source,
                label: GUEST_REQUEST_SOURCE_LABELS[source],
              }))}
            />
          )}
        </div>

        {mutation.isError && !mutation.error.details?.field && !Object.keys(mutation.error.fields ?? {}).length && (
          <Alert tone="danger">{mutation.error.message}</Alert>
        )}
      </form>
    </Modal>
  );
}

/** Seçilen odada içeride kim var, kaç açık istek var. */
function RoomContextHint({ context }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {context.stay ? (
        <>
          <Icon name="user" className="size-3.5" />
          <span className="font-semibold text-ink-soft">İçeride: {context.stay.guestName}</span>
          <span>({context.stay.confirmationCode})</span>
        </>
      ) : (
        <span>Odada şu an konaklayan yok; istek misafirsiz açılır.</span>
      )}
      {context.openRequests > 0 && (
        <span className="font-semibold text-warning-ink">· bu odada {context.openRequests} açık istek var</span>
      )}
    </span>
  );
}
