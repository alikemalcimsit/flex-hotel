import { listQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Teknik servis / arıza-bakım sözleşmeleri (modül 20).
 *
 * Bilet yaşam döngüsü `TaskStatus` (PENDING→IN_PROGRESS→DONE/CANCELLED) ile; oda
 * arızası odayı kapatabilir (RoomBlock, modül 3). Periyodik bakım planı her
 * periyotta bilet üretir.
 */

/* ─────────────── Sabitler (Prisma enum'larıyla birebir) ─────────────── */

export const MAINTENANCE_CATEGORIES = Object.freeze(['ELECTRICAL', 'PLUMBING', 'HVAC', 'FURNITURE', 'APPLIANCE', 'STRUCTURAL', 'SAFETY', 'OTHER']);
export const MAINTENANCE_CATEGORY_LABELS = Object.freeze({
  ELECTRICAL: 'Elektrik',
  PLUMBING: 'Su tesisatı',
  HVAC: 'Isıtma / soğutma',
  FURNITURE: 'Mobilya',
  APPLIANCE: 'Beyaz eşya / cihaz',
  STRUCTURAL: 'Yapısal',
  SAFETY: 'Güvenlik',
  OTHER: 'Diğer',
});

export const MAINTENANCE_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const MAINTENANCE_STATUS_LABELS = Object.freeze({ PENDING: 'Açık', IN_PROGRESS: 'Devam ediyor', DONE: 'Çözüldü', CANCELLED: 'İptal' });
export const MAINTENANCE_STATUS_TONES = Object.freeze({ PENDING: 'warning', IN_PROGRESS: 'info', DONE: 'success', CANCELLED: 'neutral' });

/** Liste görünümleri. */
export const MAINTENANCE_VIEWS = Object.freeze(['OPEN', 'MINE', 'ALL']);

/** Oda kapatma türü (RoomBlockType ile birebir). */
export const MAINTENANCE_BLOCK_TYPES = Object.freeze(['OUT_OF_ORDER', 'OUT_OF_SERVICE']);
export const MAINTENANCE_BLOCK_TYPE_LABELS = Object.freeze({ OUT_OF_ORDER: 'Arızalı (satılamaz)', OUT_OF_SERVICE: 'Hizmet dışı (atanmaz)' });

/* ─────────────── Fotoğraf (modül 21 ile aynı sınırlar) ─────────────── */

export const MAINTENANCE_MAX_PHOTOS = 6;
export const MAINTENANCE_PHOTO_MAX_BYTES = 1_500_000;
export const MAINTENANCE_THUMB_MAX_BYTES = 120_000;
export const MAINTENANCE_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/webp']);
export const MAINTENANCE_PHOTO_PURGE_DAYS = 60;

const base64Field = (label, maxBytes) =>
  z.string({ error: `${label} zorunlu` }).min(1, `${label} zorunlu`).max(Math.ceil((maxBytes * 4) / 3) + 4, `${label} çok büyük`);

export const maintenancePhotoSchema = z.object({
  contentType: z.enum(MAINTENANCE_PHOTO_TYPES, { error: 'Fotoğraf JPEG ya da WebP olmalı' }),
  image: base64Field('Fotoğraf', MAINTENANCE_PHOTO_MAX_BYTES),
  thumbnail: base64Field('Önizleme', MAINTENANCE_THUMB_MAX_BYTES),
});

export const MAINTENANCE_PHOTO_BODY_LIMIT = Math.ceil(((MAINTENANCE_PHOTO_MAX_BYTES + MAINTENANCE_THUMB_MAX_BYTES) * 4) / 3) + 16_384;

/* ─────────────── Bilet ─────────────── */

const priorityField = z.coerce.number().int().min(1, 'Öncelik 1–5').max(5, 'Öncelik 1–5');

/** Oda kapatma (opsiyonel): oda arızalı/hizmet dışı işaretlenir. */
const closeRoomSchema = z.object({
  type: z.enum(MAINTENANCE_BLOCK_TYPES, { error: 'Kapatma türü seçin' }),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçersiz gün').optional(),
});

export const maintenanceTicketCreateSchema = z
  .object({
    roomId: z.string().uuid().optional(),
    locationText: z.string().trim().min(1).max(200).optional(),
    category: z.enum(MAINTENANCE_CATEGORIES).default('OTHER'),
    title: z.string().trim().min(1, 'Başlık zorunlu').max(200),
    description: z.string().trim().min(1, 'Açıklama zorunlu').max(4000),
    priority: priorityField.default(3),
    assignedTo: z.string().uuid().optional(),
    guestRequestId: z.string().uuid().optional(),
    closeRoom: closeRoomSchema.optional(),
  })
  .refine((value) => value.roomId || value.locationText, { message: 'Oda ya da konum belirtin', path: ['roomId'] })
  .refine((value) => !value.closeRoom || value.roomId, { message: 'Odayı kapatmak için oda seçin', path: ['closeRoom'] });

export const maintenanceTicketUpdateSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  priority: priorityField.optional(),
});

export const maintenanceAssignSchema = z.object({ assignedTo: z.string().uuid().nullable() });
export const maintenanceResolveSchema = z.object({ resolutionNote: z.string().trim().max(4000).optional() });
export const maintenanceCancelSchema = z.object({ reason: z.string().trim().min(1, 'Sebep zorunlu').max(1000) });

export const maintenanceTicketListQuerySchema = listQuerySchema.extend({
  view: z.enum(MAINTENANCE_VIEWS).default('OPEN'),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  roomId: z.string().uuid().optional(),
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
});

/* ─────────────── Periyodik bakım planı ─────────────── */

const maintenancePlanBaseSchema = z.object({
  title: z.string().trim().min(1, 'Başlık zorunlu').max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(MAINTENANCE_CATEGORIES).default('OTHER'),
  roomId: z.string().uuid().optional(),
  locationText: z.string().trim().min(1).max(200).optional(),
  intervalDays: z.coerce.number().int().min(1, 'Periyot en az 1 gün').max(3650),
  priority: priorityField.default(3),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  active: z.boolean().default(true),
});

export const maintenancePlanSchema = maintenancePlanBaseSchema.refine((value) => value.roomId || value.locationText, { message: 'Oda ya da konum belirtin', path: ['roomId'] });

/** Plan düzenleme: alanların hepsi opsiyonel (PATCH). */
export const maintenancePlanUpdateSchema = maintenancePlanBaseSchema.partial();

export const maintenancePlanListQuerySchema = listQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
});
