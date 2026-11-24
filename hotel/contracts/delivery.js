import { expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { looksLikeCardNumber } from './front-desk.js';
import { z } from './locale.js';
import { doorPaymentSchema, menuOrderLinesField, posOptionalText, posReasonField } from './room-service.js';
import { moneyInputField } from './reservations.js';

/**
 * Paket servis (modül 42) sözleşmesi.
 *
 * - **Satış noktası türü** `DELIVERY`: masasızdır; siparişleri paket panosundadır.
 * - **Sipariş** personelden gelir (telefon, WhatsApp, web / platform — personel girer); alınınca mutfağa düşer.
 *   Politikadaki **paket ücreti** adisyonda ayrı kalemdir; **en az sipariş tutarı** ücret hariç ürün toplamıdır.
 * - **Ödeme:** sipariş alınırken önceden (kart / havale referansıyla; alanın kasasına) ya da kapıda (kuryenin vardiya
 *   kasasına, nakit / kart bölünebilir). Nakitte "şu tutara bozuk getir" yazılır. Teslimde açık hesap kalmaz.
 * - **Akış:** mutfakta → hazırlanıyor → hazır → yolda (kurye) → teslim; iptal teslimden önce.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `DeliverySource` ile birebir. */
export const DELIVERY_SOURCES = Object.freeze(['PHONE', 'MESSAGE', 'ONLINE']);
export const DELIVERY_SOURCE_LABELS = Object.freeze({ PHONE: 'Telefon', MESSAGE: 'Mesaj (WhatsApp)', ONLINE: 'Web / platform' });

/** Prisma `DeliveryStatus` ile birebir. */
export const DELIVERY_STATUSES = Object.freeze(['RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED']);
export const DELIVERY_STATUS_LABELS = Object.freeze({
  RECEIVED: 'Mutfakta',
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  ON_THE_WAY: 'Yolda',
  DELIVERED: 'Teslim edildi',
  CANCELLED: 'İptal',
});
/** Teslim edilmemiş, iptal edilmemiş (adisyonu açık) durumlar. */
export const DELIVERY_ACTIVE_STATUSES = Object.freeze(['RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY']);
export const DELIVERY_FINAL_STATUSES = Object.freeze(['DELIVERED', 'CANCELLED']);

/** Prisma `DeliveryDoorMethod` ile birebir: kapıda beklenen ödeme. */
export const DELIVERY_DOOR_METHODS = Object.freeze(['CASH', 'CARD']);
export const DELIVERY_DOOR_METHOD_LABELS = Object.freeze({ CASH: 'Kapıda nakit', CARD: 'Kapıda kart' });

/** Geçmiş süzgeci: durum grupları. */
export const DELIVERY_LIST_STATES = Object.freeze(['ACTIVE', 'DELIVERED', 'CANCELLED']);
export const DELIVERY_LIST_STATE_LABELS = Object.freeze({ ACTIVE: 'Açık', DELIVERED: 'Teslim edildi', CANCELLED: 'İptal' });

/** Bir siparişte en fazla kalem. */
export const MAX_DELIVERY_LINES = 30;
/** Sipariş alınırken en fazla ön ödeme (kart + havale gibi bölünmüş). */
export const MAX_DELIVERY_PREPAYMENTS = 2;
/** Teslimde en fazla kapı ödemesi (nakit + kart bölünmüş). */
export const MAX_DELIVERY_DOOR_PAYMENTS = 4;
export const MAX_DELIVERY_NOTE_LENGTH = 300;
export const MAX_DELIVERY_ADDRESS_LENGTH = 300;
export const MAX_DELIVERY_ADDRESS_NOTE_LENGTH = 200;
/** Panoda bir sütunda en fazla kart (sayısı ayrıca döner). */
export const MAX_DELIVERY_BOARD_COLUMN = 200;
/** Telefonla bulunan müşterinin en fazla son adresi. */
export const MAX_DELIVERY_CUSTOMER_ADDRESSES = 5;

const MINUTE_MS = 60_000;

/* ─────────────── Kurallar (saf; sunucu ve ekran aynı kuralı kullanır) ─────────────── */

/**
 * Elle geçişler: mutfak adımları atlanabilir (hazırlanmadan "hazır", hazırdan beklemeden "yolda"); yoldaki sipariş
 * müşteri kapıda yoksa "hazır"a geri alınır. Kurye, teslim ve iptal kendi uçlarındadır.
 */
const MANUAL_TRANSITIONS = Object.freeze({
  RECEIVED: Object.freeze(['PREPARING', 'READY', 'ON_THE_WAY']),
  PREPARING: Object.freeze(['READY', 'ON_THE_WAY']),
  READY: Object.freeze(['ON_THE_WAY']),
  ON_THE_WAY: Object.freeze(['READY']),
});

/**
 * Durum ilerletme kuralı. @param {string} from @param {string} to
 * @returns {string | null} izin yoksa sebebi
 */
export function deliveryTransitionError(from, to) {
  if (!DELIVERY_STATUSES.includes(to)) return 'Geçersiz durum';
  if (from === to) return `Sipariş zaten "${DELIVERY_STATUS_LABELS[to]}"`;
  if (DELIVERY_FINAL_STATUSES.includes(from)) return `Sipariş ${DELIVERY_STATUS_LABELS[from].toLocaleLowerCase('tr-TR')}; değiştirilemez`;
  if (!(MANUAL_TRANSITIONS[from] ?? []).includes(to)) return `"${DELIVERY_STATUS_LABELS[from]}" → "${DELIVERY_STATUS_LABELS[to]}" geçişi yapılamaz`;
  return null;
}

/** "PS-2026-000042". @param {number} year @param {number} sequence */
export const deliveryNumber = (year, sequence) => `PS-${year}-${String(sequence).padStart(6, '0')}`;

/**
 * Teslim edilmiş siparişin süreleri (dakika): mutfakta (sipariş → hazır), bekleme (hazır → yola çıkış), yol (yola
 * çıkış → teslim), toplam (sipariş → teslim) ve zamanında mı (teslim ≤ hedef). Atlanan adımın süresi boştur.
 *
 * @param {{ createdAt: Date, readyAt: Date | null, dispatchedAt: Date | null, deliveredAt: Date | null, dueAt: Date }} order
 */
export function deliveryDurations(order) {
  const minutes = (from, to) => (from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS)) : null);
  return {
    kitchen: minutes(order.createdAt, order.readyAt),
    waiting: minutes(order.readyAt, order.dispatchedAt),
    transit: minutes(order.dispatchedAt, order.deliveredAt),
    total: minutes(order.createdAt, order.deliveredAt),
    onTime: order.deliveredAt ? order.deliveredAt.getTime() <= order.dueAt.getTime() : null,
  };
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const requiredText = (label, min, max) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(min, min === 1 ? `${label} yazın` : `${label} en az ${min} karakter`)
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

