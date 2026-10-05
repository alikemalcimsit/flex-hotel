import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  LOST_ITEM_DISPOSALS,
  LOST_ITEM_MAX_RETENTION_DAYS,
  LOST_ITEM_MIN_RETENTION_DAYS,
  LOST_ITEM_SHIPPING_PAYERS,
  lostItemDisposeSchema,
  lostItemReturnError,
  lostItemReturnSchema,
  lostItemSettingsSchema,
  lostItemUnmatchSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, EmptyState, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { disposalLabel, lostItemKeys, shippingPayerLabel } from '../../lib/lost-items.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const SEARCH_DEBOUNCE_MS = 300;
const OWNER_SEARCH_MIN = 2;

/** Bayat kayıt hatası tek cümleyle; diğerleri sunucunun mesajı. */
const errorText = (error) => (error?.code === 'STALE_WRITE' ? 'Eşya bu arada değişti; pencereyi kapatıp yeniden deneyin.' : error?.message);

/**
 * Ayrılış ile bulunma arası, insan diliyle.
 * @param {string | null} leftAt
 * @param {string} foundAt
 */
function departedText(leftAt, foundAt) {
  if (!leftAt) return 'Odadan ayrıldı';
  const hours = Math.round((new Date(foundAt).getTime() - new Date(leftAt).getTime()) / 3_600_000);
  if (hours < 1) return 'Bulunmadan hemen önce ayrıldı';
  if (hours < 48) return `Bulunmadan ${hours} saat önce ayrıldı`;
  return `Bulunmadan ${Math.round(hours / 24)} gün önce ayrıldı`;
}

/* ─────────────── Eşleştirme ─────────────── */

/**
 * Sahibini bul: odadaki / odadan son günlerde ayrılan konaklamalar (refakatçiler
 * dahil) ya da misafir araması (ad, telefon, e-posta).
 * @param {{ item: any, onClose: () => void, onDone: () => void }} props
 */
