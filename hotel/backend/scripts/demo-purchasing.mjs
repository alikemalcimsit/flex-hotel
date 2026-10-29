import { randomUUID } from 'node:crypto';

/**
 * Satın alma ve stok demo verisi (modül 45). `demo-data.mjs` banket F&B demosundan (43) sonra çağırır:
 * 43'ün malzeme kartlarını ve banket taleplerini kullanır.
 *
 * Kurulan hikâye (hepsi gerçek servislerden — kilit, sayı, olay ve denetim izi dahil):
 * - Politika: KDV dahil 25.000 TRY ve üstü sipariş onaya gider; tekliflerde varsayılan KDV %10.
 * - Depolar: ana depo (varsayılan), soğuk oda, kuru gıda deposu, bar deposu.
 * - Tedarikçiler: et kombinası, hal, deniz ürünleri, süt ürünleri, kuru gıda toptancısı, içecek
 *   dağıtımı, her gruba hızlı ama biraz pahalı teslim eden toptan market; bir pasif tedarikçi.
 * - Tur 1 (yarınki ödül gecesi, ihtiyacı ≤ yarın): teklifler → satır bazında kazanan (bir satır
 *   gerekçeyle hızlı teslimden) → siparişler: eşik üstü et siparişi onay bekliyor; diğerleri teslim
 *   alındı (biri eksik kapatıldı, biri kısmen teslim). Stok soğuk oda / kuru gıda / ana depoya girdi.
 * - Tur 2 (düğün, ihtiyacı 2+ gün): dört tedarikçinin teklifi girildi (biri ucuz ama ihtiyaçtan geç
 *   teslim), kazanan seçilmedi — demo sırasında karşılaştırma ekranından canlı seçilir.
 * - Tereyağı ikinci kez başka fiyatla alındı: hareketli ortalama maliyet görünür.
 * - Bar talebi açık satırlarda bekliyor; minimum seviyeler: birkaçı altında (öneriler dolu).
 */

const SUPPLIERS = Object.freeze([
  { code: 'KSP', name: 'Başkent Et Kombinası', contactName: 'Mustafa Kaya', phone: '+903124440101', taxNumber: '1111111101', taxOffice: 'Ulus', paymentTermDays: 30, leadTimeDays: 1, groups: ['MEAT', 'POULTRY'] },
  { code: 'HAL', name: 'Ankara Hal Sebze Meyve', contactName: 'Hasan Yıldız', phone: '+903124440202', taxNumber: '1111111102', taxOffice: 'Yenimahalle', paymentTermDays: 7, leadTimeDays: 0, groups: ['PRODUCE'] },
  { code: 'DNZ', name: 'Ege Deniz Ürünleri', contactName: 'Deniz Akın', phone: '+902324440303', taxNumber: '1111111103', taxOffice: 'Karşıyaka', paymentTermDays: 15, leadTimeDays: 1, groups: ['SEAFOOD'] },
  { code: 'SUT', name: 'Anadolu Süt Ürünleri', contactName: 'Zeynep Arslan', phone: '+903124440404', taxNumber: '1111111104', taxOffice: 'Çankaya', paymentTermDays: 21, leadTimeDays: 1, groups: ['DAIRY'] },
  { code: 'KRG', name: 'Kuru Gıda Toptan A.Ş.', contactName: 'Ali Demir', phone: '+903124440505', taxNumber: '1111111105', taxOffice: 'Ostim', paymentTermDays: 45, leadTimeDays: 2, groups: ['DRY_GOODS', 'PANTRY', 'BAKERY', 'FROZEN'] },
  { code: 'ICK', name: 'Başkent İçecek Dağıtım', contactName: 'Burak Şahin', phone: '+903124440606', taxNumber: '1111111106', taxOffice: 'Çankaya', paymentTermDays: 30, leadTimeDays: 2, groups: ['BEVERAGE'] },
  {
    code: 'MTR',
    name: 'Metro Toptan Market',
    contactName: 'Kurumsal satış',
    phone: '+903124440707',
    taxNumber: '1111111107',
    taxOffice: 'Etimesgut',
    paymentTermDays: 30,
    leadTimeDays: 0,
    groups: ['MEAT', 'POULTRY', 'DAIRY', 'PRODUCE', 'DRY_GOODS', 'PANTRY', 'BAKERY', 'FROZEN', 'BEVERAGE'],
  },
  { code: 'ESK', name: 'Eski Tedarikçi Ltd.', contactName: null, phone: null, taxNumber: '1111111108', taxOffice: 'Sincan', paymentTermDays: 60, leadTimeDays: 3, groups: ['PRODUCE'], inactive: true },
]);