/** Telefon her biçimde yazılabilir ("0532 111 22 33"); sunucu otelin ülke koduyla rakamlara çevirir. */
const phoneField = z
  .string({ error: 'Telefon yazın' })
  .trim()
  .max(30, 'Telefon en fazla 30 karakter')
  .refine((value) => /^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7, { message: 'Telefon geçersiz' });

const positiveMoney = (label) => moneyInputField.refine((value) => Number(value) > 0, { message: `${label} 0'dan büyük olmalı` });

/* ─────────────── Personel uçları ─────────────── */

/**
 * Paket sipariş (personel girer): müşteri, adres, kalemler, kapıda beklenen ödeme (tamamı önceden ödendiyse boş),
 * nakitte bozuk para, ön ödemeler (kart / nakit; kartta slip / provizyon numarası).
 */
export const createDeliveryOrderSchema = z
  .object({
    /** Çift dokunuşta ikinci sipariş açılmasın. */
    requestId: uuid('Geçersiz istek'),
    outletId: uuid('Paket servis noktasını seçin'),
    source: z.enum(DELIVERY_SOURCES, { error: 'Siparişin geldiği yolu seçin' }),
    customerName: requiredText('Müşteri adı', 2, 120),
    phone: phoneField,
    address: requiredText('Adres', 5, MAX_DELIVERY_ADDRESS_LENGTH),
    addressNote: posOptionalText(MAX_DELIVERY_ADDRESS_NOTE_LENGTH, 'Adres tarifi').transform((value) => value ?? null),
    note: posOptionalText(MAX_DELIVERY_NOTE_LENGTH, 'Not').transform((value) => value ?? null),
    lines: menuOrderLinesField(MAX_DELIVERY_LINES),
    doorMethod: z.enum(DELIVERY_DOOR_METHODS, { error: 'Kapıda ödeme yöntemini seçin' }).nullish().transform((value) => value ?? null),
    /** Nakitte kuryenin götüreceği bozuk: müşteri "200'lük vereceğim" dedi. */
    changeFor: positiveMoney('Bozuk para tutarı').nullish().transform((value) => value ?? null),
    prepayments: z
      .array(doorPaymentSchema, { error: 'Ön ödemeler geçersiz' })
      .max(MAX_DELIVERY_PREPAYMENTS, `En fazla ${MAX_DELIVERY_PREPAYMENTS} ön ödeme`)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.changeFor && value.doorMethod !== 'CASH') ctx.addIssue({ code: 'custom', path: ['changeFor'], message: 'Bozuk para yalnızca kapıda nakitte yazılır' });
  });

