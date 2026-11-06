import { fromCents, toCents } from './accounting.js';
import { TAX_APPLIES_TO } from './constants.js';
import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Fatura ve e-belge sözleşmeleri (modül 16'nın çekirdeği + modül 49).
 *
 * Kararlar (kullanıcı, 1 Kasım 2026):
 * - Fatura modülü (16) burada kurulur: kapanmış folyodan, gerçekleşmiş (ya da iptal bedeli kesinleşmiş)
 *   etkinlikten ve cariye serbest fatura; taslak → kesim; numara kesimde verilir.
 * - Entegratör henüz belli değil: firma bağımsız adaptör arayüzü + GİB'i taklit eden test ortamı. Canlı ortam
 *   gerçek adaptör eklenince açılır. e-Defter genel muhasebeden (48) sonraya kaldı.
 *
 * Mevzuat (kaynaklar modül raporunda):
 * - Alıcı GİB'e kayıtlı e-Fatura mükellefiyse e-Fatura (TEMELFATURA), değilse e-Arşiv (EARSIVFATURA).
 * - Fatura numarası 16 karakter: 3 karakter seri + 4 hane yıl + 9 hane sıra; ETTN (UUID) ayrıca.
 * - Konaklama vergisi 0059, KDV 0015 vergi koduyla; ikisi de KDV hariç bedel üzerinden, biri ötekinin
 *   matrahına girmez (folyo hesabı da böyle). KDV'siz satır %0 KDV + 351 "İstisna olmayan diğer" kodu taşır.
 * - Yabancı uyruklu kişiye e-Arşiv: TCKN alanına 11111111111; ad, uyruk ve pasaport faturada.
 * - Karekod (GİB Karekod Standardı Kılavuzu v1.1): vkntckn, avkntckn, senaryo, tip, tarih, no, ettn,
 *   parabirimi, malhizmettoplam, kdvmatrah(oran), hesaplanankdv(oran), vergidahil, odenecek (+ dövizde
 *   uygulanankur); ondalık nokta.
 * - Fatura hizmetin yapıldığı günden itibaren 7 gün içinde düzenlenir (VUK 231/5): süre ekranda izlenir.
 *
 * e-Fatura ve e-Arşiv satırları eksi olamaz: ters kayıtlar grubun içinde birbirini götürür, indirim satır
 * iskontosu olur; grubun neti eksiye düşerse fatura kesilmez (personel düzeltir).
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `InvoiceSource` ile birebir. */
export const INVOICE_SOURCES = Object.freeze(['FOLIO', 'EVENT', 'MANUAL']);
export const INVOICE_SOURCE_LABELS = Object.freeze({ FOLIO: 'Folyo', EVENT: 'Etkinlik', MANUAL: 'Serbest fatura' });

/** Prisma `InvoiceStatus` ile birebir. */
export const INVOICE_STATUSES = Object.freeze(['DRAFT', 'ISSUED', 'CANCEL_PENDING', 'CANCELLED']);
export const INVOICE_STATUS_LABELS = Object.freeze({ DRAFT: 'Taslak', ISSUED: 'Kesildi', CANCEL_PENDING: 'İptal onayı bekliyor', CANCELLED: 'İptal edildi' });
/** Geçerli fatura: folyo / etkinlik başına en fazla bir (veritabanı kısıtı). */
export const ACTIVE_INVOICE_STATUSES = Object.freeze(['DRAFT', 'ISSUED', 'CANCEL_PENDING']);

/** Prisma `InvoiceDocumentType` ile birebir. */
export const INVOICE_DOCUMENT_TYPES = Object.freeze(['E_FATURA', 'E_ARSIV']);
export const INVOICE_DOCUMENT_TYPE_LABELS = Object.freeze({ E_FATURA: 'e-Fatura', E_ARSIV: 'e-Arşiv' });
/** UBL `ProfileID` (senaryo). */
export const INVOICE_PROFILE_IDS = Object.freeze({ E_FATURA: 'TEMELFATURA', E_ARSIV: 'EARSIVFATURA' });
/** UBL `InvoiceTypeCode`: konaklama bedeli ve konaklama vergisi birlikte → SATIŞ. */
export const INVOICE_TYPE_CODE = 'SATIS';

/** Prisma `EDocumentState` ile birebir: e-belgenin entegratör / GİB yolculuğu. */
export const EDOC_STATES = Object.freeze(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'REJECTED', 'FAILED', 'CANCELLED']);
export const EDOC_STATE_LABELS = Object.freeze({
  QUEUED: 'Sırada',
  SENDING: 'Gönderiliyor',
  SENT: 'Entegratörde',
  DELIVERED: "GİB'de tamamlandı",
  REJECTED: 'Reddedildi',
  FAILED: 'Gönderilemedi',
  CANCELLED: 'İptal edildi',
});
/** Personelin "tekrar gönder" diyebildiği durumlar. */
export const EDOC_RESENDABLE_STATES = Object.freeze(['FAILED', 'REJECTED']);
/** Entegratöre ulaşmış (iptal artık entegratör ya da GİB portalı üstünden). */
export const EDOC_REACHED_STATES = Object.freeze(['SENT', 'DELIVERED']);

