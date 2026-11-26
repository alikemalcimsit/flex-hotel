import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, ROLES, ROLE_LABELS, chainUserCreateSchema, membershipChangeError } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { chainKeys } from '../../lib/chain.js';
import { validateWith } from '../../lib/validate.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/**
 * Merkezi kullanıcı yönetimi (modül 63): zincirin bütün otellerindeki kişiler ve zincirdeki otel erişimleri. Erişim
 * verme / rol değiştirme / kaldırma hedef oteldeki yetkinize bağlıdır (o otelde kullanıcı yönetme izni; yönetici rolü
 * için o otelde yöneticilik). Kendi erişiminizi değiştiremezsiniz.
 */
export function ChainUsersTab() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = { search, hotelId };
  const list = useInfiniteQuery({
    queryKey: chainKeys.users(filters),
    queryFn: ({ pageParam }) => api(withQuery('/chain/users', { search: search || undefined, hotelId: hotelId || undefined, cursor: pageParam || undefined, limit: PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (previous) => previous,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hotels = list.data?.pages[0]?.hotels ?? [];
  const canCreateSomewhere = hotels.some((hotel) => hotel.canManageUsers);

  const columns = [
    {
      key: 'name',
      header: 'Kişi',
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-ink">{row.name}{!row.isActive && <Badge tone="neutral" className="ml-2">Pasif</Badge>}</span>
          <span className="block truncate text-xs text-ink-muted">{row.email}</span>
        </div>
      ),
    },
    {
      key: 'home',
      header: 'Ana otel',
      render: (row) => (row.home.hotelId ? <span className="text-sm">{row.home.name}<span className="block text-xs text-ink-muted">{ROLE_LABELS[row.home.role]}</span></span> : <span className="text-xs text-ink-muted">Zincir dışı</span>),
    },
    {
      key: 'memberships',
      header: 'Zincirdeki erişimleri',
      render: (row) =>
        row.memberships.length === 0 ? (
          <span className="text-xs text-ink-muted">Yok</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.memberships.map((membership) => (
              <Badge key={membership.hotelId} tone="info" dot={false}>{membership.code} · {ROLE_LABELS[membership.role]}</Badge>
            ))}
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Ara" name="chain-user-search" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Ad ya da e-posta" className="w-64" />
          <Select
            label="Otel"
            name="chain-user-hotel"
            value={hotelId}
            onChange={(event) => setHotelId(event.target.value)}
            options={[{ value: '', label: 'Bütün oteller' }, ...hotels.map((hotel) => ({ value: hotel.id, label: `${hotel.name} (${hotel.code})` }))]}
            className="w-64"
          />
        </div>
        {canCreateSomewhere && <Button icon="plus" onClick={() => setCreating(true)}>Yeni kullanıcı</Button>}
      </div>

      <DataTable
        columns={columns}
        rows={list.isPending ? undefined : rows}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        emptyTitle={search || hotelId ? 'Süzgece uyan kişi yok' : 'Zincirde kullanıcı yok'}
        emptyHint={search || hotelId ? 'Aramayı ya da oteli değiştirin.' : ''}
        rowActions={(row) => <Button size="sm" variant="outline" icon="key" onClick={() => setEditing(row.id)}>Otel erişimleri</Button>}
      />
      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}</Button>
        </div>
      )}

      {editing && <MembershipDialog userId={editing} hotels={hotels} onClose={() => setEditing(null)} />}
      {creating && <CreateUserDialog hotels={hotels.filter((hotel) => hotel.canManageUsers)} onClose={() => setCreating(false)} />}
    </div>
  );
}

/**
 * Bir kişinin zincirdeki otel erişimleri: her otelde ana otel / erişim rolü / yok; yetkiniz olan otelde rol verip
 * kaldırırsınız.
 * @param {{ userId: string, hotels: Array<{ id: string, name: string, code: string, myRole: string | null, canManageUsers: boolean }>, onClose: () => void }} props
 */
function MembershipDialog({ userId, hotels, onClose }) {
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.user);
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState(null);
  const user = useChainUser(userId);

  const save = useMutation({
    mutationFn: ({ hotelId, role }) => (role ? apiPut(`/chain/users/${userId}/hotels/${hotelId}`, { role }) : apiDelete(`/chain/users/${userId}/hotels/${hotelId}`)),
    onMutate: ({ hotelId }) => setPending(hotelId),
    onSuccess: (data, { hotelId, role }) => {
      queryClient.setQueryData(chainKeys.user(userId), role ? data.user : data);
      queryClient.invalidateQueries({ queryKey: ['chain', 'users'] });
      setDrafts((current) => ({ ...current, [hotelId]: undefined }));
      toastSuccess(role ? 'Erişim kaydedildi' : 'Erişim kaldırıldı');
    },
    onError: (error) => toastError(error.message),
    onSettled: () => setPending(null),
  });

  const data = user.data;
  return (
    <Modal open title={data ? `${data.name} · otel erişimleri` : 'Otel erişimleri'} onClose={save.isPending ? () => {} : onClose} footer={<Button variant="outline" onClick={onClose} disabled={save.isPending}>Kapat</Button>}>
      {user.isPending ? (
        <p className="text-sm text-ink-muted">Yükleniyor…</p>
      ) : user.isError ? (
        <Alert tone="danger" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => user.refetch()}>Tekrar dene</Button>}>{user.error.message}</Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">{data.email}. Ana oteldeki rol kullanıcılar ekranından değişir; burada zincirdeki diğer otellere erişim verilir.</p>
          <ul className="divide-y divide-line rounded-card border border-line">
            {hotels.map((hotel) => {
              const isHome = data.home.hotelId === hotel.id;
              const membership = data.memberships.find((row) => row.hotelId === hotel.id);
              const draft = drafts[hotel.id] ?? membership?.role ?? '';
              const rule = (nextRole) =>
                membershipChangeError({
                  actorId: me?.id,
                  actorRole: hotel.myRole,
                  actorPermissions: hotel.canManageUsers ? [PERMISSIONS.USERS_MANAGE] : [],
                  targetUserId: data.id,
                  targetHomeHotelId: data.home.hotelId,
                  hotelId: hotel.id,
                  currentRole: membership?.role ?? null,
                  nextRole,
                });
              const blocked = rule(draft || null);
              const options = ROLE_OPTIONS.filter((option) => option.value !== 'ADMIN' || hotel.myRole === 'ADMIN' || membership?.role === 'ADMIN');
              return (
                <li key={hotel.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{hotel.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {hotel.code} · {isHome ? `ana otel · ${ROLE_LABELS[data.home.role]}` : membership ? `erişim · ${ROLE_LABELS[membership.role]}` : 'erişim yok'}
                    </span>
                  </div>
                  {!isHome && !rule(membership?.role ?? 'FRONT_DESK') && (
                    <div className="flex items-end gap-2">
                      <Select compact name={`role-${hotel.id}`} aria-label={`${hotel.name} rolü`} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [hotel.id]: event.target.value }))} options={[{ value: '', label: 'Rol seçin' }, ...options]} disabled={save.isPending} />
                      <Button size="sm" icon="check" onClick={() => save.mutate({ hotelId: hotel.id, role: draft })} disabled={!draft || draft === membership?.role || Boolean(blocked) || save.isPending}>
                        {pending === hotel.id && save.variables?.role ? 'Kaydediliyor…' : membership ? 'Değiştir' : 'Erişim ver'}
                      </Button>
                      {membership && !rule(null) && (
                        <Button size="sm" variant="dangerSoft" icon="trash" onClick={() => save.mutate({ hotelId: hotel.id, role: null })} disabled={save.isPending}>
                          {pending === hotel.id && !save.variables?.role ? 'Kaldırılıyor…' : 'Kaldır'}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {me?.id === data.id && <Alert tone="info">Kendi erişiminizi değiştiremezsiniz; başka bir yöneticiden isteyin.</Alert>}
        </div>
      )}
    </Modal>
  );
}

/** Tek kişinin ayrıntısı (listeden açılır; değişiklikten sonra cevapla güncellenir). */
function useChainUser(userId) {
  return useQuery({ queryKey: chainKeys.user(userId), queryFn: () => api(`/chain/users/${userId}`) });
}

/**
 * Zincirden yeni kullanıcı: ana oteli seçilir (orada kullanıcı yönetme yetkiniz olan oteller).
 * @param {{ hotels: Array<{ id: string, name: string, code: string, myRole: string | null }>, onClose: () => void }} props
 */
function CreateUserDialog({ hotels, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ homeHotelId: hotels[0]?.id ?? '', name: '', email: '', role: 'FRONT_DESK', password: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const home = hotels.find((hotel) => hotel.id === values.homeHotelId);
  const roleOptions = ROLE_OPTIONS.filter((option) => option.value !== 'ADMIN' || home?.myRole === 'ADMIN');

  const create = useMutation({
    mutationFn: (payload) => apiPost('/chain/users', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chain', 'users'] });
      toastSuccess('Kullanıcı açıldı');
      onClose();
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      else if (error.code === 'DUPLICATE') setErrors({ email: error.message });
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(chainUserCreateSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data);
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      title="Yeni kullanıcı"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="chain-user-form" icon="check" disabled={busy}>{busy ? 'Açılıyor…' : 'Kullanıcıyı aç'}</Button>
        </>
      }
    >
      <form id="chain-user-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select label="Ana otel" name="chain-user-home" value={values.homeHotelId} onChange={set('homeHotelId')} options={hotels.map((hotel) => ({ value: hotel.id, label: `${hotel.name} (${hotel.code})` }))} error={errors.homeHotelId} disabled={busy} />
        <Input label="Ad soyad" name="chain-user-name" value={values.name} onChange={set('name')} error={errors.name} maxLength={200} disabled={busy} required />
        <Input label="E-posta" name="chain-user-email" type="email" value={values.email} onChange={set('email')} error={errors.email} maxLength={200} disabled={busy} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Ana oteldeki rol" name="chain-user-role" value={values.role} onChange={set('role')} options={roleOptions} error={errors.role} disabled={busy} />
          <Input label="Geçici şifre" name="chain-user-password" type="password" autoComplete="new-password" value={values.password} onChange={set('password')} error={errors.password} disabled={busy} required />
        </div>
        <p className="text-xs text-ink-muted">Kişi bu şifreyle girer; diğer otellere erişimi açıldıktan sonra "Otel erişimleri"nden verilir.</p>
      </form>
    </Modal>
  );
}
