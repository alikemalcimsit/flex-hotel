import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as contracts from './index.js';
import {
  MAX_GUEST_ACTIVE_ORDERS,
  MAX_ROOM_SERVICE_SCHEDULE_DAYS,
  MIN_ROOM_SERVICE_LEAD_MINUTES,
  ROOM_SERVICE_ACTIVE_STATUSES,
  ROOM_SERVICE_FINAL_STATUSES,
  ROOM_SERVICE_STATUSES,
  ROOM_SERVICE_STATUS_LABELS,
  cancelRoomServiceOrderSchema,
  collectTraysSchema,
  createRoomServiceOrderSchema,
  deliverAtError,
  deliverRoomServiceOrderSchema,
  kitchenStarted,
  publicRoomServiceOrderSchema,
  publicRoomServiceTokenSchema,
  roomServiceDurations,
  roomServiceReportQuerySchema,
  roomServiceSchedule,
  roomServiceTransitionError,
  TRAY_TRACKING_HOURS,
  trayOverdue,
  trayPending,
  trayTrackingSince,
  wallTimeField,
} from './room-service.js';
import { ROOM_SERVICE_POLICY_LIMITS, createPosOutletSchema, updatePosOutletSchema, updatePosSettingsSchema } from './pos.js';

const at = (text) => new Date(text);
const ids = {
  outlet: '11111111-1111-4111-8111-111111111111',
  stay: '22222222-2222-4222-8222-222222222222',
  item: '33333333-3333-4333-8333-333333333333',
  item2: '44444444-4444-4444-8444-444444444444',
  request: '55555555-5555-4555-8555-555555555555',
};

describe('oda servisi durum geçişleri', () => {
  it('mutfak adımları ileri gider, atlanabilir; yoldaki sipariş hazıra geri alınır', () => {
    assert.equal(roomServiceTransitionError('RECEIVED', 'PREPARING'), null);
    assert.equal(roomServiceTransitionError('RECEIVED', 'READY'), null);
    assert.equal(roomServiceTransitionError('RECEIVED', 'ON_THE_WAY'), null);
    assert.equal(roomServiceTransitionError('PREPARING', 'READY'), null);
    assert.equal(roomServiceTransitionError('READY', 'ON_THE_WAY'), null);
    assert.equal(roomServiceTransitionError('ON_THE_WAY', 'READY'), null);
  });

  it('geri adım (hazırdan mutfağa) ve aynı duruma geçiş yok', () => {
    assert.match(roomServiceTransitionError('READY', 'PREPARING'), /geçişi yapılamaz/);
    assert.match(roomServiceTransitionError('PREPARING', 'RECEIVED'), /geçişi yapılamaz/);
    assert.match(roomServiceTransitionError('READY', 'READY'), /zaten/);
  });

  it('kabul / mutfağa gönderme / teslim / iptal elle ilerletilmez; bitmiş sipariş değişmez', () => {
    assert.match(roomServiceTransitionError('REQUESTED', 'RECEIVED'), /kabul/);
    assert.match(roomServiceTransitionError('SCHEDULED', 'PREPARING'), /mutfağa gönderilmeli/);
    assert.match(roomServiceTransitionError('ON_THE_WAY', 'DELIVERED'), /geçişi yapılamaz/);
    for (const final of ROOM_SERVICE_FINAL_STATUSES) assert.match(roomServiceTransitionError(final, 'READY'), /değiştirilemez/);
    assert.equal(roomServiceTransitionError('RECEIVED', 'NOPE'), 'Geçersiz durum');
  });

  it('mutfağın başladığı durumlar (iptalde zayi, şef garson)', () => {
    assert.deepEqual(ROOM_SERVICE_STATUSES.filter(kitchenStarted), ['PREPARING', 'READY', 'ON_THE_WAY']);
  });

  it('her durumun etiketi var; açık + bitmiş = hepsi', () => {
    for (const status of ROOM_SERVICE_STATUSES) assert.ok(ROOM_SERVICE_STATUS_LABELS[status]);
    assert.deepEqual([...ROOM_SERVICE_ACTIVE_STATUSES, ...ROOM_SERVICE_FINAL_STATUSES].sort(), [...ROOM_SERVICE_STATUSES].sort());
  });
});