/** Prisma `InvoiceBuyerType` ile birebir. */
export const INVOICE_BUYER_TYPES = Object.freeze(['PERSON', 'COMPANY', 'FOREIGN', 'FOREIGN_COMPANY']);
export const INVOICE_BUYER_TYPE_LABELS = Object.freeze({ PERSON: 'Kişi (T.C.)', COMPANY: 'Şirket / kurum', FOREIGN: 'Yabancı uyruklu kişi', FOREIGN_COMPANY: 'Yabancı şirket' });
/** Yabancı uyruklu alıcıda TCKN alanına yazılan değer. */
export const FOREIGN_BUYER_ID = '11111111111';
/** Yurt dışındaki tüzel kişi alıcının GİB kimliği (VKN alanı); asıl vergi no notta. */
export const FOREIGN_COMPANY_BUYER_ID = '2222222222';
/** Türkiye'nin ülke adı (alıcı adresinde; yabancı şirket burada olamaz). */
const HOME_COUNTRY = 'türkiye';

/** Eşlenebilen GİB vergi kodları (otelin vergi satırları bunlara eşlenir). */
export const INVOICE_TAX_CODES = Object.freeze({ '0015': 'KDV', '0059': 'Konaklama vergisi' });
export const INVOICE_TAX_CODE_LONG_NAMES = Object.freeze({ '0015': 'Gerçek usulde katma değer vergisi', '0059': 'Konaklama vergisi' });
export const KDV_TAX_CODE = '0015';
/** KDV'siz (istisna olmayan) satırın muafiyet kodu. */
export const KDV_EXEMPTION = Object.freeze({ code: '351', reason: 'İstisna olmayan diğer' });

/** UBL birim kodları (seçilebilen). */
export const INVOICE_UNIT_CODES = Object.freeze(['C62', 'DAY', 'HUR', 'PA']);
export const INVOICE_UNIT_LABELS = Object.freeze({ C62: 'Adet', DAY: 'Gün', HUR: 'Saat', PA: 'Paket' });
/** Etkinlik kalemi birimi → UBL birimi. */
export const EVENT_UNIT_TO_INVOICE_UNIT = Object.freeze({ PERSON: 'C62', PIECE: 'C62', HOUR: 'HUR', DAY: 'DAY', PACKAGE: 'PA' });

/** e-belge entegratörleri: bugün yalnız test ortamı (gerçek adaptör geldikçe eklenir). */
export const EDOC_PROVIDERS = Object.freeze(['TEST']);
export const EDOC_PROVIDER_LABELS = Object.freeze({ TEST: 'Test ortamı (GİB benzetimi)' });
export const EDOC_ENVIRONMENTS = Object.freeze(['TEST', 'LIVE']);
export const EDOC_ENVIRONMENT_LABELS = Object.freeze({ TEST: 'Test', LIVE: 'Canlı' });

/** Test ortamı mükellefinin davranışı (benzetimde GİB'in cevabı). */
export const TEST_TAXPAYER_BEHAVIORS = Object.freeze(['ACCEPT', 'REJECT', 'NO_MAILBOX', 'UNAVAILABLE']);
export const TEST_TAXPAYER_BEHAVIOR_LABELS = Object.freeze({
  ACCEPT: 'Kabul eder',
  REJECT: 'GİB reddeder (şema hatası)',
  NO_MAILBOX: 'Posta kutusu bulunamaz',
  UNAVAILABLE: 'Entegratöre ulaşılamaz (geçici hata)',
});

/** UBL sürümü ve Türkiye özelleştirmesi (entegratör doğrulayıcısıyla teyit edilecek tek yer). */
export const UBL_VERSION_ID = '2.1';
export const UBL_TR_CUSTOMIZATION_ID = 'TR1.2';

/** Fatura numarası: 3 karakter seri + yıl + 9 hane sıra. */
export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{3}$/;
export const INVOICE_NUMBER_PATTERN = /^[A-Z0-9]{3}\d{4}\d{9}$/;
export const INVOICE_SEQUENCE_MAX = 999_999_999;

/** Faturalanacaklar listesinin en geniş penceresi (gün). */
export const INVOICEABLE_MAX_DAYS = 366;
/** VUK 231/5: hizmetten sonra faturanın düzenlenme süresi (gün). */
export const INVOICE_LEGAL_DAYS = 7;
/** İptal onayının süresi (gün). */
export const INVOICE_CANCEL_APPROVAL_DAYS = 3;
export const MAX_INVOICE_LINES = 200;
export const MAX_INVOICE_UNIT_AMOUNT = '10000000';
/** e-belge gönderiminin geçici hatada yeniden deneme aralıkları; sonuncusundan sonra "gönderilemedi". */
export const EDOC_RETRY_DELAYS_MS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]);
/** Mükellef sorgusunun önbellekte kalma süresi. */
export const TAXPAYER_CHECK_TTL_MS = 24 * 60 * 60_000;

/** Folyo kalemi tipinin fatura satırı adı (folyo faturası bu gruplarla). */
export const INVOICE_FOLIO_GROUP_LABELS = Object.freeze({
  ROOM: 'Konaklama',
  FNB: 'Yiyecek - içecek',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Çamaşırhane',
  SPA: 'Spa',
  TAX: 'Vergi ve harçlar',
  OTHER: 'Diğer hizmetler',
});

