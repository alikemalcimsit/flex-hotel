import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createKbsWorker, kbsWorkerManifest } from './index.js';

/** KBS aktörünün karar mantığı: hangi olay hangi servise, kapalı aktör, iş kuralı hatası. */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const NAMES = ['onCheckedIn', 'onCheckedOut', 'onCheckInReverted', 'onCheckOutReverted', 'onRoomAssigned'];

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], service: [] };
  const record = (name) => async (...args) => {
    calls.service.push({ name, args });
    return { posted: true, message: `${name} tamam` };
  };
  const worker = createKbsWorker(
    { ...Object.fromEntries(NAMES.map((name) => [name, record(name)])), ...service },
    { isProcessed: async () => false, markProcessed: async () => {}, isEnabled, logActivity: async (entry) => calls.activity.push(entry), createManualTask: async (task) => calls.manualTasks.push(task), sleep: async () => {}, logger: { warn: () => {}, error: () => {} } },
  );
  return { worker, calls };
}
const envelope = (name, id = 'e') => ({ id, name, correlationId: 'zincir', hop: 1 });
const stay = { hotelId: HOTEL, reservationId: ID, roomTypeId: ID, checkIn: '2026-11-25', checkOut: '2026-11-27', roomId: ID, guestId: ID };

describe('KBS aktörü', () => {
  it('manifest: giriş / çıkış / geri alma / oda olaylarını dinler, görevi "KBS"ye düşer', () => {
    assert.deepEqual([...kbsWorkerManifest.subscribes].sort(), ['guest.check_in_reverted', 'guest.check_out_reverted', 'guest.checked_in', 'guest.checked_out', 'room.assigned']);
    assert.equal(kbsWorkerManifest.fallbackModule, 'KBS');
  });

  it('her olay kendi servis işine, otel ve rezervasyonla', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ ...stay, earlyCheckInFee: null, deposit: null }, envelope('guest.checked_in', '1'));
    await worker.handle({ ...stay, lateCheckOutFee: null, earlyDeparture: false, openBalance: null }, envelope('guest.checked_out', '2'));
    await worker.handle({ ...stay, reason: 'Yanlış' }, envelope('guest.check_in_reverted', '3'));
    await worker.handle({ ...stay, reason: 'Yanlış' }, envelope('guest.check_out_reverted', '4'));
    await worker.handle({ hotelId: HOTEL, reservationId: ID, roomId: ID, roomNumber: '102', assignedBy: 'manual' }, envelope('room.assigned', '5'));
    assert.deepEqual(calls.service.map((call) => call.name), NAMES);
    assert.deepEqual(calls.service[0].args, [HOTEL, ID]);
    assert.match(calls.activity[0].message, /onCheckedIn tamam/);
  });

  it('kapalıyken görev başlığı işi söyler; iş kuralı hatası beklemeden göreve', async () => {
    const off = makeHarness({ isEnabled: async () => false });
    await off.worker.handle({ ...stay, earlyCheckInFee: null, deposit: null }, envelope('guest.checked_in'));
    assert.equal(off.calls.manualTasks.length, 1);
    assert.match(off.calls.manualTasks[0].title, /KBS giriş bildirimi elle yapılacak/);
    const failing = makeHarness({ service: { onCheckedOut: async () => { const error = new Error('Rezervasyon bulunamadı'); error.statusCode = 404; throw error; } } });
    await failing.worker.handle({ ...stay, lateCheckOutFee: null, earlyDeparture: false, openBalance: null }, envelope('guest.checked_out'));
    assert.equal(failing.calls.manualTasks.length, 1);
    assert.equal(failing.calls.manualTasks[0].module, 'KBS');
  });
});
