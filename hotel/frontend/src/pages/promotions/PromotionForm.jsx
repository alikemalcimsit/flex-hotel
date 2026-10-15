import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_TYPES,
  MAX_FREE_NIGHTS_CYCLE,
  MAX_LEAD_DAYS,
  MAX_PROMOTION_NAME_LENGTH,
  MAX_PROMOTION_NOTES_LENGTH,
  MAX_PROMOTION_PERCENT,
  PROMOTION_DISCOUNT_TYPES,
  PROMOTION_DISCOUNT_TYPE_LABELS,
  PROMOTION_SOURCES,
  RESERVATION_SOURCE_LABELS,
  createPromotionSchema,
  updatePromotionSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Input, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { describeRule, formOf, payloadOf } from '../../lib/promotionForm.js';
import { promotionKeys } from '../../lib/promotions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { usePromotionContext } from './usePromotionContext.js';

const STALE_TEXT = 'Promosyon bu arada başkası tarafından değiştirildi; ekran yenilendi, değişikliğinizi kontrol edip tekrar deneyin.';

const TYPE_OPTIONS = PROMOTION_DISCOUNT_TYPES.map((value) => ({ value, label: PROMOTION_DISCOUNT_TYPE_LABELS[value] }));
const APPLY_OPTIONS = Object.freeze([
  { value: 'AUTO', label: 'Kendiliğinden (koşul tutunca)' },
  { value: 'COUPON', label: 'Kuponla (kod girilince)' },
]);

/** @param {{ title: string, hint?: string, children: React.ReactNode }} props */
function Section({ title, hint, children }) {
  return (
    <Card>
      <section aria-label={title} className="flex flex-col gap-4 p-1">
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
        </div>
        {children}
      </section>
    </Card>
  );
}

/**
 * Promosyon formu (modül 31): açma ve düzenleme. Kuralın okunur cümlesi
 * yazarken yan panelde canlı görünür (kaydedilecek kuralın aynısı).
 *
 * Yayındaki promosyon düzenlenebilir: yalnızca sonradan açılan rezervasyonları
 * etkiler (açılmış rezervasyon promosyonu koşullarıyla kopyalamıştır).
 *
 * @param {{ promotion?: any, readOnly?: boolean, onSaved: (promotion: any) => void, onCancel?: () => void }} props
 */
