import { fromCents, splitByWeights, toCents } from '@hotelos/hotel-contracts';

/**
 * Genel muhasebenin saf kuralları (modül 48) — veritabanına dokunmaz, birim testlidir.
 *
 * Otomatik fiş motoru ön muhasebe kayıtlarını (cari hareketi, kasa / banka hareketi) belgeye göre gruplar, her
 * kaydı hesabına borç / alacak yazar, kalan farkı ("karşı taraf") kaynağın ağırlıklarıyla böler ve satırları hesap
 * bazında toplar. Buradaki fonksiyonlar o adımların her birini kuruş (BigInt) aritmetiğiyle yapar.
 */

/** Ters kayıt anahtarı öneki (47 `reverseRecords`). */
const REVERSAL_PREFIX = 'REVERSAL:';

/** Zamanla fark kaydı alan kaynaklar: her fark kaydı kendi fişi (gerçekleşti +X, sonra iptal −Y birbirini götürmesin). */
const DELTA_SOURCES = new Set(['EVENT_CHARGE', 'AGENCY_BONUS']);

/**
 * Kaydın belge anahtarı: aynı belgenin kayıtları tek fişe gider.
 * - Ters kayıtlar (`REVERSAL:<id>`) asıl belgeden ayrı fiş: `<tür>:<kaynak>:REVERSAL`.
 * - Çek / senet hareketleri işlem bazında (`INSTRUMENT:<çek>:<hareket>`; ciro edilene yazılan `:ENDORSEE` eki aynı işlem).
 * - Etkinlik bedeli / prim fark kayıtları kayıt bazında (her kayıt kendi anahtarıyla).
 * - Diğerleri `<tür>:<kaynak>`.
 * @param {{ sourceType: string, sourceId: string, sourceKey: string }} record
 */
export function documentKeyOf(record) {
  if (record.sourceKey.startsWith(REVERSAL_PREFIX)) return `${record.sourceType}:${record.sourceId}:REVERSAL`;
  if (record.sourceType === 'INSTRUMENT') return record.sourceKey.replace(/:ENDORSEE$/, '');
  if (DELTA_SOURCES.has(record.sourceType)) return `${record.sourceType}:${record.sourceKey}`;
  return `${record.sourceType}:${record.sourceId}`;
}

/**
 * Fişin tekil kaynak anahtarı: belge anahtarı + grubun en küçük kayıt kimliği. Aynı belgeye sonradan eklenen kayıtlar
 * (bordro parçaları, geç gelen ters kayıt) yeni bir grup ve yeni bir anahtardır; aynı kümeyi iki kez fişlemeyi
 * kayıt kilidi (`journalEntryId IS NULL … FOR UPDATE`) önler, anahtar yalnız son savunmadır.
 * @param {{ key: string, records: Array<{ id: string }> }} group
 */
export const journalSourceKeyOf = (group) => `${group.key}#${[...group.records.map((record) => record.id)].sort()[0]}`;

/** @param {{ sourceKey: string }} record */
export const isReversalRecord = (record) => record.sourceKey.startsWith(REVERSAL_PREFIX);

/**
 * Kayıtları belge anahtarına göre gruplar; grup günü kayıtların en geç günü, "ters kayıt" bayrağı anahtardan.
 * @template {{ sourceType: string, sourceId: string, sourceKey: string, date: string }} T
 * @param {T[]} records
 * @returns {Array<{ key: string, sourceType: string, sourceId: string, reversal: boolean, date: string, records: T[] }>}
 */
