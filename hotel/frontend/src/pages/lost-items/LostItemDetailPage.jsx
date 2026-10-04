import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOST_ITEM_CONTACT_CHANNELS, LOST_ITEM_OPEN_STATUSES, lostItemContactSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Select, Spinner, Textarea } from '@hotelos/ui';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import {
  STATUS_TONES,
  categoryLabel,
  channelLabel,
  disposalLabel,
  lostItemKeys,
  placeText,
  returnMethodLabel,
  shippingPayerLabel,
  statusLabel,
} from '../../lib/lost-items.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { LOST_ITEMS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { DisposeDialog, MatchDialog, ReturnDialog, UnmatchDialog } from './LostItemDialogs.jsx';
import { LostItemFormDialog } from './LostItemFormDialog.jsx';
import { LostItemGallery } from './LostItemPhotos.jsx';

const LIVE_MIN_INTERVAL_MS = 1000;
const timeFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatTime = (value) => (value ? timeFormatter.format(new Date(value)) : '—');
const CHANNEL_OPTIONS = LOST_ITEM_CONTACT_CHANNELS.map((value) => ({ value, label: channelLabel(value) }));

/**
 * Kayıp eşya ekranı (modül 21): etiket no, fotoğraflar, bilgiler, sahibi
 * (eşleştirme ve iletişim bilgisi), iletişim notları; teslim, kapatma ve
 * düzeltme yetkiye ve duruma göre. Canlı: başkası değiştirince tazelenir.
 */
