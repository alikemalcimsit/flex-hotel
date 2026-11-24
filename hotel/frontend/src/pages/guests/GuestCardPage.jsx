import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ID_DOCUMENT_TYPES, ID_DOCUMENT_TYPE_LABELS, SUGGESTED_GUEST_TAGS } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { contactText, useCardActions, useGuestCard } from '../../lib/crm.js';
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
const ID_TYPE_OPTIONS = [{ value: '', label: '—' }, ...ID_DOCUMENT_TYPES.map((v) => ({ value: v, label: ID_DOCUMENT_TYPE_LABELS[v] }))];

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

function EditCardModal({ guest, actions, onClose }) {
  const [form, setForm] = useState({
    firstName: guest.firstName, lastName: guest.lastName, phone: guest.phone ?? '', email: guest.email ?? '',
    nationality: guest.nationality ?? '', idType: guest.idType ?? '', idNumber: guest.idNumber ?? '', birthDate: guest.birthDate ?? '',
  });
  const set = (k, v) => setForm({ ...form, [k]: v });

  const save = () => {
    const body = { ...form, idType: form.idType || undefined };
    actions.update.mutate(body, { onSuccess: onClose });
  };

  return (
    <Modal open title="Kartı düzenle" onClose={onClose} size="md"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button onClick={save} disabled={actions.update.isPending}>Kaydet</Button></div>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Ad" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        <Input label="Soyad" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        <Input label="Telefon" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        <Input label="E-posta" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        <Input label="Uyruk (ülke kodu)" maxLength={2} value={form.nationality} onChange={(e) => set('nationality', e.target.value.toUpperCase())} className="sm:w-40" />
        <Input label="Doğum tarihi" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
        <Select label="Kimlik türü" value={form.idType} onChange={(e) => set('idType', e.target.value)} options={ID_TYPE_OPTIONS} />
        <Input label="Kimlik no" value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
      </div>
      <p className="mt-2 text-xs text-ink-muted">Telefonda ülke kodu yoksa otelin kodu varsayılır.</p>
    </Modal>
  );
}
