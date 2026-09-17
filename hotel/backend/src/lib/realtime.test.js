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
    assert.equal(io.emitted[0].room, `hotel:${HOTEL_ID}:ch:${realtime.INVENTORY_CHANNEL}`);
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
    assert.deepEqual(Object.keys(io.emitted[0].payload).sort(), [
      'actor',
      'at',
      'conversationId',
      'event',
      'kind',
      'notificationId',
      'permission',
      'requestId',
      'reservationId',
      'roomId',
      'userId',
      'alertId',
      'approvalId',
      'spreadMs',
    ].sort());
  });

  it('personel uyarısı kime gittiğini taşır, başlığını ve metnini taşımaz', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);
    const ALERT_ID = '66666666-6666-4666-8666-666666666666';

    await eventBus.dispatch(
      eventBus.createEnvelope('staff.alert.raised', {
        hotelId: HOTEL_ID,
        alertId: ALERT_ID,
        kind: 'GUEST_MESSAGE',
        userId: null,
        permission: 'messages.view',
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].channel, realtime.STAFF_ALERTS_CHANNEL);
    assert.equal(io.emitted[0].payload.alertId, ALERT_ID);
    assert.equal(io.emitted[0].payload.permission, 'messages.view');
    assert.equal(io.emitted[0].room, `hotel:${HOTEL_ID}:perm:messages.view`);
    assert.equal('title' in io.emitted[0].payload, false);
  });

  it('kişiye giden uyarı yalnızca o kişinin odasına düşer; muhatapsız uyarı yayınlanmaz', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io, { warn() {} });
    const USER_ID = '88888888-8888-4888-8888-888888888888';

    await eventBus.dispatch(
      eventBus.createEnvelope('staff.alert.raised', {
        hotelId: HOTEL_ID,
        alertId: '66666666-6666-4666-8666-666666666666',
        kind: 'MANUAL_TASK',
        userId: USER_ID,
        permission: null,
      }),
    );
    await eventBus.dispatch(
      eventBus.createEnvelope('staff.alert.raised', {
        hotelId: HOTEL_ID,
        alertId: '66666666-6666-4666-8666-666666666667',
        kind: 'MANUAL_TASK',
        userId: null,
        permission: null,
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, `hotel:${HOTEL_ID}:user:${USER_ID}`);
  });

  it('kalabalık odada yayılma süresi büyür, üst sınırı aşmaz', async () => {
    const io = fakeIo();
    const rooms = new Map([[realtime.channelRoom(HOTEL_ID, realtime.REQUESTS_CHANNEL), { size: 2500 }]]);
    io.sockets = { adapter: { rooms } };
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('guest.request.updated', {
        hotelId: HOTEL_ID,
        requestId: '77777777-7777-4777-8777-777777777777',
        status: 'DONE',
        changedFields: ['status'],
      }),
    );

    assert.equal(io.emitted[0].payload.spreadMs, 5000);
    rooms.set(realtime.channelRoom(HOTEL_ID, realtime.REQUESTS_CHANNEL), { size: 100_000 });
    assert.equal(realtime.spreadFor(io, realtime.channelRoom(HOTEL_ID, realtime.REQUESTS_CHANNEL)), 8000);
    assert.equal(realtime.spreadFor(io, 'yok'), 0);
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

  it('gelen mesaj gelen kutusu kanalına düşer, içerik taşımaz', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    const conversationId = '55555555-5555-4555-8555-555555555555';
    await eventBus.dispatch(
      eventBus.createEnvelope('guest.message.received', {
        hotelId: HOTEL_ID,
        conversationId,
        messageId: '66666666-6666-4666-8666-666666666666',
        channel: 'WHATSAPP',
        guestId: null,
        mode: 'MANUAL',
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].channel, realtime.MESSAGING_CHANNEL);
    assert.equal(io.emitted[0].payload.conversationId, conversationId);
    assert.equal(JSON.stringify(io.emitted[0].payload).includes('WHATSAPP'), false);
  });

  it('onay olayı onay kanalına düşer; özet ve tutar taşımaz', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('approval.requested', {
        hotelId: HOTEL_ID,
        approvalId: '99999999-9999-4999-8999-999999999999',
        type: 'REFUND',
        actorName: 'refund-worker',
        expiresAt: new Date(),
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].channel, realtime.APPROVALS_CHANNEL);
    assert.equal(io.emitted[0].room, `hotel:${HOTEL_ID}:ch:${realtime.APPROVALS_CHANNEL}`);
    assert.equal(io.emitted[0].payload.approvalId, '99999999-9999-4999-8999-999999999999');
    assert.equal(JSON.stringify(io.emitted[0].payload).includes('REFUND'), false);
  });

  it('istek olayı istek kanalına düşer', async () => {
    const io = fakeIo();
    realtime.registerRealtimeBridge(io);

    await eventBus.dispatch(
      eventBus.createEnvelope('guest.request.updated', {
        hotelId: HOTEL_ID,
        requestId: '77777777-7777-4777-8777-777777777777',
        status: 'DONE',
        changedFields: ['status'],
      }),
    );

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].channel, realtime.REQUESTS_CHANNEL);
  });
});