/* ─────────────── Kimlik numaraları ─────────────── */

/**
 * T.C. kimlik numarası: 11 hane, ilk hane 0 değil; 10. hane = (tek sıralar × 7 − çift sıralar) mod 10,
 * 11. hane = ilk 10 hanenin toplamı mod 10.
 * @param {string} value
 */
export function isValidTckn(value) {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== digits[9]) return false;
  return digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10 === digits[10];
}

/**
 * Vergi kimlik numarası: 10 hane; son hane GİB algoritmasının denetim hanesi.
 * @param {string} value
 */
export function isValidVkn(value) {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  let total = 0;
  for (let index = 0; index < 9; index += 1) {
    const shifted = (digits[index] + 10 - (index + 1)) % 10;
    total += shifted === 9 ? 9 : (shifted * 2 ** (10 - (index + 1))) % 9;
  }
  return (10 - (total % 10)) % 10 === digits[9];
}

/** VKN (10) ya da TCKN (11; şahıs işletmesi): geçerli mi. @param {string} value */
export function isValidTaxId(value) {
  return value.length === 10 ? isValidVkn(value) : isValidTckn(value);
}

/* ─────────────── Numara ─────────────── */

/** @param {string} prefix @param {number} year @param {number} sequence */
export function formatInvoiceNumber(prefix, year, sequence) {
  if (!INVOICE_PREFIX_PATTERN.test(prefix)) throw new Error(`Geçersiz fatura serisi: ${prefix}`);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > INVOICE_SEQUENCE_MAX) throw new Error(`Fatura sırası aralık dışında: ${sequence}`);
  return `${prefix}${year}${String(sequence).padStart(9, '0')}`;
}

/** @param {string} number */
export function parseInvoiceNumber(number) {
  if (!INVOICE_NUMBER_PATTERN.test(number)) return null;
  return { prefix: number.slice(0, 3), year: Number(number.slice(3, 7)), sequence: Number(number.slice(7)) };
}

/* ─────────────── Satırlar ─────────────── */

/**
 * @typedef {{ taxId: string, rate: string, amount: string }} ChargeTax
 * @typedef {{
 *   group: string, description: string, discount?: boolean, net: string, taxes: ChargeTax[],
 *   quantity?: string, unitCode?: string, serviceDate?: string | null,
 * }} InvoiceCharge
 *   group: aynı gruptaki (ve aynı vergi imzalı) satırlar birleşir; folyoda gelir sınıfı, etkinlik / serbest
 *   faturada satırın kendi kimliği (birleşmez). discount: indirim (satır iskontosu olarak gösterilir).
 * @typedef {{ code: string, name: string, rate: string, base: string, amount: string, exemptionCode: string | null, exemptionReason: string | null }} InvoiceLineTax
 * @typedef {{
 *   group: string, description: string, quantity: string, unitCode: string, unitPrice: string, gross: string, discount: string,
 *   net: string, taxAmount: string, total: string, taxes: InvoiceLineTax[], taxSignature: string,
 *   serviceFrom: string | null, serviceTo: string | null,
 * }} InvoiceLine
 */

