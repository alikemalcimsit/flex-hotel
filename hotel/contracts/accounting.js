import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Ön muhasebe sözleşmeleri (modül 47): cari hesaplar ve ekstre, kasa / banka hesapları ve hareketleri,
 * çek / senet portföyü, tahsilat / ödeme / virman fişleri ve otomatik kayıtların eşlemesi.
 *
 * Kararlar (kullanıcı, 30 Ekim 2026):
 * - **Alacak operasyondan doğar** (fatura modülü 16 henüz yok): folyo "Acente / cari" (ya da voucher) ile
 *   kapatılınca seçilen cariye borç; etkinlik gerçekleşince (ya da iptal bedeli kesinleşince) etkinlik
 *   müşterisinin carisine borç; etkinlik tahsilatı cariden düşer. Mal kabul tedarikçi carisine vadeli
 *   alacak (bizim borcumuz), onaylanan acente primi acente carisine alacak yazar. `invoice.issued`
 *   sözleşmesi tanımlıdır; 16 gelince fatura numarası mevcut cari harekete bağlanır, ikinci alacak yazılmaz.
 * - **Şirket carisi ödemede seçilir:** folyoda "Acente / cari" ya da voucher seçilince cari hesap seçilir
 *   (varsayılan rezervasyonun acentesi). Acentesiz rezervasyonda seçim zorunludur.
 * - **Başlangıç günü:** muhasebe ayarındaki günden (dahil) sonraki belgeler otomatik işlenir; öncesi için
 *   cari / kasa / banka açılış bakiyesi girilir. Ayar yoksa ilk kullanıldığı iş günü başlangıç olur.
 * - Para birimi otelin para birimidir (cari ve çek / senet); kasa ve banka hesabı kendi para birimindedir
 *   (döviz kasası). Dövizli tahsilat kasaya kendi para biriminde, otel para birimine çevrilmiş tutar
 *   cariye yazılır.
 */

/* ─────────────── Cari hesap ─────────────── */

/** Prisma `LedgerAccountType` ile birebir. */
export const LEDGER_ACCOUNT_TYPES = Object.freeze(['AGENCY', 'SUPPLIER', 'COMPANY', 'PERSON', 'OTHER']);
export const LEDGER_ACCOUNT_TYPE_LABELS = Object.freeze({ AGENCY: 'Acente', SUPPLIER: 'Tedarikçi', COMPANY: 'Şirket', PERSON: 'Şahıs', OTHER: 'Diğer' });
/** Elle açılabilen türler: acente ve tedarikçi carisi kartından (modül 29 / 45) bağlanarak açılır. */
export const MANUAL_LEDGER_ACCOUNT_TYPES = Object.freeze(['COMPANY', 'PERSON', 'OTHER']);
/** Cari kodu önekleri (otel × önek sırası). */
export const LEDGER_ACCOUNT_CODE_PREFIXES = Object.freeze({ AGENCY: 'ACN', SUPPLIER: 'TED', COMPANY: 'SRK', PERSON: 'KIS', OTHER: 'DGR' });

/** Prisma `LedgerSource` ile birebir: cari hareketin kaynağı. */
export const LEDGER_SOURCES = Object.freeze(['OPENING', 'FOLIO_TRANSFER', 'EVENT_CHARGE', 'EVENT_PAYMENT', 'GOODS_RECEIPT', 'AGENCY_BONUS', 'VOUCHER', 'INSTRUMENT', 'INVOICE']);
export const LEDGER_SOURCE_LABELS = Object.freeze({
  OPENING: 'Açılış bakiyesi',
  FOLIO_TRANSFER: 'Folyo aktarımı',
  EVENT_CHARGE: 'Etkinlik bedeli',
  EVENT_PAYMENT: 'Etkinlik tahsilatı',
  GOODS_RECEIPT: 'Mal kabul',
  AGENCY_BONUS: 'Acente primi',
  VOUCHER: 'Fiş',
  INSTRUMENT: 'Çek / senet',
  INVOICE: 'Fatura',
});

/** Folyoda cariye aktaran ödeme yöntemleri: tutar kasaya değil seçilen cariye borç yazılır. */
export const LEDGER_PAYMENT_METHODS = Object.freeze(['AGENCY', 'VOUCHER']);

/* ─────────────── Kasa / banka ─────────────── */

/** Prisma `TreasuryKind` ile birebir. */
export const TREASURY_KINDS = Object.freeze(['CASH', 'BANK']);
export const TREASURY_KIND_LABELS = Object.freeze({ CASH: 'Kasa', BANK: 'Banka' });
export const TREASURY_CODE_PREFIXES = Object.freeze({ CASH: 'KSA', BANK: 'BNK' });

/** Prisma `TreasurySource` ile birebir: kasa / banka hareketinin kaynağı. */
export const TREASURY_SOURCES = Object.freeze(['OPENING', 'FOLIO_PAYMENT', 'EVENT_PAYMENT', 'POS_PAYMENT', 'VOUCHER', 'INSTRUMENT']);
export const TREASURY_SOURCE_LABELS = Object.freeze({
  OPENING: 'Açılış bakiyesi',
  FOLIO_PAYMENT: 'Ön büro tahsilatı',
  EVENT_PAYMENT: 'Etkinlik tahsilatı',
  POS_PAYMENT: 'Restoran tahsilatı',
  VOUCHER: 'Fiş',
  INSTRUMENT: 'Çek / senet',
});

