import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generalSettingsSchema } from '@hotelos/hotel-contracts';
import { Button, Card, Input, Select } from '@hotelos/ui';
import { api, apiPut } from '../../lib/api.js';
import { BOARD_TYPE_LABELS } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const BOARD_OPTIONS = Object.entries(BOARD_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export function GeneralTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    defaultBoardType: 'BB',
    cancellationPolicyDays: '0',
    cancellationPolicyPenaltyPct: '0',
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

  // `isLoading` değil `isPending`: bkz. HotelInfoTab'daki açıklama.
  if (hotelQuery.isPending) return <Card>Yükleniyor…</Card>;

  if (hotelQuery.isError) {
    return (
      <Card>
        <p className="mb-3 text-sm text-red-600">{hotelQuery.error.message}</p>
        <Button variant="secondary" onClick={() => hotelQuery.refetch()}>
          Tekrar dene
        </Button>
      </Card>
    );
  }

  const days = Number(form.cancellationPolicyDays);
  const penalty = Number(form.cancellationPolicyPenaltyPct);
  const policySummary =
    days === 0 && penalty === 0
      ? 'Şu an iptal politikası uygulanmıyor — rezervasyonlar ücretsiz iptal edilebilir.'
      : `Girişten ${days} gün öncesine kadar ücretsiz iptal; sonrasında %${String(penalty).replace('.', ',')} ceza uygulanır.`;

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6">
      <Card title="Varsayılanlar">
        <div className="grid gap-4 sm:grid-cols-2">
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
        <p className="mt-2 text-xs text-gray-500">
          Yeni rezervasyon formu bu pansiyon tipiyle açılır; kullanıcı isterse değiştirebilir.
        </p>
      </Card>

      <Card title="İptal politikası">
        <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-700">{policySummary}</p>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        <span className="text-xs text-gray-500">
          Son güncelleme: {new Date(hotel.updatedAt).toLocaleString('tr-TR')}
        </span>
      </div>
    </form>
  );
}