const WAREHOUSES = Object.freeze([
  { code: 'ANA', name: 'Ana depo', isDefault: true },
  { code: 'SGK', name: 'Soğuk oda' },
  { code: 'KRG', name: 'Kuru gıda deposu' },
  { code: 'BAR', name: 'Bar deposu' },
]);

/** Malzeme grubunun girdiği depo. */
const GROUP_WAREHOUSE = Object.freeze({ MEAT: 'SGK', POULTRY: 'SGK', SEAFOOD: 'SGK', DAIRY: 'SGK', PRODUCE: 'SGK', FROZEN: 'SGK', DRY_GOODS: 'KRG', PANTRY: 'KRG', BAKERY: 'ANA', BEVERAGE: 'BAR' });
/** Satın alma KDV'si: temel gıda %1, diğer gıda %10, içecek %20. */
const GROUP_TAX = Object.freeze({ MEAT: '1', POULTRY: '1', SEAFOOD: '1', DAIRY: '1', PRODUCE: '1', DRY_GOODS: '1', BAKERY: '1', PANTRY: '10', FROZEN: '10', BEVERAGE: '20' });
/** Tedarikçinin kart maliyetine göre fiyat çarpanı (asıl tedarikçiler ucuz, toptan market hızlı ama pahalı). */
const PRICE_FACTOR = Object.freeze({ KSP: 0.96, HAL: 0.94, DNZ: 0.97, SUT: 0.95, KRG: 0.98, ICK: 0.97, MTR: 1.04 });

/** Stoğu olmayan temel kalemlerin minimum seviyesi (malzeme adı → stok biriminde); depodakiler girişe göre kurulur. */
const MIN_LEVELS = Object.freeze({ Un: '50', 'Baldo pirinç': '40', Zeytinyağı: '20', 'Ayçiçek yağı': '30', 'Toz şeker': '25', 'Filtre kahve': '5' });
/**
 * Demo satın alma ve stok verisini siler. Kapsam: demo kullanıcısının açtıkları **ve demo kayıtlarına
 * dayanan her belge** — demo tedarikçisine ya da demo malzemesine verilmiş sipariş, demo malzemesi içeren
 * tur / talep, bunların mal kabulü ve stok hareketi. Sunum sırasında personel demo turundan sipariş açar,
 * mal kabul girer; bunlar kalırsa demo malzemesi / tedarikçisi silinemez, yeniden yükleme çakışır.
 * Personelin demo dışı malzeme ve tedarikçiyle açtığı belgelere dokunulmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} actor
 */
