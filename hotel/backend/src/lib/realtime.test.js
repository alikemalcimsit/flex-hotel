import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

/**
 * Canlı yayın köprüsü — veritabanı gerekmez.
 *
 * `dispatch` (yayınlanmış zarfı dinleyicilere dağıtma) kalıcılığa dokunmuyor,
 * bu yüzden bus gerçek, socket.io sahte. Sınanan şey: doğru otelin odasına,
 * bir kez, yalnızca gerekli alanlarla düşüyor mu.
 */

/** @type {any} */ let eventBus;
/** @type {any} */ let realtime;

/** Kaydedilen yayınları toplayan sahte socket.io sunucusu. */
function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(channel, payload) {
          emitted.push({ room, channel, payload });
        },
      };
    },
  };
}

const HOTEL_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '22222222-2222-4222-8222-222222222222';

before(async () => {
  // db.js import anında PrismaClient kuruyor; bağlanmayacak ama adres şart.
  process.env.DATABASE_URL ??= 'postgresql://user:pass@127.0.0.1:5432/yok';
  ({ eventBus } = await import('./events.js'));
  realtime = await import('./realtime.js');
});

afterEach(() => {
  realtime.stopRealtimeBridge();
});

describe('registerRealtimeBridge', () => {
  it('envanter event\'ini otelin odasına yayınlar', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('room.status.changed', {
        hotelId: HOTEL_ID,
        roomId: ROOM_ID,
        roomNumber: '101',
        field: 'housekeeping',
        from: 'DIRTY',
        to: 'CLEAN',
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, `hotel:${HOTEL_ID}`);
    assert.equal(io.emitted[0].channel, realtime.INVENTORY_CHANNEL);
    assert.equal(io.emitted[0].payload.event, 'room.status.changed');
    assert.equal(io.emitted[0].payload.roomId, ROOM_ID);
  });

  it('ekranın gösterdiği veriyi taşımaz (yalnızca "şu değişti" haberi)', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('room.status.changed', {
        hotelId: HOTEL_ID,
        roomId: ROOM_ID,
        roomNumber: '101',
        field: 'occupancy',
        from: 'VACANT',
        to: 'OCCUPIED',
      }),
    );

    // Oda numarası, durum değerleri, misafir adı: hiçbiri socket'e çıkmamalı —
    // socket'te henüz kimlik doğrulama yok.
    assert.deepEqual(Object.keys(io.emitted[0].payload).sort(), ['actor', 'at', 'event', 'reservationId', 'roomId']);
  });

  it('atama event\'i rezervasyon kimliğini taşır', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    const reservationId = '33333333-3333-4333-8333-333333333333';
    await eventBus.dispatch(
      eventBus.createEnvelope('room.assigned', {
        hotelId: HOTEL_ID,
        reservationId,
        roomId: ROOM_ID,
        roomNumber: '101',
        assignedBy: 'manual',
      }),
    );

    assert.equal(io.emitted[0].payload.reservationId, reservationId);
  });

  it('ikinci kez kurulunca aynı olay iki kez yayınlanmaz', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('room.unassigned', {
        hotelId: HOTEL_ID,
        reservationId: '33333333-3333-4333-8333-333333333333',
        roomId: ROOM_ID,
        roomNumber: '101',
      }),
    );

    assert.equal(io.emitted.length, 1);
  });

  it('köprü söküldükten sonra yayın durur', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);
    realtime.stopRealtimeBridge();

    await eventBus.dispatch(
      eventBus.createEnvelope('room.unassigned', {
        hotelId: HOTEL_ID,
        reservationId: '33333333-3333-4333-8333-333333333333',
        roomId: ROOM_ID,
        roomNumber: '101',
      }),
    );

    assert.equal(io.emitted.length, 0);
  });

  it('ayar event\'leri panele yayınlanmaz (envanteri değiştirmezler)', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('settings.tax.updated', {
        hotelId: HOTEL_ID,
        id: '44444444-4444-4444-8444-444444444444',
        label: 'KDV',
        changedFields: ['rate'],
      }),
    );

    assert.equal(io.emitted.length, 0);
  });
});
