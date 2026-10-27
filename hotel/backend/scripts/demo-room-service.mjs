import { randomUUID } from 'node:crypto';

/**
 * Oda servisi demo verisi (modül 41): `demo-data.mjs` restoranın demo verisinden sonra çağırır (oda servisi noktası,
 * kahvaltı grubu ve politika `demo-pos.mjs`'te).
 *
 * Kayıtlar **servislerle** üretilir (adisyon, tepsi ücreti, kapı ödemesi, odaya yazma, vardiya kasası gerçek):
 * - Son 7 gün: her gün sipariş alan ve kat servisi vardiyası, teslim edilmiş siparişler (kapıda nakit / kart),
 *   birkaç iptal; zaman damgaları o güne ve gerçekçi sürelere (mutfak 11–24 dk, yol 3–9 dk; birkaçı gecikmeli) taşınır,
 *   tepsilerin çoğu toplanmış.
 * - Bugün: açık vardiyalar; odaya yazılıp folyoya işlenmiş teslimler (biri toplanmamış, süresi geçmiş tepsi), panoda
 *   mutfakta / hazırlanıyor / hazır / yolda siparişler (biri gecikmiş), misafirin QR siparişi (kabul bekliyor),
 *   siparişe çevrilmiş misafir isteği.
 * - Yarın: kahvaltı kartları (07:00–09:00 arası planlı siparişler).
 */

/** Oda servisi personeli (restoran demo vardiyalarıyla birlikte `resetPosDemo` siler). */
export const ROOM_SERVICE_STAFF = Object.freeze({ taker: 'oda.siparis@hotel.local', runner: 'oda.servis@hotel.local' });
const HISTORY_DAYS = 7;
const ORDERS_PER_DAY = 9;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Siparişlerin geldiği saatler (kahvaltı, öğle, akşam, gece). */
const HOURS = Object.freeze([7, 8, 8, 9, 12, 13, 19, 21, 23]);

/**
 * Demo oda servisi verisini siler: demo satış noktasındaki ve demo konaklamalardaki siparişler (adisyonları restoran
 * temizliğinde gider), bağlantılar, siparişe çevrilen demo isteği ve uyarılar. Restoran temizliğinden önce çağrılır
 * (sipariş adisyona, bağlantı konaklamaya bağlı).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} actor
 * @param {string} codePrefix demo rezervasyonlarının onay kodu öneki
 */
export async function resetRoomServiceDemo(tx, hotelId, actor, codePrefix) {
  const outletIds = (await tx.posOutlet.findMany({ where: { hotelId, createdBy: actor }, select: { id: true } })).map((row) => row.id);
  const stayIds = (await tx.reservation.findMany({ where: { hotelId, confirmationCode: { startsWith: codePrefix } }, select: { id: true } })).map((row) => row.id);
  const orders = await tx.roomServiceOrder.findMany({ where: { hotelId, OR: [{ outletId: { in: outletIds } }, { reservationId: { in: stayIds } }] }, select: { id: true, guestRequestId: true } });
  const orderIds = orders.map((row) => row.id);
  await tx.staffAlert.deleteMany({ where: { hotelId, entityType: 'RoomServiceOrder', entityId: { in: orderIds } } });
  await tx.roomServiceOrder.deleteMany({ where: { id: { in: orderIds } } });
  await tx.roomServiceLink.deleteMany({ where: { hotelId, reservationId: { in: stayIds } } });
  await tx.guestRequest.deleteMany({ where: { hotelId, createdBy: actor, category: 'ROOM_SERVICE' } });
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, outletId: string, actor: string }} context
 * @returns {Promise<{ orders: number, open: number, scheduled: number }>}
 */