describe('oda servisi zamanlaması', () => {
  const policy = { prepLeadMinutes: 30, deliveryTargetMinutes: 25 };
  const now = at('2026-10-25T20:00:00Z');

  it('hemen: şimdi mutfağa düşer, hedef şimdi + hedef süre', () => {
    const plan = roomServiceSchedule({ now, deliverAt: null, ...policy });
    assert.deepEqual(plan, { status: 'RECEIVED', releaseAt: null, dueAt: at('2026-10-25T20:25:00Z') });
  });

  it('ileri saatli: teslimden hazırlık payı kadar önce düşer, hedef istenen an', () => {
    const plan = roomServiceSchedule({ now, deliverAt: at('2026-10-26T04:30:00Z'), ...policy });
    assert.deepEqual(plan, { status: 'SCHEDULED', releaseAt: at('2026-10-26T04:00:00Z'), dueAt: at('2026-10-26T04:30:00Z') });
  });

  it('düşme anı geçmiş ya da tam şimdi: hemen düşer, hedef yine istenen an', () => {
    assert.deepEqual(roomServiceSchedule({ now, deliverAt: at('2026-10-25T20:20:00Z'), ...policy }), { status: 'RECEIVED', releaseAt: null, dueAt: at('2026-10-25T20:20:00Z') });
    assert.equal(roomServiceSchedule({ now, deliverAt: at('2026-10-25T20:30:00Z'), ...policy }).status, 'RECEIVED');
    assert.equal(roomServiceSchedule({ now, deliverAt: at('2026-10-25T20:30:00.001Z'), ...policy }).status, 'SCHEDULED');
  });

  it('istenen teslim: en az birkaç dakika sonra, en fazla birkaç gün içinde', () => {
    assert.match(deliverAtError(new Date(now.getTime() + (MIN_ROOM_SERVICE_LEAD_MINUTES - 1) * 60_000), now), /en az/);
    assert.equal(deliverAtError(new Date(now.getTime() + MIN_ROOM_SERVICE_LEAD_MINUTES * 60_000), now), null);
    const limit = now.getTime() + MAX_ROOM_SERVICE_SCHEDULE_DAYS * 86_400_000;
    assert.equal(deliverAtError(new Date(limit), now), null);
    assert.match(deliverAtError(new Date(limit + 60_000), now), /en fazla/);
  });
});

describe('oda servisi süreleri ve tepsi', () => {
  it('adım süreleri dakika; atlanan adım boş; zamanında = teslim ≤ hedef', () => {
    const order = {
      receivedAt: at('2026-10-25T07:00:00Z'),
      readyAt: at('2026-10-25T07:18:30Z'),
      dispatchedAt: at('2026-10-25T07:21:00Z'),
      deliveredAt: at('2026-10-25T07:29:00Z'),
      dueAt: at('2026-10-25T07:30:00Z'),
    };
    assert.deepEqual(roomServiceDurations(order), { kitchen: 19, waiting: 3, transit: 8, total: 29, onTime: true });
    assert.equal(roomServiceDurations({ ...order, deliveredAt: at('2026-10-25T07:30:00.001Z') }).onTime, false);
    assert.deepEqual(roomServiceDurations({ ...order, readyAt: null }), { kitchen: null, waiting: null, transit: 8, total: 29, onTime: true });
    assert.equal(roomServiceDurations({ ...order, deliveredAt: null }).onTime, null);
  });

  it('tepsi: teslimden uyarı süresi geçince; tepsi yoksa ya da toplandıysa hiç', () => {
    const order = { deliveredAt: at('2026-10-25T08:00:00Z'), trayExpected: true, trayCollectedAt: null };
    assert.equal(trayOverdue(order, at('2026-10-25T09:29:59Z'), 90), false);
    assert.equal(trayOverdue(order, at('2026-10-25T09:30:00Z'), 90), true);
    assert.equal(trayOverdue({ ...order, trayExpected: false }, at('2026-10-26T00:00:00Z'), 90), false);
    assert.equal(trayOverdue({ ...order, trayCollectedAt: at('2026-10-25T08:30:00Z') }, at('2026-10-26T00:00:00Z'), 90), false);
    assert.equal(trayOverdue({ ...order, deliveredAt: null }, at('2026-10-26T00:00:00Z'), 90), false);
  });

  it('tepsi takibi 24 saatlik pencerede: sonrası oda temizliğiyle toplanmış sayılır', () => {
    const order = { deliveredAt: at('2026-10-25T08:00:00Z'), trayExpected: true, trayCollectedAt: null };
    assert.equal(trayPending(order, at('2026-10-26T07:59:59Z')), true);
    assert.equal(trayOverdue(order, at('2026-10-26T07:59:59Z'), 90), true);
    assert.equal(trayPending(order, at('2026-10-26T08:00:00Z')), false);
    assert.equal(trayOverdue(order, at('2026-10-27T08:00:00Z'), 90), false);
    assert.deepEqual(trayTrackingSince(at('2026-10-26T08:00:00Z')), at('2026-10-25T08:00:00Z'));
    assert.ok(TRAY_TRACKING_HOURS * 60 >= ROOM_SERVICE_POLICY_LIMITS.trayAlertMinutes.max, 'uyarı penceresinin içinde');
  });

  it('kabul edilmeyen misafir siparişi önce uyarı, sonra süre aşımı (sıra doğru)', () => {
    assert.ok(contracts.GUEST_ORDER_ALERT_MINUTES < contracts.GUEST_ORDER_EXPIRY_MINUTES);
    assert.ok(contracts.GUEST_ORDER_EXPIRED_REASON.length >= 3);
  });
});

