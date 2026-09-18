import { z } from './locale.js';
import { PERMISSION_VALUES, ROLES } from './permissions.js';

/**
 * Rol → izin matrisi güncelleme sözleşmesi (modül 2 — RBAC).
 *
 * Ekran her rol için işaretli izinleri gönderir. ADMIN gönderilse de sunucu
 * yok sayar (ADMIN her zaman tüm izinlere sahip — kilitlenme koruması).
 * Bilinmeyen rol/izin reddedilir.
 */
export const matrixUpdateSchema = z.object({
  grants: z
    .array(
      z.object({
        role: z.enum(ROLES, { error: 'Geçersiz rol' }),
        permissions: z
          .array(z.enum(PERMISSION_VALUES, { error: 'Geçersiz izin' }))
          .refine((values) => new Set(values).size === values.length, { message: 'Aynı izin iki kez gönderilemez' }),
      }),
    )
    .min(1, 'En az bir rol gönderilmeli')
    .refine((rows) => new Set(rows.map((row) => row.role)).size === rows.length, {
      message: 'Aynı rol iki kez gönderilemez',
    }),
});
