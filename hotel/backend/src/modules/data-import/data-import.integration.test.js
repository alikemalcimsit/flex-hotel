import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Excel'den toplu yükleme (modül 26) entegrasyon testleri: misafir (mevcut kişi atlanır, dosyada tekrar atlanır, hatalı
 * satır varken hiçbir şey yazılmaz, aynı yükleme ikinci kez yazılmaz) ve fiyat planı (sistemdeki ve dosyadaki çakışma
 * reddedilir, yazılan plan fiyat önbelleğine yansır); yetkiler.
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Excel yükleme (modül 26)', { skip }, () => {
  let app;
  let db;
  let core;
  let contracts;
  let imports;
  let pricing;
  let resetDatabase;
  let hotelId;
  let roomType;
  const PASSWORD = 'Yukleme-Test-1';

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    imports = await import('./service.js');
    pricing = await import('../pricing/service.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'admin@hotel.local' }, fn);
  const ADMIN = () => contracts.DEFAULT_ROLE_PERMISSIONS.ADMIN;
  const send = (kind, rows, { requestId = randomUUID(), dryRun = true } = {}) => as(() => imports.runImport(hotelId, ADMIN(), kind, { requestId, dryRun, fileName: 'test.xlsx', rows }));
  const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`${error.code}: ${error.message}`));

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    const hotel = await db.hotel.create({ data: { name: 'Yükleme Otel', code: `Y${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' } });
    hotelId = hotel.id;
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 } });
    await db.guest.create({ data: { hotelId, firstName: 'Mevcut', lastName: 'Misafir', email: 'var@example.com', phone: '+905321112233' } });
    // Eski kayıtta telefon farklı biçimde yazılmış.
    await db.guest.create({ data: { hotelId, firstName: 'Eski', lastName: 'Kayıt', phone: '0 (533) 444 55 66' } });
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.create({ data: { hotelId, email: 'kat@hotel.local', name: 'Kat', role: 'HOUSEKEEPING', passwordHash } });
  });

  it('misafir: mevcut kişi ve dosyada tekrar atlanır; hata varken yazılmaz; aynı yükleme ikinci kez yazılmaz', async () => {
    const rows = [
      { firstName: 'Ayşe', lastName: 'Kaya', email: 'ayse@example.com', phone: '0532 999 88 77', nationality: 'tr', birthDate: '01.02.1990', tags: 'VIP' },
      { firstName: 'Aynı', lastName: 'Kişi', email: 'VAR@example.com' },
      { firstName: 'Telefon', lastName: 'Eşleşir', phone: '0532 111 22 33' },
      { firstName: 'Ayşe', lastName: 'Tekrar', email: 'AYSE@example.com' },
      { firstName: '', lastName: 'Adsız', email: 'bozuk@' },
      { firstName: 'Biçim', lastName: 'Farklı', phone: '+90 533 444 55 66' },
    ];
    const preview = await send('GUESTS', rows);
    assert.deepEqual(preview.rows.map((row) => row.status), ['OK', 'SKIP', 'SKIP', 'SKIP', 'ERROR', 'SKIP']);
    assert.match(preview.rows[5].note, /Eski Kayıt \(telefon eşleşti\)/);
    assert.match(preview.rows[1].note, /Zaten kayıtlı: Mevcut Misafir \(e-posta eşleşti\)/);
    assert.match(preview.rows[2].note, /telefon eşleşti/);
    assert.match(preview.rows[3].note, /Dosyada 2\. satırda/);
    assert.deepEqual(preview.rows[4].errors.map((error) => error.field).sort(), ['email', 'firstName']);
    assert.deepEqual(preview.summary, { total: 6, ok: 1, skipped: 4, errors: 1 });

    const requestId = randomUUID();
    await rejects(send('GUESTS', rows, { requestId, dryRun: false }), 'VALIDATION');
    assert.equal(await db.guest.count({ where: { hotelId } }), 2, 'hatalı satır varken hiçbir şey yazılmadı');

    const fixed = rows.slice(0, 4);
    const done = await send('GUESTS', fixed, { requestId, dryRun: false });
    assert.deepEqual([done.created, done.skipped, done.replayed], [1, 3, false]);
    const ayse = await db.guest.findFirst({ where: { hotelId, email: 'ayse@example.com' } });
    assert.deepEqual([ayse.phone, ayse.nationality, ayse.tags, core.toIsoDay(ayse.birthDate)], ['+905329998877', 'TR', ['VIP'], '1990-02-01']);

    const again = await send('GUESTS', fixed, { requestId, dryRun: false });
    assert.deepEqual([again.replayed, again.created, await db.guest.count({ where: { hotelId } })], [true, 1, 3]);
    const history = await as(() => imports.listImports(hotelId, ADMIN()));
    assert.deepEqual(history.items.map((item) => [item.kind, item.created, item.skipped, item.fileName]), [['GUESTS', 1, 3, 'test.xlsx']]);
  });

  it('fiyat planı: sistemdeki ve dosyadaki çakışma reddedilir; yazılan plan fiyat önbelleğine yansır', async () => {
    await as(() =>
      pricing.createRatePlan(hotelId, contracts.ratePlanInputSchema.parse({ roomTypeId: roomType.id, name: 'Yaz', boardType: 'BB', startDate: '2027-06-01', endDate: '2027-08-31', price: '3000' })),
    );
    await pricing.getActiveRatePlans(hotelId); // önbelleğe al
    const rows = [
      { roomType: 'std', name: 'Yaz sonu', boardType: 'BB', startDate: '15.08.2027', endDate: '30.09.2027', price: '2800' },
      { roomType: 'Standart', name: 'Sonbahar', boardType: 'Oda Kahvaltı', startDate: '01.09.2027', endDate: '31.10.2027', price: '2.500,00' },
      { roomType: 'STD', name: 'Sonbahar YP', boardType: 'HB', startDate: '01.09.2027', endDate: '31.10.2027', price: '3100', minStay: '2' },
      { roomType: 'STD', name: 'Çakışan', boardType: 'HB', startDate: '15.10.2027', endDate: '15.11.2027', price: '3000' },
      { roomType: 'SUITE', name: 'Yok', boardType: 'BB', startDate: '01.09.2027', endDate: '30.09.2027', price: '5000' },
    ];
    const preview = await send('RATE_PLANS', rows);
    assert.deepEqual(preview.rows.map((row) => row.status), ['ERROR', 'OK', 'OK', 'ERROR', 'ERROR']);
    assert.match(preview.rows[0].errors[0].message, /Mevcut "Yaz" planıyla/);
    assert.match(preview.rows[3].errors[0].message, /Dosyadaki 4\. satırla/);
    assert.match(preview.rows[4].errors[0].message, /"SUITE" adlı \/ kodlu oda tipi yok/);

    const done = await send('RATE_PLANS', [rows[1], rows[2]], { dryRun: false });
    assert.equal(done.created, 2);
    const active = await pricing.getActiveRatePlans(hotelId);
    assert.deepEqual(active.map((plan) => plan.name).sort(), ['Sonbahar', 'Sonbahar YP', 'Yaz'], 'ayar olayı önbelleği tazeledi');
    const autumn = await db.ratePlan.findFirst({ where: { hotelId, name: 'Sonbahar YP' } });
    assert.deepEqual([autumn.boardType, String(autumn.price), autumn.minStay, autumn.baseOccupancy], ['HB', '3100', 2, 2]);
    const event = await db.eventLog.findFirst({ where: { hotelId, name: 'rate.changed' }, orderBy: { occurredAt: 'desc' } });
    assert.match(event.payload.reason, /Excel ile 2 fiyat planı/);
  });

  it('yetkiler: kat görevlisi yükleyemez; müdür misafir yükler ama fiyat planı yükleyemez', async () => {
    const token = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'kat@hotel.local', password: PASSWORD } })).json().data.accessToken;
    const denied = await app.inject({ method: 'POST', url: '/imports/GUESTS', payload: { requestId: randomUUID(), rows: [{ firstName: 'A', lastName: 'B' }] }, headers: { authorization: `Bearer ${token}` } });
    assert.equal(denied.statusCode, 403);
    const manager = contracts.DEFAULT_ROLE_PERMISSIONS.MANAGER;
    await rejects(as(() => imports.runImport(hotelId, manager, 'RATE_PLANS', { requestId: randomUUID(), dryRun: true, fileName: null, rows: [{ roomType: 'STD' }] })), 'FORBIDDEN');
    const ok = await as(() => imports.runImport(hotelId, manager, 'GUESTS', { requestId: randomUUID(), dryRun: true, fileName: null, rows: [{ firstName: 'Yeni', lastName: 'Kişi' }] }));
    assert.equal(ok.summary.ok, 1);
  });
});