export async function resetPurchasingDemo(tx, hotelId, actor) {
  const items = `SELECT "id" FROM "StockItem" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  const sellers = `SELECT "id" FROM "Supplier" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  const orders = `SELECT o."id" FROM "PurchaseOrder" o WHERE o."hotelId" = $1
    AND (o."createdBy" = $2 OR o."supplierId" IN (${sellers})
      OR EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."orderId" = o."id" AND l."stockItemId" IN (${items})))`;
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId, actor);

  // Sipariş onayları ve zil uyarıları; mal kabullerin stok hareketleri; mal kabul ve sipariş.
  const approvals = `SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'PurchaseOrder' AND "entityId" IN (${orders})`;
  await run(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityType" = 'Approval' AND "entityId" IN (${approvals})`);
  await run(`DELETE FROM "Approval" WHERE "id" IN (${approvals})`);
  const receipts = `SELECT "id" FROM "GoodsReceipt" WHERE "hotelId" = $1 AND "orderId" IN (${orders})`;
  await run(`DELETE FROM "StockMovement" WHERE "hotelId" = $1 AND "sourceType" = 'GoodsReceipt' AND "sourceId" IN (${receipts})`);
  await run(`DELETE FROM "GoodsReceipt" WHERE "id" IN (${receipts})`);
  await run(`DELETE FROM "PurchaseOrder" WHERE "id" IN (${orders})`);
  // Turlar (teklifleriyle) ve demo malzemesi içeren talepler (uyarılarıyla).
  await run(
    `DELETE FROM "PurchaseRound" r WHERE r."hotelId" = $1
       AND (r."createdBy" = $2 OR EXISTS (SELECT 1 FROM "PurchaseRoundLine" l WHERE l."roundId" = r."id" AND l."stockItemId" IN (${items})))`,
  );
  const requests = `SELECT r."id" FROM "PurchaseRequest" r WHERE r."hotelId" = $1
    AND (r."requestedBy" = $2 OR EXISTS (SELECT 1 FROM "PurchaseRequestLine" l WHERE l."requestId" = r."id" AND l."stockItemId" IN (${items})))`;
  await run(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityType" = 'PurchaseRequest' AND "entityId" IN (${requests})`);
  await run(`DELETE FROM "PurchaseRequest" WHERE "id" IN (${requests})`);
  // Stok: demo malzemesinin ve demo deposunun satırları; kalan hareketi olmayan demo depoları; kartın mevcudu.
  await run(`DELETE FROM "StockLevel" WHERE "hotelId" = $1 AND ("stockItemId" IN (${items}) OR "warehouseId" IN (SELECT "id" FROM "Warehouse" WHERE "hotelId" = $1 AND "createdBy" = $2))`);
  await run(
    `DELETE FROM "Warehouse" w WHERE w."hotelId" = $1 AND w."createdBy" = $2
       AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."warehouseId" = w."id")
       AND NOT EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g."warehouseId" = w."id")
       AND NOT EXISTS (SELECT 1 FROM "StockLevel" l WHERE l."warehouseId" = w."id")`,
  );
  await run(
    `UPDATE "StockItem" s SET "onHand" = COALESCE((SELECT SUM(l."quantity") FROM "StockLevel" l WHERE l."stockItemId" = s."id"), 0),
       "minLevel" = CASE WHEN s."createdBy" = $2 THEN NULL ELSE s."minLevel" END
     WHERE s."hotelId" = $1`,
  );
  await run(
    `DELETE FROM "Supplier" s WHERE s."hotelId" = $1 AND s."createdBy" = $2
       AND NOT EXISTS (SELECT 1 FROM "PurchaseOrder" o WHERE o."supplierId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "PurchaseQuote" q WHERE q."supplierId" = s."id")`,
  );
  // Tur / sipariş / mal kabul numaraları, kendi belgesi kalmadıysa baştan.
  for (const [kind, table] of [
    ['TKT', 'PurchaseRound'],
    ['SAS', 'PurchaseOrder'],
    ['MKB', 'GoodsReceipt'],
  ]) {
    await tx.$executeRawUnsafe(`DELETE FROM "PurchaseSequence" WHERE "hotelId" = $1 AND "kind" = $2 AND NOT EXISTS (SELECT 1 FROM "${table}" WHERE "hotelId" = $1)`, hotelId, kind);
  }
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string, addDays: (iso: string, n: number) => string }} context
 */
