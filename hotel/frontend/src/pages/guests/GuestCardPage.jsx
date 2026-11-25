import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ID_DOCUMENT_TYPE_LABELS, SUGGESTED_GUEST_TAGS, guestCardUpdateSchema, maskIdNumber } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Input } from '@hotelos/ui';
import { IdReadBadge, IdScanDialog } from '../../components/IdScanDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { contactText, useCardActions, useGuestCard } from '../../lib/crm.js';
import { stillFromDocument } from '../../lib/idScan.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { IdentityFields, identityBody, toIdentityForm } from '../front-desk/IdentityFields.jsx';
import { PreferencesTab } from './PreferencesTab.jsx';
import { NotesTab } from './NotesTab.jsx';
import { StaysTab } from './StaysTab.jsx';
import { SpendTab } from './SpendTab.jsx';
import { MergeDialog } from './MergeDialog.jsx';

const TABS = [
  { key: 'prefs', label: 'Tercihler' },
  { key: 'stays', label: 'Konaklama geçmişi' },
  { key: 'spend', label: 'Harcama' },
  { key: 'notes', label: 'Notlar' },
];

/** Misafir kartı (modül 22): özet, tercihler, geçmiş, harcama, notlar, birleştirme. */
export function GuestCardPage() {
  const { id } = useParams();
  const can = useCan();
  const query = useGuestCard(id);
  const actions = useCardActions(id);
  const [tab, setTab] = useState('prefs');
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Misafir kartı yüklenemedi" />;
  const guest = query.data;
  const canManage = can(PERMISSIONS.GUESTS_MANAGE);

  const toggleTag = (tag) => {
    const next = guest.tags.includes(tag) ? guest.tags.filter((t) => t !== tag) : [...guest.tags, tag];
    actions.update.mutate({ tags: next });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={guest.name}
        description={contactText(guest)}
        actions={
          <span className="flex gap-2">
            {canManage && <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>Düzenle</Button>}
            {can(PERMISSIONS.GUESTS_MERGE) && <Button variant="outline" icon="checkCheck" onClick={() => setMerging(true)}>Birleştir</Button>}
          </span>
        }
      />

      {/* Etiketler */}
      <div className="flex flex-wrap items-center gap-2">
        {guest.tags.map((t) => (
          <Badge key={t} tone={t.toLowerCase() === 'vip' ? 'success' : t.toLowerCase() === 'sorunlu' ? 'danger' : 'neutral'}>
            {t}
            {canManage && <button type="button" className="ml-1" onClick={() => toggleTag(t)} aria-label={`${t} etiketini kaldır`}><Icon name="close" className="size-3" /></button>}
          </Badge>
        ))}
        {canManage && SUGGESTED_GUEST_TAGS.filter((t) => !guest.tags.includes(t)).map((t) => (
          <button key={t} type="button" onClick={() => toggleTag(t)} className="rounded-full border border-dashed border-line-strong px-3 py-1 text-xs font-semibold text-ink-muted hover:border-ink hover:text-ink">
            + {t}
          </button>
        ))}
      </div>

      {/* Kimlik (modül 59: belgeden okunduysa rozet) */}
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <Icon name="user" className="size-4 text-ink-muted" />
        {guest.idType ? `${ID_DOCUMENT_TYPE_LABELS[guest.idType] ?? guest.idType} · ${maskIdNumber(guest.idNumber) ?? '—'}${guest.nationality ? ` · ${guest.nationality}` : ''}${guest.birthDate ? ` · ${formatDate(guest.birthDate)}` : ''}` : 'Kimlik bilgisi yok'}
        <IdReadBadge read={guest.idRead} />
      </p>

      {/* Özet */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Konaklama" value={guest.summary.stayCount} hint={guest.summary.firstStayOn ? `İlk: ${formatDate(guest.summary.firstStayOn)}` : 'Henüz konaklama yok'} icon="bed" />
        <SummaryTile label="Toplam harcama" value={formatMoney(guest.summary.totalSpend)} hint="Folyolara işlenen borç" icon="wallet" />
        <SummaryTile label="Son konaklama" value={guest.summary.lastStay ? formatDate(guest.summary.lastStay.checkIn) : '—'} hint={guest.summary.lastStay?.confirmationCode ?? ''} icon="calendar" />
      </div>

      {/* Sekmeler */}
      <div className="inline-flex gap-1 rounded-control border border-line bg-surface p-1 shadow-soft">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-item px-4 py-2 text-sm font-semibold transition-colors ${tab === t.key ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'prefs' && <PreferencesTab preferences={guest.preferences} actions={actions} canManage={canManage} />}
      {tab === 'stays' && <StaysTab guestId={id} />}
      {tab === 'spend' && <SpendTab guestId={id} />}
      {tab === 'notes' && <NotesTab notes={guest.notes} actions={actions} canManage={canManage} />}

      {editing && <EditCardModal guest={guest} actions={actions} onClose={() => setEditing(false)} />}
      <MergeDialog open={merging} onClose={() => setMerging(false)} target={guest} />
    </div>
  );
}

/**
 * Kart düzenleme. Kimlik girişteki kurallarla (TC no sağlaması, uyruk listesi, eksiksiz belge) ve girişteki
 * bileşenle; "Kimlik tara" (modül 59) okunanı alan alan karşılaştırıp forma yazar. Boş bırakılan telefon /
 * e-posta silinir.
 */
function EditCardModal({ guest, actions, onClose }) {
  const { today } = useHotelToday();
  const [form, setForm] = useState({ firstName: guest.firstName, lastName: guest.lastName, phone: guest.phone ?? '', email: guest.email ?? '' });
  const initialIdentity = toIdentityForm({ idType: guest.idType, idNumber: guest.idNumber, nationality: guest.nationality, birthDate: guest.birthDate });
  const [identity, setIdentity] = useState(initialIdentity);
  const [read, setRead] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm({ ...form, [k]: v });
  const identityChanged = !stillFromDocument(identityBody(identity), identityBody(initialIdentity));
  const documentRead = read && stillFromDocument(identityBody(identity), read.snapshot) ? read.documentRead : null;

  const save = () => {
    const body = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email,
      ...(identityChanged || documentRead ? identityBody(identity) : {}),
      documentRead,
    };
    const result = validateWith(guestCardUpdateSchema, body);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.errors).map(([key, message]) => [`card.${key}`, message])));
      return;
    }
    setErrors({});
    actions.update.mutate(body, {
      onSuccess: () => {
        toastSuccess('Misafir kartı kaydedildi');
        onClose();
      },
      onError: (error) => {
        if (error.fields) setErrors(Object.fromEntries(Object.entries(error.fields).map(([key, message]) => [`card.${key}`, message])));
      },
    });
  };
  const error = (key) => errors[`card.${key}`];
  const busy = actions.update.isPending;

  return (
    <Modal open title="Kartı düzenle" onClose={busy ? () => {} : onClose} size="lg"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button><Button icon="check" onClick={save} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button></div>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Ad" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} error={error('firstName')} disabled={busy} />
          <Input label="Soyad" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} error={error('lastName')} disabled={busy} />
          <Input label="Telefon" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={error('phone')} disabled={busy} />
          <Input label="E-posta" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={error('email')} disabled={busy} />
        </div>
        <p className="-mt-2 text-xs text-ink-muted">Telefonda ülke kodu yoksa otelin kodu varsayılır. Boş bırakılan telefon / e-posta karttan silinir.</p>
        <section className="flex flex-col gap-3" aria-labelledby="card-identity">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="card-identity" className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
              Kimlik
              <IdReadBadge read={documentRead ? { at: null } : !identityChanged && !read ? guest.idRead : null} />
              {read && !documentRead && <Badge tone="warning">okunduktan sonra elle değişti</Badge>}
            </h3>
            <Button size="sm" variant="outline" icon="camera" onClick={() => setScanning(true)} disabled={busy}>Kimlik tara</Button>
          </div>
          {error('documentRead') && <p className="text-xs font-semibold text-sec-strong">{error('documentRead')}</p>}
          <IdentityFields value={identity} onChange={setIdentity} errors={errors} prefix="card" optional disabled={busy} />
        </section>
      </div>
      {scanning && (
        <IdScanDialog
          title={`Kimlik tara — ${guest.name}`}
          current={{ firstName: form.firstName, lastName: form.lastName, ...identity }}
          today={today}
          matchEndpoint="/guests/identity-matches"
          excludeGuestIds={[guest.id]}
          onApply={({ values, documentRead: fromDocument }) => {
            const next = { idType: values.idType ?? '', idNumber: values.idNumber ?? '', nationality: values.nationality ?? '', birthDate: values.birthDate ?? '' };
            setIdentity(next);
            setRead(fromDocument ? { snapshot: identityBody(next), documentRead: fromDocument } : null);
            setForm((current) => ({ ...current, firstName: values.firstName || current.firstName, lastName: values.lastName || current.lastName }));
            setErrors({});
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Modal>
  );
}
