import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseApiKey } from '@hotelos/hotel-contracts';
import { BlockedAddressError, guardedLookup, isBlockedAddress } from './ssrf.js';
import { generateApiKey, hashApiKey, idempotencyRequestId, sameHash, signatureHeader, verifyWebhookSignature } from './webhook-signature.js';

describe('iç ağ adresleri (SSRF)', () => {
  it('özel, döngü, bağlantı-yerel, meta-veri, CGNAT, çoklu yayın engellenir; dış adres serbest', () => {
    for (const address of ['127.0.0.1', '127.8.9.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '188.132.235.142']) assert.equal(isBlockedAddress(address), false, address);
  });

  it('IPv6: ::1, ::, ULA, bağlantı-yerel, eşlemeli / NAT64 iç IPv4 engellenir', () => {
    for (const address of ['::1', '::', 'fd12:3456::1', 'fc00::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.5', '64:ff9b::a9fe:a9fe', '2001:db8::1', '::127.0.0.1', 'bozuk']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    for (const address of ['2606:4700:4700::1111', '2a00:1450:4017:80b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808']) assert.equal(isBlockedAddress(address), false, address);
  });

  it('çözüm biri bile iç ağa çıkarsa reddeder; dışsa bağlantı o IP ile kurulur', async () => {
    const resolve = (addresses) => (_host, _options, callback) => callback(null, addresses);
    const run = (lookup, options) => new Promise((resolve_) => lookup('hooks.ornek.com', options, (...result) => resolve_(result)));

    const [blocked] = await run(guardedLookup({ resolver: resolve([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }]) }), {});
    assert.ok(blocked instanceof BlockedAddressError);
    const [error, address, family] = await run(guardedLookup({ resolver: resolve([{ address: '93.184.216.34', family: 4 }]) }), {});
    assert.deepEqual([error, address, family], [null, '93.184.216.34', 4]);
    const [, all] = await run(guardedLookup({ resolver: resolve([{ address: '2606:4700::1', family: 6 }]) }), { all: true });
    assert.deepEqual(all, [{ address: '2606:4700::1', family: 6 }]);
    const [empty] = await run(guardedLookup({ resolver: resolve([]) }), {});
    assert.equal(empty.code, 'ENOTFOUND');
  });

  it('testteki yerel izin üretimde geçmez', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const lookup = guardedLookup({ allowPrivate: true, resolver: (_h, _o, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]) });
      const [error] = await new Promise((resolve) => lookup('x.ornek.com', {}, (...result) => resolve(result)));
      assert.ok(error instanceof BlockedAddressError);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('webhook imzası ve API anahtarı', () => {
  it('imza alıcı doğrulamasından geçer; gövde, sır ya da zaman değişirse geçmez; eski sır geçişte tutar', () => {
    const body = JSON.stringify({ id: 'e1', type: 'reservation.created' });
    const header = signatureHeader(['whsec_yeni', 'whsec_eski'], 1_800_000_000, body);
    assert.match(header, /^t=1800000000,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
    assert.equal(verifyWebhookSignature(header, body, 'whsec_yeni', { now: 1_800_000_010 }), true);
    assert.equal(verifyWebhookSignature(header, body, 'whsec_eski', { now: 1_800_000_010 }), true);
    assert.equal(verifyWebhookSignature(header, `${body} `, 'whsec_yeni', { now: 1_800_000_010 }), false);
    assert.equal(verifyWebhookSignature(header, body, 'whsec_baska', { now: 1_800_000_010 }), false);
    assert.equal(verifyWebhookSignature(header, body, 'whsec_yeni', { now: 1_800_000_400 }), false, 'tekrar oynatma');
    assert.equal(verifyWebhookSignature(undefined, body, 'whsec_yeni'), false);
  });

  it('anahtar biçimi sözleşmeyle aynı; yalnız özet saklanır, karşılaştırma sabit süreli', () => {
    const key = generateApiKey();
    assert.deepEqual(parseApiKey(key.token)?.prefix, key.prefix);
    assert.equal(key.secretHash, hashApiKey(key.token));
    assert.ok(!key.secretHash.includes(key.token.slice(17)));
    assert.equal(sameHash(key.secretHash, hashApiKey(key.token)), true);
    assert.equal(sameHash(key.secretHash, hashApiKey(`${key.token}x`)), false);
    assert.equal(sameHash(key.secretHash, ''), false);
    assert.notEqual(generateApiKey().prefix, generateApiKey().prefix);
  });

  it('Idempotency-Key uygulamaya özel, deterministik UUID', () => {
    const a = idempotencyRequestId('c1', 'siparis-123');
    assert.equal(a, idempotencyRequestId('c1', 'siparis-123'));
    assert.notEqual(a, idempotencyRequestId('c2', 'siparis-123'));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
