import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountingWorkerManifest, createAccountingWorker } from './index.js';

/**
 * Muhasebe aktörünün karar mantığı: hangi olayda hangi servis işi, hangi haberlerin muhasebe etkisi yok, sonucun
 * okunur izi, iş kuralı hatası ve kapalıyken manuel görev. Veritabanı yok — servis sahte, davranış gerçek. Hesap
 * seçimi ve tutarlar serviste (entegrasyon testleri).
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const REVERSAL = '33333333-3333-4333-8333-333333333333';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], service: [] };
  const record = (name, result) =>
    async (...args) => {
      calls.service.push({ name, args });
      return typeof result === 'function' ? result(...args) : result;
    };
  const worker = createAccountingWorker(
    {
      syncFolioPayment: record('syncFolioPayment', { posted: true, message: 'Folyo tahsilatı · 101 · Nakit → Ön büro kasası (1500.00 TRY)' }),
      syncEventPayment: record('syncEventPayment', { posted: true, message: 'Etkinlik tahsilatı → Banka' }),
      syncPosPayment: record('syncPosPayment', { posted: true, message: 'Restoran tahsilatı → Restoran kasası' }),
      syncGoodsReceipt: record('syncGoodsReceipt', { posted: true, message: 'Mal kabul MKB-2026-0001 → Anadolu Süt carisine borç' }),
      syncAgencyBonus: record('syncAgencyBonus', { posted: true, message: 'Prim hak edişi → Tatil Acentesi' }),
      syncEventCharge: record('syncEventCharge', { posted: true, message: 'Etkinlik bedeli ETK-2026-0001 → Demir Holding' }),
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

describe('manifest', () => {
  it('para olaylarını dinler; manuel görevi "Ön muhasebe"ye düşer', () => {
    assert.deepEqual([...accountingWorkerManifest.subscribes].sort(), [
      'agency.bonus.changed',
      'banquet.event.changed',
      'banquet.payment.changed',
      'payment.received',
      'payment.refunded',
      'payment.voided',
      'pos.payment.changed',
      'purchase.goods.received',
    ]);
    assert.equal(accountingWorkerManifest.fallbackModule, 'Ön muhasebe');
    assert.deepEqual(accountingWorkerManifest.publishes, ['accounting.posted']);
  });
});

describe('ödemeler', () => {
  it('folyo tahsilatı ve iadesi ödeme satırıyla, iptal ise iptal kaydının kimliğiyle işlenir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, paymentId: ID, folioId: ID, reservationId: ID }, envelope('payment.received', 'e1'));
    await worker.handle({ hotelId: HOTEL, paymentId: ID, folioId: ID, reservationId: ID }, envelope('payment.refunded', 'e2'));
    await worker.handle({ hotelId: HOTEL, paymentId: ID, reversalId: REVERSAL, folioId: ID, reservationId: ID }, envelope('payment.voided', 'e3'));
    assert.deepEqual(
      calls.service.map((call) => [call.name, call.args[1]]),
      [
        ['syncFolioPayment', ID],
        ['syncFolioPayment', ID],
        ['syncFolioPayment', REVERSAL],
      ],
    );
    assert.match(calls.activity[0].message, /Ön büro kasası \(1500\.00 TRY\)/);
  });

  it('etkinlik ve restoran ödemesinde yalnız işlenen / iptal edilen haberler servise gider', async () => {
    const { worker, calls } = makeHarness();
    for (const change of ['RECEIVED', 'PENDING', 'POSTED', 'DECLINED', 'VOID_REQUESTED', 'VOIDED', 'VOID_DECLINED']) {
      await worker.handle({ hotelId: HOTEL, eventId: ID, paymentId: ID, change }, envelope('banquet.payment.changed', `b-${change}`));
      await worker.handle({ hotelId: HOTEL, checkId: ID, paymentId: ID, change }, envelope('pos.payment.changed', `p-${change}`));
    }
    assert.equal(calls.service.filter((call) => call.name === 'syncEventPayment').length, 3);
    assert.equal(calls.service.filter((call) => call.name === 'syncPosPayment').length, 3);
    assert.ok(calls.activity.some((entry) => /Muhasebe etkisi yok/.test(entry.message)));
  });

  it('servisin atlaması (başlangıç gününden önce) iz bırakır, görev açmaz', async () => {
    const { worker, calls } = makeHarness({ service: { syncFolioPayment: async () => ({ posted: false, skipped: 'Folyo tahsilatı: başlangıç gününden önce (2026-09-30)' }) } });
    await worker.handle({ hotelId: HOTEL, paymentId: ID, folioId: ID, reservationId: ID }, envelope('payment.received'));
    assert.match(calls.activity[0].message, /başlangıç gününden önce/);
    assert.equal(calls.manualTasks.length, 0);
  });
});

describe('cari kaynakları', () => {
  it('mal kabul, prim ve etkinlik bedeli kendi servisine gider; etkisiz haberler atlanır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, receiptId: ID, orderId: ID, supplierId: ID, netTotal: '100.00', taxTotal: '10.00', grandTotal: '110.00', currency: 'TRY', dueDate: '2026-11-29' }, envelope('purchase.goods.received', 'g'));
    for (const change of ['CALCULATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'REOPENED']) {
      await worker.handle({ hotelId: HOTEL, bonusId: ID, ruleId: ID, agencyId: ID, change }, envelope('agency.bonus.changed', `a-${change}`));
    }
    for (const change of ['UPDATED', 'DEFINITE', 'COMPLETED', 'CANCELLED', 'LOST', 'MENUS']) {
      await worker.handle({ hotelId: HOTEL, eventId: ID, change }, envelope('banquet.event.changed', `e-${change}`));
    }
    assert.deepEqual(
      calls.service.map((call) => call.name),
      ['syncGoodsReceipt', 'syncAgencyBonus', 'syncAgencyBonus', 'syncAgencyBonus', 'syncEventCharge', 'syncEventCharge', 'syncEventCharge'],
    );
  });
});

describe('hata ve kapalı aktör', () => {
  it('iş kuralı hatası (eşleme yok) beklemeden manuel göreve düşer, okunur başlıkla', async () => {
    const { worker, calls } = makeHarness({
      service: {
        syncPosPayment: async () => {
          const error = new Error('Restoran ve oda servisi · Nakit · TRY için kasa / banka eşlemesi yok');
          error.statusCode = 409;
          throw error;
        },
      },
    });
    await worker.handle({ hotelId: HOTEL, checkId: ID, paymentId: ID, change: 'RECEIVED' }, envelope('pos.payment.changed'));
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].module, 'Ön muhasebe');
    assert.equal(calls.manualTasks[0].title, 'Restoran tahsilatı kasaya / bankaya işlenecek');
    assert.match(calls.manualTasks[0].description, /eşlemesi yok/);
  });

  it('aktör kapalıyken servis çağrılmaz, görev işin ne olduğunu söyler', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ hotelId: HOTEL, receiptId: ID, orderId: ID, supplierId: ID, netTotal: '1', taxTotal: '0', grandTotal: '1', currency: 'TRY', dueDate: '2026-11-29' }, envelope('purchase.goods.received'));
    assert.equal(calls.service.length, 0);
    assert.equal(calls.manualTasks[0].title, 'Mal kabul tedarikçi carisine işlenecek');
  });
});
