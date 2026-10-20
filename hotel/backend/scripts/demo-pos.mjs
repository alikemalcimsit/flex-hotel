import { randomUUID } from 'node:crypto';

/**
 * Restoran POS demo verisi (modül 39): `demo-data.mjs` çağırır.
 *
 * Kayıtlar **servislerle** üretilir (toplamlar, vergi, vardiya kasası, onaylar gerçek):
 * üç satış noktası (ana restoran + teras, lobi bar, odaya yazmaya kapalı havuz bar), masalar,
 * menü (gruplar satış noktasına göre; tütün yalnızca barda), son 7 günün vardiyaları ve
 * kapanmış adisyonları (nakit / kart / bölüşmeli ödeme, ikram, zayi iptal, indirim; biri eşik
 * üstü kasa farkıyla), bugün açık vardiyalar ve masalar (hesap isteyen, masasız), onay bekleyen
 * iptal, odaya yazılıp folyoya işlenen adisyon ve tükenen ürün.
 *
 * Geçmiş gün servis kuralı gereği "bugün" açılıp kapanır, sonra zaman damgaları aynı kaymayla
 * o güne taşınır (iş günü, açılış / kapanış, ödeme anı).
 */

const SETTINGS = Object.freeze({ adjustmentApprovalAmount: '1500', cashVarianceAlert: '200' });

const WAITERS = Object.freeze({ ali: 'garson.ali@hotel.local', ayse: 'garson.ayse@hotel.local', can: 'barmen.can@hotel.local' });

const OUTLETS = Object.freeze([
  { code: 'ANA', name: 'Ana Restoran', allowRoomCharge: true, sortOrder: 1 },
  { code: 'LOBI', name: 'Lobi Bar', allowRoomCharge: true, sortOrder: 2 },
  { code: 'HAVUZ', name: 'Havuz Bar', allowRoomCharge: false, sortOrder: 3 },
]);

const TABLES = Object.freeze([
  { outlet: 'ANA', prefix: '', from: 1, to: 24, seats: 4, zone: 'İç salon' },
  { outlet: 'ANA', prefix: 'T', from: 1, to: 12, seats: 4, zone: 'Teras' },
  { outlet: 'LOBI', prefix: 'L', from: 1, to: 10, seats: 2, zone: 'Lobi' },
  { outlet: 'HAVUZ', prefix: 'H', from: 1, to: 8, seats: 4, zone: 'Havuz başı' },
]);

/** Grup → satış noktaları (boş: her yer) ve ürünler [kod, ad, fiyat, istasyon, vergi]. */
const MENU = Object.freeze([
  {
    name: 'Başlangıçlar',
    outlets: ['ANA'],
    items: [
      ['MERCI', 'Mercimek çorbası', '180', 'HOT'],
      ['HUMUS', 'Humus', '210', 'COLD'],
      ['SIGARA', 'Sigara böreği', '240', 'HOT'],
      ['COBAN', 'Çoban salata', '220', 'COLD'],
      ['ACILI', 'Acılı ezme', '190', 'COLD'],
    ],
  },
  {
    name: 'Ana yemekler',
    outlets: ['ANA'],
    items: [
      ['KOFTE', 'Izgara köfte', '480', 'HOT'],
      ['ADANA', 'Adana kebap', '560', 'HOT'],
      ['LEVREK', 'Izgara levrek', '720', 'HOT'],
      ['MANTI', 'Kayseri mantısı', '420', 'HOT'],
      ['BONFILE', 'Bonfile', '980', 'HOT'],
      ['RISOTTO', 'Mantarlı risotto', '460', 'HOT'],
    ],
  },
  {
    name: 'Atıştırmalık',
    outlets: [],
    items: [
      ['KULUP', 'Kulüp sandviç', '360', 'HOT'],
      ['PATATES', 'Patates kızartması', '180', 'HOT'],
      ['CEREZ', 'Karışık kuruyemiş', '220', 'NONE'],
    ],
  },
  {
    name: 'Tatlılar',
    outlets: ['ANA', 'LOBI'],
    items: [
      ['KUNEFE', 'Künefe', '320', 'PASTRY'],
      ['SUTLAC', 'Fırın sütlaç', '210', 'PASTRY'],
      ['SUFLE', 'Çikolatalı sufle', '280', 'PASTRY'],
    ],
  },
  {
    name: 'Sıcak içecekler',
    outlets: ['ANA', 'LOBI'],
    items: [
      ['CAY', 'Çay', '60', 'BAR'],
      ['TKAHVE', 'Türk kahvesi', '110', 'BAR'],
      ['LATTE', 'Latte', '150', 'BAR'],
    ],
  },
  {
    name: 'Soğuk içecekler',
    outlets: [],
    items: [
      ['SU', 'Su 0,5 L', '50', 'BAR'],
      ['AYRAN', 'Ayran', '80', 'BAR'],
      ['LIMON', 'Ev yapımı limonata', '140', 'BAR'],
      ['KOLA', 'Kola', '110', 'BAR'],
    ],
  },
  {
    name: 'Alkollü içecekler',
    outlets: [],
    items: [
      ['BIRA', 'Fıçı bira 50 cl', '220', 'BAR'],
      ['SARAP', 'Kadeh şarap', '340', 'BAR'],
      ['RAKI', 'Rakı (tek)', '300', 'BAR'],
    ],
  },
  {
    name: 'Kokteyller',
    outlets: ['LOBI', 'HAVUZ'],
    items: [
      ['MOJITO', 'Mojito', '420', 'BAR'],
      ['SPRITZ', 'Aperol spritz', '440', 'BAR'],
    ],
  },
  { name: 'Tütün', outlets: ['LOBI'], items: [['PURO', 'Puro', '900', 'NONE', 'OTHER']] },
  { name: 'Butik', outlets: [], items: [['LOKUM', 'Hediyelik lokum kutusu', '350', 'NONE', 'OTHER']] },
]);