/** "10.000" → "10"; "0.5" → "0.5" (oran gösterimi). @param {string} rate */
export function normalizeTaxRate(rate) {
  const text = String(rate).trim();
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/** Miktar "120" / "2.50" → yüzde birim (BigInt); en fazla 2 ondalık. @param {string} quantity */
function quantityHundredths(quantity) {
  return toCents(quantity);
}

/**
 * Kaynak satırlarından fatura satırları.
 *
 * - Aynı `group` + aynı vergi imzası (vergi kimliği ve oranı) birleşir; ters kayıt aslını götürür.
 * - İndirim (`discount`) satırı grubun iskontosudur: brüt = indirim dışı netlerin toplamı, iskonto = indirimlerin
 *   mutlak toplamı, satır neti = brüt − iskonto. Vergiler kaynaktaki yuvarlanmış tutarların toplamıdır (folyo
 *   toplamıyla kuruşu kuruşuna aynı); matrah satır netidir.
 * - Neti ve vergisi sıfır olan grup (tamamı iptal edilmiş) satır üretmez.
 * - Miktar ve birim yalnız tek kaynaktan gelen satırda ve birim fiyat kuruşa tam bölünüyorsa korunur; aksi
 *   hâlde 1 adet × net (UBL'de miktar × fiyat = tutar tutmalı).
 * - KDV'si olmayan satıra %0 KDV ve 351 muafiyet kodu eklenir (her satırda KDV bulunur).
 *
 * @param {{ charges: InvoiceCharge[], taxCodes: Map<string, { code: string, name: string }> | Record<string, { code: string, name: string }> }} input
 * @returns {{ lines: InvoiceLine[], problems: string[] }}
 */
export function buildInvoiceLines({ charges, taxCodes }) {
  const codeOf = (taxId) => (taxCodes instanceof Map ? taxCodes.get(taxId) : taxCodes[taxId]);
  const problems = [];
  /** @type {Map<string, { group: string, description: string, sources: InvoiceCharge[], taxes: Map<string, { rate: string, cents: bigint }>, grossCents: bigint, discountCents: bigint }>} */
  const groups = new Map();
  for (const charge of charges) {
    const signature = [...charge.taxes]
      .map((tax) => `${tax.taxId}@${normalizeTaxRate(tax.rate)}`)
      .sort()
      .join('|');
    const key = `${charge.group}#${signature}`;
    let group = groups.get(key);
    if (!group) {
      group = { group: charge.group, description: charge.description, sources: [], taxes: new Map(), grossCents: 0n, discountCents: 0n, signature };
      groups.set(key, group);
    }
    group.sources.push(charge);
    const net = toCents(charge.net);
    if (charge.discount) group.discountCents -= net;
    else group.grossCents += net;
    for (const tax of charge.taxes) {
      const entry = group.taxes.get(tax.taxId) ?? { rate: normalizeTaxRate(tax.rate), cents: 0n };
      entry.cents += toCents(tax.amount);
      group.taxes.set(tax.taxId, entry);
    }
  }

  /** @type {InvoiceLine[]} */
  const lines = [];
  for (const group of groups.values()) {
    const netCents = group.grossCents - group.discountCents;
    const taxCents = [...group.taxes.values()].reduce((sum, entry) => sum + entry.cents, 0n);
    if (netCents === 0n && taxCents === 0n && group.grossCents === 0n) continue;
    if (group.grossCents < 0n || netCents < 0n) {
      problems.push(`${group.description}: tutar eksiye düşüyor (${fromCents(netCents)}); e-faturada eksi satır olamaz`);
      continue;
    }
    if (group.discountCents < 0n) {
      problems.push(`${group.description}: indirim satırı artı tutarlı`);
      continue;
    }
    /** @type {InvoiceLineTax[]} */
    const taxes = [];
    let missing = false;
    for (const [taxId, entry] of group.taxes) {
      const code = codeOf(taxId);
      if (!code) {
        missing = true;
        problems.push(`Vergi kodu eşlemesi eksik (Fatura ayarları → Vergi kodları): ${group.description} satırındaki vergi`);
        break;
      }
      if (entry.cents < 0n) problems.push(`${group.description}: ${code.name} eksiye düşüyor`);
      taxes.push({ code: code.code, name: code.name, rate: entry.rate, base: fromCents(netCents), amount: fromCents(entry.cents), exemptionCode: null, exemptionReason: null });
    }
    if (missing) continue;
    // Aynı vergi kodu bir satırda iki kez olamaz (iki ayrı KDV satırı eşlenmiş).
    const codes = taxes.map((tax) => tax.code);
    if (new Set(codes).size !== codes.length) {
      problems.push(`${group.description}: aynı vergi koduna eşlenmiş iki vergi var`);
      continue;
    }
    if (!codes.includes(KDV_TAX_CODE)) {
      taxes.unshift({ code: KDV_TAX_CODE, name: INVOICE_TAX_CODES[KDV_TAX_CODE], rate: '0', base: fromCents(netCents), amount: '0.00', exemptionCode: KDV_EXEMPTION.code, exemptionReason: KDV_EXEMPTION.reason });
    }
    taxes.sort((a, b) => a.code.localeCompare(b.code));

    let quantity = '1';
    let unitCode = 'C62';
    let unitPrice = fromCents(group.grossCents);
    const single = group.sources.length === 1 ? group.sources[0] : null;
    if (single && single.quantity && group.discountCents === 0n) {
      const hundredths = quantityHundredths(single.quantity);
      // Birim fiyat (kuruş) = net × 100 / (miktar × 100); kuruşa tam bölünmüyorsa 1 adet.
      if (hundredths > 0n && (group.grossCents * 100n) % hundredths === 0n) {
        quantity = fromCents(hundredths).replace(/\.00$/, '');
        unitCode = single.unitCode ?? 'C62';
        unitPrice = fromCents((group.grossCents * 100n) / hundredths);
      }
    }
    const dates = group.sources.map((source) => source.serviceDate).filter(Boolean).sort();
    lines.push({
      group: group.group,
      description: group.description,
      quantity,
      unitCode,
      unitPrice,
      gross: fromCents(group.grossCents),
      discount: fromCents(group.discountCents),
      net: fromCents(netCents),
      taxAmount: fromCents(taxCents),
      total: fromCents(netCents + taxCents),
      taxes,
      taxSignature: group.signature,
      serviceFrom: dates[0] ?? null,
      serviceTo: dates.at(-1) ?? null,
    });
  }
  return { lines, problems };
}

/**
 * Faturanın toplamları ve vergi dökümü (vergi kodu × oran).
 * @param {Array<Pick<InvoiceLine, 'gross' | 'discount' | 'net' | 'taxAmount' | 'total' | 'taxes'>>} lines
 */
export function invoiceTotals(lines) {
  let gross = 0n;
  let discount = 0n;
  let net = 0n;
  let taxTotal = 0n;
  /** @type {Map<string, { code: string, name: string, rate: string, base: bigint, amount: bigint, exemptionCode: string | null, exemptionReason: string | null }>} */
  const subtotals = new Map();
  for (const line of lines) {
    gross += toCents(line.gross);
    discount += toCents(line.discount);
    net += toCents(line.net);
    taxTotal += toCents(line.taxAmount);
    for (const tax of line.taxes) {
      const key = `${tax.code}@${tax.rate}@${tax.exemptionCode ?? ''}`;
      const entry = subtotals.get(key) ?? { code: tax.code, name: tax.name, rate: tax.rate, base: 0n, amount: 0n, exemptionCode: tax.exemptionCode, exemptionReason: tax.exemptionReason };
      entry.base += toCents(tax.base);
      entry.amount += toCents(tax.amount);
      subtotals.set(key, entry);
    }
  }
  const taxes = [...subtotals.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || Number(b.rate) - Number(a.rate))
    .map((entry) => ({ ...entry, base: fromCents(entry.base), amount: fromCents(entry.amount) }));
  return {
    gross: fromCents(gross),
    discount: fromCents(discount),
    lineExtension: fromCents(net),
    taxExclusive: fromCents(net),
    taxTotal: fromCents(taxTotal),
    taxInclusive: fromCents(net + taxTotal),
    payable: fromCents(net + taxTotal),
    taxes,
  };
}

/* ─────────────── Alıcı ─────────────── */

/**
 * @typedef {{
 *   type: 'PERSON' | 'COMPANY' | 'FOREIGN' | 'FOREIGN_COMPANY', name?: string | null, firstName?: string | null, lastName?: string | null,
 *   taxNumber?: string | null, taxOffice?: string | null, nationality?: string | null, passportNo?: string | null, foreignTaxId?: string | null,
 *   street?: string | null, district?: string | null, city?: string | null, postalCode?: string | null, country?: string | null,
 *   email?: string | null, phone?: string | null, alias?: string | null,
 * }} InvoiceBuyer
 */

/**
 * Alıcının kesime yeterliliği: alan → ileti. Boşsa kesilebilir.
 * @param {InvoiceBuyer | null | undefined} buyer
 * @returns {Record<string, string>}
 */
export function invoiceBuyerProblems(buyer) {
  /** @type {Record<string, string>} */
  const problems = {};
  if (!buyer) return { type: 'Alıcı seçin' };
  const blank = (value) => !value || !String(value).trim();
  if (buyer.type === 'COMPANY') {
    if (blank(buyer.name)) problems.name = 'Ünvan zorunlu';
    if (blank(buyer.taxNumber)) problems.taxNumber = 'Vergi no zorunlu';
    else if (!isValidTaxId(String(buyer.taxNumber))) problems.taxNumber = 'Vergi no (10 hane) ya da şahıs işletmesinde TC kimlik no (11 hane) geçersiz';
    if (blank(buyer.taxOffice)) problems.taxOffice = 'Vergi dairesi zorunlu';
  } else if (buyer.type === 'PERSON') {
    if (blank(buyer.firstName)) problems.firstName = 'Ad zorunlu';
    if (blank(buyer.lastName)) problems.lastName = 'Soyad zorunlu';
    if (blank(buyer.taxNumber)) problems.taxNumber = 'TC kimlik no zorunlu';
    else if (!isValidTckn(String(buyer.taxNumber))) problems.taxNumber = 'TC kimlik no geçersiz';
  } else if (buyer.type === 'FOREIGN') {
    if (blank(buyer.firstName)) problems.firstName = 'Ad zorunlu';
    if (blank(buyer.lastName)) problems.lastName = 'Soyad zorunlu';
    if (blank(buyer.nationality)) problems.nationality = 'Uyruk zorunlu';
    if (blank(buyer.passportNo)) problems.passportNo = 'Pasaport / belge no zorunlu';
  } else if (buyer.type === 'FOREIGN_COMPANY') {
    if (blank(buyer.name)) problems.name = 'Ünvan zorunlu';
    if (!blank(buyer.country) && String(buyer.country).trim().toLocaleLowerCase('tr-TR') === HOME_COUNTRY) problems.country = 'Türkiye\'deki şirket için "Şirket / kurum" seçin (VKN ile)';
  } else {
    problems.type = 'Alıcı türü seçin';
  }
  if (blank(buyer.district)) problems.district = 'İlçe zorunlu';
  if (blank(buyer.city)) problems.city = 'İl / şehir zorunlu';
  if (blank(buyer.country)) problems.country = 'Ülke zorunlu';
  return problems;
}

/** Alıcının UBL'deki kimliği: VKN / TCKN; yabancı kişide 11111111111, yabancı şirkette 2222222222. @param {InvoiceBuyer} buyer */
export function invoiceBuyerId(buyer) {
  if (buyer.type === 'FOREIGN') return { scheme: 'TCKN', value: FOREIGN_BUYER_ID };
  if (buyer.type === 'FOREIGN_COMPANY') return { scheme: 'VKN', value: FOREIGN_COMPANY_BUYER_ID };
  const value = String(buyer.taxNumber ?? '');
  return { scheme: value.length === 10 ? 'VKN' : 'TCKN', value };
}

/** Tüzel kişi mi (ünvanla görünür, kişi adı yok). @param {{ type?: string } | null | undefined} buyer */
export const isCompanyBuyer = (buyer) => buyer?.type === 'COMPANY' || buyer?.type === 'FOREIGN_COMPANY';

/** Yurt dışındaki alıcı mı (GİB'e kayıtlı olamaz: e-Arşiv). @param {{ type?: string } | null | undefined} buyer */
export const isForeignBuyer = (buyer) => buyer?.type === 'FOREIGN' || buyer?.type === 'FOREIGN_COMPANY';

/** Görünen ad: şirkette ünvan, kişide ad soyad. @param {InvoiceBuyer} buyer */
export function invoiceBuyerName(buyer) {
  if (isCompanyBuyer(buyer)) return String(buyer.name ?? '').trim();
  return `${buyer.firstName ?? ''} ${buyer.lastName ?? ''}`.trim();
}

/**
 * e-Fatura mı e-Arşiv mi: alıcı GİB'e kayıtlı mükellefse ve posta kutusu varsa e-Fatura.
 * @param {{ buyer: InvoiceBuyer, registered: boolean, aliases: string[] }} input
 */
export function chooseInvoiceDocumentType({ buyer, registered, aliases }) {
  if (!isForeignBuyer(buyer) && registered && aliases.length > 0) return 'E_FATURA';
  return 'E_ARSIV';
}

/* ─────────────── Karekod ve yazıyla tutar ─────────────── */

/**
 * GİB karekod içeriği (Karekod Standardı Kılavuzu v1.1). KDV matrahı ve hesaplanan KDV oran başına.
 * @param {{ sellerId: string, buyerId: string, documentType: 'E_FATURA' | 'E_ARSIV', issueDate: string, number: string, uuid: string,
 *   currency: string, exchangeRate?: string | null, totals: ReturnType<typeof invoiceTotals> }} input
 */
export function invoiceQrPayload({ sellerId, buyerId, documentType, issueDate, number, uuid, currency, exchangeRate = null, totals }) {
  /** @type {Record<string, string>} */
  const payload = {
    vkntckn: sellerId,
    avkntckn: buyerId,
    senaryo: INVOICE_PROFILE_IDS[documentType],
    tip: INVOICE_TYPE_CODE,
    tarih: issueDate,
    no: number,
    ettn: uuid,
    parabirimi: currency,
    malhizmettoplam: totals.lineExtension,
  };
  for (const tax of totals.taxes.filter((entry) => entry.code === KDV_TAX_CODE)) {
    payload[`kdvmatrah(${tax.rate})`] = tax.base;
    payload[`hesaplanankdv(${tax.rate})`] = tax.amount;
  }
  payload.vergidahil = totals.taxInclusive;
  payload.odenecek = totals.payable;
  if (currency !== 'TRY' && exchangeRate) payload.uygulanankur = exchangeRate;
  return payload;
}

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon'];

/** 0–999 → sözcükler ("yüz", "bir" değil "yüz"). @param {number} value */
function hundredsInWords(value) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts = [];
  if (hundreds > 0) parts.push(hundreds === 1 ? 'yüz' : `${ONES[hundreds]} yüz`);
  if (rest >= 10) parts.push(TENS[Math.floor(rest / 10)]);
  if (rest % 10 > 0) parts.push(ONES[rest % 10]);
  return parts.join(' ');
}