export async function seedPurchasingDemo({ prisma, core, contracts, hotelId, today, actor, addDays }) {
  const requests = await import('../src/modules/purchasing/service.js');
  const suppliers = await import('../src/modules/purchasing/suppliers.js');
  const rounds = await import('../src/modules/purchasing/rounds.js');
  const orders = await import('../src/modules/purchasing/orders.js');
  const receipts = await import('../src/modules/purchasing/receipts.js');
  const settings = await import('../src/modules/purchasing/settings.js');
  const stock = await import('../src/modules/stock/service.js');

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const counts = { suppliers: 0, warehouses: 0, rounds: 0, orders: 0, pendingApproval: 0, receipts: 0, belowMin: 0 };

  // ── Politika ──
  const current = await settings.getPurchaseSettings(hotelId);
  await as(() => settings.updatePurchaseSettings(hotelId, contracts.updatePurchaseSettingsSchema.parse({ expectedUpdatedAt: current.updatedAt, orderApprovalAmount: '25000', defaultTaxRatePct: '10' })));

  // ── Depolar ──
  const warehouse = new Map();
  for (const seed of WAREHOUSES) {
    const created = await as(() => stock.createWarehouse(hotelId, contracts.createWarehouseSchema.parse({ code: seed.code, name: seed.name, isDefault: Boolean(seed.isDefault) })));
    warehouse.set(seed.code, created);
    counts.warehouses += 1;
  }

  // ── Tedarikçiler ──
  const supplier = new Map();
  for (const seed of SUPPLIERS) {
    const { inactive, ...fields } = seed;
    let created = await as(() => suppliers.createSupplier(hotelId, contracts.createSupplierSchema.parse(fields)));
    if (inactive) {
      created = await as(() => suppliers.updateSupplier(hotelId, created.id, contracts.updateSupplierSchema.parse({ ...fields, expectedUpdatedAt: created.updatedAt, isActive: false })));
    }
    supplier.set(seed.code, created);
    counts.suppliers += 1;
  }

  const items = await prisma.stockItem.findMany({ where: { hotelId, createdBy: actor }, select: { id: true, name: true, group: true, unit: true, unitCost: true } });
  const itemByName = new Map(items.map((item) => [item.name, item]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  /** Turu açık satırların gördüğü toplamlarla açar (ihtiyaç aralığı verilirse yalnız o aralık). */
  async function openRound({ from = null, to = null, groups = null, note }) {
    const page = await rounds.listOpenLines(hotelId, contracts.openRequestLinesQuerySchema.parse({ pageSize: 100, ...(from ? { from } : {}), ...(to ? { to } : {}) }));
    const picked = page.items.filter((row) => row.unitMismatchLines === 0 && (!groups || groups.includes(row.group)));
    if (picked.length === 0) return null;
    const round = await as(() =>
      rounds.createRound(hotelId, contracts.createPurchaseRoundSchema.parse({ from, to, note, items: picked.map((row) => ({ stockItemId: row.stockItemId, expectedQuantity: row.quantity })) })),
    );
    counts.rounds += 1;
    return round;
  }

  /** Tedarikçinin teklifi: grubundaki satırlara kart maliyeti × çarpan (bazı satırlarda asıl tedarikçi pahalı kalır). */
  async function quote(roundId, code, { deliveryDays, validDays = 7, cheaperEvery = 0 } = {}) {
    const round = await rounds.getRound(hotelId, roundId);
    const seller = supplier.get(code);
    let index = 0;
    const lines = round.lines
      .filter((line) => line.state === 'PENDING' && seller.groups.includes(line.group))
      .map((line) => {
        index += 1;
        const base = Number(itemById.get(line.stockItemId)?.unitCost ?? line.currentCost);
        // Asıl tedarikçi bazı kalemlerde pahalı: toptan market o satırı kazanır (karşılaştırmada fark görünür).
        const factor = PRICE_FACTOR[code] * (cheaperEvery && index % cheaperEvery === 0 ? 1.12 : 1);
        return { roundLineId: line.id, unitPrice: (base * factor).toFixed(2), taxRatePct: GROUP_TAX[line.group] ?? '10' };
      });
    if (lines.length === 0) return;
    await as(() =>
      rounds.saveQuote(
        hotelId,
        roundId,
        seller.id,
        contracts.savePurchaseQuoteSchema.parse({ expectedUpdatedAt: round.updatedAt, deliveryDays: deliveryDays ?? seller.leadTimeDays, validUntil: addDays(today, validDays), note: null, lines }),
      ),
    );
  }

  /** Bekleyen satırlarda en uygunu seçer; `override` (malzeme adı → [tedarikçi kodu, gerekçe]) dışında. */
  async function awardBest(roundId, override = {}) {
    const round = await rounds.getRound(hotelId, roundId);
    const awards = round.lines
      .filter((line) => line.state === 'PENDING' && line.bestQuoteLineId)
      .map((line) => {
        const [code, reason] = override[line.name] ?? [];
        const chosen = code ? round.quotes.find((entry) => entry.supplierId === supplier.get(code).id)?.lines.find((cell) => cell.roundLineId === line.id && cell.unitPrice !== null) : null;
        return chosen ? { roundLineId: line.id, quoteLineId: chosen.id, reason } : { roundLineId: line.id, quoteLineId: line.bestQuoteLineId, reason: null };
      });
    if (awards.length === 0) return [];
    const result = await as(() => rounds.awardRound(hotelId, roundId, contracts.awardPurchaseRoundSchema.parse({ expectedUpdatedAt: round.updatedAt, awards })));
    counts.orders += result.orders.length;
    counts.pendingApproval += result.orders.filter((order) => order.status === 'PENDING_APPROVAL').length;
    return result.orders;
  }

  /** Mal kabul: `share` siparişin oranı (1 = tam), `skip` gelmeyen malzemeler, `closeShort` kalan gelmeyecek. */
  async function receive(orderId, { share = 1, skip = [], closeShort = false, waybill, note = null } = {}) {
    const order = await orders.getOrder(hotelId, orderId);
    const lines = order.lines
      .filter((line) => !skip.includes(line.name) && line.remaining !== '0')
      .map((line) => {
        const exact = Number(line.remaining) * share;
        const quantity = line.unit === 'KG' || line.unit === 'L' ? exact.toFixed(3) : String(Math.max(1, Math.floor(exact)));
        return { orderLineId: line.id, quantity };
      });
    if (lines.length === 0) return null;
    // Tek gruplu irsaliye kendi deposuna (et → soğuk oda, kuru gıda → kuru gıda deposu); karışık irsaliye ana depoya.
    const places = new Set(order.lines.map((line) => GROUP_WAREHOUSE[line.group] ?? 'ANA'));
    const target = warehouse.get(places.size === 1 ? [...places][0] : 'ANA');
    const receipt = await as(() =>
      receipts.receiveGoods(
        hotelId,
        orderId,
        contracts.receiveGoodsSchema.parse({ expectedUpdatedAt: order.updatedAt, warehouseId: target.id, waybillNumber: waybill, receivedOn: today, note, closeShort, lines }),
      ),
    );
    counts.receipts += 1;
    return receipt;
  }

  // ── Tur 1: yarınki ödül gecesi (ihtiyacı bugün / yarın) ──
  const galaRound = await openRound({ to: addDays(today, 1), note: 'Ödül gecesi: bugün / yarın teslim.' });
  if (galaRound) {
    for (const code of ['KSP', 'HAL', 'DNZ', 'SUT', 'KRG', 'ICK']) await quote(galaRound.id, code, { cheaperEvery: code === 'HAL' ? 4 : 0 });
    await quote(galaRound.id, 'MTR', { deliveryDays: 0, validDays: 3 });
    // Kuru gıda toptancısının termini 2 gün (gala yarın): bir kalem gerekçeyle aynı gün teslim eden marketten.
    const galaPending = (await rounds.getRound(hotelId, galaRound.id)).lines.filter((line) => line.state === 'PENDING');
    const lateDry = galaPending.find((line) => ['DRY_GOODS', 'PANTRY'].includes(line.group));
    const placed = await awardBest(galaRound.id, lateDry ? { [lateDry.name]: ['MTR', 'Toptancı termini 2 gün, gala yarın: aynı gün teslim şart'] } : {});
    let waybill = 1000;
    for (const placedOrder of placed) {
      if (placedOrder.status !== 'APPROVED') continue;
      waybill += 1;
      const detail = await orders.getOrder(hotelId, placedOrder.id);
      const group = itemById.get(detail.lines[0].stockItemId)?.group;
      if (group === 'PRODUCE' && detail.lines.length > 2) {
        // Hal: bir kalem gelmedi, sipariş eksik kapatıldı.
        await receive(placedOrder.id, { skip: [detail.lines[detail.lines.length - 1].name], closeShort: true, waybill: `HAL-${waybill}`, note: 'Roka bu sabah halde yoktu.' });
      } else if (group === 'DAIRY') {
        // Süt ürünleri: yarısı bugün, kalanı yarın sabah.
        await receive(placedOrder.id, { share: 0.5, waybill: `SUT-${waybill}`, note: 'Kalanı yarın 07:00.' });
      } else {
        await receive(placedOrder.id, { waybill: `IRS-${waybill}` });
      }
    }
  }

  // ── Tur 2: düğün (ihtiyacı 2+ gün) — teklifler girildi, kazanan demo sırasında seçilir ──
  const weddingRound = await openRound({ from: addDays(today, 2), note: 'Düğün: kasap, balıkçı, süt ürünleri. Kazanan satır bazında seçilecek.' });
  if (weddingRound) {
    await quote(weddingRound.id, 'KSP', { validDays: 10 });
    await quote(weddingRound.id, 'DNZ', { validDays: 5 });
    // Süt ürünleri ucuz ama bu hafta termini 4 gün: düğünün ihtiyacından sonra (karşılaştırmada "geç" uyarısı).
    await quote(weddingRound.id, 'SUT', { validDays: 10, deliveryDays: 4 });
    await quote(weddingRound.id, 'MTR', { deliveryDays: 0, validDays: 2 });
  }

  // ── Tereyağı ikinci alım (başka fiyat): hareketli ortalama ──
  const butter = itemByName.get('Tereyağı');
  if (butter) {
    await as(() =>
      requests.createRequest(hotelId, contracts.createPurchaseRequestSchema.parse({ source: 'MANUAL', neededBy: today, note: 'Pastane haftalık tereyağı.', lines: [{ stockItemId: butter.id, quantity: '12' }] })),
    );
    const butterRound = await openRound({ to: today, groups: ['DAIRY'], note: 'Pastane tereyağı.' });
    if (butterRound) {
      const round = await rounds.getRound(hotelId, butterRound.id);
      const lines = round.lines.filter((line) => line.state === 'PENDING').map((line) => ({ roundLineId: line.id, unitPrice: line.name === 'Tereyağı' ? '372.50' : (Number(line.currentCost) * 0.97).toFixed(2), taxRatePct: '1' }));
      await as(() => rounds.saveQuote(hotelId, butterRound.id, supplier.get('SUT').id, contracts.savePurchaseQuoteSchema.parse({ expectedUpdatedAt: round.updatedAt, deliveryDays: 0, validUntil: addDays(today, 3), lines })));
      const [butterOrder] = await awardBest(butterRound.id);
      if (butterOrder?.status === 'APPROVED') await receive(butterOrder.id, { waybill: 'SUT-2001' });
    }
  }

  // ── Bar talebi: açık satırlarda bekliyor ──
  const barItems = ['Kırmızı şarap (mutfak)', 'Filtre kahve'].map((name) => itemByName.get(name)).filter(Boolean);
  if (barItems.length) {
    await as(() =>
      requests.createRequest(
        hotelId,
        contracts.createPurchaseRequestSchema.parse({
          source: 'MANUAL',
          neededBy: addDays(today, 6),
          note: 'Lobi bar ve oda servisi haftalık.',
          lines: barItems.map((item) => ({ stockItemId: item.id, quantity: item.unit === 'KG' ? '6' : '24' })),
        }),
      ),
    );
  }

  // ── Minimum seviyeler: depodaki malzemelerin üçte biri minimumun altında kalır, kalanı üstünde; hiç stoğu
  // olmayan temel kalemler (un, pirinç, yağ…) altında — öneriler gerçekçi bir karışım gösterir ──
  const stocked = await prisma.stockItem.findMany({ where: { hotelId, createdBy: actor, onHand: { gt: 0 } }, orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true, onHand: true } });
  const levels = new Map(Object.entries(MIN_LEVELS).map(([name, minLevel]) => [itemByName.get(name)?.id, minLevel]).filter(([id]) => id));
  stocked.forEach((item, index) => {
    const target = Number(item.onHand) * (index % 3 === 0 ? 1.6 : 0.6);
    levels.set(item.id, item.unit === 'KG' || item.unit === 'L' ? String(Math.max(1, Math.round(target))) : String(Math.max(1, Math.ceil(target))));
  });
  for (const [id, minLevel] of levels) {
    const fresh = await prisma.stockItem.findUnique({ where: { id }, select: { updatedAt: true, onHand: true } });
    await as(() => stock.updateMinLevel(hotelId, id, contracts.updateMinLevelSchema.parse({ expectedUpdatedAt: fresh.updatedAt.toISOString(), minLevel })));
    if (Number(fresh.onHand) < Number(minLevel)) counts.belowMin += 1;
  }
  return counts;
}
