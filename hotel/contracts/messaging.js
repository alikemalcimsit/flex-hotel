import { z } from './locale.js';
import {
  CHANNEL_REPORTED_DELIVERIES,
  CONVERSATION_CHANNELS,
  CONVERSATION_MODES,
  CONVERSATION_STATUSES,
  GUEST_REQUEST_ACTIVE_STATUSES,
  GUEST_REQUEST_CATEGORIES,
  GUEST_REQUEST_DEFAULT_PRIORITY,
  GUEST_REQUEST_MANUAL_SOURCES,
  GUEST_REQUEST_PRIORITIES,
  GUEST_REQUEST_SLA_MINUTES,
  GUEST_REQUEST_STATUS_LABELS,
  GUEST_REQUEST_STATUSES,
  GUEST_REQUEST_VIEWS,
  INBOX_PAGE_SIZE,
  INBOX_VIEWS,
  MAX_MESSAGE_LENGTH,
  MAX_REQUEST_DESCRIPTION_LENGTH,
  MAX_REQUEST_NOTE_LENGTH,
  MAX_REQUEST_SCHEDULE_DAYS,
  MAX_REQUEST_TITLE_LENGTH,
  MESSAGE_PAGE_SIZE,
} from './constants.js';
import { expectedUpdatedAt, paginationQuerySchema, queryBoolean } from './fields.js';

/**
 * Misafir mesajları ve istek takibi sözleşmeleri (modül 7).
 *
 * Kanallar (WhatsApp, web chat) modül 8'in işi. Buradaki sözleşme kanaldan
 * bağımsızdır: kanal gelen mesajı `inboundMessageSchema` ile teslim eder,
 * personelin cevabı "gönderim bekliyor" olarak yazılır ve kanal gönderdikçe
 * `deliveryReportSchema` ile durumunu bildirir.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Zamanlı istekte geçmiş saate tolerans: formu açıp birkaç dakika sonra
 * kaydeden personelin "07:00 uyandırma"sı reddedilmesin.
 */
const PAST_SCHEDULE_GRACE_MINUTES = 5;

const uuid = (message) => z.string().uuid({ message });

/* ─────────────── Gelen kutusu ─────────────── */

/**
 * Konuşma listesi. İmleçle sayfalanır: binlerce konuşmada "sayfa 40" diye
 * atlamak yerine "daha eski" diye ilerlenir; yeni mesaj gelince sayfalar kaymaz.
 */
export const inboxQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS, { error: 'Geçersiz görünüm' }).default('OPEN'),
  channel: z.enum(CONVERSATION_CHANNELS, { error: 'Geçersiz kanal' }).optional(),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(100, 'Kayıt sayısı en fazla 100 olabilir')
    .default(INBOX_PAGE_SIZE),
});

/** Konuşma geçmişi: en yeniden eskiye, imleçle. */
export const messagesQuerySchema = z.object({
  before: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(100, 'Kayıt sayısı en fazla 100 olabilir')
    .default(MESSAGE_PAGE_SIZE),
});

export const conversationParamSchema = z.object({
  conversationId: uuid('Geçersiz konuşma'),
});

const messageText = z
  .string({ error: 'Mesaj boş olamaz' })
  .trim()
  .min(1, 'Mesaj boş olamaz')
  .max(MAX_MESSAGE_LENGTH, `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir`);

/**
 * Personelin yazdığı mesaj ya da iç not.
 *
 * `clientMessageId`: çift tıklama / ağ tekrarı aynı mesajı iki kez
 * göndermesin diye tarayıcının ürettiği kimlik. Aynı kimlikle ikinci istek
 * ilk mesajı döndürür.
 */
export const sendMessageSchema = z.object({
  text: messageText,
  internal: z.boolean().default(false),
  clientMessageId: uuid('Geçersiz istemci kimliği').optional(),
});

/**
 * Konuşma üzerinde yönetim işlemleri. Hepsi isteğe bağlı ama en az biri olmalı.
 *
 * `expectedStateVersion` iki personelin aynı anda farklı karar vermesini
 * yakalar. `updatedAt` kullanılmıyor: her yeni misafir mesajı onu değiştirir
 * ve yoğun gelen kutusunda "ata" düğmesi sürekli çakışma verirdi.
 */
export const updateConversationSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES, { error: 'Geçersiz durum' }).optional(),
    mode: z.enum(CONVERSATION_MODES, { error: 'Geçersiz mod' }).optional(),
    assignedToId: uuid('Geçersiz personel').nullable().optional(),
    reservationId: uuid('Geçersiz rezervasyon').nullable().optional(),
    expectedStateVersion: z.coerce
      .number({ error: 'Sürüm bilgisi eksik' })
      .int('Sürüm bilgisi geçersiz')
      .min(0, 'Sürüm bilgisi geçersiz'),
  })
  .refine(
    (value) => ['status', 'mode', 'assignedToId', 'reservationId'].some((key) => value[key] !== undefined),
    { message: 'Değiştirilecek bir alan seçin', path: ['_'] },
  );

