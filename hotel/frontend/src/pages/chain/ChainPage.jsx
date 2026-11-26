import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chainGroupCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Input, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { api, apiPost } from '../../lib/api.js';
import { chainKeys } from '../../lib/chain.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Zincir konsolu (modül 63): zincirin otellerini tek panelden görme. Pano (bugün), rapor (aralık, karşılaştırmalı),
 * oteller (yeni otel sihirbazı, var olan oteli ekleme) ve merkezi kullanıcı yönetimi.
 *
 * Açık otel zincirde değilse zincir kurma ekranı çıkar (zinciri yönetme izni ve bu otelde yöneticilik gerekir).
 */
export function ChainPage() {
  const overview = useQuery({ queryKey: chainKeys.overview(), queryFn: () => api('/chain') });

  if (overview.isPending) return <Spinner label="Zincir yükleniyor…" className="py-16" />;
  if (overview.isError) {
    return (
      <Alert tone="danger" title="Zincir bilgisi alınamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => overview.refetch()}>Tekrar dene</Button>}>
        {overview.error.message}
      </Alert>
    );
  }

  const data = overview.data;
  const tabs = [
    { to: '/zincir/pano', label: 'Pano', icon: 'dashboard' },
    { to: '/zincir/rapor', label: 'Rapor', icon: 'chart' },
    { to: '/zincir/oteller', label: 'Oteller', icon: 'building' },
    ...(data.access.canManageUsers ? [{ to: '/zincir/kullanicilar', label: 'Kullanıcılar', icon: 'users' }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={data.group ? data.group.name : 'Zincir'}
        description={
          data.group
            ? `${data.group.hotelCount} otel. Pano ve raporda yalnız erişiminiz olan ve oradaki rolünüzün zinciri görmeye izin verdiği oteller yer alır; para birimleri ayrı toplanır.`
            : 'Birden çok oteli tek panelden yönetmek için zincir kurun: oteller arası geçiş, zincir panosu ve raporu, merkezi kullanıcı yönetimi.'
        }
      />
      {data.group ? (
        <>
          <TabNav label="Zincir sayfaları" tabs={tabs} />
          <Outlet context={data} />
        </>
      ) : (
        <NoGroup overview={data} />
      )}
    </div>
  );
}

/** @param {{ overview: any }} props */
function NoGroup({ overview }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState({});
  const canCreate = overview.access.canManage && overview.access.isHotelAdmin;

  const create = useMutation({
    mutationFn: (payload) => apiPost('/chain/group', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chainKeys.all });
      queryClient.invalidateQueries({ queryKey: ['auth', 'hotels'] });
      toastSuccess('Zincir kuruldu; bu otel ilk oteli');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(chainGroupCreateSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data);
  }

  if (!canCreate) {
    return (
      <EmptyState
        icon="building"
        title={`${overview.hotel.name} bir zincire bağlı değil`}
        description={overview.access.canManage ? 'Zinciri bu otelin yöneticisi kurar.' : 'Zincir kurulduğunda otellerin panosu ve raporu burada görünür.'}
      />
    );
  }
  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">Zincir kur</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {overview.hotel.name} zincirin ilk oteli olur. Sonra "Oteller" sekmesinden yeni otel açabilir (bu otelin ayarları kopyalanır) ya da yöneticisi olduğunuz başka bir oteli ekleyebilirsiniz.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Zincir adı" name="chain-name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} maxLength={120} placeholder="ör. Flex Otelleri" className="w-full max-w-sm" disabled={create.isPending} required />
          <Button type="submit" icon="check" disabled={create.isPending}>{create.isPending ? 'Kuruluyor…' : 'Zinciri kur'}</Button>
        </div>
      </form>
    </Card>
  );
}
