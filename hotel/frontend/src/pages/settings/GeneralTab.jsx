import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  IDENTITY_POLICIES,
  IDENTITY_POLICY_LABELS,
  OVERBOOKING_POLICIES,
  OVERBOOKING_POLICY_LABELS,
  STAY_FEE_MODES,
  STAY_FEE_MODE_LABELS,
  generalSettingsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Card, Input, Select } from '@hotelos/ui';
import { FormActions } from '../../components/FormActions.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { BOARD_TYPE_LABELS } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const BOARD_OPTIONS = Object.entries(BOARD_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const FEE_MODE_OPTIONS = STAY_FEE_MODES.map((value) => ({ value, label: STAY_FEE_MODE_LABELS[value] }));
const IDENTITY_OPTIONS = IDENTITY_POLICIES.map((value) => ({ value, label: IDENTITY_POLICY_LABELS[value] }));

/**
 * Ücret politikasının cümlesi ("Giriş saatinden önce: ilk gecenin %50'si").
 * @param {string} mode @param {string} value @param {string} when @param {string} night @param {string} currency
 */
function feeSummary(mode, value, when, night, currency) {
  if (mode === 'FIXED') return `${when}: ${value || '…'} ${currency}.`;
  if (mode === 'PERCENT_OF_NIGHT') return `${when}: ${night} fiyatının yüzde ${(value || '…').replace('.', ',')} kadarı.`;
  return `${when}: ücret yok.`;
}

