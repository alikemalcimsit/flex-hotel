import { useState } from 'react';
import { JOURNAL_RULE_KEY_KINDS, JOURNAL_RULE_SOURCE_HINTS, JOURNAL_RULE_SOURCE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, Input } from '@hotelos/ui';
import { defaultCodeFor, hasRuleKey, newRuleRow } from '../../lib/ledgerRules.js';
import { LedgerAccountField } from '../accounting/LedgerAccountField.jsx';
import { GlAccountField } from './GlAccountField.jsx';

const RATE_PATTERN = /^\d{1,2}(\.\d{1,2})?$/;

/**
 * Tek kaynağın kural kartı (modül 48): anahtar etiketi, hesap seçici, "varsayılan" rozeti ve ipucu, sil
 * (varsayılana dön). Oran kaynağında "Oran ekle", cari kaynağında "Cari ekle" ile yeni satır açılır.
 *
 * @param {{
 *   source: string,
 *   rows: Array<any>,
 *   allRows: Array<any>,
 *   canSetup: boolean,
 *   errors: Record<string, string>,
 *   onChange: (uid: string, patch: object) => void,
 *   onAdd: (row: any) => void,
 *   onRemove: (uid: string) => void,
 * }} props `errors` anahtarı satırın `uid`'si
 */
export function RuleSourceCard({ source, rows, allRows, canSetup, errors, onChange, onAdd, onRemove }) {
  const kind = JOURNAL_RULE_KEY_KINDS[source].kind;
  const [rate, setRate] = useState('');
  const [rateError, setRateError] = useState('');

  function addRate() {
    const key = rate.trim().replace(',', '.');
    if (!RATE_PATTERN.test(key)) return setRateError('Oran "10" ya da "20" gibi yazılır');
    if (hasRuleKey(allRows, source, key)) return setRateError('Bu oran zaten listede');
    setRateError('');
    setRate('');
    onAdd(newRuleRow(source, key, `%${key}`));
  }
  function addLedgerAccount(account) {
    if (!account || hasRuleKey(allRows, source, account.id)) return;
    onAdd(newRuleRow(source, account.id, account.name));
  }

  return (
    <Card title={JOURNAL_RULE_SOURCE_LABELS[source]} description={JOURNAL_RULE_SOURCE_HINTS[source]}>
      <div className="flex flex-col divide-y divide-line">
        {rows.length === 0 && <p className="py-2 text-sm text-ink-muted">{kind === 'LEDGER_ACCOUNT' ? 'Cariye özel kural yok; cari türünün hesabı geçerli.' : kind === 'TREASURY' ? 'Kasa / banka hesabı yok.' : 'Satır yok.'}</p>}
        {rows.map((row) => {
          const defaultCode = defaultCodeFor(row.source, row.key);
          return (
            <div key={row.uid} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-12 sm:items-start">
              <div className="sm:col-span-4">
                <span className="block text-sm font-semibold text-ink">{row.keyLabel || 'Varsayılan'}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  {row.isDefault && row.account && <Badge tone="neutral">varsayılan</Badge>}
                  {defaultCode && <span>varsayılan: {defaultCode}</span>}
                  {!row.account && !defaultCode && <span className="font-semibold text-warning-ink">Hesap yok: bu kaynağın işi "Ön muhasebe" görevine düşer.</span>}
                </span>
              </div>
              <div className="sm:col-span-6">
                {canSetup ? (
                  <GlAccountField label="Hesap" value={row.account} onChange={(account) => onChange(row.uid, { account })} error={errors[row.uid]} compact />
                ) : (
                  <span className="text-sm text-ink-soft">{row.account ? `${row.account.code} · ${row.account.name}` : '—'}</span>
                )}
              </div>
              {canSetup && (
                <div className="flex justify-end sm:col-span-2">
                  {row.isCustomKey ? (
                    <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => onRemove(row.uid)}>
                      Kaldır
                    </Button>
                  ) : (
                    row.account && !row.isDefault && (
                      <Button type="button" size="sm" variant="ghost" icon="rotateCcw" onClick={() => onChange(row.uid, { account: null })}>
                        Varsayılana dön
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {canSetup && kind === 'RATE' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input label="Oran ekle" placeholder="10" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} error={rateError} className="w-32" />
          <Button type="button" size="sm" variant="outline" icon="plus" onClick={addRate} className="mb-0.5">
            Oran ekle
          </Button>
        </div>
      )}
      {canSetup && kind === 'LEDGER_ACCOUNT' && (
        <div className="mt-3 sm:max-w-md">
          <LedgerAccountField label="Cari ekle" value={null} onChange={addLedgerAccount} hint="Seçilen cari için satır açılır; ardından hesabını seçin." />
        </div>
      )}
    </Card>
  );
}
