import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, resetPasswordSchema, updateUserSchema, userInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { apiPost } from '../../lib/api.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const EMPTY = { email: '', name: '', role: 'FRONT_DESK', password: '', isActive: true };

/** Kullanıcı yönetimi (modül 2). Ayarlar altındaki liste + form deseni. */
export function UsersTab() {
  const resource = useCrudResource({ basePath: '/users', queryKey: ['users'], labels: { singular: 'Kullanıcı' } });
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);

  const columns = [
    { key: 'name', header: 'Ad', className: 'font-semibold' },
    { key: 'email', header: 'E-posta', render: (row) => <span className="text-ink-soft">{row.email}</span> },
    { key: 'role', header: 'Rol', render: (row) => ROLE_LABELS[row.role] ?? row.role },
    {
      key: 'isActive',
      header: 'Durum',
      render: (row) =>
        row.isActive ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Pasif</Badge>,
    },
  ];

  const toggleActive = (row) =>
    resource.updateMutation.mutate({
      id: row.id,
      values: {
        email: row.email,
        name: row.name,
        role: row.role,
        isActive: !row.isActive,
        expectedUpdatedAt: row.updatedAt,
      },
    });

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)}>
            Yeni kullanıcı
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Ad veya e-postaya göre ara…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-80"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={resource.search ? 'Aramanızla eşleşen kullanıcı yok' : 'Henüz kullanıcı yok'}
        emptyHint="Personelin panele girebilmesi için hesap açın."
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>
              Düzenle
            </Button>
            <Button variant="outline" size="sm" icon="lock" onClick={() => setResetting(row)}>
              Şifre
            </Button>
            <Button
              variant={row.isActive ? 'dangerSoft' : 'outline'}
              size="sm"
              disabled={resource.updateMutation.isPending}
              onClick={() => toggleActive(row)}
            >
              {row.isActive ? 'Pasife al' : 'Aktifleştir'}
            </Button>
          </div>
        )}
      />

      {editing && (
        <UserFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          isPending={resource.createMutation.isPending || resource.updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const mutation = editing.id ? resource.updateMutation : resource.createMutation;
            const payload = editing.id ? { id: editing.id, values } : values;
            mutation.mutate(payload, { onSuccess: () => setEditing(null) });
          }}
        />
      )}

      {resetting && <PasswordResetModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserFormModal({ initial, onSubmit, onClose, isPending }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    email: initial.email ?? '',
    name: initial.name ?? '',
    role: initial.role ?? 'FRONT_DESK',
    password: '',
    isActive: initial.isActive ?? true,
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    // Düzenlemede şifre yok; ayrı "Şifre" aksiyonu var. expectedUpdatedAt
    // optimistic lock için forma girilmeden eklenir.
    const result = isEdit
      ? validateWith(updateUserSchema, {
          email: form.email,
          name: form.name,
          role: form.role,
          isActive: form.isActive,
          expectedUpdatedAt: initial.updatedAt,
        })
      : validateWith(userInputSchema, {
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password,
          isActive: form.isActive,
        });

    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  return (
    <Modal
      open
      title={isEdit ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="user-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input label="Ad" name="name" value={form.name} onChange={setField('name')} error={errors.name} />
        <Input
          label="E-posta"
          name="email"
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={setField('email')}
          error={errors.email}
        />
        <Select label="Rol" name="role" value={form.role} onChange={setField('role')} options={ROLE_OPTIONS} error={errors.role} />
        {isEdit ? (
          <div className="flex items-end pb-1">
            <Checkbox
              name="isActive"
              label="Aktif"
              hint="Pasif kullanıcı giriş yapamaz."
              checked={form.isActive}
              onChange={setField('isActive')}
            />
          </div>
        ) : (
          <Input
            label="Şifre"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={setField('password')}
            error={errors.password}
            placeholder="En az 8 karakter"
          />
        )}
      </form>
    </Modal>
  );
}

function PasswordResetModal({ user, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (value) => apiPost(`/users/${user.id}/reset-password`, { password: value }),
    onSuccess: () => {
      toastSuccess('Şifre güncellendi; kullanıcının açık oturumları kapatıldı.');
      onClose();
    },
    onError: (mutationError) => {
      setError(mutationError.message);
      toastError(mutationError.message);
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(resetPasswordSchema, { password });
    if (!result.ok) {
      setError(result.errors.password ?? 'Geçersiz şifre');
      return;
    }
    setError('');
    mutation.mutate(result.data.password);
  }

  return (
    <Modal
      open
      title={`Şifre sıfırla — ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="reset-password-form" icon="check" disabled={mutation.isPending}>
            {mutation.isPending ? 'Kaydediliyor…' : 'Şifreyi güncelle'}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit}>
        <Input
          label="Yeni şifre"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
          error={error}
          placeholder="En az 8 karakter"
        />
      </form>
      <Alert tone="info" className="mt-4">
        Şifre değişince kullanıcının açık oturumları kapanır; yeni şifreyle tekrar giriş yapar.
      </Alert>
    </Modal>
  );
}
