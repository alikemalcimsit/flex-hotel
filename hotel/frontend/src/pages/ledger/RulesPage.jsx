import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JOURNAL_RULE_SOURCES, journalRulesSchema } from '@hotelos/hotel-contracts';
import { Alert, Button } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { buildRuleRows, ruleRowsToRequest } from '../../lib/ledgerRules.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { RuleSourceCard } from './RuleSourceCard.jsx';

/**
 * Otomatik fiş kuralları (modül 48): kaynak gruplarına göre kartlar; her satır anahtar (sabit etiket, kasa / banka
 * adı, departman, oran, cari) → hesap. Seed varsayılanı "varsayılan" rozetiyle görünür; otel kuralı kaldırılınca
 * varsayılana döner. Tek "Kaydet" (`ledger.setup`) bütün satırları gönderir; `ledger.view` yalnız görür.
 */
export function RulesPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canSetup = can(PERMISSIONS.LEDGER_SETUP);
  const query = useQuery({ queryKey: ledgerKeys.rules, queryFn: () => api('/ledger/rules') });
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const data = query.data;

  // Sunucu verisi gelince (ya da canlı tazelenince, ekranda değişiklik yokken) satırlar yeniden kurulur.
  useEffect(() => {
    if (!data || dirty) return;
    setRows(buildRuleRows(data.rules, data));
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: (body) => apiPut('/ledger/rules', body),
    onSuccess: (result) => {
      queryClient.setQueryData(ledgerKeys.rules, result);
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      setDirty(false);
      setRows(buildRuleRows(result.rules, result));
      toastSuccess('Kurallar kaydedildi; yeni fişler bu hesaplara yazılır');
    },
    onError: (error) => {
      if (error.fields) setErrors(mapServerErrors(error.fields, rows));
      toastError(error.message);
    },
  });

  const change = (uid, patch) => {
    setDirty(true);
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  };
  const add = (row) => {
    setDirty(true);
    setRows((current) => [...current, row]);
  };
  const remove = (uid) => {
    setDirty(true);
    setRows((current) => current.filter((row) => row.uid !== uid));
  };
  function reset() {
    setDirty(false);
    setErrors({});
    if (data) setRows(buildRuleRows(data.rules, data));
  }
  function submit() {
    const requestRows = ruleRowsToRequest(rows);
    const checked = validateWith(journalRulesSchema, { rows: requestRows });
    if (!checked.ok) {
      setErrors(mapRequestErrors(checked.errors, requestRows));
      return toastError('Kurallar kaydedilmedi; işaretli satırları düzeltin.');
    }
    setErrors({});
    save.mutate({ rows: requestRows });
  }

  const bySource = useMemo(
    () =>
      rows.reduce((groups, row) => {
        const list = groups[row.source] ?? [];
        return { ...groups, [row.source]: [...list, row] };
      }, {}),
    [rows],
  );
  const pendingKeys = rows.filter((row) => row.isCustomKey && !row.account).length;
  if (!data) return <QueryFallback query={query} errorTitle="Kurallar yüklenemedi" />;

  return (
    <div className="flex flex-col gap-4">
      {canSetup && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-card">
          <p className="text-sm text-ink-soft">
            {dirty ? 'Kaydedilmemiş değişiklik var.' : 'Kural değiştirince yalnız yeni fişler etkilenir; yazılmış fiş değişmez.'}
            {pendingKeys > 0 ? ` Hesabı seçilmemiş ${pendingKeys} yeni satır gönderilmez.` : ''}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={!dirty || save.isPending}>
              Geri al
            </Button>
            <Button type="button" icon="check" onClick={submit} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      )}
      {errors._ && <Alert tone="danger">{errors._}</Alert>}
      {JOURNAL_RULE_SOURCES.map((source) => (
        <RuleSourceCard key={source} source={source} rows={bySource[source] ?? []} allRows={rows} canSetup={canSetup} errors={errors} onChange={change} onAdd={add} onRemove={remove} />
      ))}
    </div>
  );
}

/**
 * Şema hataları `rows.<index>.<alan>` yolundadır; ekran satır `uid`'siyle gösterir. Gönderilen satır sırası
 * `ruleRowsToRequest` sırasıdır (kaynak + anahtar eşlemesiyle uid bulunur).
 * @param {Record<string, string>} fieldErrors
 * @param {Array<{ source: string, key: string }>} requestRows
 */
function mapRequestErrors(fieldErrors, requestRows) {
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([path, message]) => {
      const match = /^rows\.(\d+)/.exec(path);
      const row = match ? requestRows[Number(match[1])] : null;
      return [row ? `${row.source}|${row.key}` : '_', message];
    }),
  );
}

/**
 * Sunucu alan hataları da aynı yolla gelir; ekran satırı kaynak + anahtarla bulunur (eklenen satırların uid'si
 * farklı olduğu için kaynak + anahtardan uid'ye çevrilir).
 * @param {Record<string, string>} fieldErrors
 * @param {Array<{ uid: string, source: string, key: string }>} rows
 */
function mapServerErrors(fieldErrors, rows) {
  const request = ruleRowsToRequest(rows);
  const mapped = mapRequestErrors(fieldErrors, request);
  return Object.fromEntries(
    Object.entries(mapped).map(([id, message]) => {
      const [source, key] = id.split('|');
      const row = rows.find((candidate) => candidate.source === source && candidate.key === key);
      return [row?.uid ?? id, message];
    }),
  );
}
