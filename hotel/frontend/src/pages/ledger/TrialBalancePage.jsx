import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GL_DEPARTMENTS, GL_DEPARTMENT_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Checkbox, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { Toolbar } from '../../components/Toolbar.jsx';
import { monthStart } from '../../lib/accounting.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { closingSides, onlyActiveRows, parentIdsOf, signedBalanceText, toggleCollapsed, visibleTreeRows } from '../../lib/ledgerTree.js';
import { useHotelToday } from '../../lib/useHotel.js';

const DEPARTMENT_OPTIONS = [{ value: '', label: 'Bütün departmanlar' }, ...GL_DEPARTMENTS.map((value) => ({ value, label: GL_DEPARTMENT_LABELS[value] }))];
const INDENT_REM = 1.1;

/**
 * Mizan (modül 48): dönemdeki hesap toplamları ağaç görünümünde — devir, borç, alacak, borç / alacak kalanı;
 * üst hesaplar çocuklarının toplamı, daraltılabilir. "Yalnız hareketliler" varsayılan açık. Dip toplam, denge
 * rozeti ve fişlenmemiş hareket uyarısı; hesap satırı dönemi koruyarak ekstreye gider.
 */
export function TrialBalancePage() {
  const { today } = useHotelToday();
  const [period, setPeriod] = useState(() => ({ from: monthStart(today), to: today }));
  const [onlyActive, setOnlyActive] = useState(true);
  const [department, setDepartment] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const filters = { ...period, onlyActive: onlyActive || undefined, department: department || undefined };
  const query = useQuery({
    queryKey: ledgerKeys.trialBalance(filters),
    queryFn: () => api(withQuery('/ledger/trial-balance', filters)),
    enabled: Boolean(period.from && period.to && period.from <= period.to),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return visibleTreeRows(onlyActive ? onlyActiveRows(all) : all, collapsed);
  }, [data, onlyActive, collapsed]);
  const parents = useMemo(() => parentIdsOf(data?.rows ?? []), [data]);
  const currency = data?.currency ?? '';
  const periodQuery = `?from=${period.from}&to=${period.to}`;
  const unposted = (data?.unposted?.ledgerEntries ?? 0) + (data?.unposted?.treasuryMovements ?? 0);
  const money = (value) => (Number(value) ? formatMoney(value) : '');

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          data && (
            <Badge tone={data.balanced ? 'success' : 'danger'}>{data.balanced ? 'Mizan dengeli' : 'Mizan dengesiz'}</Badge>
          )
        }
      >
        <Input label="Başlangıç" type="date" value={period.from} max={period.to} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-40" />
        <Input label="Bitiş" type="date" value={period.to} min={period.from} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-40" />
        <Select label="Departman" options={DEPARTMENT_OPTIONS} value={department} onChange={(event) => setDepartment(event.target.value)} className="w-full sm:w-52" />
        <Checkbox label="Yalnız hareketliler" name="trial-only-active" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} className="pb-2.5" />
      </Toolbar>

      {unposted > 0 && (
        <Alert tone="warning" title="Fişlenmemiş hareket var">
          {data.unposted.ledgerEntries} cari ve {data.unposted.treasuryMovements} kasa / banka hareketi henüz yevmiyeye yazılmadı; mizan bunları içermez.{' '}
          <Link to="/genel-muhasebe/ayarlar" className="font-semibold hover:underline">
            Ayarlar → Eşitle
          </Link>
        </Alert>
      )}

      {query.isPending ? (
        <Spinner className="py-8" />
      ) : query.isError ? (
        <Alert tone="danger" title="Mizan yüklenemedi">
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
                  <th className="whitespace-nowrap px-5 py-3.5 text-right font-bold">Devir</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right font-bold">Borç</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right font-bold">Alacak</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right font-bold">Borç kalanı</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right font-bold">Alacak kalanı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-ink-muted">
                      {onlyActive ? 'Bu dönemde hareket gören hesap yok.' : 'Hesap planı boş; Ayarlar sayfasından Tek Düzen hesaplarını yükleyin.'}
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const sides = closingSides(row.closing);
                  const isParent = parents.has(row.id);
                  return (
                    <tr key={row.id} className={`transition-colors hover:bg-surface-muted ${row.isPostable ? '' : 'font-semibold'}`}>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                        <span className="inline-flex items-center gap-1" style={{ paddingLeft: `${row.depth * INDENT_REM}rem` }}>
                          {isParent ? (
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
                        <Link to={`/genel-muhasebe/hesaplar/${row.id}${periodQuery}`} className="hover:underline">
                          {row.name}
                        </Link>
                        {row.department && <span className="ml-2 text-xs font-normal text-ink-muted">{GL_DEPARTMENT_LABELS[row.department]}</span>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{signedBalanceText(row.opening, (value) => formatMoney(value))}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{money(row.debit)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{money(row.credit)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{money(sides.debit)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{money(sides.credit)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {data && (
                <tfoot className="border-t-2 border-line-strong font-semibold">
                  <tr>
                    <td className="px-5 py-3" colSpan={2}>
                      Toplam · {formatDate(data.from)} – {formatDate(data.to)}
                      {currency ? ` · ${currency}` : ''}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{signedBalanceText(data.totals.opening, (value) => formatMoney(value))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{formatMoney(data.totals.debit)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{formatMoney(data.totals.credit)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{money(closingSides(data.totals.closing).debit)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{money(closingSides(data.totals.closing).credit)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
