/**
 * Channex.io API istemcisi (modül 33) — yalnızca kullandığımız uçlar.
 *
 * Belge: https://docs.channex.io (API v1). Kimlik `user-api-key` başlığıyla.
 * Müsaitlik oda tipine (`POST /availability`), fiyat ve kısıtlar fiyat planına
 * (`POST /restrictions`) gider; ikisi de mülk başına dakikada 10 çağrıyla
 * sınırlıdır (fazlası 429). Rezervasyonlar revizyon akışından okunur ve her
 * revizyon teyit edilir (`ack`); teyit edilmeyen revizyon tekrar gelir.
 *
 * Altyapı bilmez: `fetchImpl` dışarıdan verilebilir (testler), verilmezse
 * çağrı anındaki `globalThis.fetch` kullanılır.
 */

/** Ortam → API kökü. */
export const CHANNEX_BASE_URLS = Object.freeze({
  STAGING: 'https://staging.channex.io/api/v1',
  PRODUCTION: 'https://app.channex.io/api/v1',
});

/** Tek çağrının en uzun süresi. */
export const CHANNEX_TIMEOUT_MS = 20_000;

/** Hız sınırında (429) beklenecek süre — Channex bir dakika bekleyip yeniden denemeyi önerir. */
export const CHANNEX_RATE_LIMIT_PAUSE_MS = 60_000;

/** Revizyon akışında sayfa boyutu (Channex en fazla 100). */
export const CHANNEX_FEED_PAGE_SIZE = 100;

/** Webhook olayları: yalnızca rezervasyon (yeni, değişiklik, iptal). */
export const CHANNEX_WEBHOOK_EVENTS = 'booking';

/** Webhook'ta Channex'in her bildirimde gönderdiği paylaşılan sır başlığı. */
export const CHANNEX_WEBHOOK_SECRET_HEADER = 'x-hotelos-webhook-secret';

/**
 * Channex hatası. `auth`: anahtar geçersiz / yetkisiz (yeniden denemek düzeltmez);
 * `retryable`: geçici (ağ, 5xx, 429); `retryAfterMs`: 429'da beklenecek süre.
 */
export class ChannexError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, retryable?: boolean, auth?: boolean, retryAfterMs?: number | null, details?: unknown }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'ChannexError';
    this.status = info.status ?? 0;
    this.code = info.code ?? 'CHANNEX_ERROR';
    this.retryable = info.retryable ?? false;
    this.auth = info.auth ?? false;
    this.retryAfterMs = info.retryAfterMs ?? null;
    this.details = info.details ?? null;
  }
}

/** @param {unknown} body */
function errorTitle(body) {
  const errors = /** @type {any} */ (body)?.errors;
  if (!errors) return null;
  if (typeof errors.title === 'string') return errors.title;
  if (Array.isArray(errors) && errors[0]?.title) return errors[0].title;
  if (typeof errors.details === 'object') return JSON.stringify(errors.details).slice(0, 300);
  return null;
}

/**
 * @param {Response} response
 * @param {unknown} body
 */
function toError(response, body) {
  const status = response.status;
  const title = errorTitle(body);
  if (status === 401 || status === 403) {
    return new ChannexError('Channex API anahtarı geçersiz ya da bu mülke yetkisi yok', { status, code: 'CHANNEX_AUTH', auth: true, details: body });
  }
  if (status === 429) {
    const header = Number(response.headers?.get?.('retry-after'));
    return new ChannexError('Channex hız sınırı aşıldı (dakikada 10 çağrı); bir dakika sonra yeniden denenecek', {
      status,
      code: 'CHANNEX_RATE_LIMIT',
      retryable: true,
      retryAfterMs: Number.isFinite(header) && header > 0 ? header * 1000 : CHANNEX_RATE_LIMIT_PAUSE_MS,
      details: body,
    });
  }
  if (status === 404) {
    return new ChannexError(title ? `Channex'te bulunamadı: ${title}` : "Channex'te bulunamadı (mülk / kayıt kimliği yanlış)", { status, code: 'CHANNEX_NOT_FOUND', details: body });
  }
  if (status >= 500) {
    return new ChannexError(`Channex geçici hata verdi (${status})`, { status, code: 'CHANNEX_UNAVAILABLE', retryable: true, details: body });
  }
  return new ChannexError(title ? `Channex isteği reddetti: ${title}` : `Channex isteği reddetti (${status})`, { status, code: 'CHANNEX_REJECTED', details: body });
}

