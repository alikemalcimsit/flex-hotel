import dns from 'node:dns';
import { isIP } from 'node:net';

/**
 * Dışarıya istek atan işlerin (webhook göndericisi, modül 61) iç ağ koruması (SSRF).
 *
 * Adresi kaydederken yazımı denetlemek yetmez: `hooks.ornek.com` kayıt anında dış IP'ye çözülüp gönderim anında
 * `127.0.0.1`'e ya da bulut meta-veri adresine (169.254.169.254) çözülebilir (DNS ile yeniden bağlama). Bu yüzden
 * bağlantı **çözülen IP'ye** kurulur ve o IP burada denetlenir: `https.request`'in `lookup` seçeneği bu fonksiyonu
 * kullanır, bağlantı başka bir çözüme gidemez. Ad birden fazla IP'ye çözülüyorsa biri bile iç ağdaysa reddedilir.
 */

/** @param {string} address */
function ipv4Parts(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

/** @param {number[]} parts */
function blockedIpv4([a, b, c]) {
  return (
    a === 0 || // "bu ağ"
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // taşıyıcı NAT
    a === 127 ||
    (a === 169 && b === 254) || // bağlantı-yerel + bulut meta-veri
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // kıyaslama ağı
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // çoklu yayın, ayrılmış, yayın
  );
}

/**
 * IPv6 metnini 8 adet 16 bitlik parçaya açar (sonunda IPv4 gömülüyse o da çevrilir).
 * @param {string} address
 * @returns {number[] | null}
 */
function ipv6Groups(address) {
  let text = address.toLowerCase().split('%')[0];
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4Parts(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/**
 * Adres iç ağda / ayrılmış aralıkta mı (bağlanılmaz)? Tanınmayan biçim de engellenir.
 * @param {string} address
 */
export function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return blockedIpv4(/** @type {number[]} */ (ipv4Parts(address)));
  if (family !== 6) return true;
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [g0, g1, , , , g5, g6, g7] = groups;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1
  // IPv4 eşlemeli (::ffff:a.b.c.d) ve NAT64 (64:ff9b::a.b.c.d): gömülü IPv4'e göre.
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  if (groups.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) return blockedIpv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) return blockedIpv4(embedded);
  if (groups.slice(0, 6).every((group) => group === 0)) return true; // eski IPv4 uyumlu ::a.b.c.d
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 benzersiz yerel
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 bağlantı-yerel
  if ((g0 & 0xff00) === 0xff00) return true; // çoklu yayın
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // belgeleme
  if (g0 === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return true; // 100::/64 atma
  return false;
}

/** Engellenen adres hatası (gönderici teslimat kaydına bunu yazar). */
export class BlockedAddressError extends Error {
  /** @param {string} hostname */
  constructor(hostname) {
    super(`${hostname} iç ağ / ayrılmış bir adrese çözülüyor; güvenlik nedeniyle bağlanılmadı`);
    this.code = 'EADDRBLOCKED';
  }
}

/**
 * `https.request` için korumalı ad çözümü. `allowPrivate` yalnız testlerde (yerel alıcı); üretimde zorla kapalıdır.
 * @param {{ allowPrivate?: boolean, resolver?: typeof dns.lookup }} [options]
 */
export function guardedLookup({ allowPrivate = false, resolver = dns.lookup } = {}) {
  const permitPrivate = allowPrivate && process.env.NODE_ENV !== 'production';
  return function lookup(hostname, options, callback) {
    const done = typeof options === 'function' ? options : callback;
    const wantsAll = typeof options === 'object' && options?.all === true;
    resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return done(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }];
      if (list.length === 0) return done(Object.assign(new Error(`${hostname} çözülemedi`), { code: 'ENOTFOUND' }));
      if (!permitPrivate && list.some((entry) => isBlockedAddress(entry.address))) return done(new BlockedAddressError(hostname));
      if (wantsAll) return done(null, list);
      return done(null, list[0].address, list[0].family);
    });
  };
}
