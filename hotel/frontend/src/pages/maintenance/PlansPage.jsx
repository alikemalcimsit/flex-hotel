import { useState } from 'react';
import { MAINTENANCE_CATEGORIES } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { Switch } from '../../components/Switch.jsx';
import { toastSuccess } from '../../store/toast.js';
import { categoryLabel, PRIORITY_OPTIONS, priorityLabel, usePlanActions, usePlans } from '../../lib/maintenance.js';

const PAGE_SIZE = 25;
const CATEGORY_OPTIONS = MAINTENANCE_CATEGORIES.map((v) => ({ value: v, label: categoryLabel(v) }));
const EMPTY = { title: '', description: '', category: 'OTHER', roomId: '', locationText: '', intervalDays: 30, priority: 3, checklist: [], active: true };

/** Periyodik bakım planı (modül 20): aylık kontrol listeleri; zamanlanmış iş bilet üretir. */
export function PlansPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const query = usePlans({ page, pageSize: PAGE_SIZE });
  const planActions = usePlanActions();

  const columns = [
    { key: 'title', header: 'Plan', className: 'font-semibold', render: (row) => row.title },
    { key: 'scope', header: 'Kapsam', render: (row) => (row.roomNumber ? `Oda ${row.roomNumber}` : row.locationText ?? 'Genel') },
    { key: 'category', header: 'Kategori', render: (row) => categoryLabel(row.category) },
    { key: 'interval', header: 'Periyot', render: (row) => `${row.intervalDays} gün` },
    { key: 'priority', header: 'Öncelik', render: (row) => priorityLabel(row.priority) },
    { key: 'active', header: 'Durum', render: (row) => <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Aktif' : 'Pasif'}</Badge> },
    { key: 'lastRunOn', header: 'Son üretim', className: 'text-right', render: (row) => row.lastRunOn ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Periyodik bakım planı"
        description="Aylık kontrol listeleri; her periyotta otomatik bilet üretir."
        actions={<Button icon="plus" onClick={() => setEditing(EMPTY)}>Yeni plan</Button>}
      />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={setPage}
        emptyTitle="Bakım planı yok"
        emptyHint="Yeni plan ekleyince burada listelenir."
        rowActions={(row) => (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>Düzenle</Button>
            <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoving(row)}>Sil</Button>
          </div>
        )}
      />

      {editing && (
        <PlanForm
          plan={editing}
          saving={planActions.create.isPending || planActions.update.isPending}
          error={planActions.create.error || planActions.update.error}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            const mutation = editing.id ? planActions.update : planActions.create;
            const args = editing.id ? { id: editing.id, body } : body;
            mutation.mutate(args, { onSuccess: () => { toastSuccess('Plan kaydedildi'); setEditing(null); } });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Plan silinsin mi?"
        message={`"${removing?.title}" planı silinecek; yeni bilet üretmeyecek.`}
        confirmLabel="Sil"
        confirmIcon="trash"
        onConfirm={() => planActions.remove.mutate(removing.id, { onSuccess: () => { toastSuccess('Plan silindi'); setRemoving(null); } })}
        onClose={() => setRemoving(null)}
        isPending={planActions.remove.isPending}
      />
    </div>
  );
}

/** @param {{ plan: any, saving: boolean, error: any, onSave: (body: any) => void, onClose: () => void }} props */
function PlanForm({ plan, saving, error, onSave, onClose }) {
  const [form, setForm] = useState(plan);
  const [room, setRoom] = useState(plan.roomId ? { id: plan.roomId, number: plan.roomNumber } : null);
  const [useRoom, setUseRoom] = useState(Boolean(plan.roomId) || !plan.locationText);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  function addItem() {
    set({ checklist: [...form.checklist, ''] });
  }
  function setItem(index, value) {
    set({ checklist: form.checklist.map((item, i) => (i === index ? value : item)) });
  }
  function removeItem(index) {
    set({ checklist: form.checklist.filter((_, i) => i !== index) });
  }

  function submit() {
    const body = {
      title: form.title.trim(),
      description: form.description?.trim() || undefined,
      category: form.category,
      intervalDays: Number(form.intervalDays),
      priority: Number(form.priority),
      checklist: form.checklist.map((s) => s.trim()).filter(Boolean),
      active: form.active,
    };
    if (useRoom) body.roomId = room?.id || undefined;
    else body.locationText = form.locationText?.trim() || undefined;
    onSave(body);
  }

  return (
    <Modal open size="lg" title={plan.id ? 'Planı düzenle' : 'Yeni bakım planı'} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button icon="check" disabled={saving} onClick={submit}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      </>}>
      <div className="space-y-4">
        <Input label="Başlık" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Aylık klima bakımı" />
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" checked={useRoom} onChange={() => setUseRoom(true)} /> Oda</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" checked={!useRoom} onChange={() => setUseRoom(false)} /> Genel / konum</label>
        </div>
        {useRoom
          ? <RoomPicker label="Oda" value={room} onChange={setRoom} />
          : <Input label="Konum" value={form.locationText} onChange={(e) => set({ locationText: e.target.value })} placeholder="Tüm katlar, çatı…" />}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Kategori" value={form.category} onChange={(e) => set({ category: e.target.value })} options={CATEGORY_OPTIONS} />
          <Input label="Periyot (gün)" type="number" min={1} value={form.intervalDays} onChange={(e) => set({ intervalDays: e.target.value })} />
          <Select label="Öncelik" value={String(form.priority)} onChange={(e) => set({ priority: e.target.value })} options={PRIORITY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} />
        </div>
        <Textarea label="Açıklama (opsiyonel)" value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })} rows={2} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Kontrol listesi</span>
            <Button type="button" variant="outline" size="sm" icon="plus" onClick={addItem}>Madde ekle</Button>
          </div>
          <div className="space-y-2">
            {form.checklist.length === 0 && <p className="text-sm text-ink-muted">Henüz madde yok.</p>}
            {form.checklist.map((item, index) => (
              <div key={index} className="flex gap-2">
                <Input value={item} onChange={(e) => setItem(index, e.target.value)} placeholder="Filtre temizliği" className="flex-1" />
                <Button type="button" variant="ghost" icon="trash" onClick={() => removeItem(index)} aria-label="Maddeyi sil" />
              </div>
            ))}
          </div>
        </div>

        <Switch checked={form.active} onChange={(v) => set({ active: v })} label="Plan aktif" showLabel />
        {error && <Alert tone="danger" title="Kaydedilemedi">{error.message}</Alert>}
      </div>
    </Modal>
  );
}
