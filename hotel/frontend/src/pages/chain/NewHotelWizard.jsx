import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HOTEL_COPY_GROUPS, HOTEL_COPY_GROUP_HINTS, HOTEL_COPY_GROUP_LABELS, chainHotelCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { chainKeys, switchHotel } from '../../lib/chain.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Tarayıcının bildiği saat dilimleri (öneri listesi; değer sunucuda doğrulanır). */
const TIME_ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Istanbul'];

const STEPS = ['Otel bilgileri', 'Kopyalanacak ayarlar', 'Özet'];
const IDENTITY_FIELDS = ['name', 'code', 'timezone', 'currency', 'address', 'phone', 'email'];

const SKIPPED_LABELS = Object.freeze({
  largePaymentThreshold: 'büyük ödeme eşiği',
  earlyCheckInFeeValue: 'sabit erken giriş ücreti',
  lateCheckOutFeeValue: 'sabit geç çıkış ücreti',
});

/**
 * Sonuç ekranı: yalnız SEÇİLEN grupların sonucu; seçilmeyenler tek satırda. Rol matrisi satırı yoksa kaynak otel
 * varsayılan matrisle çalışıyordur (yeni otel de öyle açılır) — "kopyalanmadı" demek yanıltır.
 *
 * @param {{ copy: string[], copied: { roomTypes: number, taxes: number, seasons: number, rolePermissions: number } }} result
 */
function copiedLines({ copy, copied }) {
  const lines = [];
  if (copy.includes('GENERAL')) lines.push('Genel parametreler kopyalandı.');
  const counts = [
    copy.includes('ROOM_TYPES') && `${copied.roomTypes} oda tipi`,
    copy.includes('TAXES') && `${copied.taxes} vergi`,
    copy.includes('SEASONS') && `${copied.seasons} sezon`,
  ].filter(Boolean);
  if (counts.length) lines.push(`${counts.join(', ')} kopyalandı.`);
  if (copy.includes('ROLE_MATRIX')) {
    lines.push(copied.rolePermissions > 0 ? 'Rol ve izin matrisi kopyalandı.' : 'Kaynak otel varsayılan rol matrisini kullanıyor; yeni otel de varsayılan rollerle açıldı.');
  }
  const left = HOTEL_COPY_GROUPS.filter((group) => !copy.includes(group));
  if (left.length) lines.push(`Kopyalanmadı (seçilmedi): ${left.map((group) => HOTEL_COPY_GROUP_LABELS[group]).join(', ')}.`);
  return lines;
}

/**
 * Yeni otel sihirbazı (modül 63): kimlik → kaynak otel ve kopyalanacak ayar grupları → özet. Kuran kişi yeni otelin
 * yöneticisi olur; sonunda yeni otele geçip odaları ve kullanıcıları tanımlayabilir.
 *
 * @param {{ sources: Array<{ id: string, name: string, code: string, currency: string, timezone: string }>, defaultSourceId: string, onClose: () => void }} props
 */
