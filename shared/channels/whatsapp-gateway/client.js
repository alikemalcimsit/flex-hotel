import { buildTextMessage, classifySendError, describeMetaError } from './protocol.js';

/**
 * Cloud API gönderim istemcisi (Graph API `POST /{phone-number-id}/messages`).
 */

/** Meta Graph API sürümü; kanal ayarından değiştirilebilir (Meta sürümleri emekliye ayırır). */
export const DEFAULT_GRAPH_VERSION = 'v22.0';
export const GRAPH_BASE_URL = 'https://graph.facebook.com';
/** Gönderim zaman aşımı: takılan istek yeniden denenir. */
export const SEND_TIMEOUT_MS = 15_000;

export class WhatsAppSendError extends Error {
  /**
   * @param {string} message
   * @param {{ retryable: boolean, code: string, status?: number | null, metaCode?: number | null }} details
   */
  constructor(message, { retryable, code, status = null, metaCode = null }) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.retryable = retryable;
    this.code = code;
    this.status = status;
    this.metaCode = metaCode;
  }
}

/**
 * @param {{
 *   phoneNumberId: string, accessToken: string, to: string, text: string,
 *   graphVersion?: string, fetchImpl?: typeof fetch, timeoutMs?: number, baseUrl?: string,
 * }} request
 * @returns {Promise<{ externalMessageId: string }>}
 */
export async function sendText({
  phoneNumberId,
  accessToken,
  to,
  text,
  graphVersion = DEFAULT_GRAPH_VERSION,
  fetchImpl = fetch,
  timeoutMs = SEND_TIMEOUT_MS,
  baseUrl = GRAPH_BASE_URL,
}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildTextMessage(to, text)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WhatsAppSendError(
      error?.name === 'TimeoutError' ? 'WhatsApp zamanında cevap vermedi' : 'WhatsApp\'a bağlanılamadı',
      { retryable: true, code: 'CONNECTION' },
    );
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = body?.error;
    const { retryable, code } = classifySendError(response.status, error);
    throw new WhatsAppSendError(describeMetaError(error), { retryable, code, status: response.status, metaCode: error?.code ?? null });
  }
  const externalMessageId = body?.messages?.[0]?.id;
  if (!externalMessageId) {
    throw new WhatsAppSendError('WhatsApp gönderimi doğrulamadı (mesaj kimliği yok)', { retryable: true, code: 'NO_ID', status: response.status });
  }
  return { externalMessageId };
}
