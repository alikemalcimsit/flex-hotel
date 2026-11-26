import { API_SCOPES, API_SCOPE_REQUIRES } from '@hotelos/hotel-contracts';

/**
 * Seçim değişince gereksinimler kendiliğinden eklenir (yazma → okuma + müsaitlik); gereksinimi kaldırmak yazmayı da
 * kaldırır — form hiç geçersiz duruma düşmez.
 * @param {string[]} current @param {string} scope @param {boolean} on
 */
export function toggleScope(current, scope, on) {
  let next = on ? [...new Set([...current, scope, ...(API_SCOPE_REQUIRES[scope] ?? [])])] : current.filter((item) => item !== scope);
  if (!on) next = next.filter((item) => (API_SCOPE_REQUIRES[item] ?? []).every((need) => next.includes(need)));
  return API_SCOPES.filter((item) => next.includes(item));
}