/* ─────────────── Kanal sözleşmesi (modül 8 kullanır) ─────────────── */

/**
 * Kanalın teslim ettiği gelen mesaj. `externalMessageId` zorunlu: WhatsApp
 * gibi kanallar aynı webhook'u tekrar gönderir, mesaj bir kez yazılmalı.
 */
export const inboundMessageSchema = z.object({
  channel: z.enum(CONVERSATION_CHANNELS, { error: 'Geçersiz kanal' }),
  externalId: z.string().trim().min(1, 'Gönderen adresi zorunlu').max(200, 'Gönderen adresi çok uzun'),
  externalMessageId: z.string().trim().min(1, 'Kanal mesaj kimliği zorunlu').max(200, 'Kanal mesaj kimliği çok uzun'),
  text: messageText,
  displayName: z.string().trim().max(120, 'Görünen ad çok uzun').optional().nullable(),
  sentAt: z.coerce.date({ error: 'Geçersiz gönderim zamanı' }).optional(),
});

/** Kanalın giden mesaj için bildirdiği durum. */
export const deliveryReportSchema = z.object({
  delivery: z.enum(CHANNEL_REPORTED_DELIVERIES, { error: 'Geçersiz teslim durumu' }),
  externalMessageId: z.string().trim().max(200, 'Kanal mesaj kimliği çok uzun').optional(),
  failureReason: z.string().trim().max(500, 'Hata metni çok uzun').optional(),
  at: z.coerce.date({ error: 'Geçersiz zaman' }).optional(),
});

/* ─────────────── Misafir istekleri ─────────────── */

/**
 * İstek durum geçişi kuralı — sunucu ve ekran aynı kuralı kullanır.
 *
 * - Bekleyen iş başlatılır, doğrudan tamamlanır ya da iptal edilir.
 * - Başlatılmış iş bekleyene geri alınabilir (yanlış kişi başladı).
 * - Tamamlanan ya da iptal edilen iş **yeniden açılabilir**: misafir "havlu
 *   gelmedi" diye tekrar arar, yeni kayıt açmak geçmişi böler.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string | null} hata mesajı; geçiş geçerliyse `null`
 */
export function guestRequestTransitionError(from, to) {
  if (!GUEST_REQUEST_STATUSES.includes(to)) return 'Geçersiz istek durumu';
  if (from === to) return null;
  const allowed = {
    OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
    IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
    DONE: ['OPEN'],
    CANCELLED: ['OPEN'],
  };
  if (allowed[from]?.includes(to)) return null;
  return `"${GUEST_REQUEST_STATUS_LABELS[from] ?? from}" durumundaki istek "${GUEST_REQUEST_STATUS_LABELS[to] ?? to}" yapılamaz.`;
}

/**
 * İsteğin hizmet süresi hedefi.
 *
 * Zamanlı istekte (uyandırma, ileri saatli transfer) hedef istenen zamandır;
 * diğerlerinde oluşturma anından itibaren önceliğin süresi.
 *
 * @param {{ priority: string, createdAt: Date, scheduledFor?: Date | null }} request
 * @returns {Date}
 */
export function guestRequestDueAt({ priority, createdAt, scheduledFor }) {
  if (scheduledFor) return new Date(scheduledFor);
  const minutes = GUEST_REQUEST_SLA_MINUTES[priority] ?? GUEST_REQUEST_SLA_MINUTES.NORMAL;
  return new Date(new Date(createdAt).getTime() + minutes * MINUTE_MS);
}

/**
 * İsteğin süreye göre durumu (ekran rozeti ve "gecikmiş" filtresi).
 *
 * @param {{ status: string, dueAt: Date | string }} request
 * @param {Date} [now]
 * @returns {{ active: boolean, overdue: boolean, minutesLeft: number }}
 *   `minutesLeft` negatifse o kadar dakika gecikmiş
 */
export function guestRequestTiming(request, now = new Date()) {
  const active = GUEST_REQUEST_ACTIVE_STATUSES.includes(request.status);
  const minutesLeft = Math.round((new Date(request.dueAt).getTime() - now.getTime()) / MINUTE_MS);
  return { active, overdue: active && minutesLeft < 0, minutesLeft };
}

/** Kategoriye göre varsayılan öncelik. @param {string} category */
export function defaultGuestRequestPriority(category) {
  return GUEST_REQUEST_DEFAULT_PRIORITY[category] ?? 'NORMAL';
}

const scheduledFor = z.coerce
  .date({ error: 'Geçersiz tarih/saat' })
  .refine((value) => value.getTime() <= Date.now() + MAX_REQUEST_SCHEDULE_DAYS * DAY_MS, {
    message: `En fazla ${MAX_REQUEST_SCHEDULE_DAYS} gün sonrası için kurulabilir`,
  });

/** Yeni zamanlı istek geçmişe kurulamaz (tolerans dışında). */
const futureScheduledFor = scheduledFor.refine(
  (value) => value.getTime() >= Date.now() - PAST_SCHEDULE_GRACE_MINUTES * MINUTE_MS,
  { message: 'Geçmiş bir saat seçilemez' },
);