/**
 * @param {{ environment: 'STAGING' | 'PRODUCTION', apiKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export function createChannexClient({ environment, apiKey, fetchImpl, timeoutMs = CHANNEX_TIMEOUT_MS }) {
  const baseUrl = CHANNEX_BASE_URLS[environment];
  if (!baseUrl) throw new ChannexError(`Bilinmeyen Channex ortamı: ${environment}`, { code: 'CHANNEX_CONFIG' });

  /**
   * @param {'GET' | 'POST' | 'DELETE'} method
   * @param {string} path
   * @param {{ query?: Record<string, string | number>, body?: unknown }} [options]
   */
  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    let response;
    try {
      response = await doFetch(url.toString(), {
        method,
        headers: {
          'user-api-key': apiKey,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new ChannexError(timedOut ? `Channex ${timeoutMs / 1000} saniyede cevap vermedi` : `Channex'e bağlanılamadı: ${error?.message ?? error}`, {
        code: timedOut ? 'CHANNEX_TIMEOUT' : 'CHANNEX_NETWORK',
        retryable: true,
      });
    }
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 500) };
      }
    }
    if (!response.ok) throw toError(response, parsed);
    return parsed ?? {};
  }

  /** ARI çağrısının sonucu: Channex'in iş (task) kimliği ve reddedilen satırların uyarıları. */
  const ariResult = (response) => ({
    taskId: response?.data?.[0]?.id ?? response?.data?.id ?? null,
    warnings: Array.isArray(response?.meta?.warnings) ? response.meta.warnings : [],
  });

  return {
    environment,

    /** @param {string} propertyId */
    async getProperty(propertyId) {
      const response = await request('GET', `/properties/${encodeURIComponent(propertyId)}`);
      const attributes = response?.data?.attributes ?? {};
      return {
        id: response?.data?.id ?? propertyId,
        title: attributes.title ?? null,
        currency: attributes.currency ?? null,
        timezone: attributes.timezone ?? null,
      };
    },

    /** Mülkün oda tipleri (eşleştirme ekranı). @param {string} propertyId */
    async listRoomTypes(propertyId) {
      const response = await request('GET', '/room_types/options', { query: { 'filter[property_id]': propertyId } });
      return (response?.data ?? [])
        .map((row) => ({ id: row.id ?? row.attributes?.id, ...row.attributes }))
        .filter((row) => !row.property_id || row.property_id === propertyId)
        .map((row) => ({ id: row.id, title: row.title ?? row.id, occupancy: row.default_occupancy ?? row.occupancy ?? null }));
    },

    /** Mülkün fiyat planları (oda tipine bağlı). @param {string} propertyId */
    async listRatePlans(propertyId) {
      const response = await request('GET', '/rate_plans/options', { query: { 'filter[property_id]': propertyId } });
      return (response?.data ?? [])
        .map((row) => ({ id: row.id ?? row.attributes?.id, ...row.attributes }))
        .filter((row) => !row.property_id || row.property_id === propertyId)
        .map((row) => ({
          id: row.id,
          title: row.title ?? row.id,
          roomTypeId: row.room_type_id ?? null,
          sellMode: row.sell_mode ?? null,
          occupancy: row.occupancy ?? null,
        }));
    },

    /** @param {Array<object>} values */
    async updateAvailability(values) {
      return ariResult(await request('POST', '/availability', { body: { values } }));
    },

    /** @param {Array<object>} values */
    async updateRestrictions(values) {
      return ariResult(await request('POST', '/restrictions', { body: { values } }));
    },

    /**
     * Teyit edilmemiş revizyonlar (eskiden yeniye).
     * @param {string} propertyId
     * @returns {Promise<{ revisions: object[], total: number }>}
     */
    async bookingFeed(propertyId) {
      const response = await request('GET', '/booking_revisions/feed', {
        query: {
          'filter[property_id]': propertyId,
          'order[inserted_at]': 'asc',
          'pagination[page]': 1,
          'pagination[limit]': CHANNEX_FEED_PAGE_SIZE,
        },
      });
      const revisions = (response?.data ?? []).map((row) => ({ ...row.attributes, id: row.id ?? row.attributes?.id }));
      return { revisions, total: Number(response?.meta?.total ?? revisions.length) };
    },

    /** @param {string} revisionId */
    async ackRevision(revisionId) {
      await request('POST', `/booking_revisions/${encodeURIComponent(revisionId)}/ack`);
    },

    /**
     * Rezervasyon webhook'u: Channex her revizyonda adrese haber verir; sır başlıkta gelir.
     * @param {{ propertyId: string, callbackUrl: string, secret: string }} input
     * @returns {Promise<string>} webhook kimliği
     */
    async createWebhook({ propertyId, callbackUrl, secret }) {
      const response = await request('POST', '/webhooks', {
        body: {
          webhook: {
            property_id: propertyId,
            callback_url: callbackUrl,
            event_mask: CHANNEX_WEBHOOK_EVENTS,
            headers: { [CHANNEX_WEBHOOK_SECRET_HEADER]: secret },
            request_params: {},
            is_active: true,
            send_data: true,
          },
        },
      });
      const id = response?.data?.id ?? response?.data?.attributes?.id;
      if (!id) throw new ChannexError('Channex webhook kimliği dönmedi', { code: 'CHANNEX_REJECTED', details: response });
      return id;
    },

    /** @param {string} webhookId */
    async deleteWebhook(webhookId) {
      try {
        await request('DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
      } catch (error) {
        // Channex'te zaten yoksa amaç gerçekleşmiş.
        if (!(error instanceof ChannexError) || error.status !== 404) throw error;
      }
    },
  };
}
