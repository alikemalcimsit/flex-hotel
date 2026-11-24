import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SURVEY_FOLLOW_UP_NOTE_KIND_LABELS,
  SURVEY_FOLLOW_UP_NOTE_KINDS,
  SURVEY_FOLLOW_UP_OUTCOME_LABELS,
  SURVEY_FOLLOW_UP_OUTCOMES,
  SURVEY_FOLLOW_UP_STATUS_LABELS,
  SURVEY_FOLLOW_UP_STATUS_TONES,
  SURVEY_KIND_LABELS,
  npsCategory,
  surveyFollowUpNoteSchema,
  surveyFollowUpResolveSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { surveyKeys } from '../../lib/surveys.js';
import { validateWith } from '../../lib/validate.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ScoreBadges } from './SurveyResponsesPage.jsx';

/** Kapatma penceresi: sonuç ve nasıl kapandığı zorunlu. @param {{ followUp: any, onClose: () => void, onDone: (data: any) => void }} props */
function ResolveDialog({ followUp, onClose, onDone }) {
  const [form, setForm] = useState({ outcome: '', resolution: '' });
  const [errors, setErrors] = useState({});
  const resolve = useMutation({
    mutationFn: (body) => apiPost(`/surveys/follow-ups/${followUp.id}/resolve`, body),
    onSuccess: (data) => {
      toastSuccess('Takip kapatıldı');
      onDone(data);
    },
    onError: (error) => toastError(error.message),
  });
  const submit = (event) => {
    event.preventDefault();
    const body = { ...form, expectedUpdatedAt: followUp.updatedAt };
    const result = validateWith(surveyFollowUpResolveSchema, body);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) resolve.mutate(body);
  };
  return (
    <Modal
      open
      title="Takibi kapat"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="followup-resolve" icon="check" disabled={resolve.isPending}>
            {resolve.isPending ? 'Kapatılıyor…' : 'Kapat'}
          </Button>
        </>
      }
    >
      <form id="followup-resolve" className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Select
          label="Sonuç"
          options={[{ value: '', label: 'Seçin' }, ...SURVEY_FOLLOW_UP_OUTCOMES.map((value) => ({ value, label: SURVEY_FOLLOW_UP_OUTCOME_LABELS[value] }))]}
          value={form.outcome}
          onChange={(event) => setForm((current) => ({ ...current, outcome: event.target.value }))}
          error={errors.outcome}
        />
        <Textarea label="Nasıl kapandı" rows={3} maxLength={1000} value={form.resolution} onChange={(event) => setForm((current) => ({ ...current, resolution: event.target.value }))} error={errors.resolution} placeholder="Misafir arandı, bir sonraki konaklamada oda yükseltmesi teklif edildi; memnun kaldı." />
      </form>
    </Modal>
  );
}

/**
 * Düşük puan takibi (modül 55): cevabın tamamı, misafirin iletişim bilgisi, görüşme ve not geçmişi; üstlen / başkasına
 * ver / bırak, görüşme ya da not yaz, kapat (sonuç zorunlu), yeniden aç. Durum değişikliği sürümle (başkası aynı anda
 * değiştirdiyse "yenileyin").
 */
