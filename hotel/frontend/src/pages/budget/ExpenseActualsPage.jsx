import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUDGET_MONTH_LABELS, BUDGET_MONTHS, saveExpenseActualsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, apiPut } from '../../lib/api.js';
import { budgetKeys, cellText, parseCell, useBudgetLive } from '../../lib/budget.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { QueryError } from '../activity/shared.jsx';
import { BudgetTabs, YearPicker, useBudgetYearParam } from './BudgetTabs.jsx';

const SHORT_MONTHS = BUDGET_MONTH_LABELS.map((label) => label.slice(0, 3));

/**
 * Gerçekleşen giderler (modül 27): gider kalemlerinin ay ay gerçekleşeni elle
 * girilir (satın alma ve ön muhasebe — modül 45 / 47 — gelince oradan gelir).
 * Gelecek ay girilmez; hücre sürüm damgalıdır (iki kişi aynı hücreyi ezmez).
 */
export function ExpenseActualsPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const { year, setYear, currentYear } = useBudgetYearParam();
  useBudgetLive();
  const query = useQuery({ queryKey: budgetKeys.actuals(year), queryFn: () => api(`/budgets/${year}/actuals`) });
  const data = query.data;
  const editable = can(PERMISSIONS.BUDGET_MANAGE);

  const server = useMemo(() => {
    /** @type {Map<string, { text: string, updatedAt: string | null }>} */
    const cells = new Map();
    for (const entry of data?.entries ?? []) cells.set(`${entry.itemId}|${entry.month}`, { text: cellText(entry.amount), updatedAt: entry.updatedAt });
    return cells;
  }, [data]);
  const [texts, setTexts] = useState(new Map());
  const [errors, setErrors] = useState({});
  const changed = useMemo(
    () => [...texts.entries()].filter(([key, text]) => text !== (server.get(key)?.text ?? '')),
    [texts, server],
  );
  // Yalnızca hücrelerin sürümleri değişince baştan kurulur; kaydedilmemiş giriş varken gelen
  // canlı tazeleme girişleri silmez (kayıtta hücre sürümü uyuşmazsa sunucu söyler).
  const serverKey = [...server.entries()].map(([key, cell]) => `${key}@${cell.updatedAt}`).join(',') + `|${year}`;
  const dirtyRef = useRef(changed.length > 0);
  dirtyRef.current = changed.length > 0;
  const lastYear = useRef(year);
  // Kendi kaydımızdan sonraki ilk sürüm: hücreler sunucudan kurulur (biçim farkı "değişiklik" sayılmasın).
  const resetNext = useRef(false);
  useEffect(() => {
    const sameYear = lastYear.current === year;
    lastYear.current = year;
    if (dirtyRef.current && sameYear && !resetNext.current) return;
    resetNext.current = false;
    setTexts(new Map([...server.entries()].map(([key, cell]) => [key, cell.text])));
    setErrors({});
  }, [serverKey]);
  const save = useMutation({
    mutationFn: (body) => apiPut('/budgets/actuals', body),
    onSuccess: () => {
      resetNext.current = true;
      toastSuccess('Gerçekleşen giderler kaydedildi');
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: budgetKeys.actuals(year) });
    },
  });

  function submit() {
    const entries = changed.map(([key, text]) => {
      const [itemId, month] = key.split('|');
      return { itemId, month: Number(month), amount: parseCell(text), expectedUpdatedAt: server.get(key)?.updatedAt ?? null };
    });
    const checked = saveExpenseActualsSchema.safeParse({ year, entries });
    if (!checked.success) {
      const next = {};
      for (const issue of checked.error.issues) {
        const [, index] = issue.path;
        const entry = entries[index];
        if (entry) next[`${entry.itemId}|${entry.month}`] = issue.message;
      }
      setErrors(next);
      toastError('İşaretli hücreleri düzeltin.');
      return;
    }
    setErrors({});
    save.mutate(checked.data);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Gerçekleşen giderler"
        description="Gider kalemlerinin ay ay gerçekleşeni (vergiler hariç). Satın alma ve ön muhasebe modülleri gelince buraya otomatik gelecek; şimdilik elle girilir."
      />
      <BudgetTabs year={year} />
      <YearPicker year={year} currentYear={currentYear} onChange={setYear} />
      {query.isPending && <Spinner label="Gerçekleşenler yükleniyor…" className="py-12" />}
      {query.isError && <QueryError query={query} title="Gerçekleşenler yüklenemedi" />}
      {data && data.items.length === 0 && (
        <EmptyState icon="fileText" title="Gider kalemi yok" description="Gider kalemleri bütçe ekranında tanımlanır (ilk bütçe açılınca önerilenler eklenir)." />
      )}
      {data && data.items.length > 0 && (
        <Card
          title={`${year} gerçekleşen giderleri`}
          description={data.lastOpenMonth === 0 ? 'Bu yılın henüz gerçekleşeni girilemez (gelecek yıl).' : `${BUDGET_MONTH_LABELS[data.lastOpenMonth - 1]} ayına kadar girilebilir; sonraki aylar kapalı.`}
        >
          {Object.keys(errors).length > 0 && (
            <Alert tone="danger" title="Kaydedilemedi" className="mb-3">
              {Object.values(errors)[0]}
            </Alert>
          )}
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[64rem] border-collapse text-sm">
              <caption className="sr-only">Gerçekleşen giderler, kalem × ay</caption>
              <thead>
                <tr className="bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                  <th scope="col" className="sticky left-0 z-10 min-w-[14rem] bg-surface-muted px-3 py-2 font-bold">Kalem</th>
                  {SHORT_MONTHS.map((label, index) => (
                    <th key={label} scope="col" className="px-1.5 py-2 text-right font-bold" title={BUDGET_MONTH_LABELS[index]}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.item} className="border-t border-line/60">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-semibold text-ink">
                      {item.label}
                      {item.archived && <span className="ml-1 text-xs font-normal text-ink-muted">(kaldırıldı)</span>}
                    </th>
                    {Array.from({ length: BUDGET_MONTHS }, (_, index) => {
                      const month = index + 1;
                      const key = `${item.item}|${month}`;
                      const open = editable && month <= data.lastOpenMonth && !item.archived;
                      const error = errors[key];
                      return (
                        <td key={month} className="px-1 py-1 text-right">
                          {open ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={texts.get(key) ?? ''}
                              onChange={(event) => setTexts((current) => new Map(current).set(key, event.target.value))}
                              aria-label={`${item.label}, ${BUDGET_MONTH_LABELS[index]}`}
                              aria-invalid={error ? true : undefined}
                              title={error}
                              className={`w-[5.5rem] rounded-control border bg-surface px-2 py-1 text-right tabular-nums outline-none focus:border-ink ${error ? 'border-danger bg-danger-soft' : 'border-line'}`}
                            />
                          ) : (
                            <span className={`tabular-nums ${month > data.lastOpenMonth ? 'text-ink-muted' : ''}`}>{server.get(key)?.text || (month > data.lastOpenMonth ? '·' : '—')}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && data.lastOpenMonth > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {changed.length > 0 && <span className="text-sm text-warning-ink">{changed.length} hücre değişti</span>}
              <Button variant="ghost" onClick={() => setTexts(new Map([...server.entries()].map(([key, cell]) => [key, cell.text])))} disabled={!changed.length || save.isPending}>
                Vazgeç
              </Button>
              <Button icon="check" onClick={submit} disabled={!changed.length || save.isPending}>
                {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