/** Prisma `TreasuryChannel` ile birebir: otomatik tahsilatın geldiği yer (eşleme bunun üstüne kurulur). */
export const TREASURY_CHANNELS = Object.freeze(['FRONT_DESK', 'BANQUET', 'POS']);
export const TREASURY_CHANNEL_LABELS = Object.freeze({ FRONT_DESK: 'Ön büro (folyo)', BANQUET: 'Etkinlik', POS: 'Restoran ve oda servisi' });
/** Kanalda kasaya / bankaya giden yöntemler (cari yöntemleri eşlenmez). */
export const TREASURY_CHANNEL_METHODS = Object.freeze({
  FRONT_DESK: Object.freeze(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS']),
  BANQUET: Object.freeze(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS']),
  POS: Object.freeze(['CASH', 'CARD']),
});
/** Yöntem başına önerilen hesap türü (nakit kasaya, diğerleri bankaya). */
export const TREASURY_METHOD_KIND = Object.freeze({ CASH: 'CASH', CARD: 'BANK', TRANSFER: 'BANK', VIRTUAL_POS: 'BANK' });

/* ─────────────── Fiş ─────────────── */

/** Prisma `AccountingVoucherType` ile birebir. */
export const VOUCHER_TYPES = Object.freeze(['COLLECTION', 'PAYMENT', 'TRANSFER', 'TREASURY_IN', 'TREASURY_OUT', 'OPENING']);
export const VOUCHER_TYPE_LABELS = Object.freeze({
  COLLECTION: 'Tahsilat fişi',
  PAYMENT: 'Ödeme fişi',
  TRANSFER: 'Virman',
  TREASURY_IN: 'Kasa / banka girişi',
  TREASURY_OUT: 'Kasa / banka çıkışı',
  OPENING: 'Açılış bakiyesi',
});
export const VOUCHER_PREFIXES = Object.freeze({ COLLECTION: 'TAH', PAYMENT: 'ODM', TRANSFER: 'VRM', TREASURY_IN: 'GIR', TREASURY_OUT: 'CIK', OPENING: 'ACL' });
/** Prisma `AccountingVoucherStatus` ile birebir. */
export const VOUCHER_STATUSES = Object.freeze(['POSTED', 'PENDING_APPROVAL', 'DECLINED', 'VOIDED']);
export const VOUCHER_STATUS_LABELS = Object.freeze({ POSTED: 'İşlendi', PENDING_APPROVAL: 'Onay bekliyor', DECLINED: 'Reddedildi', VOIDED: 'İptal edildi' });
/** Prisma `VoucherLineKind` ile birebir: fişin para satırı. */
export const VOUCHER_LINE_KINDS = Object.freeze(['TREASURY', 'CHEQUE_IN', 'CHEQUE_OUT', 'ENDORSE']);
export const VOUCHER_LINE_KIND_LABELS = Object.freeze({
  TREASURY: 'Kasa / banka',
  CHEQUE_IN: 'Alınan çek / senet',
  CHEQUE_OUT: 'Verilen çek / senet',
  ENDORSE: 'Portföyden ciro',
});
/** Fiş türüne göre kullanılabilen satır türleri. */
export const VOUCHER_LINE_KINDS_BY_TYPE = Object.freeze({
  COLLECTION: Object.freeze(['TREASURY', 'CHEQUE_IN']),
  PAYMENT: Object.freeze(['TREASURY', 'CHEQUE_OUT', 'ENDORSE']),
});
/** Açılış bakiyesinin yönü: cari için borç (cari bize borçlu) ya da alacak (biz cariye borçluyuz). */
export const OPENING_SIDES = Object.freeze(['DEBIT', 'CREDIT']);
export const OPENING_SIDE_LABELS = Object.freeze({ DEBIT: 'Borç (cari bize borçlu)', CREDIT: 'Alacak (biz cariye borçluyuz)' });

/* ─────────────── Çek / senet ─────────────── */

/** Prisma `InstrumentKind` ile birebir. */
export const INSTRUMENT_KINDS = Object.freeze(['CHEQUE', 'NOTE']);
export const INSTRUMENT_KIND_LABELS = Object.freeze({ CHEQUE: 'Çek', NOTE: 'Senet' });
/** Prisma `InstrumentDirection` ile birebir: alınan (müşteriden) ya da verilen (bizim). */
export const INSTRUMENT_DIRECTIONS = Object.freeze(['RECEIVED', 'ISSUED']);
export const INSTRUMENT_DIRECTION_LABELS = Object.freeze({ RECEIVED: 'Alınan', ISSUED: 'Verilen' });
/** Prisma `InstrumentStatus` ile birebir. */
export const INSTRUMENT_STATUSES = Object.freeze(['PORTFOLIO', 'AT_BANK', 'COLLECTED', 'ENDORSED', 'BOUNCED', 'RETURNED', 'OUTSTANDING', 'PAID', 'CANCELLED']);
export const INSTRUMENT_STATUS_LABELS = Object.freeze({
  PORTFOLIO: 'Portföyde',
  AT_BANK: 'Tahsilde (bankada)',
  COLLECTED: 'Tahsil edildi',
  ENDORSED: 'Ciro edildi',
  BOUNCED: 'Karşılıksız',
  RETURNED: 'İade edildi',
  OUTSTANDING: 'Ödenecek',
  PAID: 'Ödendi',
  CANCELLED: 'İptal (fiş iptali)',
});
/** Henüz sonuçlanmamış (vadesi izlenen) durumlar. */
export const OPEN_INSTRUMENT_STATUSES = Object.freeze(['PORTFOLIO', 'AT_BANK', 'OUTSTANDING']);
/** Prisma `InstrumentAction` ile birebir: durum geçmişindeki işlem. */
export const INSTRUMENT_ACTIONS = Object.freeze(['RECEIVE', 'ISSUE', 'DEPOSIT', 'WITHDRAW', 'COLLECT', 'ENDORSE', 'BOUNCE', 'RETURN', 'PAY', 'CANCEL']);
export const INSTRUMENT_ACTION_LABELS = Object.freeze({
  RECEIVE: 'Portföye alındı',
  ISSUE: 'Verildi',
  DEPOSIT: 'Tahsile verildi',
  WITHDRAW: 'Bankadan geri alındı',
  COLLECT: 'Tahsil edildi',
  ENDORSE: 'Ciro edildi',
  BOUNCE: 'Karşılıksız',
  RETURN: 'İade edildi',
  PAY: 'Ödendi',
  CANCEL: 'Fiş iptaliyle iptal',
});
/** Personelin çek / senet ekranından yaptığı işlemler (ciro ödeme fişiyle, alış / veriş fişle yapılır). */
export const INSTRUMENT_MANUAL_ACTIONS = Object.freeze(['DEPOSIT', 'WITHDRAW', 'COLLECT', 'BOUNCE', 'RETURN', 'PAY']);

/* ─────────────── Sınırlar ─────────────── */

export const MAX_ACCOUNTING_AMOUNT = 100_000_000;
export const MAX_ACCOUNT_NAME_LENGTH = 160;
export const MAX_ACCOUNT_CODE_LENGTH = 24;
export const MAX_LEDGER_TERM_DAYS = 365;
export const MAX_ACCOUNTING_TEXT_LENGTH = 300;
export const MAX_ACCOUNTING_NOTE_LENGTH = 1000;
export const MAX_REFERENCE_LENGTH = 60;
export const MAX_INSTRUMENT_NUMBER_LENGTH = 40;
/** Bir fişte en fazla para satırı (ör. 12 çekle tahsilat). */
export const MAX_VOUCHER_LINES = 30;
/** Ekstre / hareket sorgusunun en uzun dönemi. */
export const MAX_STATEMENT_DAYS = 3 * 366;
/** Çek / senet vadesi belge gününden en fazla bu kadar gün sonra (yazım hatasını yakalar). */
export const MAX_INSTRUMENT_TERM_DAYS = 3 * 366;
/** Ödeme fişi onay eşiği üst sınırı ve onayın süresi. */
export const MAX_PAYMENT_APPROVAL_AMOUNT = 100_000_000;
export const ACCOUNTING_PAYMENT_APPROVAL_DAYS = 3;
/** Fişin geriye dönük girilebileceği en fazla gün (başlangıç gününden önce olamaz). */
export const MAX_VOUCHER_BACKDATE_DAYS = 400;
/** Eşitleme (eksik otomatik kayıtları tamamla) en uzun dönemi. */
export const MAX_SYNC_DAYS = 400;
/** Seçici (cari / kasa-banka arama) sonucu. */
export const MAX_ACCOUNT_PICKER_RESULTS = 30;
/** Vadesi yaklaşan çek / senet uyarısı (gün). */
export const INSTRUMENT_DUE_SOON_DAYS = 7;
/** Yaşlandırma dilimleri (gün, vadeden bu yana): 0–30, 31–60, 61–90, 90+. */
export const AGING_BUCKETS = Object.freeze([
  Object.freeze({ key: 'NOT_DUE', label: 'Vadesi gelmemiş', from: null, to: 0 }),
  Object.freeze({ key: 'D30', label: '1–30 gün', from: 1, to: 30 }),
  Object.freeze({ key: 'D60', label: '31–60 gün', from: 31, to: 60 }),
  Object.freeze({ key: 'D90', label: '61–90 gün', from: 61, to: 90 }),
  Object.freeze({ key: 'D90_PLUS', label: '90+ gün', from: 91, to: null }),
]);

/* ─────────────── Saf kurallar ─────────────── */

/** "123.45" → kuruş (BigInt); eksi işaret desteklenir. @param {string | number} text */
export function toCents(text) {
  const value = String(text).trim();
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Kuruş → "123.45". @param {bigint} cents */
export function fromCents(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * TR IBAN denetimi: "TR" + 24 hane, ISO 13616 mod-97 = 1. Boşluklar atılır, harfler büyütülür.
 * @param {string} value
 */
export function isValidIban(value) {
  const iban = String(value).replace(/\s+/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** IBAN'ı dörtlü gruplarla yazar: "TR12 0006 …". @param {string} value */
export function formatIban(value) {
  return String(value).replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Çek / senet durum makinesi: yön ve durumdan yapılabilecek elle işlemler.
 * Alınan: portföy → tahsile ver / kasadan-bankadan tahsil / iade / karşılıksız; bankada → tahsil /
 * karşılıksız / geri al; ciro edilmiş → karşılıksız (ciro edilen döndü). Verilen: ödenecek → ödendi /
 * karşılıksız / iade.
 *
 * @param {'RECEIVED' | 'ISSUED'} direction
 * @param {string} status
 * @returns {string[]}
 */
export function instrumentActions(direction, status) {
  if (direction === 'RECEIVED') {
    if (status === 'PORTFOLIO') return ['DEPOSIT', 'COLLECT', 'RETURN', 'BOUNCE'];
    if (status === 'AT_BANK') return ['COLLECT', 'BOUNCE', 'WITHDRAW'];
    if (status === 'ENDORSED') return ['BOUNCE'];
    return [];
  }
  if (status === 'OUTSTANDING') return ['PAY', 'BOUNCE', 'RETURN'];
  return [];
}

/**
 * Elle işlemin sonucu: yeni durum ve muhasebe etkisi (saf; servis bunu kayda çevirir).
 * - `treasury`: kasa / banka hareketi işareti (+ giriş, − çıkış) ya da yok
 * - `ledger`: cari etkisi — çekin carisine borç (`DEBIT`) ya da alacak (`CREDIT`); ciro edilmiş çek
 *   döndüğünde ciro edilen cariye alacak (`endorseeCredit`)
 *
 * @param {'RECEIVED' | 'ISSUED'} direction
 * @param {string} status
 * @param {string} action
 * @returns {{ status: string, treasury: 1 | -1 | 0, ledger: 'DEBIT' | 'CREDIT' | null, endorseeCredit: boolean, needsTreasury: boolean }}
 */
export function instrumentTransition(direction, status, action) {
  if (!instrumentActions(direction, status).includes(action)) {
    throw new Error(`Geçersiz çek / senet işlemi: ${direction} ${status} → ${action}`);
  }
  const none = { treasury: /** @type {0} */ (0), ledger: null, endorseeCredit: false, needsTreasury: false };
  if (direction === 'RECEIVED') {
    switch (action) {
      case 'DEPOSIT':
        return { ...none, status: 'AT_BANK', needsTreasury: true };
      case 'WITHDRAW':
        return { ...none, status: 'PORTFOLIO' };
      case 'COLLECT':
        return { ...none, status: 'COLLECTED', treasury: 1, needsTreasury: status === 'PORTFOLIO' };
      case 'RETURN':
        return { ...none, status: 'RETURNED', ledger: 'DEBIT' };
      default:
        // Karşılıksız: müşteri yeniden borçlanır; ciro edilmişse ciro edilen cariye borcumuz geri doğar.
        return { ...none, status: 'BOUNCED', ledger: 'DEBIT', endorseeCredit: status === 'ENDORSED' };
    }
  }
  switch (action) {
    case 'PAY':
      return { ...none, status: 'PAID', treasury: -1, needsTreasury: true };
    case 'RETURN':
      return { ...none, status: 'RETURNED', ledger: 'CREDIT' };
    default:
      return { ...none, status: 'BOUNCED', ledger: 'CREDIT' };
  }
}

/**
 * Fişin cari ve kasa / banka etkisi (saf): satırların toplamı, carinin yönü ve hareket işaretleri.
 * Tahsilat: cari alacaklanır (borcu düşer), kasa / banka girer, alınan çek portföye girer. Ödeme: cari
 * borçlanır (bizim borcumuz düşer), kasa / banka çıkar, verilen çek "ödenecek" olur, portföydeki çek
 * ciro edilir. Virman: kaynaktan çıkar, hedefe girer. Giriş / çıkış: yalnız kasa / banka.
 *
 * @param {'COLLECTION' | 'PAYMENT' | 'TRANSFER' | 'TREASURY_IN' | 'TREASURY_OUT'} type
 * @param {Array<{ kind: string, amount: string }>} lines
 * @returns {{ total: string, ledgerSide: 'DEBIT' | 'CREDIT' | null, treasurySign: 1 | -1 | 0 }}
 */
export function voucherEffect(type, lines) {
  const total = fromCents(lines.reduce((sum, line) => sum + toCents(line.amount), 0n));
  if (type === 'COLLECTION') return { total, ledgerSide: 'CREDIT', treasurySign: 1 };
  if (type === 'PAYMENT') return { total, ledgerSide: 'DEBIT', treasurySign: -1 };
  if (type === 'TREASURY_IN') return { total, ledgerSide: null, treasurySign: 1 };
  if (type === 'TREASURY_OUT') return { total, ledgerSide: null, treasurySign: -1 };
  return { total, ledgerSide: null, treasurySign: 0 };
}

/** Ödeme fişi onaya gider mi: eşik > 0 ve toplam ≥ eşik. @param {string} total @param {string} threshold */
export function needsPaymentApproval(total, threshold) {
  const limit = toCents(threshold);
  return limit > 0n && toCents(total) >= limit;
}

/**
 * Yaşlandırma (FIFO): bakiye, bakiyenin yönündeki **en yeni** hareketlerle kapanmış sayılır (eski
 * borçlar önce ödenmiş kabul edilir); kalan her parça vadesine (yoksa belge gününe) göre dilime girer.
 * Bakiye artıysa borç hareketleri (cari bize borçlu), eksiyse alacak hareketleri (biz borçluyuz) yaşlanır.
 *
 * @param {Array<{ date: string, dueDate: string | null, debit: string, credit: string }>} entries
 *   carinin hareketleri (sıra önemsiz)
 * @param {string} balance borç − alacak
 * @param {string} today "YYYY-AA-GG"
 * @returns {{ side: 'DEBIT' | 'CREDIT' | null, buckets: Record<string, string>, overdue: string, oldestDueDate: string | null }}
 */
export function ageBalance(entries, balance, today) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, 0n]));
  const total = toCents(balance);
  const side = total > 0n ? 'DEBIT' : total < 0n ? 'CREDIT' : null;
  let remaining = total < 0n ? -total : total;
  let oldestDueDate = null;
  if (side) {
    const candidates = entries
      .map((entry) => ({ ...entry, amount: toCents(side === 'DEBIT' ? entry.debit : entry.credit) }))
      .filter((entry) => entry.amount > 0n)
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    for (const entry of candidates) {
      if (remaining === 0n) break;
      const part = entry.amount < remaining ? entry.amount : remaining;
      remaining -= part;
      const due = entry.dueDate ?? entry.date;
      const late = Math.round((todayMs - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
      const bucket = AGING_BUCKETS.find((candidate) => (candidate.from === null ? late <= candidate.to : late >= candidate.from && (candidate.to === null || late <= candidate.to)));
      buckets[bucket.key] += part;
      if (!oldestDueDate || due < oldestDueDate) oldestDueDate = due;
    }
    // Hareketlerle açıklanamayan kalan (açılış öncesi farkı) en eski dilime yazılmaz: vadesi bilinmez.
    buckets.NOT_DUE += remaining;
  }
  const overdue = AGING_BUCKETS.filter((bucket) => bucket.key !== 'NOT_DUE').reduce((sum, bucket) => sum + buckets[bucket.key], 0n);
  return {
    side,
    buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, fromCents(value)])),
    overdue: fromCents(overdue),
    oldestDueDate,
  };
}

/**
 * Eşleme çözümü: kanal × yöntem × para birimi için hesap. Önce tam para birimi, sonra "her para birimi"
 * (boş) satırı. @param {Array<{ channel: string, method: string, currency: string, treasuryAccountId: string }>} mappings
 * @param {{ channel: string, method: string, currency: string }} key
 */
export function resolveTreasuryMapping(mappings, { channel, method, currency }) {
  const exact = mappings.find((row) => row.channel === channel && row.method === method && row.currency === currency);
  if (exact) return exact.treasuryAccountId;
  return mappings.find((row) => row.channel === channel && row.method === method && row.currency === '')?.treasuryAccountId ?? null;
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const requiredText = (max, label, min = 1) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(min, min > 1 ? `${label} en az ${min} karakter` : `${label} zorunlu`)
    .max(max, `${label} en fazla ${max} karakter`);

const amountField = (label = 'Tutar') =>
  decimalField({ scale: 2, min: 0.01, max: MAX_ACCOUNTING_AMOUNT, label }).refine((value) => toCents(value) > 0n, { message: `${label} sıfırdan büyük olmalı` });

const termDaysField = z.coerce
  .number({ error: 'Vade günü sayı olmalı' })
  .int('Vade günü tam sayı olmalı')
  .min(0, 'Vade günü eksi olamaz')
  .max(MAX_LEDGER_TERM_DAYS, `Vade en fazla ${MAX_LEDGER_TERM_DAYS} gün`);

const currencyField = z
  .string({ error: 'Para birimi zorunlu' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Para birimi 3 harfli kod olmalı (TRY, EUR…)');

const taxNumberField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ''))
  .refine((value) => value === '' || /^\d{10,11}$/.test(value), { message: 'Vergi / TC kimlik no 10 ya da 11 hane olmalı' })
  .transform((value) => value || null)
  .nullish();

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), { message: 'Geçersiz e-posta' })
  .transform((value) => value || null)
  .nullish();

const ibanField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => value === '' || isValidIban(value), { message: 'Geçersiz IBAN (TR + 24 hane, denetim hanesi tutmalı)' })
  .transform((value) => value || null)
  .nullish();

