export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Backend'in hata zarfını taşıyan hata tipi.
 *
 * `code` alanı ekranların dallanması içindir: "başkası değiştirdi" (STALE_WRITE)
 * ile "kullanımda olduğu için silinemez" (IN_USE) kullanıcıya bambaşka şeyler
 * söylemeli. Mesaj metnine göre dallanmak kırılgan olurdu.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, fields?: Record<string, string>, details?: unknown, status?: number }} [meta]
   */
  constructor(message, { code = 'ERROR', fields, details, status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields ?? {};
    this.details = details;
    this.status = status;
  }
}

/**
 * Backend'e istek atar, `{ success, data, error }` zarfını açar.
 * @param {string} path
 * @param {RequestInit} [options]
 */
/**
 * Denetim izine yazılacak kullanıcı.
 *
 * ⚠️ GEÇİCİ: sunucu bu başlığı doğrulamıyor, çünkü gerçek giriş henüz yok
 * (modül 2 / RBAC). Audit kaydının "kim" sütunu boş kalmasın diye gönderiliyor;
 * RBAC gelince sunucu bunu JWT'den okuyacak ve başlık kaldırılacak.
 */
function actorHeader() {
  try {
    const raw = localStorage.getItem('hotelos.auth');
    const user = raw ? JSON.parse(raw) : null;
    return user?.email ? { 'x-actor': user.email } : {};
  } catch {
    return {};
  }
}

/**
 * Yanıt vermeyen istek için üst sınır. Sunucu takılırsa kullanıcı sonsuza kadar
 * spinner'a bakmasın — anlaşılır bir hata görsün.
 */
const REQUEST_TIMEOUT_MS = 20_000;

export async function api(path, options = {}) {
  let response;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(`${API_URL}${path}`, {
      signal: timeout,
      headers: {
        'Content-Type': 'application/json',
        ...actorHeader(),
        ...(options.headers ?? {}),
      },
      ...options,
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ApiError('Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.', { code: 'TIMEOUT' });
    }
    // Ağ hatası: sunucu kapalı, DNS yok, CORS engeli.
    throw new ApiError('Sunucuya ulaşılamıyor. Backend çalışıyor mu?', { code: 'NETWORK' });
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new ApiError(body?.error ?? `Beklenmeyen cevap (HTTP ${response.status})`, {
      code: body?.code,
      fields: body?.fields,
      details: body?.details,
      status: response.status,
    });
  }

  return body.data;
}

/**
 * Sorgu parametrelerini yolun sonuna ekler; boş/undefined olanları atar.
 * @param {string} path
 * @param {Record<string, unknown>} [params]
 */
export function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** @param {string} path @param {unknown} body */
export const apiPost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

/** @param {string} path @param {unknown} body */
export const apiPut = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });

/** @param {string} path */
export const apiDelete = (path) => api(path, { method: 'DELETE' });
