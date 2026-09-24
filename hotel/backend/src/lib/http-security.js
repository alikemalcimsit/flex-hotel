import { randomUUID } from 'node:crypto';
import proxyAddr from '@fastify/proxy-addr';

/**
 * HTTP katmanının güvenlik ayarları — tek yerde, ortam değişkenlerinden.
 *
 * Buradaki her şey "yerelde çalışıyor" ile "internete açık sunucuda güvenli"
 * arasındaki farktır; varsayılanlar güvenli taraftadır.
 */

/** Geliştirme ortamında panelin adresi (Vite). */
const DEV_ALLOWED_ORIGINS = Object.freeze(['http://localhost:5173', 'http://127.0.0.1:5173']);

/** Üretimde kabul edilecek en kısa JWT anahtarı. */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * `.env.example`'daki örnek anahtarların ortak başı. Örnek değer 32 karakteri
 * geçiyor; kopyalanıp değiştirilmeden bırakılırsa uzunluk kontrolünden geçerdi.
 */
const PLACEHOLDER_JWT_SECRET_PREFIX = 'degistir-bunu';

/** Dışarıdan gelen correlation kimliği bu biçimdeyse korunur, değilse yenisi üretilir. */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Denetim izine yazılacak aktör adının üst sınırı. */
const MAX_ACTOR_LENGTH = 120;

/**
 * Tarayıcının çapraz kaynaktan kullanabileceği yöntemler ve başlıklar.
 *
 * `@fastify/cors` (v10+) varsayılan olarak yalnızca GET/HEAD/POST'a izin
 * veriyor: panel ile API ayrı adresteyken (geliştirmede 5173 → 3000) kat
 * hizmeti güncellemesi (PATCH), ayar kaydetme (PUT) ve silme (DELETE) ön
 * kontrolde sessizce engelleniyordu.
 */
export const CORS_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const CORS_ALLOWED_HEADERS = Object.freeze(['Content-Type', 'Authorization', 'x-actor', 'x-correlation-id']);

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * JWT imza anahtarı.
 *
 * Üretimde anahtar yoksa ya da kısaysa sunucu **açılmaz**: koda gömülü bir
 * anahtarla imzalanan token'ı, kodu gören herkes üretebilir. Geliştirmede
 * açık bir uyarıyla yerel anahtar kullanılır.
 *
 * @param {{ warn: Function }} [logger]
 * @returns {string}
 */
export function resolveJwtSecret(logger = console) {
  const secret = process.env.JWT_SECRET;
  const usable =
    typeof secret === 'string' &&
    secret.length >= MIN_JWT_SECRET_LENGTH &&
    !secret.startsWith(PLACEHOLDER_JWT_SECRET_PREFIX);
  if (usable) return secret;

  if (isProduction()) {
    throw new Error(
      `JWT_SECRET tanımlı değil, ${MIN_JWT_SECRET_LENGTH} karakterden kısa ya da .env.example'daki örnek değer. Üretimde sunucu bu hâlde açılmaz.`,
    );
  }
  logger.warn?.('JWT_SECRET tanımlı değil; yalnızca geliştirme için yerel anahtar kullanılıyor.');
  return secret || `yerel-gelistirme-anahtari-${'x'.repeat(MIN_JWT_SECRET_LENGTH)}`;
}

/**
 * CORS izinli kaynakları (`CORS_ORIGINS`, virgülle ayrılmış).
 *
 * Eskiden her kaynağa (`origin: true`) izin veriliyordu: herhangi bir sitenin
 * sayfası kullanıcının tarayıcısından API'ye istek atıp cevabı okuyabilirdi.
 * Üretimde panel ile API aynı adreste (hotel.flexai.tr) olduğu için CORS'a
 * hiç ihtiyaç yok; liste boş kalabilir.
 *
 * @returns {string[]}
 */
export function allowedOrigins() {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return isProduction() ? [] : [...DEV_ALLOWED_ORIGINS];
}

