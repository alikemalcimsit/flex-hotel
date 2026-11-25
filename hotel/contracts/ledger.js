import { LEDGER_ACCOUNT_TYPES, LEDGER_ACCOUNT_TYPE_LABELS, MAX_SYNC_DAYS, fromCents, toCents } from './accounting.js';
import { expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Genel muhasebe sözleşmeleri (modül 48): Tek Düzen hesap planı, yevmiye fişi, otomatik fiş kuralları, mizan.
 *
 * Kararlar:
 * - **Her ön muhasebe hareketi fiş olur.** 47'nin cari ve kasa / banka hareketleri (kaynak belge bazında) otomatik
 *   yevmiye fişine dönüşür; kasa / banka hareketi kasa hesabına, cari hareketi türünün (ya da carinin) kontrol
 *   hesabına, kalan fark kaynağa göre karşı hesaba (gelir + KDV, stok + KDV, gider…) yazılır. Hareket fişlendiğinde
 *   `journalEntryId` dolar; fişlenmemiş hareket "Eşitle" ile sonradan fişlenir.
 * - **Gelir gün kapanışında.** Folyo kalemleri (hizmet günü), kapanan adisyonlar ve spa randevuları günün gelir
 *   fişinde tür bazında gelir hesabına ve oran bazında hesaplanan KDV'ye yazılır; borç tarafı "misafir ve adisyon
 *   alacakları" hesabıdır — tahsilatlar aynı hesabı alacaklandırır, böylece gün sonunda açık folyolar bu hesapta kalır.
 *   Gün yeniden çalıştırılırsa yalnız **fark** yazılır.
 * - **Kurallar değiştirilebilir;** seed varsayılanları Tek Düzen kodlarıyla gelir (ör. oda geliri 600.01, KDV 391).
 *   Kural yoksa iş "Ön muhasebe" manuel görevine düşer; kural girilip eşitlenince fişlenir.
 * - **Düzeltme ters kayıtla:** fiş silinmez, iptal edilen fiş VOIDED olur ve ters fişi yazılır. Dönem kilidi
 *   (`glLockedThrough`) öncesine elle fiş girilemez ve iptal edilemez; otomatik fiş kilit sonrasındaki ilk güne düşer.
 * - Para birimi otelin para birimidir; döviz kasasının hareketi ödemenin kuru (yoksa günün kuru) ile çevrilir.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `GlAccountClass` ile birebir. */
export const GL_ACCOUNT_CLASSES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE', 'OFF_BALANCE']);
export const GL_ACCOUNT_CLASS_LABELS = Object.freeze({
  ASSET: 'Varlık',
  LIABILITY: 'Yabancı kaynak',
  EQUITY: 'Öz kaynak',
  REVENUE: 'Gelir',
  COST: 'Maliyet',
  EXPENSE: 'Gider',
  OFF_BALANCE: 'Nazım',
});
/** Borç bakiyesi beklenen sınıflar (mizanda "borç kalanı" olumlu okunur). */
export const DEBIT_NATURE_CLASSES = Object.freeze(['ASSET', 'COST', 'EXPENSE']);

/** Prisma `GlDepartment` ile birebir (USALI 93 / dış aktarım 96 için). */
export const GL_DEPARTMENTS = Object.freeze(['ROOMS', 'FNB', 'OTHER', 'UNDISTRIBUTED']);
export const GL_DEPARTMENT_LABELS = Object.freeze({ ROOMS: 'Odalar', FNB: 'Yiyecek ve içecek', OTHER: 'Diğer işletme bölümleri', UNDISTRIBUTED: 'Dağıtılmamış' });

/** Prisma `JournalEntryType` / `JournalEntryStatus` ile birebir. */
export const JOURNAL_ENTRY_TYPES = Object.freeze(['AUTO', 'MANUAL']);
export const JOURNAL_ENTRY_TYPE_LABELS = Object.freeze({ AUTO: 'Otomatik', MANUAL: 'Elle' });
export const JOURNAL_ENTRY_STATUSES = Object.freeze(['POSTED', 'VOIDED']);
export const JOURNAL_ENTRY_STATUS_LABELS = Object.freeze({ POSTED: 'İşlendi', VOIDED: 'İptal edildi' });

/** Prisma `JournalSource` ile birebir: fişin kaynağı. */
export const JOURNAL_SOURCES = Object.freeze([
  'FOLIO_PAYMENT',
  'FOLIO_TRANSFER',
  'EVENT_PAYMENT',
  'EVENT_CHARGE',
  'POS_PAYMENT',
  'SPA_PAYMENT',
  'GOODS_RECEIPT',
  'AGENCY_BONUS',
  'INVOICE',
  'VOUCHER',
  'OPENING',
  'INSTRUMENT',
  'PAYROLL',
  'PAYROLL_PAYMENT',
  'EMPLOYEE_ADVANCE',
  'DAILY_REVENUE',
  'MANUAL',
  'REVERSAL',
]);
export const JOURNAL_SOURCE_LABELS = Object.freeze({
  FOLIO_PAYMENT: 'Ön büro tahsilatı',
  FOLIO_TRANSFER: 'Folyo cari aktarımı',
  EVENT_PAYMENT: 'Etkinlik tahsilatı',
  EVENT_CHARGE: 'Etkinlik bedeli',
  POS_PAYMENT: 'Restoran tahsilatı',
  SPA_PAYMENT: 'Spa tahsilatı',
  GOODS_RECEIPT: 'Mal kabul',
  AGENCY_BONUS: 'Acente primi',
  INVOICE: 'Serbest fatura',
  VOUCHER: 'Ön muhasebe fişi',
  OPENING: 'Açılış bakiyesi',
  INSTRUMENT: 'Çek / senet işlemi',
  PAYROLL: 'Bordro tahakkuku',
  PAYROLL_PAYMENT: 'Maaş ödemesi',
  EMPLOYEE_ADVANCE: 'Personel avansı',
  DAILY_REVENUE: 'Günlük gelir',
  MANUAL: 'Elle fiş',
  REVERSAL: 'Ters kayıt (iptal)',
});
/** Fiş numarası öneki (AccountingSequence). */
export const JOURNAL_NUMBER_PREFIX = 'YEV';

/** Prisma `JournalRuleSource` ile birebir: otomatik fişte hangi hesap. */
export const JOURNAL_RULE_SOURCES = Object.freeze([
  'TREASURY',
  'LEDGER_TYPE',
  'LEDGER_ACCOUNT',
  'GUEST_LEDGER',
  'REVENUE',
  'VAT_OUTPUT',
  'VAT_INPUT',
  'PURCHASE',
  'AGENCY_BONUS',
  'PAYROLL_EXPENSE',
  'PAYROLL_LIABILITY',
  'INSTRUMENT',
  'TREASURY_IN',
  'TREASURY_OUT',
  'OPENING',
  'FX_GAIN',
  'FX_LOSS',
]);
export const JOURNAL_RULE_SOURCE_LABELS = Object.freeze({
  TREASURY: 'Kasa / banka hesabı',
  LEDGER_TYPE: 'Cari türünün kontrol hesabı',
  LEDGER_ACCOUNT: 'Belirli carinin hesabı (türün üstüne yazar)',
  GUEST_LEDGER: 'Misafir ve adisyon alacakları',
  REVENUE: 'Gelir hesabı',
  VAT_OUTPUT: 'Hesaplanan KDV',
  VAT_INPUT: 'İndirilecek KDV',
  PURCHASE: 'Satın alınan malzeme (stok)',
  AGENCY_BONUS: 'Acente prim gideri',
  PAYROLL_EXPENSE: 'Personel gideri (departman)',
  PAYROLL_LIABILITY: 'Bordro yükümlülükleri',
  INSTRUMENT: 'Çek / senet hesabı',
  TREASURY_IN: 'Carisiz kasa / banka girişinin karşı hesabı',
  TREASURY_OUT: 'Carisiz kasa / banka çıkışının karşı hesabı',
  OPENING: 'Açılış bakiyesi karşı hesabı',
  FX_GAIN: 'Kur / yuvarlama farkı (kâr)',
  FX_LOSS: 'Kur / yuvarlama farkı (zarar)',
});
/** Kuralın ne zaman kullanıldığı (kurallar ekranındaki açıklama). */
export const JOURNAL_RULE_SOURCE_HINTS = Object.freeze({
  TREASURY: 'Her kasa / banka hareketi bu hesaba borç (giriş) ya da alacak (çıkış) yazılır. Kasa / banka açıldığında 100 / 102 altında alt hesabı kendiliğinden açılır.',
  LEDGER_TYPE: 'Cari hareketi carinin türüne göre kontrol hesabına gider: acente ve şirket 120 altı, tedarikçi 320, personel 335.',
  LEDGER_ACCOUNT: 'Belirli bir carinin hareketleri türün hesabı yerine buraya gider (ör. SGK carisi 361).',
  GUEST_LEDGER: 'Günlük gelir fişinin borç tarafı; ön büro, restoran ve spa tahsilatları ile folyonun cariye aktarımı bu hesabı alacaklandırır.',
  REVENUE: 'Günlük gelir fişinde folyo kalem türü, restoran (POS), etkinlik bedeli ve serbest fatura geliri; indirim kalemleri (DISCOUNT) 611, folyodaki vergi kalemleri (TAX) 360.',
  VAT_OUTPUT: 'Satış KDV’si; anahtar KDV oranı (ör. "10", "20"); boş anahtar bütün oranlar.',
  VAT_INPUT: 'Mal kabulün KDV’si; anahtar oran, boş anahtar bütün oranlar.',
  PURCHASE: 'Mal kabulün KDV hariç tutarı (stok girişi).',
  AGENCY_BONUS: 'Onaylanan acente prim hak edişi (gider); acentenin carisi alacaklanır.',
  PAYROLL_EXPENSE: 'Bordro tahakkukunda personel gideri; anahtar departman kimliği, boş anahtar diğer / belirsiz departman.',
  PAYROLL_LIABILITY: 'Bordronun SGK, vergi, BES ve icra / nafaka borçları (personel carileri 335’e türüyle gider).',
  INSTRUMENT: 'Alınan / verilen çek ve senetler: fişte alınan çek portföye (101 / 121), verilen çek (103 / 321); tahsil, ciro, karşılıksız ve ödeme bu hesabı kapatır.',
  TREASURY_IN: 'Carisiz "kasa / banka girişi" fişinde fişte hesap seçilmemişse karşı hesap (ör. 649 diğer gelir).',
  TREASURY_OUT: 'Carisiz "kasa / banka çıkışı" fişinde fişte hesap seçilmemişse karşı hesap (ör. 770 genel yönetim gideri).',
  OPENING: 'Ön muhasebedeki cari / kasa / banka açılış bakiyelerinin karşı hesabı.',
  FX_GAIN: 'Döviz kasası hareketinin çevrimi ya da kuruş yuvarlaması fişi fazla alacaklı bırakırsa fark buraya.',
  FX_LOSS: 'Fark fişi fazla borçlu bırakırsa buraya.',
});

/** Gelir kuralı anahtarları: folyo kalem türleri + restoran, etkinlik ve serbest fatura. */
export const REVENUE_RULE_KEYS = Object.freeze(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER', 'DISCOUNT', 'TAX', 'POS', 'EVENT', 'INVOICE']);
export const REVENUE_RULE_KEY_LABELS = Object.freeze({
  ROOM: 'Oda geliri',
  FNB: 'Yiyecek içecek (folyoya yazılan)',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Çamaşırhane',
  SPA: 'Spa ve spor salonu',
  OTHER: 'Diğer folyo kalemleri',
  DISCOUNT: 'İndirim kalemleri',
  TAX: 'Folyodaki vergi kalemleri (konaklama vergisi vb.)',
  POS: 'Restoran adisyonları (odaya yazılmayan)',
  EVENT: 'Etkinlik / banket bedeli',
  INVOICE: 'Serbest fatura',
});
export const PAYROLL_LIABILITY_KEYS = Object.freeze(['SGK', 'TAX', 'BES', 'GARN']);
export const PAYROLL_LIABILITY_KEY_LABELS = Object.freeze({ SGK: 'SGK primleri', TAX: 'Gelir ve damga vergisi', BES: 'BES katkı payı', GARN: 'İcra / nafaka kesintisi' });
export const INSTRUMENT_RULE_KEYS = Object.freeze(['CHEQUE:RECEIVED', 'CHEQUE:ISSUED', 'NOTE:RECEIVED', 'NOTE:ISSUED']);
export const INSTRUMENT_RULE_KEY_LABELS = Object.freeze({ 'CHEQUE:RECEIVED': 'Alınan çekler', 'CHEQUE:ISSUED': 'Verilen çekler', 'NOTE:RECEIVED': 'Alınan senetler', 'NOTE:ISSUED': 'Verilen senetler' });

/**
 * Kural anahtarının biçimi: sabit liste (ekranda seçilir), serbest (oran), kimlik (kasa / banka, cari, departman —
 * ekran listesini ilgili modülden alır) ya da yok (yalnız boş anahtar).
 * @type {Readonly<Record<string, { kind: 'NONE' | 'LIST' | 'RATE' | 'TREASURY' | 'LEDGER_ACCOUNT' | 'DEPARTMENT', keys?: readonly string[], labels?: Readonly<Record<string, string>> }>>}
 */
export const JOURNAL_RULE_KEY_KINDS = Object.freeze({
  TREASURY: { kind: 'TREASURY' },
  LEDGER_TYPE: { kind: 'LIST', keys: LEDGER_ACCOUNT_TYPES, labels: LEDGER_ACCOUNT_TYPE_LABELS },
  LEDGER_ACCOUNT: { kind: 'LEDGER_ACCOUNT' },
  GUEST_LEDGER: { kind: 'NONE' },
  REVENUE: { kind: 'LIST', keys: REVENUE_RULE_KEYS, labels: REVENUE_RULE_KEY_LABELS },
  VAT_OUTPUT: { kind: 'RATE' },
  VAT_INPUT: { kind: 'RATE' },
  PURCHASE: { kind: 'NONE' },
  AGENCY_BONUS: { kind: 'NONE' },
  PAYROLL_EXPENSE: { kind: 'DEPARTMENT' },
  PAYROLL_LIABILITY: { kind: 'LIST', keys: PAYROLL_LIABILITY_KEYS, labels: PAYROLL_LIABILITY_KEY_LABELS },
  INSTRUMENT: { kind: 'LIST', keys: INSTRUMENT_RULE_KEYS, labels: INSTRUMENT_RULE_KEY_LABELS },
  TREASURY_IN: { kind: 'NONE' },
  TREASURY_OUT: { kind: 'NONE' },
  OPENING: { kind: 'NONE' },
  FX_GAIN: { kind: 'NONE' },
  FX_LOSS: { kind: 'NONE' },
});

/**
 * Varsayılan kurallar (seed): kaynak × anahtar → Tek Düzen kodu. Otel kuralları ekrandan değiştirir; silinen kural
 * eşitlemede buraya düşer. Kasa / banka (TREASURY) kuralı hesap açılırken kendiliğinden yazılır (100.xx / 102.xx).
 */
export const DEFAULT_JOURNAL_RULES = Object.freeze([
  { source: 'GUEST_LEDGER', key: '', code: '120.01' },
  { source: 'LEDGER_TYPE', key: 'AGENCY', code: '120.02' },
  { source: 'LEDGER_TYPE', key: 'COMPANY', code: '120.03' },
  { source: 'LEDGER_TYPE', key: 'PERSON', code: '120.04' },
  { source: 'LEDGER_TYPE', key: 'OTHER', code: '136' },
  { source: 'LEDGER_TYPE', key: 'SUPPLIER', code: '320' },
  { source: 'LEDGER_TYPE', key: 'EMPLOYEE', code: '335' },
  { source: 'REVENUE', key: 'ROOM', code: '600.01' },
  { source: 'REVENUE', key: 'FNB', code: '600.02' },
  { source: 'REVENUE', key: 'POS', code: '600.02' },
  { source: 'REVENUE', key: 'MINIBAR', code: '600.03' },
  { source: 'REVENUE', key: 'LAUNDRY', code: '600.04' },
  { source: 'REVENUE', key: 'SPA', code: '600.05' },
  { source: 'REVENUE', key: 'EVENT', code: '600.06' },
  { source: 'REVENUE', key: 'OTHER', code: '600.09' },
  { source: 'REVENUE', key: 'INVOICE', code: '600.09' },
  { source: 'REVENUE', key: 'DISCOUNT', code: '611' },
  { source: 'REVENUE', key: 'TAX', code: '360' },
  { source: 'VAT_OUTPUT', key: '', code: '391' },
  { source: 'VAT_INPUT', key: '', code: '191' },
  { source: 'PURCHASE', key: '', code: '150' },
  { source: 'AGENCY_BONUS', key: '', code: '760' },
  { source: 'PAYROLL_EXPENSE', key: '', code: '770' },
  { source: 'PAYROLL_LIABILITY', key: 'SGK', code: '361' },
  { source: 'PAYROLL_LIABILITY', key: 'TAX', code: '360' },
  { source: 'PAYROLL_LIABILITY', key: 'BES', code: '369' },
  { source: 'PAYROLL_LIABILITY', key: 'GARN', code: '336' },
  { source: 'INSTRUMENT', key: 'CHEQUE:RECEIVED', code: '101' },
  { source: 'INSTRUMENT', key: 'CHEQUE:ISSUED', code: '103' },
  { source: 'INSTRUMENT', key: 'NOTE:RECEIVED', code: '121' },
  { source: 'INSTRUMENT', key: 'NOTE:ISSUED', code: '321' },
  { source: 'TREASURY_IN', key: '', code: '649' },
  { source: 'TREASURY_OUT', key: '', code: '770' },
  { source: 'OPENING', key: '', code: '500' },
  { source: 'FX_GAIN', key: '', code: '646' },
  { source: 'FX_LOSS', key: '', code: '656' },
]);

/* ─────────────── Sınırlar ─────────────── */

export const MAX_GL_CODE_LENGTH = 20;
export const MAX_GL_NAME_LENGTH = 160;
export const MAX_GL_DEPTH = 5;
export const MAX_JOURNAL_LINES = 200;
export const MAX_JOURNAL_TEXT_LENGTH = 300;
export const MAX_JOURNAL_REFERENCE_LENGTH = 60;
export const MAX_JOURNAL_AMOUNT = 1_000_000_000;
/** Elle fiş en fazla bu kadar gün geriye girilir (dönem kilidi ayrıca). */
export const MAX_JOURNAL_BACKDATE_DAYS = 400;
/** Hesap ekstresi / fiş listesi sayfası. */
export const JOURNAL_PAGE_SIZE = 50;
export const MAX_JOURNAL_PAGE_SIZE = 200;
/** Tek Düzen kodu: 1–3 haneli ana kod, noktayla en çok 4 alt seviye ("100", "100.01", "600.02.1"). */
export const GL_CODE_PATTERN = /^\d{1,3}(\.\d{1,3}){0,4}$/;

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Kodun Tek Düzen sınıfı. 1–2 varlık, 3–4 yabancı kaynak, 5 öz kaynak, 7 maliyet, 8 serbest (gider), 9 nazım;
 * 6'da gelir grupları 60, 64, 67, 69; 61, 62, 63, 65, 66, 68 indirim / maliyet / gider gruplarıdır (eksi).
 * @param {string} code
 * @returns {string} GL_ACCOUNT_CLASSES içinden
 */
export function glClassOfCode(code) {
  const digits = String(code).replace(/\..*$/, '');
  const first = digits[0];
  if (first === '1' || first === '2') return 'ASSET';
  if (first === '3' || first === '4') return 'LIABILITY';
  if (first === '5') return 'EQUITY';
  if (first === '7') return 'COST';
  if (first === '8') return 'EXPENSE';
  if (first === '9') return 'OFF_BALANCE';
  if (first === '6') {
    const group = digits.slice(0, 2);
    return ['61', '62', '63', '65', '66', '68'].includes(group) ? 'EXPENSE' : 'REVENUE';
  }
  return 'OFF_BALANCE';
}

/**
 * Üst kod: "100.01" → "100", "100" → "10", "10" → "1", "1" → null. Ağaç bu koddan kurulur; üst hesap yoksa
 * kullanıcıya "önce üst hesabı açın" denir.
 * @param {string} code
 * @returns {string | null}
 */
export function parentCodeOf(code) {
  const text = String(code);
  const dot = text.lastIndexOf('.');
  if (dot >= 0) return text.slice(0, dot);
  if (text.length > 1) return text.slice(0, -1);
  return null;
}

/** Kod derinliği: "1" 0, "10" 1, "100" 2, "100.01" 3… @param {string} code */
export function glDepthOf(code) {
  const text = String(code);
  const main = text.split('.')[0];
  return main.length - 1 + (text.split('.').length - 1);
}

/**
 * Kodları Tek Düzen sırasına koyar: ana kod sayısal, alt kodlar parça parça sayısal ("100.2" < "100.10").
 * @param {string} a @param {string} b
 */
export function compareGlCodes(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    if (pa[index] === undefined) return -1;
    if (pb[index] === undefined) return 1;
    // Aynı uzunlukta ana kodlar sayısal; "1" < "10" < "100" (üst önce) için uzunluk önce.
    if (index === 0 && pa[0].length !== pb[0].length) {
      // Üst hesap ("10") alt hesabından ("100") önce gelir; "11" "100"den sonra gelir.
      const prefix = pa[0].length < pb[0].length ? pb[0].startsWith(pa[0]) : pa[0].startsWith(pb[0]);
      if (prefix) return pa[0].length - pb[0].length;
      return Number(pa[0].padEnd(3, '0')) - Number(pb[0].padEnd(3, '0')) || pa[0].length - pb[0].length;
    }
    const diff = Number(pa[index]) - Number(pb[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Fiş satırlarının toplamı ve dengesi (kuruşla; metin tutarlar).
 * @param {Array<{ debit?: string | null, credit?: string | null }>} lines
 * @returns {{ debit: string, credit: string, balanced: boolean, difference: string }}
 */
export function journalBalance(lines) {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    if (line.debit && /^\d+(\.\d{1,2})?$/.test(String(line.debit))) debit += toCents(String(line.debit));
    if (line.credit && /^\d+(\.\d{1,2})?$/.test(String(line.credit))) credit += toCents(String(line.credit));
  }
  return { debit: fromCents(debit), credit: fromCents(credit), balanced: debit === credit && debit > 0n, difference: fromCents(debit - credit) };
}

/**
 * Tutarı ağırlıklarla kuruşa yuvarlayarak böler; kuruş farkı en büyük paya eklenir, toplam her zaman tutara eşittir.
 * Ağırlıkların toplamı sıfırsa her şey ilk paya. Otomatik fişte karşı tarafı (gelir + KDV, departman giderleri) bölmek için.
 * @param {string} total işaretli ("-125.00" olabilir)
 * @param {Array<{ key: string, weight: string }>} weights pozitif ağırlıklar
 * @returns {Array<{ key: string, amount: string }>}
 */
export function splitByWeights(total, weights) {
  if (weights.length === 0) return [];
  const cents = toCents(total);
  const sum = weights.reduce((acc, item) => acc + toCents(item.weight), 0n);
  if (sum === 0n) return weights.map((item, index) => ({ key: item.key, amount: index === 0 ? fromCents(cents) : '0.00' }));
  const parts = weights.map((item) => (cents * toCents(item.weight)) / sum);
  const rest = cents - parts.reduce((acc, part) => acc + part, 0n);
  const largest = weights.reduce((best, item, index) => (toCents(item.weight) > toCents(weights[best].weight) ? index : best), 0);
  return weights.map((item, index) => ({ key: item.key, amount: fromCents(parts[index] + (index === largest ? rest : 0n)) }));
}

/**
 * Mizan satırlarını ağaçta üst hesaplara toplar. Girdi: hesap listesi (kod, üst) ve yaprak toplamları; çıktı: her hesap
 * için açılış, borç, alacak ve kapanış (borç − alacak işaretli) — üst hesap çocuklarının toplamı.
 * @param {Array<{ id: string, code: string, parentId: string | null }>} accounts
 * @param {Map<string, { opening: string, debit: string, credit: string }>} sums hesap kimliği → dönem toplamları (yalnız hareket görenler)
 * @returns {Map<string, { opening: string, debit: string, credit: string, closing: string }>}
 */
export function rollUpTrialBalance(accounts, sums) {
  /** @type {Map<string, { opening: bigint, debit: bigint, credit: bigint }>} */
  const totals = new Map();
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const add = (id, row) => {
    const current = totals.get(id) ?? { opening: 0n, debit: 0n, credit: 0n };
    totals.set(id, { opening: current.opening + row.opening, debit: current.debit + row.debit, credit: current.credit + row.credit });
  };
  for (const [id, sum] of sums) {
    const row = { opening: toCents(sum.opening), debit: toCents(sum.debit), credit: toCents(sum.credit) };
    let cursor = byId.get(id);
    while (cursor) {
      add(cursor.id, row);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  const result = new Map();
  for (const [id, row] of totals) {
    result.set(id, { opening: fromCents(row.opening), debit: fromCents(row.debit), credit: fromCents(row.credit), closing: fromCents(row.opening + row.debit - row.credit) });
  }
  return result;
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });
const text = (max, label, min = 1) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(min, `${label} en az ${min} karakter`)
    .max(max, `${label} en fazla ${max} karakter`);
const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .nullish()
    .transform((value) => (value ? value : null));
const amount = (label = 'Tutar') =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `${label} en fazla iki ondalıklı sayı olmalı`)
    .refine((value) => Number(value) < MAX_JOURNAL_AMOUNT, `${label} çok büyük`);
const glCode = z
  .string({ error: 'Hesap kodu zorunlu' })
  .trim()
  .max(MAX_GL_CODE_LENGTH, `Hesap kodu en fazla ${MAX_GL_CODE_LENGTH} karakter`)
  .regex(GL_CODE_PATTERN, 'Hesap kodu Tek Düzen biçiminde olmalı: "100", "100.01", "600.02"');
const departmentField = z.enum(GL_DEPARTMENTS, { error: 'Departman seçin' }).nullish().transform((value) => value ?? null);

/** Hesap aç: kod üst hesabı belirler ("100.01" → 100 altı). Sınıf koddan türetilir. */
export const glAccountCreateSchema = z.object({
  code: glCode,
  name: text(MAX_GL_NAME_LENGTH, 'Hesap adı', 2),
  department: departmentField,
});

/** Hesap düzenle: ad, departman, etkinlik. Kod ve üst değişmez (hareket izi); seed hesabın adı da değiştirilebilir. */
export const glAccountUpdateSchema = z.object({
  expectedUpdatedAt,
  name: text(MAX_GL_NAME_LENGTH, 'Hesap adı', 2),
  department: departmentField,
  isActive: z.boolean().default(true),
});

export const glAccountParamSchema = z.object({ accountId: uuid('Geçersiz hesap') });
export const glChartQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  onlyActive: z.coerce.boolean().optional(),
  /** Yalnız yaprak hesaplar (seçici). */
  postable: z.coerce.boolean().optional(),
});
export const glPickerQuerySchema = z.object({ search: z.string().trim().max(80).optional() });

const periodFields = { from: isoDayField.optional(), to: isoDayField.optional() };
/** @param {{ from?: string, to?: string }} value @param {import('zod').RefinementCtx} ctx */
function refinePeriod(value, ctx) {
  if (value.from && value.to && value.from > value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
}

/** Hesap ekstresi (kebir): dönem, imleç. Üst hesapta alt hesapların satırları da gelir. */
export const glAccountLinesQuerySchema = z
  .object({
    ...periodFields,
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_JOURNAL_PAGE_SIZE).default(JOURNAL_PAGE_SIZE),
  })
  .superRefine(refinePeriod);

/** Fiş satırı: hesap + tek taraf. Cari izi isteğe bağlı. */
export const journalLineInputSchema = z
  .object({
    accountId: uuid('Hesap seçin'),
    debit: amount('Borç').nullish().transform((value) => value ?? null),
    credit: amount('Alacak').nullish().transform((value) => value ?? null),
    description: optionalText(MAX_JOURNAL_TEXT_LENGTH, 'Satır açıklaması'),
    ledgerAccountId: uuid('Geçersiz cari').nullish().transform((value) => value ?? null),
  })
  .superRefine((value, ctx) => {
    const debit = value.debit ? toCents(value.debit) : 0n;
    const credit = value.credit ? toCents(value.credit) : 0n;
    if ((debit === 0n) === (credit === 0n)) ctx.addIssue({ code: 'custom', path: ['debit'], message: 'Satırın borç ya da alacak tarafından yalnız biri dolu olmalı' });
  });

/** Elle fiş: en az iki satır, borç = alacak > 0, aynı istek kimliği ikinci fiş açmaz. */
export const journalCreateSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    date: isoDayField,
    description: text(MAX_JOURNAL_TEXT_LENGTH, 'Açıklama', 3),
    reference: optionalText(MAX_JOURNAL_REFERENCE_LENGTH, 'Belge no'),
    lines: z.array(journalLineInputSchema).min(2, 'En az iki satır girin').max(MAX_JOURNAL_LINES, `Bir fişte en fazla ${MAX_JOURNAL_LINES} satır`),
  })
  .superRefine((value, ctx) => {
    const balance = journalBalance(value.lines);
    if (!balance.balanced) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Borç ve alacak toplamı eşit olmalı (fark ${balance.difference})` });
  });

export const journalVoidSchema = z.object({
  expectedUpdatedAt,
  reason: text(MAX_JOURNAL_TEXT_LENGTH, 'İptal sebebi', 3),
  /** Ters kaydın günü (boşsa bugün). Dönem kilidinden sonra olmalı. */
  date: isoDayField.optional(),
});

export const journalParamSchema = z.object({ journalId: uuid('Geçersiz fiş') });

export const journalListQuerySchema = paginationQuerySchema
  .extend({
    ...periodFields,
    type: z.enum(JOURNAL_ENTRY_TYPES).optional(),
    status: z.enum(JOURNAL_ENTRY_STATUSES).optional(),
    source: z.enum(JOURNAL_SOURCES).optional(),
    accountId: uuid('Geçersiz hesap').optional(),
    search: z.string().trim().max(80).optional(),
  })
  .superRefine(refinePeriod);

/** Mizan: dönem (zorunlu), yalnız hareketliler, departman süzgeci. */
export const trialBalanceQuerySchema = z
  .object({
    from: isoDayField,
    to: isoDayField,
    onlyActive: z.coerce.boolean().optional(),
    department: z.enum(GL_DEPARTMENTS).optional(),
  })
  .superRefine(refinePeriod);

const ruleKey = z
  .string()
  .trim()
  .max(80, 'Anahtar en fazla 80 karakter')
  .default('')
  .refine((value) => !value.includes('|'), 'Anahtar "|" içeremez');

/** Kural satırları: hesap boşsa kural silinir (varsayılana döner). */
export const journalRulesSchema = z.object({
  rows: z
    .array(
      z.object({
        source: z.enum(JOURNAL_RULE_SOURCES, { error: 'Kaynak seçin' }),
        key: ruleKey,
        accountId: uuid('Hesap seçin').nullable(),
      }),
    )
    .max(500, 'En fazla 500 kural')
    .superRefine((rows, ctx) => {
      const seen = new Set();
      rows.forEach((row, index) => {
        const id = `${row.source}|${row.key}`;
        if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Aynı kaynak ve anahtar iki kez' });
        seen.add(id);
        const kind = JOURNAL_RULE_KEY_KINDS[row.source];
        if (kind.kind === 'NONE' && row.key !== '') ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Bu kaynak anahtar almaz' });
        if (kind.kind === 'LIST' && !kind.keys.includes(row.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Geçersiz anahtar' });
        if (kind.kind === 'RATE' && row.key !== '' && !/^\d{1,2}(\.\d{1,2})?$/.test(row.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Oran "10" ya da "20" gibi yazılır' });
      });
    }),
});

/** Dönem kilidi: bu güne (dahil) kadar fiş girilemez / iptal edilemez; boş = kilit yok. */
export const ledgerSettingsSchema = z.object({
  expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
  glLockedThrough: z.union([isoDayField, z.null()]).default(null),
});

/** Eşitleme: dönemdeki fişlenmemiş hareketler ve günlük gelir fişleri. */
export const ledgerSyncSchema = z
  .object({ from: isoDayField, to: isoDayField })
  .refine((value) => value.from <= value.to, { message: 'Bitiş başlangıçtan önce olamaz', path: ['to'] })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= MAX_SYNC_DAYS, { message: `Dönem en fazla ${MAX_SYNC_DAYS} gün`, path: ['to'] });
