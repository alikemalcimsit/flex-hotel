import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Spinner, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useAuthStore } from '../../store/auth.js';
import { toastSuccess } from '../../store/toast.js';
import { categoryLabel, placeText, priorityLabel, statusLabel, statusTone, useTicket, useTicketAction } from '../../lib/maintenance.js';
import { TicketGallery } from './TicketPhotos.jsx';

const OPEN = ['PENDING', 'IN_PROGRESS'];

/** Arıza bileti ayrıntısı (modül 20): bilgi, fotoğraflar ve yetkiye göre işlemler. */
export function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const meId = useAuthStore((s) => s.user?.id);
  const query = useTicket(id);
  const actions = useTicketAction(id);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  if (query.isPending) return <Spinner className="py-10" />;
  if (query.error) return <Alert tone="danger" title="Bilet açılamadı">{query.error.message}</Alert>;

  const ticket = query.data;
  const isOpen = OPEN.includes(ticket.status);
  const canOperate = can(PERMISSIONS.MAINTENANCE_OPERATE);
  const canManage = can(PERMISSIONS.MAINTENANCE_MANAGE);

  const info = [
    ['Konum', placeText(ticket)],
    ['Kategori', categoryLabel(ticket.category)],
    ['Öncelik', priorityLabel(ticket.priority)],
    ['Açan', ticket.reportedBy],
    ['Atanan', ticket.assignedTo ?? '—'],
    ['Açılış', formatDateTime(ticket.createdAt)],
    ['Başlama', ticket.startedAt ? formatDateTime(ticket.startedAt) : '—'],
    ['Çözüm', ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : '—'],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={ticket.title}
        description={ticket.roomBlockId ? 'Oda arızaya alındı; bilet çözülünce açılır.' : undefined}
        actions={<Button variant="ghost" icon="arrowLeft" onClick={() => navigate('/teknik-servis')}>Listeye dön</Button>}
      />

      <div className="rounded-card bg-surface p-6 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <Badge tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Badge>
          {ticket.source === 'housekeeping' && <span className="text-xs text-ink-muted">Kat görevlisi bildirdi</span>}
          {ticket.source === 'plan' && <span className="text-xs text-ink-muted">Periyodik bakım</span>}
          {ticket.guestRequestId && <span className="text-xs text-ink-muted">Misafir isteğine bağlı</span>}
        </div>
        <p className="whitespace-pre-wrap text-ink">{ticket.description}</p>
        {ticket.resolutionNote && <p className="mt-3 rounded-item bg-success-soft p-3 text-sm text-success-ink"><strong>Çözüm:</strong> {ticket.resolutionNote}</p>}
        {ticket.cancelReason && <p className="mt-3 rounded-item bg-black/[0.03] p-3 text-sm text-ink-soft"><strong>İptal:</strong> {ticket.cancelReason}</p>}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-card bg-surface p-6 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink">Fotoğraflar</h2>
        <TicketGallery
          ticket={ticket}
          canEdit={canOperate && isOpen}
          onUpload={(photo) => actions.addPhoto.mutateAsync(photo)}
          onRemove={(photoId) => actions.removePhoto.mutateAsync(photoId)}
          removing={actions.removePhoto.isPending}
        />
      </div>

      {isOpen && (
        <div className="flex flex-wrap gap-3">
          {canOperate && ticket.status === 'PENDING' && (
            <Button icon="play" disabled={actions.start.isPending} onClick={() => actions.start.mutate(undefined, { onSuccess: () => toastSuccess('Başlandı') })}>Başla</Button>
          )}
          {canOperate && <Button icon="check" variant="primary" onClick={() => setResolving(true)}>Çözüldü</Button>}
          {canManage && meId && (
            ticket.assignedTo === meId
              ? <Button variant="outline" onClick={() => actions.assign.mutate({ assignedTo: null }, { onSuccess: () => toastSuccess('Atama kaldırıldı') })}>Atamayı kaldır</Button>
              : <Button variant="outline" icon="user" onClick={() => actions.assign.mutate({ assignedTo: meId }, { onSuccess: () => toastSuccess('Bana atandı') })}>Bana ata</Button>
          )}
          {canManage && <Button variant="ghost" icon="close" onClick={() => setCancelling(true)}>İptal et</Button>}
        </div>
      )}

      <Modal open={resolving} title="Arızayı çöz" onClose={() => setResolving(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setResolving(false)}>Vazgeç</Button>
          <Button icon="check" disabled={actions.resolve.isPending} onClick={() => actions.resolve.mutate({ resolutionNote: note.trim() || undefined }, { onSuccess: () => { toastSuccess('Çözüldü'); setResolving(false); setNote(''); } })}>Çözüldü olarak kapat</Button>
        </>}>
        <Textarea label="Çözüm notu (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        {ticket.roomBlockId && <p className="mt-2 text-sm text-ink-muted">Bilet çözülünce odanın arıza kaydı kaldırılır.</p>}
      </Modal>

      <ConfirmDialog
        open={cancelling}
        title="Bilet iptal edilsin mi?"
        message={<Textarea label="İptal sebebi" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />}
        confirmLabel="İptal et"
        confirmIcon="close"
        onConfirm={() => actions.cancel.mutate({ reason: reason.trim() }, { onSuccess: () => { toastSuccess('İptal edildi'); setCancelling(false); setReason(''); } })}
        onClose={() => setCancelling(false)}
        isPending={actions.cancel.isPending}
      />
    </div>
  );
}
