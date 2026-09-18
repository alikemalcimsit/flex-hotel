import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PERMISSIONS,
  RESERVATION_SOURCE_LABELS,
  RESERVATION_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { useCan } from '../../lib/permissions.js';
import { ReservationFormModal } from './ReservationFormModal.jsx';
import { statusTone } from './reservationStatus.js';
import { useReservationActions, useReservationDetail } from './useReservations.js';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Rezervasyon detayı: bilgiler, durum geçmişi ve işlemler (düzenle, iptal,
 * gelmedi). Oda atama Oda planından yapılır (link).
 *
 * @param {{ id: string, onClose: () => void }} props
 */
export function ReservationDetailDialog({ id, onClose }) {
  const query = useReservationDetail(id);
  const actions = useReservationActions();
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(null); // 'cancel' | 'noShow' | null

  const reservation = query.data;
  const isOpenStatus = reservation && ['PENDING', 'CONFIRMED'].includes(reservation.status);

  if (editing && reservation) {
    return <ReservationFormModal reservation={reservation} onClose={() => setEditing(false)} />;
  }

  return (
    <Modal
      open
      size="lg"
      title={reservation ? `Rezervasyon · ${reservation.confirmationCode}` : 'Rezervasyon'}
      onClose={onClose}
      footer={
        canManage && reservation ? (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex gap-2">
              {isOpenStatus && (
                <Button variant="dangerSoft" size="sm" icon="close" onClick={() => setConfirming('cancel')}>
                  İptal et
                </Button>
              )}
              {isOpenStatus && (
                <Button variant="outline" size="sm" onClick={() => setConfirming('noShow')}>
                  Gelmedi
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {isOpenStatus && (
                <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(true)}>
                  Düzenle
                </Button>
              )}
              <Button size="sm" onClick={onClose}>
                Kapat
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={onClose}>Kapat</Button>
        )
      }
    >
      {query.isPending && <Spinner label="Yükleniyor…" className="py-10" />}
      {query.error && <Alert tone="danger">Rezervasyon yüklenemedi: {query.error.message}</Alert>}

      {reservation && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Badge tone={statusTone(reservation.status)}>{RESERVATION_STATUS_LABELS[reservation.status]}</Badge>
            <span className="text-sm text-ink-muted">{RESERVATION_SOURCE_LABELS[reservation.source] ?? reservation.source}</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Misafir">{reservation.guestName}</Field>
            <Field label="Telefon">{reservation.guestPhone ?? '—'}</Field>
            <Field label="E-posta">{reservation.guestEmail ?? '—'}</Field>
            <Field label="Giriş">{formatDate(reservation.checkIn)}</Field>
            <Field label="Çıkış">{formatDate(reservation.checkOut)}</Field>
            <Field label="Kişi">{`${reservation.adults} yetişkin${reservation.children ? ` + ${reservation.children} çocuk` : ''}`}</Field>
            <Field label="Oda tipi">{reservation.roomTypeName ?? reservation.roomTypeCode}</Field>
            <Field label="Oda">
              {reservation.roomNumber ? (
                reservation.roomNumber
              ) : (
                <Link to="/oda-plani" className="text-sec underline">
                  atanmadı — plandan ata
                </Link>
              )}
            </Field>
            <Field label="Tutar">{formatMoney(reservation.totalPrice, reservation.currency)}</Field>
          </dl>

          {reservation.notes && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Not</dt>
              <dd className="mt-1 whitespace-pre-line text-sm text-ink">{reservation.notes}</dd>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-bold text-ink">Geçmiş</h4>
            <ul className="flex flex-col gap-2">
              {reservation.history.map((entry, index) => (
                <li key={index} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    {entry.action === 'CREATE' ? 'Oluşturuldu' : `Güncellendi${entry.status ? ` → ${RESERVATION_STATUS_LABELS[entry.status] ?? entry.status}` : ''}`}
                    <span className="ml-2 text-xs text-ink-muted">{entry.actor}</span>
                  </span>
                  <span className="text-xs text-ink-muted">{formatDate(entry.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming === 'cancel'}
        title="Rezervasyonu iptal et"
        message="Rezervasyon iptal edilecek ve oda serbest kalacak. Emin misiniz?"
        confirmLabel="İptal et"
        confirmVariant="danger"
        isPending={actions.cancel.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => actions.cancel.mutate({ id }, { onSuccess: () => { setConfirming(null); onClose(); } })}
      />
      <ConfirmDialog
        open={confirming === 'noShow'}
        title="Gelmedi olarak işaretle"
        message="Misafir gelmedi olarak işaretlenecek. Emin misiniz?"
        confirmLabel="Gelmedi"
        confirmVariant="danger"
        isPending={actions.noShow.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => actions.noShow.mutate(id, { onSuccess: () => { setConfirming(null); onClose(); } })}
      />
    </Modal>
  );
}
