import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FOLIO_DISCOUNT_CATEGORIES,
  FOLIO_POSTABLE_TYPES,
  FOLIO_REASON_MAX,
  TAX_APPLIES_TO_LABELS,
  FOLIO_PAYER_NAME_MAX,
  chargePreviewSchema,
  postChargeSchema,
  reopenFolioSchema,
  updateFolioSchema,
  voidRequestSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { folioKeys, itemTypeLabel } from '../../lib/folios.js';
import { formatMoney, formatPercent } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const PREVIEW_DEBOUNCE_MS = 350;

/** Tipe göre hazır açıklamalar (tek dokunuş). */
const QUICK_DESCRIPTIONS = Object.freeze({
  FNB: ['Restoran', 'Oda servisi', 'Bar'],
  MINIBAR: ['Minibar'],
  LAUNDRY: ['Çamaşır yıkama', 'Ütü'],
  SPA: ['Masaj', 'Hamam'],
  OTHER: ['Otopark', 'Havalimanı transferi', 'Ekstra yatak'],
  DISCOUNT: ['Şikâyet indirimi', 'Sadakat indirimi', 'Yönetim ikramı'],
});

/**
 * Harcama / indirim işle.
 *
 * Tutar birim fiyattır (vergi ayarında dahilse içinde); sunucu vergiyi otelin
 * vergi ayarından hesaplar ve formda canlı gösterir — tarayıcı tutar
 * hesaplamaz. İndirim pozitif yazılır, eksi satır olarak işlenir; hangi
 * gelirden yapıldığı seçilir (o gelirin vergisini düşürür). Form açılırken
 * üretilen istek kimliği çift gönderimde ikinci kalemi engeller.
 *
 * @param {{ folio: { id: string, name: string, currency: string }, canDiscount: boolean, onClose: () => void, onDone: () => void }} props
 */