/** Geçmiş günde satış noktası başına adisyon sayısı (öğle + akşam). */
const HISTORY_DAYS = 7;
const CHECKS_PER_DAY = Object.freeze({ ANA: 14, LOBI: 7, HAVUZ: 4 });

/**
 * Demo POS verisini siler (`--reset`): demo satış noktalarının bütün adisyonları (ödemeler,
 * iptal kayıtları, odaya yazılanlar, düzeltmeler, kalemler, turlar), bunlara bağlı onay
 * istekleri ve uyarılar; demo garsonlarının vardiyaları (personelin vardiyası kalır, demo noktaya bağı
 * kalkar); masalar, menü, satış noktaları.
 * Odaya yazılanın folyo kalemi rezervasyonla birlikte silinir (çağıran sonra rezervasyonları siler).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} actor
 */
export async function resetPosDemo(tx, hotelId, actor) {
  const outletIds = (await tx.posOutlet.findMany({ where: { hotelId, createdBy: actor }, select: { id: true } })).map((row) => row.id);
  const checkIds = (await tx.posCheck.findMany({ where: { hotelId, outletId: { in: outletIds } }, select: { id: true } })).map((row) => row.id);
  const paymentIds = (await tx.posPayment.findMany({ where: { checkId: { in: checkIds } }, select: { id: true } })).map((row) => row.id);
  const adjustmentIds = (await tx.posAdjustment.findMany({ where: { checkId: { in: checkIds } }, select: { id: true } })).map((row) => row.id);
  const approvalIds = (
    await tx.approval.findMany({ where: { hotelId, entityType: { in: ['PosPayment', 'PosAdjustment'] }, entityId: { in: [...paymentIds, ...adjustmentIds] } }, select: { id: true } })
  ).map((row) => row.id);
  // İptal kaydı asıl satıra bağlı: önce iptaller.
  await tx.posPayment.deleteMany({ where: { checkId: { in: checkIds }, reversalOfId: { not: null } } });
  await tx.posPayment.deleteMany({ where: { checkId: { in: checkIds } } });
  await tx.posAdjustment.deleteMany({ where: { checkId: { in: checkIds } } });
  await tx.posRoomCharge.deleteMany({ where: { checkId: { in: checkIds } } });
  await tx.posOrderLine.deleteMany({ where: { checkId: { in: checkIds } } });
  await tx.posOrder.deleteMany({ where: { checkId: { in: checkIds } } });
  // Bölünen adisyon kaynağına bağlı: önce bölünenler.
  await tx.posCheck.deleteMany({ where: { id: { in: checkIds }, splitFromId: { not: null } } });
  await tx.posCheck.deleteMany({ where: { id: { in: checkIds } } });
  await tx.pendingAction.deleteMany({ where: { approvalId: { in: approvalIds } } });
  await tx.approval.deleteMany({ where: { id: { in: approvalIds } } });
  const shiftIds = (await tx.posShift.findMany({ where: { hotelId, waiterEmail: { in: Object.values(WAITERS) } }, select: { id: true } })).map((row) => row.id);
  await tx.posShift.deleteMany({ where: { id: { in: shiftIds }, checks: { none: {} }, payments: { none: {} } } });
  // Personelin demo satış noktasında açtığı vardiya korunur; yalnızca noktaya bağı kalkar (nokta silinecek).
  await tx.posShift.updateMany({ where: { hotelId, outletId: { in: outletIds } }, data: { outletId: null } });
  await tx.staffAlert.deleteMany({ where: { hotelId, entityId: { in: [...checkIds, ...paymentIds, ...adjustmentIds, ...approvalIds, ...shiftIds] } } });
  await tx.menuItem.deleteMany({ where: { hotelId, createdBy: actor } });
  await tx.menuCategory.deleteMany({ where: { hotelId, createdBy: actor } });
  await tx.posTable.deleteMany({ where: { hotelId, outletId: { in: outletIds } } });
  await tx.posOutlet.deleteMany({ where: { id: { in: outletIds } } });
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string, approver: string, addDays: (iso: string, n: number) => string }} context
 * @returns {Promise<{ outlets: number, items: number, checks: number, shifts: number }>}
 */