export const deliveryParamSchema = z.object({ orderId: uuid('Geçersiz sipariş') });

/** Mutfak / servis adımı (hazırlanıyor, hazır, yolda; yoldan hazıra geri). "Yolda" kurye ister (boşsa atanmış). */
export const advanceDeliveryOrderSchema = z.object({
  expectedUpdatedAt,
  status: z.enum(['PREPARING', 'READY', 'ON_THE_WAY'], { error: 'Geçersiz adım' }),
  courierEmail: z.string().trim().toLowerCase().email('Kuryeyi seçin').nullish(),
});

/** Kurye ata / değiştir (yoldaki siparişte önce "hazır"a geri alınır). */
export const assignDeliveryCourierSchema = z.object({
  expectedUpdatedAt,
  courierEmail: z.string({ error: 'Kuryeyi seçin' }).trim().toLowerCase().email('Kuryeyi seçin'),
});

/** Teslim: kapıda alınan ödemeler (nakit / kart, bölünebilir) kalanı tam kapatır. */
export const deliverDeliveryOrderSchema = z.object({
  requestId: uuid('Geçersiz istek'),
  expectedUpdatedAt,
  payments: z
    .array(doorPaymentSchema, { error: 'Ödemeler geçersiz' })
    .max(MAX_DELIVERY_DOOR_PAYMENTS, `En fazla ${MAX_DELIVERY_DOOR_PAYMENTS} ödeme`)
    .default([]),
});

/** İptal: mutfak başladıysa kalemler zayi sayılır (`waste`; şef garson). */
export const cancelDeliveryOrderSchema = z.object({
  expectedUpdatedAt,
  reason: posReasonField('İptal sebebi'),
  waste: z.boolean().default(true),
});

export const deliveryBoardQuerySchema = z.object({ outletId: uuid('Geçersiz satış noktası').optional() });

/** Geçmiş: durum grubu, satış noktası, sipariş günü aralığı (otelin günü), arama (no, müşteri adı, telefon). */
export const deliveryListQuerySchema = paginationQuerySchema
  .extend({
    state: z.enum(DELIVERY_LIST_STATES, { error: 'Geçersiz durum' }).optional(),
    outletId: uuid('Geçersiz satış noktası').optional(),
    from: isoDayField.optional(),
    to: isoDayField.optional(),
    search: z.string().trim().max(60, 'Arama en fazla 60 karakter').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

/** Tekrar gelen müşteri: telefonla son adı ve adresleri. */
export const deliveryCustomerQuerySchema = z.object({ phone: phoneField });