export function LostItemDetailPage() {
  const { id } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);

  useLiveChannel(LOST_ITEMS_CHANNEL, {
    queryKeys: (payload) => (!payload || payload.itemId === id || payload.event === 'lost_items.settings.changed' ? [lostItemKeys.detail(id)] : []),
    minIntervalMs: LIVE_MIN_INTERVAL_MS,
  });
  const detail = useQuery({ queryKey: lostItemKeys.detail(id), queryFn: () => api(`/lost-items/${id}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: lostItemKeys.all });

  if (detail.isPending) return <Spinner className="py-10" />;
  if (detail.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert
          tone="danger"
          title={detail.error.status === 404 ? 'Kayıt bulunamadı' : 'Eşya yüklenemedi'}
          action={detail.error.status === 404 ? null : <Button size="sm" variant="outline" icon="refresh" onClick={() => detail.refetch()}>Tekrar dene</Button>}
        >
          {detail.error.message}
        </Alert>
      </div>
    );
  }

  const item = detail.data;
  const open = LOST_ITEM_OPEN_STATUSES.includes(item.status);
  const canRecord = can(PERMISSIONS.LOST_ITEMS_RECORD) && open;
  const canRelease = can(PERMISSIONS.LOST_ITEMS_RELEASE);
  const canManage = can(PERMISSIONS.LOST_ITEMS_MANAGE) && open;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-2xl font-bold tracking-wider">{item.reference}</p>
          <h1 className="mt-1 text-lg font-bold text-ink">{item.description}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[item.status]}>{statusLabel(item.status)}</Badge>
            {item.valuable && <Badge tone="violet">Değerli</Badge>}
            {item.expired && <Badge tone="danger">Saklama süresi doldu</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRecord && <Button variant="outline" icon="pencil" onClick={() => setDialog('edit')}>Düzelt</Button>}
          {canRelease && open && (
            <Button variant="outline" icon="users" onClick={() => setDialog('match')}>{item.guest ? 'Başka misafir' : 'Sahibini bul'}</Button>
          )}
          {canRelease && open && <Button icon="checkCheck" onClick={() => setDialog('return')}>Teslim et</Button>}
          {canManage && <Button variant="dangerSoft" icon="lock" onClick={() => setDialog('dispose')}>Kapat</Button>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card title="Fotoğraflar">
            <LostItemGallery item={item} canEdit={can(PERMISSIONS.LOST_ITEMS_RECORD) && open} onChanged={refresh} />
          </Card>
          <Notes item={item} canWrite={canRelease} />
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Bilgiler">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Field label="Kategori">{categoryLabel(item.category)}</Field>
              <Field label="Bulunduğu yer">{placeText(item)}</Field>
              <Field label="Bulunma">{formatTime(item.foundAt)}</Field>
              <Field label="Bulan">{item.foundByName}</Field>
              <Field label="Saklandığı yer">{item.storageLocation}</Field>
              <Field label="Kaydeden">{item.recordedBy}</Field>
              {open && (
                <Field label="Saklama">
                  {formatDate(item.retainUntil)} tarihine kadar
                  {item.expired ? <span className="ml-1 font-semibold text-danger-ink">(doldu)</span> : null}
                </Field>
              )}
            </dl>
          </Card>
          <Owner item={item} canRelease={canRelease} onUnmatch={() => setDialog('unmatch')} />
          <Outcome item={item} />
        </div>
      </div>

      {dialog === 'edit' && <LostItemFormDialog item={item} onClose={() => setDialog(null)} onSaved={() => { refresh(); setDialog(null); }} />}
      {dialog === 'match' && <MatchDialog item={item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'unmatch' && <UnmatchDialog item={item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'return' && <ReturnDialog item={item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'dispose' && <DisposeDialog item={item} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/kayip-esya" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Kayıp eşya
    </Link>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Field({ label, children }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-ink">{children}</dd>
    </>
  );
}

/**
 * Sahibi: eşleşen misafir, konaklaması, iletişim bilgisi (teslim yetkisiyle).
 * @param {{ item: any, canRelease: boolean, onUnmatch: () => void }} props
 */
function Owner({ item, canRelease, onUnmatch }) {
  if (!item.guest) {
    return (
      <Card title="Sahibi">
        <p className="text-sm text-ink-muted">
          {LOST_ITEM_OPEN_STATUSES.includes(item.status) ? 'Henüz bir misafirle eşleşmedi.' : 'Misafirle eşleşmeden kapandı.'}
        </p>
      </Card>
    );
  }
  return (
    <Card title="Sahibi">
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-base font-bold">{item.guest.name}</p>
        {item.stay && (
          <p className="text-ink-soft">
            <span className="font-mono text-xs">{item.stay.confirmationCode}</span> · oda {item.stay.roomNumber ?? '—'} · {formatDate(item.stay.checkIn)} – {formatDate(item.stay.checkOut)}
          </p>
        )}
        {canRelease && (
          <p className="flex flex-wrap gap-3">
            {item.guest.phone ? (
              <a className="inline-flex items-center gap-1 font-semibold text-info-ink hover:underline" href={`tel:${item.guest.phone}`}>
                <Icon name="phone" className="size-4" /> {item.guest.phone}
              </a>
            ) : null}
            {item.guest.email ? (
              <a className="inline-flex items-center gap-1 font-semibold text-info-ink hover:underline" href={`mailto:${item.guest.email}`}>
                <Icon name="mail" className="size-4" /> {item.guest.email}
              </a>
            ) : null}
            {!item.guest.phone && !item.guest.email && <span className="text-ink-muted">Kayıtlı iletişim bilgisi yok.</span>}
          </p>
        )}
        <p className="text-xs text-ink-muted">Eşleştiren {item.matchedBy} · {formatTime(item.matchedAt)}</p>
        {canRelease && item.status === 'MATCHED' && (
          <div>
            <Button size="sm" variant="ghost" icon="close" onClick={onUnmatch}>Eşleşmeyi kaldır</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** @param {{ item: any }} props */
function Outcome({ item }) {
  if (item.returned) {
    const shipped = item.returned.method === 'SHIPPED';
    return (
      <Card title={returnMethodLabel(item.returned.method)}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Field label={shipped ? 'Alıcı' : 'Teslim alan'}>{item.returned.receiverName ?? '—'}</Field>
          {!shipped && <Field label="Kimlik">{item.returned.receiverIdChecked ? 'Görüldü' : 'Görülmedi'}</Field>}
          {shipped && <Field label="Kargo">{item.returned.carrier} · {item.returned.trackingNumber}</Field>}
          {shipped && item.returned.shippingAddress !== undefined && <Field label="Adres">{item.returned.shippingAddress}</Field>}
          {shipped && (
            <Field label="Ücret">
              {shippingPayerLabel(item.returned.shippingPayer)}
              {item.returned.shippingCost ? ` · ${formatMoney(item.returned.shippingCost)}` : ''}
            </Field>
          )}
          {item.returned.note && <Field label="Not">{item.returned.note}</Field>}
          <Field label="Tarih">{formatTime(item.closedAt)} · {item.closedBy}</Field>
        </dl>
      </Card>
    );
  }
  if (item.disposal) {
    return (
      <Card title={`Kapatıldı: ${disposalLabel(item.disposal.method)}`}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Field label="Gerekçe">{item.disposal.reason}</Field>
          <Field label="Tarih">{formatTime(item.closedAt)} · {item.closedBy}</Field>
        </dl>
      </Card>
    );
  }
  return null;
}

/**
 * İletişim notları ("aradım, açmadı"); en yeni üstte. Yazma teslim yetkisiyle.
 * @param {{ item: any, canWrite: boolean }} props
 */
function Notes({ item, canWrite }) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('PHONE');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/lost-items/${item.id}/notes`, body),
    onSuccess: () => {
      toastSuccess('Not eklendi');
      setText('');
      queryClient.invalidateQueries({ queryKey: lostItemKeys.detail(item.id) });
    },
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(lostItemContactSchema, { channel, text });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }
  return (
    <Card title="İletişim notları">
      <div className="flex flex-col gap-4">
        {canWrite && (
          <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
            {mutation.error && <Alert tone="danger" title="Not eklenemedi">{mutation.error.message}</Alert>}
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Select label="Kanal" value={channel} onChange={(event) => setChannel(event.target.value)} options={CHANNEL_OPTIONS} />
              <Textarea label="Not" rows={2} placeholder="Ör. misafiri aradım, kargo adresini WhatsApp'tan gönderecek" value={text} onChange={(event) => setText(event.target.value)} error={errors.text} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" icon="plus" disabled={mutation.isPending}>Not ekle</Button>
            </div>
          </form>
        )}
        {item.notes.length === 0 ? (
          <EmptyState icon="message" title="Not yok" description={canWrite ? 'Misafirle her iletişimi buraya yazın.' : ''} />
        ) : (
          <ul className="flex flex-col gap-3">
            {item.notes.map((note) => (
              <li key={note.id} className="rounded-item border border-line px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <Badge tone="neutral">{channelLabel(note.channel)}</Badge>
                  {note.createdBy} · {formatTime(note.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-ink">{note.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