/**
 * `@fastify/cors` ve socket.io için origin denetleyicisi. Tarayıcı dışı
 * istemciler (curl, sunucudan sunucuya) Origin göndermez; onlar engellenmez —
 * CORS bir tarayıcı korumasıdır, kimlik doğrulama değil.
 *
 * @param {string[]} origins
 */
export function originChecker(origins) {
  const allowed = new Set(origins);
  return (origin, callback) => callback(null, !origin || allowed.has(origin));
}

/**
 * İstek kimliği: istemcinin gönderdiği `x-correlation-id` güvenli biçimdeyse
 * korunur (dış sistemle zincir kurulsun), değilse üretilir. Doğrulanmayan
 * değer log'a ve denetim izine yazılıyordu — sınırsız uzunlukta ya da satır
 * sonu içeren bir başlık log satırlarını bozabilirdi.
 *
 * @param {unknown} header
 * @returns {string}
 */
export function correlationIdFrom(header) {
  return typeof header === 'string' && CORRELATION_ID_PATTERN.test(header) ? header : randomUUID();
}

/**
 * Denetim izine yazılacak aktör (⚠️ modül 2'ye kadar doğrulanmayan başlık).
 * Kontrol karakterleri atılır, uzunluk sınırlanır; boşsa "anonim".
 *
 * @param {unknown} header
 * @returns {string}
 */
export function actorFrom(header) {
  if (typeof header !== 'string') return 'anonim';
  const cleaned = header
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_ACTOR_LENGTH);
  return cleaned || 'anonim';
}

/**
 * Hangi vekilin `X-Forwarded-For` başlığına güvenileceği (`TRUST_PROXY`).
 *
 * Backend varsayılan olarak yalnızca 127.0.0.1'i dinler; önündeki nginx aynı
 * makinededir. Güven verilmezse her istek 127.0.0.1'den gelmiş görünür ve IP'ye
 * bağlı her şey (hız sınırı, log) bütün kullanıcıları tek kişi sayar.
 * Varsayılan: yalnızca aynı makinedeki vekil (`loopback`). `false` kapatır;
 * başka değer Fastify'a olduğu gibi verilir (IP/CIDR listesi).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean | string}
 */
export function resolveTrustProxy(env = process.env) {
  const value = (env.TRUST_PROXY ?? '').trim();
  if (!value) return 'loopback';
  if (value === 'false') return false;
  if (value === 'true') return true;
  return value;
}

/**
 * Hız sınırı anahtarı: istemci IP'si + personel.
 *
 * Yalnızca IP'ye göre sayılsaydı otelin tek dış IP'sinin (NAT) arkasındaki
 * yüzlerce panel aynı kotayı paylaşırdı; nginx gerçek IP'yi geçirmezse de
 * bütün kullanıcılar tek kişi sayılırdı. ⚠️ Personel şimdilik doğrulanmayan
 * başlıktan (modül 2 gelince JWT'deki kullanıcıdan).
 *
 * @param {{ ip: string, headers: Record<string, unknown> }} request
 */
export function rateLimitKey(request) {
  return `${request.ip}|${actorFrom(request.headers['x-actor'])}`;
}

/**
 * Socket bağlantısının istemci IP'si — Fastify'ın `request.ip` hesabıyla
 * birebir aynı kural (`TRUST_PROXY`, aynı kütüphane). Web chat balonu herkese
 * açık; hız sınırı gerçek IP'ye göre işlemeli, nginx'in adresine göre değil.
 *
 * @param {boolean | string} trustProxy `resolveTrustProxy()` çıktısı
 * @returns {(request: import('node:http').IncomingMessage) => string}
 */
export function socketIpResolver(trustProxy) {
  let trust;
  if (trustProxy === true) trust = () => true;
  else if (trustProxy === false) trust = () => false;
  else trust = proxyAddr.compile(String(trustProxy).split(',').map((value) => value.trim()).filter(Boolean));
  return (request) => {
    try {
      return proxyAddr(request, trust);
    } catch {
      return request.socket?.remoteAddress ?? 'bilinmiyor';
    }
  };
}
