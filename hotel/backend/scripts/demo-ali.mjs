import { randomUUID } from 'node:crypto';

/**
 * Ali'nin modülleri (18–46) için demo verisi ve sıfırlaması — 25 Kasım 2026 incelemesi.
 *
 * Sıfırlama (`resetAliDemo`) demo sıfırlamasının EN BAŞINDA çalışır: Ali'nin tabloları demo kayıtlara kısıtlı
 * (RESTRICT) bağlı ve dokunulmazsa canlı demo `--reset` yarıda kalıp geri alınır:
 * - stok hareketi (SALE / ISSUE / WASTE / TRANSFER / COUNT_ADJUST) demo menü ürününe, malzemesine, deposuna (44),
 * - stok sayımı demo deposuna / malzemesine (44), paket sipariş demo restoran adisyonuna / satış noktasına (42),
 * - kontenjan demo acenteye (30), misafir tercihi / notu demo misafire (22),
 * - zimmetli demirbaş personele (46; bordro demosu bütün personeli siler).
 * Demo aktörünün açtığı fırsatlar (36) ve arıza kayıtları (20) da baştan kurulur.
 *
 * Tohum (`seedAliDemo`): arıza / bakım kayıtları ve periyodik planlar (20), misafir tercihleri ve notları (22),
 * paketler ve gelecek sezonun fiyat planı (28), satış fırsatları, aramalar ve teklifler (36), demirbaş kartları,
 * geçen yılın amortismanı (46). Tanımlar (paket, fiyat planı, demirbaş, kategori, alan) yoksa açılır — personelin
 * kurduklarına dokunulmaz.
 */

/**
 * @param {any} tx @param {string} hotelId @param {string} actor
 */
export async function resetAliDemo(tx, hotelId, actor) {
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId, actor);
  const items = `SELECT "id" FROM "StockItem" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  const warehouses = `SELECT "id" FROM "Warehouse" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  const menu = `SELECT "id" FROM "MenuItem" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  const outlets = `SELECT "id" FROM "PosOutlet" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  // 44: demo malzeme / depo / menü ürününe bağlı bütün hareketler ve sayımlar (mal kabul hareketleri dahil —
  // satın alma sıfırlaması kalanları ve stok seviyelerini toparlar).
  await run(
    `DELETE FROM "StockCountLine" WHERE "countId" IN (SELECT "id" FROM "StockCount" WHERE "hotelId" = $1 AND "warehouseId" IN (${warehouses}))
       OR "stockItemId" IN (${items})`,
  );
  await run(`DELETE FROM "StockCount" WHERE "hotelId" = $1 AND "warehouseId" IN (${warehouses})`);
  await run(
    `DELETE FROM "StockMovement" WHERE "hotelId" = $1
       AND ("stockItemId" IN (${items}) OR "warehouseId" IN (${warehouses}) OR "menuItemId" IN (${menu}))`,
  );
  // 42: demo satış noktasının paket siparişleri (adisyona 1-1 bağlı).
  await run(
    `DELETE FROM "DeliveryOrder" WHERE "hotelId" = $1
       AND ("outletId" IN (${outlets}) OR "checkId" IN (SELECT "id" FROM "PosCheck" WHERE "hotelId" = $1 AND "outletId" IN (${outlets})))`,
  );
  // 30: demo acentelerin kontenjanları.
  await run(`DELETE FROM "Allotment" WHERE "hotelId" = $1 AND "agencyId" IN (SELECT "id" FROM "Agency" WHERE "hotelId" = $1 AND "createdBy" = $2)`);
  // 22: demo misafirlerin tercihleri ve notları.
  const demoGuests = `SELECT "id" FROM "Guest" WHERE "hotelId" = $1 AND 'demo' = ANY("tags")`;
  await run(`DELETE FROM "GuestPreference" WHERE "hotelId" = $1 AND "guestId" IN (${demoGuests}) AND $2 = $2`);
  await run(`DELETE FROM "GuestNote" WHERE "hotelId" = $1 AND "guestId" IN (${demoGuests}) AND $2 = $2`);
  // 36: demo aktörünün fırsatları (aramalar ve teklifler fırsatla gider).
  await run(`DELETE FROM "Lead" WHERE "hotelId" = $1 AND "createdBy" = $2`);
  // 20: demo aktörünün arıza kayıtları (fotoğraflarıyla).
  const tickets = `SELECT "id" FROM "MaintenanceTicket" WHERE "hotelId" = $1 AND "reportedBy" = $2`;
  await run(`DELETE FROM "MaintenancePhoto" WHERE "ticketId" IN (${tickets})`);
  await run(`DELETE FROM "MaintenanceTicket" WHERE "id" IN (${tickets})`);
  // 46: zimmet personele kısıtlı bağlı; bordro demosu bütün personeli siler — zimmet kalkar (geçmiş hareketlerde kalır).
  await run(`UPDATE "Asset" SET "employeeId" = NULL WHERE "hotelId" = $1 AND "employeeId" IS NOT NULL AND $2 = $2`);
}