export function NewHotelWizard({ sources, defaultSourceId, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const zoneListId = useId();
  const initialSource = sources.find((source) => source.id === defaultSourceId) ?? sources[0];
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({
    name: '',
    code: '',
    timezone: initialSource?.timezone ?? 'Europe/Istanbul',
    currency: initialSource?.currency ?? 'TRY',
    address: '',
    phone: '',
    email: '',
    sourceHotelId: initialSource?.id ?? '',
    copy: [...HOTEL_COPY_GROUPS],
  });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [switching, setSwitching] = useState(false);
  /** Alan değişince o alanın hatası kalkar (düzeltilmiş alan kırmızı kalmasın). */
  const change = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };
  const set = (key) => (event) => change(key, event.target.value);

  const source = sources.find((item) => item.id === values.sourceHotelId);
  const currencyDiffers = Boolean(source) && source.currency !== values.currency.trim().toUpperCase();
  // Para birimi farklıysa oda tipi kopyalanamaz (taban fiyatlar başka birimde): seçim kendiliğinden kalkar.
  const copy = useMemo(() => (currencyDiffers ? values.copy.filter((group) => group !== 'ROOM_TYPES') : values.copy), [currencyDiffers, values.copy]);

  const create = useMutation({
    mutationFn: (payload) => apiPost('/chain/hotels', payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: chainKeys.all });
      queryClient.invalidateQueries({ queryKey: ['auth', 'hotels'] });
      setResult(created);
      toastSuccess(`${created.hotel.name} açıldı`);
    },
    onError: (error) => {
      const fields = error.fields ?? {};
      if (Object.keys(fields).length) {
        setErrors(fields);
        if (IDENTITY_FIELDS.some((field) => fields[field])) setStep(0);
        else setStep(1);
      } else if (error.code === 'DUPLICATE') {
        setErrors({ code: error.message });
        setStep(0);
      }
      toastError(error.message);
    },
  });

  const payload = { ...values, copy };

  function next() {
    const checked = validateWith(chainHotelCreateSchema, payload);
    const stepFields = step === 0 ? IDENTITY_FIELDS : ['sourceHotelId', 'copy'];
    const stepErrors = checked.ok ? {} : Object.fromEntries(Object.entries(checked.errors).filter(([field]) => stepFields.includes(field)));
    if (Object.keys(stepErrors).length) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep((current) => current + 1);
  }

  function submit() {
    const checked = validateWith(chainHotelCreateSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      setStep(IDENTITY_FIELDS.some((field) => checked.errors[field]) ? 0 : 1);
      return;
    }
    create.mutate(checked.data);
  }

  async function openNewHotel() {
    setSwitching(true);
    try {
      await switchHotel(result.hotel.id);
      navigate('/ayarlar');
      toastSuccess(`${result.hotel.name} oteline geçildi: odaları ve kullanıcıları tanımlayın`);
    } catch (error) {
      toastError(error.message);
      setSwitching(false);
    }
  }

  const toggle = (group) => (event) =>
    change('copy', event.target.checked ? [...new Set([...values.copy, group])] : values.copy.filter((item) => item !== group));

  const busy = create.isPending || switching;

  if (result) {
    return (
      <Modal
        open
        title="Otel açıldı"
        onClose={busy ? () => {} : onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>Kapat</Button>
            <Button icon="arrowRight" onClick={openNewHotel} disabled={busy}>{switching ? 'Geçiliyor…' : 'Yeni otele geç'}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-ink-soft">
          <p>
            <span className="font-semibold text-ink">{result.hotel.name}</span> ({result.hotel.code}) zincire eklendi; yöneticisi sizsiniz.
          </p>
          <ul className="list-disc pl-5">
            {copiedLines(result).map((line) => <li key={line}>{line}</li>)}
            {result.skipped.length > 0 && <li>Para birimi farklı olduğu için kopyalanmadı: {result.skipped.map((field) => SKIPPED_LABELS[field] ?? field).join(', ')}.</li>}
          </ul>
          <Alert tone="info">Sıradakiler yeni otelde: odaları tanımlayın, kullanıcıları ekleyin (ya da zincirdeki kişilere erişim verin), fatura / KBS / kanal ayarlarını girin — bunlar her otelin kendine ait olduğu için kopyalanmaz.</Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={`Yeni otel · ${STEPS[step]}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          {step > 0 ? (
            <Button variant="outline" icon="arrowLeft" onClick={() => setStep((current) => current - 1)} disabled={busy}>Geri</Button>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button icon="arrowRight" onClick={next} disabled={busy}>İleri</Button>
          ) : (
            <Button icon="check" onClick={submit} disabled={busy}>{create.isPending ? 'Açılıyor…' : 'Oteli aç'}</Button>
          )}
        </>
      }
    >
      <ol className="mb-5 flex gap-2 text-xs font-semibold" aria-label="Adımlar">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} className={`flex-1 rounded-full px-3 py-1 text-center ${index === step ? 'bg-ink text-white' : index < step ? 'bg-success-soft text-success-ink' : 'bg-surface-muted text-ink-muted'}`}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form onSubmit={(event) => { event.preventDefault(); next(); }} noValidate className="flex flex-col gap-4">
          <Input label="Otel adı" name="hotel-name" value={values.name} onChange={set('name')} error={errors.name} maxLength={200} placeholder="ör. Flex Ankara Çankaya" disabled={busy} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Otel kodu" name="hotel-code" value={values.code} onChange={(event) => change('code', event.target.value.toUpperCase())} error={errors.code} maxLength={20} placeholder="ör. ANK-01" disabled={busy} required />
            <Input label="Para birimi" name="hotel-currency" value={values.currency} onChange={(event) => change('currency', event.target.value.toUpperCase())} error={errors.currency} maxLength={3} disabled={busy} required />
          </div>
          <Input label="Saat dilimi" name="hotel-timezone" list={zoneListId} value={values.timezone} onChange={set('timezone')} error={errors.timezone} disabled={busy} required />
          <datalist id={zoneListId}>
            {TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}
          </datalist>
          <Input label="Adres" name="hotel-address" value={values.address} onChange={set('address')} error={errors.address} maxLength={500} disabled={busy} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Telefon" name="hotel-phone" value={values.phone} onChange={set('phone')} error={errors.phone} maxLength={40} disabled={busy} />
            <Input label="E-posta" name="hotel-email" type="email" value={values.email} onChange={set('email')} error={errors.email} maxLength={200} disabled={busy} />
          </div>
          <p className="text-xs text-ink-muted">Kod otel seçicide ve raporlarda görünür; sistemdeki tüm otellerde tekil olmalı. Büyük harf, rakam ve tire.</p>
        </form>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Select
            label="Ayarları kopyalanacak otel"
            name="hotel-source"
            value={values.sourceHotelId}
            onChange={set('sourceHotelId')}
            options={sources.map((item) => ({ value: item.id, label: `${item.name} (${item.code}, ${item.currency})` }))}
            error={errors.sourceHotelId}
            disabled={busy}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold text-ink">Kopyalanacaklar</legend>
            {HOTEL_COPY_GROUPS.map((group) => {
              const blocked = group === 'ROOM_TYPES' && currencyDiffers;
              return (
                <Checkbox
                  key={group}
                  name={`copy-${group}`}
                  label={HOTEL_COPY_GROUP_LABELS[group]}
                  hint={blocked ? `Para birimi farklı (${source?.currency} → ${values.currency.toUpperCase()}): taban fiyatlar başka birimde olduğu için kopyalanamaz.` : HOTEL_COPY_GROUP_HINTS[group]}
                  checked={copy.includes(group)}
                  onChange={toggle(group)}
                  disabled={busy || blocked}
                />
              );
            })}
            {errors.copy && <p className="text-sm text-danger-ink">{errors.copy}</p>}
          </fieldset>
          {currencyDiffers && copy.includes('GENERAL') && (
            <Alert tone="warning">Para birimi farklı: genel parametrelerdeki tutarlar (büyük ödeme eşiği, sabit erken giriş / geç çıkış ücreti) kopyalanmaz, yeni otelde girin.</Alert>
          )}
          <p className="text-xs text-ink-muted">Odalar, kullanıcılar, misafir ve rezervasyonlar, fatura / KBS / kanal ayarları ve dış sistem şifreleri hiçbir zaman kopyalanmaz.</p>
        </div>
      )}

      {step === 2 && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="Otel" value={`${values.name} (${values.code})`} />
          <Summary label="Para birimi · saat dilimi" value={`${values.currency} · ${values.timezone}`} />
          <Summary label="Kaynak otel" value={source ? `${source.name} (${source.code})` : '—'} />
          <Summary label="Kopyalanacaklar" value={copy.length ? copy.map((group) => HOTEL_COPY_GROUP_LABELS[group]).join(', ') : 'Hiçbiri (boş otel)'} />
          <div className="sm:col-span-2">
            <Alert tone="info">Oteli siz açıyorsunuz: yeni otelde yönetici erişiminiz olur, üst bardaki otel seçiciyle geçersiniz.</Alert>
          </div>
        </dl>
      )}
    </Modal>
  );
}

/** @param {{ label: string, value: string }} props */
function Summary({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}