const accountFields = {
  name: requiredText(MAX_ACCOUNT_NAME_LENGTH, 'Ünvan', 2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(MAX_ACCOUNT_CODE_LENGTH, `Kod en fazla ${MAX_ACCOUNT_CODE_LENGTH} karakter`)
    .refine((value) => value === '' || /^[A-Z0-9.\-_]+$/.test(value), { message: 'Kod yalnız harf, rakam, nokta, tire içerebilir' })
    .transform((value) => value || null)
    .nullish(),
  taxOffice: optionalText(80, 'Vergi dairesi'),
  taxNumber: taxNumberField,
  contactName: optionalText(120, 'Yetkili'),
  phone: optionalText(40, 'Telefon'),
  email: emailField,
  address: optionalText(400, 'Adres'),
  paymentTermDays: termDaysField.default(0),
  notes: optionalText(MAX_ACCOUNTING_NOTE_LENGTH, 'Not'),
};

/** Elle cari aç (şirket / şahıs / diğer). Kod boşsa türün önekiyle sıradaki numara. */
export const ledgerAccountCreateSchema = z.object({ type: z.enum(MANUAL_LEDGER_ACCOUNT_TYPES, { error: 'Cari türü seçin' }), ...accountFields });

/** Cari kartı düzenle (bağlı acente / tedarikçi carisinde ünvan ve vergi bilgisi o karttan gelir). */
export const ledgerAccountUpdateSchema = z.object({ expectedUpdatedAt, ...accountFields, isActive: z.boolean().default(true) });

/** Acente / tedarikçi / etkinlik müşterisi için cariyi aç ya da var olanı getir. */
export const ledgerAccountLinkSchema = z
  .object({
    agencyId: uuid('Geçersiz acente').nullish(),
    supplierId: uuid('Geçersiz tedarikçi').nullish(),
    eventClientId: uuid('Geçersiz etkinlik müşterisi').nullish(),
  })
  .refine((value) => [value.agencyId, value.supplierId, value.eventClientId].filter(Boolean).length === 1, { message: 'Bir kart seçin' });

export const ledgerAccountListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120, 'Arama en fazla 120 karakter').optional(),
  type: z.enum(LEDGER_ACCOUNT_TYPES, { error: 'Geçersiz tür' }).optional(),
  /** Bakiyeli olanlar: borçlu (cari bize borçlu) / alacaklı (biz borçluyuz). */
  balance: z.enum(['DEBIT', 'CREDIT', 'ANY'], { error: 'Geçersiz bakiye süzgeci' }).optional(),
  active: z.enum(['true', 'false', 'all'], { error: 'Geçersiz durum' }).default('true'),
  sort: z.enum(['name', 'balance', 'code'], { error: 'Geçersiz sıralama' }).default('name'),
});