describe('oda servisi şemaları', () => {
  const base = { requestId: ids.request, outletId: ids.outlet, reservationId: ids.stay, lines: [{ menuItemId: ids.item, quantity: 2 }] };

  it('duvar saati: biçim, takvimde olmayan gün ve saat reddedilir', () => {
    assert.equal(wallTimeField.parse('2026-10-26T07:30'), '2026-10-26T07:30');
    for (const bad of ['2026-02-31T07:30', '2026-10-26T24:00', '2026-10-26T07:60', '2026-10-26 07:30', '2026-10-26T07:30:00', '2026-10-26T07:30Z']) {
      assert.equal(wallTimeField.safeParse(bad).success, false, bad);
    }
  });

  it('sipariş: varsayılanlar, boş not null, aynı ürün aynı notla iki satır olmaz', () => {
    const parsed = createRoomServiceOrderSchema.parse({ ...base, note: '  ' });
    assert.equal(parsed.covers, 1);
    assert.equal(parsed.trayExpected, true);
    assert.equal(parsed.note, null);
    const twice = createRoomServiceOrderSchema.safeParse({ ...base, lines: [{ menuItemId: ids.item, quantity: 1 }, { menuItemId: ids.item, quantity: 1 }] });
    assert.equal(twice.success, false);
    assert.deepEqual(twice.error.issues[0].path, ['lines', 1, 'menuItemId']);
    const notes = createRoomServiceOrderSchema.safeParse({ ...base, lines: [{ menuItemId: ids.item, quantity: 1 }, { menuItemId: ids.item, quantity: 1, note: 'az pişmiş' }] });
    assert.equal(notes.success, true);
    assert.equal(createRoomServiceOrderSchema.safeParse({ ...base, lines: [] }).success, false);
    assert.equal(createRoomServiceOrderSchema.safeParse({ ...base, note: '4111 1111 1111 1111' }).success, false);
  });

  it('teslim: kart ödemesi slip no ister; en fazla 4 ödeme; varsayılan kalan odaya', () => {
    const version = '2026-10-25T08:00:00.000Z';
    const ok = deliverRoomServiceOrderSchema.parse({ requestId: ids.request, expectedUpdatedAt: version });
    assert.deepEqual(ok.payments, []);
    assert.equal(ok.chargeRemainder, true);
    const card = deliverRoomServiceOrderSchema.safeParse({ requestId: ids.request, expectedUpdatedAt: version, payments: [{ method: 'CARD', amount: '100' }] });
    assert.equal(card.success, false);
    const five = Array.from({ length: 5 }, () => ({ method: 'CASH', amount: '10' }));
    assert.equal(deliverRoomServiceOrderSchema.safeParse({ requestId: ids.request, expectedUpdatedAt: version, payments: five }).success, false);
    assert.equal(deliverRoomServiceOrderSchema.safeParse({ requestId: ids.request, expectedUpdatedAt: version, payments: [{ method: 'CASH', amount: '0' }] }).success, false);
  });

  it('iptal sebep ister; tepsi toplama tekrarları teke indirir', () => {
    assert.equal(cancelRoomServiceOrderSchema.safeParse({ expectedUpdatedAt: '2026-10-25T08:00:00Z', reason: 'x' }).success, false);
    assert.deepEqual(collectTraysSchema.parse({ orderIds: [ids.item, ids.item, ids.item2] }).orderIds, [ids.item, ids.item2]);
    assert.equal(collectTraysSchema.safeParse({ orderIds: [] }).success, false);
  });

  it('misafir: belirteç biçimi; kalem ve kişi sınırı', () => {
    const token = `${ids.stay}.${'A'.repeat(43)}`;
    assert.equal(publicRoomServiceTokenSchema.safeParse({ token }).success, true);
    for (const bad of [`${ids.stay}.${'A'.repeat(42)}`, `${ids.stay}${'A'.repeat(44)}`, `x.${'A'.repeat(43)}`, `${ids.stay}.${'A'.repeat(42)}=`]) {
      assert.equal(publicRoomServiceTokenSchema.safeParse({ token: bad }).success, false, bad);
    }
    const many = Array.from({ length: 16 }, (_, index) => ({ menuItemId: ids.item, quantity: 1, note: `n${index}` }));
    assert.equal(publicRoomServiceOrderSchema.safeParse({ requestId: ids.request, outletId: ids.outlet, lines: many }).success, false);
    assert.equal(publicRoomServiceOrderSchema.safeParse({ requestId: ids.request, outletId: ids.outlet, lines: base.lines, covers: 21 }).success, false);
    assert.ok(MAX_GUEST_ACTIVE_ORDERS >= 1);
  });

  it('rapor: iki uç birlikte, en fazla 31 gün, takvimde olmayan gün yok', () => {
    assert.equal(roomServiceReportQuerySchema.safeParse({ from: '2026-10-01' }).success, false);
    assert.equal(roomServiceReportQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success, true);
    assert.equal(roomServiceReportQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-01' }).success, false);
    assert.equal(roomServiceReportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success, false);
  });
});

describe('satış noktası türü ve politika', () => {
  const outlet = { code: 'RS', name: 'Oda servisi' };

  it('yeni nokta varsayılan salon; güncellemede tür verilmezse değişmez', () => {
    assert.equal(createPosOutletSchema.parse(outlet).kind, 'DINING');
    assert.equal(createPosOutletSchema.parse({ ...outlet, kind: 'ROOM_SERVICE' }).kind, 'ROOM_SERVICE');
    assert.equal(updatePosOutletSchema.parse({ ...outlet, expectedUpdatedAt: '2026-10-25T08:00:00Z' }).kind, undefined);
    assert.equal(createPosOutletSchema.safeParse({ ...outlet, kind: 'BAR' }).success, false);
  });

  it('politika: oda servisi alanları isteğe bağlı; sınır dışı reddedilir', () => {
    const base = { adjustmentApprovalAmount: '1000', cashVarianceAlert: '100' };
    const parsed = updatePosSettingsSchema.parse(base);
    assert.equal(parsed.trayCharge, undefined);
    assert.equal(parsed.guestOrderingEnabled, undefined);
    assert.equal(updatePosSettingsSchema.parse({ ...base, trayCharge: '45,5', prepLeadMinutes: '40' }).trayCharge, '45.5');
    assert.equal(updatePosSettingsSchema.safeParse({ ...base, deliveryTargetMinutes: 4 }).success, false);
    assert.equal(updatePosSettingsSchema.safeParse({ ...base, trayAlertMinutes: 1441 }).success, false);
  });

  it('dışa açılanlar index üzerinden erişilir (ad çakışması yok)', () => {
    for (const name of ['roomServiceSchedule', 'ROOM_SERVICE_STATUSES', 'POS_OUTLET_KINDS', 'createRoomServiceOrderSchema', 'ROOM_SERVICE_POLICY_LIMITS']) {
      assert.ok(name in contracts, name);
    }
  });
});
