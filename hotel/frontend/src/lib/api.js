export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Backend'e istek atar, `{ success, data, error }` zarfını açar.
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({ success: false, error: 'Geçersiz cevap' }));
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body.data;
}
