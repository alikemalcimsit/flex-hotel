import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseLlmAgent, LlmUnavailableError, isLlmUnavailable } from './base-llm-agent.js';
import { BaseWorker } from './base-worker.js';
import { defineActor } from './manifest.js';

/**
 * LLM ajan tabanı: çağrıdan önce izin (açık mı, fiyat, bütçe), çağrıdan sonra
 * kayıt, kalıcı sağlayıcı hatasının "kullanılamıyor"a çevrilmesi. Ve aktör
 * tabanının yeni kancası: iş personele düşünce ajan kendi temizliğini yapar.
 */

const manifest = defineActor({
  name: 'test-agent',
  type: 'agent',
  description: 'Test ajanı',
  subscribes: ['guest.message.received'],
  retry: { attempts: 2, backoffMs: 0 },
});

const HOTEL = '11111111-1111-4111-8111-111111111111';
const payload = { hotelId: HOTEL, conversationId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333', channel: 'WEBCHAT', guestId: null, mode: 'AI' };
const envelope = { id: '44444444-4444-4444-8444-444444444444', name: 'guest.message.received', correlationId: 'z', hop: 1 };

function makeDeps({ llm = {}, ...overrides } = {}) {
  const calls = { usage: [], checks: [], manualTasks: [], activity: [], chat: [] };
  return {
    calls,
    deps: {
      isProcessed: async () => false,
      markProcessed: async () => {},
      isEnabled: async () => true,
      logActivity: async (entry) => calls.activity.push(entry),
      createManualTask: async (task) => calls.manualTasks.push(task),
      sleep: async () => {},
      llm: {
        client: {
          chat: async (request) => {
            calls.chat.push(request);
            return { text: 'ok', toolCalls: [], usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 } };
          },
        },
        assertCanCall: async (hotelId, model) => calls.checks.push({ hotelId, model }),
        recordUsage: async (entry) => calls.usage.push(entry),
        ...llm,
      },
      ...overrides,
    },
  };
}

class Agent extends BaseLlmAgent {
  constructor(deps, handler) {
    super(manifest, { 'guest.message.received': (p) => handler(this, p) }, deps);
  }
}

describe('BaseLlmAgent', () => {
  it('çağrıdan önce izin sorulur, sonra kullanım ajan adıyla yazılır', async () => {
    const { deps, calls } = makeDeps();
    const agent = new Agent(deps, async (self, p) => {
      await self.callModel(p.hotelId, { model: 'model-x', messages: [] });
      return { message: 'tamam' };
    });
    await agent.handle(payload, envelope);
    assert.deepEqual(calls.checks, [{ hotelId: HOTEL, model: 'model-x' }]);
    assert.equal(calls.usage.length, 1);
    assert.equal(calls.usage[0].actorName, 'test-agent');
    assert.deepEqual(calls.usage[0].usage, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 });
  });

  it('bütçe bitmişse model çağrılmaz; hata tekrar denenmez', async () => {
    let attempts = 0;
    const { deps, calls } = makeDeps({
      llm: {
        assertCanCall: async () => {
          throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET');
        },
      },
    });
    const agent = new Agent(deps, async (self, p) => {
      attempts += 1;
      await self.callModel(p.hotelId, { model: 'model-x', messages: [] });
    });
    await agent.handle(payload, envelope);
    assert.equal(attempts, 1, 'kalıcı durum tekrar denenmemeli');
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.usage.length, 0);
  });

  it('anahtar tanımlı değilse "kullanılamıyor"', async () => {
    const { deps } = makeDeps({ llm: { client: null } });
    let caught;
    const agent = new Agent(deps, async (self, p) => {
      try {
        await self.callModel(p.hotelId, { model: 'm', messages: [] });
      } catch (error) {
        caught = error;
        throw error;
      }
    });
    await agent.handle(payload, envelope);
    assert.equal(isLlmUnavailable(caught), true);
    assert.equal(caught.reason, 'NOT_CONFIGURED');
  });

  it('kalıcı sağlayıcı hatası "kullanılamıyor"a çevrilir; geçici hata olduğu gibi (tekrar denenir)', async () => {
    const permanent = Object.assign(new Error('anahtar geçersiz'), { retryable: false });
    const transient = Object.assign(new Error('hız sınırı'), { retryable: true });
    const errors = [transient, permanent];
    const seen = [];
    const { deps, calls } = makeDeps({
      llm: {
        client: {
          chat: async () => {
            throw errors.shift();
          },
        },
      },
    });
    const agent = new Agent(deps, async (self, p) => {
      try {
        await self.callModel(p.hotelId, { model: 'm', messages: [] });
      } catch (error) {
        seen.push(error);
        throw error;
      }
    });
    await agent.handle(payload, envelope);
    assert.equal(seen.length, 2, 'geçici hata bir kez yeniden denenmeli');
    assert.equal(seen[0], transient);
    assert.equal(seen[1].reason, 'PROVIDER');
    assert.equal(calls.usage.length, 0, 'başarısız çağrı kullanım yazmaz');
  });

  it('deps.llm verilmeden ajan kurulamaz', () => {
    const { deps } = makeDeps();
    delete deps.llm;
    assert.throws(() => new Agent(deps, async () => {}), /deps.llm/);
  });
});

describe('BaseWorker.afterFallback', () => {
  class Worker extends BaseWorker {
    constructor(deps, onFallback) {
      super(manifest, { 'guest.message.received': async () => { throw Object.assign(new Error('bozuk'), { retryable: false }); } }, deps);
      this.onFallback = onFallback;
    }

    async afterFallback(p, e, reason) {
      await this.onFallback(p, e, reason);
    }
  }

  it('aktör kapalıyken iş personele düşer ve kanca çalışır', async () => {
    const { deps, calls } = makeDeps({ isEnabled: async () => false });
    const seen = [];
    await new Worker(deps, async (p, e, reason) => seen.push(reason)).handle(payload, envelope);
    assert.equal(calls.manualTasks.length, 1);
    assert.deepEqual(seen, ['Aktör kapalı']);
  });

  it('hata sonrası da kanca çalışır; kancanın hatası yayıncıyı patlatmaz', async () => {
    const { deps, calls } = makeDeps();
    await new Worker(deps, async () => {
      throw new Error('kanca da bozuk');
    }).handle(payload, envelope);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.activity.at(-1).level, 'ERROR');
  });
});
