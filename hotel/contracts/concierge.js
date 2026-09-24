import { z } from './locale.js';
import { decimalField, expectedUpdatedAt } from './fields.js';

/**
 * Sohbetle rezervasyon sözleşmeleri (modül 8): AI asistanı ayarları, mesaj
 * kanalı bağlantıları (WhatsApp, web chat) ve web chat balonunun gönderdiği
 * mesaj. Sunucu ve panel aynı şemayı kullanır.
 */

/* ─────────────── Niyet ─────────────── */

/** Router ajanının sınıfları (event kataloğundaki `guest.intent.detected` ile birebir). */
export const GUEST_INTENTS = Object.freeze(['RESERVATION', 'QUESTION', 'COMPLAINT', 'HUMAN', 'OTHER']);

export const GUEST_INTENT_LABELS = Object.freeze({
  RESERVATION: 'Rezervasyon',
  QUESTION: 'Soru',
  COMPLAINT: 'Şikâyet',
  HUMAN: 'Personel istedi',
  OTHER: 'Diğer',
});

/** Konuşmayı personele devreden niyetler (AI cevap vermez). */
export const HANDOFF_INTENTS = Object.freeze(['COMPLAINT', 'HUMAN']);

/* ─────────────── AI ayarları ─────────────── */

/** AI'ın açtığı rezervasyonun durumu. */
export const AI_RESERVATION_STATUSES = Object.freeze(['CONFIRMED', 'PENDING']);

export const AI_RESERVATION_STATUS_LABELS = Object.freeze({
  CONFIRMED: 'Kesin (misafire onay bildirimi gider)',
  PENDING: 'Opsiyonlu (personel onaylar)',
});

export const MAX_HOTEL_INFO_LENGTH = 8000;
export const MAX_MODEL_NAME_LENGTH = 100;
export const MAX_DAILY_BUDGET_USD = 10_000;
export const MAX_REPLIES_PER_CONVERSATION_DAY = 500;
/** Kullanım ekranının gösterdiği en uzun dönem (gün). */
export const MAX_USAGE_DAYS = 90;

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const modelName = z
  .string()
  .trim()
  .max(MAX_MODEL_NAME_LENGTH, `Model adı en fazla ${MAX_MODEL_NAME_LENGTH} karakter`)
  .refine((value) => value === '' || MODEL_NAME_PATTERN.test(value), { message: 'Model adı yalnızca harf, rakam, nokta, tire ve iki nokta içerebilir' });

/** 1M token başına USD fiyat (sağlayıcının fiyat sayfasındaki değer). */
const priceField = (label) => decimalField({ scale: 4, min: 0, max: 1000, label });

export const modelPriceSchema = z.object({
  input: priceField('Girdi fiyatı'),
  cachedInput: priceField('Önbellekli girdi fiyatı'),
  output: priceField('Çıktı fiyatı'),
});

export const aiSettingsSchema = z
  .object({
    enabled: z.boolean({ error: 'Açık/kapalı bilgisi eksik' }),
    routerModel: modelName,
    conciergeModel: modelName,
    prices: z.record(z.string().min(1).max(MAX_MODEL_NAME_LENGTH), modelPriceSchema).default({}),
    dailyBudgetUsd: decimalField({ scale: 2, min: 0, max: MAX_DAILY_BUDGET_USD, label: 'Günlük bütçe' }),
    reservationStatus: z.enum(AI_RESERVATION_STATUSES, { error: 'Geçersiz rezervasyon durumu' }),
    hotelInfo: z
      .string()
      .trim()
      .max(MAX_HOTEL_INFO_LENGTH, `Otel bilgisi en fazla ${MAX_HOTEL_INFO_LENGTH} karakter`)
      .transform((value) => value || null)
      .nullish(),
    maxRepliesPerConversationDay: z.coerce
      .number({ error: 'Cevap sınırı sayı olmalı' })
      .int('Cevap sınırı tam sayı olmalı')
      .min(1, 'Cevap sınırı en az 1')
      .max(MAX_REPLIES_PER_CONVERSATION_DAY, `Cevap sınırı en fazla ${MAX_REPLIES_PER_CONVERSATION_DAY}`),
    /** Kayıt yoksa boş (ilk kayıt). */
    expectedUpdatedAt: expectedUpdatedAt.nullish(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (!value.routerModel) ctx.addIssue({ code: 'custom', path: ['routerModel'], message: 'AI açıkken sınıflandırma modeli seçilmeli' });
    if (!value.conciergeModel) ctx.addIssue({ code: 'custom', path: ['conciergeModel'], message: 'AI açıkken konuşma modeli seçilmeli' });
    for (const model of new Set([value.routerModel, value.conciergeModel])) {
      if (model && !value.prices[model]) {
        ctx.addIssue({ code: 'custom', path: ['prices', model], message: `"${model}" modelinin fiyatını girin (maliyet sayılmadan bütçe denetlenemez)` });
      }
    }
    if (Number(value.dailyBudgetUsd) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['dailyBudgetUsd'], message: 'AI açıkken günlük bütçe 0\'dan büyük olmalı' });
    }
  });

export const aiUsageQuerySchema = z.object({
  days: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int()
    .min(1, 'En az 1 gün')
    .max(MAX_USAGE_DAYS, `En fazla ${MAX_USAGE_DAYS} gün`)
    .default(30),
});

