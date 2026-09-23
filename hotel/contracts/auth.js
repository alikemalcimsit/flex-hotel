import { z } from './locale.js';
import { EMAIL_PATTERN } from './fields.js';

/**
 * Kimlik doğrulama (oturum) sözleşmeleri.
 *
 * Sunucu login/refresh isteklerini bunlarla doğrular; tarayıcı da giriş
 * formunu göndermeden önce aynı şemayı kullanır.
 */

export const loginSchema = z.object({
  email: z
    .string({ error: 'E-posta zorunlu' })
    .trim()
    .toLowerCase()
    .min(1, 'E-posta zorunlu')
    .max(200, 'E-posta en fazla 200 karakter')
    .refine((value) => EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' }),
  // Girişte parolaya biçim kuralı uygulanmaz: kayıtlı kullanıcının mevcut
  // parolası ne olursa olsun denemesine izin verilir; yalnızca boş olamaz.
  password: z.string({ error: 'Şifre zorunlu' }).min(1, 'Şifre zorunlu').max(200, 'Şifre en fazla 200 karakter'),
});

export const refreshSchema = z.object({
  refreshToken: z.string({ error: 'Oturum anahtarı zorunlu' }).min(1, 'Oturum anahtarı zorunlu'),
});