export function PromotionForm({ promotion, readOnly = false, onSaved, onCancel }) {
  const queryClient = useQueryClient();
  const context = usePromotionContext();
  // Formun dayandığı sürüm: canlı tazeleme yeni sürümü getirse de kayıt bu sürümle gider (başkasının
  // değişikliği sessizce ezilmez; sunucu eski sürümü reddeder).
  const [base, setBase] = useState(promotion ?? null);
  const [form, setForm] = useState(() => formOf(promotion));
  const [errors, setErrors] = useState({});
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(base));
  const serverChanged = Boolean(promotion && base && promotion.updatedAt !== base.updatedAt);
  // Değiştirilmemiş form sunucudaki yeni hâle sessizce geçer (ör. yayına alındı).
  useEffect(() => {
    if (serverChanged && !dirty) {
      setBase(promotion);
      setForm(formOf(promotion));
    }
  }, [serverChanged, dirty, promotion]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: (payload) => (promotion ? apiPatch(`/promotions/${promotion.id}`, payload) : apiPost('/promotions', payload)),
    onSuccess: (saved) => {
      // Kendi kaydımız yeni dayanaktır (sonraki canlı tazeleme "başkası değiştirdi" sanmasın).
      setBase(saved);
      setForm(formOf(saved));
      toastSuccess(promotion ? 'Promosyon güncellendi' : 'Promosyon taslak olarak açıldı; kontrol edip yayına alın');
      queryClient.invalidateQueries({ queryKey: promotionKeys.all });
      onSaved(saved);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: promotionKeys.all });
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = payloadOf(form, base?.updatedAt ?? null);
    const checked = validateWith(promotion ? updatePromotionSchema : createPromotionSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError('Formda düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  const busy = save.isPending;
  const disabled = busy || readOnly;
  const rule = describeRule(form, context);
  const freeNights = form.discountType === 'FREE_NIGHTS';
  const roomTypeOptions = context.roomTypes.map((type) => ({ value: type.id, label: type.name }));
  // Silinmiş oda tipi seçili kaldıysa görünsün (kaldırılabilsin).
  for (const id of form.roomTypeIds) if (!roomTypeOptions.some((option) => option.value === id)) roomTypeOptions.push({ value: id, label: 'Silinmiş oda tipi' });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-5">
        {serverChanged && dirty && (
          <Alert
            tone="warning"
            title="Promosyon bu arada değişti"
            action={
              <Button type="button" size="sm" variant="outline" icon="refresh" onClick={() => { setBase(promotion); setForm(formOf(promotion)); setErrors({}); }}>
                Güncel hâli yükle
              </Button>
            }
          >
            Başka biri promosyonu kaydetti. Kaydederseniz sunucu reddeder; güncel hâli yükleyip değişikliğinizi yeniden yapın.
          </Alert>
        )}
        <Section title="Promosyon">
          <Input label="Ad" name="promotion-name" value={form.name} onChange={set('name')} error={errors.name} maxLength={MAX_PROMOTION_NAME_LENGTH} placeholder="Ör. Erken Rezervasyon 2027" disabled={disabled} required />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Uygulama</span>
            <ChoiceChips label="Uygulama" options={APPLY_OPTIONS} value={form.requiresCoupon ? 'COUPON' : 'AUTO'} onChange={(value) => setValue('requiresCoupon', value === 'COUPON')} disabled={disabled} required />
            {errors.requiresCoupon && <p className="text-xs font-semibold text-sec-strong">{errors.requiresCoupon}</p>}
            <p className="text-xs text-ink-muted">
              {form.requiresCoupon
                ? 'Yalnızca kupon kodu girilince uygulanır. Kayıttan sonra "Kuponlar" sekmesinde kod üretin.'
                : 'Koşulu tutan her doğrudan satışa kendiliğinden düşer (kod gerekmez).'}
            </p>
          </div>
          <Textarea label="Not (iç kullanım)" name="promotion-notes" rows={2} maxLength={MAX_PROMOTION_NOTES_LENGTH} value={form.notes} onChange={set('notes')} error={errors.notes} disabled={disabled} />
        </Section>

        <Section title="İndirim" hint="Bir rezervasyona tek indirim düşer: uygun promosyonlar ve kupon arasından misafire en avantajlısı.">
          <ChoiceChips label="İndirim tipi" options={TYPE_OPTIONS} value={form.discountType} onChange={(value) => setValue('discountType', value)} disabled={disabled} required />
          {freeNights ? (
            <div className="flex flex-wrap items-end gap-3">
              <Input label="Kaç gece kalana" name="promotion-stay-nights" type="number" inputMode="numeric" min={2} max={MAX_FREE_NIGHTS_CYCLE} value={form.stayNights} onChange={set('stayNights')} error={errors.stayNights} disabled={disabled} className="w-36" />
              <Input label="Kaç gece ödesin" name="promotion-pay-nights" type="number" inputMode="numeric" min={1} max={MAX_FREE_NIGHTS_CYCLE - 1} value={form.payNights} onChange={set('payNights')} error={errors.payNights} disabled={disabled} className="w-36" />
              <p className="pb-2 text-xs text-ink-muted">Her {form.stayNights || 'X'} gecede en ucuz {form.stayNights && form.payNights ? Number(form.stayNights) - Number(form.payNights) : '(X − Y)'} gece bedava (eşit fiyatta sondaki).</p>
            </div>
          ) : (
            <Input
              label={form.discountType === 'PERCENT' ? 'İndirim (%)' : `İndirim tutarı (${context.currency}, konaklama başına)`}
              name="promotion-discount-value"
              inputMode="decimal"
              value={form.discountValue}
              onChange={set('discountValue')}
              error={errors.discountValue}
              placeholder={form.discountType === 'PERCENT' ? `1–${MAX_PROMOTION_PERCENT}` : 'Ör. 500'}
              disabled={disabled}
              className="w-full sm:w-64"
            />
          )}
          {form.discountType === 'AMOUNT' && <p className="text-xs text-ink-muted">Tutar her oda konaklamasından düşer (grupta her oda ayrı); konaklamanın dönemdeki gecelerine fiyatları oranında bölünür, gecelerin toplamını aşamaz.</p>}
        </Section>

        <Section title="Koşullar" hint="Boş bırakılan koşul sınırsızdır. Tarihlerin iki ucu da dahildir.">
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-ink">Rezervasyon (satış) dönemi</legend>
              <div className="flex flex-wrap gap-2">
                <Input label="Başlangıç" name="promotion-book-from" type="date" value={form.bookFrom} max={form.bookTo || undefined} onChange={set('bookFrom')} error={errors.bookFrom} disabled={disabled} className="w-full sm:w-40" />
                <Input label="Bitiş" name="promotion-book-to" type="date" value={form.bookTo} min={form.bookFrom || undefined} onChange={set('bookTo')} error={errors.bookTo} disabled={disabled} className="w-full sm:w-40" />
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-ink">Konaklama dönemi (indirimli geceler)</legend>
              <div className="flex flex-wrap gap-2">
                <Input label="İlk gece" name="promotion-stay-from" type="date" value={form.stayFrom} max={form.stayTo || undefined} onChange={set('stayFrom')} error={errors.stayFrom} disabled={disabled} className="w-full sm:w-40" />
                <Input label="Son gece" name="promotion-stay-to" type="date" value={form.stayTo} min={form.stayFrom || undefined} onChange={set('stayTo')} error={errors.stayTo} disabled={disabled} className="w-full sm:w-40" />
              </div>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-3">
            <Input label="En az gece" name="promotion-min-nights" type="number" inputMode="numeric" min={1} value={form.minNights} onChange={set('minNights')} error={errors.minNights} disabled={disabled} className="w-32" />
            <Input label="En fazla gece" name="promotion-max-nights" type="number" inputMode="numeric" min={1} value={form.maxNights} onChange={set('maxNights')} error={errors.maxNights} disabled={disabled} className="w-32" />
            <Input label="Erken rezervasyon (girişe en az … gün)" name="promotion-min-lead" type="number" inputMode="numeric" min={0} max={MAX_LEAD_DAYS} value={form.minLeadDays} onChange={set('minLeadDays')} error={errors.minLeadDays} disabled={disabled} className="w-full sm:w-64" />
            <Input label="Son dakika (girişe en fazla … gün)" name="promotion-max-lead" type="number" inputMode="numeric" min={0} max={MAX_LEAD_DAYS} value={form.maxLeadDays} onChange={set('maxLeadDays')} error={errors.maxLeadDays} disabled={disabled} className="w-full sm:w-64" />
          </div>
          <MultiChips label="Oda tipleri" allLabel="Bütün tipler" options={roomTypeOptions} values={form.roomTypeIds} onChange={(values) => setValue('roomTypeIds', values)} disabled={disabled} error={errors.roomTypeIds} />
          <MultiChips
            label="Pansiyonlar"
            allLabel="Bütün pansiyonlar"
            options={BOARD_TYPES.map((board) => ({ value: board, label: context.boardLabel(board) }))}
            values={form.boardTypes}
            onChange={(values) => setValue('boardTypes', values)}
            disabled={disabled}
            error={errors.boardTypes}
          />
          <MultiChips
            label="Satış kanalları (acente hariç: kontrat fiyatı nettir)"
            options={PROMOTION_SOURCES.map((source) => ({ value: source, label: RESERVATION_SOURCE_LABELS[source] }))}
            values={form.sources}
            onChange={(values) => setValue('sources', values)}
            disabled={disabled}
            error={errors.sources}
          />
          {form.sources.includes('OTA') && <p className="text-xs text-warning-ink">OTA satışında fiyatı genellikle kanal belirler; indirimin kanalla uyumlu olduğundan emin olun.</p>}
        </Section>
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-28 xl:self-start">
        <Card>
          <section aria-label="Kural" className="flex flex-col gap-2 p-1">
            <h2 className="text-base font-bold text-ink">Kural</h2>
            <p className="text-lg font-bold text-success-ink">{rule.headline}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
              {rule.conditions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {promotion?.status === 'ACTIVE' && !readOnly && (
              <Alert tone="info" title="Promosyon yayında">
                Değişiklik yalnızca kayıttan sonra açılan rezervasyonları etkiler; açılmış rezervasyonlar koşullarını korur.
              </Alert>
            )}
          </section>
        </Card>
        {!readOnly && (
          <div className="flex gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="flex-1">
                Vazgeç
              </Button>
            )}
            <Button type="submit" icon="check" disabled={busy} className="flex-1">
              {busy ? 'Kaydediliyor…' : promotion ? 'Değişiklikleri kaydet' : 'Taslak olarak kaydet'}
            </Button>
          </div>
        )}
      </aside>
    </form>
  );
}
