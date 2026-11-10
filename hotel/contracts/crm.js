import { listQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * CRM & misafir kartı sözleşmeleri (modül 22).
 *
 * Misafirin tek profili: iletişim, kimlik, tercihler (kategori + değer +
 * kaynak + güven), etiketler (VIP / sorunlu), notlar; mükerrer kayıtlar
 * `mergeGuests` ile birleşir.
 */

/* ─────────────── Tercih (Prisma enum'larıyla birebir) ─────────────── */

export const PREFERENCE_CATEGORIES = Object.freeze(['FLOOR', 'BED', 'PILLOW', 'DIET', 'ALLERGY', 'ROOM_FEATURE', 'TRANSPORT', 'OCCASION', 'OTHER']);
export const PREFERENCE_CATEGORY_LABELS = Object.freeze({
  FLOOR: 'Kat / konum',
  BED: 'Yatak',
  PILLOW: 'Yastık',
  DIET: 'Beslenme',
  ALLERGY: 'Alerji',
  ROOM_FEATURE: 'Oda özelliği',
  TRANSPORT: 'Ulaşım',
  OCCASION: 'Özel gün',
  OTHER: 'Diğer',
});

export const PREFERENCE_SOURCES = Object.freeze(['STAFF', 'GUEST', 'AI']);
export const PREFERENCE_SOURCE_LABELS = Object.freeze({ STAFF: 'Personel', GUEST: 'Misafir', AI: 'Yapay zekâ' });
export const PREFERENCE_CONFIDENCES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
export const PREFERENCE_CONFIDENCE_LABELS = Object.freeze({ LOW: 'Düşük', MEDIUM: 'Orta', HIGH: 'Yüksek' });

// ALLERGY tercihinin değerleri modül 43'ün alerjen kodlarını kullanır
// (`ALLERGENS` / `ALLERGEN_LABELS`, recipes.js) — burada yeniden tanımlanmaz.

/** Önerilen etiketler (serbest etiket de girilebilir). */
export const SUGGESTED_GUEST_TAGS = Object.freeze(['VIP', 'Sorunlu', 'Sadık', 'Kurumsal', 'Balayı', 'Engelli erişimi']);

/* ─────────────── Şemalar ─────────────── */

const optionalTrimmed = (max) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => (v ? v : undefined));

/** Misafir kartı düzenleme (iletişim, kimlik, etiketler). */
export const guestCardUpdateSchema = z.object({
  firstName: z.string().trim().min(1, 'Ad zorunlu').max(100).optional(),
  lastName: z.string().trim().min(1, 'Soyad zorunlu').max(100).optional(),
  phone: optionalTrimmed(40),
  email: optionalTrimmed(200),
  nationality: optionalTrimmed(2),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçersiz tarih').optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const guestPreferenceSchema = z.object({
  category: z.enum(PREFERENCE_CATEGORIES, { error: 'Kategori seçin' }),
  value: z.string().trim().min(1, 'Değer zorunlu').max(200),
  source: z.enum(PREFERENCE_SOURCES).default('STAFF'),
  confidence: z.enum(PREFERENCE_CONFIDENCES).default('MEDIUM'),
});

export const guestPreferenceUpdateSchema = guestPreferenceSchema.partial();

export const guestNoteSchema = z.object({
  body: z.string().trim().min(1, 'Not boş olamaz').max(4000),
  pinned: z.boolean().default(false),
});

export const guestNoteUpdateSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  pinned: z.boolean().optional(),
});

/** Birleştirme: iki kayıt, hedefte kalacak alanlar (UI'nın seçtiği değerler). */
export const mergeGuestsSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  keep: z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(40).nullable(),
      email: z.string().trim().max(200).nullable(),
      nationality: z.string().trim().max(2).nullable(),
      idType: z.enum(['NATIONAL_ID', 'PASSPORT', 'OTHER']).nullable(),
      idNumber: z.string().trim().max(60).nullable(),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    })
    .partial()
    .optional(),
}).refine((v) => v.sourceId !== v.targetId, { message: 'Bir kaydı kendisiyle birleştiremezsiniz', path: ['sourceId'] });

export const guestListQuerySchema = listQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(40).optional(),
});
