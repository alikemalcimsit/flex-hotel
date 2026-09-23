import { z } from './locale.js';
import { EMAIL_PATTERN, expectedUpdatedAt } from './fields.js';
import { ROLES } from './permissions.js';

/**
 * Kullanıcı yönetimi sözleşmeleri (modül 2 — RBAC).
 *
 * Sunucu ve kullanıcı formu aynı şemayı kullanır. Parola kuralları tek yerde:
 * en az 8 karakter (kaba kuvvet saldırısına karşı asgari), yeni parola belirleme
 * ve sıfırlama aynı `passwordField`'ı paylaşır.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

const passwordField = z
  .string({ error: 'Şifre zorunlu' })
  .min(MIN_PASSWORD_LENGTH, `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`)
  .max(MAX_PASSWORD_LENGTH, `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter`);

const emailField = z
  .string({ error: 'E-posta zorunlu' })
  .trim()
  .toLowerCase()
  .min(1, 'E-posta zorunlu')
  .max(200, 'E-posta en fazla 200 karakter')
  .refine((value) => EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' });

const nameField = z
  .string({ error: 'Ad zorunlu' })
  .trim()
  .min(1, 'Ad zorunlu')
  .max(200, 'Ad en fazla 200 karakter');

const roleField = z.enum(ROLES, { error: 'Geçersiz rol' });

/** Yeni kullanıcı: e-posta + ad + rol + parola. */
export const userInputSchema = z.object({
  email: emailField,
  name: nameField,
  role: roleField,
  password: passwordField,
  isActive: z.boolean().optional().default(true),
});

/**
 * Kullanıcı güncelleme: parola burada değişmez (ayrı "şifre sıfırla" ucu var).
 * `expectedUpdatedAt` optimistic lock içindir.
 */
export const updateUserSchema = z.object({
  email: emailField,
  name: nameField,
  role: roleField,
  isActive: z.boolean({ error: 'Aktiflik değeri zorunlu' }),
  expectedUpdatedAt,
});

export const resetPasswordSchema = z.object({
  password: passwordField,
});