/** Seçici (fiş, ödeme penceresi): ad / kod araması, yalnız etkin cariler. */
export const ledgerAccountPickerQuerySchema = z.object({
  search: z.string().trim().max(120, 'Arama en fazla 120 karakter').default(''),
  type: z.enum(LEDGER_ACCOUNT_TYPES, { error: 'Geçersiz tür' }).optional(),
});

const periodFields = { from: isoDayField.optional(), to: isoDayField.optional() };
const pageFields = {
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: z.coerce.number({ error: 'Sayfa boyutu sayı olmalı' }).int().min(1).max(200, 'Sayfa boyutu en fazla 200').default(100),
};

/** Dönem denetimi: bitiş başlangıçtan önce olamaz, dönem en fazla `MAX_STATEMENT_DAYS`. */
function refinePeriod(value, ctx) {
  if (value.from && value.to && value.from > value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  else if (value.from && value.to && (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 > MAX_STATEMENT_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Dönem en fazla ${MAX_STATEMENT_DAYS} gün` });
  }
}

/** Ekstre: dönem (varsayılan yılbaşından bugüne), imleçli (belge günü + kimlik). */
export const statementQuerySchema = z.object({ ...periodFields, ...pageFields }).superRefine(refinePeriod);

/** Kasa / banka hesabı. */
const treasuryFields = {
  name: requiredText(MAX_ACCOUNT_NAME_LENGTH, 'Ad', 2),
  code: accountFields.code,
  currency: currencyField,
  bankName: optionalText(80, 'Banka'),
  branch: optionalText(80, 'Şube'),
  iban: ibanField,
  accountNumber: optionalText(40, 'Hesap no'),
  notes: optionalText(MAX_ACCOUNTING_NOTE_LENGTH, 'Not'),
};

function refineTreasury(value, ctx) {
  if (value.kind === 'BANK' && !value.bankName) ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'Banka adı zorunlu' });
  if (value.kind === 'CASH' && (value.bankName || value.iban || value.branch || value.accountNumber)) {
    ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'Kasada banka bilgisi olmaz' });
  }
}

export const treasuryAccountCreateSchema = z.object({ kind: z.enum(TREASURY_KINDS, { error: 'Hesap türü seçin' }), ...treasuryFields }).superRefine(refineTreasury);

/** Para birimi ve tür hareket gördükten sonra değişmez (servis denetler). */
export const treasuryAccountUpdateSchema = z
  .object({ expectedUpdatedAt, kind: z.enum(TREASURY_KINDS, { error: 'Hesap türü seçin' }), ...treasuryFields, isActive: z.boolean().default(true) })
  .superRefine(refineTreasury);

/** Kasa / banka hareketleri: dönem + imleç; kaynak süzgeci. */
export const treasuryMovementsQuerySchema = z
  .object({ ...periodFields, ...pageFields, source: z.enum(TREASURY_SOURCES, { error: 'Geçersiz kaynak' }).optional() })
  .superRefine(refinePeriod);

/** Yöntem → kasa / banka eşlemesi (bütün tablo tek seferde). */
export const treasuryMappingSchema = z
  .object({
    expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
    rows: z
      .array(
        z.object({
          channel: z.enum(TREASURY_CHANNELS, { error: 'Geçersiz kanal' }),
          method: z.enum(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS'], { error: 'Geçersiz yöntem' }),
          /** Boş: her para birimi. */
          currency: z
            .string()
            .trim()
            .toUpperCase()
            .refine((value) => value === '' || /^[A-Z]{3}$/.test(value), { message: 'Para birimi 3 harfli kod ya da boş olmalı' })
            .default(''),
          treasuryAccountId: uuid('Hesap seçin'),
        }),
      )
      .max(60, 'En fazla 60 eşleme satırı'),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.rows.forEach((row, index) => {
      if (!TREASURY_CHANNEL_METHODS[row.channel].includes(row.method)) {
        ctx.addIssue({ code: 'custom', path: ['rows', index, 'method'], message: `${TREASURY_CHANNEL_LABELS[row.channel]} bu yöntemle tahsilat almaz` });
      }
      const key = `${row.channel}:${row.method}:${row.currency}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['rows', index, 'currency'], message: 'Aynı kanal, yöntem ve para birimi iki kez eşlenemez' });
      seen.add(key);
    });
  });