/** Sahte socket: katıldığı odalar, yayınladıkları ve dinleyicileri. */
function fakeSocket(auth) {
  const handlers = new Map();
  return {
    handshake: { auth },
    rooms: new Set(),
    emitted: [],
    on(name, handler) {
      handlers.set(name, handler);
    },
    async join(rooms) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (const room of [rooms].flat()) this.rooms.add(room);
    },
    async leave(room) {
      this.rooms.delete(room);
    },
    emit(name, payload) {
      this.emitted.push({ name, payload });
    },
    trigger(name, ...args) {
      return handlers.get(name)(...args);
    },
  };
}

describe('registerSocketHandlers', () => {
  const USER_ID = '99999999-9999-4999-8999-999999999999';

  function connect(auth, overrides = {}) {
    let onConnection;
    const io = {
      on(name, handler) {
        if (name === 'connection') onConnection = handler;
      },
    };
    realtime.registerSocketHandlers(io, {
      resolveHotelId: async () => HOTEL_ID,
      findStaff: async (hotelId, email) => (email === 'kat@test.local' ? { id: USER_ID, role: 'HOUSEKEEPING' } : null),
      permissionsForRole: (role) => (role === 'HOUSEKEEPING' ? ['rooms.view'] : []),
      logger: { error() {} },
      ...overrides,
    });
    const socket = fakeSocket(auth);
    onConnection(socket);
    return socket;
  }

  it('personel kişi ve izin odalarına katılır; bağlantı anındaki abonelik kaybolmaz', async () => {
    const socket = connect({ actor: 'Kat@Test.local' });
    const acks = [];
    await socket.trigger(
      'subscribe',
      [realtime.REQUESTS_CHANNEL, realtime.STAFF_ALERTS_CHANNEL, 'uydurma', realtime.REQUESTS_CHANNEL],
      (ack) => acks.push(ack),
    );

    assert.deepEqual(acks, [{ ok: true, channels: [realtime.REQUESTS_CHANNEL] }]);
    assert.deepEqual(
      [...socket.rooms].sort(),
      [
        `hotel:${HOTEL_ID}`,
        `hotel:${HOTEL_ID}:ch:${realtime.REQUESTS_CHANNEL}`,
        `hotel:${HOTEL_ID}:perm:rooms.view`,
        `hotel:${HOTEL_ID}:user:${USER_ID}`,
      ].sort(),
    );
    assert.deepEqual(socket.emitted, [{ name: 'ready', payload: { hotelId: HOTEL_ID, userId: USER_ID, spreadMs: 0 } }]);

    await socket.trigger('unsubscribe', realtime.REQUESTS_CHANNEL);
    assert.equal(socket.rooms.has(`hotel:${HOTEL_ID}:ch:${realtime.REQUESTS_CHANNEL}`), false);
  });

  it('kimliği bilinmeyen bağlantı yalnızca otel odasına katılır', async () => {
    const socket = connect({ actor: 'yabanci@test.local' });
    await socket.trigger('subscribe', [realtime.INVENTORY_CHANNEL]);
    assert.deepEqual([...socket.rooms].sort(), [`hotel:${HOTEL_ID}`, `hotel:${HOTEL_ID}:ch:${realtime.INVENTORY_CHANNEL}`].sort());
    assert.equal(socket.emitted[0].payload.userId, null);
  });

  it('bağlam kurulamazsa "canlı değil" bildirilir, abonelik reddedilir', async () => {
    const socket = connect({}, { resolveHotelId: async () => { throw new Error('otel yok'); } });
    const acks = [];
    await socket.trigger('subscribe', [realtime.INVENTORY_CHANNEL], (ack) => acks.push(ack));
    assert.deepEqual(acks, [{ ok: false, channels: [] }]);
    assert.equal(socket.rooms.size, 0);
    assert.equal(socket.emitted[0].payload.hotelId, null);
  });
});
