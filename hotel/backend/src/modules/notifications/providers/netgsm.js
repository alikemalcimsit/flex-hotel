import { smsInfo } from '@hotelos/hotel-contracts';
import { ProviderError } from './provider-error.js';

/**
 * Netgsm SMS adaptörü (REST v2).
 *
 * Kaynak: Netgsm'in resmi `@netgsm/sms` paketi (1.1.x) ve SMS teknik şartnamesi.
 * - Gönderim: `POST /sms/rest/v2/send`, Basic auth (kullanıcı kodu:parola),
 *   gövde `{ msgheader, messages: [{ msg, no }], encoding, appname }`,
 *   cevap `{ code, description, jobid }` ("00" başarı). Hata kodu HTTP 406 ile de gelebilir.
 * - Teslim raporu: `POST /sms/rest/v2/report`, `{ jobids: [...] }` →
 *   `{ code, jobs: [{ jobid, status, errorCode }] }`; dakikada en fazla 10 sorgu.
 *
 * İYS: otelin gönderdiği onay / oda bilgisi / hoş geldin mesajları
 * **bilgilendirme** iletisidir; `iysfilter` gönderilmez (ticari ileti değil).
 * Kampanya SMS'i bu modülün işi değildir.
 *
 * Numara: Türkiye numarası ulusal biçimde (`5XXXXXXXXX`), yurt dışı `00` +
 * ülke kodu ile gönderilir.
 */

export const NETGSM_BASE_URL = 'https://api.netgsm.com.tr';

/** Netgsm tarafında gönderimin hangi uygulamadan geldiği (raporlarda görünür). */
const NETGSM_APP_NAME = 'FlexHotel';

/** Tek istek için bekleme sınırı. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Bir rapor sorgusunda en fazla iş kimliği. */
export const NETGSM_REPORT_BATCH = 100;

const TURKEY_CODE = '90';
const TURKEY_INTERNATIONAL_LENGTH = 12;

/** Gönderim cevap kodları (resmi paketteki `SendSmsErrorCode`). */
const SEND_ERRORS = Object.freeze({
  20: { message: 'Mesaj metni hatalı ya da azami uzunluğu aşıyor', retryable: false },
  30: {
    message: 'Netgsm kullanıcı kodu/parolası hatalı, API erişimi kapalı ya da IP kısıtı var',
    retryable: false,
    configIssue: true,
  },
  40: { message: 'Gönderici başlığı Netgsm hesabında tanımlı değil', retryable: false, configIssue: true },
  41: { message: 'Gönderici başlığı Netgsm hesabında geçerli değil', retryable: false, configIssue: true },
  50: { message: 'Bu Netgsm hesabıyla İYS kontrollü gönderim yapılamıyor', retryable: false, configIssue: true },
  51: { message: 'Netgsm hesabında İYS marka bilgisi yok', retryable: false, configIssue: true },
  70: { message: 'Netgsm isteği geçersiz buldu (eksik ya da hatalı parametre)', retryable: false },
  80: { message: 'Netgsm gönderim hız sınırı aşıldı', retryable: true },
  85: { message: 'Aynı numaraya bir dakikada 20\'den fazla gönderim yapılamaz', retryable: true },
  100: { message: 'Netgsm sistem hatası', retryable: true },
  101: { message: 'Netgsm sistem hatası', retryable: true },
});

/**
 * Teslim raporu durumları (resmi paketteki `SmsStatus`). `0` bekliyor,
 * `1` iletildi; diğerleri iletilemedi.
 */
const REPORT_STATUS = Object.freeze({
  0: { state: 'PENDING' },
  1: { state: 'DELIVERED' },
  2: { state: 'FAILED', message: 'Mesajın geçerlilik süresi doldu, alıcıya ulaşmadı' },
  3: { state: 'FAILED', message: 'Numara geçersiz ya da kısıtlı' },
  4: { state: 'FAILED', message: 'Mesaj operatöre iletilemedi' },
  11: { state: 'FAILED', message: 'Operatör mesajı reddetti' },
  12: { state: 'FAILED', message: 'Operatör iletim hatası' },
  13: { state: 'FAILED', message: 'Mükerrer mesaj olarak reddedildi' },
  14: { state: 'FAILED', message: 'Netgsm hesabında yeterli kredi yok' },
  15: { state: 'FAILED', message: 'Numara kara listede' },
  16: { state: 'FAILED', message: 'İYS reddetti' },
  17: { state: 'FAILED', message: 'İYS hatası' },
});

/**
 * Uluslararası rakamları Netgsm'in beklediği numaraya çevirir.
 * @param {string} international "905321110001"
 */
export function netgsmNumber(international) {
  const digits = String(international ?? '').replace(/\D/g, '');
  if (digits.startsWith(TURKEY_CODE) && digits.length === TURKEY_INTERNATIONAL_LENGTH) {
    return digits.slice(TURKEY_CODE.length);
  }
  return `00${digits}`;
}

