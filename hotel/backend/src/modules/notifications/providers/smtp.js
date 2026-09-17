import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { ProviderError } from './provider-error.js';

/**
 * SMTP e-posta adaptörü (nodemailer).
 *
 * Otelin kendi e-posta hesabı (Yandex, Google Workspace, Office 365, kendi
 * sunucusu) ekrandan girilen bilgilerle kullanılır. Bağlantılar havuzlanır:
 * her e-posta için yeniden TLS el sıkışması yapılmaz. Ayar değişince havuz
 * yenilenir.
 */

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

/** Aynı hesap için açık tutulan en fazla bağlantı. */
const POOL_MAX_CONNECTIONS = 3;

/** Bir bağlantıdan en fazla gönderilen e-posta (sonra yenilenir). */
const POOL_MAX_MESSAGES = 100;

/** Geçici sayılan SMTP cevapları (RFC 5321 4yz). */
const TRANSIENT_SMTP_CODES = new Set([421, 450, 451, 452]);

/** Ağ kaynaklı, yeniden denenebilir nodemailer hataları. */
const TRANSIENT_ERROR_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EPROXY']);

/**
 * @param {{ host: string, port: number, security: 'TLS' | 'STARTTLS' | 'NONE', username?: string }} settings
 * @param {string | null} password
 */
export function transportOptions(settings, password) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'TLS',
    requireTLS: settings.security === 'STARTTLS',
    ignoreTLS: settings.security === 'NONE',
    auth: settings.username ? { user: settings.username, pass: password ?? '' } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  };
}

/**
 * nodemailer hatasını sınıflandırır.
 * @param {any} error
 * @returns {ProviderError}
 */
export function classifySmtpError(error) {
  if (error instanceof ProviderError) return error;
  const code = typeof error?.code === 'string' ? error.code : null;
  const responseCode = Number(error?.responseCode) || null;

  if (code === 'EAUTH' || code === 'ENOAUTH') {
    return new ProviderError('SMTP kimlik doğrulaması başarısız (kullanıcı adı ya da parola hatalı)', {
      code: 'SMTP_AUTH',
      retryable: false,
      configIssue: true,
    });
  }
  if (code === 'ETLS' || code === 'EREQUIRETLS' || /certificate|self.signed/i.test(String(error?.message))) {
    return new ProviderError('SMTP sunucusuyla güvenli bağlantı kurulamadı (sertifika ya da TLS ayarı)', {
      code: 'SMTP_TLS',
      retryable: false,
      configIssue: true,
    });
  }
  if (responseCode && TRANSIENT_SMTP_CODES.has(responseCode)) {
    return new ProviderError(`SMTP sunucusu geçici olarak reddetti (${responseCode})`, {
      code: `SMTP_${responseCode}`,
      retryable: true,
    });
  }
  if (code === 'EENVELOPE' || (responseCode && responseCode >= 500)) {
    return new ProviderError(`Alıcı adresi reddedildi${responseCode ? ` (${responseCode})` : ''}`, {
      code: responseCode ? `SMTP_${responseCode}` : 'SMTP_ENVELOPE',
      retryable: false,
    });
  }
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return new ProviderError('SMTP sunucusuna ulaşılamadı (bağlantı ya da zaman aşımı)', {
      code: `SMTP_${code}`,
      retryable: true,
    });
  }
  if (code === 'ECONFIG' || code === 'EMESSAGE') {
    return new ProviderError('E-posta ayarı ya da iletisi geçersiz', { code: `SMTP_${code}`, retryable: false, configIssue: true });
  }
  return new ProviderError(`E-posta gönderilemedi: ${error?.message ?? 'bilinmeyen hata'}`, {
    code: code ? `SMTP_${code}` : 'SMTP_UNKNOWN',
    retryable: true,
  });
}

/** @param {string} value */
function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Düz metinden sade HTML gövde: paragraflar ve satır sonları korunur.
 * Metin şablondan ve misafir adından geldiği için kaçışlanır.
 * @param {string} text
 */
export function textToHtml(text) {
  const paragraphs = String(text ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${paragraphs}</body></html>`;
}

/** @param {object} options */
function fingerprint(options) {
  return createHash('sha256').update(JSON.stringify(options)).digest('hex');
}

/**
 * @param {{ createTransport?: typeof nodemailer.createTransport }} [deps]
 */
export function createSmtpProvider({ createTransport = nodemailer.createTransport } = {}) {
  /** @type {Map<string, { fingerprint: string, transport: any }>} otel başına havuz */
  const pools = new Map();

  /** @param {string} hotelId @param {object} options */
  function transportFor(hotelId, options) {
    const print = fingerprint(options);
    const existing = pools.get(hotelId);
    if (existing?.fingerprint === print) return existing.transport;
    existing?.transport.close?.();
    const transport = createTransport({
      ...options,
      pool: true,
      maxConnections: POOL_MAX_CONNECTIONS,
      maxMessages: POOL_MAX_MESSAGES,
    });
    pools.set(hotelId, { fingerprint: print, transport });
    return transport;
  }

  return Object.freeze({
    channel: 'EMAIL',
    name: 'smtp',
    supportsDeliveryReports: false,

    /**
     * @param {{
     *   hotelId: string,
     *   settings: { host: string, port: number, security: 'TLS' | 'STARTTLS' | 'NONE', username?: string, fromName?: string, fromAddress: string, replyTo?: string },
     *   secret: string | null,
     *   to: string,
     *   toName?: string | null,
     *   subject: string,
     *   text: string,
     * }} message
     * @returns {Promise<{ providerMessageId: string | null }>}
     */
    async send({ hotelId, settings, secret, to, toName, subject, text }) {
      if (settings.username && !secret) {
        throw new ProviderError('SMTP parolası kayıtlı değil', { code: 'SMTP_NO_PASSWORD', retryable: false, configIssue: true });
      }
      const transport = transportFor(hotelId, transportOptions(settings, secret));
      try {
        const info = await transport.sendMail({
          from: { name: settings.fromName || settings.fromAddress, address: settings.fromAddress },
          to: toName ? { name: toName, address: to } : to,
          ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
          subject,
          text,
          html: textToHtml(text),
        });
        if (Array.isArray(info?.rejected) && info.rejected.length > 0) {
          throw new ProviderError('Alıcı adresi SMTP sunucusu tarafından reddedildi', {
            code: 'SMTP_REJECTED',
            retryable: false,
          });
        }
        return { providerMessageId: info?.messageId ?? null };
      } catch (error) {
        const classified = classifySmtpError(error);
        // Bağlantı kalıcı bozulduysa (parola değişti) havuzu at; sonraki deneme yeniden kurar.
        if (classified.configIssue || classified.retryable) {
          pools.get(hotelId)?.transport.close?.();
          pools.delete(hotelId);
        }
        throw classified;
      }
    },

    /** Ayar değişince havuzu bırak. @param {string} hotelId */
    reset(hotelId) {
      pools.get(hotelId)?.transport.close?.();
      pools.delete(hotelId);
    },

    /** Kapanışta bütün bağlantıları bırak. */
    closeAll() {
      for (const { transport } of pools.values()) transport.close?.();
      pools.clear();
    },
  });
}
