import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createAllotmentSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { agencyKeys } from '../../lib/agencies.js';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';
import { useAgencyContext } from './AgencyPage.jsx';

/**
 * Acentenin allotment / kota sekmesi (modül 30): dönem boyunca gecelik ayrılan
 * oda kotası. Release tarihine (giriş − release günü) kadar kullanılmamış kota
 * genel satışa kapalıdır; kota garanti, tavan değil — dolunca acente genel
 * havuzdan satmaya devam eder.
 */

const EMPTY = { roomTypeId: '', startDate: '', endDate: '', quantity: '10', releaseDays: '7', notes: '' };

const allotmentKeys = {
  list: (agencyId, page) => ['agencies', 'allotments', agencyId, page],
  usage: (allotmentId) => ['agencies', 'allotment-usage', allotmentId],
};

export function AgencyAllotmentsTab() {
  const { agency } = useAgencyContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.AGENCIES_MANAGE);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [usageOf, setUsageOf] = useState(null);

  const query = useQuery({
    queryKey: allotmentKeys.list(agency.id, page),
    queryFn: () => api(withQuery(`/agencies/${agency.id}/allotments`, { page })),
    placeholderData: (previous) => previous,
  });
  const roomTypes = useQuery({ queryKey: ['settings', 'room-types', 'all'], queryFn: () => api('/settings/room-types?pageSize=200') });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['agencies', 'allotments', agency.id] });

  const createMutation = useMutation({
    mutationFn: (values) => apiPost(`/agencies/${agency.id}/allotments`, values),
    onSuccess: () => {
      invalidate();
      toastSuccess('Kota eklendi');
      setEditing(null);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, values }) => apiPut(`/agencies/allotments/${id}`, values),
    onSuccess: () => {
      invalidate();
      toastSuccess('Kota güncellendi');
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => apiDelete(`/agencies/allotments/${id}`),
    onSuccess: () => {
      invalidate();
      toastSuccess('Kota silindi');
      setDeleting(null);
    },
  });

  const columns = [
    { key: 'roomType', header: 'Oda tipi', className: 'font-semibold', render: (row) => `${row.roomTypeCode} — ${row.roomTypeName}` },
    { key: 'period', header: 'Dönem', render: (row) => `${formatDate(row.startDate)} – ${formatDate(row.endDate)}` },
    { key: 'quantity', header: 'Gecelik kota', className: 'tabular-nums', render: (row) => `${row.quantity} oda` },
    {
      key: 'releaseDays',
      header: 'Release',
      render: (row) => (row.releaseDays > 0 ? `Girişten ${row.releaseDays} gün önce` : <Badge tone="neutral" dot={false}>Girişe kadar</Badge>),
    },
    { key: 'notes', header: 'Not', className: 'max-w-48 truncate text-ink-muted', render: (row) => row.notes ?? '—' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          Kota, dönemdeki her gece için acenteye ayrılan oda adedidir: release tarihine kadar resepsiyon ve kanal satışına
          kapalı sayılır. Kota dolunca acente, boş yer varsa genel havuzdan satmaya devam eder (kota garanti, tavan değil).
        </p>
        {canManage && (
          <Button icon="plus" onClick={() => setEditing(EMPTY)} disabled={!roomTypes.data?.items?.length}>
            Yeni kota
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        onPageChange={setPage}
        emptyTitle="Henüz kota tanımlanmamış"
        emptyHint="Kota olmayan dönemde acente genel müsaitlikten satar."
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" icon="chart" onClick={() => setUsageOf(row)}>
              Kullanım
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
                <Button variant="dangerSoft" size="sm" icon="trash" onClick={() => setDeleting(row)}>
                  Sil
                </Button>
              </>
            )}
          </div>
        )}
      />

      {editing && (
        <AllotmentFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          roomTypes={roomTypes.data?.items ?? []}
          isPending={createMutation.isPending || updateMutation.isPending}
          error={createMutation.error ?? updateMutation.error}
          onClose={() => {
            setEditing(null);
            createMutation.reset();
            updateMutation.reset();
          }}
          onSubmit={(values) => {
            if (editing.id) updateMutation.mutate({ id: editing.id, values: { ...values, expectedUpdatedAt: editing.updatedAt } });
            else createMutation.mutate(values);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Kotayı sil"
        message={`${deleting?.roomTypeCode} tipindeki ${deleting ? formatDate(deleting.startDate) : ''} – ${deleting ? formatDate(deleting.endDate) : ''} kotası silinecek; bu geceler genel satışa açılır.`}
        isPending={deleteMutation.isPending}
        error={deleteMutation.error}
        onClose={() => {
          setDeleting(null);
          deleteMutation.reset();
        }}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
      />

      {usageOf && <AllotmentUsageModal allotment={usageOf} onClose={() => setUsageOf(null)} />}
    </div>
  );
}

function AllotmentFormModal({ initial, roomTypes, onSubmit, onClose, isPending, error }) {
  const [form, setForm] = useState({
    roomTypeId: initial.roomTypeId ?? '',
    startDate: initial.startDate ?? '',
    endDate: initial.endDate ?? '',
    quantity: String(initial.quantity ?? '10'),
    releaseDays: String(initial.releaseDays ?? '7'),
    notes: initial.notes ?? '',
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(createAllotmentSchema, { ...form, notes: form.notes || null });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  const roomTypeOptions = [
    { value: '', label: 'Oda tipi seçin', disabled: true },
    ...roomTypes.map((type) => ({ value: type.id, label: `${type.code} — ${type.name}` })),
  ];

  return (
    <Modal
      open
      title={initial.id ? 'Kotayı düzenle' : 'Yeni kota'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="allotment-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="allotment-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Select label="Oda tipi" name="roomTypeId" value={form.roomTypeId} onChange={setField('roomTypeId')} options={roomTypeOptions} error={errors.roomTypeId} className="sm:col-span-2" />
        <Input label="Başlangıç" name="startDate" type="date" value={form.startDate} onChange={setField('startDate')} error={errors.startDate} />
        <Input label="Bitiş" name="endDate" type="date" value={form.endDate} onChange={setField('endDate')} error={errors.endDate} />
        <Input label="Gecelik kota (oda)" name="quantity" type="number" min={1} max={500} value={form.quantity} onChange={setField('quantity')} error={errors.quantity} />
        <Input label="Release (girişten gün önce)" name="releaseDays" type="number" min={0} max={365} value={form.releaseDays} onChange={setField('releaseDays')} error={errors.releaseDays} />
        <Textarea label="Not (opsiyonel)" name="notes" rows={2} maxLength={500} value={form.notes} onChange={setField('notes')} error={errors.notes} className="sm:col-span-2" />
      </form>
      {error && <Alert tone="danger" title="Kaydedilemedi" className="mt-5">{error.message}</Alert>}
      <Alert tone="info" className="mt-5">
        Aynı oda tipinde kotaların dönemleri çakışamaz — bir geceye tek kota satırı düşmeli. Release 0: kota giriş gününe
        kadar tutulur, giriş günü serbest kalır.
      </Alert>
    </Modal>
  );
}

/** Kota kullanım tablosu: gün gün verilen / kullanılan / kalan; release edilen günler soluk. */
function AllotmentUsageModal({ allotment, onClose }) {
  const query = useQuery({
    queryKey: allotmentKeys.usage(allotment.id),
    queryFn: () => api(`/agencies/allotments/${allotment.id}/usage`),
  });

  const usage = query.data;
  return (
    <Modal open title={`Kota kullanımı — ${allotment.roomTypeCode}`} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}>
      {query.isPending && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {query.isError && <Alert tone="danger" title="Kullanım yüklenemedi">{query.error.message}</Alert>}
      {usage && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info" dot={false}>{usage.summary.givenNights} oda-gece verildi</Badge>
            <Badge tone="success" dot={false}>{usage.summary.usedNights} kullanıldı</Badge>
            <Badge tone="neutral" dot={false}>{usage.summary.remainingNights} kalan</Badge>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-item border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-muted text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Gece</th>
                  <th className="px-3 py-2 text-right font-medium">Verilen</th>
                  <th className="px-3 py-2 text-right font-medium">Kullanılan</th>
                  <th className="px-3 py-2 text-right font-medium">Kalan</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {usage.days.map((day) => (
                  <tr key={day.day} className={day.released ? 'text-ink-soft' : undefined}>
                    <td className="px-3 py-1.5">{formatDate(day.day)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{day.given}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{day.used}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{day.remaining}</td>
                    <td className="px-3 py-1.5">
                      {day.released ? <Badge tone="neutral" dot={false}>Release</Badge> : <Badge tone="info" dot={false}>Tutulu</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-muted">
            Release edilen gecelerde kalan kota genel satışa açıktır; kullanım yine acentenin o geceki rezervasyon sayısıdır.
          </p>
        </div>
      )}
    </Modal>
  );
}
