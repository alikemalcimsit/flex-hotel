import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInventoryWorker, inventoryWorkerManifest } from './index.js';

/**
 * Stok aktörünün karar mantığı: kapanan adisyon servise gider, yalnız miktar düşüren stok haberleri öneri işine
 * girer, iş kuralı hatası (depo yok) tekrar denenmez ve manuel göreve düşer, kapalıyken satış düşümü personele
 * düşer ama öneri atlanır. Veritabanı yok — servis sahte, davranış gerçek.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const CHECK = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], service: [] };
  const record = (name, result) =>
    async (...args) => {
      calls.service.push({ name, args });
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result(...args) : result;
    };
  const worker = createInventoryWorker(
    {
      consumeSale: record('consumeSale', { posted: true, message: 'Adisyon A-12: 3 malzeme Ana depo deposundan düşüldü', movements: 3, skippedItems: ['Kola'] }),
      suggestPurchases: record('suggestPurchases', { created: true, message: 'Minimum altı 1 malzeme için STR-2026-0007 talebi açıldı', requestId: 'req', number: 'STR-2026-0007' }),
      ...service,
    },
    {
      isProcessed: async () => false,
      markProcessed: async () => {},
      isEnabled,
      logActivity: async (entry) => calls.activity.push(entry),
      createManualTask: async (task) => calls.manualTasks.push(task),
      sleep: async () => {},
      logger: { warn: () => {}, error: () => {} },
    },
  );
  return { worker, calls };
}

const envelope = (name, id = 'evt-1') => ({ id, name, correlationId: 'zincir', hop: 1 });
const paid = { hotelId: HOTEL, checkId: CHECK, outletId: '44444444-4444-4444-8444-444444444444', number: 'A-12', businessDate: '2026-11-24', closedAt: '2026-11-24T20:00:00.000Z', grandTotal: '450.00', items: [{ menuItemId: ITEM, name: 'Köfte', sold: 3, comped: 0, wasted: 0 }] };

describe('manifest', () => {
  it('adisyon kapanışı ve stok haberini dinler; manuel görevi "Stok"a düşer', () => {
    assert.deepEqual([...inventoryWorkerManifest.subscribes].sort(), ['fnb.order.paid', 'stock.changed']);
    assert.equal(inventoryWorkerManifest.fallbackModule, 'Stok');
    assert.equal(inventoryWorkerManifest.type, 'worker');
  });
});

describe('fnb.order.paid', () => {
  it('servise adisyonu verir, sonucu okunur yazar', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(paid, envelope('fnb.order.paid'));
    assert.deepEqual(calls.service.map((call) => call.name), ['consumeSale']);
    assert.deepEqual(calls.service[0].args, [HOTEL, paid]);
    assert.equal(calls.activity.at(-1).level, 'INFO');
    assert.match(calls.activity.at(-1).message, /3 malzeme/);
    assert.deepEqual(calls.activity.at(-1).meta.skippedItems, ['Kola']);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('iş kuralı hatası (depo yok) tekrar denenmez; iş manuel göreve düşer', async () => {
    const failure = Object.assign(new Error('Adisyon A-12: stok düşülecek depo yok'), { statusCode: 409 });
    const { worker, calls } = makeHarness({ service: { consumeSale: async () => { throw failure; } } });
    await worker.handle(paid, envelope('fnb.order.paid'));
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].module, 'Stok');
    assert.match(calls.manualTasks[0].title, /Adisyon A-12 stoktan düşülecek \(1 ürün\)/);
    assert.equal(calls.activity.at(-1).level, 'ERROR');
  });

  it('aktör kapalıyken satış düşümü personele düşer', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle(paid, envelope('fnb.order.paid'));
    assert.equal(calls.service.length, 0);
    assert.equal(calls.manualTasks.length, 1);
    assert.match(calls.manualTasks[0].description, /kapalı/i);
  });
});

describe('stock.changed', () => {
  it('yalnız miktar düşüren haberleri kabul eder (satış, elle hareket, sayım); mal kabul / depo / minimum iz bırakmaz', () => {
    const { worker } = makeHarness();
    assert.equal(worker.accepts('stock.changed', { change: 'SALE', stockItemIds: [ITEM] }), true);
    assert.equal(worker.accepts('stock.changed', { change: 'MOVEMENT', stockItemIds: [ITEM] }), true);
    assert.equal(worker.accepts('stock.changed', { change: 'COUNT', stockItemIds: [ITEM] }), true);
    assert.equal(worker.accepts('stock.changed', { change: 'COUNT', stockItemIds: [] }), false);
    assert.equal(worker.accepts('stock.changed', { change: 'RECEIPT', stockItemIds: [ITEM] }), false);
    assert.equal(worker.accepts('stock.changed', { change: 'WAREHOUSE', stockItemIds: [] }), false);
    assert.equal(worker.accepts('fnb.order.paid', paid), true);
  });

  it('miktarı değişen malzemeleri öneriye verir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, change: 'SALE', stockItemIds: [ITEM] }, envelope('stock.changed'));
    assert.deepEqual(calls.service[0], { name: 'suggestPurchases', args: [HOTEL, [ITEM]] });
    assert.match(calls.activity.at(-1).message, /STR-2026-0007/);
    assert.equal(calls.activity.at(-1).meta.number, 'STR-2026-0007');
  });

  it('kapalıyken öneri atlanır (manuel görev açılmaz)', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ hotelId: HOTEL, change: 'SALE', stockItemIds: [ITEM] }, envelope('stock.changed'));
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.service.length, 0);
    assert.match(calls.activity.at(-1).message, /atlandı/);
  });
});