export function GeneralTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    defaultBoardType: 'BB',
    cancellationPolicyDays: '0',
    cancellationPolicyPenaltyPct: '0',
    phoneCountryCode: DEFAULT_PHONE_COUNTRY_CODE,
    overbookingPolicy: 'REJECT',
    earlyCheckInFeeMode: 'NONE',
    earlyCheckInFeeValue: '0',
    lateCheckOutFeeMode: 'NONE',
    lateCheckOutFeeValue: '0',
    checkInIdentityPolicy: 'PRIMARY_GUEST',
  });
  const [errors, setErrors] = useState({});

  const hotelQuery = useQuery({ queryKey: ['settings', 'hotel'], queryFn: () => api('/settings/hotel') });
  const hotel = hotelQuery.data;

  useEffect(() => {
    if (!hotel) return;
    setForm({
      defaultBoardType: hotel.defaultBoardType ?? 'BB',
      cancellationPolicyDays: String(hotel.cancellationPolicyDays ?? 0),
      cancellationPolicyPenaltyPct: hotel.cancellationPolicyPenaltyPct ?? '0',
      phoneCountryCode: hotel.phoneCountryCode ?? DEFAULT_PHONE_COUNTRY_CODE,
      overbookingPolicy: hotel.overbookingPolicy ?? 'REJECT',
      earlyCheckInFeeMode: hotel.earlyCheckInFeeMode ?? 'NONE',
      earlyCheckInFeeValue: hotel.earlyCheckInFeeValue ?? '0',
      lateCheckOutFeeMode: hotel.lateCheckOutFeeMode ?? 'NONE',
      lateCheckOutFeeValue: hotel.lateCheckOutFeeValue ?? '0',
      checkInIdentityPolicy: hotel.checkInIdentityPolicy ?? 'PRIMARY_GUEST',
    });
    setErrors({});
  }, [hotel]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/settings/general', values),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'hotel'], updated);
      toastSuccess('Genel parametreler kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: ['settings', 'hotel'] });
    },
  });

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(generalSettingsSchema, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    saveMutation.mutate({ ...result.data, expectedUpdatedAt: hotel.updatedAt });
  }

  if (!hotel) return <QueryFallback query={hotelQuery} errorTitle="Genel parametreler yüklenemedi" />;

  const days = Number(form.cancellationPolicyDays);
  const penalty = Number(form.cancellationPolicyPenaltyPct);
  const hasPolicy = !(days === 0 && penalty === 0);
  const policySummary = hasPolicy
    ? `Girişten ${days} gün öncesine kadar ücretsiz iptal; sonrasında %${String(penalty).replace('.', ',')} ceza uygulanır.`
    : 'Şu an iptal politikası uygulanmıyor — rezervasyonlar ücretsiz iptal edilebilir.';

  return (
    <form onSubmit={handleSubmit} className="flex max-w-4xl flex-col gap-6">
      <Card
        title="Varsayılanlar"
        description="Yeni rezervasyon formu bu pansiyon tipiyle açılır; kullanıcı isterse değiştirebilir."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Varsayılan pansiyon"
            name="defaultBoardType"
            value={form.defaultBoardType}
            onChange={setField('defaultBoardType')}
            options={BOARD_OPTIONS}
            error={errors.defaultBoardType}
          />
          <Input
            label="Para birimi"
            name="currency"
            value={hotel.currency}
            disabled
            title="Para birimi 'Otel bilgileri' sekmesinden değiştirilir"
          />
        </div>
      </Card>

      <Card title="İptal politikası" description="Ücretsiz iptal süresi ve süre geçtikten sonra uygulanacak ceza.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Ücretsiz iptal süresi (gün)"
            name="cancellationPolicyDays"
            type="number"
            min="0"
            max="365"
            value={form.cancellationPolicyDays}
            onChange={setField('cancellationPolicyDays')}
            error={errors.cancellationPolicyDays}
          />
          <Input
            label="Ceza oranı (%)"
            name="cancellationPolicyPenaltyPct"
            inputMode="decimal"
            value={form.cancellationPolicyPenaltyPct}
            onChange={setField('cancellationPolicyPenaltyPct')}
            error={errors.cancellationPolicyPenaltyPct}
            placeholder="50"
          />
        </div>
        <Alert tone="info" title="Özet" className="mt-5">
          {policySummary}
        </Alert>
      </Card>

      <Card
        title="Misafir iletişimi"
        description="Misafir kartına ülke kodu yazılmadan girilen telefonlar (ör. 0532 111 00 01) bu kodla okunur."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Telefon ülke kodu"
            name="phoneCountryCode"
            inputMode="numeric"
            maxLength={4}
            value={form.phoneCountryCode}
            onChange={setField('phoneCountryCode')}
            error={errors.phoneCountryCode}
            placeholder={DEFAULT_PHONE_COUNTRY_CODE}
          />
        </div>
        <Alert tone="info" className="mt-5">
          WhatsApp mesajı geldiğinde misafir kartı bu kodla bulunur: +{form.phoneCountryCode.replace(/^\+/, '') || '…'} 532 111
          00 01 numarasından yazan misafir, kartında "0532 111 00 01" yazılıysa tanınır. Başka ülkeden misafirlerin
          numarasını kartta + ile yazın.
        </Alert>
      </Card>

      <Card
        title="Kapasite aşımı (overbooking)"
        description="Bir oda tipinde yer kalmadığında yeni rezervasyon ne olsun? Kanaldan (WhatsApp, OTA) gelen istekler her zaman reddedilir."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Politika"
            name="overbookingPolicy"
            value={form.overbookingPolicy}
            onChange={setField('overbookingPolicy')}
            options={OVERBOOKING_POLICIES.map((value) => ({ value, label: OVERBOOKING_POLICY_LABELS[value] }))}
            error={errors.overbookingPolicy}
          />
        </div>
        <Alert tone="info" className="mt-5">
          "Onaya gönder" seçilirse resepsiyonun açmak istediği rezervasyon Onaylar ekranına düşer; yönetici onaylarsa
          kapasite aşılarak açılır, reddederse açılmaz. Tarih değişikliği ve iptal geri alma her durumda yer ister.
        </Alert>
      </Card>

      <Card
        title="Giriş / çıkış"
        description={`Giriş saati ${hotel.checkInTime}, çıkış saati ${hotel.checkOutTime} (Otel bilgileri sekmesinden). Saatler otelin saat dilimine göredir.`}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Erken giriş ücreti"
            name="earlyCheckInFeeMode"
            value={form.earlyCheckInFeeMode}
            onChange={setField('earlyCheckInFeeMode')}
            options={FEE_MODE_OPTIONS}
            error={errors.earlyCheckInFeeMode}
          />
          {form.earlyCheckInFeeMode !== 'NONE' && (
            <Input
              label={form.earlyCheckInFeeMode === 'FIXED' ? `Tutar (${hotel.currency})` : 'Yüzde (%)'}
              name="earlyCheckInFeeValue"
              inputMode="decimal"
              value={form.earlyCheckInFeeValue}
              onChange={setField('earlyCheckInFeeValue')}
              error={errors.earlyCheckInFeeValue}
              placeholder={form.earlyCheckInFeeMode === 'FIXED' ? '500' : '50'}
            />
          )}
          <Select
            label="Geç çıkış ücreti"
            name="lateCheckOutFeeMode"
            value={form.lateCheckOutFeeMode}
            onChange={setField('lateCheckOutFeeMode')}
            options={FEE_MODE_OPTIONS}
            error={errors.lateCheckOutFeeMode}
          />
          {form.lateCheckOutFeeMode !== 'NONE' && (
            <Input
              label={form.lateCheckOutFeeMode === 'FIXED' ? `Tutar (${hotel.currency})` : 'Yüzde (%)'}
              name="lateCheckOutFeeValue"
              inputMode="decimal"
              value={form.lateCheckOutFeeValue}
              onChange={setField('lateCheckOutFeeValue')}
              error={errors.lateCheckOutFeeValue}
              placeholder={form.lateCheckOutFeeMode === 'FIXED' ? '500' : '50'}
            />
          )}
          <Select
            label="Girişte kimliği istenenler"
            name="checkInIdentityPolicy"
            value={form.checkInIdentityPolicy}
            onChange={setField('checkInIdentityPolicy')}
            options={IDENTITY_OPTIONS}
            error={errors.checkInIdentityPolicy}
          />
        </div>
        <Alert tone="info" title="Özet" className="mt-5">
          {feeSummary(form.earlyCheckInFeeMode, form.earlyCheckInFeeValue, `${hotel.checkInTime} öncesi giriş`, 'giriş gecesinin', hotel.currency)}{' '}
          {feeSummary(form.lateCheckOutFeeMode, form.lateCheckOutFeeValue, `${hotel.checkOutTime} sonrası çıkış`, 'son gecenin', hotel.currency)}{' '}
          Resepsiyon ücreti gerekçesiyle uygulamayabilir (denetim izine yazılır). Kimlik bilgisi Kimlik Bildirim
          Sistemi'ne gider; {form.checkInIdentityPolicy === 'ALL_ADULTS' ? 'bütün yetişkinlerin' : 'en az rezervasyon sahibinin'} belgesi girilmeden giriş yapılmaz.
        </Alert>
      </Card>

      <FormActions isPending={saveMutation.isPending} updatedAt={hotel.updatedAt} />
    </form>
  );
}
