import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingWorkerManifest, createBillingWorker } from './index.js';

/**
 * Folyo aktörünün karar mantığı: hangi olayda hangi servis işi, sonucun
 * okunur izi, hata ve kapalıyken manuel görev. Veritabanı yok — servis sahte,
 * davranış gerçek. Para hesabı serviste (entegrasyon testleri).
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '33333333-3333-4333-8333-333333333333';
const ROOM = '55555555-5555-4555-8555-555555555555';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], service: [] };
  const record = (name, result) =>
    async (...args) => {
      calls.service.push({ name, args });
      return typeof result === 'function' ? result(...args) : result;
    };

  const worker = createBillingWorker(
    {
      openStayOnCheckIn: record('openStayOnCheckIn', { opened: true, feePosted: '255.00' }),
      settleStayOnCheckOut: record('settleStayOnCheckOut', { roomItems: 1, feePosted: null, closed: 1, open: 0 }),
      reverseCheckInFees: record('reverseCheckInFees', { reversed: 1 }),
      reopenStayOnCheckOutRevert: record('reopenStayOnCheckOutRevert', { reopened: 1, reversed: 1 }),
      postReservationFee: record('postReservationFee', { posted: '1000.00' }),
      reverseReservationFees: record('reverseReservationFees', { reversed: 1 }),
      runRoomCharges: record('runRoomCharges', { night: '2026-09-29', stays: 212, items: 214, total: '245000.00' }),
      postExternalCharge: record('postExternalCharge', { reservationId: RESERVATION, items: 2, total: '91.00' }),
      recordCheckInDeposit: record('recordCheckInDeposit', { status: 'POSTED', amount: '500.00', currency: 'TRY' }),
      reverseCheckInDeposits: record('reverseCheckInDeposits', { reversed: 1, withdrawn: 0 }),
      closeFolioIfSettled: record('closeFolioIfSettled', { closed: true }),
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

const stay = { hotelId: HOTEL, reservationId: RESERVATION, roomTypeId: '44444444-4444-4444-8444-444444444444', roomId: ROOM };
const envelope = (name, id = 'evt-1', extra = {}) => ({ id, name, correlationId: 'zincir', hop: 1, ...extra });

describe('manifest', () => {
  it('giriş / çıkış, geri alma, iptal, gece, dış harcama ve ödeme olaylarını dinler', () => {
    assert.deepEqual(
      [...billingWorkerManifest.subscribes].sort(),
      [
        'fnb.order.charged',
        'folio.room_charges.due',
        'guest.check_in_reverted',
        'guest.check_out_reverted',
        'guest.checked_in',
        'guest.checked_out',
        'minibar.consumed',
        'payment.received',
        'payment.refunded',
        'payment.voided',
        'reservation.cancelled',
        'reservation.no_show',
        'reservation.reinstated',
      ],
    );
    assert.ok(billingWorkerManifest.publishes.includes('folio.closed'));
    assert.equal(billingWorkerManifest.fallbackModule, 'Folyo');
  });
});

describe('giriş ve çıkış', () => {
  it('girişte folyo açılır ve erken giriş ücreti olay kimliğiyle (tekrar işleme anahtarı) istenir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ ...stay, earlyCheckInFee: '255.00' }, envelope('guest.checked_in', 'evt-in'));

    assert.deepEqual(calls.service[0], {
      name: 'openStayOnCheckIn',
      args: [HOTEL, RESERVATION, { earlyCheckInFee: '255.00', eventId: 'evt-in' }],
    });
    assert.match(calls.activity[0].message, /Folyo açıldı, erken giriş ücreti işlendi \(255\.00\)/);
  });

  it('giriş bu arada geri alındıysa servis atladığını söyler, görev açılmaz', async () => {
    const { worker, calls } = makeHarness({
      service: { openStayOnCheckIn: async () => ({ skipped: 'Konaklama içeride değil (giriş geri alınmış)' }) },
    });
    await worker.handle({ ...stay, earlyCheckInFee: null }, envelope('guest.checked_in'));
    assert.match(calls.activity[0].message, /giriş geri alınmış/);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('çıkışta geç çıkış ücreti ve açık bakiye servise geçer; sonuç okunur yazılır', async () => {
    const { worker, calls } = makeHarness({
      service: { settleStayOnCheckOut: async (...args) => (calls.service.push({ args }), { roomItems: 2, feePosted: '255.00', closed: 1, open: 1 }) },
    });
    await worker.handle({ ...stay, lateCheckOutFee: '255.00', openBalance: '120.00' }, envelope('guest.checked_out', 'evt-out'));
    assert.deepEqual(calls.service[0].args, [HOTEL, RESERVATION, { lateCheckOutFee: '255.00', openBalance: '120.00', eventId: 'evt-out' }]);
    assert.match(calls.activity[0].message, /2 oda ücreti kalemi, geç çıkış ücreti \(255\.00\), 1 folyo kapandı, 1 folyoda bakiye var/);
  });

  it('geri almada olayın anı iletilir (sonraki yeni girişin ücretine dokunulmaz)', async () => {
    const { worker, calls } = makeHarness();
    const at = '2026-09-30T10:15:00.000Z';
    await worker.handle({ ...stay, reason: 'Yanlış oda' }, envelope('guest.check_in_reverted', 'evt-r', { occurredAt: at }));
    assert.equal(calls.service[0].name, 'reverseCheckInFees');
    assert.equal(calls.service[0].args[2].occurredAt.toISOString(), at);
    assert.equal(calls.service[0].args[2].reason, 'Yanlış oda');
  });

  it('çıkış geri alınınca folyo yeniden açılır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ ...stay, reason: 'Misafir kalıyor' }, envelope('guest.check_out_reverted'));
    assert.equal(calls.service[0].name, 'reopenStayOnCheckOutRevert');
    assert.match(calls.activity[0].message, /1 folyo yeniden açıldı, geç çıkış ücreti düşüldü/);
  });
});

describe('rezervasyon ücretleri', () => {
  it('iptal ve gelmedi ücretleri kendi türüyle istenir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(stay, envelope('reservation.cancelled', 'evt-c'));
    await worker.handle(stay, envelope('reservation.no_show', 'evt-n'));
    assert.deepEqual(
      calls.service.map((call) => call.args[2]),
      [
        { kind: 'CANCELLATION', eventId: 'evt-c' },
        { kind: 'NO_SHOW', eventId: 'evt-n' },
      ],
    );
  });

  it('ücret yoksa atlandığı yazılır', async () => {
    const { worker, calls } = makeHarness({ service: { postReservationFee: async () => ({ skipped: 'Ücret yok' }) } });
    await worker.handle(stay, envelope('reservation.cancelled'));
    assert.equal(calls.activity[0].message, 'Ücret yok');
  });
});

describe('gece oda ücretleri', () => {
  it('gecenin çalışması özetle izlenir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, night: '2026-09-29' }, envelope('folio.room_charges.due'));
    assert.deepEqual(calls.service[0].args, [HOTEL, { night: '2026-09-29' }]);
    assert.match(calls.activity[0].message, /29\.09\.2026 gecesi: 212 konaklamaya 214 oda ücreti kalemi/);
  });

  it('işlenecek gece yoksa bunu söyler (sıfırlı özet yazmaz)', async () => {
    const { worker, calls } = makeHarness({
      service: { runRoomCharges: async () => ({ night: '2026-09-29', stays: 0, items: 0, total: '0.00' }) },
    });
    await worker.handle({ hotelId: HOTEL, night: '2026-09-29' }, envelope('folio.room_charges.due'));
    assert.equal(calls.activity[0].message, '29.09.2026 gecesi: işlenecek yeni gece yoktu');
  });

  it('aktör kapalıyken görev, işin yapılacağı ekranı söyler', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ hotelId: HOTEL, night: '2026-09-29' }, envelope('folio.room_charges.due'));
    assert.equal(calls.service.length, 0);
    assert.equal(calls.manualTasks[0].module, 'Folyo');
    assert.match(calls.manualTasks[0].title, /29\.09\.2026 gecesinin oda ücretleri işlenecek/);
  });
});

describe('dış harcamalar', () => {
  const charge = { hotelId: HOTEL, reservationId: null, roomId: ROOM, reference: 'MB-1042', items: [{ description: 'Su', unitPrice: '45.50', quantity: 2 }] };

  it('minibar tüketimi olay kimliğiyle işlenir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(charge, envelope('minibar.consumed', 'evt-mb'));
    assert.deepEqual(calls.service[0].args.slice(2), [{ source: 'MINIBAR', eventId: 'evt-mb' }]);
    assert.match(calls.activity[0].message, /Minibar tüketimi MB-1042 folyoya işlendi \(91\.00\)/);
  });

  it('odada misafir yoksa (iş kuralı) tekrar denemeden personele düşer', async () => {
    let attempts = 0;
    const { worker, calls } = makeHarness({
      service: {
        postExternalCharge: async () => {
          attempts += 1;
          const error = new Error('Odada konaklayan misafir yok; harcama folyoya elle işlenmeli.');
          error.statusCode = 409;
          throw error;
        },
      },
    });
    await worker.handle(charge, envelope('fnb.order.charged'));
    assert.equal(attempts, 1);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'Restoran siparişi MB-1042 folyoya elle işlenecek');
    assert.match(calls.manualTasks[0].description, /Odada konaklayan misafir yok/);
  });

  it('geçici hata tekrar denenir', async () => {
    let attempts = 0;
    const { worker, calls } = makeHarness({
      service: {
        postExternalCharge: async () => {
          attempts += 1;
          if (attempts < 2) throw new Error('bağlantı koptu');
          return { reservationId: RESERVATION, items: 2, total: '91.00' };
        },
      },
    });
    await worker.handle(charge, envelope('minibar.consumed'));
    assert.equal(attempts, 2);
    assert.equal(calls.manualTasks.length, 0);
  });
});

describe('ödeme (modül 17)', () => {
  const FOLIO = '66666666-6666-4666-8666-666666666666';
  const payment = (extra = {}) => ({ hotelId: HOTEL, folioId: FOLIO, reservationId: RESERVATION, paymentId: '77777777-7777-4777-8777-777777777777', ...extra });

  it('girişte nakit teminat ödeme olarak işlenir (folyo açıldıktan sonra)', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ ...stay, earlyCheckInFee: null, deposit: { method: 'CASH', amount: '500.00', reference: null } }, envelope('guest.checked_in'));
    assert.deepEqual(calls.service.map((call) => call.name), ['openStayOnCheckIn', 'recordCheckInDeposit']);
    assert.deepEqual(calls.service[1].args, [HOTEL, RESERVATION]);
    assert.match(calls.activity[0].message, /^Folyo açıldı, .*teminat ödeme olarak işlendi \(500\.00 TRY\)$/);
  });

  it('eşik üstü teminat onaya gittiğini söyler; kart provizyonu ödeme değildir', async () => {
    const pending = makeHarness({ service: { recordCheckInDeposit: async () => ({ status: 'PENDING', amount: '90000.00', currency: 'TRY' }) } });
    await pending.worker.handle({ ...stay, deposit: { method: 'TRANSFER', amount: '90000.00' } }, envelope('guest.checked_in'));
    assert.match(pending.calls.activity[0].message, /teminat \(90000\.00 TRY\) büyük ödeme onayına gitti/);

    const card = makeHarness();
    await card.worker.handle({ ...stay, deposit: { method: 'CARD_PREAUTH', amount: '2000.00' } }, envelope('guest.checked_in'));
    assert.deepEqual(card.calls.service.map((call) => call.name), ['openStayOnCheckIn']);
  });

  it('giriş geri alınınca ücret ve teminat ödemesi düşer (olayın anıyla)', async () => {
    const { worker, calls } = makeHarness();
    const at = '2026-10-03T10:15:00.000Z';
    await worker.handle({ ...stay, reason: 'Yanlış oda' }, envelope('guest.check_in_reverted', 'evt-r', { occurredAt: at }));
    assert.deepEqual(calls.service.map((call) => call.name), ['reverseCheckInFees', 'reverseCheckInDeposits']);
    assert.equal(calls.service[1].args[2].occurredAt.toISOString(), at);
    assert.match(calls.activity[0].message, /^Erken giriş ücreti ters kayıtla düşüldü, teminat ödemesi iptal kaydıyla düşüldü/);
  });

  it('bitmiş konaklamanın ödemesinden sonra folyo sıfırlandıysa kapanır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(payment({ stayEnded: true }), envelope('payment.received'));
    assert.deepEqual(calls.service[0], { name: 'closeFolioIfSettled', args: [HOTEL, FOLIO] });
    assert.equal(calls.activity[0].message, 'Bakiye sıfırlandı; folyo kapandı');

    const open = makeHarness({ service: { closeFolioIfSettled: async () => ({ closed: false, reason: 'Bakiye sıfır değil', balance: '120.00' }) } });
    await open.worker.handle(payment({ stayEnded: true }), envelope('payment.refunded'));
    assert.equal(open.calls.activity[0].message, 'Folyo açık kaldı: bakiye sıfır değil');
  });

  it('içerideki misafirin ödemeleri aktörü ilgilendirmez (kapalıyken görev de açılmaz)', () => {
    const { worker } = makeHarness();
    assert.equal(worker.accepts('payment.received', payment({ stayEnded: false })), false);
    assert.equal(worker.accepts('payment.voided', payment({ stayEnded: true })), true);
    assert.equal(worker.accepts('guest.checked_in', stay), true);
  });

  it('aktör kapalıyken giriş görevi teminatın da işleneceğini söyler', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ ...stay, earlyCheckInFee: null, deposit: { method: 'CASH', amount: '500.00' } }, envelope('guest.checked_in'));
    assert.equal(calls.service.length, 0);
    assert.match(calls.manualTasks[0].title, /folyo açılacak; teminat \(500\.00\) ödeme olarak işlenecek/);
  });
});