const TICKETS = [
  { room: 0, category: 'PLUMBING', title: 'Lavabo gideri yavaş akıyor', description: 'Misafir bildirdi; sifon temizlenmeli.', priority: 3, flow: 'DONE', note: 'Sifon söküldü, temizlendi.' },
  { room: 1, category: 'HVAC', title: 'Klima soğutmuyor', description: 'Kumanda çalışıyor, dış ünite ses yapıyor.', priority: 2, flow: 'IN_PROGRESS' },
  { room: 2, category: 'ELECTRICAL', title: 'Başucu lambası yanmıyor', description: 'Sol başucu; ampul değiştirildi, yine yanmıyor — duy arızası olabilir.', priority: 4, flow: 'ASSIGNED' },
  { room: 3, category: 'FURNITURE', title: 'Gardırop kapağı menteşesi kırık', description: 'Sağ kapak düşüyor.', priority: 4, flow: 'OPEN' },
  { location: 'Lobi', category: 'SAFETY', title: 'Acil çıkış ışığı yanıp sönüyor', description: 'Lobi batı çıkışı; batarya kontrol edilmeli.', priority: 1, flow: 'ASSIGNED' },
  { location: 'Havuz teknik oda', category: 'APPLIANCE', title: 'Sirkülasyon pompası titreşim', description: 'Sabah turunda fark edildi.', priority: 2, flow: 'OPEN' },
  { room: 4, category: 'APPLIANCE', title: 'Minibar soğutmuyor', description: 'Kapı contası açık kalıyor olabilir.', priority: 3, flow: 'DONE', note: 'Conta değiştirildi.' },
  { room: 5, category: 'STRUCTURAL', title: 'Balkon kapısında su sızıntısı', description: 'Yağmurda eşikten su giriyor.', priority: 2, flow: 'CANCELLED', reason: 'Dış cephe yenilemesi kapsamına alındı.' },
];

const PLANS = [
  { title: 'Klima filtre temizliği', category: 'HVAC', location: 'Bütün odalar (kat kat)', intervalDays: 30, priority: 3, checklist: ['Filtreyi çıkar ve yıka', 'Drenajı kontrol et', 'Kumanda pilini kontrol et'] },
  { title: 'Yangın tüpü kontrolü', category: 'SAFETY', location: 'Koridorlar ve ortak alanlar', intervalDays: 90, priority: 2, checklist: ['Basınç göstergesi', 'Mühür', 'Son dolum tarihi'] },
  { title: 'Jeneratör test çalıştırması', category: 'ELECTRICAL', location: 'Teknik bina', intervalDays: 7, priority: 2, checklist: ['30 dk yüklü çalıştır', 'Yakıt seviyesi', 'Akü voltajı'] },
  { title: 'Lejyonella için su ısıtıcı şoklama', category: 'PLUMBING', location: 'Kazan dairesi', intervalDays: 30, priority: 2, checklist: ['70 °C üstü 30 dk', 'Uç noktalarda sıcaklık ölçümü', 'Kayıt formu'] },
];