/** Muhasebe ayarı: başlangıç günü ve ödeme fişi onay eşiği. */
export const accountingSettingsSchema = z.object({
  expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
  startDate: isoDayField,
  paymentApprovalAmount: decimalField({ scale: 2, min: 0, max: MAX_PAYMENT_APPROVAL_AMOUNT, label: 'Onay eşiği' }),
});

/** Fiş satırı: kasa / banka, alınan / verilen çek-senet ya da portföyden ciro. */
const voucherLineSchema = z
  .object({
    kind: z.enum(VOUCHER_LINE_KINDS, { error: 'Satır türü seçin' }),
    amount: amountField(),
    treasuryAccountId: uuid('Kasa / banka seçin').nullish(),
    /** Ciro: portföydeki çek / senet. */
    instrumentId: uuid('Çek / senet seçin').nullish(),
    /** Yeni çek / senet (alınan ya da verilen). */
    instrumentKind: z.enum(INSTRUMENT_KINDS, { error: 'Çek mi senet mi?' }).nullish(),
    number: optionalText(MAX_INSTRUMENT_NUMBER_LENGTH, 'Çek / senet no'),
    bankName: optionalText(80, 'Banka'),
    branch: optionalText(80, 'Şube'),
    drawer: optionalText(MAX_ACCOUNT_NAME_LENGTH, 'Keşideci / borçlu'),
    dueDate: isoDayField.nullish(),
  })
  .superRefine((line, ctx) => {
    if (line.kind === 'TREASURY' && !line.treasuryAccountId) ctx.addIssue({ code: 'custom', path: ['treasuryAccountId'], message: 'Kasa / banka seçin' });
    if (line.kind === 'ENDORSE' && !line.instrumentId) ctx.addIssue({ code: 'custom', path: ['instrumentId'], message: 'Ciro edilecek çek / senedi seçin' });
    if (line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT') {
      if (!line.instrumentKind) ctx.addIssue({ code: 'custom', path: ['instrumentKind'], message: 'Çek mi senet mi?' });
      if (!line.number) ctx.addIssue({ code: 'custom', path: ['number'], message: 'Çek / senet no zorunlu' });
      if (!line.dueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Vade zorunlu' });
      if (line.instrumentKind === 'CHEQUE' && !line.bankName) ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'Çekin bankası zorunlu' });
    }
    if (line.kind === 'CHEQUE_OUT' && line.instrumentKind === 'CHEQUE' && !line.treasuryAccountId) {
      ctx.addIssue({ code: 'custom', path: ['treasuryAccountId'], message: 'Çekin ödeneceği banka hesabını seçin' });
    }
  });

