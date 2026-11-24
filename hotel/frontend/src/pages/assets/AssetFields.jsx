import { Button, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { locationOptions } from '../../lib/assets.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Demirbaş ekranlarının ortak parçaları (modül 46): form diyaloğu kabuğu, konum (oda ya da alan) ve personel
 * seçicileri, yetki özeti.
 */

/**
 * Kullanıcının demirbaş yetkileri (görsel; sunucu yine denetler).
 * @returns {{ view: boolean, count: boolean, manage: boolean, finance: boolean }}
 */
export function useAssetAccess() {
  const can = useCan();
  return {
    view: can(PERMISSIONS.ASSETS_VIEW),
    count: can(PERMISSIONS.ASSETS_COUNT),
    manage: can(PERMISSIONS.ASSETS_MANAGE),
    finance: can(PERMISSIONS.ASSETS_FINANCE),
  };
}

/**
 * Form diyaloğu: başlık, gövde (form), vazgeç / gönder.
 * @param {{ id: string, title: string, busy: boolean, onClose: () => void, submitLabel: string, icon?: string, variant?: 'primary' | 'danger', size?: 'sm' | 'md' | 'lg' | 'xl', onSubmit: (event: React.FormEvent) => void, children: React.ReactNode }} props
 */
export function AssetDialog({ id, title, busy, onClose, submitLabel, icon = 'check', variant = 'primary', size = 'sm', onSubmit, children }) {
  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={id} icon={icon} variant={variant} disabled={busy}>
            {busy ? 'İşleniyor…' : submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {children}
      </form>
    </Modal>
  );
}

/**
 * Konum seçici: alanlar ve odalar tek listede ("room:<id>" / "area:<id>").
 * @param {{ label?: string, value: string, onChange: (value: string) => void, options: any, error?: string, disabled?: boolean, placeholder?: string, name?: string }} props
 */
export function LocationSelect({ label = 'Konum', value, onChange, options, error, disabled = false, placeholder = 'Oda ya da alan seçin', name = 'asset-location' }) {
  return (
    <Select
      label={label}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[{ value: '', label: placeholder }, ...locationOptions(options)]}
      error={error}
      disabled={disabled}
    />
  );
}

/**
 * Personel seçici (bordro personel kartı; yalnız çalışanlar).
 * @param {{ label?: string, value: string, onChange: (value: string) => void, employees?: Array<{ id: string, code: string, name: string, departmentName?: string }>, error?: string, disabled?: boolean, placeholder?: string, name?: string }} props
 */
export function EmployeeSelect({ label = 'Personel', value, onChange, employees = [], error, disabled = false, placeholder = 'Personel seçin', name = 'asset-employee' }) {
  const options = employees.map((employee) => ({ value: employee.id, label: `${employee.name} · ${employee.code}${employee.departmentName ? ` · ${employee.departmentName}` : ''}` }));
  return <Select label={label} name={name} value={value} onChange={(event) => onChange(event.target.value)} options={[{ value: '', label: placeholder }, ...options]} error={error} disabled={disabled} />;
}

/**
 * Tanım–değer satırı (kart ayrıntıları).
 * @param {{ label: string, children: React.ReactNode }} props
 */
export function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}
