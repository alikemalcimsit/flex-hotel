import { DEFAULT_JOURNAL_RULES, JOURNAL_RULE_KEY_KINDS, JOURNAL_RULE_SOURCES } from '@hotelos/hotel-contracts';

/**
 * Otomatik fiş kuralları ekranının (modül 48) saf yardımcıları: sunucudan gelen kural listesi ile anahtar
 * türlerinden ekran satırları kurulur; satırlardan `PUT /ledger/rules` gövdesi türetilir.
 *
 * Satır: `{ uid, source, key, keyLabel, account, isDefault, serverAccountId }` — `serverAccountId` sunucuda otel
 * kuralı olarak yazılı hesap (varsayılan değil); hesap kaldırılınca `accountId: null` gönderilir ve kural silinir.
 */

/** Departman / oran kuralında boş anahtarın okunuşu. */
export const EMPTY_KEY_LABELS = Object.freeze({
  DEPARTMENT: 'Diğer / belirtilmemiş',
  RATE: 'Bütün oranlar',
  NONE: '',
});

/**
 * @param {string} source
 * @param {string} key
 * @param {{ treasuryAccounts?: Array<{ id: string, name: string }>, departments?: Array<{ id: string, name: string }> }} lists
 * @param {string} [fallback]
 */
export function ruleKeyLabel(source, key, lists, fallback) {
  const kind = JOURNAL_RULE_KEY_KINDS[source];
  if (!kind) return key;
  if (kind.kind === 'LIST') return kind.labels?.[key] ?? key;
  if (kind.kind === 'TREASURY') return lists.treasuryAccounts?.find((row) => row.id === key)?.name ?? fallback ?? key;
  if (kind.kind === 'DEPARTMENT') return key === '' ? EMPTY_KEY_LABELS.DEPARTMENT : (lists.departments?.find((row) => row.id === key)?.name ?? fallback ?? key);
  if (kind.kind === 'RATE') return key === '' ? EMPTY_KEY_LABELS.RATE : `%${key}`;
  if (kind.kind === 'LEDGER_ACCOUNT') return fallback ?? key;
  return EMPTY_KEY_LABELS.NONE;
}

/**
 * Kaynak × anahtar için seed varsayılanının kodu; anahtara özel yoksa boş anahtarın kuralı (oran, departman).
 * @param {string} source @param {string} key
 * @returns {string | null}
 */
export function defaultCodeFor(source, key) {
  const exact = DEFAULT_JOURNAL_RULES.find((rule) => rule.source === source && rule.key === key);
  if (exact) return exact.code;
  const kind = JOURNAL_RULE_KEY_KINDS[source]?.kind;
  if (kind === 'RATE' || kind === 'DEPARTMENT') return DEFAULT_JOURNAL_RULES.find((rule) => rule.source === source && rule.key === '')?.code ?? null;
  return null;
}

/**
 * Kaynağın ekranda görünmesi gereken anahtarları: tür listesi, kasa / banka kimlikleri, departmanlar + boş,
 * oran / cari için yalnız boş (oran) ya da hiç (cari) — gelen kuralların anahtarları eklenir.
 * @param {string} source
 * @param {{ treasuryAccounts?: Array<{ id: string }>, departments?: Array<{ id: string }> }} lists
 * @returns {string[]}
 */
function baseKeysOf(source, lists) {
  const kind = JOURNAL_RULE_KEY_KINDS[source];
  switch (kind.kind) {
    case 'LIST':
      return [...kind.keys];
    case 'TREASURY':
      return (lists.treasuryAccounts ?? []).map((row) => row.id);
    case 'DEPARTMENT':
      return [...(lists.departments ?? []).map((row) => row.id), ''];
    case 'RATE':
    case 'NONE':
      return [''];
    default:
      return [];
  }
}

/**
 * @param {Array<{ source: string, key: string, accountId: string | null, account: { id: string, code: string, name: string } | null, isDefault: boolean, keyLabel?: string }>} rules
 * @param {{ treasuryAccounts?: Array<{ id: string, name: string }>, departments?: Array<{ id: string, name: string }> }} lists
 * @returns {Array<{ uid: string, source: string, key: string, keyLabel: string, account: any | null, isDefault: boolean, serverAccountId: string | null, isCustomKey: boolean }>}
 */
export function buildRuleRows(rules, lists) {
  return JOURNAL_RULE_SOURCES.flatMap((source) => {
    const own = rules.filter((rule) => rule.source === source);
    const byKey = new Map(own.map((rule) => [rule.key, rule]));
    const keys = [...new Set([...baseKeysOf(source, lists), ...own.map((rule) => rule.key)])];
    return keys.map((key) => {
      const rule = byKey.get(key);
      return {
        uid: `${source}|${key}`,
        source,
        key,
        keyLabel: ruleKeyLabel(source, key, lists, rule?.keyLabel),
        account: rule?.account ?? null,
        isDefault: rule?.isDefault ?? false,
        serverAccountId: rule && !rule.isDefault ? (rule.accountId ?? null) : null,
        isCustomKey: false,
      };
    });
  });
}

/**
 * Ekrandan eklenen satır (oran, cari): anahtarı kullanıcı verir; hesap seçilmeden gönderilmez.
 * @param {string} source @param {string} key @param {string} keyLabel
 */
export function newRuleRow(source, key, keyLabel) {
  return { uid: `${source}|${key}|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, source, key, keyLabel, account: null, isDefault: false, serverAccountId: null, isCustomKey: true };
}

/**
 * Gönderilecek satırlar: hesabı olanlar yazılır; sunucuda yazılı olup hesabı kaldırılanlar `null` ile silinir;
 * hesap seçilmemiş eklenen satırlar gönderilmez.
 * @param {ReturnType<typeof buildRuleRows>} rows
 * @returns {Array<{ source: string, key: string, accountId: string | null }>}
 */
export function ruleRowsToRequest(rows) {
  return rows.flatMap((row) => {
    if (row.account) return [{ source: row.source, key: row.key, accountId: row.account.id }];
    if (row.serverAccountId) return [{ source: row.source, key: row.key, accountId: null }];
    return [];
  });
}

/**
 * Satırlar arasında aynı kaynak + anahtar var mı (ekranda eklenen oran / cari için).
 * @param {Array<{ source: string, key: string }>} rows @param {string} source @param {string} key
 */
export function hasRuleKey(rows, source, key) {
  return rows.some((row) => row.source === source && row.key === key);
}