/* ─────────────── Mesaj kanalları ─────────────── */

export const MESSAGING_CHANNELS = Object.freeze(['WHATSAPP', 'WEBCHAT']);

export const MAX_ALLOWED_ORIGINS = 20;
export const MAX_WIDGET_TITLE_LENGTH = 60;
export const MAX_WIDGET_GREETING_LENGTH = 300;
export const MAX_WIDGET_NAME_LENGTH = 80;

/** Sırrı olan alan: boş bırakılırsa kayıtlı değer korunur. */
const secretField = (label, min, max) =>
  z
    .string()
    .trim()
    .max(max, `${label} çok uzun`)
    .refine((value) => value === '' || value.length >= min, { message: `${label} en az ${min} karakter` })
    .transform((value) => value || null)
    .nullish();

export const whatsappChannelSchema = z
  .object({
    enabled: z.boolean({ error: 'Açık/kapalı bilgisi eksik' }),
    /** Meta: WhatsApp Business hesabındaki telefon numarası kimliği (Phone number ID). */
    phoneNumberId: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{5,30}$/.test(value), { message: 'Telefon numarası kimliği yalnızca rakam olmalı (Meta panelindeki "Phone number ID")' })
      .transform((value) => value || null)
      .nullish(),
    displayPhone: z.string().trim().max(40, 'Numara çok uzun').transform((value) => value || null).nullish(),
    /** Meta Graph API sürümü ("v22.0"); boşsa geçidin varsayılanı. Meta eski sürümleri emekliye ayırır. */
    graphVersion: z
      .string()
      .trim()
      .refine((value) => value === '' || /^v\d{1,3}\.\d$/.test(value), { message: 'Sürüm "v22.0" biçiminde olmalı' })
      .transform((value) => value || null)
      .nullish(),
    accessToken: secretField('Erişim token\'ı', 20, 1000),
    appSecret: secretField('Uygulama sırrı', 16, 200),
    verifyToken: secretField('Doğrulama token\'ı', 16, 200),
    expectedUpdatedAt: expectedUpdatedAt.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && !value.phoneNumberId) {
      ctx.addIssue({ code: 'custom', path: ['phoneNumberId'], message: 'Kanalı açmak için telefon numarası kimliğini girin' });
    }
  });

/**
 * Site adresi: yalnızca köken (şema + alan adı + port). Balon bu adreslerden
 * gelen bağlantıyı kabul eder. Üretimde https zorunlu; geliştirme için
 * localhost http kabul edilir.
 * @param {string} value
 * @returns {string | null} normalize edilmiş köken ya da geçersizse null
 */
export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const webchatChannelSchema = z.object({
  enabled: z.boolean({ error: 'Açık/kapalı bilgisi eksik' }),
  allowedOrigins: z
    .array(z.string().trim().min(1))
    .max(MAX_ALLOWED_ORIGINS, `En fazla ${MAX_ALLOWED_ORIGINS} site adresi`)
    .transform((values, ctx) => {
      const origins = [];
      for (const [index, value] of values.entries()) {
        const origin = normalizeOrigin(value);
        if (!origin) {
          ctx.addIssue({ code: 'custom', path: [index], message: `"${value}" geçerli bir site adresi değil (https://otelim.com biçiminde)` });
          continue;
        }
        if (!origins.includes(origin)) origins.push(origin);
      }
      return origins;
    }),
  title: z
    .string()
    .trim()
    .min(1, 'Balon başlığı zorunlu')
    .max(MAX_WIDGET_TITLE_LENGTH, `Başlık en fazla ${MAX_WIDGET_TITLE_LENGTH} karakter`),
  greeting: z
    .string()
    .trim()
    .max(MAX_WIDGET_GREETING_LENGTH, `Karşılama en fazla ${MAX_WIDGET_GREETING_LENGTH} karakter`)
    .transform((value) => value || null)
    .nullish(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalı'),
  expectedUpdatedAt: expectedUpdatedAt.nullish(),
}).superRefine((value, ctx) => {
  // Balon yalnızca izin verilen sitelerde bağlanır; liste boşken açmak "açık ama hiçbir yerde çalışmıyor" olurdu.
  if (value.enabled && value.allowedOrigins.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['allowedOrigins'], message: 'Balonu açmak için en az bir site adresi girin' });
  }
});

/** Balonun genel anahtarını yeniler (eski gömme kodu çalışmayı bırakır). */
export const rotateWebchatKeySchema = z.object({ expectedUpdatedAt });

/* ─────────────── Web chat balonu → sunucu ─────────────── */

/**
 * Misafirin balondan gönderdiği mesaj. `clientMessageId` balonun ürettiği
 * kimlik: bağlantı koparken yeniden gönderilen mesaj ikinci kez yazılmaz.
 */
export const webchatMessageSchema = z.object({
  clientMessageId: z.string().uuid({ message: 'Geçersiz mesaj kimliği' }),
  text: z
    .string({ error: 'Mesaj boş olamaz' })
    .trim()
    .min(1, 'Mesaj boş olamaz')
    .max(2000, 'Mesaj en fazla 2000 karakter'),
  name: z.string().trim().max(MAX_WIDGET_NAME_LENGTH, 'Ad çok uzun').transform((value) => value || null).nullish(),
});
