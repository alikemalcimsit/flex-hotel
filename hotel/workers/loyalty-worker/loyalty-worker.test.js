import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLoyaltyWorker, loyaltyWorkerManifest } from './index.js';

/** Sadakat aktörünün karar mantığı: hangi olay hangi servise, etkisiz haberler, iş kuralı hatası ve kapalı aktör. */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], service: [] };
  const record = (name, result) => async (...args) => {
    calls.service.push({ name, args });
    return result;
  };
  const worker = createLoyaltyWorker(
    {
      syncFolioPoints: record('syncFolioPoints', { posted: true, message: 'SDK-000001: +248 puan' }),
      syncSpaPoints: record('syncSpaPoints', { posted: true, message: 'SDK-000001: +120 puan' }),
      onFolioItemVoided: record('onFolioItemVoided', { posted: false, skipped: 'Puan harcaması değil' }),
      ...service,
    },
    { isProcessed: async () => false, markProcessed: async () => {}, isEnabled, logActivity: async (entry) => calls.activity.push(entry), createManualTask: async (task) => calls.manualTasks.push(task), sleep: async () => {}, logger: { warn: () => {}, error: () => {} } },
  );
  return { worker, calls };
}
const envelope = (name, id = 'e') => ({ id, name, correlationId: 'zincir', hop: 1 });

describe('sadakat aktörü', () => {
  it('manifest: folyo ve spa olaylarını dinler, görevi "Sadakat"e düşer', () => {
    assert.deepEqual([...loyaltyWorkerManifest.subscribes].sort(), ['folio.closed', 'folio.item.voided', 'folio.reopened', 'spa.appointment.changed']);
    assert.equal(loyaltyWorkerManifest.fallbackModule, 'Sadakat');
  });

  it('folyo kapanışı / açılışı ve kalem iptali servise; spa yalnız tamamlanma ve fiyat haberlerinde', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, folioId: ID, reservationId: ID, chargesTotal: '2480.00', currency: 'TRY' }, envelope('folio.closed', '1'));
    await worker.handle({ hotelId: HOTEL, folioId: ID, reservationId: ID, reason: 'Hata' }, envelope('folio.reopened', '2'));
    await worker.handle({ hotelId: HOTEL, folioId: ID, reservationId: ID, itemId: ID, reversalId: ID, approvalId: null }, envelope('folio.item.voided', '3'));
    for (const change of ['BOOKED', 'COMPLETED', 'CANCELLED', 'RESTORED']) await worker.handle({ hotelId: HOTEL, appointmentId: ID, sessionId: null, change, source: 'STAFF' }, envelope('spa.appointment.changed', change));
    assert.deepEqual(calls.service.map((call) => call.name), ['syncFolioPoints', 'syncFolioPoints', 'onFolioItemVoided', 'syncSpaPoints', 'syncSpaPoints']);
    assert.match(calls.activity[0].message, /\+248 puan/);
  });

  it('kapalıyken görev başlığı işi söyler; iş kuralı hatası beklemeden göreve', async () => {
    const off = makeHarness({ isEnabled: async () => false });
    await off.worker.handle({ hotelId: HOTEL, folioId: ID, reservationId: ID, chargesTotal: '1', currency: 'TRY' }, envelope('folio.closed'));
    assert.equal(off.manualTasks?.length ?? off.calls.manualTasks.length, 1);
    assert.match(off.calls.manualTasks[0].title, /sadakat puanı yazılacak/);
    const failing = makeHarness({ service: { syncFolioPoints: async () => { const error = new Error('Folyo bulunamadı'); error.statusCode = 404; throw error; } } });
    await failing.worker.handle({ hotelId: HOTEL, folioId: ID, reservationId: ID, chargesTotal: '1', currency: 'TRY' }, envelope('folio.closed'));
    assert.equal(failing.calls.manualTasks.length, 1);
    assert.equal(failing.calls.manualTasks[0].module, 'Sadakat');
  });
});