/**
 * Fiş: tahsilat / ödeme (cari + satırlar), virman (kaynak → hedef), kasa / banka girişi-çıkışı.
 * `requestId` çift gönderimde ikinci fişi engeller.
 */
export const voucherCreateSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    type: z.enum(['COLLECTION', 'PAYMENT', 'TRANSFER', 'TREASURY_IN', 'TREASURY_OUT'], { error: 'Fiş türü seçin' }),
    date: isoDayField,
    ledgerAccountId: uuid('Cari seçin').nullish(),
    treasuryAccountId: uuid('Kasa / banka seçin').nullish(),
    targetTreasuryAccountId: uuid('Hedef kasa / banka seçin').nullish(),
    amount: amountField().nullish(),
    lines: z.array(voucherLineSchema).max(MAX_VOUCHER_LINES, `Bir fişte en fazla ${MAX_VOUCHER_LINES} satır`).default([]),
    description: requiredText(MAX_ACCOUNTING_TEXT_LENGTH, 'Açıklama', 3),
    reference: optionalText(MAX_REFERENCE_LENGTH, 'Belge no'),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'COLLECTION' || value.type === 'PAYMENT') {
      if (!value.ledgerAccountId) ctx.addIssue({ code: 'custom', path: ['ledgerAccountId'], message: 'Cari seçin' });
      if (value.lines.length === 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'En az bir satır girin' });
      value.lines.forEach((line, index) => {
        if (!VOUCHER_LINE_KINDS_BY_TYPE[value.type].includes(line.kind)) {
          ctx.addIssue({ code: 'custom', path: ['lines', index, 'kind'], message: `${VOUCHER_TYPE_LABELS[value.type]} bu satırı almaz` });
        }
      });
      const endorsed = value.lines.filter((line) => line.kind === 'ENDORSE').map((line) => line.instrumentId);
      if (new Set(endorsed).size !== endorsed.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Aynı çek / senet iki kez ciro edilemez' });
      return;
    }
    if (value.lines.length > 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Bu fiş satır almaz' });
    if (!value.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Tutar zorunlu' });
    if (!value.treasuryAccountId) ctx.addIssue({ code: 'custom', path: ['treasuryAccountId'], message: value.type === 'TRANSFER' ? 'Kaynak kasa / banka seçin' : 'Kasa / banka seçin' });
    if (value.type === 'TRANSFER') {
      if (!value.targetTreasuryAccountId) ctx.addIssue({ code: 'custom', path: ['targetTreasuryAccountId'], message: 'Hedef kasa / banka seçin' });
      else if (value.targetTreasuryAccountId === value.treasuryAccountId) ctx.addIssue({ code: 'custom', path: ['targetTreasuryAccountId'], message: 'Kaynak ve hedef aynı olamaz' });
    }
  });

