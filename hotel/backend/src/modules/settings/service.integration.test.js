import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Entegrasyon testleri — gerçek PostgreSQL gerektirir.
 *
 * Birim testleri saf kuralları doğruluyor; buradaki iddialar ise ancak
 * veritabanıyla doğrulanabilir: soft-delete filtresi, kısmi unique index,
 * optimistic lock, sezon çakışması EXCLUDE kısıtı, audit ve outbox kayıtları.
 * Bunlar "sessizce yanlış çalışırsa aylar sonra fark edilir" sınıfındandır.
 *
 * Çalıştırmak için:
 *   1. Boş bir test veritabanı hazırlayın (üretim/geliştirme veritabanı OLMASIN —
 *      bu testler tablo içeriğini siler).
 *   2. TEST_DATABASE_URL="postgresql://..." ile şemayı uygulayın:
 *      DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *   3. npm run test:integration
 *
 * TEST_DATABASE_URL yoksa tüm blok atlanır — CI'sız ortamda kırmızı test
 * bırakmamak için.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('ayarlar servisi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let prisma;
  /** @type {any} */ let prismaUnfiltered;
  /** @type {any} */ let service;
  /** @type {any} */ let runWithContext;
  let hotelId;

  before(async () => {
    // db.js, import anında PrismaClient kuruyor; bu yüzden bağlantı adresi
    // import'tan önce ayarlanmalı — dinamik import bunun için.
    process.env.DATABASE_URL = TEST_DB;
    const db = await import('../../db.js');
    prisma = db.prisma;
    prismaUnfiltered = db.prismaUnfiltered;
    service = await import('./service.js');
    ({ runWithContext } = await import('@hotelos/core'));
  });

  after(async () => {
    await prismaUnfiltered?.$disconnect();
  });

  beforeEach(async () => {
    // Bağımlı tablolar önce; yabancı anahtar kısıtları yüzünden sıra önemli.
    await prismaUnfiltered.auditLog.deleteMany({});
    await prismaUnfiltered.eventLog.deleteMany({});
    await prismaUnfiltered.folioItem.deleteMany({});
    await prismaUnfiltered.season.deleteMany({});
    await prismaUnfiltered.tax.deleteMany({});
    await prismaUnfiltered.room.deleteMany({});
    await prismaUnfiltered.roomType.deleteMany({});
    await prismaUnfiltered.hotel.deleteMany({});

    const hotel = await prismaUnfiltered.hotel.create({
      data: { name: 'Test Otel', code: `TEST-${randomUUID().slice(0, 8)}` },
    });
    hotelId = hotel.id;
  });

  /** Servisi, audit'in "kim" alanını dolduracak bir bağlamda çalıştırır. */
  const asUser = (fn) => runWithContext({ correlationId: randomUUID(), actor: 'test@hotel.local' }, fn);

  const roomTypeInput = (overrides = {}) => ({
    code: 'STD',
    name: 'Standart',
    capacityAdults: 2,
    capacityChildren: 1,
    basePrice: '2500.00',
    description: null,
    ...overrides,
  });

  const seasonInput = (overrides = {}) => ({
    name: 'Yaz',
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-09-15T00:00:00.000Z'),
    multiplier: '1.3',
    ...overrides,
  });

  describe('soft-delete', () => {
    it('silinen oda tipi listelerde görünmez', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await asUser(() => service.deleteRoomType(hotelId, created.id));

      const page = await service.listRoomTypes(hotelId, { page: 1, pageSize: 25 });
      assert.equal(page.meta.total, 0);
      assert.equal(page.items.length, 0);
    });

    it('silinen kayıt veritabanında durur (kalıcı silme yok)', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await asUser(() => service.deleteRoomType(hotelId, created.id));

      const raw = await prismaUnfiltered.roomType.findUnique({ where: { id: created.id } });
      assert.ok(raw, 'satır silinmemeli');
      assert.ok(raw.deletedAt, 'deletedAt dolu olmalı');
    });

    it('silinen oda tipinin kodu tekrar kullanılabilir (kısmi unique index)', async () => {
      const first = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await asUser(() => service.deleteRoomType(hotelId, first.id));

      // Düz unique index olsaydı burası "zaten var" hatası verirdi.
      const second = await asUser(() => service.createRoomType(hotelId, roomTypeInput({ name: 'Standart v2' })));
      assert.equal(second.code, 'STD');
      assert.notEqual(second.id, first.id);
    });

    it('aynı kod aynı anda iki kez eklenemez', async () => {
      await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await assert.rejects(
        () => asUser(() => service.createRoomType(hotelId, roomTypeInput({ name: 'Kopya' }))),
        (error) => error.statusCode === 409,
      );
    });
  });

  describe('optimistic lock', () => {
    it('güncel sürümle güncelleme başarılı', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      const updated = await asUser(() =>
        service.updateRoomType(hotelId, created.id, {
          ...roomTypeInput({ name: 'Yeni ad' }),
          expectedUpdatedAt: new Date(created.updatedAt),
        }),
      );
      assert.equal(updated.name, 'Yeni ad');
    });

    it('bayat sürümle güncelleme 409 verir', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      const staleVersion = new Date(created.updatedAt);

      await asUser(() =>
        service.updateRoomType(hotelId, created.id, {
          ...roomTypeInput({ name: 'Birinci' }),
          expectedUpdatedAt: staleVersion,
        }),
      );

      await assert.rejects(
        () =>
          asUser(() =>
            service.updateRoomType(hotelId, created.id, {
              ...roomTypeInput({ name: 'İkinci' }),
              expectedUpdatedAt: staleVersion,
            }),
          ),
        (error) => error.code === 'STALE_WRITE' && error.statusCode === 409,
      );
    });

    it('olmayan kayıt 404 verir (409 değil)', async () => {
      await assert.rejects(
        () =>
          asUser(() =>
            service.updateRoomType(hotelId, randomUUID(), {
              ...roomTypeInput(),
              expectedUpdatedAt: new Date(),
            }),
          ),
        (error) => error.statusCode === 404,
      );
    });
  });

  describe('sezon çakışması', () => {
    it('çakışan sezon reddedilir', async () => {
      await asUser(() => service.createSeason(hotelId, seasonInput()));
      await assert.rejects(
        () =>
          asUser(() =>
            service.createSeason(
              hotelId,
              seasonInput({ name: 'Sonbahar', startDate: new Date('2026-09-10T00:00:00.000Z') }),
            ),
          ),
        (error) => /çakış/i.test(error.message),
      );
    });

    it('uç uca değen sezonlar da çakışma sayılır', async () => {
      await asUser(() => service.createSeason(hotelId, seasonInput()));
      await assert.rejects(() =>
        asUser(() =>
          service.createSeason(
            hotelId,
            seasonInput({
              name: 'Sonbahar',
              startDate: new Date('2026-09-15T00:00:00.000Z'),
              endDate: new Date('2026-10-31T00:00:00.000Z'),
            }),
          ),
        ),
      );
    });

    it('çakışmayan sezon kabul edilir', async () => {
      await asUser(() => service.createSeason(hotelId, seasonInput()));
      const autumn = await asUser(() =>
        service.createSeason(
          hotelId,
          seasonInput({
            name: 'Sonbahar',
            startDate: new Date('2026-09-16T00:00:00.000Z'),
            endDate: new Date('2026-10-31T00:00:00.000Z'),
          }),
        ),
      );
      assert.equal(autumn.name, 'Sonbahar');
    });

    it('veritabanı kısıtı uygulama kontrolü atlansa da çakışmayı engeller', async () => {
      // Servis katmanını baypas edip doğrudan yazıyoruz: garantinin kodda değil
      // veritabanında olduğunu doğrulamak için.
      await asUser(() => service.createSeason(hotelId, seasonInput()));
      await assert.rejects(
        () =>
          prismaUnfiltered.season.create({
            data: {
              hotelId,
              name: 'Kaçak',
              startDate: new Date('2026-07-01T00:00:00.000Z'),
              endDate: new Date('2026-07-10T00:00:00.000Z'),
              multiplier: '2',
            },
          }),
        /Season_no_overlap|exclusion|constraint/i,
      );
    });

    it('silinen sezonun tarihleri yeniden kullanılabilir', async () => {
      const summer = await asUser(() => service.createSeason(hotelId, seasonInput()));
      await asUser(() => service.deleteSeason(hotelId, summer.id));

      const again = await asUser(() => service.createSeason(hotelId, seasonInput({ name: 'Yaz 2' })));
      assert.equal(again.name, 'Yaz 2');
    });
  });

  describe('bağımlılık kontrolü', () => {
    it('odası olan oda tipi silinemez ve sayıyı bildirir', async () => {
      const roomType = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await prismaUnfiltered.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });

      await assert.rejects(
        () => asUser(() => service.deleteRoomType(hotelId, roomType.id)),
        (error) => error.code === 'IN_USE' && error.details.usage.oda === 1,
      );
    });
  });

  describe('denetim izi ve event kaydı', () => {
    it('ekleme audit ve event bırakır', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));

      const audit = await prismaUnfiltered.auditLog.findFirst({
        where: { entity: 'RoomType', entityId: created.id },
      });
      assert.equal(audit.action, 'CREATE');
      assert.equal(audit.actor, 'test@hotel.local');
      assert.equal(audit.after.code, 'STD');

      const event = await prismaUnfiltered.eventLog.findFirst({ where: { name: 'settings.roomType.created' } });
      assert.ok(event, 'event kaydedilmeli');
      assert.equal(event.payload.id, created.id);
      assert.ok(event.publishedAt, 'commit sonrası yayınlanmış olmalı');
      assert.equal(event.correlationId, audit.correlationId, 'audit ve event aynı zincirde olmalı');
    });

    it('güncelleme yalnızca değişen alanları işaretler', async () => {
      const created = await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      await asUser(() =>
        service.updateRoomType(hotelId, created.id, {
          ...roomTypeInput({ name: 'Standart Plus' }),
          expectedUpdatedAt: new Date(created.updatedAt),
        }),
      );

      const audit = await prismaUnfiltered.auditLog.findFirst({
        where: { entity: 'RoomType', entityId: created.id, action: 'UPDATE' },
      });
      assert.deepEqual(audit.changedFields, ['name']);
      assert.equal(audit.before.name, 'Standart');
      assert.equal(audit.after.name, 'Standart Plus');
    });

    it('başarısız işlem ne veri ne audit ne event bırakır', async () => {
      await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      const auditBefore = await prismaUnfiltered.auditLog.count();
      const eventsBefore = await prismaUnfiltered.eventLog.count();

      await assert.rejects(() => asUser(() => service.createRoomType(hotelId, roomTypeInput())));

      assert.equal(await prismaUnfiltered.auditLog.count(), auditBefore, 'audit yazılmamalı');
      assert.equal(await prismaUnfiltered.eventLog.count(), eventsBefore, 'event yazılmamalı');
      assert.equal(await prisma.roomType.count({ where: { hotelId } }), 1, 'ikinci kayıt oluşmamalı');
    });
  });

  describe('sıcak okuma cache', () => {
    it('yazma sonrası cache tazelenir (event dinleyicisi üzerinden)', async () => {
      await asUser(() => service.createRoomType(hotelId, roomTypeInput()));
      const first = await service.getActiveRoomTypes(hotelId);
      assert.equal(first.length, 1);

      await asUser(() => service.createRoomType(hotelId, roomTypeInput({ code: 'DLX', name: 'Deluxe' })));

      // Cache geçersiz kılınmasaydı burada hâlâ 1 görürdük.
      const second = await service.getActiveRoomTypes(hotelId);
      assert.equal(second.length, 2);
    });

    it('sezon çarpanı doğru güne düşer', async () => {
      await asUser(() => service.createSeason(hotelId, seasonInput()));
      const inSeason = await service.getSeasonForDate(hotelId, '2026-07-01');
      const outOfSeason = await service.getSeasonForDate(hotelId, '2026-12-01');

      assert.equal(inSeason.multiplier, '1.3');
      assert.equal(outOfSeason, null);
    });
  });
});