const PREFERENCES = [
  [{ category: 'FLOOR', value: 'Yüksek kat, asansörden uzak' }, { category: 'PILLOW', value: 'Sert yastık (2 adet)' }],
  [{ category: 'BED', value: 'Ayrı yatak (twin)' }, { category: 'DIET', value: 'Vejetaryen' }],
  [{ category: 'OCCASION', value: 'Evlilik yıl dönümü — 14 Şubat' }, { category: 'ROOM_FEATURE', value: 'Deniz manzarası' }],
  [{ category: 'TRANSPORT', value: 'Havalimanı transferi ister (İstanbul Havalimanı)' }],
  [{ category: 'DIET', value: 'Glutensiz' }, { category: 'FLOOR', value: 'Giriş katı (yürüme güçlüğü)' }],
];
const NOTES = [
  { body: 'Her gelişinde odada taze meyve tabağı ve el yazısı not isteniyor.', pinned: true },
  { body: 'Geçen konaklamada klima arızasından şikâyet etti; telafi olarak bir akşam yemeği ikram edildi.', pinned: false },
  { body: 'Şirket hesabından fatura istiyor (vergi levhası dosyada).', pinned: true },
];

const PACKAGES = [
  { code: 'BALAYI', name: 'Balayı Paketi', boardType: 'HB', perNightOverBase: 0.55, description: 'Deniz manzaralı oda, akşam yemeği, odada şampanya ve meyve, çift masajı.', components: ['Akşam yemeği (2 kişi)', 'Odada şampanya ve meyve tabağı', 'Çift masajı (50 dk, bir kez)', 'Geç çıkış 14:00'] },
  { code: 'SPA-HAFTASONU', name: 'Spa Hafta Sonu', boardType: 'BB', perNightOverBase: 0.35, description: 'Kahvaltı dahil, kişi başı bir masaj ve hamam kullanımı.', components: ['Açık büfe kahvaltı', 'Kişi başı 50 dk masaj', 'Türk hamamı ve sauna'] },
];

const LEADS = [
  { name: 'Selin Aydın', company: 'Aydın Mimarlık', phone: '+905321112233', source: 'PHONE', nights: 3, adults: 2, inDays: 21, call: { outcome: 'QUOTE_REQUESTED', summary: 'Ocak sonu 3 gece deniz manzaralı oda istiyor; fiyat teklifi e-postayla.' }, quote: true },
  { name: 'Thomas Becker', company: null, email: 'thomas.becker@example.de', source: 'EMAIL', nights: 7, adults: 2, children: 1, inDays: 45, call: { outcome: 'INFO', summary: 'Aile odası ve çocuk kulübü hakkında bilgi istedi.' }, quote: true },
  { name: 'Mehmet Kara', company: 'Kara Lojistik A.Ş.', phone: '+905339876543', source: 'PHONE', nights: 2, adults: 1, inDays: 10, call: { outcome: 'FOLLOW_UP', summary: 'Şirket için yıllık anlaşma düşünüyor; satın almayla görüşüp dönecek.', followUp: 3 } },
  { name: 'Elena Petrova', company: null, email: 'elena.p@example.ru', source: 'WEB', nights: 5, adults: 2, inDays: 60 },
  { name: 'Burak Şen', company: 'Şen Organizasyon', phone: '+905441234567', source: 'WALK_IN', nights: 1, adults: 2, inDays: 5, call: { outcome: 'NO_ANSWER', summary: 'İki kez arandı, açılmadı.', followUp: 1 } },
  { name: 'Ayla Demir', company: null, phone: '+905355554433', source: 'PHONE', nights: 4, adults: 2, inDays: 30, call: { outcome: 'NOT_INTERESTED', summary: 'Fiyatı yüksek buldu, başka otelde karar kıldı.' }, lost: 'Fiyat — rakip otel %15 daha ucuz' },
];