export function PostChargeDialog({ folio, canDiscount, onClose, onDone }) {
  const [requestId] = useState(newRequestId);
  const [type, setType] = useState('FNB');
  const [discountCategory, setDiscountCategory] = useState('ROOM');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const types = FOLIO_POSTABLE_TYPES.filter((value) => value !== 'DISCOUNT' || canDiscount);
  const discount = type === 'DISCOUNT';
  const previewInput = useMemo(
    () => ({ type, discountCategory: discount ? discountCategory : null, amount, quantity: Number(quantity) }),
    [type, discount, discountCategory, amount, quantity],
  );
  const [debounced, setDebounced] = useState(previewInput);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(previewInput), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [previewInput]);
  const previewValid = chargePreviewSchema.safeParse(debounced).success;
  const preview = useQuery({
    queryKey: folioKeys.preview(debounced),
    queryFn: () => apiPost('/folios/charges/preview', debounced),
    enabled: previewValid,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/charges`, body),
    onSuccess: (result) => {
      toastSuccess(result.created ? `${result.item.description} işlendi` : 'Bu harcama zaten işlenmişti; ikinci kez yazılmadı');
      onDone();
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      requestId,
      type,
      discountCategory: discount ? discountCategory : null,
      description,
      amount,
      quantity: Number(quantity),
    };
    const result = validateWith(postChargeSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  return (
    <Modal
      open
      size="md"
      title={`Harcama ekle — ${folio.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="post-charge-form" icon="plus" disabled={busy}>
            {busy ? 'İşleniyor…' : discount ? 'İndirimi işle' : 'Harcamayı işle'}
          </Button>
        </>
      }
    >
      <form id="post-charge-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {serverError && <Alert tone="danger" title="İşlenmedi">{serverError.message}</Alert>}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Harcama tipi">
          {types.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              disabled={busy}
              onClick={() => {
                setType(value);
                setDescription('');
              }}
              className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                type === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
              }`}
            >
              {itemTypeLabel(value)}
            </button>
          ))}
        </div>
        {discount && (
          <Select
            label="Hangi gelirden indirim"
            value={discountCategory}
            onChange={(event) => setDiscountCategory(event.target.value)}
            options={FOLIO_DISCOUNT_CATEGORIES.map((value) => ({ value, label: TAX_APPLIES_TO_LABELS[value] }))}
            error={errors.discountCategory}
            disabled={busy}
          />
        )}
        <ChoiceChips label="Hazır açıklamalar" options={QUICK_DESCRIPTIONS[type].map((value) => ({ value, label: value }))} value={description} onChange={setDescription} disabled={busy} />
        <Input label="Açıklama" value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} error={errors.description} disabled={busy} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={discount ? 'İndirim tutarı' : 'Birim fiyat'}
            inputMode="decimal"
            placeholder="ör. 250 ya da 250,50"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={errors.amount}
            disabled={busy}
          />
          <Input label="Adet" type="number" min={1} max={999} value={quantity} onChange={(event) => setQuantity(event.target.value)} error={errors.quantity} disabled={busy} />
        </div>
        <ChargePreview query={preview} enabled={previewValid} currency={folio.currency} />
      </form>
    </Modal>
  );
}

/**
 * Sunucunun hesabı: net, vergi dökümü (dahil / eklenen), toplam.
 * @param {{ query: any, enabled: boolean, currency: string }} props
 */
function ChargePreview({ query, enabled, currency }) {
  if (!enabled) {
    return <p className="rounded-item bg-surface-muted px-4 py-3 text-xs text-ink-muted">Tutarı girince vergi dökümü ve folyoya yazılacak toplam burada görünür.</p>;
  }
  if (query.isPending) return <Spinner label="Vergi hesaplanıyor…" className="py-2" />;
  if (query.isError) return <p className="text-xs text-sec-strong">Önizleme alınamadı: {query.error.message}</p>;
  const line = query.data;
  return (
    <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted px-4 py-3 text-sm">
      <dt className="text-ink-muted">Net</dt>
      <dd className="text-right tabular-nums">{formatMoney(line.netAmount, currency)}</dd>
      {line.taxLines.map((tax) => (
        <FragmentRow key={`${tax.name}-${tax.rate}-${tax.included}`} label={`${tax.name} ${formatPercent(tax.rate)} ${tax.included ? '(dahil)' : '(eklenir)'}`} value={formatMoney(tax.amount, currency)} />
      ))}
      {line.taxLines.length === 0 && <FragmentRow label="Vergi" value="Bu kalem tipine vergi tanımlı değil" />}
      <dt className="font-bold text-ink">Folyoya yazılacak</dt>
      <dd className="text-right font-bold tabular-nums">{formatMoney(line.total, currency)}</dd>
    </dl>
  );
}

/** @param {{ label: string, value: string }} props */
function FragmentRow({ label, value }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums text-ink-soft">{value}</dd>
    </>
  );
}

const VOID_REASONS = Object.freeze(['Yanlış odaya işlendi', 'Yanlış tutar', 'Misafir itiraz etti', 'İkram']);

/**
 * Kalem iptali isteği: ikinci bir yetkilinin onayına gider (isteyen kendi
 * isteğini onaylayamaz). Onaylanınca eksi tutarlı ters kayıt işlenir.
 *
 * @param {{ folio: { id: string }, item: { id: string, description: string, total: string, quantity: number }, currency: string, onClose: () => void, onDone: () => void }} props
 */
export function VoidItemDialog({ folio, item, currency, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/items/${item.id}/void`, body),
    onSuccess: () => {
      toastSuccess('İptal isteği onaya gönderildi; başka bir yetkili onaylayınca işlenir');
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(voidRequestSchema, { reason });
    if (!result.ok) {
      setError(result.errors.reason ?? 'Gerekçe yazın');
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="sm"
      title="Kalem iptali iste"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="void-item-form" variant="danger" icon="send" disabled={busy}>
            {busy ? 'Gönderiliyor…' : 'Onaya gönder'}
          </Button>
        </>
      }
    >
      <form id="void-item-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert tone="info" title={`${item.description} · ${formatMoney(item.total, currency)}`}>
          Kalem silinmez: onaylanınca eksi tutarlı iptal kaydı işlenir, ikisi de dökümde görünür. Kendi isteğinizi onaylayamazsınız.
        </Alert>
        <ChoiceChips label="Hazır gerekçeler" options={VOID_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label="Gerekçe" rows={3} maxLength={FOLIO_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} error={error} disabled={busy} autoFocus />
      </form>
    </Modal>
  );
}

/**
 * Kapanmış folyoyu yeniden aç (yetkili, gerekçeli): geç gelen harcama, yanlış kapanış.
 * @param {{ folio: { id: string, name: string }, onClose: () => void, onDone: () => void }} props
 */
export function ReopenFolioDialog({ folio, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/reopen`, body),
    onSuccess: () => {
      toastSuccess(`${folio.name} yeniden açıldı`);
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(reopenFolioSchema, { reason });
    if (!result.ok) {
      setError(result.errors.reason ?? 'Gerekçe yazın');
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="sm"
      title={`Yeniden aç — ${folio.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="reopen-folio-form" icon="rotateCcw" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Yeniden aç'}
          </Button>
        </>
      }
    >
      <form id="reopen-folio-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Textarea
          label="Gerekçe"
          rows={3}
          maxLength={FOLIO_REASON_MAX}
          placeholder="ör. Çıkıştan sonra gelen minibar fişi"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error}
          disabled={busy}
          autoFocus
        />
      </form>
    </Modal>
  );
}

/**
 * Ödeyen adı (şirket, acente): folyo sekmesinde ve faturada (modül 16) alıcı varsayılanı.
 * @param {{ folio: { id: string, name: string, payerName: string | null }, onClose: () => void, onDone: () => void }} props
 */
export function EditPayerDialog({ folio, onClose, onDone }) {
  const [payerName, setPayerName] = useState(folio.payerName ?? '');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPatch(`/folios/${folio.id}`, body),
    onSuccess: () => {
      toastSuccess('Ödeyen kaydedildi');
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(updateFolioSchema, { payerName });
    if (!result.ok) {
      setError(result.errors.payerName ?? 'Geçersiz ad');
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="sm"
      title={`Ödeyen — ${folio.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="payer-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="payer-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input
          label="Ödeyen"
          placeholder="Boş bırakılırsa misafir"
          maxLength={FOLIO_PAYER_NAME_MAX}
          value={payerName}
          onChange={(event) => setPayerName(event.target.value)}
          error={error}
          disabled={busy}
          autoFocus
        />
      </form>
    </Modal>
  );
}