export async function seedRoomServiceDemo({ prisma, core, contracts, hotelId, outletId, actor }) {
  const rs = await import('../src/modules/pos/room-service.js');
  const guest = await import('../src/modules/pos/room-service-guest.js');
  const shifts = await import('../src/modules/pos/shifts.js');
  const folios = await import('../src/modules/folios/service.js');
  const requests = await import('../src/modules/guest-requests/service.js');
  const read = await import('../src/modules/pos/room-service-read.js');
  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const parse = (schema, input) => contracts[schema].parse(input);
  const { taker, runner } = ROOM_SERVICE_STAFF;
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { timezone: true } });
  const wall = (date) => contracts.utcToZonedWallTime(date, hotel.timezone);

  let seed = 41;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (min, max) => min + Math.floor(rand() * (max - min + 1));

  const stays = await prisma.reservation.findMany({ where: { hotelId, status: 'CHECKED_IN', roomId: { not: null } }, orderBy: { id: 'asc' }, take: 60, select: { id: true, checkOut: true } });
  if (stays.length < 5) return { orders: 0, open: 0, scheduled: 0 };
  const menu = await prisma.menuItem.findMany({
    where: { hotelId, isActive: true, system: null, category: { isActive: true, OR: [{ outletIds: { isEmpty: true } }, { outletIds: { has: outletId } }] } },
    select: { id: true, code: true, soldOut: true, category: { select: { name: true } } },
  });
  const sellable = menu.filter((item) => !item.soldOut);
  const breakfast = sellable.filter((item) => item.category.name === 'Kahvaltı');
  const drinks = sellable.filter((item) => ['CAY', 'TKAHVE', 'LATTE', 'SU', 'PORTAKAL', 'AYRAN', 'KOLA'].includes(item.code));
  const lines = (hour) => {
    const food = hour < 11 ? breakfast : sellable.filter((item) => !breakfast.includes(item) && !drinks.includes(item));
    const picked = new Map();
    for (let index = 0; index < between(1, 3); index += 1) {
      const item = pick(food.length ? food : sellable);
      picked.set(item.id, (picked.get(item.id) ?? 0) + between(1, 2));
    }
    // Kahvaltıda sıcak içecek / portakal suyu; günün geri kalanında herhangi bir içecek.
    const sips = hour < 11 ? drinks.filter((item) => ['CAY', 'TKAHVE', 'PORTAKAL'].includes(item.code)) : drinks;
    if (sips.length && rand() < 0.8) picked.set(pick(sips).id, between(1, 3));
    return [...picked].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
  };
  const create = (input) => as(taker, () => rs.createOrder(hotelId, parse('createRoomServiceOrderSchema', { requestId: randomUUID(), outletId, covers: between(1, 3), ...input })));
  const step = (order, status) => as(runner, () => rs.advanceOrder(hotelId, order.id, parse('advanceRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, status })));
  const deliver = (order, extra = {}) => as(runner, () => rs.deliverOrder(hotelId, order.id, parse('deliverRoomServiceOrderSchema', { requestId: randomUUID(), expectedUpdatedAt: order.updatedAt, ...extra })));
  const openShift = (email, openingFloat) => as(email, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat, outletId })));
  let created = 0;

  /* ── Geçmiş: kapıda ödenmiş teslimler, birkaç iptal; zamanları o güne ── */
  for (let offset = HISTORY_DAYS; offset >= 1; offset -= 1) {
    const shiftIds = [(await openShift(taker, '0')).id, (await openShift(runner, '300')).id];
    const placed = [];
    for (let index = 0; index < ORDERS_PER_DAY; index += 1) {
      const hour = HOURS[index];
      let order = await create({ reservationId: pick(stays).id, lines: lines(hour), trayExpected: rand() < 0.9 });
      if (index === 4 && offset % 3 === 0) {
        await as(taker, () => rs.cancelOrder(hotelId, order.id, parse('cancelRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, reason: 'Misafir vazgeçti' }), { canSupervise: false }));
        placed.push({ id: order.id, hour, cancelled: true });
        continue;
      }
      order = await step(order, 'PREPARING');
      order = await step(order, 'READY');
      order = await step(order, 'ON_THE_WAY');
      const view = await as(runner, () => read.getOrder(hotelId, order.id));
      const method = rand() < 0.6 ? 'CARD' : 'CASH';
      await deliver(view, { payments: [{ method, amount: view.check.balance, ...(method === 'CARD' ? { reference: `SLIP-${between(100000, 999999)}` } : {}) }], chargeRemainder: false });
      placed.push({ id: order.id, hour, cancelled: false, tray: order.trayExpected });
    }
    for (const [index, shiftId] of shiftIds.entries()) {
      const email = index ? runner : taker;
      const view = await as(email, () => shifts.getShift(hotelId, shiftId, { canSeeAll: true }));
      await as(email, () => shifts.closeShift(hotelId, shiftId, parse('closePosShiftSchema', { expectedUpdatedAt: view.updatedAt, countedCash: view.cash.expectedCash, note: null }), { canSupervise: false }));
    }
    // Zamanlar o güne ve gerçekçi sürelere: sipariş → mutfak → hazır → yol → teslim → tepsi.
    const now = Date.now();
    await prisma.$executeRaw`UPDATE "PosShift" SET "openedAt" = "openedAt" - (${offset * DAY_MS} * INTERVAL '1 millisecond'), "closedAt" = "closedAt" - (${offset * DAY_MS} * INTERVAL '1 millisecond') WHERE "id" = ANY(${shiftIds}::text[])`;
    for (const entry of placed) {
      const day = new Date(now - offset * DAY_MS);
      const createdAt = new Date(Date.parse(`${wall(day).slice(0, 10)}T00:00:00Z`) + (entry.hour - 3) * 3_600_000 + between(0, 50) * MINUTE_MS);
      const at = (minutes) => new Date(createdAt.getTime() + minutes * MINUTE_MS);
      const prep = between(3, 6);
      // Toplam 15–37 dk: çoğu 30 dk hedefin içinde, birkaçı gecikmeli.
      const ready = prep + between(8, 18);
      const out = ready + between(1, 4);
      const done = out + between(3, 9);
      const tray = done + between(40, 160);
      if (entry.cancelled) {
        await prisma.roomServiceOrder.update({ where: { id: entry.id }, data: { createdAt, receivedAt: createdAt, dueAt: at(30), cancelledAt: at(8) } });
      } else {
        await prisma.roomServiceOrder.update({
          where: { id: entry.id },
          data: { createdAt, receivedAt: createdAt, dueAt: at(30), preparingAt: at(prep), readyAt: at(ready), dispatchedAt: at(out), deliveredAt: at(done), ...(entry.tray && rand() < 0.95 ? { trayCollectedAt: at(tray), trayCollectedBy: runner } : {}) },
        });
      }
      const order = await prisma.roomServiceOrder.findFirst({ where: { id: entry.id }, select: { checkId: true } });
      await prisma.$executeRaw`UPDATE "PosCheck" SET "openedAt" = ${createdAt}, "closedAt" = ${at(done)}, "businessDate" = ${wall(day).slice(0, 10)}::date WHERE "id" = ${order.checkId}`;
      await prisma.$executeRaw`UPDATE "PosOrder" SET "sentAt" = ${createdAt} WHERE "checkId" = ${order.checkId}`;
      await prisma.$executeRaw`UPDATE "PosOrderLine" SET "businessDate" = ${wall(day).slice(0, 10)}::date WHERE "checkId" = ${order.checkId} AND "businessDate" IS NOT NULL`;
      await prisma.$executeRaw`UPDATE "PosPayment" SET "receivedAt" = ${at(done)}, "postedAt" = ${at(done)}, "businessDate" = ${wall(day).slice(0, 10)}::date WHERE "checkId" = ${order.checkId}`;
      await prisma.$executeRaw`UPDATE "PosAdjustment" SET "requestedAt" = ${at(8)} WHERE "checkId" = ${order.checkId}`;
    }
    await prisma.$executeRaw`UPDATE "PosShift" SET "businessDate" = ${wall(new Date(now - offset * DAY_MS)).slice(0, 10)}::date WHERE "id" = ANY(${shiftIds}::text[])`;
    created += placed.length;
  }
  // Geçmiş uyarıları (gecikme / tepsi) demo için önemsiz: zamanlayıcı bir kez yazar, burada işaretlenir.
  await prisma.$executeRaw`UPDATE "RoomServiceOrder" SET "lateAlertedAt" = "deliveredAt", "trayAlertedAt" = "deliveredAt" WHERE "hotelId" = ${hotelId} AND "status" = 'DELIVERED'`;

  /* ── Bugün ── */
  await openShift(taker, '0');
  await openShift(runner, '300');
  // Odaya yazılıp folyoya işlenen teslimler (biri toplanmamış, süresi geçmiş tepsi).
  const delivered = [];
  for (let index = 0; index < 5; index += 1) {
    let order = await create({ reservationId: stays[index].id, lines: lines(8 + index) });
    order = await step(order, 'READY');
    order = await step(order, 'ON_THE_WAY');
    const done = await deliver(order);
    const event = await prisma.eventLog.findFirst({ where: { hotelId, name: 'fnb.order.charged', payload: { path: ['reference'], equals: done.check.number } }, orderBy: { occurredAt: 'desc' } });
    try {
      if (event) await as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source: 'FNB_ORDER', eventId: event.id }));
    } catch (error) {
      console.error(`Oda servisi folyoya işlenemedi: ${error.message}`);
    }
    delivered.push(done);
    created += 1;
  }
  const back = (minutes) => new Date(Date.now() - minutes * MINUTE_MS);
  for (const [index, order] of delivered.entries()) {
    const minutes = [300, 240, 200, 150, 120][index];
    await prisma.roomServiceOrder.update({
      where: { id: order.id },
      // 26 dakikada teslim (hedef 30): sabah teslimleri zamanında.
      data: { createdAt: back(minutes + 26), receivedAt: back(minutes + 26), dueAt: back(minutes - 4), readyAt: back(minutes + 9), dispatchedAt: back(minutes + 6), deliveredAt: back(minutes), trayCollectedAt: index < 3 ? back(minutes - 60) : null, trayCollectedBy: index < 3 ? runner : null },
    });
  }

  // Pano: mutfakta, hazırlanıyor, hazır, yolda (biri gecikmiş).
  const open = [];
  const board = [
    [stays[5], null],
    [stays[6], 'PREPARING'],
    [stays[7], 'READY'],
    [stays[8], 'ON_THE_WAY'],
  ];
  for (const [stay, status] of board) {
    let order = await create({ reservationId: stay.id, lines: lines(13), note: rand() < 0.5 ? 'Kapıyı çalmadan bırakın' : null });
    if (status === 'PREPARING' || status === 'READY' || status === 'ON_THE_WAY') order = await step(order, 'PREPARING');
    if (status === 'READY' || status === 'ON_THE_WAY') order = await step(order, 'READY');
    if (status === 'ON_THE_WAY') order = await step(order, 'ON_THE_WAY');
    open.push(order);
    created += 1;
  }
  await prisma.roomServiceOrder.update({ where: { id: open[1].id }, data: { createdAt: back(42), receivedAt: back(42), preparingAt: back(35), dueAt: back(12) } });

  // Misafir isteği siparişe çevrildi.
  const asked = await as(actor, () => requests.createRequest(hotelId, parse('createGuestRequestSchema', { category: 'ROOM_SERVICE', title: 'İki çay ve simit tabağı', reservationId: stays[9].id, source: 'PHONE' })));
  const simit = breakfast.find((item) => item.code === 'SIMIT') ?? pick(sellable);
  const cay = drinks.find((item) => item.code === 'CAY') ?? pick(sellable);
  open.push(await create({ reservationId: stays[9].id, guestRequestId: asked.id, lines: [{ menuItemId: simit.id, quantity: 1 }, { menuItemId: cay.id, quantity: 2 }] }));
  created += 1;

  // Misafirin QR bağlantısı ve kabul bekleyen siparişi.
  const link = await as(actor, () => guest.issueLink(hotelId, stays[10].id));
  if (link.link) {
    // Misafir ucu bağlam içinde çağrılır: işlem kaydına "misafir · oda …" yazılır (HTTP'deki gibi).
    await as('anonim', () => guest.publicCreateOrder(link.link.token, parse('publicRoomServiceOrderSchema', { requestId: randomUUID(), outletId, lines: lines(14), note: 'Ekstra peçete lütfen' })));
    created += 1;
  }
  await as(actor, () => guest.issueLink(hotelId, stays[11].id));

  /* ── Yarın: kahvaltı kartları ── */
  const tomorrow = wall(new Date(Date.now() + DAY_MS)).slice(0, 10);
  let scheduled = 0;
  for (const stay of stays.slice(12)) {
    if (scheduled >= 8) break;
    if (core.toIsoDay(stay.checkOut) < tomorrow) continue;
    const time = pick(['07:00', '07:15', '07:30', '07:45', '08:00', '08:30', '09:00']);
    await create({ reservationId: stay.id, deliverAt: `${tomorrow}T${time}`, lines: lines(8), covers: between(1, 2) });
    scheduled += 1;
    created += 1;
  }

  return { orders: created, open: open.length + 1, scheduled };
}