export function MatchDialog({ item, onClose, onDone }) {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const candidates = useQuery({
    queryKey: lostItemKeys.candidates(item.id),
    queryFn: () => api(`/lost-items/${item.id}/candidates`),
    enabled: Boolean(item.roomId),
  });
  const owners = useQuery({
    queryKey: lostItemKeys.owners(search),
    queryFn: () => api(withQuery('/lost-items/owners', { q: search })),
    enabled: search.length >= OWNER_SEARCH_MIN,
  });

  const match = useMutation({
    mutationFn: ({ guestId, reservationId }) => apiPost(`/lost-items/${item.id}/match`, { expectedUpdatedAt: item.updatedAt, guestId, reservationId: reservationId ?? null }),
    onSuccess: (updated) => {
      toastSuccess(`${updated.reference} ${updated.guest.name} ile eşleşti; misafire haber verip notunu yazın`);
      onDone();
      onClose();
    },
    onError: () => onDone(),
  });

  return (
    <Modal open size="lg" title={`${item.reference} · sahibini bul`} onClose={onClose}>
      <div className="flex flex-col gap-5">
        {match.error && <Alert tone="danger" title="Eşleştirilemedi">{errorText(match.error)}</Alert>}

        {item.roomId && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Oda {item.roomNumber}: o sırada kalan ve yeni ayrılanlar</h3>
            {candidates.isPending ? (
              <Spinner className="py-4" />
            ) : candidates.isError ? (
              <Alert tone="danger" title="Adaylar yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => candidates.refetch()}>Tekrar dene</Button>}>
                {candidates.error.message}
              </Alert>
            ) : candidates.data.candidates.length === 0 ? (
              <EmptyState icon="users" title="Aday yok" description={`Odada son ${candidates.data.lookbackDays} günde konaklama bulunamadı; misafiri adıyla arayın.`} />
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-item border border-line">
                {candidates.data.candidates.map((candidate) => (
                  <li key={candidate.reservationId} className="flex flex-col gap-2 px-3 py-2.5 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-muted">{candidate.confirmationCode}</span>
                      <span>{formatDate(candidate.checkIn)} – {formatDate(candidate.checkOut)}</span>
                      {candidate.relation === 'IN_ROOM' ? (
                        <Badge tone="success">Eşya bulunduğunda odadaydı</Badge>
                      ) : (
                        <Badge tone="info">{departedText(candidate.leftAt, candidates.data.foundAt)}</Badge>
                      )}
                      {candidate.currentRoomNumber && candidate.currentRoomNumber !== item.roomNumber && candidate.status === 'CHECKED_IN' && (
                        <Badge tone="neutral">Şimdi oda {candidate.currentRoomNumber}</Badge>
                      )}
                    </span>
                    <ul className="flex flex-col gap-1.5">
                      {candidate.guests.map((guest) => (
                        <li key={guest.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            <span className="font-semibold">{guest.name}</span>
                            {!guest.isPrimary && <span className="ml-1 text-xs text-ink-muted">(refakatçi)</span>}
                            <span className="ml-2 text-xs text-ink-muted">{[guest.phone, guest.email].filter(Boolean).join(' · ') || 'iletişim bilgisi yok'}</span>
                          </span>
                          <Button size="sm" icon="check" disabled={match.isPending} onClick={() => match.mutate({ guestId: guest.id, reservationId: candidate.reservationId })}>
                            Sahibi bu
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{item.roomId ? 'Başka bir misafir' : 'Misafiri ara'}</h3>
          <Input label="Ad, telefon ya da e-posta" placeholder="En az 2 karakter" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {search.length >= OWNER_SEARCH_MIN &&
            (owners.isPending ? (
              <Spinner className="py-3" />
            ) : owners.isError ? (
              <Alert tone="danger" title="Arama yapılamadı">{owners.error.message}</Alert>
            ) : owners.data.length === 0 ? (
              <p className="text-sm text-ink-muted">Aramaya uyan misafir yok.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-item border border-line">
                {owners.data.map((guest) => (
                  <li key={guest.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold">{guest.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {[guest.phone, guest.email].filter(Boolean).join(' · ')}
                        {guest.lastStay ? ` · son konaklama ${formatDate(guest.lastStay.checkIn)}` : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" icon="check" disabled={match.isPending} onClick={() => match.mutate({ guestId: guest.id })}>
                      Sahibi bu
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </Modal>
  );
}

/* ─────────────── Basit gerekçeli işlemler ─────────────── */

/**
 * Yanlış eşleşmeyi kaldır.
 * @param {{ item: any, onClose: () => void, onDone: () => void }} props
 */
export function UnmatchDialog({ item, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/lost-items/${item.id}/unmatch`, body),
    onSuccess: () => {
      toastSuccess('Eşleşme kaldırıldı');
      onDone();
      onClose();
    },
    onError: () => onDone(),
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(lostItemUnmatchSchema, { expectedUpdatedAt: item.updatedAt, reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }
  return (
    <Modal
      open
      size="sm"
      title={`${item.reference} · eşleşmeyi kaldır`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="unmatch-form" variant="danger" disabled={mutation.isPending}>Eşleşmeyi kaldır</Button>
        </>
      }
    >
      <form id="unmatch-form" className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {mutation.error && <Alert tone="danger" title="Kaldırılamadı">{errorText(mutation.error)}</Alert>}
        <p className="text-sm text-ink-soft">{item.guest?.name} ile eşleşme kalkar; eşya yeniden "depoda" olur. Gerekçe iletişim notlarına da yazılır.</p>
        <Textarea label="Gerekçe" rows={2} placeholder="Ör. misafir kendisinin olmadığını söyledi" value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} />
      </form>
    </Modal>
  );
}

/* ─────────────── Teslim ─────────────── */

const METHOD_OPTIONS = Object.freeze([
  { value: 'IN_PERSON', label: 'Elden teslim' },
  { value: 'SHIPPED', label: 'Kargo' },
]);
const PAYER_OPTIONS = LOST_ITEM_SHIPPING_PAYERS.map((value) => ({ value, label: shippingPayerLabel(value) }));

/**
 * Teslim: elden (değerli eşyada kimlik görülmeli) ya da kargo.
 * @param {{ item: any, onClose: () => void, onDone: () => void }} props
 */
export function ReturnDialog({ item, onClose, onDone }) {
  const [values, setValues] = useState({
    method: 'IN_PERSON',
    receiverName: item.guest?.name ?? '',
    receiverIdChecked: false,
    carrier: '',
    trackingNumber: '',
    shippingAddress: '',
    shippingCost: '',
    shippingPayer: 'GUEST',
    note: '',
  });
  const [errors, setErrors] = useState({});
  const set = (field) => (value) => setValues((current) => ({ ...current, [field]: value }));

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/lost-items/${item.id}/return`, body),
    onSuccess: (updated) => {
      toastSuccess(values.method === 'SHIPPED' ? `${updated.reference} kargoya verildi` : `${updated.reference} teslim edildi`);
      onDone();
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      onDone();
    },
  });

  function submit(event) {
    event.preventDefault();
    const shipped = values.method === 'SHIPPED';
    const body = {
      expectedUpdatedAt: item.updatedAt,
      method: values.method,
      receiverName: values.receiverName,
      receiverIdChecked: !shipped && values.receiverIdChecked,
      note: values.note,
      ...(shipped
        ? { carrier: values.carrier, trackingNumber: values.trackingNumber, shippingAddress: values.shippingAddress, shippingCost: values.shippingCost, shippingPayer: values.shippingPayer }
        : {}),
    };
    const checked = validateWith(lostItemReturnSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    const blocked = lostItemReturnError(item, checked.data);
    if (blocked) return setErrors({ receiverIdChecked: blocked });
    setErrors({});
    mutation.mutate(checked.data);
  }

  const shipped = values.method === 'SHIPPED';
  return (
    <Modal
      open
      size="md"
      title={`${item.reference} · teslim`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="return-form" icon={shipped ? 'truck' : 'checkCheck'} disabled={mutation.isPending}>
            {shipped ? 'Kargoya verildi' : 'Teslim edildi'}
          </Button>
        </>
      }
    >
      <form id="return-form" className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {mutation.error && !mutation.error.fields && <Alert tone="danger" title="Kaydedilemedi">{errorText(mutation.error)}</Alert>}
        {!item.guest && <Alert tone="info" title="Eşya bir misafirle eşleşmemiş">Teslim alan kişinin adı kayda geçer.</Alert>}
        <ChoiceChips label="Teslim şekli" required options={METHOD_OPTIONS} value={values.method} onChange={set('method')} />
        {shipped ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Kargo firması" value={values.carrier} onChange={(event) => set('carrier')(event.target.value)} error={errors.carrier} />
              <Input label="Takip no" value={values.trackingNumber} onChange={(event) => set('trackingNumber')(event.target.value)} error={errors.trackingNumber} />
            </div>
            <Input label="Alıcı" placeholder="Boşsa eşleşen misafir" value={values.receiverName} onChange={(event) => set('receiverName')(event.target.value)} error={errors.receiverName} />
            <Textarea label="Gönderim adresi" rows={3} value={values.shippingAddress} onChange={(event) => set('shippingAddress')(event.target.value)} error={errors.shippingAddress} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Kargo ücreti" value={values.shippingPayer} onChange={(event) => set('shippingPayer')(event.target.value)} options={PAYER_OPTIONS} error={errors.shippingPayer} />
              <Input label="Tutar (isteğe bağlı)" inputMode="decimal" placeholder="Ör. 120,50" value={values.shippingCost} onChange={(event) => set('shippingCost')(event.target.value)} error={errors.shippingCost} />
            </div>
          </>
        ) : (
          <>
            <Input label="Teslim alan" value={values.receiverName} onChange={(event) => set('receiverName')(event.target.value)} error={errors.receiverName} />
            <div>
              <Checkbox
                label="Teslim alanın kimliğini gördüm"
                hint={item.valuable ? 'Değerli eşya: kimlik görülmeden verilmez.' : 'Önerilir: eşyayı tarif eden kişi gerçekten sahibi mi?'}
                checked={values.receiverIdChecked}
                onChange={(event) => set('receiverIdChecked')(event.target.checked)}
              />
              {errors.receiverIdChecked && <p className="mt-1 text-xs font-semibold text-danger-ink">{errors.receiverIdChecked}</p>}
            </div>
          </>
        )}
        <Textarea label="Not (isteğe bağlı)" rows={2} value={values.note} onChange={(event) => set('note')(event.target.value)} error={errors.note} />
      </form>
    </Modal>
  );
}

/* ─────────────── Kapatma ─────────────── */

const DISPOSAL_OPTIONS = LOST_ITEM_DISPOSALS.map((value) => ({ value, label: disposalLabel(value) }));

/**
 * Sahibi çıkmayan eşyayı kapat (bağış, imha, polis) ya da hatalı kaydı kapat.
 * @param {{ item: any, onClose: () => void, onDone: () => void }} props
 */
export function DisposeDialog({ item, onClose, onDone }) {
  const [method, setMethod] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/lost-items/${item.id}/dispose`, body),
    onSuccess: (updated) => {
      toastSuccess(`${updated.reference} kapatıldı: ${disposalLabel(updated.disposal.method).toLocaleLowerCase('tr')}`);
      onDone();
      onClose();
    },
    onError: () => onDone(),
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(lostItemDisposeSchema, { expectedUpdatedAt: item.updatedAt, method, reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }
  const early = !item.expired && method && method !== 'RECORD_ERROR';
  return (
    <Modal
      open
      size="sm"
      title={`${item.reference} · kapat`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="dispose-form" variant="danger" disabled={mutation.isPending}>Kapat</Button>
        </>
      }
    >
      <form id="dispose-form" className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {mutation.error && <Alert tone="danger" title="Kapatılamadı">{errorText(mutation.error)}</Alert>}
        <Select label="Ne yapıldı" value={method} onChange={(event) => setMethod(event.target.value)} options={[{ value: '', label: 'Seçin', disabled: true }, ...DISPOSAL_OPTIONS]} error={errors.method} />
        {early && (
          <Alert tone="warning" title="Saklama süresi dolmadı">
            Son gün {formatDate(item.retainUntil)}. Sahibi hâlâ arayabilir; erken kapatmanın gerekçesini yazın.
          </Alert>
        )}
        <Textarea label="Gerekçe" rows={2} placeholder="Ör. süre doldu, Kızılay'a bağışlandı (tutanak no 12)" value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} />
        <p className="text-xs text-ink-muted">Kapatılan kayıt değiştirilemez; fotoğrafları bir ay sonra silinir.</p>
      </form>
    </Modal>
  );
}

/* ─────────────── Saklama süreleri ─────────────── */

/**
 * @param {{ onClose: () => void, onDone: () => void }} props
 */
export function RetentionDialog({ onClose, onDone }) {
  const current = useQuery({ queryKey: lostItemKeys.settings(), queryFn: () => api('/lost-items/settings') });
  return (
    <Modal open size="sm" title="Saklama süreleri" onClose={onClose}>
      {current.isPending ? (
        <Spinner className="py-6" />
      ) : current.isError ? (
        <Alert tone="danger" title="Ayarlar yüklenemedi">{current.error.message}</Alert>
      ) : (
        <RetentionForm initial={current.data} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  );
}

/** @param {{ initial: { retentionDays: number, valuableRetentionDays: number, updatedAt: string }, onClose: () => void, onDone: () => void }} props */
function RetentionForm({ initial, onClose, onDone }) {
  const [values, setValues] = useState({ retentionDays: String(initial.retentionDays), valuableRetentionDays: String(initial.valuableRetentionDays) });
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPut('/lost-items/settings', body),
    onSuccess: () => {
      toastSuccess('Saklama süreleri kaydedildi; bütün açık eşyalara uygulandı');
      onDone();
      onClose();
    },
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(lostItemSettingsSchema, { ...values, expectedUpdatedAt: initial.updatedAt });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      {mutation.error && (
        <Alert tone="danger" title="Kaydedilemedi">
          {mutation.error.code === 'STALE_WRITE' ? 'Süreler bu arada başkası tarafından değiştirildi; pencereyi kapatıp yeniden açın.' : mutation.error.message}
        </Alert>
      )}
      <p className="text-sm text-ink-soft">
        Sahibi çıkmayan eşya bu süre dolunca "süresi dolan" listesine düşer; yönetici gerekçeyle kapatır. Süreler {LOST_ITEM_MIN_RETENTION_DAYS}–{LOST_ITEM_MAX_RETENTION_DAYS} gün.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Normal eşya (gün)" inputMode="numeric" value={values.retentionDays} onChange={(event) => setValues({ ...values, retentionDays: event.target.value })} error={errors.retentionDays} />
        <Input label="Değerli eşya (gün)" inputMode="numeric" value={values.valuableRetentionDays} onChange={(event) => setValues({ ...values, valuableRetentionDays: event.target.value })} error={errors.valuableRetentionDays} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button type="submit" icon="check" disabled={mutation.isPending}>Kaydet</Button>
      </div>
    </form>
  );
}

