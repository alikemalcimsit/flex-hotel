import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * Zincir konsolu (modül 63) uçtan uca — gerçek PostgreSQL gerektirir.
 *
 * Güvenlik-kritik iddialar HTTP katmanında: otel geçişi yalnız erişimi olan otele; başka otelin token'ı erişim
 * kaldırılınca hemen düşer, yenileme ana otele döner; rol değişikliği hemen etkili; zincir panosu / raporu yalnız
 * zinciri görme yetkisi olan otelleri gösterir; erişim verme hedef oteldeki yetkiye bağlı (yükseltme yok); sihirbaz
 * ayarları kopyalar, başka otelin kaydına bağ taşımaz.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('zincir konsolu (modül 63, entegrasyon)', { skip }, () => {
  /** @type {import('fastify').FastifyInstance} */ let app;
  /** @type {any} */ let db;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {any} */ let contracts;
  let hotelA;
  let hotelB;
  let hotelC;
  const users = {};
  const PASSWORD = 'parola-12345';

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    ({ prismaUnfiltered: db } = await import('../../db.js'));
    contracts = await import('@hotelos/hotel-contracts');
    const { buildApp } = await import('../../app.js');
    app = await buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    hotelA = await db.hotel.create({ data: { name: 'Ankara Otel', code: `ANK-${suffix}`, currency: 'TRY', largePaymentThreshold: '50000', checkInTime: '15:00', checkOutTime: '11:00', earlyCheckInFeeMode: 'FIXED', earlyCheckInFeeValue: '750' } });
    hotelB = await db.hotel.create({ data: { name: 'Bodrum Otel', code: `BDR-${suffix}`, currency: 'TRY' } });
    hotelC = await db.hotel.create({ data: { name: 'Bağımsız Otel', code: `IND-${suffix}`, currency: 'EUR' } });
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const create = async (key, hotelId, role) => {
      users[key] = await db.user.create({ data: { hotelId, email: `${key}@test.local`, name: key, role, passwordHash } });
    };
    await create('admin', hotelA.id, 'ADMIN');
    await create('desk', hotelA.id, 'FRONT_DESK');
    await create('manager', hotelA.id, 'MANAGER');
    await create('bodrum', hotelB.id, 'ADMIN');
    await create('outsider', hotelC.id, 'ADMIN');
  });

  const login = async (email) => (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json().data;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const call = (token, method, url, payload) => app.inject({ method, url, headers: bearer(token), ...(payload !== undefined ? { payload } : {}) });
  const grant = (userId, hotelId, role) => db.userHotel.create({ data: { userId, hotelId, role, createdBy: 'test' } });
  const makeGroup = async (...hotels) => {
    const group = await db.hotelGroup.create({ data: { name: 'Test Zinciri', createdBy: 'test' } });
    await db.hotel.updateMany({ where: { id: { in: hotels.map((hotel) => hotel.id) } }, data: { groupId: group.id } });
    return group;
  };

  it('oturum açık oteli ve erişilen otel sayısını taşır; otel listesi ana otel + erişimler', async () => {
    const before = await login('admin@test.local');
    assert.equal(before.hotel.id, hotelA.id);
    assert.equal(before.hotelCount, 1);

    await grant(users.admin.id, hotelB.id, 'MANAGER');
    const session = await login('admin@test.local');
    assert.equal(session.hotelCount, 2);
    const list = await call(session.accessToken, 'GET', '/auth/hotels');
    assert.equal(list.statusCode, 200);
    const items = list.json().data.items;
    assert.deepEqual(items.map((row) => [row.code, row.role, row.isHome]).sort(), [[hotelA.code, 'ADMIN', true], [hotelB.code, 'MANAGER', false]].sort());
  });

  it('otel geçişi: yeni token o otelin kimliği ve rolüyle; eski yenileme token\'ı iptal; erişimi olmayan otele geçilmez', async () => {
    await grant(users.admin.id, hotelB.id, 'FRONT_DESK');
    const session = await login('admin@test.local');

    const denied = await call(session.accessToken, 'POST', '/auth/switch-hotel', { hotelId: hotelC.id, refreshToken: session.refreshToken });
    assert.equal(denied.statusCode, 403);
    const unknown = await call(session.accessToken, 'POST', '/auth/switch-hotel', { hotelId: randomUUID(), refreshToken: session.refreshToken });
    assert.equal(unknown.statusCode, 403, 'olmayan otel de aynı cevabı alır (var mı yok mu sızmaz)');

    const switched = await call(session.accessToken, 'POST', '/auth/switch-hotel', { hotelId: hotelB.id, refreshToken: session.refreshToken });
    assert.equal(switched.statusCode, 200);
    const next = switched.json().data;
    assert.equal(next.hotel.id, hotelB.id);
    assert.equal(next.user.role, 'FRONT_DESK', 'rol o oteldeki erişimin rolü');
    assert.equal(next.permissions.includes('users.manage'), false);

    const context = await call(next.accessToken, 'GET', '/settings/hotel/context');
    assert.equal(context.json().data.code, hotelB.code, 'istek B otelinde açılır');
    assert.equal((await call(next.accessToken, 'GET', '/users')).statusCode, 403, 'A otelindeki yöneticilik B\'de geçmez');

    const reused = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken } });
    assert.equal(reused.statusCode, 401, 'geçişte eski yenileme token\'ı iptal');
    const refreshed = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: next.refreshToken } });
    assert.equal(refreshed.json().data.hotel.id, hotelB.id, 'yenileme açık otelde kalır');

    const foreign = await call(next.accessToken, 'POST', '/auth/switch-hotel', { hotelId: hotelA.id, refreshToken: session.refreshToken });
    assert.equal(foreign.statusCode, 401, 'başkasının / iptal edilmiş yenileme token\'ıyla geçiş yapılmaz');
  });

  it('erişim kaldırılınca o otelin token\'ı hemen düşer, yenileme ana otele döner; rol değişikliği hemen etkili', async () => {
    await makeGroup(hotelA, hotelB);
    await grant(users.admin.id, hotelB.id, 'ADMIN');
    await grant(users.desk.id, hotelB.id, 'FRONT_DESK');
    const admin = await login('admin@test.local');
    const deskHome = await login('desk@test.local');
    const desk = (await call(deskHome.accessToken, 'POST', '/auth/switch-hotel', { hotelId: hotelB.id, refreshToken: deskHome.refreshToken })).json().data;
    assert.equal((await call(desk.accessToken, 'GET', '/settings/hotel/context')).statusCode, 200);
    assert.equal((await call(desk.accessToken, 'GET', '/users')).statusCode, 403);

    // Rol yükseltmesi: aynı token, bir sonraki istekte yeni rolle.
    const raised = await call(admin.accessToken, 'PUT', `/chain/users/${users.desk.id}/hotels/${hotelB.id}`, { role: 'ADMIN' });
    assert.equal(raised.statusCode, 200, raised.body);
    assert.equal((await call(desk.accessToken, 'GET', '/users')).statusCode, 200, 'yeni rol hemen geçerli');

    const removed = await call(admin.accessToken, 'DELETE', `/chain/users/${users.desk.id}/hotels/${hotelB.id}`);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((await call(desk.accessToken, 'GET', '/settings/hotel/context')).statusCode, 401, 'B token\'ı hemen düşer');
    const back = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: desk.refreshToken } });
    assert.equal(back.statusCode, 200);
    assert.equal(back.json().data.hotel.id, hotelA.id, 'yenileme ana otele döndürür');
    assert.equal(back.json().data.user.role, 'FRONT_DESK');

    const audit = await db.auditLog.findFirst({ where: { hotelId: hotelB.id, entity: 'UserHotel', action: 'DELETE' } });
    assert.ok(audit, 'erişim kaldırma denetim izinde');
  });

  it('zincir kurma: otel yöneticisi kurar, ikinci kez kurulmaz; resepsiyon giremez', async () => {
    const admin = await login('admin@test.local');
    const desk = await login('desk@test.local');
    assert.equal((await call(desk.accessToken, 'POST', '/chain/group', { name: 'X' })).statusCode, 403);

    const overview = await call(admin.accessToken, 'GET', '/chain');
    assert.equal(overview.json().data.group, null);
    const created = await call(admin.accessToken, 'POST', '/chain/group', { name: 'Flex Otelleri' });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().data.hotelCount, 1);
    const again = await call(admin.accessToken, 'POST', '/chain/group', { name: 'İkinci' });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, 'ALREADY_IN_GROUP');

    const group = created.json().data;
    const renamed = await call(admin.accessToken, 'PATCH', '/chain/group', { name: 'Flex Grup', expectedUpdatedAt: group.updatedAt });
    assert.equal(renamed.statusCode, 200);
    const stale = await call(admin.accessToken, 'PATCH', '/chain/group', { name: 'Eski', expectedUpdatedAt: group.updatedAt });
    assert.equal(stale.statusCode, 409, 'sürüm kilidi');
  });

  it('yeni otel sihirbazı: seçilen ayarlar kopyalanır, kuran yönetici olur; kod tekil; para birimi farklıysa tutar ve oda tipi gelmez', async () => {
    await makeGroup(hotelA);
    await db.roomType.create({ data: { hotelId: hotelA.id, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 2 } });
    await db.roomType.create({ data: { hotelId: hotelA.id, code: 'OLD', name: 'Silinmiş', basePrice: '1', deletedAt: new Date() } });
    await db.tax.create({ data: { hotelId: hotelA.id, name: 'KDV', rate: '10', isIncluded: true } });
    await db.season.create({ data: { hotelId: hotelA.id, name: 'Yaz', startDate: new Date('2027-06-01'), endDate: new Date('2027-09-01'), multiplier: '1.4' } });
    await db.rolePermission.create({ data: { hotelId: hotelA.id, role: 'FRONT_DESK', permission: 'guests.view' } });
    await db.hotel.update({ where: { id: hotelA.id }, data: { permissionCatalog: ['guests.view'] } });
    const admin = await login('admin@test.local');

    const input = { name: 'Flex İzmir', code: 'IZM-01', timezone: 'Europe/Istanbul', currency: 'TRY', sourceHotelId: hotelA.id };
    const created = await call(admin.accessToken, 'POST', '/chain/hotels', input);
    assert.equal(created.statusCode, 201, created.body);
    const { hotel, copied, skipped } = created.json().data;
    assert.deepEqual(copied, { roomTypes: 1, taxes: 1, seasons: 1, rolePermissions: 1 }, 'silinmiş oda tipi kopyalanmaz');
    assert.deepEqual(skipped, []);
    const row = await db.hotel.findFirst({ where: { id: hotel.id } });
    assert.equal(row.checkInTime, '15:00');
    assert.equal(String(row.largePaymentThreshold), '50000');
    assert.equal(row.groupId, (await db.hotel.findFirst({ where: { id: hotelA.id } })).groupId);
    assert.deepEqual(row.permissionCatalog, ['guests.view']);
    assert.equal((await db.roomType.findFirst({ where: { hotelId: hotel.id } })).code, 'STD');
    assert.equal((await db.userHotel.findFirst({ where: { userId: users.admin.id, hotelId: hotel.id } })).role, 'ADMIN');
    assert.equal(await db.room.count({ where: { hotelId: hotel.id } }), 0);
    assert.ok(await db.auditLog.findFirst({ where: { hotelId: hotel.id, entity: 'Hotel', action: 'CREATE' } }));

    const duplicate = await call(admin.accessToken, 'POST', '/chain/hotels', input);
    assert.equal(duplicate.statusCode, 409);

    const euroRooms = await call(admin.accessToken, 'POST', '/chain/hotels', { ...input, code: 'EUR-01', currency: 'EUR' });
    assert.equal(euroRooms.statusCode, 422, 'para birimi farklı otele oda tipi kopyalanmaz');
    const euro = await call(admin.accessToken, 'POST', '/chain/hotels', { ...input, code: 'EUR-02', currency: 'EUR', copy: ['GENERAL', 'TAXES'] });
    assert.equal(euro.statusCode, 201, euro.body);
    assert.deepEqual(euro.json().data.skipped.sort(), ['earlyCheckInFeeValue', 'largePaymentThreshold']);
    const euroRow = await db.hotel.findFirst({ where: { id: euro.json().data.hotel.id } });
    assert.equal(String(euroRow.largePaymentThreshold), '0');
    assert.equal(euroRow.earlyCheckInFeeMode, 'NONE');

    const badZone = await call(admin.accessToken, 'POST', '/chain/hotels', { ...input, code: 'TZ-01', timezone: 'Mars/Phobos' });
    assert.equal(badZone.statusCode, 422, 'geçersiz saat dilimi');
    const foreignSource = await call(admin.accessToken, 'POST', '/chain/hotels', { ...input, code: 'SRC-01', sourceHotelId: hotelC.id });
    assert.equal(foreignSource.statusCode, 422, 'erişimi olmayan / zincir dışı kaynak');

    const after = await login('admin@test.local');
    assert.equal(after.hotelCount, 3, 'kurduğu oteller seçicide');
  });

  it('pano ve rapor yalnız zinciri görme yetkisi olan otelleri gösterir; gizli otel sayılır', async () => {
    await makeGroup(hotelA, hotelB);
    await grant(users.admin.id, hotelB.id, 'FRONT_DESK');
    const admin = await login('admin@test.local');

    const dashboard = await call(admin.accessToken, 'GET', '/chain/dashboard');
    assert.equal(dashboard.statusCode, 200, dashboard.body);
    const data = dashboard.json().data;
    assert.deepEqual(data.hotels.map((row) => row.hotelId), [hotelA.id]);
    assert.equal(data.hiddenHotels, 1, 'B otelinde resepsiyon rolü zinciri göremez');
    assert.equal(data.totals.length, 1);
    assert.equal(data.totals[0].currency, 'TRY');

    await db.userHotel.updateMany({ where: { userId: users.admin.id, hotelId: hotelB.id }, data: { role: 'MANAGER' } });
    const { invalidateMembership } = await import('../../lib/memberships.js');
    invalidateMembership(users.admin.id, hotelB.id);
    const report = await call(admin.accessToken, 'GET', '/chain/report?from=2026-11-01&to=2026-11-30');
    assert.equal(report.statusCode, 200, report.body);
    assert.deepEqual(report.json().data.hotels.map((row) => row.code).sort(), [hotelA.code, hotelB.code].sort(), 'müdür rolü zinciri görür');
    assert.equal(report.json().data.hiddenHotels, 0);

    const bad = await call(admin.accessToken, 'GET', '/chain/report?from=2026-12-01&to=2026-11-01');
    assert.equal(bad.statusCode, 400);
    const desk = await login('desk@test.local');
    assert.equal((await call(desk.accessToken, 'GET', '/chain/dashboard')).statusCode, 403);
  });

  it('erişim verme hedef oteldeki yetkiye bağlı: yükseltme yok, kendine dokunulmaz, zincir dışı kişi bulunmaz', async () => {
    await makeGroup(hotelA, hotelB);
    await grant(users.admin.id, hotelB.id, 'MANAGER');
    const admin = await login('admin@test.local');

    // B'de müdür (kullanıcı yönetme izni yok): B'de kimseye erişim veremez.
    const noRight = await call(admin.accessToken, 'PUT', `/chain/users/${users.desk.id}/hotels/${hotelB.id}`, { role: 'FRONT_DESK' });
    assert.equal(noRight.statusCode, 403);
    assert.match(noRight.json().error, /kullanıcı yönetme yetkiniz yok/);

    // B'nin matrisinde müdüre kullanıcı yönetme izni: verir ama yönetici veremez.
    const managerPerms = [...contracts.DEFAULT_ROLE_PERMISSIONS.MANAGER, 'users.manage'];
    await db.rolePermission.createMany({ data: managerPerms.map((permission) => ({ hotelId: hotelB.id, role: 'MANAGER', permission })) });
    await db.hotel.update({ where: { id: hotelB.id }, data: { permissionCatalog: [...contracts.PERMISSION_VALUES] } });
    // Matris doğrudan yazıldı (ekrandan değil): B'nin önbellekteki matrisi düşürülür.
    const { cache } = await import('../../lib/cache.js');
    cache.invalidatePrefix(`roles:${hotelB.id}:`);
    const okDesk = await call(admin.accessToken, 'PUT', `/chain/users/${users.desk.id}/hotels/${hotelB.id}`, { role: 'FRONT_DESK' });
    assert.equal(okDesk.statusCode, 200, okDesk.body);
    const toAdmin = await call(admin.accessToken, 'PUT', `/chain/users/${users.desk.id}/hotels/${hotelB.id}`, { role: 'ADMIN' });
    assert.equal(toAdmin.statusCode, 403);
    assert.match(toAdmin.json().error, /Yönetici erişimini/);

    const self = await call(admin.accessToken, 'PUT', `/chain/users/${users.admin.id}/hotels/${hotelB.id}`, { role: 'ADMIN' });
    assert.equal(self.statusCode, 403, 'kendine rol yükseltemez');
    const home = await call(admin.accessToken, 'PUT', `/chain/users/${users.bodrum.id}/hotels/${hotelB.id}`, { role: 'FRONT_DESK' });
    assert.equal(home.statusCode, 403, 'ana otel erişimle verilmez');
    const outsider = await call(admin.accessToken, 'PUT', `/chain/users/${users.outsider.id}/hotels/${hotelB.id}`, { role: 'FRONT_DESK' });
    assert.equal(outsider.statusCode, 404, 'zincir dışı kişi kimliğiyle bulunamaz');
    const outsideHotel = await call(admin.accessToken, 'PUT', `/chain/users/${users.desk.id}/hotels/${hotelC.id}`, { role: 'FRONT_DESK' });
    assert.equal(outsideHotel.statusCode, 422, 'zincir dışı otele erişim verilmez');

    const list = await call(admin.accessToken, 'GET', '/chain/users?limit=2');
    assert.equal(list.statusCode, 200);
    const page = list.json().data;
    assert.equal(page.items.length, 2);
    assert.ok(page.nextCursor);
    const second = await call(admin.accessToken, 'GET', `/chain/users?limit=2&cursor=${page.nextCursor}`);
    const all = [...page.items, ...second.json().data.items];
    assert.equal(new Set(all.map((row) => row.id)).size, all.length, 'imleç tekrar etmez');
    assert.equal(all.some((row) => row.id === users.outsider.id), false, 'zincir dışı kişi listede yok');
    const deskRow = all.find((row) => row.id === users.desk.id);
    assert.deepEqual(deskRow.memberships.map((row) => [row.hotelId, row.role]), [[hotelB.id, 'FRONT_DESK']]);
    const rights = page.hotels.find((hotel) => hotel.id === hotelB.id);
    assert.deepEqual([rights.myRole, rights.canManageUsers], ['MANAGER', true]);
    assert.equal((await call(admin.accessToken, 'GET', '/chain/users?cursor=bozuk')).statusCode, 422, 'bozuk imleç');
  });

  it('zincirden kullanıcı: ana otelde kullanıcı yönetme yetkisi ister', async () => {
    await makeGroup(hotelA, hotelB);
    await grant(users.admin.id, hotelB.id, 'MANAGER');
    const admin = await login('admin@test.local');
    const payload = { homeHotelId: hotelB.id, email: 'yeni@test.local', name: 'Yeni', role: 'FRONT_DESK', password: 'parola-yeni-1' };
    assert.equal((await call(admin.accessToken, 'POST', '/chain/users', payload)).statusCode, 403);
    const created = await call(admin.accessToken, 'POST', '/chain/users', { ...payload, homeHotelId: hotelA.id });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await db.user.findFirst({ where: { email: 'yeni@test.local' } })).hotelId, hotelA.id);
  });

  it('var olan oteli ekleme / çıkarma: o otelde yönetici olmak gerekir; son otel çıkınca zincir kapanır', async () => {
    await makeGroup(hotelA);
    const admin = await login('admin@test.local');
    assert.equal((await call(admin.accessToken, 'POST', `/chain/hotels/${hotelC.id}/attach`, {})).statusCode, 403, 'C\'de erişimi yok');
    await grant(users.admin.id, hotelC.id, 'MANAGER');
    assert.equal((await call(admin.accessToken, 'POST', `/chain/hotels/${hotelC.id}/attach`, {})).statusCode, 403, 'C\'de yönetici değil');
    await db.userHotel.updateMany({ where: { userId: users.admin.id, hotelId: hotelC.id }, data: { role: 'ADMIN' } });
    const { invalidateMembership } = await import('../../lib/memberships.js');
    invalidateMembership(users.admin.id, hotelC.id);
    const attached = await call(admin.accessToken, 'POST', `/chain/hotels/${hotelC.id}/attach`, {});
    assert.equal(attached.statusCode, 200, attached.body);
    const list = await call(admin.accessToken, 'GET', '/chain/hotels');
    assert.deepEqual(list.json().data.items.map((row) => row.code).sort(), [hotelA.code, hotelC.code].sort());
    assert.equal((await call(admin.accessToken, 'POST', `/chain/hotels/${hotelC.id}/attach`, {})).statusCode, 409);

    assert.equal((await call(admin.accessToken, 'POST', `/chain/hotels/${hotelC.id}/detach`, {})).statusCode, 200);
    const last = await call(admin.accessToken, 'POST', `/chain/hotels/${hotelA.id}/detach`, {});
    assert.equal(last.json().data.groupDeleted, true);
    assert.equal(await db.hotelGroup.count(), 0);
  });

  it('personel kimliği erişimle tanınır: zildeki "ben" o oteldeki rolle', async () => {
    await grant(users.desk.id, hotelB.id, 'MANAGER');
    const { runWithContext } = await import('@hotelos/core');
    const { currentStaff } = await import('../../lib/staff.js');
    const staff = await runWithContext({ actor: 'desk@test.local', correlationId: randomUUID() }, () => currentStaff(db, hotelB.id));
    assert.equal(staff?.id, users.desk.id);
    assert.equal(staff.role, 'MANAGER');
    const none = await runWithContext({ actor: 'desk@test.local', correlationId: randomUUID() }, () => currentStaff(db, hotelC.id));
    assert.equal(none, null);
  });

  it('kişisel tercih (dil, modül 60) erişimle açılan otelde de yazılır; erişim kalkınca yazılamaz', async () => {
    await grant(users.desk.id, hotelB.id, 'MANAGER');
    const home = await login('desk@test.local');
    const away = (await call(home.accessToken, 'POST', '/auth/switch-hotel', { hotelId: hotelB.id, refreshToken: home.refreshToken })).json().data;
    const saved = await call(away.accessToken, 'PATCH', '/auth/me/preferences', { locale: 'en' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.user.locale, 'en');
    assert.equal(saved.json().data.user.role, 'MANAGER', 'dönen rol açık oteldeki rol');
    assert.equal((await db.user.findUnique({ where: { id: users.desk.id } })).locale, 'en');

    await db.userHotel.deleteMany({ where: { userId: users.desk.id, hotelId: hotelB.id } });
    const { clearMembershipCache } = await import('../../lib/memberships.js');
    clearMembershipCache();
    const denied = await call(away.accessToken, 'PATCH', '/auth/me/preferences', { locale: 'tr' });
    assert.equal(denied.statusCode, 401);
    assert.equal((await db.user.findUnique({ where: { id: users.desk.id } })).locale, 'en', 'erişimi kalkmış oturum tercih yazamaz');
  });

  it('pasife alma: kişi başka bir otelin erişimle TEK yöneticisiyse reddedilir; başka yönetici gelince geçer', async () => {
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    const fresh = await db.hotel.create({ data: { name: 'Yeni Otel', code: `NEW-${suffix}`, currency: 'TRY' } });
    await grant(users.desk.id, fresh.id, 'ADMIN');
    const admin = await login('admin@test.local');
    const deactivate = async () => {
      const row = await db.user.findUnique({ where: { id: users.desk.id } });
      return call(admin.accessToken, 'PUT', `/users/${row.id}`, { email: row.email, name: row.name, role: row.role, isActive: false, expectedUpdatedAt: row.updatedAt.toISOString() });
    };

    const blocked = await deactivate();
    assert.equal(blocked.statusCode, 422, blocked.body);
    assert.match(blocked.json().error, /Yeni Otel otelinin tek yöneticisi/);
    assert.equal((await db.user.findUnique({ where: { id: users.desk.id } })).isActive, true);

    // Pasif yönetici sayılmaz; aktif ikinci yönetici (erişimle) gelince pasife alma geçer.
    await grant(users.manager.id, fresh.id, 'ADMIN');
    await db.user.update({ where: { id: users.manager.id }, data: { isActive: false } });
    assert.equal((await deactivate()).statusCode, 422, 'pasif kişi yönetici sayılmaz');
    await db.user.update({ where: { id: users.manager.id }, data: { isActive: true } });
    const allowed = await deactivate();
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.equal((await db.user.findUnique({ where: { id: users.desk.id } })).isActive, false);
  });
});
