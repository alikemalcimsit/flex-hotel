import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSION_GROUPS, PERMISSION_LABELS, ROLES, ROLE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Spinner } from '@hotelos/ui';
import { api, apiPut } from '../../lib/api.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const ADMIN_ROLE = 'ADMIN';
const EDITABLE_ROLES = ROLES.filter((role) => role !== ADMIN_ROLE);

/** Sunucu grants dizisini `{ rol: Set(izin) }` haline getirir. */
function toState(grants) {
  const map = {};
  for (const role of ROLES) map[role] = new Set();
  for (const { role, permissions } of grants) map[role] = new Set(permissions);
  return map;
}

/**
 * Rol → izin matrisi (modül 2). Satır = rol, sütun = izin; izin başlıklarına
 * göre gruplanır. ADMIN satırı salt-okunur (her zaman tüm izinler).
 */
export function RolePermissionsTab() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['roles', 'permissions'], queryFn: () => api('/roles/permissions') });
  const [state, setState] = useState(null);

  useEffect(() => {
    if (query.data) setState(toState(query.data.grants));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (grants) => apiPut('/roles/permissions', { grants }),
    onSuccess: (data) => {
      toastSuccess('İzinler kaydedildi');
      setState(toState(data.grants));
      queryClient.invalidateQueries({ queryKey: ['roles', 'permissions'] });
    },
    onError: (error) => toastError(error.message),
  });

  if (query.isPending || !state) return <Spinner label="İzinler yükleniyor…" className="py-16" />;
  if (query.error) return <Alert tone="danger">İzinler yüklenemedi: {query.error.message}</Alert>;

  const has = (role, permission) => state[role]?.has(permission);

  const toggle = (role, permission) => {
    setState((current) => {
      const next = { ...current, [role]: new Set(current[role]) };
      if (next[role].has(permission)) next[role].delete(permission);
      else next[role].add(permission);
      return next;
    });
  };

  const save = () => {
    const grants = EDITABLE_ROLES.map((role) => ({ role, permissions: [...state[role]] }));
    mutation.mutate(grants);
  };

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        Yönetici (ADMIN) her zaman tüm izinlere sahiptir, buradan değiştirilemez. Kaydedilen değişiklik ilgili
        kullanıcılar için anında geçerli olur (yeniden giriş gerekmez).
      </Alert>

      {PERMISSION_GROUPS.map((group) => (
        <div key={group.key} className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-black/[0.02]">
                <th className="px-4 py-3 text-left font-bold text-ink">{group.label}</th>
                {group.permissions.map((permission) => (
                  <th key={permission} className="px-3 py-3 text-center text-xs font-semibold text-ink-soft">
                    {PERMISSION_LABELS[permission]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROLES.map((role) => {
                const readOnly = role === ADMIN_ROLE;
                return (
                  <tr key={role}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                      {ROLE_LABELS[role]}
                      {readOnly && (
                        <Badge tone="neutral" className="ml-2">
                          tümü
                        </Badge>
                      )}
                    </td>
                    {group.permissions.map((permission) => (
                      <td key={permission} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${ROLE_LABELS[role]} — ${PERMISSION_LABELS[permission]}`}
                          checked={readOnly ? true : Boolean(has(role, permission))}
                          disabled={readOnly}
                          onChange={() => toggle(role, permission)}
                          className="size-[18px] cursor-pointer accent-ink disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex justify-end">
        <Button icon="check" onClick={save} disabled={mutation.isPending}>
          {mutation.isPending ? 'Kaydediliyor…' : 'İzinleri kaydet'}
        </Button>
      </div>
    </div>
  );
}