/** Tam sayı → Türkçe sözcükler ("bin" değil "bir bin"). @param {bigint} value */
export function integerInWordsTr(value) {
  if (value === 0n) return 'sıfır';
  const groups = [];
  let rest = value;
  while (rest > 0n) {
    groups.push(Number(rest % 1000n));
    rest /= 1000n;
  }
  const parts = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;
    if (index === 1 && group === 1) parts.push('bin');
    else parts.push([hundredsInWords(group), SCALES[index]].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}

const CURRENCY_WORDS = Object.freeze({
  TRY: ['Türk lirası', 'kuruş'],
  EUR: ['avro', 'sent'],
  USD: ['ABD doları', 'sent'],
  GBP: ['İngiliz sterlini', 'peni'],
});

/**
 * Faturadaki "yazıyla" satırı: "Yalnız bin iki yüz otuz dört Türk lirası on beş kuruş".
 * @param {string} amount @param {string} currency
 */
export function amountInWordsTr(amount, currency) {
  const cents = toCents(amount);
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const [major, minor] = CURRENCY_WORDS[currency] ?? [currency, 'kuruş'];
  const whole = abs / 100n;
  const fraction = abs % 100n;
  const parts = [`${integerInWordsTr(whole)} ${major}`];
  if (fraction > 0n) parts.push(`${integerInWordsTr(fraction)} ${minor}`);
  return `Yalnız ${negative ? 'eksi ' : ''}${parts.join(' ')}`;
}

/* ─────────────── Süre ve yeniden deneme ─────────────── */

/**
 * Yasal süre: hizmetin son günü + 7 gün; bugün bu günü geçtiyse gecikmiş.
 * @param {string} serviceTo YYYY-MM-DD @param {string} today YYYY-MM-DD
 */
export function invoiceDeadline(serviceTo, today) {
  const deadline = new Date(Date.parse(`${serviceTo}T00:00:00Z`) + INVOICE_LEGAL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const daysLeft = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { deadline, daysLeft, overdue: daysLeft < 0 };
}

/**
 * Geçici hatadan sonra sıradaki deneme anı; hak bittiyse null.
 * @param {number} attempts yapılmış deneme @param {Date} now
 */
export function edocRetryAt(attempts, now) {
  const delay = EDOC_RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/* ─────────────── Şemalar ─────────────── */

const uuidField = (message) => z.string().uuid({ message });

const text = (max, label) =>
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

const digitsField = (label) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ''))
    .refine((value) => value === '' || /^\d+$/.test(value), { message: `${label} yalnız rakam olmalı` })
    .transform((value) => value || null)
    .nullish();

const emailText = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), { message: 'Geçersiz e-posta' })
  .transform((value) => value || null)
  .nullish();

