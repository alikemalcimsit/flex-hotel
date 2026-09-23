import { useAuthStore } from '../store/auth.js';

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
 * Giriş yapmış kullanıcının erişim token'ı. Sunucu kimliği ve otel bağlamını
 * buradan okur (modül 2 — RBAC); artık `x-actor` başlığı gönderilmez.
 */
function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Yanıt vermeyen istek için üst sınır. Sunucu takılırsa kullanıcı sonsuza kadar
 * spinner'a bakmasın — anlaşılır bir hata görsün.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Erişim token'ı 401 aldığında tek seferlik yenileme. Eşzamanlı 401'ler tek
 * yenileme isteğini paylaşır (token storm olmasın).
 * @type {Promise<boolean> | null}
 */
let refreshPromise = null;

async function refreshAccessToken() {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return false;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) return false;
        useAuthStore.getState().setSession(body.data);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

/**
 * Backend'e istek atar, `{ success, data, error }` zarfını açar.
 *
 * 401 alınırsa (erişim token'ı süresi doldu) bir kez `/auth/refresh` denenir ve
 * istek tekrarlanır; yenileme de başarısızsa oturum kapatılır — `RequireAuth`
 * kullanıcıyı giriş ekranına düşürür.
 *
 * @param {string} path
 * @param {RequestInit & { _noAuthRetry?: boolean }} [options]
 */
export async function api(path, options = {}) {
  let response;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const { headers: extraHeaders, _noAuthRetry, ...rest } = options;

  try {
    response = await fetch(`${API_URL}${path}`, {
      signal: timeout,
      ...rest,
      // Başlıklar en son birleştirilir: `options.headers` verilseydi eskiden
      // bütün başlıkları (Authorization dahil) sessizce eziyordu. İçerik tipi
      // yalnızca gövde varken gönderilir.
      headers: {
        ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeader(),
        ...(extraHeaders ?? {}),
      },
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ApiError('Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.', { code: 'TIMEOUT' });
    }
    // Ağ hatası: sunucu kapalı, DNS yok, CORS engeli.
    throw new ApiError('Sunucuya ulaşılamıyor. Backend çalışıyor mu?', { code: 'NETWORK' });
  }

  // Token süresi dolmuş: bir kez yenile ve isteği tekrarla. `/auth/*` uçları
  // (login/refresh/logout) bu döngünün dışında — 401'leri gerçek hatadır.
  if (response.status === 401 && !_noAuthRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api(path, { ...options, _noAuthRetry: true });
    useAuthStore.getState().logout();
    throw new ApiError('Oturumunuz sona erdi, lütfen tekrar giriş yapın.', { code: 'UNAUTHORIZED', status: 401 });
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

/** @param {string} path @param {unknown} body */
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

/** @param {string} path */
export const apiDelete = (path) => api(path, { method: 'DELETE' });
