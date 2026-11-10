import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import {
  assertGuardsBeforeValidation,
  isAuthGuard,
  markAuthGuard,
  requireAnyPermission,
  requireAuth,
  requirePermission,
} from './permissions.js';

/**
 * Guard'ların şema doğrulamasından önce çalışması (401/403 → 400'den önce).
 * Uygulamanın tamamıyla sınama `app.test.js`'te; burada `onRoute` denetiminin
 * kendisi: guard `preHandler`'a yazılırsa route kaydı reddedilir.
 */

describe('guard işareti', () => {
  it('requireAuth, requirePermission ve requireAnyPermission guard olarak işaretli', () => {
    assert.equal(isAuthGuard(requireAuth), true);
    assert.equal(isAuthGuard(requirePermission('rooms.view')), true);
    assert.equal(isAuthGuard(requireAnyPermission('rooms.view', 'rooms.manage')), true);
  });

  it('sıradan fonksiyon ve fonksiyon olmayan değer guard sayılmaz', () => {
    assert.equal(isAuthGuard(async () => {}), false);
    assert.equal(isAuthGuard(undefined), false);
    assert.equal(isAuthGuard({}), false);
  });
});

describe('assertGuardsBeforeValidation', () => {
  const guard = requirePermission('rooms.view');

  it('guard preValidation\'daysa kabul eder', () => {
    assert.doesNotThrow(() => assertGuardsBeforeValidation({ method: 'POST', url: '/x', preValidation: [guard] }));
  });

  it('guard\'sız (herkese açık) route\'u kabul eder', () => {
    assert.doesNotThrow(() => assertGuardsBeforeValidation({ method: 'GET', url: '/public/x' }));
  });

  it('guard olmayan preHandler\'a dokunmaz (gövdeye bağlı kontroller orada kalabilir)', () => {
    const bodyCheck = async () => {};
    assert.doesNotThrow(() =>
      assertGuardsBeforeValidation({ method: 'POST', url: '/x', preValidation: [guard], preHandler: [bodyCheck] }),
    );
  });

  it('guard preHandler dizisindeyse route ve guard adıyla reddeder', () => {
    assert.throws(
      () => assertGuardsBeforeValidation({ method: 'POST', url: '/lost-items', preHandler: [guard] }),
      (error) => {
        assert.match(error.message, /POST \/lost-items/);
        assert.match(error.message, /permissionGuard/);
        assert.match(error.message, /preValidation'a taşıyın/);
        return true;
      },
    );
  });

  it('tek fonksiyon olarak verilen preHandler guard\'ını da yakalar', () => {
    assert.throws(() => assertGuardsBeforeValidation({ method: ['GET', 'HEAD'], url: '/me', preHandler: requireAuth }), /GET,HEAD \/me/);
  });

  it('elle işaretlenen guard\'ı (ör. otel bağlamı) da yakalar', () => {
    const context = markAuthGuard(async function context() {});
    assert.throws(() => assertGuardsBeforeValidation({ method: 'GET', url: '/x', preHandler: [context] }), /context/);
  });
});

describe('Fastify ile: guard sırası ve kayıt denetimi', () => {
  /** @param {(app: import('fastify').FastifyInstance) => void} routes */
  const build = async (routes) => {
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      const role = request.headers['x-test-role'];
      request.auth = role ? { permissions: role === 'yetkili' ? ['rooms.manage'] : [] } : null;
    });
    app.setErrorHandler((error, _request, reply) =>
      reply.status(error.validation ? 400 : (error.statusCode ?? 500)).send({ code: error.validation ? 'VALIDATION' : error.code }),
    );
    app.addHook('onRoute', assertGuardsBeforeValidation);
    await app.register(async (child) => routes(child), { prefix: '/korumali' });
    await app.ready();
    return app;
  };

  const schema = {
    body: { type: 'object', required: ['ad'], properties: { ad: { type: 'string' } } },
  };

  it('anonim bozuk gövde 401, yetkisiz 403, yetkili bozuk gövde 400 alır', async () => {
    const app = await build((child) => {
      child.post('/', { preValidation: [requirePermission('rooms.manage')], schema }, async () => ({ ok: true }));
    });
    try {
      const send = (headers) => app.inject({ method: 'POST', url: '/korumali', headers, payload: {} });
      assert.equal((await send({})).statusCode, 401);
      assert.equal((await send({ 'x-test-role': 'yetkisiz' })).statusCode, 403);
      assert.equal((await send({ 'x-test-role': 'yetkili' })).statusCode, 400);
      const ok = await app.inject({ method: 'POST', url: '/korumali', headers: { 'x-test-role': 'yetkili' }, payload: { ad: 'x' } });
      assert.equal(ok.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it('guard preHandler\'a yazılmış route alt eklentide de kaydedilemez', async () => {
    await assert.rejects(
      build((child) => {
        child.post('/', { preHandler: [requirePermission('rooms.manage')], schema }, async () => ({ ok: true }));
      }),
      /POST \/korumali.*preValidation'a taşıyın/,
    );
  });

  it('requiredPermission denetim izi için preValidation\'da da set edilir', async () => {
    let seen;
    const app = await build((child) => {
      child.post('/', { preValidation: [requirePermission('rooms.manage')], schema }, async (request) => {
        seen = request.requiredPermission;
        return { ok: true };
      });
    });
    try {
      await app.inject({ method: 'POST', url: '/korumali', headers: { 'x-test-role': 'yetkili' }, payload: { ad: 'x' } });
      assert.equal(seen, 'rooms.manage');
    } finally {
      await app.close();
    }
  });
});