const prefixField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .toUpperCase()
    .regex(INVOICE_PREFIX_PATTERN, `${label} 3 karakter olmalı (harf / rakam, ör. FTR)`);

/** Alıcı (taslakta kısmen boş olabilir; kesimde `invoiceBuyerProblems` denetler). */
export const invoiceBuyerSchema = z.object({
  type: z.enum(INVOICE_BUYER_TYPES, { error: 'Alıcı türü seçin' }),
  name: text(250, 'Ünvan'),
  firstName: text(100, 'Ad'),
  lastName: text(100, 'Soyad'),
  taxNumber: digitsField('Vergi / TC kimlik no').refine((value) => !value || value.length === 10 || value.length === 11, { message: 'Vergi no 10, TC kimlik no 11 hane' }),
  taxOffice: text(120, 'Vergi dairesi'),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === '' || /^[A-Z]{2}$/.test(value), { message: 'Uyruk 2 harfli ülke kodu (DE, GB…)' })
    .transform((value) => value || null)
    .nullish(),
  passportNo: text(40, 'Pasaport no'),
  /** Yabancı şirketin kendi ülkesindeki vergi no (AB KDV no gibi): notta ve PDF'te. */
  foreignTaxId: text(40, 'Yabancı vergi no'),
  street: text(250, 'Adres'),
  district: text(80, 'İlçe'),
  city: text(80, 'İl / şehir'),
  postalCode: text(12, 'Posta kodu'),
  country: text(80, 'Ülke'),
  email: emailText,
  phone: text(30, 'Telefon'),
  alias: text(120, 'Posta kutusu etiketi'),
});

