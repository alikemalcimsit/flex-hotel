import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GUEST_PORTAL_LANGUAGE_LABELS,
  ID_DOCUMENT_TYPE_LABELS,
  ONLINE_CHECKIN_PAYMENT_PREFERENCE_LABELS,
  ONLINE_CHECKIN_STATUS_LABELS,
  ONLINE_CHECKIN_STATUS_TONES,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { COUNTRY_OPTIONS } from '../../lib/front-desk.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { documentPath, guestPortalKeys, personLabel, signaturePath } from '../../lib/guestPortal.js';
import { useProtectedImage } from '../../lib/lost-items.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { CheckInDialog } from '../front-desk/CheckInDialog.jsx';

const countryName = (code) => COUNTRY_OPTIONS.find((option) => option.value === code)?.label ?? code ?? '—';

/**
 * Online check-in'in incelenmesi (modül 53): kişiler ve belge fotoğrafları, imza, onaylar. Resepsiyon belgeyi
 * görüp onaylar ya da misafire gidecek sebeple düzeltme ister; giriş günü geldiyse giriş penceresi buradan açılır
 * (bilgiler dolu). Belgeler otelin saklama süresi sonunda silinir.
 *
 * @param {{ onlineCheckinId: string, onClose: () => void }} props
 */
