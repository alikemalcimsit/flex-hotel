import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * HTTP katmanı testleri — veritabanı gerekmez.
 *
 * `app.inject()` gerçek port açmadan istek gönderiyor. Buradaki iddialar
 * veritabanına dokunmayan yollar: doğrulama, hata zarfı, correlation başlığı,
 * hız sınırı. Veritabanına inen akışlar `service.integration.test.js`'te.
 */

/** @type {import('fastify').FastifyInstance} */
let app;

before(async () => {
  // db.js import anında PrismaClient kuruyor; bağlanmayacak ama adres şart.
  process.env.DATABASE_URL ??= 'postgresql://user:pass@127.0.0.1:5432/yok';

  const { buildApp } = await import('./app.js');
  // Diğer testler kotayı tüketmesin diye bu örnekte sınır yüksek; hız sınırı
  // kendi testinde ayrı bir örnekle sınanıyor.
  app = await buildApp({ logger: false, rateLimitMax: 10_000 });
  await app.ready();
});

after(async () => {
  await app?.close();
});

describe('sağlık ve hata zarfı', () => {
  it('/health standart zarfla döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    // Veritabanı yok; sağlık ucu bunu çökmeden bildirmeli.
    assert.equal(body.data.db, 'error');
    assert.ok(body.data.cache, 'cache istatistikleri raporlanmalı');
  });

  it('bilinmeyen yol Türkçe 404 zarfı döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/olmayan-yol' });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { success: false, error: 'Bulunamadı', code: 'NOT_FOUND' });
  });
});

describe('correlation kimliği', () => {
  it('istemcinin gönderdiği kimliği korur', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'dis-sistemden-gelen-id' },
    });
    assert.equal(response.headers['x-correlation-id'], 'dis-sistemden-gelen-id');
  });

  it('kimlik gönderilmezse üretir', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.match(response.headers['x-correlation-id'], /^[0-9a-f-]{36}$/);
  });
});

describe('girdi doğrulama', () => {
  it('eksik gövdeyi alan bazlı Türkçe mesajlarla reddeder', async () => {
    const response = await app.inject({ method: 'POST', url: '/settings/room-types', payload: {} });
    const body = response.json();

    assert.equal(response.statusCode, 400);
    assert.equal(body.code, 'VALIDATION');
    assert.equal(body.fields.code, 'Kod zorunlu');
    assert.equal(body.fields.name, 'Ad zorunlu');
    assert.equal(body.fields.basePrice, 'Taban fiyat zorunlu');
  });

  it('hiçbir doğrulama mesajı İngilizce sızdırmaz', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/settings/seasons',
      payload: { name: '', multiplier: 'çok' },
    });
    const body = response.json();

    assert.equal(response.statusCode, 400);
    for (const message of Object.values(body.fields)) {
      assert.doesNotMatch(message, /Invalid input|expected \w+, received|Required/, `İngilizce sızdı: ${message}`);
    }
  });

  it('sayfa boyutu üst sınırını reddeder', async () => {
    const response = await app.inject({ method: 'GET', url: '/settings/room-types?pageSize=999' });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().fields.pageSize, /en fazla 200/);
  });

  it('geçersiz uuid parametresini reddeder', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/settings/taxes/uuid-degil' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().fields.id, 'Geçersiz kayıt kimliği');
  });
});

describe('iç hata sızıntısı', () => {
  it('veritabanı hatasında iç detay dönmez', async () => {
    // Veritabanı yok; bu istek servis katmanında patlayacak.
    const response = await app.inject({ method: 'GET', url: '/settings/room-types' });
    const body = response.json();

    assert.equal(response.statusCode, 500);
    assert.equal(body.error, 'Sunucuda beklenmeyen bir hata oluştu');
    assert.equal(body.code, 'INTERNAL');
    // Bağlantı adresi, SQL veya yığın izi istemciye gitmemeli.
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /postgresql:|prisma|at .*\.js:/i);
  });
});

describe('hız sınırı', () => {
  it('sınır aşılınca Türkçe 429 döner', async () => {
    const { buildApp } = await import('./app.js');
    const limitedApp = await buildApp({ logger: false, rateLimitMax: 3 });
    await limitedApp.ready();

    try {
      // Doğrulamada takılan bir uç seçildi: hız sınırı `onRequest`'te çalıştığı
      // için sayılır, ama istek veritabanına inmediğinden test hızlı biter.
      const responses = [];
      for (let i = 0; i < 5; i += 1) {
        responses.push(await limitedApp.inject({ method: 'GET', url: '/settings/room-types?pageSize=999' }));
      }

      const allowed = responses.filter((response) => response.statusCode !== 429);
      const limited = responses.filter((response) => response.statusCode === 429);

      assert.equal(allowed.length, 3, 'sınıra kadar geçmeli');
      assert.equal(limited.length, 2, 'sınır üstü reddedilmeli');
      assert.equal(limited[0].json().code, 'RATE_LIMITED');
      assert.match(limited[0].json().error, /Çok fazla istek/);
    } finally {
      await limitedApp.close();
    }
  });
});