/** Açılış bakiyesi: başlangıç gününde cari (borç / alacak) ya da kasa / banka (giriş). Hesap başına bir kez. */
export const openingBalanceSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    ledgerAccountId: uuid('Cari seçin').nullish(),
    treasuryAccountId: uuid('Kasa / banka seçin').nullish(),
    side: z.enum(OPENING_SIDES, { error: 'Borç mu alacak mı?' }).default('DEBIT'),
    amount: amountField(),
    dueDate: isoDayField.nullish(),
    description: optionalText(MAX_ACCOUNTING_TEXT_LENGTH, 'Açıklama'),
  })
  .refine((value) => Boolean(value.ledgerAccountId) !== Boolean(value.treasuryAccountId), { message: 'Bir cari ya da bir kasa / banka seçin', path: ['ledgerAccountId'] });

/** Fiş iptali (ters kayıt): gerekçe zorunlu. */
export const voucherVoidSchema = z.object({ reason: requiredText(500, 'Gerekçe', 5) });

export const voucherListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(VOUCHER_TYPES, { error: 'Geçersiz fiş türü' }).optional(),
  status: z.enum(VOUCHER_STATUSES, { error: 'Geçersiz durum' }).optional(),
  ledgerAccountId: uuid('Geçersiz cari').optional(),
  treasuryAccountId: uuid('Geçersiz kasa / banka').optional(),
  search: z.string().trim().max(120, 'Arama en fazla 120 karakter').optional(),
  from: isoDayField.optional(),
  to: isoDayField.optional(),
});