export function OnlineCheckinDialog({ onlineCheckinId, onClose }) {
  const queryClient = useQueryClient();
  const can = useCan();
  const { today } = useHotelToday();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [zoom, setZoom] = useState(null);
  const query = useQuery({ queryKey: guestPortalKeys.detail(onlineCheckinId), queryFn: () => api(`/guest-portal/online-checkins/${onlineCheckinId}`) });
  const detail = query.data;
  const decide = useMutation({
    mutationFn: ({ action, body }) => apiPost(`/guest-portal/online-checkins/${onlineCheckinId}/${action}`, body),
    onSuccess: (data, { action }) => {
      queryClient.setQueryData(guestPortalKeys.detail(onlineCheckinId), data);
      queryClient.invalidateQueries({ queryKey: guestPortalKeys.all });
      toastSuccess(action === 'approve' ? 'Online check-in onaylandı' : 'Düzeltme isteği misafirin portalına iletildi');
      setRejecting(false);
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: guestPortalKeys.detail(onlineCheckinId) });
    },
  });

  if (query.isPending) {
    return (
      <Modal open size="lg" title="Online check-in" onClose={onClose}>
        <Spinner label="Yükleniyor…" className="py-10" />
      </Modal>
    );
  }
  if (query.isError) {
    return (
      <Modal open size="md" title="Online check-in" onClose={onClose} footer={<Button type="button" variant="outline" onClick={onClose}>Kapat</Button>}>
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      </Modal>
    );
  }

  const canManage = can(PERMISSIONS.GUEST_PORTAL_MANAGE);
  const open = !['COMPLETED'].includes(detail.status) && ['PENDING', 'CONFIRMED'].includes(detail.reservationStatus);
  const arrivalDue = today && detail.checkIn <= today;
  const people = [{ ...detail.guest, isChild: false }, ...detail.companions];
  const submitReject = () => {
    if (reason.trim().length < 3) {
      setReasonError('Misafire gidecek sebebi yazın');
      return;
    }
    decide.mutate({ action: 'reject', body: { expectedUpdatedAt: detail.updatedAt, reason: reason.trim() } });
  };

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={onClose} disabled={decide.isPending}>
        Kapat
      </Button>
      {canManage && open && !rejecting && detail.status !== 'REJECTED' && (
        <Button type="button" variant="outline" icon="pencil" onClick={() => setRejecting(true)} disabled={decide.isPending}>
          Düzeltme iste
        </Button>
      )}
      {canManage && open && detail.status !== 'APPROVED' && !rejecting && (
        <Button type="button" icon="check" onClick={() => decide.mutate({ action: 'approve', body: { expectedUpdatedAt: detail.updatedAt } })} disabled={decide.isPending || Boolean(detail.documentsPurgedAt)}>
          {decide.isPending ? 'Kaydediliyor…' : 'Onayla'}
        </Button>
      )}
      {open && arrivalDue && can(PERMISSIONS.STAYS_MANAGE) && !rejecting && (
        <Button type="button" icon="key" onClick={() => setCheckingIn(true)} disabled={decide.isPending}>
          Girişi yap
        </Button>
      )}
    </>
  );

  return (
    <>
      <Modal open size="lg" title={`Online check-in — ${detail.guestName}`} onClose={decide.isPending ? () => {} : onClose} footer={footer}>
        <div className="flex flex-col gap-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ONLINE_CHECKIN_STATUS_TONES[detail.status]}>{ONLINE_CHECKIN_STATUS_LABELS[detail.status]}</Badge>
            <span className="font-mono text-xs text-ink-muted">{detail.confirmationCode}</span>
            <span className="text-ink-soft">
              {formatDate(detail.checkIn)} – {formatDate(detail.checkOut)} · {detail.roomTypeName ?? '—'}
              {detail.roomNumber ? ` · oda ${detail.roomNumber}` : ''}
            </span>
          </div>
          {detail.status === 'REJECTED' && (
            <Alert tone="warning" title="Düzeltme istendi">
              {detail.rejectReason} — misafir portalında görüyor; yeniden gönderince burada "İnceleme bekliyor" olur.
            </Alert>
          )}
          {detail.documentsPurgedAt && <Alert tone="info">Belge fotoğrafları saklama süresi dolduğu için {formatDateTime(detail.documentsPurgedAt)} tarihinde silindi (KVKK).</Alert>}
          {detail.status === 'SUBMITTED' && detail.submitCount > 1 && <Alert tone="info">Misafir {detail.submitCount}. kez gönderdi (düzeltme ya da onaydan sonra değişiklik).</Alert>}

          {people.map((person, index) => (
            <PersonCard key={index} person={person} index={index} detail={detail} onZoom={setZoom} />
          ))}

          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Row label="Tahmini varış">{detail.arrivalTime ?? '—'}</Row>
            <Row label="Araç plakası">{detail.vehiclePlate ?? '—'}</Row>
            <Row label="Ödeme / teminat tercihi">{ONLINE_CHECKIN_PAYMENT_PREFERENCE_LABELS[detail.paymentPreference] ?? detail.paymentPreference}</Row>
            <Row label="Portal dili">{GUEST_PORTAL_LANGUAGE_LABELS[detail.language] ?? detail.language}</Row>
            <Row label="Gönderim">{formatDateTime(detail.submittedAt)}</Row>
            <Row label="İnceleme">{detail.reviewedAt ? `${formatDateTime(detail.reviewedAt)} · ${detail.reviewedBy}` : '—'}</Row>
            <Row label="Onaylar">
              Aydınlatma, kurallar ve belge fotoğrafı rızası {formatDateTime(detail.consents.privacyAt)}; ticari ileti {detail.consents.marketing ? 'istiyor' : 'istemiyor'}
            </Row>
            {detail.note && <Row label="Misafirin notu">{detail.note}</Row>}
          </dl>

          <Signature onlineCheckinId={detail.id} />

          {rejecting && (
            <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface-muted p-4">
              <Textarea
                label={`Misafire gidecek sebep — misafirin dili: ${GUEST_PORTAL_LANGUAGE_LABELS[detail.language] ?? detail.language}${detail.language !== 'tr' ? ' (o dilde ya da İngilizce yazın)' : ''}`}
                name="reason"
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
                error={reasonError}
                maxLength={500}
                placeholder="Ör. Pasaport fotoğrafı okunmuyor; ışıklı bir yerde yeniden çekin."
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setRejecting(false)} disabled={decide.isPending}>
                  Vazgeç
                </Button>
                <Button type="button" size="sm" icon="send" onClick={submitReject} disabled={decide.isPending}>
                  {decide.isPending ? 'Gönderiliyor…' : 'Düzeltme iste'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
      {zoom && <Zoom onlineCheckinId={detail.id} documentId={zoom} onClose={() => setZoom(null)} />}
      {checkingIn && <CheckInDialog reservationId={detail.reservationId} onClose={() => setCheckingIn(false)} onDone={() => { setCheckingIn(false); onClose(); }} />}
    </>
  );
}

/** @param {{ label: string, children: any }} props */
function Row({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** Kişinin kimliği ve belge fotoğrafları. */
function PersonCard({ person, index, detail, onZoom }) {
  const photos = detail.documents.filter((doc) => doc.person === index);
  return (
    <section className="rounded-panel border border-line p-4">
      <h3 className="mb-2 font-bold text-ink">
        {personLabel(index, detail)} <span className="font-normal text-ink-muted">{index === 0 ? '· rezervasyon sahibi' : person.isChild ? '· çocuk' : '· refakatçi'}</span>
      </h3>
      {person.idType ? (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-4">
          <Row label="Belge">{ID_DOCUMENT_TYPE_LABELS[person.idType] ?? person.idType}</Row>
          <Row label="Numara">
            <span className="font-mono">{person.idNumber ?? 'Silindi (KVKK)'}</span>
          </Row>
          <Row label="Uyruk">{countryName(person.nationality)}</Row>
          <Row label="Doğum tarihi">{person.birthDate ? formatDate(person.birthDate) : '—'}</Row>
        </dl>
      ) : (
        <p className="text-ink-muted">Belge bilgisi yok (çocuk).</p>
      )}
      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((doc) => (
            <Thumb key={doc.id} onlineCheckinId={detail.id} doc={doc} onZoom={onZoom} />
          ))}
        </div>
      )}
    </section>
  );
}

