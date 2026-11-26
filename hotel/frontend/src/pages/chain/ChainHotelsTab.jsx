import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { chainKeys, switchHotel } from '../../lib/chain.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { NewHotelWizard } from './NewHotelWizard.jsx';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;

/**
 * Zincirin otelleri: kod, para birimi / saat dilimi, oda sayısı, oradaki rolünüz. Yeni otel sihirbazı ve yöneticisi
 * olduğunuz başka bir oteli zincire ekleme / çıkarma (zinciri yönetme izni + o otelde yöneticilik).
 */
export function ChainHotelsTab() {
  const overview = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState(null);
  const [switching, setSwitching] = useState(null);
  const canManage = overview.access.canManage;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const list = useInfiniteQuery({
    queryKey: chainKeys.hotels(search),
    queryFn: ({ pageParam }) => api(withQuery('/chain/hotels', { search: search || undefined, cursor: pageParam || undefined, limit: PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const sources = rows.filter((row) => row.myRole);

  const detach = useMutation({
    mutationFn: (hotel) => apiPost(`/chain/hotels/${hotel.id}/detach`, {}),
    onSuccess: (result, hotel) => {
      queryClient.invalidateQueries({ queryKey: chainKeys.all });
      queryClient.invalidateQueries({ queryKey: ['auth', 'hotels'] });
      setDetaching(null);
      toastSuccess(result.groupDeleted ? `${hotel.name} çıkarıldı; zincirde otel kalmadığı için zincir kapandı` : `${hotel.name} zincirden çıkarıldı`);
    },
    onError: (error) => toastError(error.message),
  });

  async function openHotel(row) {
    setSwitching(row.id);
    try {
      await switchHotel(row.id);
      navigate('/');
      toastSuccess(`${row.name} oteline geçildi`);
    } catch (error) {
      toastError(error.message);
    } finally {
      setSwitching(null);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Otel',
      render: (row) => (
        // Adres uzun olabilir: sütun sınırlı, taşan kısım kesilir (tam hali ipucunda); işlem düğmeleri ekrana sığsın.
        <div className="min-w-0 max-w-[20rem]" title={row.address ?? undefined}>
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-xs text-ink-muted">{row.code}{row.address ? ` · ${row.address}` : ''}</span>
        </div>
      ),
    },
    {
      key: 'currency',
      header: 'Para birimi',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span>
          {row.currency}
          <span className="block text-xs text-ink-muted">{row.timezone}</span>
        </span>
      ),
    },
    { key: 'rooms', header: 'Oda', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => row.rooms },
    {
      key: 'role',
      header: 'Rolünüz',
      render: (row) => (row.isCurrent ? <Badge tone="info">Açık otel · {ROLE_LABELS[row.myRole]}</Badge> : row.myRole ? <Badge tone="success">{ROLE_LABELS[row.myRole] ?? row.myRole}</Badge> : <Badge tone="neutral">Erişiminiz yok</Badge>),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input label="Ara" name="chain-hotel-search" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Otel adı ya da kodu" className="w-full max-w-xs" />
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="link" onClick={() => setAttaching(true)}>Var olan oteli ekle</Button>
            <Button icon="plus" onClick={() => setCreating(true)} disabled={sources.length === 0 || overview.group.hotelCount >= overview.limits.maxHotels}>Yeni otel</Button>
          </div>
        )}
      </div>
      {canManage && overview.group.hotelCount >= overview.limits.maxHotels && <Alert tone="warning">Zincir otel sınırına ({overview.limits.maxHotels}) ulaştı.</Alert>}

      <DataTable
        columns={columns}
        rows={list.isPending ? undefined : rows}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        emptyTitle={search ? 'Aramaya uyan otel yok' : 'Zincirde otel yok'}
        emptyHint={search ? 'Aramayı değiştirin.' : ''}
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            {row.myRole && !row.isCurrent && (
              <Button size="sm" variant="outline" icon="arrowRight" onClick={() => openHotel(row)} disabled={Boolean(switching)}>
                {switching === row.id ? 'Geçiliyor…' : 'Otele geç'}
              </Button>
            )}
            {canManage && row.myRole === 'ADMIN' && (
              <Button size="sm" variant="dangerSoft" icon="close" onClick={() => setDetaching(row)}>Zincirden çıkar</Button>
            )}
          </div>
        )}
      />
      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}</Button>
        </div>
      )}

      {creating && <NewHotelWizard sources={sources} defaultSourceId={overview.hotel.id} onClose={() => setCreating(false)} />}
      {attaching && <AttachHotelDialog groupName={overview.group.name} onClose={() => setAttaching(false)} />}
      <ConfirmDialog
        open={Boolean(detaching)}
        title="Oteli zincirden çıkar"
        message={detaching ? `${detaching.name} zincir panosundan, raporundan ve otel listesinden çıkar. Otelin verisi ve kişilerin otel erişimleri kalır; yeniden eklenebilir.` : ''}
        confirmLabel="Zincirden çıkar"
        confirmIcon="close"
        onConfirm={() => detach.mutate(detaching)}
        onClose={() => setDetaching(null)}
        isPending={detach.isPending}
        error={detach.error}
      />
    </div>
  );
}

/**
 * Yöneticisi olduğunuz ve zincirde olmayan bir oteli bu zincire ekler.
 * @param {{ groupName: string, onClose: () => void }} props
 */
function AttachHotelDialog({ groupName, onClose }) {
  const queryClient = useQueryClient();
  const [hotelId, setHotelId] = useState('');
  const mine = useQuery({ queryKey: chainKeys.myHotels(''), queryFn: () => api(withQuery('/auth/hotels', { limit: 100 })) });
  const candidates = (mine.data?.items ?? []).filter((hotel) => !hotel.groupId && hotel.role === 'ADMIN');

  const attach = useMutation({
    mutationFn: (id) => apiPost(`/chain/hotels/${id}/attach`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chainKeys.all });
      queryClient.invalidateQueries({ queryKey: ['auth', 'hotels'] });
      toastSuccess('Otel zincire eklendi');
      onClose();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title="Var olan oteli ekle"
      onClose={attach.isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={attach.isPending}>Vazgeç</Button>
          <Button icon="check" onClick={() => attach.mutate(hotelId)} disabled={!hotelId || attach.isPending}>{attach.isPending ? 'Ekleniyor…' : 'Zincire ekle'}</Button>
        </>
      }
    >
      {mine.isPending ? (
        <p className="text-sm text-ink-muted">Oteller yükleniyor…</p>
      ) : mine.isError ? (
        <Alert tone="danger" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => mine.refetch()}>Tekrar dene</Button>}>{mine.error.message}</Alert>
      ) : candidates.length === 0 ? (
        <Alert tone="info">Eklenebilecek otel yok: yöneticisi olduğunuz ve bir zincirde olmayan oteller burada listelenir.</Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Otel"
            name="attach-hotel"
            value={hotelId}
            onChange={(event) => setHotelId(event.target.value)}
            options={[{ value: '', label: 'Otel seçin' }, ...candidates.map((hotel) => ({ value: hotel.id, label: `${hotel.name} (${hotel.code})` }))]}
          />
          <p className="text-xs text-ink-muted">Eklenen otelin doluluk ve gelir rakamları {groupName} panosunda ve raporunda, zinciri görme yetkisi olanlara görünür.</p>
        </div>
      )}
    </Modal>
  );
}
