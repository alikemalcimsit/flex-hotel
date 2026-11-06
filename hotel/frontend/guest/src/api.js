/**
 * Misafir uçlarının istemcisi. Oturum yok: kimlik adresteki imzalı bağlantıdır. Sunucu hatası `code` ile gelir;
 * ekran misafirin dilinde yazar (`errorText`).
 */
const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class GuestError extends Error {
  /** @param {string} message @param {string} code @param {number} status */
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {string} path `/public/...`
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 */
export async function guestApi(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new GuestError('Bağlantı kurulamadı', 'NETWORK', 0);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const code = response.status === 429 ? 'RATE_LIMIT' : response.status === 413 ? 'TOO_LARGE' : (payload?.code ?? (response.status === 404 ? 'NOT_FOUND' : 'UNKNOWN'));
    throw new GuestError(payload?.error ?? 'İstek başarısız', code, response.status);
  }
  return payload?.data;
}

/** Misafir portalı uçları. @param {string} token */
export const portalPath = (token, rest = '') => `/public/portal/${encodeURIComponent(token)}${rest}`;
/** Oda servisi (41) uçları. @param {string} token */
export const roomServicePath = (token, rest = '') => `/public/room-service/${encodeURIComponent(token)}${rest}`;

/** Web sohbeti balonunun betiği (8) — aynı API sunucusundan. */
export const webchatScriptUrl = () => `${API_URL}/webchat/widget.js`;
