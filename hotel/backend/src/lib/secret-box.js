import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

/**
 * Veritabanında saklanan sırlar (SMTP parolası, SMS API parolası) için
 * şifreleme: AES-256-GCM.
 *
 * ### Neden
 *
 * Veritabanı yedeği ya da bir SQL sızıntısı, otelin e-posta hesabını ve SMS
 * paketini de ele geçirtmemeli. Anahtar veritabanında değil, sunucunun
 * ortamında (`SETTINGS_SECRET_KEY`) durur.
 *
 * ### Biçim
 *
 * `v1:<iv>:<etiket>:<şifreli>` (base64url). Sürüm öneki, anahtar değiştirilirse
 * eski kayıtların hangi anahtarla açılacağını bilmek için.
 *
 * ### Anahtar yoksa
 *
 * Sunucu yine açılır (diğer modüller çalışsın), ama sır kaydetmek ve gönderim
 * için sır açmak `SECRET_KEY_MISSING` hatası verir; ekran bunu açıkça söyler.
 * Anahtar üretmek: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = 'v1';

/** @param {string | undefined} raw */
function parseKey(raw) {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** Ortamdaki anahtar geçerli mi (ekran ve sağlık ucu için). */
export function secretKeyConfigured(env = process.env) {
  return parseKey(env.SETTINGS_SECRET_KEY) !== null;
}

function requireKey(env) {
  const key = parseKey(env.SETTINGS_SECRET_KEY);
  if (!key) {
    throw new AppError(
      'Sunucuda şifreleme anahtarı (SETTINGS_SECRET_KEY) tanımlı değil ya da 32 bayt değil; parola ve API anahtarları saklanamıyor.',
      { statusCode: 503, code: 'SECRET_KEY_MISSING' },
    );
  }
  return key;
}

/**
 * @param {string} plain
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function sealSecret(plain, env = process.env) {
  const key = requireKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

/**
 * @param {string} sealed
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function openSecret(sealed, env = process.env) {
  const key = requireKey(env);
  const [version, iv, tag, data] = String(sealed ?? '').split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new AppError('Kayıtlı parola okunamadı (biçim tanınmıyor); kanal ayarından parolayı yeniden girin.', {
      statusCode: 409,
      code: 'SECRET_UNREADABLE',
    });
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Anahtar değişmiş ya da kayıt bozulmuş: açılamayan sırrı tahmin etmeye çalışma.
    throw new AppError(
      'Kayıtlı parola bu sunucunun anahtarıyla açılamadı (anahtar değişmiş olabilir); kanal ayarından parolayı yeniden girin.',
      { statusCode: 409, code: 'SECRET_UNREADABLE' },
    );
  }
}