const CATEGORIES = [
  { key: 'mobilya', name: 'Mobilya ve demirbaş', usefulLifeYears: 5 },
  { key: 'elektronik', name: 'Elektronik (TV, klima)', usefulLifeYears: 4 },
  { key: 'mutfak', name: 'Mutfak ekipmanı', usefulLifeYears: 8 },
  { key: 'bilgisayar', name: 'Bilgisayar ve donanım', usefulLifeYears: 3 },
];
const AREAS = ['Lobi', 'Restoran', 'Ana mutfak', 'Ön büro', 'Spa'];
const ASSETS = [
  { category: 'mutfak', area: 'Ana mutfak', name: 'Kombi fırın 10 tepsi', brand: 'Rational', model: 'iCombi Pro 10-1/1', cost: '685000.00', yearsAgo: 2 },
  { category: 'mutfak', area: 'Ana mutfak', name: 'Endüstriyel bulaşık makinesi', brand: 'Winterhalter', model: 'PT-M', cost: '312000.00', yearsAgo: 3 },
  { category: 'mutfak', area: 'Restoran', name: 'Espresso makinesi (2 grup)', brand: 'La Marzocco', model: 'Linea PB', cost: '248000.00', yearsAgo: 1, warrantyYears: 2 },
  { category: 'bilgisayar', area: 'Ön büro', name: 'Ön büro bilgisayarı', brand: 'Lenovo', model: 'ThinkCentre M70q', cost: '38500.00', yearsAgo: 1, warrantyYears: 3 },
  { category: 'bilgisayar', area: 'Ön büro', name: 'Kart yazıcı (oda kartı)', brand: 'Evolis', model: 'Primacy 2', cost: '62000.00', yearsAgo: 2 },
  { category: 'mobilya', area: 'Lobi', name: 'Lobi koltuk takımı', brand: null, model: null, cost: '145000.00', yearsAgo: 4 },
  { category: 'elektronik', area: 'Spa', name: 'Sauna ısıtıcısı', brand: 'Harvia', model: 'Virta HL110', cost: '96000.00', yearsAgo: 2 },
  { category: 'elektronik', area: 'Restoran', name: 'Ses sistemi', brand: 'Bose', model: 'FreeSpace', cost: '54000.00', yearsAgo: 3 },
];
/** Odalara: televizyon ve klima (her odaya bir). */
const ROOM_ASSETS = [
  { category: 'elektronik', name: 'Televizyon 50"', brand: 'Samsung', model: 'HG50BU800', cost: '21500.00', yearsAgo: 2 },
  { category: 'elektronik', name: 'Split klima 12.000 BTU', brand: 'Daikin', model: 'FTXM35R', cost: '28500.00', yearsAgo: 3 },
];
/** Oda demirbaşı açılacak oda sayısı (demo kısa tutulur; gerçek otelde içe aktarma ile). */
const ROOM_ASSET_ROOMS = 12;

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} args
 */
