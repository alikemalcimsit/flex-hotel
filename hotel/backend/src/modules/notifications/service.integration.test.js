import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Bildirim merkezi (modül 9) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: aynı olayın
 * ikinci kez bildirilmemesi, iki göndericinin aynı bildirimi üstlenmemesi,
 * yeniden deneme / kalıcı hata / takılı kalan gönderim, sırrın şifreli durması,
 * zilin kime göründüğü ve birleşmesi, gecikme taramasının iyimser kilidi
 * bozmaması.
 *
 * Sağlayıcılar sahte (ağa çıkılmaz); kayıt defterine aynı adla konuyor.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const ADMIN = 'yonetici@test.local';
const DESK = 'resepsiyon@test.local';
const MAID = 'kat@test.local';
const PASSWORD = 'Smtp-Parola-123';

describe('bildirim merkezi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let service;
  /** @type {any} */ let dispatcher;
  /** @type {any} */ let alerts;
  /** @type {any} */ let jobs;
  /** @type {any} */ let providers;
  /** @type {any} */ let ProviderError;
  /** @type {any} */ let messaging;
  /** @type {any} */ let requests;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let users;
  let room;
  let guest;
  let stay;
  /** @type {Array<{ channel: string, message: object }>} */
  let sent;
  /** @type {Record<string, (message: object) => Promise<object>>} */
  let behavior;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.SETTINGS_SECRET_KEY = randomBytes(32).toString('base64');
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    service = await import('./service.js');
    dispatcher = await import('./dispatcher.js');
    alerts = await import('./staff-alerts.js');
    jobs = await import('./jobs.js');
    providers = await import('./providers/index.js');
    ({ ProviderError } = await import('./providers/provider-error.js'));
    messaging = await import('../messaging/service.js');
    requests = await import('../guest-requests/service.js');

    for (const [channel, name] of [
      ['EMAIL', 'smtp'],
      ['SMS', 'netgsm'],
    ]) {
      providers.registerNotificationProvider({
        channel,
        name,
        send: async (message) => {
          sent.push({ channel, message });
          return behavior[channel](message);
        },
      });
    }
  });

  after(async () => {
    dispatcher.stopDispatcher();
    await db?.$disconnect();
  });

  const today = () => core.calendarDateInTimeZone(ZONE);
  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const eventNames = async () =>
    (await db.eventLog.findMany({ where: { hotelId }, select: { name: true } })).map((row) => row.name);

  beforeEach(async () => {
    await resetDatabase(db);
    sent = [];
    behavior = {
      EMAIL: async () => ({ providerMessageId: `<${randomUUID()}@test>` }),
      SMS: async () => ({ providerMessageId: String(Date.now()) }),
    };

    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: `NTF-${randomUUID().slice(0, 8)}`,
        timezone: ZONE,
        phone: '+90 242 000 00 00',
        phoneCountryCode: '90',
      },
    });
    hotelId = hotel.id;

    const user = (email, role) =>
      db.user.create({ data: { hotelId, email, name: email.split('@')[0], passwordHash: 'x', role } });
    users = {
      admin: await user(ADMIN, 'ADMIN'),
      desk: await user(DESK, 'FRONT_DESK'),
      maid: await user(MAID, 'HOUSEKEEPING'),
    };

    const type = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 },
    });
    room = await db.room.create({ data: { hotelId, number: '204', roomTypeId: type.id, floor: 2 } });
    guest = await db.guest.create({
      data: {
        hotelId,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        email: 'Ayse@Example.com',
        phone: '0532 111 00 01',
        nationality: 'TR',
      },
    });
    stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: type.id,
        roomId: room.id,
        checkIn: today(),
        checkOut: core.addDays(today(), 3),
        status: 'CONFIRMED',
        totalPrice: '3000',
        confirmationCode: `N-${randomUUID().slice(0, 8)}`,
      },
    });

    await service.ensureDefaultTemplates(hotelId, db);
    await as(ADMIN, () =>
      service.saveChannelConfig(hotelId, {
        channel: 'EMAIL',
        enabled: true,
        host: 'smtp.test.local',
        port: 587,
        security: 'STARTTLS',
        username: 'bildirim@deniz.test',
        password: PASSWORD,
        fromName: 'Deniz Otel',
        fromAddress: 'bildirim@deniz.test',
        replyTo: '',
      }),
    );
    await as(ADMIN, () =>
      service.saveChannelConfig(hotelId, {
        channel: 'SMS',
        enabled: true,
        provider: 'NETGSM',
        username: '8503000000',
        password: 'netgsm-parola',
        sender: 'DENIZOTEL',
        quietHoursStart: null,
        quietHoursEnd: null,
      }),
    );
  });

  const enqueueRoom = () => as(DESK, () => service.enqueueTriggerNotifications(hotelId, 'ROOM_ASSIGNED', { reservationId: stay.id, roomId: room.id }));
  const rowsOf = () => db.notification.findMany({ where: { hotelId }, orderBy: { channel: 'asc' } });
  const configOf = (channel) => db.notificationChannelConfig.findFirst({ where: { hotelId, channel } });

  describe('kuyruğa yazma', () => {
    it('giriş günü oda ataması e-posta ve SMS olarak, metni dondurularak sıraya girer', async () => {
      const result = await enqueueRoom();
      assert.equal(result.queued.length, 2);

      const [email, sms] = await rowsOf();
      assert.equal(email.recipient, 'ayse@example.com');
      assert.equal(email.subject, 'Odanız hazır — Deniz Otel');
      assert.match(email.body, /oda numaranız 204/);
      assert.equal(sms.recipient, '905321110001');
      assert.match(sms.body, /Oda numaranız 204/);
      assert.equal(sms.status, 'PENDING');
      assert.equal(sms.params.odaNo, '204');
      assert.equal((await eventNames()).filter((name) => name === 'notification.send.requested').length, 2);
    });

    it('aynı olay ikinci kez işlenirse bildirim açılmaz', async () => {
      await enqueueRoom();
      const again = await enqueueRoom();
      assert.equal(again.queued.length, 0);
      assert.equal(again.duplicates, 2);
      assert.equal(await db.notification.count({ where: { hotelId } }), 2);
    });

    it('günler önceki oda atamasında bildirim gitmez', async () => {
      await db.reservation.update({ where: { id: stay.id }, data: { checkIn: core.addDays(today(), 5), checkOut: core.addDays(today(), 8) } });
      const result = await enqueueRoom();
      assert.equal(result.queued.length, 0);
      assert.match(result.skipped, /Giriş günü değil/);
    });

    it('oda bu arada yine değiştiyse eski oda bildirilmez', async () => {
      const result = await as(DESK, () =>
        service.enqueueTriggerNotifications(hotelId, 'ROOM_ASSIGNED', { reservationId: stay.id, roomId: randomUUID() }),
      );
      assert.equal(result.queued.length, 0);
    });

    it('yabancı misafire İngilizce; İngilizce şablon kapalıysa Türkçe gider', async () => {
      await db.guest.update({ where: { id: guest.id }, data: { nationality: 'DE' } });
      await as(DESK, () => service.enqueueTriggerNotifications(hotelId, 'RESERVATION_CONFIRMED', { reservationId: stay.id }));
      const english = await db.notification.findFirst({ where: { hotelId, channel: 'EMAIL' } });
      assert.equal(english.language, 'en');
      assert.match(english.subject, /Your reservation is confirmed/);

      await db.notification.deleteMany({ where: { hotelId } });
      await db.notificationTemplate.updateMany({ where: { hotelId, language: 'en' }, data: { isActive: false } });
      await as(DESK, () => service.enqueueTriggerNotifications(hotelId, 'RESERVATION_CONFIRMED', { reservationId: stay.id }));
      const fallback = await db.notification.findFirst({ where: { hotelId, channel: 'EMAIL' } });
      assert.equal(fallback.language, 'tr');
    });

    it('bildirim istemeyen misafirin satırı "gönderilmedi" olarak kalır; kapalı kanala satır açılmaz', async () => {
      await db.guest.update({ where: { id: guest.id }, data: { preferences: { notifications: { optOut: ['SMS'] } } } });
      await db.notificationChannelConfig.updateMany({ where: { hotelId, channel: 'EMAIL' }, data: { enabled: false } });
      await enqueueRoom();
      const rows = await rowsOf();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].channel, 'SMS');
      assert.equal(rows[0].status, 'CANCELLED');
      assert.match(rows[0].cancelReason, /istemiyor/);
    });

    it('adresi olmayan misafire o kanaldan bildirim açılmaz ve sebep söylenir', async () => {
      await db.guest.update({ where: { id: guest.id }, data: { email: null } });
      const result = await enqueueRoom();
      assert.equal(result.queued.length, 1);
      assert.match(result.skipped, /e-posta yok/);
    });

    it('SMS sessiz saate denk gelirse sabaha ertelenir, gönderici onu almaz', async () => {
      const wall = core.calendarDateInTimeZone(ZONE);
      assert.ok(wall);
      const { utcToZonedWallTime } = await import('@hotelos/hotel-contracts');
      const now = utcToZonedWallTime(new Date(), ZONE).slice(11);
      const shift = (minutes) => {
        const [h, m] = now.split(':').map(Number);
        const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      };
      const smsConfig = await configOf('SMS');
      await db.notificationChannelConfig.update({
        where: { id: smsConfig.id },
        data: { settings: { ...smsConfig.settings, quietHoursStart: shift(-60), quietHoursEnd: shift(60) } },
      });

      await enqueueRoom();
      const sms = await db.notification.findFirst({ where: { hotelId, channel: 'SMS' } });
      assert.ok(sms.nextAttemptAt > new Date(Date.now() + 30 * 60_000));

      const claimed = await dispatcher.claimDueNotifications(10);
      assert.deepEqual(
        claimed.map((row) => row.channel),
        ['EMAIL'],
      );
    });
  });

  describe('gönderici', () => {
    it('gönderir, sağlayıcı kimliğini yazar ve olay yayınlar', async () => {
      await enqueueRoom();
      const processed = await dispatcher.dispatchDueNotifications();
      assert.equal(processed, 2);
      const rows = await rowsOf();
      assert.deepEqual(rows.map((row) => row.status), ['SENT', 'SENT']);
      assert.ok(rows.every((row) => row.sentAt && row.providerMessageId && row.lockedAt === null));
      const sms = sent.find((entry) => entry.channel === 'SMS');
      assert.equal(sms.message.settings.sender, 'DENIZOTEL');
      assert.equal(sms.message.secret, 'netgsm-parola', 'sır sağlayıcıya çözülerek verilir');
      assert.equal((await eventNames()).filter((name) => name === 'notification.sent').length, 2);
    });

    it('aynı anda çalışan iki gönderici aynı bildirimi üstlenmez', async () => {
      for (let index = 0; index < 5; index += 1) {
        await db.notification.create({
          data: {
            hotelId,
            channel: 'EMAIL',
            source: 'CHECKED_IN',
            recipient: `m${index}@test.local`,
            body: 'Hoş geldiniz',
            nextAttemptAt: new Date(),
          },
        });
      }
      const [a, b] = await Promise.all([dispatcher.claimDueNotifications(5), dispatcher.claimDueNotifications(5)]);
      const ids = [...a, ...b].map((row) => row.id);
      assert.equal(ids.length, 5);
      assert.equal(new Set(ids).size, 5);
    });

    it('geçici hatada artan aralıkla yeniden dener; hak bitince uyarı açar, aynı gün aynı hata tek uyarıda toplanır', async () => {
      behavior.SMS = async () => {
        throw new ProviderError('Netgsm sistem hatası', { code: 'NETGSM_100', retryable: true });
      };
      await db.notificationChannelConfig.updateMany({ where: { hotelId, channel: 'EMAIL' }, data: { enabled: false } });
      await enqueueRoom();

      await dispatcher.dispatchDueNotifications();
      let sms = await db.notification.findFirst({ where: { hotelId, channel: 'SMS' } });
      assert.equal(sms.status, 'PENDING');
      assert.equal(sms.attempts, 1);
      assert.equal(sms.errorCode, 'NETGSM_100');
      const delay = sms.nextAttemptAt.getTime() - Date.now();
      assert.ok(delay > 20_000 && delay <= 30_000, `bekleme ${delay}`);

      // Kalan denemeleri hızlandır.
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        await db.notification.update({ where: { id: sms.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
        await dispatcher.dispatchDueNotifications();
      }
      sms = await db.notification.findFirst({ where: { hotelId, channel: 'SMS' } });
      assert.equal(sms.status, 'FAILED');
      assert.equal(sms.attempts, 5);
      assert.ok(sms.failedAt);

      // İkinci misafir aynı hatayla: uyarı birleşir.
      const other = await db.notification.create({
        data: { hotelId, channel: 'SMS', source: 'CHECKED_IN', recipient: '905550000000', body: 'x', attempts: 4, nextAttemptAt: new Date() },
      });
      await dispatcher.dispatchDueNotifications();
      assert.equal((await db.notification.findFirst({ where: { id: other.id } })).status, 'FAILED');

      const failureAlerts = await db.staffAlert.findMany({ where: { hotelId, kind: 'NOTIFICATION_FAILED' } });
      assert.equal(failureAlerts.length, 1);
      assert.equal(failureAlerts[0].count, 2);
      assert.equal(failureAlerts[0].permission, 'notifications.manage');
    });

    it('kalıcı ayar hatasında hemen vazgeçer, kanala son hatayı yazar ama ayar sürümünü bozmaz', async () => {
      behavior.EMAIL = async () => {
        throw new ProviderError('SMTP kimlik doğrulaması başarısız', { code: 'SMTP_AUTH', retryable: false, configIssue: true });
      };
      const before = await configOf('EMAIL');
      await enqueueRoom();
      await dispatcher.dispatchDueNotifications();

      const email = await db.notification.findFirst({ where: { hotelId, channel: 'EMAIL' } });
      assert.equal(email.status, 'FAILED');
      assert.equal(email.attempts, 1);
      const afterConfig = await configOf('EMAIL');
      assert.match(afterConfig.lastFailureError, /kimlik doğrulaması/);
      assert.equal(afterConfig.updatedAt.getTime(), before.updatedAt.getTime());
    });

    it('sıraya girdikten sonra kanal kapatılırsa gönderilmez', async () => {
      await enqueueRoom();
      await db.notificationChannelConfig.updateMany({ where: { hotelId, channel: 'SMS' }, data: { enabled: false } });
      await dispatcher.dispatchDueNotifications();
      const sms = await db.notification.findFirst({ where: { hotelId, channel: 'SMS' } });
      assert.equal(sms.status, 'CANCELLED');
      assert.equal(sent.filter((entry) => entry.channel === 'SMS').length, 0);
    });

    it('takılı kalan gönderim sıraya geri alınır', async () => {
      const stuck = await db.notification.create({
        data: {
          hotelId,
          channel: 'EMAIL',
          source: 'CHECKED_IN',
          recipient: 'a@test.local',
          body: 'x',
          status: 'SENDING',
          lockedAt: new Date(Date.now() - dispatcher.STALE_SENDING_MS - 60_000),
          attempts: 1,
        },
      });
      const fresh = await db.notification.create({
        data: { hotelId, channel: 'EMAIL', source: 'CHECKED_IN', recipient: 'b@test.local', body: 'x', status: 'SENDING', lockedAt: new Date(), attempts: 1 },
      });
      assert.equal(await dispatcher.recoverStaleNotifications(), 1);
      assert.equal((await db.notification.findFirst({ where: { id: stuck.id } })).status, 'PENDING');
      assert.equal((await db.notification.findFirst({ where: { id: fresh.id } })).status, 'SENDING');
    });

    it('veritabanı kısıtları tutarsız durumu reddeder', async () => {
      await assert.rejects(() =>
        db.notification.create({
          data: { hotelId, channel: 'EMAIL', source: 'CHECKED_IN', recipient: 'a@test.local', body: 'x', status: 'SENDING' },
        }),
      );
      await assert.rejects(() =>
        db.notification.create({
          data: { hotelId, channel: 'EMAIL', source: 'CHECKED_IN', recipient: 'a@test.local', body: 'x', status: 'CANCELLED', cancelledAt: new Date() },
        }),
      );
    });
  });

  describe('geçmiş, tekrar gönderme ve iptal', () => {
    it('tekrar gönderim yeni kayıt açar ve misafir kartındaki güncel adrese gider', async () => {
      await enqueueRoom();
      await dispatcher.dispatchDueNotifications();
      const email = await db.notification.findFirst({ where: { hotelId, channel: 'EMAIL' } });
      await db.guest.update({ where: { id: guest.id }, data: { email: 'yeni@example.com' } });

      const resent = await as(ADMIN, () => service.resendNotification(hotelId, email.id));
      assert.equal(resent.resendOfId, email.id);
      assert.equal(resent.recipient, 'yeni@example.com');
      assert.equal(resent.status, 'PENDING');
      assert.equal(resent.body, email.body);
      const original = await as(ADMIN, () => service.getNotification(hotelId, email.id));
      assert.deepEqual(original.resends.map((row) => row.id), [resent.id]);
    });

    it('sıradaki bildirim tekrar gönderilemez; yalnızca sıradaki iptal edilebilir', async () => {
      await enqueueRoom();
      const [email] = await rowsOf();
      await assert.rejects(() => as(ADMIN, () => service.resendNotification(hotelId, email.id)), (e) => e.code === 'NOT_RESENDABLE');

      const cancelled = await as(ADMIN, () => service.cancelNotification(hotelId, email.id, { reason: 'Misafir istemedi' }));
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancelReason, 'Misafir istemedi');
      await assert.rejects(
        () => as(ADMIN, () => service.cancelNotification(hotelId, email.id, { reason: 'x' })),
        (e) => e.code === 'NOT_PENDING',
      );
      await assert.rejects(() => as(ADMIN, () => service.cancelNotification(hotelId, randomUUID(), { reason: 'x' })), (e) => e.code === 'NOT_FOUND');
    });

    it('geçmiş imleçle atlamadan ilerler; alıcıya göre aranır', async () => {
      for (let index = 0; index < 7; index += 1) {
        await db.notification.create({
          data: { hotelId, channel: 'EMAIL', source: 'CHECKED_OUT', recipient: `misafir${index}@test.local`, body: 'x', status: 'SENT', sentAt: new Date() },
        });
      }
      const seen = [];
      let cursor;
      do {
        const page = await service.listNotifications(hotelId, { limit: 3, cursor });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);

      const found = await service.listNotifications(hotelId, { limit: 30, search: 'misafir3' });
      assert.deepEqual(found.items.map((item) => item.recipient), ['misafir3@test.local']);
    });
  });

  describe('kanal ayarı ve test', () => {
    it('parola şifreli saklanır, API\'de dönmez; parola gönderilmeden kaydetmek onu korur', async () => {
      const row = await configOf('EMAIL');
      assert.ok(row.secret.startsWith('v1:'));
      assert.ok(!row.secret.includes(PASSWORD));

      const listed = await service.getChannelConfigs(hotelId);
      const email = listed.items.find((item) => item.channel === 'EMAIL');
      assert.equal(email.hasSecret, true);
      assert.equal(JSON.stringify(listed).includes(PASSWORD), false);
      assert.equal('secret' in email, false);

      const saved = await as(ADMIN, () =>
        service.saveChannelConfig(hotelId, {
          ...email.settings,
          channel: 'EMAIL',
          enabled: true,
          fromName: 'Deniz Otel Resepsiyon',
          expectedUpdatedAt: new Date(email.updatedAt),
        }),
      );
      assert.equal(saved.settings.fromName, 'Deniz Otel Resepsiyon');
      assert.equal((await configOf('EMAIL')).secret, row.secret);

      const audit = await db.auditLog.findMany({ where: { hotelId, entity: 'NotificationChannelConfig' } });
      assert.equal(JSON.stringify(audit).includes(PASSWORD), false);
    });

    it('bayat sürümle kaydetmek ve eşzamanlı ilk kayıt reddedilir', async () => {
      await assert.rejects(
        () =>
          as(ADMIN, () =>
            service.saveChannelConfig(hotelId, {
              channel: 'SMS',
              enabled: false,
              provider: 'NETGSM',
              username: '',
              sender: '',
              expectedUpdatedAt: new Date('2020-01-01'),
            }),
          ),
        (e) => e.code === 'STALE_WRITE',
      );
      await assert.rejects(
        () => as(ADMIN, () => service.saveChannelConfig(hotelId, { channel: 'SMS', enabled: false, provider: 'NETGSM', username: '', sender: '' })),
        (e) => e.code === 'STALE_WRITE',
      );
    });

    it('parolasız SMS kanalı açılamaz; geçidi olmayan WhatsApp açılamaz', async () => {
      await db.notificationChannelConfig.deleteMany({ where: { hotelId, channel: 'SMS' } });
      await assert.rejects(
        () =>
          as(ADMIN, () =>
            service.saveChannelConfig(hotelId, { channel: 'SMS', enabled: true, provider: 'NETGSM', username: 'u', sender: 'OTEL' }),
          ),
        (e) => e.code === 'VALIDATION',
      );
      await assert.rejects(
        () => as(ADMIN, () => service.saveChannelConfig(hotelId, { channel: 'WHATSAPP', enabled: true })),
        (e) => e.code === 'CHANNEL_UNAVAILABLE',
      );
    });

    it('test iletisi kapalı kanalda da gönderilir; başarısızlık uyarı açmaz ve ayar sürümünü bozmaz', async () => {
      await db.notificationChannelConfig.updateMany({ where: { hotelId, channel: 'SMS' }, data: { enabled: false } });
      behavior.SMS = async () => {
        throw new ProviderError('Gönderici başlığı tanımlı değil', { code: 'NETGSM_40', retryable: false, configIssue: true });
      };
      const before = await configOf('SMS');
      const { id } = await as(ADMIN, () => service.prepareChannelTest(hotelId, { channel: 'SMS', to: '0532 999 88 77' }));
      const result = await dispatcher.deliverTestNotification(hotelId, id);
      await service.recordChannelTest(hotelId, 'SMS', result);

      const row = await db.notification.findFirst({ where: { id } });
      assert.equal(row.status, 'FAILED');
      assert.equal(row.recipient, '905329998877');
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 0);
      const summary = await service.getNotificationSummary(hotelId);
      assert.equal(summary.last24h.FAILED, undefined, 'test, "misafire ulaşmadı" sayısına girmez');
      const after = await configOf('SMS');
      assert.equal(after.lastTestOk, false);
      assert.match(after.lastTestError, /başlığı/);
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
      // Göndericinin üstlenebileceği bir satır kalmadı.
      assert.equal((await dispatcher.claimDueNotifications(10)).length, 0);
    });
  });

  describe('şablonlar', () => {
    it('24 birleşim listelenir; SMS/e-posta varsayılanları yüklüdür, WhatsApp boştur', async () => {
      const { items } = await service.listTemplates(hotelId);
      assert.equal(items.length, 24);
      assert.ok(items.filter((item) => item.channel !== 'WHATSAPP').every((item) => item.template));
      assert.ok(items.filter((item) => item.channel === 'WHATSAPP').every((item) => !item.template && !item.defaultTemplate));
    });

    it('yeni şablon eklenir, güncellenir; bayat sürüm reddedilir', async () => {
      const created = await as(ADMIN, () =>
        service.saveTemplate(hotelId, {
          key: 'CHECKED_IN',
          channel: 'WHATSAPP',
          language: 'tr',
          subject: 'yok sayılır',
          body: 'Hoş geldiniz {misafirAdi}, odanız {odaNo}',
          isActive: true,
        }),
      );
      assert.equal(created.subject, null, 'yalnızca e-postada konu var');
      const updated = await as(ADMIN, () =>
        service.saveTemplate(hotelId, { ...created, body: 'Merhaba {misafirAdi}', expectedUpdatedAt: new Date(created.updatedAt) }),
      );
      assert.equal(updated.body, 'Merhaba {misafirAdi}');
      await assert.rejects(
        () => as(ADMIN, () => service.saveTemplate(hotelId, { ...created, body: 'Eski', expectedUpdatedAt: new Date(created.updatedAt) })),
        (e) => e.code === 'STALE_WRITE',
      );
      assert.ok((await eventNames()).includes('notification.template.saved'));
    });

    it('varsayılanlar ikinci kez yüklenince çoğalmaz', async () => {
      assert.equal(await service.ensureDefaultTemplates(hotelId, db), 0);
    });
  });

  describe('personel uyarıları (zil)', () => {
    let subscribers;

    before(async () => {
      subscribers = await import('./subscribers.js');
      subscribers.registerNotificationSubscribers();
    });

    after(() => {
      subscribers.stopNotificationSubscribers();
      dispatcher.stopDispatcher();
    });

    const inbound = (text, externalMessageId = randomUUID()) =>
      messaging.receiveInboundMessage(hotelId, {
        channel: 'WHATSAPP',
        externalId: '905321110001',
        externalMessageId,
        text,
        displayName: 'Ayşe',
      });

    it('misafir mesajı mesaj görenlere gider, kat görevlisine gitmez; aynı cevapsız dizide birleşir', async () => {
      await inbound('Merhaba');
      const deskSummary = await as(DESK, () => alerts.getStaffAlertSummary(hotelId));
      const maidSummary = await as(MAID, () => alerts.getStaffAlertSummary(hotelId));
      assert.equal(deskSummary.unseenCount, 1);
      assert.equal(maidSummary.unseenCount, 0);

      const [first] = (await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }))).items;
      assert.equal(first.title, 'Ayşe Yılmaz yazdı');
      assert.equal(first.link.startsWith('/mesajlar/'), true);
      await as(DESK, () => alerts.markStaffAlertRead(hotelId, first.id));

      await inbound('Havlu lazım');
      const [merged] = (await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }))).items;
      assert.equal(merged.id, first.id);
      assert.equal(merged.count, 2);
      assert.equal(merged.read, false, 'birleşen uyarı yeniden okunmamış');
      assert.equal(merged.body, 'Havlu lazım');
      assert.ok((await eventNames()).includes('staff.alert.raised'));
    });

    it('atanmış konuşmanın uyarısı yalnızca atanana gider', async () => {
      const { conversationId } = await inbound('İlk');
      const conversation = await db.conversation.findFirst({ where: { id: conversationId } });
      await as(ADMIN, () =>
        messaging.updateConversation(hotelId, conversationId, {
          assignedToId: users.desk.id,
          expectedStateVersion: conversation.stateVersion,
        }),
      );
      await as(ADMIN, () => messaging.sendStaffMessage(hotelId, conversationId, { text: 'Merhaba', internal: false }));
      await db.staffAlert.deleteMany({ where: { hotelId } });

      await inbound('Yeni soru');
      assert.equal((await as(DESK, () => alerts.getStaffAlertSummary(hotelId))).unseenCount, 1);
      assert.equal((await as(ADMIN, () => alerts.getStaffAlertSummary(hotelId))).unseenCount, 0);
    });

    it('bakınca rozet sıfırlanır; tümünü okundu say ve susturma çalışır', async () => {
      await inbound('Merhaba');
      await as(DESK, () => alerts.markStaffAlertsSeen(hotelId));
      assert.equal((await as(DESK, () => alerts.getStaffAlertSummary(hotelId))).unseenCount, 0);

      const marked = await as(DESK, () => alerts.markAllStaffAlertsRead(hotelId));
      assert.equal(marked.marked, 1);
      assert.equal((await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }))).items[0].read, true);

      await as(DESK, () => alerts.updateStaffAlertPreferences(hotelId, { mutedKinds: ['GUEST_MESSAGE'] }));
      assert.equal((await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }))).items.length, 0);
    });

    it('başkasının uyarısı okundu işaretlenemez', async () => {
      await inbound('Merhaba');
      const [alert] = (await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }))).items;
      await assert.rejects(() => as(MAID, () => alerts.markStaffAlertRead(hotelId, alert.id)), (e) => e.code === 'NOT_FOUND');
    });

    it('acil istek istek yönetenlere kritik uyarı açar; normal istek açmaz', async () => {
      await as(DESK, () => requests.createRequest(hotelId, { category: 'AMENITY', title: 'Havlu', roomId: room.id, source: 'FRONT_DESK' }));
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 0);

      await as(DESK, () => requests.createRequest(hotelId, { category: 'COMPLAINT', title: 'Gürültü', roomId: room.id, source: 'PHONE' }));
      const alert = await db.staffAlert.findFirst({ where: { hotelId } });
      assert.equal(alert.kind, 'URGENT_REQUEST');
      assert.equal(alert.severity, 'CRITICAL');
      assert.equal(alert.permission, 'requests.manage');
      assert.equal(alert.body, 'Oda 204 · Şikâyet');
    });
  });

  describe('gecikme taraması ve saklama', () => {
    it('geciken istek bir kez uyarılır, isteğin sürümü değişmez; hedef değişince yeniden uyarılabilir', async () => {
      const created = await as(DESK, () =>
        requests.createRequest(hotelId, { category: 'AMENITY', title: 'Yastık', roomId: room.id, source: 'FRONT_DESK' }),
      );
      await db.guestRequest.update({ where: { id: created.id }, data: { dueAt: new Date(Date.now() - 60_000) } });
      const before = await db.guestRequest.findFirst({ where: { id: created.id } });

      assert.equal(await jobs.scanOverdueRequests(), 1);
      assert.equal(await jobs.scanOverdueRequests(), 0);
      const scanned = await db.guestRequest.findFirst({ where: { id: created.id } });
      assert.equal(scanned.updatedAt.getTime(), before.updatedAt.getTime());
      assert.ok(scanned.overdueAlertedAt);

      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'OVERDUE_REQUEST' } });
      assert.equal(alert.title, 'Gecikti: Yastık');
      assert.equal(alert.body, 'Oda 204');

      const updated = await as(DESK, () =>
        requests.updateRequest(hotelId, created.id, { priority: 'LOW', expectedUpdatedAt: scanned.updatedAt }),
      );
      assert.ok(updated);
      assert.equal((await db.guestRequest.findFirst({ where: { id: created.id } })).overdueAlertedAt, null);
    });

    it('saklama süresi dolan uyarı okunma kayıtlarıyla birlikte silinir', async () => {
      const old = await db.staffAlert.create({
        data: {
          hotelId,
          kind: 'MANUAL_TASK',
          title: 'Eski',
          permission: 'settings.manage',
          occurredAt: new Date(Date.now() - 31 * 24 * 60 * 60_000),
        },
      });
      await db.staffAlertRead.create({ data: { alertId: old.id, userId: users.admin.id } });
      await db.staffAlert.create({ data: { hotelId, kind: 'MANUAL_TASK', title: 'Yeni', permission: 'settings.manage' } });

      assert.equal(await alerts.purgeExpiredStaffAlerts(), 1);
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 1);
      assert.equal(await db.staffAlertRead.count(), 0);
    });
  });

  describe('ölçek ve dayanıklılık', () => {
    it('geçmiş onay koduyla aranır; üç harften kısa arama süzgeç sayılmaz', async () => {
      await enqueueRoom();
      const byCode = await service.listNotifications(hotelId, { limit: 30, search: stay.confirmationCode });
      assert.equal(byCode.items.length, 2);
      const noMatch = await service.listNotifications(hotelId, { limit: 30, search: 'yok-boyle-bir-sey' });
      assert.equal(noMatch.items.length, 0);
      const short = await service.listNotifications(hotelId, { limit: 30, search: 'ay' });
      assert.equal(short.items.length, 2);
    });

    it('zil kişiye ve izne gelenleri imleçle atlamadan, tekrarlamadan sayfalar', async () => {
      const base = Date.now() - 60 * 60_000;
      const rows = [];
      for (let index = 0; index < 9; index += 1) {
        rows.push({
          hotelId,
          kind: 'MANUAL_TASK',
          title: `Uyarı ${index}`,
          // Aynı ana düşen uyarılar da ayrışmalı.
          occurredAt: new Date(base + Math.floor(index / 3) * 1000),
          ...(index % 3 === 0
            ? { userId: users.desk.id }
            : { permission: index % 3 === 1 ? 'messages.view' : 'settings.manage' }),
        });
      }
      await db.staffAlert.createMany({ data: rows });

      // Resepsiyon: kendine gelen 3 + messages.view izniyle 3 (settings.manage yok).
      const seen = [];
      let cursor;
      do {
        const page = await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 2, cursor }));
        seen.push(...page.items.map((item) => item.title));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(seen.length, 6);
      assert.equal(new Set(seen).size, 6);
      assert.ok(!seen.some((title) => ['Uyarı 2', 'Uyarı 5', 'Uyarı 8'].includes(title)));

      const summary = await as(DESK, () => alerts.getStaffAlertSummary(hotelId));
      assert.equal(summary.unseenCount, 6);
      const marked = await as(DESK, () => alerts.markAllStaffAlertsRead(hotelId));
      assert.equal(marked.marked, 6);
    });

    it('dağıtılamadan kalan olay bekleme payından sonra yeniden dağıtılır; yenisine dokunulmaz', async () => {
      const { relayUnpublishedEvents, RELAY_GRACE_MS } = await import('../../lib/outbox.js');
      const { eventBus } = await import('../../lib/events.js');
      const received = [];
      const unsubscribe = eventBus.subscribe('notification.cancelled', 'test-relay', (payload) => {
        received.push(payload.notificationId);
      });
      const envelope = (notificationId, occurredAt) => ({
        id: randomUUID(),
        hotelId,
        name: 'notification.cancelled',
        payload: { hotelId, notificationId, channel: 'SMS' },
        correlationId: randomUUID(),
        actor: 'test',
        occurredAt,
        publishedAt: null,
      });
      const oldId = randomUUID();
      const freshId = randomUUID();
      try {
        await db.eventLog.createMany({
          data: [
            envelope(oldId, new Date(Date.now() - RELAY_GRACE_MS - 60_000)),
            envelope(freshId, new Date()),
          ],
        });
        assert.equal(await relayUnpublishedEvents(), 1);
        assert.deepEqual(received, [oldId]);
        assert.equal(await relayUnpublishedEvents(), 0, 'ikinci tur aynı olayı almaz');
        const pending = await db.eventLog.count({ where: { hotelId, publishedAt: null } });
        assert.equal(pending, 1, 'yeni olay istek içindeki dağıtıma bırakılır');
      } finally {
        unsubscribe();
      }
    });

    it('işlenmiş olay kayıtları saklama süresinden sonra silinir', async () => {
      const { purgeProcessedEvents, PROCESSED_EVENT_RETENTION_DAYS } = await import('../../lib/maintenance-jobs.js');
      const old = new Date(Date.now() - (PROCESSED_EVENT_RETENTION_DAYS + 1) * 24 * 60 * 60_000);
      await db.processedEvent.createMany({
        data: [
          { hotelId, actorName: 'test', eventId: randomUUID(), createdAt: old },
          { hotelId, actorName: 'test', eventId: randomUUID() },
        ],
      });
      assert.equal(await purgeProcessedEvents(), 1);
      assert.equal(await db.processedEvent.count({ where: { hotelId } }), 1);
    });
  });

  describe('aktör (uçtan uca)', () => {
    let actors;

    before(async () => {
      actors = await import('../../lib/actors.js');
      actors.registerActors();
    });

    after(() => {
      actors.actorRegistry.unbindAll();
    });

    it('oda ataması olayı bildirimleri kuyruğa yazar', async () => {
      const { eventBus } = await import('../../lib/events.js');
      await eventBus.publish('room.assigned', {
        hotelId,
        reservationId: stay.id,
        roomId: room.id,
        roomNumber: room.number,
        assignedBy: 'manual',
      });
      assert.equal(await db.notification.count({ where: { hotelId, source: 'ROOM_ASSIGNED' } }), 2);
      const activity = await db.activityLog.findFirst({ where: { hotelId, actorName: 'notification-worker' } });
      assert.match(activity.message, /2 bildirim sıraya alındı/);
    });

    it('aktör kapalıysa bildirim açılmaz; iş personele düşer ve ziline uyarı gelir', async () => {
      await db.actorSetting.create({ data: { hotelId, actorName: 'notification-worker', enabled: false } });
      const { eventBus } = await import('../../lib/events.js');
      await eventBus.publish('room.assigned', {
        hotelId,
        reservationId: stay.id,
        roomId: room.id,
        roomNumber: room.number,
        assignedBy: 'manual',
      });
      assert.equal(await db.notification.count({ where: { hotelId } }), 0);
      const task = await db.manualTask.findFirst({ where: { hotelId } });
      assert.equal(task.title, 'Misafire "Oda bilgisi" bildirimini elle gönderin');
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'MANUAL_TASK' } });
      assert.equal(alert.permission, 'notifications.manage');
      assert.equal((await as(ADMIN, () => alerts.getStaffAlertSummary(hotelId))).unseenCount, 1);
      assert.equal((await as(DESK, () => alerts.getStaffAlertSummary(hotelId))).unseenCount, 0);
    });
  });
});