/** Serbest fatura / iptal bedeli satırı: birim tutar otelin vergi ayarıyla (dahil vergiler içinde) girilir. */
export const invoiceManualLineSchema = z.object({
  description: requiredText(250, 'Açıklama'),
  quantity: decimalField({ scale: 2, min: 0.01, max: 100000, label: 'Miktar' }),
  unitCode: z.enum(INVOICE_UNIT_CODES, { error: 'Birim seçin' }).default('C62'),
  unitAmount: decimalField({ scale: 2, min: 0.01, max: Number(MAX_INVOICE_UNIT_AMOUNT), label: 'Birim tutar' }),
  taxCategory: z.enum(TAX_APPLIES_TO, { error: 'Vergi kategorisi seçin' }),
});

const manualLines = z.array(invoiceManualLineSchema).min(1, 'En az bir satır').max(MAX_INVOICE_LINES, `En fazla ${MAX_INVOICE_LINES} satır`);

/** Taslak aç: folyodan, etkinlikten ya da cariye serbest fatura. */
export const invoiceDraftCreateSchema = z.discriminatedUnion(
  'source',
  [
    z.object({ source: z.literal('FOLIO'), folioId: uuidField('Geçersiz folyo') }),
    z.object({ source: z.literal('EVENT'), eventId: uuidField('Geçersiz etkinlik') }),
    z.object({ source: z.literal('MANUAL'), ledgerAccountId: uuidField('Cari seçin'), lines: manualLines, note: text(500, 'Not') }),
  ],
  { error: 'Fatura kaynağı seçin' },
);

/** Taslağı düzenle: alıcı, not; serbest faturada ve iptal bedeli faturasında satırlar. */
export const invoiceDraftUpdateSchema = z.object({
  expectedUpdatedAt,
  buyer: invoiceBuyerSchema,
  note: text(500, 'Not'),
  lines: manualLines.optional(),
});

export const invoiceIssueSchema = z.object({ expectedUpdatedAt });

/** İptal isteği; GİB'e ulaşmış e-Faturada portal iptal referansı zorunlu (servis denetler). */
export const invoiceCancelSchema = z.object({
  reason: requiredText(500, 'Gerekçe', 5),
  portalReference: text(120, 'GİB portalı iptal referansı'),
});

