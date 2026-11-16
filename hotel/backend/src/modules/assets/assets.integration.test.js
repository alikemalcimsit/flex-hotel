import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Demirbaş ve amortisman (modül 46) entegrasyon testleri: kart yaşam döngüsü (kod sırası, idempotent açılış, taşıma,
 * zimmet, iade, düzeltme, geçmiş), VUK yıllık amortisman (ardışık yıl kaydı, finansal kilit, elden çıkarma kuralları,
 * yalnız son yılın geri alınması), barkodlu sayım (yerinde / başka yerde / fazla / tekrar / bilinmeyen, kapanışta
 * taşıma), Excel yükleme (önizleme, ya hep ya hiç, tekrar gönderim) ve garanti zili (kart + bitiş başına bir kez).
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Demirbaş ve amortisman (modül 46)', { skip }, () => {
  let db;
  let core;
  let cache;
  let assets;
  let reader;
  let counts;
  let definitions;
  let depreciation;
  let importer;
  let warranty;
  let resetDatabase;
  let app;
  let hotelId;
  let rooms;
  let employee;
  let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    assets = await import('./assets.js');
    reader = await import('./assets-read.js');
    counts = await import('./counts.js');
    definitions = await import('./definitions.js');
    depreciation = await import('./depreciation.js');
    importer = await import('./import.js');
    warranty = await import('./warranty.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const PASSWORD = 'Demirbas-Test-1';
  const ACCOUNTANT = 'muhasebe@hotel.local';
  const HOUSEKEEPER = 'kat@hotel.local';
  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'muhasebe@hotel.local' }, fn);
  const thisYear = () => core.calendarDateInTimeZone(ZONE).getUTCFullYear();
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`${error.code}: ${error.message}`));

  let ids;
  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.clear();
    const hotel = await db.hotel.create({ data: { name: 'Demirbaş Otel', code: `D${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' } });
    hotelId = hotel.id;
    tokens = new Map();
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat görevlisi', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    const type = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'STD', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 } });
    rooms = {
      r101: await db.room.create({ data: { hotelId, number: '101', roomTypeId: type.id } }),
      r102: await db.room.create({ data: { hotelId, number: '102', roomTypeId: type.id } }),
    };
    const department = await db.department.create({ data: { hotelId, code: 'TEK', name: 'Teknik' } });
    employee = await db.employee.create({
      data: { hotelId, code: 'P-0001', firstName: 'Ayşe', lastName: 'Kaya', nationalId: '10000000146', departmentId: department.id, position: 'Teknisyen', hireDate: new Date('2024-01-01'), createdBy: 'test' },
    });
    const category = await as(() => definitions.createCategory(hotelId, { name: 'Mobilya', usefulLifeYears: 5 }));
    const electronics = await as(() => definitions.createCategory(hotelId, { name: 'Elektronik', usefulLifeYears: 3 }));
    const lobby = await as(() => definitions.createArea(hotelId, { name: 'Lobi' }));
    const store = await as(() => definitions.createArea(hotelId, { name: 'Depo' }));
    ids = { furniture: category.id, electronics: electronics.id, lobby: lobby.id, store: store.id };
  });

  const assetInput = (overrides = {}) => ({
    requestId: randomUUID(),
    name: 'Lobi koltuğu',
    categoryId: ids.furniture,
    purchaseDate: `${thisYear()}-01-15`,
    cost: '1200',
    areaId: ids.lobby,
    ...overrides,
  });
  const create = (overrides) => as(() => assets.createAsset(hotelId, assetInput(overrides)));

  it('kart: sıralı kod, idempotent açılış, taşıma / zimmet / iade / düzeltme geçmişe yazılır; QR bağlantısıyla aranır', async () => {
    const input = assetInput({ employeeId: employee.id });
    const first = await as(() => assets.createAsset(hotelId, input));
    const again = await as(() => assets.createAsset(hotelId, input));
    assert.equal(first.code, 'DM-000001');
    assert.equal(again.id, first.id);
    assert.equal(first.usefulLifeYears, 5, 'ömür kategoriden gelir');
    assert.equal(first.employee.name, 'Ayşe Kaya');
    assert.deepEqual(first.movements.map((movement) => movement.kind).sort(), ['ASSIGNED', 'CREATED']);
    const second = await create({ name: 'TV', categoryId: ids.electronics, roomId: rooms.r101.id, areaId: null, usefulLifeYears: 4 });
    assert.equal(second.code, 'DM-000002');
    assert.equal(second.location.label, 'Oda 101');

    const moved = await as(() => assets.transferAsset(hotelId, first.id, { expectedUpdatedAt: first.updatedAt, roomId: rooms.r102.id }));
    assert.equal(moved.location.label, 'Oda 102');
    await rejects(as(() => assets.transferAsset(hotelId, first.id, { expectedUpdatedAt: first.updatedAt, areaId: ids.store })), 'STALE_WRITE');
    const returned = await as(() => assets.returnAsset(hotelId, first.id, { expectedUpdatedAt: moved.updatedAt }));
    assert.equal(returned.employee, null);
    await rejects(as(() => assets.returnAsset(hotelId, first.id, { expectedUpdatedAt: returned.updatedAt })), 'NOT_ASSIGNED');
    const edited = await as(() => assets.updateAsset(hotelId, first.id, { expectedUpdatedAt: returned.updatedAt, serialNumber: 'SN-77', warrantyUntil: day(400) }));
    assert.equal(edited.serialNumber, 'SN-77');
    const kinds = edited.movements.map((movement) => movement.kind);
    assert.deepEqual(kinds.slice(0, 3), ['UPDATED', 'RETURNED', 'TRANSFERRED']);
    assert.deepEqual(kinds.slice(3).sort(), ['ASSIGNED', 'CREATED']);
    assert.equal(edited.movements.find((movement) => movement.kind === 'TRANSFERRED').fromLabel, 'Lobi');

    const byUrl = await reader.listAssets(hotelId, { state: 'ACTIVE', search: 'https://otel.example/demirbas/k/DM-000002', page: 1, pageSize: 20 });
    assert.deepEqual(byUrl.items.map((item) => item.code), ['DM-000002']);
    const bySerial = await reader.listAssets(hotelId, { state: 'ACTIVE', search: 'sn-7', page: 1, pageSize: 20 });
    assert.deepEqual(bySerial.items.map((item) => item.code), ['DM-000001']);
    assert.equal(bySerial.summary.totalCost, '1200.00');
    assert.equal((await reader.findAssetByCode(hotelId, 'DM-000002')).id, second.id);
  });

  it('VUK amortisman: yıllar ardışık kaydedilir, kayıtlı kart kilitlidir, elden çıkarma ve geri alma kurallara uyar', async () => {
    const year = thisYear();
    const old = await create({ name: 'Klima', categoryId: ids.electronics, purchaseDate: `${year - 2}-06-01`, cost: '1000', openingAccumulated: '333.33', openingThroughYear: year - 2 });
    const fresh = await create({ name: 'Masa', cost: '1200' });

    const before = await depreciation.getDepreciationTable(hotelId, year - 1);
    assert.equal(before.canPost, true);
    assert.deepEqual(before.rows.map((row) => [row.code, row.accumulatedStart, row.amount, row.source]), [[old.code, '333.33', '333.33', 'PLANNED']]);
    await rejects(as(() => depreciation.postDepreciation(hotelId, { year: year + 1 })), 'DEPRECIATION_NOT_POSTABLE');

    const posted = await as(() => depreciation.postDepreciation(hotelId, { year: year - 1 }));
    assert.equal(posted.status, 'POSTED');
    assert.equal(posted.run.total, '333.33');
    const skipped = await depreciation.getDepreciationTable(hotelId, year + 1);
    assert.match(skipped.postBlockReason, /henüz gelmedi/);

    const current = await as(() => depreciation.postDepreciation(hotelId, { year }));
    assert.deepEqual(current.rows.map((row) => [row.code, row.amount, row.bookValueEnd]), [
      [old.code, '333.34', '0.00'],
      [fresh.code, '240.00', '960.00'],
    ]);
    assert.equal(current.totals.amount, '573.34');

    const locked = await reader.getAsset(hotelId, fresh.id);
    assert.equal(locked.financialsLocked, true);
    await rejects(as(() => assets.updateAsset(hotelId, fresh.id, { expectedUpdatedAt: locked.updatedAt, cost: '1500' })), 'FINANCIALS_LOCKED');
    const renamed = await as(() => assets.updateAsset(hotelId, fresh.id, { expectedUpdatedAt: locked.updatedAt, name: 'Toplantı masası' }));
    assert.equal(renamed.name, 'Toplantı masası', 'kimlik alanları kilitli değil');

    const dispose = (asset, overrides = {}) =>
      as(() => assets.disposeAsset(hotelId, asset.id, { expectedUpdatedAt: asset.updatedAt, type: 'SOLD', disposedOn: day(0), price: '700', reason: 'Yenisi alındı', ...overrides }));
    await rejects(dispose(renamed), 'DEPRECIATION_POSTED');
    await rejects(as(() => depreciation.reverseDepreciation(hotelId, { year: year - 1 })), 'NOT_LAST_YEAR');

    const reversed = await as(() => depreciation.reverseDepreciation(hotelId, { year }));
    assert.equal(reversed.status, 'OPEN');
    const sold = await dispose(await reader.getAsset(hotelId, fresh.id));
    assert.equal(sold.status, 'DISPOSED');
    assert.deepEqual([sold.disposal.bookValue, sold.disposal.gainLoss], ['1200.00', '-500.00']);
    assert.equal(sold.schedule.length, 0, 'çıkarıldığı yıl amortisman ayrılmaz');
    await rejects(as(() => assets.transferAsset(hotelId, fresh.id, { expectedUpdatedAt: sold.updatedAt, areaId: ids.store })), 'ASSET_DISPOSED');

    const table = await depreciation.getDepreciationTable(hotelId, year);
    assert.deepEqual(table.rows.map((row) => [row.code, row.amount, row.source, row.disposedOn]), [
      [old.code, '333.34', 'PLANNED', null],
      [fresh.code, '0.00', 'NONE', day(0)],
    ]);
    await as(() => depreciation.postDepreciation(hotelId, { year }));
    const klima = await reader.getAsset(hotelId, old.id);
    await rejects(dispose(klima, { type: 'SCRAPPED', price: null }), 'DEPRECIATION_POSTED');
    // Geçen yılın kaydını geri almak için önce bu yılınki alınır; satılan kart o kaydın içinde değil, engellemez.
    await as(() => depreciation.reverseDepreciation(hotelId, { year }));
    const scrapped = await dispose(klima, { type: 'SCRAPPED', price: null });
    assert.equal(scrapped.disposal.bookValue, '333.34');
    await rejects(as(() => depreciation.reverseDepreciation(hotelId, { year: year - 1 })), 'DISPOSED_AFTER_POST');
  });

  it('sayım: yerinde / başka yerde / fazla / tekrar / bilinmeyen / elden çıkarılmış; kapanışta bulunduğu yere taşır', async () => {
    const chair = await create({ name: 'Sandalye' });
    const lamp = await create({ name: 'Lamba' });
    const tv = await create({ name: 'TV', roomId: rooms.r101.id, areaId: null });
    const gone = await create({ name: 'Eski halı', areaId: ids.store });
    await as(() => assets.disposeAsset(hotelId, gone.id, { expectedUpdatedAt: gone.updatedAt, type: 'LOST', disposedOn: day(0), reason: 'Bulunamadı' }));

    const count = await as(() => counts.createCount(hotelId, { title: 'Lobi sayımı', areaId: ids.lobby }));
    assert.equal(count.number, `SY-${thisYear()}-0001`);
    assert.deepEqual([count.expectedCount, count.scope.label], [2, 'Lobi']);
    const scan = (code, where = { areaId: ids.lobby }) => as(() => counts.scanCount(hotelId, count.id, { code, ...where }));
    assert.equal((await scan(chair.code)).result, 'FOUND');
    assert.equal((await scan(` ${chair.code.toLowerCase()} `)).result, 'DUPLICATE');
    const extra = await scan(`https://otel.example/demirbas/k/${tv.code}`);
    assert.equal(extra.result, 'EXTRA');
    assert.equal((await scan('DM-999999')).result, 'UNKNOWN');
    assert.equal((await scan('merhaba')).result, 'UNKNOWN');
    assert.equal((await scan(gone.code)).result, 'DISPOSED');
    assert.deepEqual(extra.totals, { expected: 2, found: 1, misplaced: 0, missing: 1, extra: 1 });

    const open = await counts.getCount(hotelId, count.id);
    assert.deepEqual(open.items.map((item) => [item.code, item.state]), [
      [lamp.code, 'MISSING'],
      [tv.code, 'EXTRA'],
      [chair.code, 'FOUND'],
    ]);
    const closed = await as(() => counts.closeCount(hotelId, count.id, { expectedUpdatedAt: open.updatedAt, applyTransfers: true }));
    assert.deepEqual([closed.status, closed.transferredCount], ['CLOSED', 1]);
    const tvAfter = await reader.getAsset(hotelId, tv.id);
    assert.equal(tvAfter.location.label, 'Lobi');
    assert.match(tvAfter.movements[0].note, /^Sayım SY-/);
    assert.equal((await reader.getAsset(hotelId, lamp.id)).status, 'ACTIVE', 'eksik kart kendiliğinden düşmez');
    await rejects(scan(lamp.code), 'COUNT_CLOSED');

    const whole = await as(() => counts.createCount(hotelId, {}));
    assert.deepEqual([whole.scope.label, whole.expectedCount], ['Tüm otel', 3]);
    const misplaced = await as(() => counts.scanCount(hotelId, whole.id, { code: lamp.code, roomId: rooms.r102.id }));
    assert.equal(misplaced.result, 'MISPLACED');
    assert.match(misplaced.message, /kayıtlı yeri: Lobi/);
    const fresh = await counts.getCount(hotelId, whole.id);
    const cancelled = await as(() => counts.cancelCount(hotelId, whole.id, { expectedUpdatedAt: fresh.updatedAt, reason: 'Yarın yeniden' }));
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal((await reader.getAsset(hotelId, lamp.id)).location.label, 'Lobi', 'iptal edilen sayım taşımaz');
  });

  it('Excel: önizleme satır satır hata döner; hatalı yükleme hiç kart açmaz; tekrar gönderim yeni kart açmaz', async () => {
    const row = (overrides = {}) => ({
      name: 'Yatak',
      category: 'mobilya',
      location: 'Oda 101',
      purchaseDate: `${thisYear() - 1}-03-01`,
      cost: '8000',
      usefulLifeYears: '',
      brand: '',
      model: '',
      serialNumber: '',
      supplierName: 'Mobilyacı A.Ş.',
      invoiceNumber: '',
      warrantyUntil: '',
      openingAccumulated: '1600',
      openingThroughYear: String(thisYear() - 1),
      employeeCode: '',
      note: '',
      ...overrides,
    });
    const requestId = randomUUID();
    const rows = [row(), row({ name: 'Bilgisayar', category: 'Elektronik', location: 'depo', employeeCode: 'p-0001', openingAccumulated: '', openingThroughYear: '' }), row({ category: 'Bahçe' })];
    const preview = await as(() => importer.importAssets(hotelId, { requestId, dryRun: true, rows }));
    assert.deepEqual(preview.summary, { total: 3, valid: 2, invalid: 1, totalCost: '16000.00' });
    assert.deepEqual(preview.rows[2].errors.map((error) => error.field), ['category']);
    assert.equal(preview.rows[1].preview.employeeName, 'Ayşe Kaya (P-0001)');
    assert.equal(preview.rows[1].preview.usefulLifeYears, 3);
    await rejects(as(() => importer.importAssets(hotelId, { requestId, dryRun: false, rows })), 'VALIDATION');
    assert.equal(await db.asset.count({ where: { hotelId } }), 0);

    const fixed = rows.slice(0, 2);
    const done = await as(() => importer.importAssets(hotelId, { requestId, dryRun: false, rows: fixed }));
    const replay = await as(() => importer.importAssets(hotelId, { requestId, dryRun: false, rows: fixed }));
    assert.deepEqual([done.created, replay.created, await db.asset.count({ where: { hotelId } })], [2, 2, 2]);
    const list = await reader.listAssets(hotelId, { state: 'ACTIVE', employeeId: employee.id, page: 1, pageSize: 20 });
    assert.deepEqual(list.items.map((item) => [item.code, item.name, item.location.label]), [['DM-000002', 'Bilgisayar', 'Depo']]);
    const bed = await reader.getAsset(hotelId, (await reader.listAssets(hotelId, { state: 'ACTIVE', search: 'Yatak', page: 1, pageSize: 5 })).items[0].id);
    assert.deepEqual([bed.accumulated, bed.schedule[0].source, bed.schedule[1].amount], ['1600.00', 'OPENING', '1600.00']);
  });

  it('garanti: pencereye giren kart için tek zil; aynı bitişte tekrar çalmaz, garanti değişince yeniden çalar', async () => {
    const soon = await create({ name: 'Bulaşık makinesi', warrantyUntil: day(10) });
    await create({ name: 'Fırın', warrantyUntil: day(200) });
    await create({ name: 'Eski buzdolabı', purchaseDate: `${thisYear() - 3}-01-01`, warrantyUntil: day(-5) });
    const alerts = [];
    const fake = { raiseStaffAlert: async (_tx, _stage, alert) => alerts.push(alert) };

    assert.deepEqual(await warranty.sweepWarranty(hotelId, fake), { alerted: 1 });
    assert.deepEqual(await warranty.sweepWarranty(hotelId, fake), { alerted: 0 });
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].title, /^1 demirbaşın garantisi/);
    assert.equal(alerts[0].permission, 'assets.manage');

    const expiring = await warranty.listWarranty(hotelId, { state: 'EXPIRING' });
    assert.deepEqual(expiring.items.map((item) => [item.name, item.daysLeft]), [['Bulaşık makinesi', 10]]);
    const expired = await warranty.listWarranty(hotelId, { state: 'EXPIRED' });
    assert.deepEqual(expired.items.map((item) => [item.name, item.daysLeft]), [['Eski buzdolabı', -5]]);

    await as(() => assets.updateAsset(hotelId, soon.id, { expectedUpdatedAt: soon.updatedAt, warrantyUntil: day(20) }));
    assert.deepEqual(await warranty.sweepWarranty(hotelId, fake), { alerted: 1 });
  });

  it('tanımlar: ad harf duyarsız tekil; içinde demirbaş duran alan kaldırılamaz', async () => {
    await rejects(as(() => definitions.createCategory(hotelId, { name: 'mobilya', usefulLifeYears: 4 })), 'DUPLICATE');
    await create({ name: 'Sehpa' });
    const areas = await definitions.listAreas(hotelId, {});
    const lobby = areas.items.find((area) => area.name === 'Lobi');
    assert.equal(lobby.assetCount, 1);
    await rejects(as(() => definitions.updateArea(hotelId, lobby.id, { expectedUpdatedAt: lobby.updatedAt, isActive: false })), 'AREA_IN_USE');
    const categories = await definitions.listCategories(hotelId, { includeInactive: true });
    assert.deepEqual(categories.items.map((category) => [category.name, category.assetCount]), [['Elektronik', 0], ['Mobilya', 1]]);
    const options = await definitions.getAssetOptions(hotelId);
    assert.deepEqual(options.employees.map((option) => option.label), ['Ayşe Kaya (P-0001)']);
  });
  it('HTTP: izinler ve şemalar uçtan uca (kod / QR bağlantısı, etiket, sayım okutma, Excel önizleme, amortisman)', async () => {
    assert.equal((await call('GET', '/assets', HOUSEKEEPER)).statusCode, 403);
    const created = await call('POST', '/assets', ACCOUNTANT, { requestId: randomUUID(), name: 'Resepsiyon bankosu', categoryId: ids.furniture, purchaseDate: `${thisYear()}-02-01`, cost: '25000,50', areaId: ids.lobby });
    assert.equal(created.statusCode, 201, created.body);
    const asset = created.json().data;
    assert.deepEqual([asset.code, asset.cost], ['DM-000001', '25000.50']);
    const bad = await call('POST', '/assets', ACCOUNTANT, { requestId: randomUUID(), name: 'X', categoryId: ids.furniture, purchaseDate: `${thisYear()}-02-01`, cost: '10', areaId: ids.lobby, roomId: rooms.r101.id });
    assert.equal(bad.statusCode, 400, bad.body);

    const byCode = await call('GET', '/assets/by-code/dm-000001', ACCOUNTANT);
    assert.equal(byCode.json().data.id, asset.id);
    const labels = await call('GET', `/assets/labels?ids=${asset.id}`, ACCOUNTANT);
    assert.deepEqual(labels.json().data.items.map((item) => [item.code, item.locationLabel]), [['DM-000001', 'Lobi']]);

    const count = (await call('POST', '/assets/counts', ACCOUNTANT, { areaId: ids.lobby })).json().data;
    const scanned = await call('POST', `/assets/counts/${count.id}/scan`, ACCOUNTANT, { code: `https://otel.example/demirbas/k/${asset.code}`, areaId: ids.lobby });
    assert.equal(scanned.json().data.result, 'FOUND', scanned.body);

    const preview = await call('POST', '/assets/import', ACCOUNTANT, { requestId: randomUUID(), dryRun: true, rows: [{ name: 'Masa', category: 'Mobilya', location: '102', purchaseDate: `${thisYear()}-01-02`, cost: 900 }] });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().data.summary.valid, 1);

    const table = await call('GET', `/assets/depreciation?year=${thisYear()}`, ACCOUNTANT);
    assert.equal(table.json().data.totals.amount, '5000.10');
    const posted = await call('POST', '/assets/depreciation/post', ACCOUNTANT, { year: thisYear() });
    assert.equal(posted.json().data.status, 'POSTED', posted.body);
    const warrantyList = await call('GET', '/assets/warranty?state=EXPIRING&withinDays=60', ACCOUNTANT);
    assert.equal(warrantyList.statusCode, 200, warrantyList.body);
  });
});