const requestTitle = z
  .string({ error: 'Başlık zorunlu' })
  .trim()
  .min(1, 'Başlık zorunlu')
  .max(MAX_REQUEST_TITLE_LENGTH, `Başlık en fazla ${MAX_REQUEST_TITLE_LENGTH} karakter`);

const requestDescription = z
  .string()
  .trim()
  .max(MAX_REQUEST_DESCRIPTION_LENGTH, `Açıklama en fazla ${MAX_REQUEST_DESCRIPTION_LENGTH} karakter`)
  .optional()
  .nullable();

export const createGuestRequestSchema = z
  .object({
    category: z.enum(GUEST_REQUEST_CATEGORIES, { error: 'Kategori seçin' }),
    title: requestTitle,
    description: requestDescription,
    priority: z.enum(GUEST_REQUEST_PRIORITIES, { error: 'Geçersiz öncelik' }).optional(),
    source: z.enum(GUEST_REQUEST_MANUAL_SOURCES, { error: 'Geçersiz kaynak' }).default('FRONT_DESK'),
    roomId: uuid('Geçersiz oda').optional().nullable(),
    reservationId: uuid('Geçersiz rezervasyon').optional().nullable(),
    scheduledFor: futureScheduledFor.optional().nullable(),
    assignedToId: uuid('Geçersiz personel').optional().nullable(),
  })
  .refine((value) => value.category !== 'WAKE_UP' || value.scheduledFor, {
    path: ['scheduledFor'],
    message: 'Uyandırma için saat seçin',
  })
  .refine((value) => value.roomId || value.reservationId, {
    path: ['roomId'],
    message: 'Oda ya da konaklama seçin',
  });

/**
 * Konuşmadan istek: oda/konaklama/misafir konuşmadan alınır, kaynak mesajdır.
 * Konuşma bir konaklamaya bağlı değilse oda elle seçilir.
 */
export const createRequestFromConversationSchema = z
  .object({
    category: z.enum(GUEST_REQUEST_CATEGORIES, { error: 'Kategori seçin' }),
    title: requestTitle,
    description: requestDescription,
    priority: z.enum(GUEST_REQUEST_PRIORITIES, { error: 'Geçersiz öncelik' }).optional(),
    messageId: uuid('Geçersiz mesaj').optional().nullable(),
    roomId: uuid('Geçersiz oda').optional().nullable(),
    scheduledFor: futureScheduledFor.optional().nullable(),
    assignedToId: uuid('Geçersiz personel').optional().nullable(),
  })
  .refine((value) => value.category !== 'WAKE_UP' || value.scheduledFor, {
    path: ['scheduledFor'],
    message: 'Uyandırma için saat seçin',
  });

export const updateGuestRequestSchema = z
  .object({
    title: requestTitle.optional(),
    description: requestDescription,
    priority: z.enum(GUEST_REQUEST_PRIORITIES, { error: 'Geçersiz öncelik' }).optional(),
    assignedToId: uuid('Geçersiz personel').optional().nullable(),
    scheduledFor: scheduledFor.optional().nullable(),
    roomId: uuid('Geçersiz oda').optional().nullable(),
    expectedUpdatedAt,
  })
  .refine(
    (value) =>
      ['title', 'description', 'priority', 'assignedToId', 'scheduledFor', 'roomId'].some(
        (key) => value[key] !== undefined,
      ),
    { message: 'Değiştirilecek bir alan seçin', path: ['_'] },
  );

export const changeGuestRequestStatusSchema = z
  .object({
    status: z.enum(GUEST_REQUEST_STATUSES, { error: 'Geçersiz durum' }),
    note: z
      .string()
      .trim()
      .max(MAX_REQUEST_NOTE_LENGTH, `Not en fazla ${MAX_REQUEST_NOTE_LENGTH} karakter`)
      .optional()
      .nullable(),
    expectedUpdatedAt,
  })
  .refine((value) => value.status !== 'CANCELLED' || (value.note && value.note.length > 0), {
    path: ['note'],
    message: 'İptal sebebini yazın',
  });

export const guestRequestListQuerySchema = paginationQuerySchema.extend({
  view: z.enum(GUEST_REQUEST_VIEWS, { error: 'Geçersiz görünüm' }).default('ACTIVE'),
  category: z.enum(GUEST_REQUEST_CATEGORIES, { error: 'Geçersiz kategori' }).optional(),
  priority: z.enum(GUEST_REQUEST_PRIORITIES, { error: 'Geçersiz öncelik' }).optional(),
  assignedToId: uuid('Geçersiz personel').optional(),
  roomId: uuid('Geçersiz oda').optional(),
  conversationId: uuid('Geçersiz konuşma').optional(),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  unassigned: queryBoolean.optional(),
});

export const guestRequestParamSchema = z.object({
  requestId: uuid('Geçersiz istek'),
});