export async function seedAliDemo({ prisma, core, contracts, hotelId, today, actor }) {
  const maintenance = await import('../src/modules/maintenance/service.js');
  const crm = await import('../src/modules/guests/service.js');
  const pricing = await import('../src/modules/pricing/service.js');
  const sales = await import('../src/modules/sales/service.js');
  const assetDefs = await import('../src/modules/assets/definitions.js');
  const assets = await import('../src/modules/assets/assets.js');
  const depreciation = await import('../src/modules/assets/depreciation.js');

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const parse = (name, value) => contracts[name].parse(value);
  const addDays = (day, n) => core.toIsoDay(core.addDays(new Date(`${day}T00:00:00.000Z`), n));
  const summary = { tickets: 0, plans: 0, preferences: 0, notes: 0, packages: 0, ratePlans: 0, leads: 0, quotes: 0, assets: 0, depreciation: null, skipped: [] };
  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      summary.skipped.push(`${label}: ${error.message}`);
      return null;
    }
  };

  const rooms = await prisma.room.findMany({ where: { hotelId, deletedAt: null }, orderBy: [{ floor: 'asc' }, { number: 'asc' }], select: { id: true, number: true } });
  const roomTypes = await prisma.roomType.findMany({ where: { hotelId }, orderBy: { basePrice: 'asc' }, select: { id: true, code: true, basePrice: true } });
  const technician = await prisma.user.findFirst({ where: { hotelId, isActive: true, role: { in: ['MANAGER', 'ADMIN'] } }, orderBy: { role: 'desc' }, select: { id: true } });

  // ── 20: arıza kayıtları ve periyodik planlar ──
  for (const [index, seed] of TICKETS.entries()) {
    const room = seed.room !== undefined ? rooms[(seed.room * 7 + 3) % rooms.length] : null;
    const ticket = await attempt(`arıza ${index + 1}`, () =>
      as(() =>
        maintenance.createTicket(
          hotelId,
          parse('maintenanceTicketCreateSchema', {
            ...(room ? { roomId: room.id } : { locationText: seed.location }),
            category: seed.category,
            title: seed.title,
            description: seed.description,
            priority: seed.priority,
          }),
        ),
      ),
    );
    if (!ticket) continue;
    summary.tickets += 1;
    const id = ticket.id;
    if (['ASSIGNED', 'IN_PROGRESS', 'DONE'].includes(seed.flow) && technician) await attempt('atama', () => as(() => maintenance.assignTicket(hotelId, id, parse('maintenanceAssignSchema', { assignedTo: technician.id }))));
    if (['IN_PROGRESS', 'DONE'].includes(seed.flow)) await attempt('başlatma', () => as(() => maintenance.startTicket(hotelId, id)));
    if (seed.flow === 'DONE') await attempt('kapatma', () => as(() => maintenance.resolveTicket(hotelId, id, parse('maintenanceResolveSchema', { resolutionNote: seed.note }))));
    if (seed.flow === 'CANCELLED') await attempt('iptal', () => as(() => maintenance.cancelTicket(hotelId, id, parse('maintenanceCancelSchema', { reason: seed.reason }))));
  }
  const existingPlans = new Set((await prisma.maintenancePlan.findMany({ where: { hotelId, deletedAt: null }, select: { title: true } })).map((row) => row.title));
  for (const seed of PLANS) {
    if (existingPlans.has(seed.title)) continue;
    const created = await attempt(`plan ${seed.title}`, () =>
      as(() => maintenance.createPlan(hotelId, parse('maintenancePlanSchema', { title: seed.title, category: seed.category, locationText: seed.location, intervalDays: seed.intervalDays, priority: seed.priority, checklist: seed.checklist }))),
    );
    if (created) summary.plans += 1;
  }

  // ── 22: misafir tercihleri ve notları (son konaklamalı demo misafirler) ──
  const regulars = await prisma.guest.findMany({
    where: { hotelId, deletedAt: null, tags: { has: 'demo' }, reservations: { some: { status: 'CHECKED_OUT' } } },
    orderBy: { createdAt: 'asc' },
    take: PREFERENCES.length,
    select: { id: true },
  });
  for (const [index, guest] of regulars.entries()) {
    for (const preference of PREFERENCES[index]) {
      const created = await attempt('tercih', () => as(() => crm.addPreference(hotelId, guest.id, parse('guestPreferenceSchema', { ...preference, source: 'STAFF', confidence: 'HIGH' }))));
      if (created) summary.preferences += 1;
    }
    const note = NOTES[index % NOTES.length];
    if (index < NOTES.length && (await attempt('not', () => as(() => crm.addNote(hotelId, guest.id, parse('guestNoteSchema', note)))))) summary.notes += 1;
  }

  // ── 28: paketler ve gelecek sezonun fiyat planı (yoksa) ──
  const reference = roomTypes[Math.min(1, roomTypes.length - 1)];
  const packages = await prisma.package.findMany({ where: { hotelId, deletedAt: null }, select: { code: true } });
  for (const seed of PACKAGES) {
    if (!reference || packages.some((row) => row.code === seed.code)) continue;
    const nightly = (Number(reference.basePrice) * (1 + seed.perNightOverBase)).toFixed(2);
    const created = await attempt(`paket ${seed.code}`, () =>
      as(() =>
        pricing.createPackage(
          hotelId,
          parse('packageInputSchema', { code: seed.code, name: seed.name, description: seed.description, boardType: seed.boardType, nightlyPrice: nightly, components: seed.components.map((label) => ({ label })) }),
        ),
      ),
    );
    if (created) summary.packages += 1;
  }
  const year = Number(today.slice(0, 4));
  const season = { start: `${year + 1}-06-01`, end: `${year + 1}-09-30` };
  const existingPlansRate = await prisma.ratePlan.count({ where: { hotelId, deletedAt: null, startDate: new Date(`${season.start}T00:00:00.000Z`) } });
  if (existingPlansRate === 0) {
    for (const type of roomTypes) {
      const created = await attempt(`fiyat planı ${type.code}`, () =>
        as(() =>
          pricing.createRatePlan(
            hotelId,
            parse('ratePlanInputSchema', {
              roomTypeId: type.id,
              name: `Yaz ${year + 1} — ${type.code}`,
              boardType: 'BB',
              startDate: season.start,
              endDate: season.end,
              price: (Number(type.basePrice) * 1.4).toFixed(2),
              baseOccupancy: 2,
              extraAdultRate: (Number(type.basePrice) * 0.3).toFixed(2),
              childRate: (Number(type.basePrice) * 0.15).toFixed(2),
              minStay: 3,
            }),
          ),
        ),
      );
      if (created) summary.ratePlans += 1;
    }
  }

  // ── 36: satış fırsatları, aramalar, teklifler ──
  for (const seed of LEADS) {
    const type = roomTypes[seed.children ? roomTypes.length - 1 : 0];
    const checkIn = addDays(today, seed.inDays);
    const lead = await attempt(`fırsat ${seed.name}`, () =>
      as(() =>
        sales.createLead(
          hotelId,
          parse('createLeadSchema', {
            name: seed.name,
            company: seed.company,
            phone: seed.phone ?? null,
            email: seed.email ?? null,
            source: seed.source,
            checkIn,
            checkOut: addDays(checkIn, seed.nights),
            roomTypeId: type?.id ?? null,
            adults: seed.adults,
            children: seed.children ?? 0,
            followUpAt: addDays(today, seed.call?.followUp ?? 2),
          }),
        ),
      ),
    );
    if (!lead) continue;
    summary.leads += 1;
    if (seed.call) {
      await attempt('arama', () =>
        as(() => sales.addCallLog(hotelId, lead.id, parse('createCallLogSchema', { direction: 'INBOUND', phone: seed.phone ?? null, outcome: seed.call.outcome, summary: seed.call.summary, followUpAt: seed.call.followUp ? addDays(today, seed.call.followUp) : null }))),
      );
    }
    if (seed.quote && type) {
      const quote = await attempt('teklif', () =>
        as(() =>
          sales.createQuote(
            hotelId,
            lead.id,
            parse('createQuoteSchema', { checkIn, checkOut: addDays(checkIn, seed.nights), roomTypeId: type.id, boardType: 'BB', adults: seed.adults, children: seed.children ?? 0, validUntil: addDays(today, 7) }),
          ),
        ),
      );
      if (quote) {
        summary.quotes += 1;
        await attempt('teklif gönderimi', () => as(() => sales.sendQuote(hotelId, quote.id, parse('quoteVersionSchema', { expectedUpdatedAt: quote.updatedAt }))));
      }
    }
    if (seed.lost) {
      const fresh = await prisma.lead.findFirst({ where: { id: lead.id }, select: { updatedAt: true } });
      await attempt('kayıp', () => as(() => sales.setLeadStatus(hotelId, lead.id, parse('leadStatusSchema', { status: 'LOST', lostReason: seed.lost, expectedUpdatedAt: fresh.updatedAt }))));
    }
  }

  // ── 46: demirbaş (personelin kartı yoksa), geçen yılın amortismanı ──
  const existingAssets = await prisma.asset.count({ where: { hotelId } });
  if (existingAssets === 0) {
    const categories = new Map();
    const known = await prisma.assetCategory.findMany({ where: { hotelId }, select: { id: true, name: true } });
    for (const seed of CATEGORIES) {
      const found = known.find((row) => row.name === seed.name) ?? (await attempt(`kategori ${seed.name}`, () => as(() => assetDefs.createCategory(hotelId, parse('assetCategorySchema', { name: seed.name, usefulLifeYears: seed.usefulLifeYears })))));
      if (found) categories.set(seed.key, found.id);
    }
    const areas = new Map();
    const knownAreas = await prisma.assetArea.findMany({ where: { hotelId }, select: { id: true, name: true } });
    for (const name of AREAS) {
      const found = knownAreas.find((row) => row.name === name) ?? (await attempt(`alan ${name}`, () => as(() => assetDefs.createArea(hotelId, parse('assetAreaSchema', { name })))));
      if (found) areas.set(name, found.id);
    }
    const create = (seed, location) => {
      const purchaseDate = `${year - seed.yearsAgo}-03-15`;
      return attempt(`demirbaş ${seed.name}`, () =>
        as(() =>
          assets.createAsset(
            hotelId,
            parse('createAssetSchema', {
              requestId: randomUUID(),
              name: seed.name,
              categoryId: categories.get(seed.category),
              brand: seed.brand,
              model: seed.model,
              supplierName: 'Demo Tedarik A.Ş.',
              invoiceNumber: `DMO${year - seed.yearsAgo}${String(summary.assets + 1).padStart(5, '0')}`,
              warrantyUntil: seed.warrantyYears ? `${year - seed.yearsAgo + seed.warrantyYears}-03-15` : null,
              purchaseDate,
              cost: seed.cost,
              ...location,
            }),
          ),
        ),
      );
    };
    for (const seed of ASSETS) if ((await create(seed, { areaId: areas.get(seed.area) }))) summary.assets += 1;
    for (const room of rooms.slice(0, ROOM_ASSET_ROOMS)) {
      for (const seed of ROOM_ASSETS) if ((await create(seed, { roomId: room.id }))) summary.assets += 1;
    }
  }
  // Geçen yılın amortismanı kayıtlı değilse kaydedilir (kartlar kilitlenir).
  const lastYear = year - 1;
  const posted = await prisma.assetDepreciationRun.count({ where: { hotelId, year: lastYear } });
  if (posted === 0 && summary.assets > 0) {
    // Önceki yıllar sırayla (amortisman yılları ardışık kaydedilir).
    const firstYear = Number((await prisma.asset.aggregate({ where: { hotelId }, _min: { purchaseDate: true } }))._min.purchaseDate?.toISOString().slice(0, 4) ?? lastYear);
    for (let y = firstYear; y <= lastYear; y += 1) {
      const result = await attempt(`amortisman ${y}`, () => as(() => depreciation.postDepreciation(hotelId, parse('depreciationYearSchema', { year: y }))));
      if (result) summary.depreciation = y;
    }
  }
  return summary;
}