export async function seedPosDemo({ prisma, core, contracts, hotelId, today, actor, approver, addDays }) {
  const setup = await import('../src/modules/pos/setup.js');
  const checks = await import('../src/modules/pos/checks.js');
  const payments = await import('../src/modules/pos/payments.js');
  const shifts = await import('../src/modules/pos/shifts.js');
  const approvals = await import('../src/modules/approvals/service.js');
  const folios = await import('../src/modules/folios/service.js');
  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const parse = (schema, input) => contracts[schema].parse(input);

  // Sabit tohumlu rastgele: aynı çalıştırma aynı veriyi üretir.
  let seed = 39;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  /* ── Tanımlar ── */
  const outlets = {};
  const items = [];
  await as(actor, async () => {
    const current = await setup.getSettings(hotelId);
    await setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { ...SETTINGS, expectedUpdatedAt: current.updatedAt }));
    for (const outlet of OUTLETS) outlets[outlet.code] = await setup.createOutlet(hotelId, parse('createPosOutletSchema', outlet));
    for (const block of TABLES) await setup.createTablesBulk(hotelId, parse('bulkPosTablesSchema', { ...block, outletId: outlets[block.outlet].id }));
    let order = 0;
    for (const group of MENU) {
      const category = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: group.name, sortOrder: (order += 1), outletIds: group.outlets.map((code) => outlets[code].id) }));
      let sort = 0;
      for (const [code, name, price, station, taxCategory = 'FNB'] of group.items) {
        const item = await setup.createItem(hotelId, parse('createMenuItemSchema', { categoryId: category.id, code, name, price, station, taxCategory, sortOrder: (sort += 1) }));
        items.push({ ...item, outlets: group.outlets });
      }
    }
  });
  const sellable = (code) => items.filter((item) => item.outlets.length === 0 || item.outlets.includes(code));
  const tables = await prisma.posTable.findMany({ where: { hotelId, outletId: { in: Object.values(outlets).map((row) => row.id) } }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, outletId: true } });
  const tablesOf = (code) => tables.filter((table) => table.outletId === outlets[code].id);
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { largePaymentThreshold: true } });
  const threshold = Number(hotel.largePaymentThreshold ?? 0);

  /** Adisyon aç + 1–2 tur sipariş; kimliğini döner. */
  async function serve(waiter, code, table, covers) {
    const check = await as(waiter, () => checks.openCheck(hotelId, parse('openPosCheckSchema', { requestId: randomUUID(), outletId: outlets[code].id, tableId: table?.id ?? null, covers })));
    const rounds = 1 + Math.floor(rand() * 2);
    for (let round = 0; round < rounds; round += 1) {
      const menu = sellable(code);
      const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({ menuItemId: pick(menu).id, quantity: 1 + Math.floor(rand() * Math.min(3, covers)) }));
      await as(waiter, () => checks.sendOrder(hotelId, check.id, parse('sendPosOrderSchema', { requestId: randomUUID(), lines })));
    }
    return check.id;
  }

  /** Kalanı nakit / kart / ikiye bölünmüş alır (büyük ödeme eşiğinin altında kalacak şekilde). */
  async function settle(waiter, checkId) {
    const check = await as(waiter, () => checks.getCheck(hotelId, checkId));
    const balance = Number(check.balance);
    // Tamamı ikram / iptal edilen adisyonun ödenecek tutarı yok: "Kapat" ile kapanır.
    if (balance <= 0) {
      if (check.status === 'OPEN') await as(waiter, () => checks.closeCheck(hotelId, checkId, { expectedUpdatedAt: new Date(check.updatedAt) }));
      return;
    }
    const pay = (method, amount) =>
      as(waiter, () => payments.receivePayment(hotelId, checkId, parse('posPaymentSchema', { requestId: randomUUID(), method, amount: amount.toFixed(2), ...(method === 'CARD' ? { reference: `SLIP-${Math.floor(rand() * 900_000) + 100_000}` } : {}) })));
    if (threshold > 0 && balance >= threshold) {
      // Eşiğin altında parçalarla (her parça onaysız işlenir).
      let left = Math.round(balance * 100);
      const chunk = Math.round(threshold * 100) - 1;
      while (left > 0) {
        const part = Math.min(left, chunk);
        await pay('CARD', part / 100);
        left -= part;
      }
      return;
    }
    const roll = rand();
    if (roll < 0.25 && balance > 200) {
      const half = Math.round((balance / 2) * 100) / 100;
      await pay('CASH', half);
      await pay('CARD', Math.round((balance - half) * 100) / 100);
    } else await pay(roll < 0.6 ? 'CARD' : 'CASH', balance);
  }

  /** Bazı adisyonlara ikram / zayi iptal / indirim (eşik altı, hemen uygulanır). */
  async function adjustSome(checkId) {
    const roll = rand();
    if (roll > 0.25) return;
    const check = await as(actor, () => checks.getCheck(hotelId, checkId));
    const line = check.lines.find((entry) => entry.freeQuantity > 0 && Number(entry.unitPrice) < Number(SETTINGS.adjustmentApprovalAmount));
    if (!line) return;
    if (roll < 0.1) await as(actor, () => checks.requestAdjustment(hotelId, checkId, parse('posAdjustmentSchema', { kind: 'COMP', lineId: line.id, quantity: 1, reason: pick(['Geç servis', 'Misafir memnuniyeti', 'Doğum günü']) })));
    else if (roll < 0.17) await as(actor, () => checks.requestAdjustment(hotelId, checkId, parse('posAdjustmentSchema', { kind: 'VOID', lineId: line.id, quantity: 1, waste: true, reason: 'Mutfakta hazırlandı, misafir vazgeçti' })));
    else await as(actor, () => checks.requestAdjustment(hotelId, checkId, parse('posAdjustmentSchema', { kind: 'DISCOUNT', discountPct: pick(['10', '15']), reason: 'Sadakat kartı' })));
  }

  /* ── Geçmiş: her gün vardiyalar ve kapanmış adisyonlar; sonra o güne taşınır ── */
  let created = 0;
  for (let offset = HISTORY_DAYS; offset >= 1; offset -= 1) {
    const day = addDays(today, -offset);
    const crew = [
      { waiter: WAITERS.ali, code: 'ANA', float: '500' },
      { waiter: WAITERS.ayse, code: 'ANA', float: '500' },
      { waiter: WAITERS.can, code: 'LOBI', float: '300' },
    ];
    const shiftIds = [];
    for (const member of crew) shiftIds.push((await as(member.waiter, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat: member.float, outletId: outlets[member.code].id })))).id);
    const dayChecks = [];
    for (const [code, count] of Object.entries(CHECKS_PER_DAY)) {
      const pool = tablesOf(code);
      for (let index = 0; index < count; index += 1) {
        const waiter = code === 'ANA' ? (index % 2 ? WAITERS.ali : WAITERS.ayse) : WAITERS.can;
        const checkId = await serve(waiter, code, pool[index % pool.length], 1 + Math.floor(rand() * 4));
        await adjustSome(checkId);
        await settle(waiter, checkId);
        dayChecks.push(checkId);
      }
    }
    for (const [index, shiftId] of shiftIds.entries()) {
      const view = await as(crew[index].waiter, () => shifts.getShift(hotelId, shiftId, { canSeeAll: true }));
      // Bir gün Ayşe'nin kasası 250 TL açık verir (eşik 200: uyarı düşer).
      const short = offset === 2 && crew[index].waiter === WAITERS.ayse ? 250 : Math.round(rand() * 3) * 10 * (rand() < 0.5 ? -1 : 0);
      const countedCash = Math.max(0, Number(view.cash.expectedCash) - short).toFixed(2);
      await as(crew[index].waiter, () => shifts.closeShift(hotelId, shiftId, parse('closePosShiftSchema', { expectedUpdatedAt: view.updatedAt, countedCash, note: short ? 'Sayımda eksik çıktı' : null }), { canSupervise: false }));
    }
    // Zaman damgaları o güne: öğle (12–15) ve akşam (19–23) servisine yayılır.
    const shiftMs = offset * 86_400_000;
    await prisma.$executeRaw`UPDATE "PosShift" SET "openedAt" = "openedAt" - (${shiftMs} * INTERVAL '1 millisecond'), "closedAt" = "closedAt" - (${shiftMs} * INTERVAL '1 millisecond'), "businessDate" = ${day}::date WHERE "id" = ANY(${shiftIds}::text[])`;
    for (const [index, checkId] of dayChecks.entries()) {
      const hour = index % 2 ? 19 + Math.floor(rand() * 4) : 12 + Math.floor(rand() * 3);
      const opened = `${day}T${String(hour - 3).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00Z`;
      await prisma.$executeRaw`UPDATE "PosCheck" SET "openedAt" = ${opened}::timestamptz, "closedAt" = ${opened}::timestamptz + INTERVAL '75 minutes', "businessDate" = ${day}::date WHERE "id" = ${checkId}`;
      await prisma.$executeRaw`UPDATE "PosOrder" SET "sentAt" = ${opened}::timestamptz + INTERVAL '5 minutes' WHERE "checkId" = ${checkId}`;
      await prisma.$executeRaw`UPDATE "PosOrderLine" SET "businessDate" = ${day}::date WHERE "checkId" = ${checkId} AND "businessDate" IS NOT NULL`;
      await prisma.$executeRaw`UPDATE "PosAdjustment" SET "requestedAt" = ${opened}::timestamptz + INTERVAL '40 minutes', "decidedAt" = CASE WHEN "decidedAt" IS NULL THEN NULL ELSE ${opened}::timestamptz + INTERVAL '41 minutes' END WHERE "checkId" = ${checkId}`;
      await prisma.$executeRaw`UPDATE "PosPayment" SET "receivedAt" = ${opened}::timestamptz + INTERVAL '74 minutes', "postedAt" = ${opened}::timestamptz + INTERVAL '74 minutes', "businessDate" = ${day}::date WHERE "checkId" = ${checkId}`;
    }
    created += dayChecks.length;
  }

  /* ── Bugün: açık vardiyalar, kapanmış ve açık adisyonlar ── */
  for (const [waiter, code, float] of [
    [WAITERS.ali, 'ANA', '500'],
    [WAITERS.ayse, 'ANA', '500'],
    [WAITERS.can, 'LOBI', '300'],
  ]) {
    await as(waiter, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat: float, outletId: outlets[code].id })));
  }
  const ana = tablesOf('ANA');
  const lobi = tablesOf('LOBI');
  // Öğle servisi kapandı.
  for (let index = 0; index < 8; index += 1) {
    const waiter = index % 2 ? WAITERS.ali : WAITERS.ayse;
    const checkId = await serve(waiter, 'ANA', ana[12 + index], 2 + Math.floor(rand() * 3));
    await adjustSome(checkId);
    await settle(waiter, checkId);
    created += 1;
  }
  // Akşam: açık masalar (biri hesap istiyor), barda masasız adisyon.
  const open = [];
  for (const [waiter, code, table] of [
    [WAITERS.ali, 'ANA', ana[2]],
    [WAITERS.ali, 'ANA', ana[4]],
    [WAITERS.ayse, 'ANA', ana[6]],
    [WAITERS.ayse, 'ANA', ana[24]],
    [WAITERS.can, 'LOBI', lobi[1]],
    [WAITERS.can, 'LOBI', null],
  ]) {
    open.push({ waiter, id: await serve(waiter, code, table, 2 + Math.floor(rand() * 3)) });
  }
  created += open.length;
  await as(WAITERS.ali, () => checks.requestBill(hotelId, open[1].id, { requested: true }));
  // Onay bekleyen iptal: 4 bonfile (3920 ≥ 1500) şef garsondan.
  const bonfile = items.find((item) => item.code === 'BONFILE');
  await as(WAITERS.ayse, () => checks.sendOrder(hotelId, open[2].id, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [{ menuItemId: bonfile.id, quantity: 4, note: 'Orta pişmiş' }] })));
  const withBonfile = await as(actor, () => checks.getCheck(hotelId, open[2].id));
  const bonfileLine = withBonfile.lines.find((line) => line.menuItemId === bonfile.id);
  await as(actor, () => checks.requestAdjustment(hotelId, open[2].id, parse('posAdjustmentSchema', { kind: 'VOID', lineId: bonfileLine.id, quantity: 4, waste: false, reason: 'Yanlış masaya girildi' })));

  // Odaya yaz: içerideki bir demo misafirin adisyonu folyoya işlenir (aktör bu süreçte çalışmaz).
  const stay = await prisma.reservation.findFirst({ where: { hotelId, status: 'CHECKED_IN', roomId: { not: null } }, orderBy: { checkIn: 'desc' }, select: { id: true } });
  if (stay) {
    const checkId = await serve(WAITERS.ali, 'ANA', ana[8], 2);
    const check = await as(WAITERS.ali, () => checks.getCheck(hotelId, checkId));
    await as(WAITERS.ali, () => payments.chargeToRoom(hotelId, checkId, parse('posRoomChargeSchema', { requestId: randomUUID(), reservationId: stay.id, amount: check.balance })));
    const event = await prisma.eventLog.findFirst({ where: { hotelId, name: 'fnb.order.charged' }, orderBy: { occurredAt: 'desc' } });
    try {
      if (event) await as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source: 'FNB_ORDER', eventId: event.id }));
    } catch (error) {
      // Folyo kapalıysa iş "Folyo" görevine düşer gibi kalır: adisyon yine odaya yazılmıştır.
      console.error(`Odaya yazılan adisyon folyoya işlenemedi: ${error.message}`);
    }
    created += 1;
  }

  // Künefe bitti.
  const kunefe = items.find((item) => item.code === 'KUNEFE');
  await as(actor, () => setup.setSoldOut(hotelId, kunefe.id, { soldOut: true }));
  // Onaylayan, örnek olarak bir eşik üstü ikramı onaylar (geçmişteki uygulanmış dört göz).
  const lunch = await prisma.posCheck.findFirst({ where: { hotelId, outletId: outlets.ANA.id, status: 'OPEN' }, orderBy: { openedAt: 'asc' }, select: { id: true } });
  if (lunch && approver) {
    const view = await as(actor, () => checks.getCheck(hotelId, lunch.id));
    const line = view.lines.find((entry) => entry.freeQuantity >= 1 && Number(entry.unitPrice) * entry.freeQuantity >= Number(SETTINGS.adjustmentApprovalAmount));
    if (line) {
      const result = await as(actor, () =>
        checks.requestAdjustment(hotelId, lunch.id, parse('posAdjustmentSchema', { kind: 'COMP', lineId: line.id, quantity: line.freeQuantity, reason: 'Kurumsal misafir ikramı' })),
      );
      const pending = result.adjustments.find((entry) => entry.status === 'PENDING');
      if (pending) await as(approver, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED', { note: 'Uygun' }));
    }
  }

  return {
    outlets: OUTLETS.length,
    items: items.length,
    checks: created,
    shifts: await prisma.posShift.count({ where: { hotelId, waiterEmail: { in: Object.values(WAITERS) } } }),
  };
}