/**
 * Gönderim cevabını yorumlar.
 * @param {number} httpStatus
 * @param {unknown} body
 * @returns {{ jobId: string }}
 * @throws {ProviderError}
 */
export function interpretSendResponse(httpStatus, body) {
  const data = /** @type {{ code?: unknown, jobid?: unknown, description?: unknown }} */ (body ?? {});
  const code = typeof data.code === 'string' || typeof data.code === 'number' ? String(data.code) : null;

  if ((httpStatus === 200 || httpStatus === 406) && code) {
    if (code === '00' && data.jobid) return { jobId: String(data.jobid) };
    const known = SEND_ERRORS[Number(code)];
    if (known) {
      throw new ProviderError(`${known.message} (Netgsm ${code})`, {
        code: `NETGSM_${code}`,
        retryable: known.retryable,
        configIssue: known.configIssue ?? false,
      });
    }
    throw new ProviderError(`Netgsm tanımsız cevap verdi (${code})`, { code: `NETGSM_${code}`, retryable: true });
  }

  if (httpStatus === 401 || httpStatus === 403) {
    throw new ProviderError('Netgsm erişimi reddetti (kimlik bilgisi ya da IP kısıtı)', {
      code: `NETGSM_HTTP_${httpStatus}`,
      retryable: false,
      configIssue: true,
    });
  }
  // 429, 5xx ve okunamayan cevap geçicidir.
  throw new ProviderError(`Netgsm beklenmeyen cevap verdi (HTTP ${httpStatus})`, {
    code: `NETGSM_HTTP_${httpStatus}`,
    retryable: true,
  });
}

/**
 * Rapor satırını durum güncellemesine çevirir.
 * @param {{ status?: unknown }} job
 * @returns {{ state: 'PENDING' | 'DELIVERED' | 'FAILED', message?: string, code?: string }}
 */
export function interpretReportJob(job) {
  const status = Number(job?.status);
  const known = REPORT_STATUS[status];
  if (!known) return { state: 'PENDING' };
  return known.state === 'FAILED'
    ? { state: 'FAILED', message: known.message, code: `NETGSM_REPORT_${status}` }
    : { state: known.state };
}

/** @param {{ username: string }} settings @param {string} password */
function authorization(settings, password) {
  return `Basic ${Buffer.from(`${settings.username}:${password}`).toString('base64')}`;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} path
 * @param {object} body
 * @param {string} auth
 */
async function postJson(fetchImpl, path, body, auth) {
  let response;
  try {
    response = await fetchImpl(`${NETGSM_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    throw new ProviderError(timedOut ? 'Netgsm zamanında cevap vermedi' : 'Netgsm\'e ulaşılamadı (ağ hatası)', {
      code: timedOut ? 'NETGSM_TIMEOUT' : 'NETGSM_NETWORK',
      retryable: true,
    });
  }
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

/**
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createNetgsmProvider({ fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    channel: 'SMS',
    name: 'netgsm',
    supportsDeliveryReports: true,

    /**
     * @param {{ settings: { username: string, sender: string }, secret: string, to: string, text: string }} message
     * @returns {Promise<{ providerMessageId: string }>}
     */
    async send({ settings, secret, to, text }) {
      const info = smsInfo(text);
      const { status, data } = await postJson(
        fetchImpl,
        '/sms/rest/v2/send',
        {
          msgheader: settings.sender,
          messages: [{ msg: text, no: netgsmNumber(to) }],
          // Türkçe harf varsa Türkçe kodlama; yoksa standart (daha uzun tek parça).
          ...(info.encoding === 'TR' ? { encoding: 'TR' } : {}),
          appname: NETGSM_APP_NAME,
        },
        authorization(settings, secret),
      );
      const { jobId } = interpretSendResponse(status, data);
      return { providerMessageId: jobId };
    },

    /**
     * @param {{ settings: { username: string }, secret: string, jobIds: string[] }} query
     * @returns {Promise<Map<string, ReturnType<typeof interpretReportJob>>>}
     */
    async report({ settings, secret, jobIds }) {
      const { status, data } = await postJson(
        fetchImpl,
        '/sms/rest/v2/report',
        { jobids: jobIds.slice(0, NETGSM_REPORT_BATCH), appname: NETGSM_APP_NAME },
        authorization(settings, secret),
      );
      const code = data?.code === undefined ? null : String(data.code);
      // 60: aranan kayıt yok (henüz rapor oluşmamış) — hata değil.
      if (code === '60') return new Map();
      if (status !== 200 || code !== '00') {
        throw new ProviderError(`Netgsm raporu alınamadı (${code ?? `HTTP ${status}`})`, {
          code: `NETGSM_REPORT_${code ?? status}`,
          retryable: true,
          configIssue: code === '30',
        });
      }
      const result = new Map();
      for (const job of Array.isArray(data.jobs) ? data.jobs : []) {
        if (job?.jobid !== undefined) result.set(String(job.jobid), interpretReportJob(job));
      }
      return result;
    },
  });
}
