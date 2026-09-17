import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CONVERSATION_CHANNEL_LABELS,
  GUEST_REQUEST_CATEGORY_LABELS,
  GUEST_REQUEST_PRIORITIES,
  GUEST_REQUEST_PRIORITY_LABELS,
  GUEST_REQUEST_SOURCE_LABELS,
  GUEST_REQUEST_STATUS_LABELS,
  guestRequestTransitionError,
  MAX_REQUEST_DESCRIPTION_LENGTH,
  MAX_REQUEST_TITLE_LENGTH,
  updateGuestRequestSchema,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { api } from '../../lib/api.js';
import { requestKeys, useAssignees } from '../../lib/frontOffice.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { RequestTimingBadge } from './RequestRow.jsx';
import { CATEGORY_ICONS, PRIORITY_STYLES, STATUS_TONES } from './requestTheme.js';

const FORM_ID = 'edit-request-form';

/**
 * İstek detayı: kim açtı, kim üstlendi, ne zaman bitti; düzenleme ve durum
 * işlemleri.
 *
 * Düzenleme yalnızca değişen alanları gönderir ve kaydın ekrandaki sürümünü
 * taşır; başkası bu arada değiştirdiyse kayıt yenilenir, üstüne yazılmaz.
 * Öncelik ya da saat değişirse hizmet süresi sunucuda yeniden hesaplanır
 * (isteğin açıldığı andan).
 *
 * Durum düğmeleri pencereyi kapatıp işlemi sayfaya bırakır: tamamlama ve iptal
 * kendi not penceresini açar, iki pencere üst üste binmez.
 *
 * @param {{
 *   requestId: string,
 *   canManage: boolean,
 *   actions: ReturnType<typeof import('./useRequestActions.js').useRequestActions>,
 *   onStatus: (request: object, status: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function RequestDetailDialog({ requestId, canManage, actions, onStatus, onClose }) {
  const { timeZone } = useHotelToday();
  const query = useQuery({
    queryKey: requestKeys.detail(requestId),
    queryFn: () => api(`/guest-requests/${requestId}`),
  });
  const [editing, setEditing] = useState(false);

  const request = query.data;
  const active = request && (request.status === 'OPEN' || request.status === 'IN_PROGRESS');
  const can = (status) =>
    request && request.status !== status && guestRequestTransitionError(request.status, status) === null;

  const statusButton = (status, label, props) =>
    can(status) && (
      <Button
        {...props}
        onClick={() => {
          onClose();
          onStatus(request, status);
        }}
      >
        {label}
      </Button>
    );

  return (
    <Modal
      open
      size="lg"
      title={request ? request.title : 'İstek'}
      onClose={actions.update.isPending ? () => {} : onClose}
      footer={
        editing ? (
          <>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={actions.update.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" form={FORM_ID} icon="check" disabled={actions.update.isPending}>
              {actions.update.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
            {request && canManage && (
              <>
                <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
                  Düzenle
                </Button>
                {statusButton('CANCELLED', 'İptal et', { variant: 'dangerSoft', icon: 'close' })}
                {request.status === 'IN_PROGRESS' &&
                  statusButton('OPEN', 'Beklemeye al', { variant: 'outline', icon: 'rotateCcw' })}
                {!active && statusButton('OPEN', 'Yeniden aç', { variant: 'outline', icon: 'rotateCcw' })}
                {statusButton('IN_PROGRESS', 'Başlat', { variant: 'outline', icon: 'play' })}
                {statusButton('DONE', 'Tamamla', { icon: 'check' })}
              </>
            )}
          </>
        )
      }
    >
      {query.isPending && <Spinner label="İstek yükleniyor…" className="py-8" />}

      {query.isError && (
        <Alert
          tone="danger"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}

      {request && !editing && <RequestSummary request={request} timeZone={timeZone} />}

      {request && editing && (
        <EditRequestForm
          key={request.updatedAt}
          request={request}
          timeZone={timeZone}
          actions={actions}
          onSaved={() => setEditing(false)}
        />
      )}
    </Modal>
  );
}

/** @param {{ request: object, timeZone: string }} props */
function RequestSummary({ request, timeZone }) {
  const priority = PRIORITY_STYLES[request.priority] ?? PRIORITY_STYLES.NORMAL;

  const timeline = [
    {
      key: 'created',
      icon: 'plus',
      label: `Açıldı · ${GUEST_REQUEST_SOURCE_LABELS[request.source]}`,
      at: request.createdAt,
      by: request.createdBy,
    },
    // Başlatanın kimliği kayıtta yok (atanan kişi sonradan değişebilir); yalnızca zaman.
    request.startedAt && { key: 'started', icon: 'play', label: 'Üzerinde çalışılmaya başlandı', at: request.startedAt },
    request.completedAt && {
      key: 'done',
      icon: 'checkCircle',
      label: 'Tamamlandı',
      at: request.completedAt,
      by: request.completedBy,
      note: request.resolutionNote,
    },
    request.status === 'CANCELLED' && {
      key: 'cancelled',
      icon: 'close',
      label: 'İptal edildi',
      at: request.updatedAt,
      note: request.cancelledReason,
    },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-item bg-black/[0.05] text-ink-soft">
          <Icon name={CATEGORY_ICONS[request.category]} className="size-[18px]" />
        </span>
        <span className="text-sm font-bold text-ink">{GUEST_REQUEST_CATEGORY_LABELS[request.category]}</span>
        <Badge tone={STATUS_TONES[request.status]}>{GUEST_REQUEST_STATUS_LABELS[request.status]}</Badge>
        <Badge tone={priority.tone} dot={false}>
          {GUEST_REQUEST_PRIORITY_LABELS[request.priority]}
        </Badge>
        <RequestTimingBadge request={request} timeZone={timeZone} />
      </div>

      {request.description && (
        <p className="whitespace-pre-wrap rounded-panel bg-surface-muted px-4 py-3 text-sm text-ink-soft">
          {request.description}
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="Oda">{request.room ? `Oda ${request.room.number} · ${request.room.floor}. kat` : 'Oda seçilmedi'}</Field>
        <Field label="Misafir">
          {request.guest?.name ?? <span className="text-ink-muted">Bağlı misafir yok</span>}
          {request.reservation && <div className="text-xs text-ink-muted">{request.reservation.confirmationCode}</div>}
        </Field>
        <Field label="Atanan">{request.assignedTo?.name ?? <span className="text-ink-muted">Atanmamış</span>}</Field>
        <Field label={request.scheduledFor ? 'İstenen saat' : 'Hedef'}>
          {formatDateTime(request.scheduledFor ?? request.dueAt, timeZone)}
        </Field>
        {request.conversation && (
          <Field label="Kaynak konuşma">
            <Link
              to={`/mesajlar/${request.conversation.id}`}
              className="inline-flex items-center gap-1.5 font-semibold text-info-ink underline-offset-2 hover:underline"
            >
              <Icon name="message" className="size-4" />
              {CONVERSATION_CHANNEL_LABELS[request.conversation.channel]} konuşmasını aç
            </Link>
          </Field>
        )}
      </dl>

      <section aria-label="Geçmiş">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Geçmiş</h3>
        <ol className="flex flex-col gap-2">
          {timeline.map((entry) => (
            <li key={entry.key} className="flex gap-3 text-sm">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-black/[0.05] text-ink-soft">
                <Icon name={entry.icon} className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-ink">{entry.label}</span>
                <span className="text-ink-muted">
                  {' '}
                  · {formatDateTime(entry.at, timeZone)}
                  {entry.by ? ` · ${entry.by}` : ''}
                </span>
                {entry.note && <span className="block text-ink-soft">{entry.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * @param {{ request: object, timeZone: string, actions: object, onSaved: () => void }} props
 */
function EditRequestForm({ request, timeZone, actions, onSaved }) {
  const { options: assigneeOptions } = useAssignees();
  const initial = {
    title: request.title,
    description: request.description ?? '',
    priority: request.priority,
    scheduledWall: request.scheduledFor ? utcToZonedWallTime(request.scheduledFor, timeZone) : '',
    assignedToId: request.assignedTo?.id ?? '',
  };
  const [values, setValues] = useState(initial);
  const [room, setRoom] = useState(request.room);
  const [errors, setErrors] = useState({});

  const set = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setErrors({});
  };

  const submit = (event) => {
    event.preventDefault();
    const changes = {};
    if (values.title !== initial.title) changes.title = values.title;
    if (values.description !== initial.description) changes.description = values.description.trim() || null;
    if (values.priority !== initial.priority) changes.priority = values.priority;
    if (values.assignedToId !== initial.assignedToId) changes.assignedToId = values.assignedToId || null;
    if (request.room && !room) {
      // Odayı boşaltmak içerideki misafir bağlantısını da siler; bilinçli bir seçim olmalı.
      setErrors({ roomId: 'Yeni odayı seçin' });
      return;
    }
    if ((room?.id ?? null) !== (request.room?.id ?? null)) changes.roomId = room.id;
    if (values.scheduledWall !== initial.scheduledWall) {
      const scheduledFor = values.scheduledWall ? zonedWallTimeToUtc(values.scheduledWall, timeZone) : null;
      if (values.scheduledWall && !scheduledFor) {
        setErrors({ scheduledFor: 'Geçerli bir tarih ve saat seçin' });
        return;
      }
      changes.scheduledFor = scheduledFor;
    }

    if (Object.keys(changes).length === 0) {
      onSaved();
      return;
    }

    const result = updateGuestRequestSchema.safeParse({ ...changes, expectedUpdatedAt: request.updatedAt });
    if (!result.success) {
      const next = {};
      for (const issue of result.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    actions.update.mutate(
      {
        request,
        changes: { ...changes, ...(changes.scheduledFor !== undefined ? { scheduledFor: changes.scheduledFor?.toISOString() ?? null } : {}) },
        message: 'İstek güncellendi',
      },
      {
        onSuccess: onSaved,
        onError: (error) => {
          const field = error.details?.field ?? Object.keys(error.fields ?? {})[0];
          if (field) setErrors({ [field]: error.fields?.[field] ?? error.message });
        },
      },
    );
  };

  return (
    <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Başlık"
        name="title"
        value={values.title}
        maxLength={MAX_REQUEST_TITLE_LENGTH}
        error={errors.title}
        onChange={set('title')}
      />
      <Textarea
        label="Açıklama"
        name="description"
        rows={3}
        value={values.description}
        maxLength={MAX_REQUEST_DESCRIPTION_LENGTH}
        error={errors.description}
        onChange={set('description')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Öncelik"
          name="priority"
          value={values.priority}
          onChange={set('priority')}
          error={errors.priority}
          options={GUEST_REQUEST_PRIORITIES.map((priority) => ({
            value: priority,
            label: GUEST_REQUEST_PRIORITY_LABELS[priority],
          }))}
        />
        <Select
          label="Atanan personel"
          name="assignedToId"
          value={values.assignedToId}
          onChange={set('assignedToId')}
          error={errors.assignedToId}
          options={[{ value: '', label: 'Atanmamış' }, ...assigneeOptions]}
        />
        <RoomPicker
          label="Oda"
          value={room}
          onChange={(next) => {
            setRoom(next);
            setErrors({});
          }}
          error={errors.roomId}
          hint={room?.id !== request.room?.id ? 'Oda değişirse içerideki misafir yeniden bulunur.' : undefined}
        />
        <Input
          label={request.category === 'WAKE_UP' ? 'Uyandırma saati' : 'Belirli saat (isteğe bağlı)'}
          name="scheduledFor"
          type="datetime-local"
          value={values.scheduledWall}
          error={errors.scheduledFor}
          onChange={set('scheduledWall')}
        />
      </div>
      <p className="text-xs text-ink-muted">
        Öncelik ya da saat değişirse hedef yeniden hesaplanır: saat verilmişse o saat, verilmemişse isteğin açıldığı
        andan itibaren önceliğin süresi. Saatler otelin saatiyle ({timeZone}).
      </p>
      {actions.update.isError && !actions.update.error.details?.field && (
        <Alert tone="danger">{actions.update.error.message}</Alert>
      )}
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}
