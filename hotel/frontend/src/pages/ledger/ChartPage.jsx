import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GL_ACCOUNT_CLASS_LABELS, GL_DEPARTMENT_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Spinner } from '@hotelos/ui';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { parentIdsOf, toggleCollapsed, visibleTreeRows } from '../../lib/ledgerTree.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { GlAccountDialog } from './GlAccountDialog.jsx';

const CLASS_TONES = Object.freeze({ ASSET: 'sky', LIABILITY: 'warning', EQUITY: 'violet', REVENUE: 'success', COST: 'neutral', EXPENSE: 'danger', OFF_BALANCE: 'neutral' });
const INDENT_REM = 1.1;

/**
 * Hesap planı (modül 48): Tek Düzen ağacı — daralt / genişlet, arama (aramada düz liste), sınıf rozeti, departman;
 * pasif hesap gri, sistem hesabı kilitli. "Hesap ekle" ve satırda düzenle (`ledger.setup`); "Tek Düzen'i tamamla"
 * eksik seed hesaplarını ve varsayılan kuralları yükler. Hesap adı ekstreye gider.
 */
export function ChartPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canSetup = can(PERMISSIONS.LEDGER_SETUP);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [onlyActive, setOnlyActive] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const filters = { search: search || undefined, onlyActive: onlyActive || undefined };
  const query = useQuery({ queryKey: ledgerKeys.chart(filters), queryFn: () => api(withQuery('/ledger/chart', filters)), placeholderData: keepPreviousData });
  const accounts = query.data?.accounts ?? [];
  const parents = useMemo(() => parentIdsOf(accounts), [accounts]);
  const rows = useMemo(() => (search ? accounts : visibleTreeRows(accounts, collapsed)), [accounts, collapsed, search]);
  const seed = useMutation({
    mutationFn: () => apiPost('/ledger/chart/seed', {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(`${result.created} hesap ve ${result.rules} kural eklendi`);
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canSetup && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" icon="plus" onClick={() => setDialog({ account: null })}>
                Hesap ekle
              </Button>
              <Button type="button" variant="outline" icon="download" onClick={() => seed.mutate()} disabled={seed.isPending}>
                {seed.isPending ? 'Yükleniyor…' : "Tek Düzen'i tamamla"}
              </Button>
            </div>
          )
        }
      >
        <Input label="Ara" name="chart-search" placeholder="Hesap kodu ya da adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Checkbox label="Yalnız etkin hesaplar" name="chart-only-active" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} className="pb-2.5" />
        {query.data && (
          <p className="pb-2.5 text-xs text-ink-muted">
            {accounts.length} hesap{query.data.seededAt ? ` · Tek Düzen ${formatDate(query.data.seededAt)} yüklendi` : ' · Tek Düzen henüz yüklenmedi'}
          </p>
        )}
      </Toolbar>

      {query.isPending ? (
        <Spinner className="py-8" />
      ) : query.isError ? (
        <Alert tone="danger" title="Hesap planı yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      ) : (
        <div className={`overflow-hidden rounded-card bg-surface shadow-card transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="whitespace-nowrap px-5 py-3.5 font-bold">Kod</th>
                  <th className="px-5 py-3.5 font-bold">Hesap</th>
                  <th className="px-5 py-3.5 font-bold">Sınıf</th>
                  <th className="px-5 py-3.5 font-bold">Departman</th>
                  {canSetup && <th className="px-5 py-3.5 text-right font-bold">İşlem</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={canSetup ? 5 : 4} className="px-5 py-10 text-center text-ink-muted">
                      {search ? 'Eşleşen hesap yok.' : "Hesap planı boş. \"Tek Düzen'i tamamla\" ile standart hesapları yükleyin."}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={`transition-colors hover:bg-surface-muted ${row.isActive ? '' : 'text-ink-muted'} ${row.isPostable ? '' : 'font-semibold'}`}>
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                      <span className="inline-flex items-center gap-1" style={{ paddingLeft: search ? 0 : `${row.depth * INDENT_REM}rem` }}>
                        {!search && parents.has(row.id) ? (
                          <button type="button" aria-label={collapsed.has(row.id) ? 'Genişlet' : 'Daralt'} aria-expanded={!collapsed.has(row.id)} onClick={() => setCollapsed((current) => toggleCollapsed(current, row.id))} className="grid size-5 place-items-center rounded text-ink-muted hover:bg-black/[0.06] hover:text-ink">
                            <Icon name={collapsed.has(row.id) ? 'chevronRight' : 'chevronDown'} className="size-3.5" />
                          </button>
                        ) : (
                          <span className="inline-block size-5" />
                        )}
                        {row.code}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Link to={`/genel-muhasebe/hesaplar/${row.id}`} className="hover:underline">
                          {row.name}
                        </Link>
                        {row.isSystem && <Icon name="lock" className="size-3.5 text-ink-muted" aria-label="Sistem hesabı" />}
                        {!row.isActive && <Badge tone="neutral">Pasif</Badge>}
                        {row.hasLines && <span className="text-xs font-normal text-ink-muted">hareketli</span>}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={CLASS_TONES[row.class] ?? 'neutral'}>{GL_ACCOUNT_CLASS_LABELS[row.class] ?? row.class}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-ink-soft">{row.department ? GL_DEPARTMENT_LABELS[row.department] : ''}</td>
                    {canSetup && (
                      <td className="whitespace-nowrap px-5 py-2.5 text-right">
                        <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setDialog({ account: row })}>
                          Düzenle
                        </Button>
                        {!row.hasLines && (
                          <Button type="button" size="sm" variant="ghost" icon="plus" onClick={() => setDialog({ account: null, parentCode: row.code })}>
                            Alt hesap
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {dialog && <GlAccountDialog account={dialog.account} parentCode={dialog.parentCode} accounts={accounts} onClose={() => setDialog(null)} />}
    </div>
  );
}
