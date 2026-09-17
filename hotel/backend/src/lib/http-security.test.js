import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  actorFrom,
  allowedOrigins,
  correlationIdFrom,
  originChecker,
  rateLimitKey,
  resolveJwtSecret,
  resolveTrustProxy,
} from './http-security.js';

const ORIGINAL_ENV = { ...process.env };
const silentLogger = { warn: () => {} };
const STRONG_SECRET = 'k'.repeat(48);

afterEach(() => {
  for (const key of ['NODE_ENV', 'JWT_SECRET', 'CORS_ORIGINS']) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe('resolveJwtSecret', () => {
  it('üretimde yeterince uzun anahtarı kullanır', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = STRONG_SECRET;
    assert.equal(resolveJwtSecret(silentLogger), STRONG_SECRET);
  });

  it('üretimde anahtar yoksa sunucuyu açtırmaz', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    assert.throws(() => resolveJwtSecret(silentLogger), /JWT_SECRET/);
  });

  it('üretimde kısa anahtarı reddeder', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'kisa-anahtar';
    assert.throws(() => resolveJwtSecret(silentLogger), /JWT_SECRET/);
  });

  it('üretimde .env.example örnek değerini (32 karakteri geçse de) reddeder', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'degistir-bunu-uzun-rastgele-metin';
    assert.throws(() => resolveJwtSecret(silentLogger), /örnek değer/);
  });

  it('geliştirmede anahtar yoksa uyarıp yerel anahtarla açılır', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const warnings = [];
    const secret = resolveJwtSecret({ warn: (message) => warnings.push(message) });
    assert.ok(secret.length >= 32);
    assert.equal(warnings.length, 1);
  });
});

describe('allowedOrigins / originChecker', () => {
  it('CORS_ORIGINS virgülle ayrılmış listeyi temizleyerek okur', () => {
    process.env.CORS_ORIGINS = ' https://a.example , ,https://b.example ';
    assert.deepEqual(allowedOrigins(), ['https://a.example', 'https://b.example']);
  });

  it('üretimde liste verilmemişse hiçbir çapraz kaynağa izin vermez', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    assert.deepEqual(allowedOrigins(), []);
  });

  it('geliştirmede liste verilmemişse Vite paneline izin verir', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;
    assert.ok(allowedOrigins().includes('http://localhost:5173'));
  });

  it('Origin göndermeyen istemciyi ve listedeki kaynağı geçirir, yabancıyı geçirmez', () => {
    const check = originChecker(['https://panel.example']);
    const verdict = (origin) => {
      let result;
      check(origin, (_error, allowed) => {
        result = allowed;
      });
      return result;
    };
    assert.equal(verdict(undefined), true);
    assert.equal(verdict('https://panel.example'), true);
    assert.equal(verdict('https://kotu-niyetli.example'), false);
  });
});

describe('correlationIdFrom', () => {
  it('güvenli biçimdeki dış kimliği korur', () => {
    assert.equal(correlationIdFrom('ota-istek:2026.09.16_01'), 'ota-istek:2026.09.16_01');
  });

  it('boşluk, satır sonu, çok kısa ya da çok uzun kimliğin yerine yenisini üretir', () => {
    for (const header of ['a b c d e f g h', 'satir\nsonu-enjeksiyon', 'kisa', 'x'.repeat(129), ['dizi-degeri-1234']]) {
      assert.match(correlationIdFrom(header), /^[0-9a-f-]{36}$/);
    }
  });
});

describe('actorFrom', () => {
  it('kontrol karakterlerini atar ve uzunluğu sınırlar', () => {
    assert.equal(actorFrom('admin@hotel.local\r\nsahte-satir'), 'admin@hotel.localsahte-satir');
    assert.equal(actorFrom('a'.repeat(500)).length, 120);
  });

  it('boş ya da metin olmayan başlıkta "anonim" döner', () => {
    assert.equal(actorFrom(undefined), 'anonim');
    assert.equal(actorFrom('   '), 'anonim');
    assert.equal(actorFrom(['admin']), 'anonim');
  });
});

describe('resolveTrustProxy', () => {
  it('varsayılan yalnızca aynı makinedeki vekildir', () => {
    assert.equal(resolveTrustProxy({}), 'loopback');
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '  ' }), 'loopback');
  });

  it('açıkça kapatılabilir ya da adres listesi verilebilir', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false' }), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'true' }), true);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '10.0.0.0/8' }), '10.0.0.0/8');
  });
});

describe('rateLimitKey', () => {
  it('aynı IP arkasındaki farklı personel ayrı sayılır', () => {
    const a = rateLimitKey({ ip: '85.1.2.3', headers: { 'x-actor': 'ayse@otel.com' } });
    const b = rateLimitKey({ ip: '85.1.2.3', headers: { 'x-actor': 'mehmet@otel.com' } });
    assert.notEqual(a, b);
    assert.equal(rateLimitKey({ ip: '85.1.2.3', headers: {} }), '85.1.2.3|anonim');
  });
});
