import { toFieldErrors } from '@hotelos/hotel-contracts';

/**
 * Formu, sunucunun kullandığı zod şemasının **aynısıyla** doğrular.
 *
 * Kuralları React tarafında elle tekrar yazmak, iki hafta içinde "tarayıcı
 * kabul etti ama sunucu reddetti" durumuna yol açıyordu. Tek kaynak
 * `@hotelos/hotel-contracts`.
 *
 * @template T
 * @param {{ safeParse: (input: unknown) => { success: boolean, data?: T, error?: import('zod').ZodError } }} schema
 * @param {unknown} values
 * @returns {{ ok: true, data: T } | { ok: false, errors: Record<string, string> }}
 */
export function validateWith(schema, values) {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: toFieldErrors(result.error) };
}
