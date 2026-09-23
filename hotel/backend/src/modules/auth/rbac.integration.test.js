import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * RBAC uçtan uca (entegrasyon) — gerçek PostgreSQL gerektirir.
 *
 * Yetkilendirme güvenlik-kritik: "izin kontrolü sessizce kapalı kaldı" durumu
 * ancak gerçek istek/yanıtla yakalanır. Buradaki iddialar HTTP katmanında:
 * giriş, token'sız 401, yetkisiz rol 403, kullanıcı CRUD, matris değişiminin
 * anında etkisi, refresh rotation.
 *
 * Çalıştırmak için (bkz. README §3):
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy -w @hotelos/hotel-backend
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration -w @hotelos/hotel-backend
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('RBAC (entegrasyon)', { skip }, () => {
  /** @type {import('fastify').FastifyInstance} */ let app;
  /** @type {any} */ let prismaUnfiltered;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;

  const PASSWORD = 'parola-12345';

  before(async () => {
    // db.js import anında PrismaClient kuruyor; adres import'tan önce ayarlanmalı.
    process.env.DATABASE_URL = TEST_DB;
    // Login hız sınırı çok sayıda test isteğini boğmasın.
    process.env.AUTH_RATE_LIMIT_MAX = '10000';

    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    ({ prismaUnfiltered } = await import('../../db.js'));
    const { buildApp } = await import('../../app.js');
    app = await buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await prismaUnfiltered?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prismaUnfiltered);
    const hotel = await prismaUnfiltered.hotel.create({
      data: { name: 'Test Otel', code: `TEST-${randomUUID().slice(0, 8)}` },
    });
    hotelId = hotel.id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4); // düşük round: test hızlı olsun
    await prismaUnfiltered.user.createMany({
      data: [
        { hotelId, email: 'admin@test.local', name: 'Admin', role: 'ADMIN', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
  });

  const login = async (email, password = PASSWORD) => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return response;
  };
  const asToken = async (email) => (await login(email)).json().data.accessToken;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });

  it('doğru bilgiyle giriş token + izinleri döndürür', async () => {
    const response = await login('admin@test.local');
    assert.equal(response.statusCode, 200);
    const { data } = response.json();
    assert.ok(data.accessToken && data.refreshToken);
    assert.equal(data.user.email, 'admin@test.local');
    assert.ok(data.permissions.includes('users.manage'));
  });

  it('yanlış şifre ve olmayan kullanıcı aynı 401 mesajını verir (enumeration yok)', async () => {
    const wrongPassword = await login('admin@test.local', 'yanlis');
    const noUser = await login('yok@test.local', 'yanlis');
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(noUser.statusCode, 401);
    assert.equal(wrongPassword.json().error, noUser.json().error);
  });

  it('token olmadan korumalı uç 401 döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/users' });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'UNAUTHORIZED');
  });

  it('FRONT_DESK kullanıcı yönetimine giremez (403), ADMIN girer (200)', async () => {
    const forbidden = await app.inject({ method: 'GET', url: '/users', headers: bearer(await asToken('resepsiyon@test.local')) });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().code, 'FORBIDDEN');

    const allowed = await app.inject({ method: 'GET', url: '/users', headers: bearer(await asToken('admin@test.local')) });
    assert.equal(allowed.statusCode, 200);
    assert.ok(Array.isArray(allowed.json().data.items));
  });

  it('kullanıcı eklenir, pasife alınınca giriş yapamaz', async () => {
    const token = await asToken('admin@test.local');
    const created = await app.inject({
      method: 'POST',
      url: '/users',
      headers: bearer(token),
      payload: { email: 'yeni@test.local', name: 'Yeni', role: 'HOUSEKEEPING', password: PASSWORD },
    });
    assert.equal(created.statusCode, 201);
    const user = created.json().data;

    const deactivated = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: bearer(token),
      payload: { email: user.email, name: user.name, role: user.role, isActive: false, expectedUpdatedAt: user.updatedAt },
    });
    assert.equal(deactivated.statusCode, 200);

    const denied = await login('yeni@test.local');
    assert.equal(denied.statusCode, 401);
  });

  it('son aktif yöneticinin rolü düşürülemez', async () => {
    const token = await asToken('admin@test.local');
    const list = await app.inject({ method: 'GET', url: '/users', headers: bearer(token) });
    const admin = list.json().data.items.find((u) => u.email === 'admin@test.local');

    const response = await app.inject({
      method: 'PUT',
      url: `/users/${admin.id}`,
      headers: bearer(token),
      payload: { email: admin.email, name: admin.name, role: 'FRONT_DESK', isActive: true, expectedUpdatedAt: admin.updatedAt },
    });
    assert.equal(response.statusCode, 422);
  });

  it('matris değişince izin anında etkili olur (token yenilemeden)', async () => {
    const adminToken = await asToken('admin@test.local');
    const saved = await app.inject({
      method: 'PUT',
      url: '/roles/permissions',
      headers: bearer(adminToken),
      payload: { grants: [{ role: 'FRONT_DESK', permissions: ['users.view'] }] },
    });
    assert.equal(saved.statusCode, 200);

    const session = (await login('resepsiyon@test.local')).json().data;
    assert.ok(session.permissions.includes('users.view'));
    const allowed = await app.inject({ method: 'GET', url: '/users', headers: bearer(session.accessToken) });
    assert.equal(allowed.statusCode, 200);
  });

  it('matris kaydından sonra kataloğa eklenen izin rolün varsayılanına düşer; kaldırılan izin geri gelmez', async () => {
    const { cache } = await import('../../lib/cache.js');
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    await prismaUnfiltered.user.create({ data: { hotelId, email: 'mudur@test.local', name: 'Müdür', role: 'MANAGER', passwordHash } });

    // Yönetici matrisi kaydeder: müdürden oda envanteri yönetimini bilerek kaldırır.
    const saved = await app.inject({
      method: 'PUT',
      url: '/roles/permissions',
      headers: bearer(await asToken('admin@test.local')),
      payload: {
        grants: [
          { role: 'MANAGER', permissions: ['rooms.view', 'reservations.view', 'reservations.manage'] },
          { role: 'FRONT_DESK', permissions: ['rooms.view', 'reservations.view', 'reservations.manage'] },
        ],
      },
    });
    assert.equal(saved.statusCode, 200);

    // Matris, fiyat izni kataloğa girmeden önce kaydedilmiş gibi: o izin karar verilmemiş sayılır.
    await prismaUnfiltered.$executeRaw`UPDATE "Hotel" SET "permissionCatalog" = array_remove("permissionCatalog", 'reservations.price_override') WHERE "id" = ${hotelId}`;
    cache.invalidatePrefix(`roles:${hotelId}:`);

    const manager = (await login('mudur@test.local')).json().data.permissions;
    assert.ok(manager.includes('reservations.price_override'), 'yeni izin müdürün varsayılanından gelmeli');
    assert.ok(!manager.includes('rooms.manage'), 'yöneticinin kaldırdığı izin geri gelmemeli');
    const desk = (await login('resepsiyon@test.local')).json().data.permissions;
    assert.ok(!desk.includes('reservations.price_override'), 'ön büronun varsayılanında yok');

    // Matris yeniden kaydedilince izin artık karar verilmiş: gönderilmediyse kapalı.
    await app.inject({
      method: 'PUT',
      url: '/roles/permissions',
      headers: bearer(await asToken('admin@test.local')),
      payload: { grants: [{ role: 'MANAGER', permissions: ['reservations.view'] }] },
    });
    assert.ok(!(await login('mudur@test.local')).json().data.permissions.includes('reservations.price_override'));
  });

  it('matris kaydı otel kartının sürümünü değiştirmez (ayarlar ekranı "başkası değiştirdi" demez)', async () => {
    const before = await prismaUnfiltered.hotel.findUnique({ where: { id: hotelId }, select: { updatedAt: true } });
    await app.inject({
      method: 'PUT',
      url: '/roles/permissions',
      headers: bearer(await asToken('admin@test.local')),
      payload: { grants: [{ role: 'FRONT_DESK', permissions: ['reservations.view'] }] },
    });
    const after = await prismaUnfiltered.hotel.findUnique({ where: { id: hotelId }, select: { updatedAt: true, permissionCatalog: true } });
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert.ok(after.permissionCatalog.includes('reservations.price_override'));
  });

  it('elle fiyat ek izin ister: ön büro 403, izni olan açar', async () => {
    const roomType = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    await prismaUnfiltered.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
    const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const body = () => ({
      guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001' },
      roomTypeId: roomType.id,
      adults: 2,
      boardType: 'BB',
      checkIn: inDays(10),
      checkOut: inDays(12),
      requestId: randomUUID(),
      manualTotal: '1500',
      priceNote: 'kurumsal anlaşma',
    });

    const denied = await app.inject({ method: 'POST', url: '/reservations', headers: bearer(await asToken('resepsiyon@test.local')), payload: body() });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().code, 'FORBIDDEN');
    assert.equal(await prismaUnfiltered.reservation.count({ where: { hotelId } }), 0);

    const allowed = await app.inject({ method: 'POST', url: '/reservations', headers: bearer(await asToken('admin@test.local')), payload: body() });
    assert.equal(allowed.statusCode, 201);
    assert.equal(allowed.json().data.reservation.priceMode, 'MANUAL');
    assert.equal(allowed.json().data.reservation.totalPrice, '1500.00');
  });

  it('ön büro izinleri: kat hizmetleri gidecekleri görür ama giriş yapamaz; ön büro bakiyeyle çıkış yapamaz', async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    await prismaUnfiltered.user.create({ data: { hotelId, email: 'kat@test.local', name: 'Kat', role: 'HOUSEKEEPING', passwordHash } });
    const housekeeping = bearer(await asToken('kat@test.local'));
    const desk = bearer(await asToken('resepsiyon@test.local'));
    const stay = randomUUID();
    const version = new Date().toISOString();
    const identity = { idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR' };

    const departures = await app.inject({ method: 'GET', url: '/front-desk/departures', headers: housekeeping });
    assert.equal(departures.statusCode, 200);
    assert.ok(Array.isArray(departures.json().data.items));
    const checkIn = await app.inject({
      method: 'POST',
      url: `/front-desk/stays/${stay}/check-in`,
      headers: housekeeping,
      payload: { expectedUpdatedAt: version, guest: identity },
    });
    assert.equal(checkIn.statusCode, 403);
    // Giriş önizlemesi kimliğin tamamını döndürür: görüntüleme izni yetmez.
    assert.equal((await app.inject({ method: 'GET', url: `/front-desk/stays/${stay}/check-in`, headers: housekeeping })).statusCode, 403);

    // Ön büro girişe yetkili (kayıt yok → 404, izin geçti).
    assert.equal((await app.inject({ method: 'GET', url: `/front-desk/stays/${stay}/check-in`, headers: desk })).statusCode, 404);
    const openBalance = await app.inject({
      method: 'POST',
      url: `/front-desk/stays/${stay}/check-out`,
      headers: desk,
      payload: { expectedUpdatedAt: version, allowOpenBalance: true, openBalanceReason: 'Şirket ödeyecek' },
    });
    assert.equal(openBalance.statusCode, 403);
    assert.equal(openBalance.json().code, 'FORBIDDEN');
    // Bakiyesiz çıkış ön büroya açık (kayıt yok → 404).
    const plain = await app.inject({ method: 'POST', url: `/front-desk/stays/${stay}/check-out`, headers: desk, payload: { expectedUpdatedAt: version } });
    assert.equal(plain.statusCode, 404);
  });

  it('refresh rotation: kullanılan token bir daha çalışmaz', async () => {
    const { refreshToken } = (await login('admin@test.local')).json().data;
    const first = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    assert.equal(first.statusCode, 200);

    const reused = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    assert.equal(reused.statusCode, 401);
  });
});