/** Fatura ayarları: satıcı bilgileri, seriler, entegratör, vergi kodu eşlemesi. */
export const invoiceSettingsSchema = z
  .object({
    expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
    legalName: requiredText(250, 'Ünvan', 2),
    taxNumber: z
      .string({ error: 'Vergi no zorunlu' })
      .trim()
      .transform((value) => value.replace(/\s+/g, ''))
      .refine((value) => /^\d{10,11}$/.test(value) && isValidTaxId(value), { message: 'Vergi no (10 hane) ya da TC kimlik no (11 hane) geçersiz' }),
    taxOffice: requiredText(120, 'Vergi dairesi'),
    mersisNo: digitsField('MERSİS no').refine((value) => !value || value.length === 16, { message: 'MERSİS no 16 hane' }),
    tradeRegistryNo: text(40, 'Ticaret sicil no'),
    street: requiredText(250, 'Adres'),
    district: requiredText(80, 'İlçe'),
    city: requiredText(80, 'İl'),
    postalCode: text(12, 'Posta kodu'),
    country: requiredText(80, 'Ülke').default('Türkiye'),
    phone: text(30, 'Telefon'),
    email: emailText,
    website: text(200, 'Web sitesi'),
    eFaturaPrefix: prefixField('e-Fatura serisi'),
    eArsivPrefix: prefixField('e-Arşiv serisi'),
    provider: z.enum(EDOC_PROVIDERS, { error: 'Entegratör seçin' }),
    environment: z.enum(EDOC_ENVIRONMENTS, { error: 'Ortam seçin' }),
    senderAlias: text(120, 'Gönderici birim etiketi'),
    /** Faturalama başlangıcı: öncesinde kapanan folyo / etkinlik önceki sistemde faturalanmış sayılır. */
    startDate: isoDayField,
    autoDraft: z.boolean().default(true),
    footerNote: text(500, 'Fatura notu'),
    bankInfo: text(300, 'Banka bilgisi'),
    taxCodes: z
      .array(z.object({ taxId: uuidField('Geçersiz vergi'), code: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(INVOICE_TAX_CODES)), { error: 'Vergi kodu seçin' }) }))
      .max(50),
  })
  .superRefine((value, ctx) => {
    if (value.eFaturaPrefix === value.eArsivPrefix) ctx.addIssue({ code: 'custom', path: ['eArsivPrefix'], message: 'e-Arşiv serisi e-Fatura serisinden farklı olmalı' });
    if (value.environment === 'LIVE' && value.provider === 'TEST') ctx.addIssue({ code: 'custom', path: ['environment'], message: 'Canlı ortam için gerçek entegratör gerekir; test ortamı GİB\'e göndermez' });
    const ids = value.taxCodes.map((row) => row.taxId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['taxCodes'], message: 'Bir vergi iki kez eşlenmiş' });
  });

/** Test ortamı mükellefi (benzetimin "kayıtlı kullanıcı listesi"). */
export const testTaxpayerSchema = z.object({
  taxNumber: z
    .string({ error: 'Vergi no zorunlu' })
    .trim()
    .transform((value) => value.replace(/\s+/g, ''))
    .refine((value) => /^\d{10,11}$/.test(value) && isValidTaxId(value), { message: 'Vergi / TC kimlik no geçersiz' }),
  title: requiredText(250, 'Ünvan', 2),
  alias: z
    .string({ error: 'Posta kutusu etiketi zorunlu' })
    .trim()
    .regex(/^urn:mail:[^\s@]+@[^\s@]+$/, 'Etiket urn:mail:…@… biçiminde olmalı'),
  behavior: z.enum(TEST_TAXPAYER_BEHAVIORS, { error: 'Davranış seçin' }).default('ACCEPT'),
});

/** Fatura listesi. */
export const invoiceListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES, { error: 'Geçersiz durum' }).optional(),
  documentType: z.enum(INVOICE_DOCUMENT_TYPES, { error: 'Geçersiz belge türü' }).optional(),
  edocState: z.enum(EDOC_STATES, { error: 'Geçersiz GİB durumu' }).optional(),
  source: z.enum(INVOICE_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
  from: isoDayField.optional(),
  to: isoDayField.optional(),
  search: z.string().trim().max(100, 'Arama en fazla 100 karakter').optional(),
  /** Kaynağın faturaları (folyo / etkinlik ekranı): taslak dahil bütün durumlar. */
  folioId: z.string().uuid({ message: 'Geçersiz folyo' }).optional(),
  eventId: z.string().uuid({ message: 'Geçersiz etkinlik' }).optional(),
});

/** Faturalanacaklar: kapanmış folyolar ya da faturaya hazır etkinlikler. */
export const invoiceableQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(['FOLIO', 'EVENT'], { error: 'Geçersiz tür' }).default('FOLIO'),
  /** Kapanış penceresi (gün): kapanmış folyo / etkinlik bu kadar geriye taranır (index aralığı). */
  days: z.coerce.number({ error: 'Gün sayı olmalı' }).int().min(1, 'En az 1 gün').max(INVOICEABLE_MAX_DAYS, `En fazla ${INVOICEABLE_MAX_DAYS} gün`).default(30),
  overdueOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  search: z.string().trim().max(100, 'Arama en fazla 100 karakter').optional(),
});

export const invoiceParamSchema = z.object({ invoiceId: uuidField('Geçersiz fatura') });
export const testTaxpayerParamSchema = z.object({ taxpayerId: uuidField('Geçersiz mükellef') });