export function FollowUpPage() {
  const { followUpId } = useParams();
  const can = useCan();
  const canAct = can(PERMISSIONS.SURVEYS_FOLLOW_UP);
  const me = useAuthStore((state) => state.user?.email ?? null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: surveyKeys.followUp(followUpId), queryFn: () => api(`/surveys/follow-ups/${followUpId}`) });
  const assignees = useQuery({ queryKey: surveyKeys.assignees, queryFn: () => api('/surveys/follow-ups/assignees'), enabled: canAct, staleTime: 5 * 60_000 });
  const [note, setNote] = useState({ kind: 'CONTACT', text: '' });
  const [noteError, setNoteError] = useState(null);
  const [resolving, setResolving] = useState(false);

  const refresh = (data) => {
    queryClient.setQueryData(surveyKeys.followUp(followUpId), data);
    queryClient.invalidateQueries({ queryKey: ['surveys', 'follow-ups'] });
  };
  const onError = (error) => {
    toastError(error.message);
    if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: surveyKeys.followUp(followUpId) });
  };
  const assign = useMutation({ mutationFn: (assignedTo) => apiPost(`/surveys/follow-ups/${followUpId}/assign`, { expectedUpdatedAt: query.data.updatedAt, assignedTo }), onSuccess: refresh, onError });
  const reopen = useMutation({ mutationFn: () => apiPost(`/surveys/follow-ups/${followUpId}/reopen`, { expectedUpdatedAt: query.data.updatedAt }), onSuccess: refresh, onError });
  const addNote = useMutation({
    mutationFn: (body) => apiPost(`/surveys/follow-ups/${followUpId}/notes`, body),
    onSuccess: (data) => {
      refresh(data);
      setNote((current) => ({ ...current, text: '' }));
      toastSuccess('Kaydedildi');
    },
    onError,
  });

  if (query.isPending) return <Spinner label="Takip yükleniyor…" className="py-10" />;
  if (query.isError) {
    return (
      <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const data = query.data;
  const resolved = data.status === 'RESOLVED';
  const busy = assign.isPending || reopen.isPending;
  const submitNote = (event) => {
    event.preventDefault();
    const result = validateWith(surveyFollowUpNoteSchema, note);
    setNoteError(result.ok ? null : result.errors.text);
    if (result.ok) addNote.mutate(note);
  };

  return (
    <div className="flex flex-col gap-5">
      <Link to="/anketler/takip" className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← Takipler
      </Link>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card
            title={data.reservation.guestName ?? 'Misafir'}
            description={`${SURVEY_KIND_LABELS[data.kind]} · ${data.reservation.confirmationCode} · ${formatDate(data.reservation.checkIn)} – ${formatDate(data.reservation.checkOut)}${data.reservation.roomNumber ? ` · oda ${data.reservation.roomNumber}` : ''}`}
            actions={
              <Link to={`/rezervasyonlar/${data.reservation.id}`} className="text-sm font-semibold text-ink-soft hover:underline">
                Rezervasyon
              </Link>
            }
          >
            <div className="flex flex-col gap-3">
              <ScoreBadges row={{ ...data.response, lowScore: true, npsCategory: npsCategory(data.response.npsScore) }} />
              {data.comment ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{data.comment}</p> : <p className="text-sm text-ink-muted">Yorum yazılmamış.</p>}
              <p className="text-xs text-ink-muted">
                Gönderildi {formatDateTime(data.response.submittedAt)}
                {data.contact.phone ? ` · ${data.contact.phone}` : ''}
                {data.contact.email ? ` · ${data.contact.email}` : ''}
              </p>
            </div>
          </Card>

          <Card title="Görüşmeler ve notlar" description="Değişmez kayıt: kim, ne zaman, ne yaptı.">
            <div className="flex flex-col gap-4">
              {canAct && !resolved && (
                <form className="flex flex-col gap-3" onSubmit={submitNote} noValidate>
                  <ChoiceChips label="Tür" options={SURVEY_FOLLOW_UP_NOTE_KINDS.map((value) => ({ value, label: SURVEY_FOLLOW_UP_NOTE_KIND_LABELS[value] }))} value={note.kind} onChange={(value) => value && setNote((current) => ({ ...current, kind: value }))} />
                  <Textarea label={note.kind === 'CONTACT' ? 'Görüşme' : 'Not'} rows={2} maxLength={1000} value={note.text} onChange={(event) => setNote((current) => ({ ...current, text: event.target.value }))} error={noteError} placeholder={note.kind === 'CONTACT' ? 'Misafir arandı; klimanın arızası için özür dilendi…' : 'Teknik servise iş emri açıldı…'} />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" icon="plus" disabled={addNote.isPending}>
                      {addNote.isPending ? 'Kaydediliyor…' : 'Ekle'}
                    </Button>
                  </div>
                </form>
              )}
              {data.notes.length === 0 ? (
                <p className="text-sm text-ink-muted">Henüz kayıt yok.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {data.notes.map((entry) => (
                    <li key={entry.id} className="rounded-control border border-line p-3">
                      <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        <Badge tone={entry.kind === 'CONTACT' ? 'info' : 'neutral'}>{SURVEY_FOLLOW_UP_NOTE_KIND_LABELS[entry.kind]}</Badge>
                        {entry.createdBy} · {formatDateTime(entry.createdAt)}
                      </span>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink">{entry.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>

        <Card title="Takip">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SURVEY_FOLLOW_UP_STATUS_TONES[data.status]}>{SURVEY_FOLLOW_UP_STATUS_LABELS[data.status]}</Badge>
              {data.overdue && <Badge tone="danger">Gecikti</Badge>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink-muted">Hedef</dt>
              <dd className="tabular-nums">{formatDateTime(data.dueAt)}</dd>
              <dt className="text-ink-muted">Üstlenen</dt>
              <dd>{data.assignedTo ?? '—'}</dd>
              {resolved && (
                <>
                  <dt className="text-ink-muted">Sonuç</dt>
                  <dd>{SURVEY_FOLLOW_UP_OUTCOME_LABELS[data.outcome]}</dd>
                  <dt className="text-ink-muted">Kapatan</dt>
                  <dd>
                    {data.resolvedBy} · {formatDateTime(data.resolvedAt)}
                  </dd>
                </>
              )}
            </dl>
            {resolved && data.resolution && <p className="rounded-control bg-surface-muted p-3 text-sm text-ink">{data.resolution}</p>}
            {canAct && !resolved && (
              <div className="flex flex-col gap-2">
                {me && data.assignedTo !== me && (
                  <Button type="button" icon="user" disabled={busy} onClick={() => assign.mutate(me)}>
                    Üstlen
                  </Button>
                )}
                <Select
                  label="Başkasına ver"
                  options={[{ value: '', label: assignees.isPending ? 'Yükleniyor…' : 'Kişi seçin' }, ...(assignees.data ?? []).map((user) => ({ value: user.email, label: `${user.name} (${user.email})` }))]}
                  value=""
                  disabled={busy || !assignees.data}
                  onChange={(event) => event.target.value && assign.mutate(event.target.value)}
                />
                {data.assignedTo && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => assign.mutate(null)}>
                    Bırak
                  </Button>
                )}
                <Button type="button" variant="outline" icon="check" disabled={busy} onClick={() => setResolving(true)}>
                  Kapat
                </Button>
              </div>
            )}
            {canAct && resolved && (
              <Button type="button" variant="outline" icon="rotateCcw" disabled={busy} onClick={() => reopen.mutate()}>
                Yeniden aç
              </Button>
            )}
          </div>
        </Card>
      </div>
      {resolving && (
        <ResolveDialog
          followUp={data}
          onClose={() => setResolving(false)}
          onDone={(next) => {
            refresh(next);
            setResolving(false);
          }}
        />
      )}
    </div>
  );
}
