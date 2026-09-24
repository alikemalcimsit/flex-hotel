import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Web chat oturumu.
 *
 * Misafirin kimliği yoktur; balon ilk bağlantıda bir oturum kimliği alır ve
 * tarayıcıda saklar. Kimlik **imzalı token** içinde taşınır: başkasının oturum
 * kimliğini tahmin eden biri onun konuşmasını okuyamaz (imza sunucu sırrıyla).
 *
 * Token: base64url(JSON { h: otel, s: oturum, i: verildiği an }) + "." + base64url(HMAC-SHA256)
 */

/** Oturumun geçerlilik süresi: her bağlantıda yenilenir. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

/** @param {string} body @param {string | Buffer} secret */
const signatureOf = (body, secret) => createHmac('sha256', secret).update(body).digest();

/**
 * @param {{ hotelId: string, sessionId?: string, now?: number }} input
 * @param {string | Buffer} secret
 * @returns {{ token: string, sessionId: string }}
 */
export function createSessionToken({ hotelId, sessionId = randomUUID(), now = Date.now() }, secret) {
  const body = b64(JSON.stringify({ h: hotelId, s: sessionId, i: now }));
  return { token: `${body}.${b64(signatureOf(body, secret))}`, sessionId };
}

/**
 * @param {string | undefined | null} token
 * @param {string | Buffer} secret
 * @param {{ hotelId: string, now?: number, ttlMs?: number }} expected
 * @returns {{ sessionId: string } | null} geçersiz, süresi dolmuş ya da başka otelinse null
 */
export function verifySessionToken(token, secret, { hotelId, now = Date.now(), ttlMs = SESSION_TTL_MS }) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = signatureOf(body, secret);
  let given;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims?.h !== hotelId || typeof claims.s !== 'string' || !Number.isFinite(claims.i)) return null;
  if (now - claims.i > ttlMs || claims.i - now > 60_000) return null;
  return { sessionId: claims.s };
}
