import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMPLOYEE_DOCUMENT_TYPES, EMPLOYEE_DOCUMENT_TYPE_LABELS, HR_DEFAULTS, HR_PAGE_SIZE } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiDelete, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { expiryTone, hrKeys, openHrDocument } from '../../lib/hr.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { toastSuccess } from '../../store/toast.js';
import { DocumentDialog } from './DocumentDialog.jsx';
import { EmployeeField } from './EmployeeField.jsx';

const TYPE_OPTIONS = [{ value: '', label: 'Hepsi' }, ...EMPLOYEE_DOCUMENT_TYPES.map((value) => ({ value, label: EMPLOYEE_DOCUMENT_TYPE_LABELS[value] }))];
/** Dolmaya yakın eşiği (sarı rozet): ayardan bağımsız 30 gün. */
const SOON_DAYS = 30;

/** @param {number | null} bytes */
const sizeText = (bytes) => (bytes === null || bytes === undefined ? '' : bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/**
 * Özlük belgeleri (modül 52): tüm belgeler ya da süresi dolacaklar (ayardaki hatırlatma günü; `?expiring=1` ile
 * açılış), personel (`?employeeId=`), tür ve arama süzgeci. Satırda bitişe kalan gün rozeti (dolmuş kırmızı, 30 gün
 * içinde sarı), dosyayı yeni sekmede açma ve silme (`hr.manage`); "Belge ekle".
 */
export function DocumentsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get('employeeId') ?? '';
  const expiring = params.get('expiring') === '1';
  const [employee, setEmployee] = useState(null);
  const [type, setType] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  useEffect(() => setPage(1), [employeeId, expiring, type, search]);

  const settings = useQuery({ queryKey: hrKeys.settings, queryFn: () => api('/hr/settings'), staleTime: 60_000, retry: false });
  const reminderDays = settings.data?.settings.documentReminderDays ?? HR_DEFAULTS.documentReminderDays;
  const filters = { employeeId: employeeId || undefined, type: type || undefined, search: search || undefined, expiringWithin: expiring ? reminderDays : undefined, page, pageSize: HR_PAGE_SIZE };
  const list = useQuery({ queryKey: hrKeys.documents(filters), queryFn: () => api(withQuery('/hr/documents', filters)), placeholderData: keepPreviousData });
  const expiringCount = useQuery({ queryKey: hrKeys.documents({ expiringWithin: reminderDays, count: true }), queryFn: () => api(withQuery('/hr/documents', { expiringWithin: reminderDays, page: 1, pageSize: 1 })) });
  const pinnedEmployee = employeeId ? (employee?.id === employeeId ? employee : list.data?.items?.[0]?.employee ?? { id: employeeId, name: 'Seçili personel' }) : null;

  const remove = useMutation({
    mutationFn: (id) => apiDelete(`/hr/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toastSuccess('Belge silindi');
      setDialog(null);
    },
  });

  const setFilter = (next) => {
    const merged = { ...Object.fromEntries(params), ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
  };

  const columns = [
    {
      key: 'employee',
      header: 'Personel',
      render: (row) => (
        <Link to={`/personel/${row.employee.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.employee.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.employee.code}
            {row.employee.department ? ` · ${row.employee.department.name}` : ''}
          </span>
        </Link>
      ),
    },
    { key: 'type', header: 'Tür', render: (row) => row.typeLabel },
    {
      key: 'title',
      header: 'Belge',
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-ink">{row.title}</span>
          {row.note && <span className="block max-w-xs truncate text-xs text-ink-muted">{row.note}</span>}
        </span>
      ),
    },
    { key: 'issued', header: 'Düzenleme', className: 'whitespace-nowrap', render: (row) => formatDate(row.issuedOn) },
    {
      key: 'expires',
      header: 'Bitiş',
      className: 'whitespace-nowrap',
      render: (row) =>
        row.expiresOn ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{formatDate(row.expiresOn)}</span>
            <Badge tone={expiryTone(row.daysLeft, SOON_DAYS)}>{row.expired ? `${Math.abs(row.daysLeft)} gün geçti` : row.daysLeft === 0 ? 'Bugün' : `${row.daysLeft} gün`}</Badge>
          </span>
        ) : (
          <span className="text-ink-muted">Süresiz</span>
        ),
    },
    {
      key: 'file',
      header: 'Dosya',
      render: (row) =>
        row.hasFile ? (
          <button type="button" className="block max-w-[12rem] text-left hover:underline" onClick={() => openHrDocument(row.id)}>
            <span className="block truncate text-sm text-ink">{row.fileName}</span>
            <span className="block text-xs text-ink-muted">{sizeText(row.size)}</span>
          </button>
        ) : (
          <span className="text-xs text-ink-muted">Yalnız kayıt</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryTile label="Tüm belgeler" value={expiring ? undefined : list.data?.meta?.total} hint="Özlük dosyasındaki bütün belge kayıtları" icon="fileText" selected={!expiring} onClick={() => setFilter({ expiring: null })} />
        <SummaryTile label="Süresi dolacaklar" value={expiringCount.data?.meta?.total} hint={`${reminderDays} gün içinde dolacak ya da dolmuş`} icon="alertTriangle" tone={expiringCount.data?.meta?.total ? 'warning' : 'neutral'} selected={expiring} onClick={() => setFilter({ expiring: '1' })} />
      </div>
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setDialog({ kind: 'add' })}>
              Belge ekle
            </Button>
          )
        }
      >
        <EmployeeField
          value={pinnedEmployee}
          onChange={(next) => {
            setEmployee(next);
            setFilter({ employeeId: next?.id ?? null });
          }}
          compact
          className="w-full sm:w-64"
        />
        <Select label="Tür" name="document-type-filter" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-56" />
        <Input label="Ara" name="document-search" placeholder="Belge adı ya da personel" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-52" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={expiring ? 'Süresi dolacak belge yok' : 'Belge yok'}
        emptyHint={expiring ? `${reminderDays} gün içinde süresi dolan belge bulunmuyor.` : 'Personel kartına kimlik, sözleşme, sağlık raporu gibi belgeleri ekleyin.'}
        rowActions={(row) => (
          <span className="inline-flex justify-end gap-1">
            {row.hasFile && (
              <Button type="button" size="sm" variant="ghost" icon="eye" onClick={() => openHrDocument(row.id)}>
                Aç
              </Button>
            )}
            {canManage && (
              <Button type="button" size="sm" variant="ghost" icon="trash" aria-label="Belgeyi sil" onClick={() => setDialog({ kind: 'delete', document: row })} />
            )}
          </span>
        )}
      />
      {dialog?.kind === 'add' && <DocumentDialog employee={pinnedEmployee?.code ? pinnedEmployee : null} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title="Belgeyi sil"
        message={dialog?.kind === 'delete' ? `"${dialog.document.title}" (${dialog.document.employee.name}) silinir; dosya diskten kalkar, kayıt izi kalır.` : ''}
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(dialog.document.id)}
        onClose={() => {
          remove.reset();
          setDialog(null);
        }}
      />
    </div>
  );
}
