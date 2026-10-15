import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AGENCY_BONUS_METRICS,
  AGENCY_BONUS_METRIC_LABELS,
  AGENCY_BONUS_MODES,
  AGENCY_BONUS_MODE_HINTS,
  AGENCY_BONUS_MODE_LABELS,
  MAX_BONUS_NOTES_LENGTH,
  MAX_BONUS_RATE_PCT,
  MAX_BONUS_RULE_NAME_LENGTH,
  MAX_BONUS_TIERS,
  createAgencyBonusRuleSchema,
  previewAgencyBonusRuleSchema,
  updateAgencyBonusRuleSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Input, Spinner, Textarea } from '@hotelos/ui';
import { AgencyPicker } from '../../components/AgencyPicker.jsx';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { agencyBonusKeys, formatQuantity, formatScore } from '../../lib/agencyBonus.js';
import { addTier, describeTiers, formOf, payloadOf, previewPayloadOf, removeTier, tierErrorsByRow } from '../../lib/agencyBonusForm.js';
import { apiPatch, apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { useHotelSettings } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { PaceBadge } from './BonusProgress.jsx';

const STALE_TEXT = 'Kural bu arada başkası tarafından değiştirildi; ekran yenilendi, değişikliğinizi kontrol edip tekrar deneyin.';
/** Önizleme isteği yazmayı bekler (her tuşta sunucuya gitmesin). */
const PREVIEW_DEBOUNCE_MS = 500;
const PREVIEW_STALE_MS = 30_000;

const METRIC_OPTIONS = AGENCY_BONUS_METRICS.map((value) => ({ value, label: AGENCY_BONUS_METRIC_LABELS[value] }));
const MODE_OPTIONS = AGENCY_BONUS_MODES.map((value) => ({ value, label: AGENCY_BONUS_MODE_LABELS[value] }));

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
 * Prim kuralı formu (modül 35): açma ve düzenleme. Yan panelde kademelerin
 * okunur cümleleri ve **kaydetmeden önizleme**: bu acentenin bu dönemdeki
 * gerçekleşen üretimi, eldekiyle tahmin ve bu kademelerle prim (sunucu
 * hesaplar; kayıttaki hesabın aynısı).
 *
 * Acente kural açılırken seçilir, sonra değişmez (başka acente için yeni kural).
 *
 * @param {{ rule?: any, defaultAgency?: { id: string, code: string, name: string } | null, onSaved: (rule: any) => void, onCancel?: () => void }} props
 */
export function BonusRuleForm({ rule, defaultAgency = null, onSaved, onCancel }) {
  const queryClient = useQueryClient();
  const hotel = useHotelSettings();
  const currency = hotel.data?.currency ?? '';
  const { roomTypes } = useRoomTypes();
  // Formun dayandığı sürüm: canlı tazeleme yeni sürümü getirse de kayıt bu sürümle gider.
  const [base, setBase] = useState(rule ?? null);
  const [form, setForm] = useState(() => formOf(rule, { agency: defaultAgency }));
  const [errors, setErrors] = useState({});
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(base, { agency: defaultAgency }));
  const serverChanged = Boolean(rule && base && rule.updatedAt !== base.updatedAt);
  useEffect(() => {
    if (serverChanged && !dirty) {
      setBase(rule);
      setForm(formOf(rule));
    }
  }, [serverChanged, dirty, rule]);
  // Düzeltilen alanın hatası kalkar (kalan hatalar kayıtta yeniden denetlenir).
  const clearError = (key) => setErrors((current) => (key in current ? Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)) : current));
  const set = (key) => (event) => {
    clearError(key);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const setValue = (key, value) => {
    clearError(key === 'agency' ? 'agencyId' : key);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const setTier = (index, key) => (event) => {
    clearError(`tiers.${index}.${key}`);
    setForm((current) => ({ ...current, tiers: current.tiers.map((tier, position) => (position === index ? { ...tier, [key]: event.target.value } : tier)) }));
  };

  /* ── Önizleme (yazmayı bekler, yalnızca geçerli formda) ── */
  const [previewInput, setPreviewInput] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const payload = previewPayloadOf(form);
      setPreviewInput(payload && validateWith(previewAgencyBonusRuleSchema, payload).ok ? payload : null);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [form]);
  const preview = useQuery({
    queryKey: agencyBonusKeys.preview(previewInput ?? {}),
    queryFn: () => apiPost('/agency-bonus/rules/preview', previewInput),
    enabled: Boolean(previewInput),
    staleTime: PREVIEW_STALE_MS,
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: (payload) => (rule ? apiPatch(`/agency-bonus/rules/${rule.id}`, payload) : apiPost('/agency-bonus/rules', payload)),
    onSuccess: (saved) => {
      setBase(saved);
      setForm(formOf(saved));
      toastSuccess(rule ? 'Prim kuralı güncellendi' : 'Prim kuralı taslak olarak açıldı; kontrol edip yürürlüğe alın');
      queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
      onSaved(saved);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = payloadOf(form, rule ? base?.updatedAt ?? null : null);
    const checked = validateWith(rule ? updateAgencyBonusRuleSchema : createAgencyBonusRuleSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError('Formda düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  const busy = save.isPending;
  const nights = form.metric === 'NIGHTS';
  const unit = nights ? 'gece' : `${currency}, vergisiz`;
  const tierErrors = tierErrorsByRow(errors);
  const tierText = describeTiers(form, currency);
  const roomTypeOptions = roomTypes.map((type) => ({ value: type.id, label: type.name }));
  for (const id of form.roomTypeIds) if (!roomTypeOptions.some((option) => option.value === id)) roomTypeOptions.push({ value: id, label: 'Silinmiş oda tipi' });
  const live = preview.data;

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-5">
        {serverChanged && dirty && (
          <Alert
            tone="warning"
            title="Kural bu arada değişti"
            action={
              <Button type="button" size="sm" variant="outline" icon="refresh" onClick={() => { setBase(rule); setForm(formOf(rule)); setErrors({}); }}>
                Güncel hâli yükle
              </Button>
            }
          >
            Başka biri kuralı kaydetti. Kaydederseniz sunucu reddeder; güncel hâli yükleyip değişikliğinizi yeniden yapın.
          </Alert>
        )}
        <Section title="Kural">
          <AgencyPicker
            value={form.agency}
            onChange={(agency) => setValue('agency', agency)}
            error={errors.agencyId}
            disabled={busy || Boolean(rule)}
            required
          />
          {rule && <p className="-mt-2 text-xs text-ink-muted">Acente değişmez; başka acente için yeni kural açın.</p>}
          <Input label="Kural adı" name="bonus-rule-name" value={form.name} onChange={set('name')} error={errors.name} maxLength={MAX_BONUS_RULE_NAME_LENGTH} placeholder="Ör. Yaz 2027 gece primi" disabled={busy} required />
          <div className="flex flex-wrap gap-3">
            <Input label="Dönem başı (ilk gece)" name="bonus-rule-start" type="date" value={form.startDate} max={form.endDate || undefined} onChange={set('startDate')} error={errors.startDate} disabled={busy} className="w-full sm:w-48" required />
            <Input label="Dönem sonu (son gece)" name="bonus-rule-end" type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} error={errors.endDate} disabled={busy} className="w-full sm:w-48" required />
          </div>
          <Textarea label="Not (sözleşme maddesi, iç kullanım)" name="bonus-rule-notes" rows={2} maxLength={MAX_BONUS_NOTES_LENGTH} value={form.notes} onChange={set('notes')} error={errors.notes} disabled={busy} />
        </Section>

        <Section title="Hedef" hint="Üretim: dönemin içine düşen, misafirin gerçekten kaldığı geceler (iptal ve gelmeyen sayılmaz). Ciro: bu gecelerin folyoya işlenen vergisiz oda geliri.">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Ölçüt</span>
            <ChoiceChips label="Ölçüt" options={METRIC_OPTIONS} value={form.metric} onChange={(value) => setValue('metric', value)} disabled={busy} required />
          </div>
          <Input
            label={`Hedef (${unit})`}
            name="bonus-rule-target"
            inputMode={nights ? 'numeric' : 'decimal'}
            value={form.target}
            onChange={set('target')}
            error={errors.target}
            placeholder={nights ? 'Ör. 2000' : 'Ör. 3500000'}
            disabled={busy}
            className="w-full sm:w-64"
            required
          />
          <p className="-mt-2 text-xs text-ink-muted">Acente puanı = gerçekleşen / hedef. Kademeler hedeften bağımsızdır (hedefin altında da başlayabilir).</p>
        </Section>

        <Section title="Kademeler" hint={`Eşikler büyüyerek gider, oranlar düşmez. En fazla ${MAX_BONUS_TIERS} kademe; oran en fazla %${MAX_BONUS_RATE_PCT}.`}>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Uygulama</span>
            <ChoiceChips label="Uygulama" options={MODE_OPTIONS} value={form.mode} onChange={(value) => setValue('mode', value)} disabled={busy} required />
            <p className="text-xs text-ink-muted">{AGENCY_BONUS_MODE_HINTS[form.mode]}</p>
          </div>
          <ol className="flex flex-col gap-2" aria-label="Kademe satırları">
            {form.tiers.map((tier, index) => {
              const rowErrors = tierErrors.get(index) ?? {};
              return (
                <li key={index} className="flex flex-wrap items-start gap-2">
                  <span className="mt-8 grid size-7 shrink-0 place-items-center rounded-full bg-canvas text-xs font-bold text-ink-soft ring-1 ring-line">{index + 1}</span>
                  <Input
                    label={`Eşik (${unit})`}
                    name={`bonus-tier-${index}-threshold`}
                    inputMode={nights ? 'numeric' : 'decimal'}
                    value={tier.threshold}
                    onChange={setTier(index, 'threshold')}
                    error={rowErrors.threshold}
                    disabled={busy}
                    className="w-full sm:w-52"
                  />
                  <Input label="Prim oranı (%)" name={`bonus-tier-${index}-rate`} inputMode="decimal" value={tier.ratePct} onChange={setTier(index, 'ratePct')} error={rowErrors.ratePct} disabled={busy} className="w-full sm:w-36" />
                  <Button
                    type="button"
                    variant="ghost"
                    icon="trash"
                    className="mt-6"
                    aria-label={`${index + 1}. kademeyi sil`}
                    onClick={() => setValue('tiers', removeTier(form.tiers, index))}
                    disabled={busy || form.tiers.length <= 1}
                  >
                    Sil
                  </Button>
                </li>
              );
            })}
          </ol>
          {errors.tiers && <p className="text-xs font-semibold text-sec-strong">{errors.tiers}</p>}
          <Button type="button" variant="outline" icon="plus" className="w-fit" onClick={() => setValue('tiers', addTier(form.tiers))} disabled={busy || form.tiers.length >= MAX_BONUS_TIERS}>
            Kademe ekle
          </Button>
        </Section>

        <Section title="Kapsam ve tavan">
          <MultiChips label="Sayılan oda tipleri" allLabel="Bütün tipler" options={roomTypeOptions} values={form.roomTypeIds} onChange={(values) => setValue('roomTypeIds', values)} disabled={busy} error={errors.roomTypeIds} />
          <Input
            label={`Prim tavanı (${currency}, boş = tavansız)`}
            name="bonus-rule-cap"
            inputMode="decimal"
            value={form.maxBonus}
            onChange={set('maxBonus')}
            error={errors.maxBonus}
            placeholder="Ör. 250000"
            disabled={busy}
            className="w-full sm:w-64"
          />
        </Section>
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-28 xl:self-start">
        <Card>
          <section aria-label="Kural özeti" className="flex flex-col gap-2 p-1">
            <h2 className="text-base font-bold text-ink">Kademeler</h2>
            <p className="text-sm font-semibold text-success-ink">{tierText.headline}</p>
            {tierText.lines.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
                {tierText.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Eşik ve oran girince kademeler burada okunur.</p>
            )}
          </section>
        </Card>
        <Card>
          <section aria-label="Önizleme" aria-live="polite" className="flex flex-col gap-3 p-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-ink">Bu koşullarla</h2>
              {preview.isFetching && <Spinner className="size-4" />}
            </div>
            {!previewInput ? (
              <p className="text-sm text-ink-muted">Acente, dönem, hedef ve en az bir kademe girince bu acentenin üretimi ve primi burada hesaplanır (kaydetmeden).</p>
            ) : preview.isError ? (
              <Alert tone="danger" title="Önizleme hesaplanamadı">{preview.error.message}</Alert>
            ) : !live ? (
              <Spinner className="py-6" />
            ) : (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Gerçekleşen</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">
                    {formatQuantity('NIGHTS', live.realized.nights, currency)} · {formatMoney(live.realized.revenue, currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Hedefe ulaşma</dt>
                  <dd className="font-bold tabular-nums text-ink">{formatScore(live.realized.scorePct)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Şu ana kadarki prim</dt>
                  <dd className="font-bold tabular-nums text-success-ink">{formatMoney(live.earned.amount, currency)}</dd>
                </div>
                {live.phase !== 'ENDED' && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Eldeki (gelecek)</dt>
                      <dd className="text-right tabular-nums text-ink">
                        {formatQuantity('NIGHTS', live.onBooks.nights, currency)} · {formatMoney(live.onBooks.revenue, currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-muted">Eldekiyle tahmini prim</dt>
                      <dd className="font-semibold tabular-nums text-ink">
                        {formatMoney(live.forecast.amount, currency)} {live.projectedTier ? `(${live.projectedTier}. kademe)` : ''}
                      </dd>
                    </div>
                  </>
                )}
                {live.phase === 'RUNNING' && live.pace.pace && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-muted">Zamana göre</dt>
                    <dd>
                      <PaceBadge pace={live.pace.pace} />
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        </Card>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="flex-1">
              Vazgeç
            </Button>
          )}
          <Button type="submit" icon="check" disabled={busy} className="flex-1">
            {busy ? 'Kaydediliyor…' : rule ? 'Değişiklikleri kaydet' : 'Taslak olarak kaydet'}
          </Button>
        </div>
        {rule?.status === 'ACTIVE' && (
          <Alert tone="info" title="Kural yürürlükte">
            Değişiklik ilerlemeyi yeni koşullarla yeniden hesaplar. Hesaplanmış ama onaya gitmemiş hak ediş yeniden hesaplanmadan onaya gönderilemez.
          </Alert>
        )}
      </aside>
    </form>
  );
}