/** Çek / senet portföyü: yön, durum, vade aralığı, cari, arama. */
export const instrumentListQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(INSTRUMENT_DIRECTIONS, { error: 'Geçersiz yön' }).optional(),
  status: z.enum([...INSTRUMENT_STATUSES, 'OPEN'], { error: 'Geçersiz durum' }).optional(),
  kind: z.enum(INSTRUMENT_KINDS, { error: 'Geçersiz tür' }).optional(),
  ledgerAccountId: uuid('Geçersiz cari').optional(),
  dueFrom: isoDayField.optional(),
  dueTo: isoDayField.optional(),
  search: z.string().trim().max(120, 'Arama en fazla 120 karakter').optional(),
});

/** Çek / senet elle işlemi (tahsile ver, tahsil, karşılıksız, iade, geri al, ödendi). */
export const instrumentActionSchema = z.object({
  expectedUpdatedAt,
  action: z.enum(INSTRUMENT_MANUAL_ACTIONS, { error: 'İşlem seçin' }),
  date: isoDayField,
  treasuryAccountId: uuid('Kasa / banka seçin').nullish(),
  note: optionalText(500, 'Not'),
});

/** Eksik otomatik kayıtları tamamla (aktör kapalıyken / hata sonrası): dönem. */
export const accountingSyncSchema = z
  .object({ from: isoDayField, to: isoDayField })
  .refine((value) => value.from <= value.to, { message: 'Bitiş başlangıçtan önce olamaz', path: ['to'] })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= MAX_SYNC_DAYS, { message: `Dönem en fazla ${MAX_SYNC_DAYS} gün`, path: ['to'] });

/* ─────────────── Rota parametreleri ve küçük sorgular ─────────────── */

export const ledgerAccountParamSchema = z.object({ accountId: uuid('Geçersiz cari') });
export const treasuryAccountParamSchema = z.object({ treasuryAccountId: uuid('Geçersiz kasa / banka hesabı') });
export const voucherParamSchema = z.object({ voucherId: uuid('Geçersiz fiş') });
export const instrumentParamSchema = z.object({ instrumentId: uuid('Geçersiz çek / senet') });

/** Kasa / banka listesi: tür ve (varsayılan) yalnız kullanımdakiler. */
export const treasuryListQuerySchema = z.object({
  kind: z.enum(TREASURY_KINDS, { error: 'Geçersiz hesap türü' }).optional(),
  active: z.enum(['true', 'all'], { error: 'Geçersiz durum' }).default('true'),
});

/** Yaşlandırma raporu: alacak (borçlu cariler) ya da borç (alacaklı cariler), türe göre, sayfalı. */
export const agingQuerySchema = paginationQuerySchema.extend({
  side: z.enum(['DEBIT', 'CREDIT'], { error: 'Geçersiz taraf' }).default('DEBIT'),
  type: z.enum(LEDGER_ACCOUNT_TYPES, { error: 'Geçersiz tür' }).optional(),
});