export function groupRecords(records) {
  /** @type {Map<string, { key: string, sourceType: string, sourceId: string, reversal: boolean, date: string, records: T[] }>} */
  const groups = new Map();
  for (const record of records) {
    const key = documentKeyOf(record);
    const group = groups.get(key) ?? { key, sourceType: record.sourceType, sourceId: record.sourceId, reversal: isReversalRecord(record), date: record.date, records: [] };
    group.records.push(record);
    if (record.date > group.date) group.date = record.date;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Bordro cari hareketinin yükümlülük anahtarı: `PAYROLL:<bordro>:SGK|TAX|BES|GARN:<id>`; personel satırında yok.
 * @param {string} sourceKey
 * @returns {'SGK' | 'TAX' | 'BES' | 'GARN' | null}
 */
export function payrollLiabilityKeyOf(sourceKey) {
  const match = /^(?:REVERSAL:)?PAYROLL:[^:]+:(SGK|TAX|BES|GARN)(?::|$)/.exec(sourceKey);
  return match ? /** @type {'SGK' | 'TAX' | 'BES' | 'GARN'} */ (match[1]) : null;
}

/**
 * İşaretli kuruş tutarlarını (artı borç, eksi alacak) hesap bazında toplayıp fiş satırlarına çevirir. Aynı hesapta
 * tek cari / kasa varsa izi kalır, birden çoksa iz boş. Sıfıra inen hesap satır olmaz. Satırlar hesap koduna göre
 * önce borçlar sonra alacaklar sıralanır.
 *
 * @param {Array<{ accountId: string, code: string, amount: bigint, ledgerAccountId?: string | null, treasuryAccountId?: string | null, description?: string | null }>} parts
 * @returns {Array<{ accountId: string, debit: string, credit: string, ledgerAccountId: string | null, treasuryAccountId: string | null, description: string | null }>}
 */
export function aggregateLines(parts) {
  /** @type {Map<string, { accountId: string, code: string, amount: bigint, ledger: Set<string | null>, treasury: Set<string | null>, descriptions: Set<string> }>} */
  const byAccount = new Map();
  for (const part of parts) {
    const current = byAccount.get(part.accountId) ?? { accountId: part.accountId, code: part.code, amount: 0n, ledger: new Set(), treasury: new Set(), descriptions: new Set() };
    current.amount += part.amount;
    current.ledger.add(part.ledgerAccountId ?? null);
    current.treasury.add(part.treasuryAccountId ?? null);
    if (part.description) current.descriptions.add(part.description);
    byAccount.set(part.accountId, current);
  }
  const single = (set) => (set.size === 1 ? [...set][0] : null);
  const rows = [...byAccount.values()].filter((row) => row.amount !== 0n);
  // Hesap bazında sıfırlanan belge (aynı hesaba eşlenmiş iki kasa arası virman, aynı türden iki cari arasındaki
  // çek dönüşü): iz kalsın diye borç ve alacak ayrı satır olarak yazılır (net etkisi sıfır, fiş dengeli).
  if (rows.length < 2 && parts.some((part) => part.amount !== 0n)) return aggregateBySide(parts);
  return rows
    .sort((a, b) => (a.amount > 0n) === (b.amount > 0n) ? a.code.localeCompare(b.code, 'tr', { numeric: true }) : a.amount > 0n ? -1 : 1)
    .map((row) => ({
      accountId: row.accountId,
      debit: row.amount > 0n ? fromCents(row.amount) : '0.00',
      credit: row.amount < 0n ? fromCents(-row.amount) : '0.00',
      ledgerAccountId: single(row.ledger),
      treasuryAccountId: single(row.treasury),
      description: row.descriptions.size === 1 ? [...row.descriptions][0] : null,
    }));
}

/** Hesap × taraf bazında toplama (sıfırlanan belgeler için). @param {Parameters<typeof aggregateLines>[0]} parts */
function aggregateBySide(parts) {
  /** @type {Map<string, { accountId: string, code: string, amount: bigint }>} */
  const bySide = new Map();
  for (const part of parts) {
    if (part.amount === 0n) continue;
    const key = `${part.accountId}|${part.amount > 0n ? 'D' : 'C'}`;
    const current = bySide.get(key) ?? { accountId: part.accountId, code: part.code, amount: 0n };
    current.amount += part.amount;
    bySide.set(key, current);
  }
  return [...bySide.values()]
    .sort((a, b) => ((a.amount > 0n) === (b.amount > 0n) ? a.code.localeCompare(b.code, 'tr', { numeric: true }) : a.amount > 0n ? -1 : 1))
    .map((row) => ({ accountId: row.accountId, debit: row.amount > 0n ? fromCents(row.amount) : '0.00', credit: row.amount < 0n ? fromCents(-row.amount) : '0.00', ledgerAccountId: null, treasuryAccountId: null, description: null }));
}

/**
 * Kayıtların net borcu (kuruş): Σ(borç − alacak) + Σ(kasa / banka tutarı, otel parasıyla). Karşı taraf bunun eksisidir.
 * @param {Array<{ amount: bigint }>} parts
 */
export const netDebitOf = (parts) => parts.reduce((sum, part) => sum + part.amount, 0n);

/**
 * Karşı tarafı ağırlıklarla böler: `total` işaretli kuruş (karşı tarafın net borcu), ağırlıklar pozitif metin.
 * Ağırlık yoksa tek parça. Sonuç işaretli kuruş.
 * @param {bigint} total
 * @param {Array<{ key: string, weight: string }>} weights
 * @returns {Array<{ key: string, amount: bigint }>}
 */
export function splitCounter(total, weights) {
  if (total === 0n) return [];
  const list = weights.filter((item) => toCents(item.weight) !== 0n);
  if (list.length === 0) return [{ key: weights[0]?.key ?? '', amount: total }];
  return splitByWeights(fromCents(total), list).map((part) => ({ key: part.key, amount: toCents(part.amount) }));
}

/**
 * Döviz hareketinin otel parasıyla değeri: tutar × kur, kuruşa yuvarlı (kur 6 ondalık).
 * @param {string} amount işaretli @param {string} rate
 */
export function convertAtRate(amount, rate) {
  const cents = toCents(amount);
  const micro = BigInt(Math.round(Number(rate) * 1_000_000));
  const product = cents * micro;
  const half = product < 0n ? -500_000n : 500_000n;
  return fromCents((product + half) / 1_000_000n);
}

/**
 * Fiş günü dönem kilidindeyse kilit sonrasındaki ilk güne düşer.
 * @param {string} date @param {string | null} lockedThrough
 * @returns {{ date: string, deferred: boolean }}
 */
export function effectiveJournalDate(date, lockedThrough) {
  if (!lockedThrough || date > lockedThrough) return { date, deferred: false };
  const next = new Date(`${lockedThrough}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { date: next.toISOString().slice(0, 10), deferred: true };
}

/**
 * Hedef ile yazılmış arasındaki fark (hesap bazında, işaretli kuruş); sıfırlar atılır.
 * @param {Map<string, bigint>} target @param {Map<string, bigint>} existing
 * @returns {Map<string, bigint>}
 */
export function diffByAccount(target, existing) {
  const result = new Map();
  for (const id of new Set([...target.keys(), ...existing.keys()])) {
    const diff = (target.get(id) ?? 0n) - (existing.get(id) ?? 0n);
    if (diff !== 0n) result.set(id, diff);
  }
  return result;
}