function Thumb({ onlineCheckinId, doc, onZoom }) {
  const image = useProtectedImage(doc.purged ? null : documentPath(onlineCheckinId, doc.id, 'thumb'));
  if (doc.purged) return <span className="rounded-item border border-dashed border-line px-3 py-6 text-xs text-ink-muted">Silindi</span>;
  return (
    <button type="button" onClick={() => onZoom(doc.id)} className="overflow-hidden rounded-item border border-line hover:border-line-strong" aria-label="Belge fotoğrafını büyüt">
      {image.url ? <img src={image.url} alt="Belge fotoğrafı" className="h-28 w-40 object-cover" /> : <span className="grid h-28 w-40 place-items-center text-xs text-ink-muted">{image.isError ? 'Açılamadı' : 'Yükleniyor…'}</span>}
    </button>
  );
}

function Zoom({ onlineCheckinId, documentId, onClose }) {
  const image = useProtectedImage(documentPath(onlineCheckinId, documentId, 'full'));
  return (
    <Modal open size="lg" title="Belge fotoğrafı" onClose={onClose} footer={<Button type="button" variant="outline" onClick={onClose}>Kapat</Button>}>
      {image.url ? <img src={image.url} alt="Belge fotoğrafı" className="mx-auto max-h-[70vh] w-auto" /> : <Spinner label={image.isError ? 'Açılamadı' : 'Yükleniyor…'} className="py-10" />}
    </Modal>
  );
}

function Signature({ onlineCheckinId }) {
  const image = useProtectedImage(signaturePath(onlineCheckinId));
  return (
    <div>
      <p className="mb-1 text-xs text-ink-muted">İmza</p>
      <div className="inline-block rounded-item border border-line bg-white p-2">
        {image.url ? <img src={image.url} alt="Misafirin imzası" className="h-24 w-auto" /> : <span className="text-xs text-ink-muted">{image.isError ? 'İmza açılamadı' : 'Yükleniyor…'}</span>}
      </div>
    </div>
  );
}
