import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hotelInfoSchema } from '@hotelos/hotel-contracts';
import { Card, Input } from '@hotelos/ui';
import { FormActions } from '../../components/FormActions.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const EMPTY_FORM = {
  name: '',
  address: '',
  phone: '',
  email: '',
  logoUrl: '',
  currency: 'TRY',
  timezone: 'Europe/Istanbul',
  checkInTime: '14:00',
  checkOutTime: '12:00',
};

export function HotelInfoTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  const hotelQuery = useQuery({ queryKey: ['settings', 'hotel'], queryFn: () => api('/settings/hotel') });
  const hotel = hotelQuery.data;

  // Sunucudan veri gelince (veya sürüm çakışması sonrası tazelenince) formu ona eşitle.
  useEffect(() => {
    if (!hotel) return;
    setForm({
      name: hotel.name ?? '',
      address: hotel.address ?? '',
      phone: hotel.phone ?? '',
      email: hotel.email ?? '',
      logoUrl: hotel.logoUrl ?? '',
      currency: hotel.currency ?? 'TRY',
      timezone: hotel.timezone ?? 'Europe/Istanbul',
      checkInTime: hotel.checkInTime ?? '14:00',
      checkOutTime: hotel.checkOutTime ?? '12:00',
    });
    setErrors({});
  }, [hotel]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/settings/hotel', values),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'hotel'], updated);
      toastSuccess('Otel bilgileri kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      // Sunucu alan bazlı hata döndüyse ilgili input'un altında göster.
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
    const result = validateWith(hotelInfoSchema, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    saveMutation.mutate({ ...result.data, expectedUpdatedAt: hotel.updatedAt });
  }

  if (!hotel) return <QueryFallback query={hotelQuery} errorTitle="Otel bilgileri yüklenemedi" />;

  return (
    <form onSubmit={handleSubmit} className="flex max-w-4xl flex-col gap-6">
      <Card title="Otel bilgileri" description="Faturada, onay e-postalarında ve misafire giden belgelerde görünür.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="Otel adı" name="name" value={form.name} onChange={setField('name')} error={errors.name} />
          <Input label="Kod" name="code" value={hotel.code} disabled title="Otel kodu sonradan değiştirilemez" />
          <Input label="Telefon" name="phone" value={form.phone} onChange={setField('phone')} error={errors.phone} />
          <Input
            label="E-posta"
            name="email"
            type="email"
            value={form.email}
            onChange={setField('email')}
            error={errors.email}
          />
          <Input
            label="Adres"
            name="address"
            value={form.address}
            onChange={setField('address')}
            error={errors.address}
            className="sm:col-span-2"
          />
          <Input
            label="Logo adresi (URL)"
            name="logoUrl"
            value={form.logoUrl}
            onChange={setField('logoUrl')}
            error={errors.logoUrl}
            className="sm:col-span-2"
          />
        </div>
      </Card>

      <Card title="Operasyon" description="Para birimi, saat dilimi ve giriş/çıkış saatleri.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Para birimi"
            name="currency"
            value={form.currency}
            onChange={setField('currency')}
            error={errors.currency}
            maxLength={3}
          />
          <Input
            label="Saat dilimi"
            name="timezone"
            value={form.timezone}
            onChange={setField('timezone')}
            error={errors.timezone}
          />
          <Input
            label="Check-in saati"
            name="checkInTime"
            value={form.checkInTime}
            onChange={setField('checkInTime')}
            error={errors.checkInTime}
            placeholder="14:00"
          />
          <Input
            label="Check-out saati"
            name="checkOutTime"
            value={form.checkOutTime}
            onChange={setField('checkOutTime')}
            error={errors.checkOutTime}
            placeholder="12:00"
          />
        </div>
      </Card>

      <FormActions isPending={saveMutation.isPending} updatedAt={hotel.updatedAt} />
    </form>
  );
}
