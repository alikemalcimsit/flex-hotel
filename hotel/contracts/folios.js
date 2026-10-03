import { TAX_APPLIES_TO, TAX_APPLIES_TO_LABELS } from './constants.js';
import { normalizeDecimalString } from './decimal.js';
import { paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';

/**
 * Folyo sözleşmeleri (modül 15).
 *
 * Folyo, bir konaklamanın hesabıdır: oda ücreti, restoran, minibar... kalemleri
 * ve ödemeler. Bir konaklamanın birden fazla folyosu (penceresi) olabilir:
 * "oda ücreti şirkete, ekstralar misafire" gibi. Kurallar:
 *
 * - **Tutar metindir** ("1250.50"); hesap sunucuda `@hotelos/core` → `money.js`.
 * - **Vergi kalemin içindedir:** her kalem vergisinin dökümünü (dahil / hariç)
 *   taşır; hariç vergiler kalemin toplamına eklenir. Bakiye = Σ kalem toplamı −
 *   Σ ödeme (kurla).
 * - **Kalem silinmez:** iptal, eksi tutarlı bir "ters kayıt" işler; asıl kalem
 *   iptal edildi diye işaretlenir. Kapanmış bir günün geliri geriye dönük değişmez.
 * - **Elle harcama belirli bir folyoya** işlenir; sistemin işlediği kalemler
 *   (oda ücreti, erken giriş, restoran, minibar) konaklamanın yönlendirmesine
 *   göre gider (`FolioRoute`), yoksa konaklamanın ilk açık folyosuna.
 */

/* ─────────────── Durumlar, tipler, kaynaklar ─────────────── */

/** Prisma `FolioStatus` ile birebir. */
export const FOLIO_STATUSES = Object.freeze(['OPEN', 'CLOSED', 'TRANSFERRED']);

export const FOLIO_STATUS_LABELS = Object.freeze({
  OPEN: 'Açık',
  CLOSED: 'Kapalı',
  TRANSFERRED: 'Birleştirildi',
});

/**
 * Kalem tipleri (Prisma `FolioItemType`; şemadaki `TAX` değeri artık yazılmaz —
 * vergi kalemin kendi dökümünde).
 */
export const FOLIO_ITEM_TYPES = Object.freeze(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER', 'DISCOUNT']);

export const FOLIO_ITEM_TYPE_LABELS = Object.freeze({
  ...TAX_APPLIES_TO_LABELS,
  DISCOUNT: 'İndirim',
});

/** Personelin elle işleyebildiği harcama tipleri. Oda ücreti sistemden gelir (gece gece). */
export const FOLIO_MANUAL_CHARGE_TYPES = Object.freeze(['FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER']);

/** Elle işlenebilen bütün tipler: harcamalar ve indirim (indirim ayrı yetki ister). */
export const FOLIO_POSTABLE_TYPES = Object.freeze([...FOLIO_MANUAL_CHARGE_TYPES, 'DISCOUNT']);

/**
 * İndirim hangi gelirin indirimi: vergisi o gelirin vergisidir (odadan yapılan
 * indirim oda KDV'sini de düşürür). Vergi ayarlarındaki kalem tipleriyle aynı liste.
 */
export const FOLIO_DISCOUNT_CATEGORIES = TAX_APPLIES_TO;

/** Yönlendirilebilen tipler: sistemin ve dış olayların işlediği kalemlerin tipleri. */
export const FOLIO_ROUTABLE_TYPES = Object.freeze(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER']);

/** Prisma `FolioItemSource` ile birebir. */
export const FOLIO_ITEM_SOURCES = Object.freeze([
  'MANUAL',
  'ROOM_NIGHT',
  'EARLY_CHECK_IN',
  'LATE_CHECK_OUT',
  'CANCELLATION',
  'NO_SHOW',
  'FNB_ORDER',
  'MINIBAR',
  'REVERSAL',
]);

export const FOLIO_ITEM_SOURCE_LABELS = Object.freeze({
  MANUAL: 'Elle',
  ROOM_NIGHT: 'Gece oda ücreti',
  EARLY_CHECK_IN: 'Erken giriş',
  LATE_CHECK_OUT: 'Geç çıkış',
  CANCELLATION: 'İptal ücreti',
  NO_SHOW: 'Gelmedi ücreti',
  FNB_ORDER: 'Restoran siparişi',
  MINIBAR: 'Minibar tüketimi',
  REVERSAL: 'İptal kaydı',
});

/**
 * Konaklama başına "en fazla bir etkin" ücret kaynakları: girişin, çıkışın,
 * iptalin, gelmedinin ücreti bir kez alınır. Giriş geri alınıp yeniden yapılsa
 * da ikinci erken giriş ücreti işlenmez; geri alınınca ücret ters kayıtla düşer.
 */
export const FOLIO_SINGLE_FEE_SOURCES = Object.freeze(['EARLY_CHECK_IN', 'LATE_CHECK_OUT', 'CANCELLATION', 'NO_SHOW']);

/**
 * Kalemin vergi kategorisi (vergi ayarındaki "uygulandığı kalem"): indirim
 * seçilen gelirin, diğerleri kendi tipinin vergisini taşır.
 * @param {string} type
 * @param {string | null | undefined} discountCategory
 * @returns {string | null}
 */
export function folioTaxCategory(type, discountCategory) {
  if (type === 'DISCOUNT') return discountCategory ?? null;
  return TAX_APPLIES_TO.includes(type) ? type : null;
}

/** Prisma `PaymentMethod` ile birebir (ödeme kuralları `payments.js`'te, modül 17). */
export const PAYMENT_METHODS = Object.freeze(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS', 'AGENCY', 'VOUCHER']);

export const PAYMENT_METHOD_LABELS = Object.freeze({
  CASH: 'Nakit',
  CARD: 'Kredi kartı',
  TRANSFER: 'Havale / EFT',
  VIRTUAL_POS: 'Sanal POS',
  AGENCY: 'Acente / cari',
  VOUCHER: 'Voucher',
});

/* ─────────────── Sınırlar ─────────────── */

/** Bir konaklamanın en fazla folyo (pencere) sayısı. */
export const FOLIO_MAX_WINDOWS = 8;
/** Bir kalemin birim tutarı en fazla (yazım hatasını yakalamak için). */
export const FOLIO_MAX_UNIT_AMOUNT = '1000000';
export const FOLIO_MAX_QUANTITY = 999;
export const FOLIO_DESCRIPTION_MIN = 2;
export const FOLIO_DESCRIPTION_MAX = 200;
export const FOLIO_REASON_MIN = 3;
export const FOLIO_REASON_MAX = 500;
export const FOLIO_PAYER_NAME_MAX = 120;
/** Tek aktarma / bölmede en fazla kalem. */
export const FOLIO_TRANSFER_MAX_ITEMS = 200;
/** Tek birleştirmede en fazla kaynak folyo (grup). */
export const FOLIO_MERGE_MAX_SOURCES = 20;
/** Kalem listesi sayfası. */
export const FOLIO_ITEMS_PAGE_SIZE = 100;
export const FOLIO_ITEMS_MAX_PAGE_SIZE = 200;

/* ─────────────── Liste görünümleri ─────────────── */

/**
 * - `IN_HOUSE`: içerideki misafirlerin açık folyoları.
 * - `OPEN_BALANCE`: konaklaması bitmiş (çıkmış, iptal, gelmedi) ama bakiyesi
 *   kapanmamış folyolar — tahsil ya da iade edilecekler.
 * - `OPEN`: bütün açık folyolar.
 * - `CLOSED`: kapananlar (son kapanan önce).
 */
export const FOLIO_LIST_VIEWS = Object.freeze(['IN_HOUSE', 'OPEN_BALANCE', 'OPEN', 'CLOSED']);

export const FOLIO_LIST_VIEW_LABELS = Object.freeze({
  IN_HOUSE: 'İçeridekiler',
  OPEN_BALANCE: 'Açık bakiye',
  OPEN: 'Bütün açıklar',
  CLOSED: 'Kapananlar',
});

/* ─────────────── Alanlar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

/**
 * Birim tutar: sıfırdan büyük, en fazla iki ondalıklı metin. Ondalık ayırıcı
 * nokta ya da virgül ("45,50"); binlik ayırıcı kabul edilmez. İndirim de
 * pozitif girilir, sunucu eksiye çevirir.
 */
export const folioAmountField = z.union([z.string(), z.number()], { error: 'Tutar zorunlu' }).transform((value, ctx) => {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({ code: 'custom', message: 'Tutar geçersiz (ör. 250 ya da 250,50; en fazla 2 ondalık)' });
    return z.NEVER;
  }
  const normalized = normalizeDecimalString(text);
  if (Number(normalized) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Tutar sıfırdan büyük olmalı' });
    return z.NEVER;
  }
  if (Number(normalized) > Number(FOLIO_MAX_UNIT_AMOUNT)) {
    ctx.addIssue({ code: 'custom', message: 'Tutar çok yüksek; yazım hatası olabilir' });
    return z.NEVER;
  }
  return normalized;
});

const quantityField = z.coerce
  .number({ error: 'Adet sayı olmalı' })
  .int('Adet tam sayı olmalı')
  .min(1, 'Adet en az 1 olmalı')
  .max(FOLIO_MAX_QUANTITY, `Adet en fazla ${FOLIO_MAX_QUANTITY} olabilir`);

const reasonField = z
  .string({ error: 'Gerekçe zorunlu' })
  .trim()
  .min(FOLIO_REASON_MIN, `Gerekçe en az ${FOLIO_REASON_MIN} karakter olmalı`)
  .max(FOLIO_REASON_MAX, `Gerekçe en fazla ${FOLIO_REASON_MAX} karakter olabilir`);

const payerNameField = z
  .string()
  .trim()
  .max(FOLIO_PAYER_NAME_MAX, `Ödeyen adı en fazla ${FOLIO_PAYER_NAME_MAX} karakter olabilir`)
  .transform((value) => value || null)
  .nullish();

/** Kimlik listesi: tekrar etmeyen, sınırlı sayıda. */
function idList({ min, max, label }) {
  return z
    .array(uuid(`Geçersiz ${label}`), { error: `${label} listesi zorunlu` })
    .min(min, min === 1 ? `En az bir ${label} seçin` : `En az ${min} ${label} seçin`)
    .max(max, `Tek seferde en fazla ${max} ${label}`)
    .refine((ids) => new Set(ids).size === ids.length, { message: `Aynı ${label} iki kez seçilmiş` });
}

/** Harcama tipi ve indirim kategorisi birlikte denetlenir. */
function refineChargeType(value, ctx) {
  if (value.type === 'DISCOUNT' && !value.discountCategory) {
    ctx.addIssue({ code: 'custom', path: ['discountCategory'], message: 'İndirimin hangi gelirden yapıldığını seçin' });
  }
  if (value.type !== 'DISCOUNT' && value.discountCategory) {
    ctx.addIssue({ code: 'custom', path: ['discountCategory'], message: 'Gelir seçimi yalnızca indirimde' });
  }
}

const chargeFields = {
  type: z.enum(FOLIO_POSTABLE_TYPES, { error: 'Geçersiz harcama tipi' }),
  discountCategory: z.enum(FOLIO_DISCOUNT_CATEGORIES, { error: 'Geçersiz gelir türü' }).nullish(),
  amount: folioAmountField,
  quantity: quantityField.default(1),
};

/* ─────────────── Şemalar ─────────────── */

/** Harcama / indirim işle. `requestId` çift gönderimde ikinci kalemi engeller. */
export const postChargeSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    ...chargeFields,
    description: z
      .string({ error: 'Açıklama zorunlu' })
      .trim()
      .min(FOLIO_DESCRIPTION_MIN, `Açıklama en az ${FOLIO_DESCRIPTION_MIN} karakter olmalı`)
      .max(FOLIO_DESCRIPTION_MAX, `Açıklama en fazla ${FOLIO_DESCRIPTION_MAX} karakter olabilir`),
  })
  .superRefine(refineChargeType);

/** Formdaki canlı vergi / toplam önizlemesi. */
export const chargePreviewSchema = z.object(chargeFields).superRefine(refineChargeType);

/** Kalem iptali isteği (onay kuyruğuna gider). */
export const voidRequestSchema = z.object({ reason: reasonField });

/** Kapanmış folyoyu yeniden açmak. */
export const reopenFolioSchema = z.object({ reason: reasonField });

/** Seçilen kalemleri başka bir açık folyoya aktar. */
export const transferItemsSchema = z.object({
  itemIds: idList({ min: 1, max: FOLIO_TRANSFER_MAX_ITEMS, label: 'kalem' }),
  targetFolioId: uuid('Geçersiz hedef folyo'),
});

/**
 * Böl: aynı konaklamada yeni folyo aç, seçilen kalemleri ona taşı (hiç kalem
 * seçilmezse boş folyo açılır). `routeTypes`: bundan sonra bu tiplerdeki
 * sistem kalemleri yeni folyoya düşsün.
 */
export const splitFolioSchema = z.object({
  itemIds: idList({ min: 0, max: FOLIO_TRANSFER_MAX_ITEMS, label: 'kalem' }).default([]),
  payerName: payerNameField,
  routeTypes: z
    .array(z.enum(FOLIO_ROUTABLE_TYPES, { error: 'Geçersiz kalem tipi' }))
    .max(FOLIO_ROUTABLE_TYPES.length)
    .refine((types) => new Set(types).size === types.length, { message: 'Aynı tip iki kez seçilmiş' })
    .default([]),
});

/**
 * Birleştir: seçilen folyoların bütün kalem ve ödemeleri bu folyoya taşınır;
 * kaynaklar "birleştirildi" olur, konaklamalarının sonraki kalemleri buraya düşer.
 */
export const mergeFoliosSchema = z.object({
  sourceFolioIds: idList({ min: 1, max: FOLIO_MERGE_MAX_SOURCES, label: 'folyo' }),
});

/** Konaklamanın yönlendirmeleri: tip → folyo (`null`: yönlendirme yok, ilk açık folyo). */
export const folioRoutesSchema = z.object({
  routes: z
    .array(
      z.object({
        type: z.enum(FOLIO_ROUTABLE_TYPES, { error: 'Geçersiz kalem tipi' }),
        folioId: uuid('Geçersiz folyo').nullable(),
      }),
    )
    .min(1, 'En az bir yönlendirme gönderin')
    .max(FOLIO_ROUTABLE_TYPES.length)
    .refine((routes) => new Set(routes.map((route) => route.type)).size === routes.length, {
      message: 'Aynı tip iki kez yönlendirilmiş',
    }),
});

/** Folyo aç (konaklamanın hiç açık folyosu yoksa) / ödeyen adını düzelt. */
export const openFolioSchema = z.object({ payerName: payerNameField });
export const updateFolioSchema = z.object({ payerName: payerNameField });

export const folioListQuerySchema = paginationQuerySchema.extend({
  view: z.enum(FOLIO_LIST_VIEWS, { error: 'Geçersiz görünüm' }).default('IN_HOUSE'),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
});

export const folioItemsQuerySchema = z.object({
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(FOLIO_ITEMS_MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${FOLIO_ITEMS_MAX_PAGE_SIZE} olabilir`)
    .default(FOLIO_ITEMS_PAGE_SIZE),
  /** İptal edilen kalemler ve ters kayıtları da gelsin mi (varsayılan evet: hesap dökümü eksiksiz). */
  includeVoided: queryBoolean.default(true),
});

export const folioParamSchema = z.object({ folioId: uuid('Geçersiz folyo') });
export const folioItemParamSchema = z.object({ folioId: uuid('Geçersiz folyo'), itemId: uuid('Geçersiz kalem') });
export const folioStayParamSchema = z.object({ reservationId: uuid('Geçersiz konaklama') });

/* ─────────────── Kurallar (ekran ve sunucu aynı cevabı versin) ─────────────── */

/**
 * Folyoda bu işlem yapılabilir mi? Yapılamıyorsa gösterilecek sebep.
 *
 * @param {{ status: string }} folio
 * @param {'post' | 'transfer' | 'split' | 'merge' | 'route' | 'close' | 'reopen' | 'edit'} action
 * @param {{ balanceZero?: boolean, pendingVoids?: number, pendingPayments?: number, lastOpenOfInHouseStay?: boolean }} [context]
 *   `pendingVoids`: onay bekleyen kalem ve ödeme iptalleri; `pendingPayments`: onay bekleyen ödeme / iade
 * @returns {string | null}
 */
export function folioActionError(folio, action, context = {}) {
  if (action === 'reopen') {
    return folio.status === 'CLOSED' ? null : 'Yalnızca kapanmış folyo yeniden açılır';
  }
  if (folio.status === 'TRANSFERRED') return 'Bu folyo başka bir folyoya birleştirilmiş; işlemi birleştirilen folyoda yapın';
  if (folio.status === 'CLOSED') return 'Folyo kapalı; işlem için önce yeniden açın';
  if (action === 'close') {
    // Önce yapısal engel: ödeme alınsa da kapanmayacak folyo için "tahsil edin" demek yanıltır.
    if (context.lastOpenOfInHouseStay) return 'İçerideki misafirin son açık folyosu kapatılamaz; kalemler buraya düşer';
    if (context.pendingVoids) return 'Folyoda onay bekleyen iptal var; karar verilince kapatın';
    if (context.pendingPayments) return 'Folyoda onay bekleyen ödeme ya da iade var; karar verilince kapatın';
    if (context.balanceZero === false) return 'Bakiye sıfır değil; tahsilat ya da iade yapılmadan folyo kapanmaz';
  }
  return null;
}

/**
 * Kalemde iptal / aktarma yapılabilir mi?
 * @param {{ source: string, voidedAt?: unknown, voidPending?: boolean }} item
 * @param {'void' | 'transfer'} action
 * @returns {string | null}
 */
export function folioItemActionError(item, action) {
  if (item.source === 'REVERSAL') return 'İptal kaydı değiştirilemez';
  if (item.voidedAt) return 'Kalem iptal edilmiş';
  if (item.voidPending) return action === 'void' ? 'Bu kalem için iptal onayı zaten bekliyor' : 'İptal onayı bekleyen kalem taşınamaz';
  return null;
}

/**
 * Folyonun ekrandaki adı: "Folyo 2 · ABC Ltd."
 * @param {{ window: number, payerName?: string | null }} folio
 */
export function folioDisplayName(folio) {
  return folio.payerName ? `Folyo ${folio.window} · ${folio.payerName}` : `Folyo ${folio.window}`;
}
