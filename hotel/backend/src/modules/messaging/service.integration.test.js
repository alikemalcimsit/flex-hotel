import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Misafir mesajları ve istekleri (modül 7) — gerçek PostgreSQL gerektirir.
 *
 * Buradaki iddialar yalnızca veritabanıyla doğrulanabilir: aynı anda gelen
 * mesajların tek konuşmada birleşmesi, tekrar gelen webhook'un tek kayıt
 * olması, sayaçların yarışta bozulmaması, sürüm çakışması, isteklerin doğru
 * misafire bağlanması.
 *
 * Çalıştırmak için:
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const HOTEL_TIME_ZONE = 'Europe/Istanbul';
const STAFF_EMAIL = 'resepsiyon@test.local';
const GUEST_PHONE = '+905321110001';

describe('misafir mesajları ve istekler (entegrasyon)', { skip }, () => {
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {any} */ let db;
  /** @type {any} */ let messaging;
  /** @type {any} */ let requests;
  /** @type {any} */ let channels;
  /** @type {any} */ let core;
  let hotelId;
  let staff;
  let otherStaff;
  let inactiveStaff;
  let foreignStaff;
  let room;
  let guest;
  let stay;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    messaging = await import('./service.js');
    requests = await import('../guest-requests/service.js');
    channels = await import('../../lib/channels.js');
    core = await import('@hotelos/core');
  });

  after(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);

    const hotel = await db.hotel.create({ data: { name: 'Mesaj Test', code: `MSG-${randomUUID().slice(0, 8)}` } });
    hotelId = hotel.id;
    const otherHotel = await db.hotel.create({ data: { name: 'Başka Otel', code: `OTH-${randomUUID().slice(0, 8)}` } });

    const user = (email, name, extra = {}) =>
      db.user.create({ data: { hotelId, email, name, passwordHash: 'x', role: 'FRONT_DESK', ...extra } });
    staff = await user(STAFF_EMAIL, 'Resepsiyon Ayşe');
    otherStaff = await user('kat@test.local', 'Kat Görevlisi Mehmet', { role: 'HOUSEKEEPING' });
    inactiveStaff = await user('eski@test.local', 'Ayrılan Personel', { isActive: false });
    foreignStaff = await db.user.create({
      data: { hotelId: otherHotel.id, email: 'yabanci@test.local', name: 'Yabancı', passwordHash: 'x' },
    });

    const type = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    room = {};
    for (const number of ['101', '102', '103']) {
      room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: type.id, floor: 1 } });
    }

    guest = await db.guest.create({
      data: { hotelId, firstName: 'Elif', lastName: 'Demir', phone: GUEST_PHONE, email: 'elif@example.com' },
    });
    stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: type.id,
        roomId: room['101'].id,
        checkIn: dayDate(-1),
        checkOut: dayDate(2),
        status: 'CHECKED_IN',
        totalPrice: '3000',
        confirmationCode: `M-${randomUUID().slice(0, 8)}`,
      },
    });
  });

  const dayDate = (offset) => core.addDays(core.calendarDateInTimeZone(HOTEL_TIME_ZONE), offset);
  const asStaff = (fn, email = STAFF_EMAIL) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);

  let messageSeq = 0;
  const inbound = (overrides = {}) =>
    messaging.receiveInboundMessage(hotelId, {
      channel: 'WHATSAPP',
      externalId: '905321110001',
      externalMessageId: `wamid.${++messageSeq}.${randomUUID()}`,
      text: 'Merhaba, iki havlu rica ediyorum',
      displayName: 'Elif',
      ...overrides,
    });

  const conversationRow = (id) => db.conversation.findUnique({ where: { id } });
  const eventNames = async () =>
    (await db.eventLog.findMany({ where: { hotelId }, select: { name: true } })).map((row) => row.name);

  describe('gelen mesaj (kanal sözleşmesi)', () => {
    it('konuşmayı açar, misafiri telefondan bulur ve içerideki konaklamaya bağlar', async () => {
      const { conversationId, duplicate } = await inbound();
      assert.equal(duplicate, false);

      const detail = await messaging.getConversation(hotelId, conversationId);
      assert.equal(detail.guest.name, 'Elif Demir');
      assert.equal(detail.stay.roomNumber, '101');
      assert.equal(detail.unreadCount, 1);
      assert.ok(detail.awaitingReplySince);
      assert.equal(detail.lastMessagePreview, 'Merhaba, iki havlu rica ediyorum');
      assert.equal(detail.channelConnected, false, 'modül 8 yokken kanal bağlı değil');
      assert.ok((await eventNames()).includes('guest.message.received'));
    });

    it('kartta yerel biçimde yazılmış numarayı bulur, ülke kodu farklı numaraya bağlanmaz', async () => {
      const local = await db.guest.create({
        data: { hotelId, firstName: 'Can', lastName: 'Yerel', phone: '0533 222 33 44' },
      });
      await db.guest.create({
        data: { hotelId, firstName: 'Tom', lastName: 'Foreign', phone: '+44 7533 222 3344' },
      });

      const matched = await inbound({ externalId: '905332223344' });
      assert.equal((await conversationRow(matched.conversationId)).guestId, local.id);

      const stranger = await inbound({ externalId: '15332223344' });
      assert.equal((await conversationRow(stranger.conversationId)).guestId, null);
    });

    it('AI asistanı yokken konuşma personelde başlar', async () => {
      const { conversationId } = await inbound();
      assert.equal((await conversationRow(conversationId)).mode, 'MANUAL');
    });

    it('AI asistanı kayıtlıysa konuşma AI modunda başlar', async () => {
      const unregister = channels.registerAutoResponder({ name: 'test-concierge' });
      try {
        const { conversationId } = await inbound({ externalId: '905550000001' });
        assert.equal((await conversationRow(conversationId)).mode, 'AI');
      } finally {
        unregister();
      }
    });

    it('aynı kanal mesajı tekrar gelirse tek kayıt olur (webhook tekrarı)', async () => {
      const first = await inbound({ externalMessageId: 'wamid.sabit' });
      const again = await inbound({ externalMessageId: 'wamid.sabit' });

      assert.equal(again.duplicate, true);
      assert.equal(again.message.id, first.message.id);
      assert.equal(await db.message.count({ where: { conversationId: first.conversationId } }), 1);
      assert.equal((await conversationRow(first.conversationId)).unreadCount, 1, 'sayaç iki kez artmaz');
    });

    it('aynı numaradan aynı anda gelen mesajlar tek konuşmada toplanır, sayaç bozulmaz', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) => inbound({ externalId: '905559998877', text: `mesaj ${index}` })),
      );
      const ids = new Set(results.map((result) => result.conversationId));
      assert.equal(ids.size, 1);
      assert.equal((await conversationRow([...ids][0])).unreadCount, 6);
    });

    it('misafir kartı olmayan numara adresle görünür', async () => {
      const { conversationId } = await inbound({ externalId: '4915511112222', displayName: null });
      const detail = await messaging.getConversation(hotelId, conversationId);
      assert.equal(detail.guest, null);
      assert.equal(detail.contactName, '4915511112222');
    });

    it('kapalı konuşmaya gelen mesaj konuşmayı yeniden açar', async () => {
      const { conversationId } = await inbound();
      const row = await conversationRow(conversationId);
      await asStaff(() =>
        messaging.updateConversation(hotelId, conversationId, { status: 'CLOSED', expectedStateVersion: row.stateVersion }),
      );

      await inbound();
      const reopened = await conversationRow(conversationId);
      assert.equal(reopened.status, 'OPEN');
      assert.equal(reopened.closedAt, null);
    });

    it('geçersiz gelen mesaj doğrulama hatası verir', async () => {
      await assert.rejects(
        () => messaging.receiveInboundMessage(hotelId, { channel: 'WHATSAPP', externalId: '9055', text: 'x' }),
        (error) => error.code === 'VALIDATION',
      );
    });
  });

  describe('personel cevabı ve iç not', () => {
    it('cevap gönderim bekler; bekleme ve okunmamış sıfırlanır; kanal event\'i yayınlanır', async () => {
      const { conversationId } = await inbound();
      const message = await asStaff(() =>
        messaging.sendStaffMessage(hotelId, conversationId, { text: 'Hemen gönderiyoruz', internal: false }),
      );

      assert.equal(message.delivery, 'PENDING');
      assert.equal(message.author, 'STAFF');
      assert.equal(message.actorName, 'Resepsiyon Ayşe');
      const row = await conversationRow(conversationId);
      assert.equal(row.awaitingReplySince, null);
      assert.equal(row.unreadCount, 0);
      assert.equal(row.lastMessageAuthor, 'STAFF');
      assert.ok((await eventNames()).includes('guest.message.reply'));
    });

    it('aynı istemci kimliğiyle ikinci gönderim yeni mesaj yazmaz', async () => {
      const { conversationId } = await inbound();
      const clientMessageId = randomUUID();
      const send = () =>
        asStaff(() =>
          messaging.sendStaffMessage(hotelId, conversationId, { text: 'Tamam', internal: false, clientMessageId }),
        );
      const first = await send();
      const second = await send();
      assert.equal(second.id, first.id);
      assert.equal(await db.message.count({ where: { conversationId, direction: 'OUT' } }), 1);
    });

    it('iç not misafire gitmez, listede özeti ve bekleme süresini değiştirmez', async () => {
      const { conversationId } = await inbound();
      const beforeRow = await conversationRow(conversationId);
      const note = await asStaff(() =>
        messaging.sendStaffMessage(hotelId, conversationId, { text: 'Misafir VIP, dikkat', internal: true }),
      );

      assert.equal(note.internal, true);
      assert.equal(note.delivery, null);
      const afterRow = await conversationRow(conversationId);
      assert.equal(afterRow.lastMessagePreview, beforeRow.lastMessagePreview);
      assert.ok(afterRow.awaitingReplySince, 'not cevap sayılmaz');
      assert.equal((await eventNames()).includes('guest.message.reply'), false);
    });

    it('kapalı konuşmaya cevap konuşmayı açar', async () => {
      const { conversationId } = await inbound();
      const row = await conversationRow(conversationId);
      await asStaff(() =>
        messaging.updateConversation(hotelId, conversationId, { status: 'CLOSED', expectedStateVersion: row.stateVersion }),
      );
      await asStaff(() => messaging.sendStaffMessage(hotelId, conversationId, { text: 'Ek bilgi', internal: false }));
      assert.equal((await conversationRow(conversationId)).status, 'OPEN');
    });

    it('AI modundaki konuşmaya personel yazınca konuşma personele geçer', async () => {
      const unregister = channels.registerAutoResponder({ name: 'test-concierge' });
      try {
        const { conversationId } = await inbound({ externalId: '905550000002' });
        await asStaff(() => messaging.sendStaffMessage(hotelId, conversationId, { text: 'Ben ilgileniyorum', internal: false }));
        assert.equal((await conversationRow(conversationId)).mode, 'MANUAL');
      } finally {
        unregister();
      }
    });

    it('personele alınmış konuşmaya AI yazamaz', async () => {
      const { conversationId } = await inbound();
      await assert.rejects(
        () => messaging.appendAiReply(hotelId, conversationId, { text: 'Merhaba, ben asistan' }),
        (error) => error.code === 'CONVERSATION_MANUAL',
      );
    });
  });

  describe('teslim durumu (kanal bildirimi)', () => {
    const sendReply = async () => {
      const { conversationId } = await inbound();
      return asStaff(() => messaging.sendStaffMessage(hotelId, conversationId, { text: 'Cevap', internal: false }));
    };

    it('durum ileri gider, geç gelen bildirim geri almaz', async () => {
      const reply = await sendReply();
      await messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'SENT', externalMessageId: 'wamid.giden.1' });
      await messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'READ' });
      const late = await messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'DELIVERED' });

      assert.equal(late.delivery, 'READ');
      const row = await db.message.findUnique({ where: { id: reply.id } });
      assert.equal(row.externalId, 'wamid.giden.1');
      assert.ok(row.sentAt);
      assert.ok(row.deliveredAt);
    });

    it('aynı anda gelen "okundu" ve "gönderildi" bildirimleri durumu geri almaz', async () => {
      const reply = await sendReply();
      // Mesajı kilitleyen bir işlem sürerken iki bildirim sıraya girer: önce "okundu", sonra "gönderildi".
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      let locked;
      const lockTaken = new Promise((resolve) => {
        locked = resolve;
      });
      const holder = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Message" WHERE "id" = ${reply.id} FOR UPDATE`;
          locked();
          await held;
        },
        { timeout: 30_000 },
      );
      await lockTaken;
      const read = messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'READ' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const sent = messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'SENT' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await holder;
      await Promise.all([read, sent]);

      const row = await db.message.findUnique({ where: { id: reply.id } });
      assert.equal(row.delivery, 'READ');
    });

    it('iletilmiş mesaj sonradan "gönderilemedi" olmaz', async () => {
      const reply = await sendReply();
      await messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'DELIVERED' });
      const result = await messaging.markMessageDelivery(hotelId, reply.id, { delivery: 'FAILED', failureReason: 'x' });
      assert.equal(result.delivery, 'DELIVERED');
    });

    it('gönderilemeyen mesajın sebebi saklanır', async () => {
      const reply = await sendReply();
      const result = await messaging.markMessageDelivery(hotelId, reply.id, {
        delivery: 'FAILED',
        failureReason: '24 saat penceresi kapandı',
      });
      assert.equal(result.delivery, 'FAILED');
      assert.equal(result.failureReason, '24 saat penceresi kapandı');
    });

    it('gelen mesajın ya da iç notun teslim durumu değiştirilemez', async () => {
      const { conversationId, message } = await inbound();
      await assert.rejects(
        () => messaging.markMessageDelivery(hotelId, message.id, { delivery: 'READ' }),
        (error) => error.code === 'NOT_OUTBOUND',
      );
      const note = await asStaff(() => messaging.sendStaffMessage(hotelId, conversationId, { text: 'not', internal: true }));
      await assert.rejects(
        () => messaging.markMessageDelivery(hotelId, note.id, { delivery: 'SENT' }),
        (error) => error.code === 'NOT_OUTBOUND',
      );
    });
  });

  describe('konuşma yönetimi', () => {
    it('AI asistanı bağlı değilken konuşma AI moduna alınamaz', async () => {
      const { conversationId } = await inbound();
      const row = await conversationRow(conversationId);
      await assert.rejects(
        () =>
          asStaff(() =>
            messaging.updateConversation(hotelId, conversationId, { mode: 'AI', expectedStateVersion: row.stateVersion }),
          ),
        (error) => error.code === 'NO_AUTO_RESPONDER',
      );
    });

    it('bu arada gelen mesaj atamayı çakışma saymaz', async () => {
      const { conversationId } = await inbound();
      const seen = await conversationRow(conversationId);
      await inbound(); // personel ekrana bakarken misafir yazdı

      const updated = await asStaff(() =>
        messaging.updateConversation(hotelId, conversationId, {
          assignedToId: otherStaff.id,
          expectedStateVersion: seen.stateVersion,
        }),
      );
      assert.equal(updated.assignedTo.name, 'Kat Görevlisi Mehmet');
    });

    it('başka personel aynı anda karar verdiyse ikinci işlem reddedilir', async () => {
      const { conversationId } = await inbound();
      const seen = await conversationRow(conversationId);
      await asStaff(() =>
        messaging.updateConversation(hotelId, conversationId, { assignedToId: staff.id, expectedStateVersion: seen.stateVersion }),
      );
      await assert.rejects(
        () =>
          asStaff(() =>
            messaging.updateConversation(hotelId, conversationId, {
              assignedToId: otherStaff.id,
              expectedStateVersion: seen.stateVersion,
            }),
          ),
        (error) => error.code === 'STALE_WRITE',
      );
    });

    it('pasif ya da başka otelin personeline atanamaz', async () => {
      const { conversationId } = await inbound();
      const row = await conversationRow(conversationId);
      for (const userId of [inactiveStaff.id, foreignStaff.id]) {
        await assert.rejects(
          () =>
            asStaff(() =>
              messaging.updateConversation(hotelId, conversationId, { assignedToId: userId, expectedStateVersion: row.stateVersion }),
            ),
          (error) => error.code === 'VALIDATION',
        );
      }
    });

    it('kapatmak beklemeyi ve okunmamışı sıfırlar, kapatanı yazar', async () => {
      const { conversationId } = await inbound();
      const row = await conversationRow(conversationId);
      const closed = await asStaff(() =>
        messaging.updateConversation(hotelId, conversationId, { status: 'CLOSED', expectedStateVersion: row.stateVersion }),
      );
      assert.equal(closed.status, 'CLOSED');
      assert.equal(closed.unreadCount, 0);
      assert.equal(closed.awaitingReplySince, null);
      assert.equal(closed.closedBy, STAFF_EMAIL);
      assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'Conversation' } }), 1);
    });

    it('başka misafirin konaklaması bağlanamaz; kimliksiz konuşmaya bağlanınca misafir de tanınır', async () => {
      const stranger = await db.guest.create({ data: { hotelId, firstName: 'Can', lastName: 'Yıldız' } });
      const strangerStay = await db.reservation.create({
        data: {
          hotelId,
          guestId: stranger.id,
          roomTypeId: (await db.roomType.findFirst({ where: { hotelId } })).id,
          checkIn: dayDate(3),
          checkOut: dayDate(5),
          status: 'CONFIRMED',
          totalPrice: '2000',
          confirmationCode: `S-${randomUUID().slice(0, 8)}`,
        },
      });

      const identified = await inbound();
      const identifiedRow = await conversationRow(identified.conversationId);
      await assert.rejects(
        () =>
          asStaff(() =>
            messaging.updateConversation(hotelId, identified.conversationId, {
              reservationId: strangerStay.id,
              expectedStateVersion: identifiedRow.stateVersion,
            }),
          ),
        (error) => error.code === 'VALIDATION',
      );

      const anonymous = await inbound({ channel: 'WEBCHAT', externalId: `oturum-${randomUUID()}`, displayName: 'Ziyaretçi' });
      const anonymousRow = await conversationRow(anonymous.conversationId);
      const linked = await asStaff(() =>
        messaging.updateConversation(hotelId, anonymous.conversationId, {
          reservationId: strangerStay.id,
          expectedStateVersion: anonymousRow.stateVersion,
        }),
      );
      assert.equal(linked.guest.name, 'Can Yıldız');
    });

    it('okundu işareti tekrarlanabilir; yalnızca ilk seferde event üretir', async () => {
      const { conversationId } = await inbound();
      assert.equal((await messaging.markConversationRead(hotelId, conversationId)).changed, true);
      assert.equal((await messaging.markConversationRead(hotelId, conversationId)).changed, false);
      const reads = (await eventNames()).filter((name) => name === 'conversation.read');
      assert.equal(reads.length, 1);
    });
  });

  describe('gelen kutusu listesi ve geçmiş', () => {
    it('görünümler doğru konuşmaları getirir', async () => {
      const waiting = await inbound({ externalId: '905550000010' });
      const mine = await inbound({ externalId: '905550000011' });
      const mineRow = await conversationRow(mine.conversationId);
      await asStaff(() =>
        messaging.updateConversation(hotelId, mine.conversationId, { assignedToId: staff.id, expectedStateVersion: mineRow.stateVersion }),
      );
      await asStaff(() => messaging.sendStaffMessage(hotelId, mine.conversationId, { text: 'Cevap', internal: false }));

      const list = (view) => asStaff(() => messaging.listConversations(hotelId, { view, limit: 30 }));
      assert.deepEqual((await list('WAITING')).items.map((row) => row.id), [waiting.conversationId]);
      assert.deepEqual((await list('MINE')).items.map((row) => row.id), [mine.conversationId]);
      assert.deepEqual((await list('UNASSIGNED')).items.map((row) => row.id), [waiting.conversationId]);
      assert.equal((await list('CLOSED')).items.length, 0);
    });

    it('imleçle sayfalama kayıt atlamaz ve tekrarlamaz', async () => {
      for (let index = 0; index < 7; index += 1) await inbound({ externalId: `9055500001${index}` });
      const seen = [];
      let cursor;
      do {
        const page = await messaging.listConversations(hotelId, { view: 'OPEN', limit: 3, cursor });
        seen.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
    });

    it('bozuk imleç doğrulama hatasıdır', async () => {
      await assert.rejects(
        () => messaging.listConversations(hotelId, { view: 'OPEN', limit: 3, cursor: 'bozuk' }),
        (error) => error.code === 'VALIDATION',
      );
    });

    it('misafir adı ve oda numarasıyla aranır', async () => {
      const { conversationId } = await inbound();
      await inbound({ externalId: '905550000020', displayName: 'Başka Biri' });

      const byName = await messaging.listConversations(hotelId, { view: 'OPEN', limit: 30, search: 'elif dem' });
      assert.deepEqual(byName.items.map((row) => row.id), [conversationId]);
      const byRoom = await messaging.listConversations(hotelId, { view: 'OPEN', limit: 30, search: '101' });
      assert.deepEqual(byRoom.items.map((row) => row.id), [conversationId]);
      const byCode = await messaging.listConversations(hotelId, { view: 'OPEN', limit: 30, search: stay.confirmationCode });
      assert.deepEqual(byCode.items.map((row) => row.id), [conversationId]);
      // İki harf metinde aranmaz (milyonlarca satırı tarardı); oda numarası değilse sonuç boş.
      const short = await messaging.listConversations(hotelId, { view: 'OPEN', limit: 30, search: 'el' });
      assert.deepEqual(short.items, []);
    });

    it('mesaj geçmişi yeniden eskiye imleçle gelir', async () => {
      const { conversationId } = await inbound({ text: 'ilk' });
      for (const text of ['ikinci', 'üçüncü', 'dördüncü', 'beşinci']) await inbound({ text });

      const first = await messaging.listMessages(hotelId, conversationId, { limit: 2 });
      const second = await messaging.listMessages(hotelId, conversationId, { limit: 2, before: first.nextCursor });
      const third = await messaging.listMessages(hotelId, conversationId, { limit: 2, before: second.nextCursor });
      const texts = [...first.items, ...second.items, ...third.items].map((row) => row.text);
      assert.deepEqual(texts, ['beşinci', 'dördüncü', 'üçüncü', 'ikinci', 'ilk']);
      assert.equal(third.nextCursor, null);
    });

    it('özet sayıları tutar', async () => {
      await inbound({ externalId: '905550000030' });
      await inbound({ externalId: '905550000030' });
      await inbound({ externalId: '905550000031' });
      const summary = await asStaff(() => messaging.getInboxSummary(hotelId));
      assert.equal(summary.open, 2);
      assert.equal(summary.waiting, 2);
      assert.equal(summary.unread, 3);
      assert.equal(summary.unassigned, 2);
      assert.equal(summary.mine, 0);
      assert.equal(summary.autoResponderAvailable, false);
    });

    it('önbellekli ilk sayfa ve özet değişiklikten hemen sonra tazedir; "bana atanan" kişiye özeldir', async () => {
      const first = await inbound({ externalId: '905550000040' });
      const list = () => messaging.listConversations(hotelId, { view: 'OPEN', limit: 30 });
      assert.equal((await list()).items.length, 1);
      assert.equal((await asStaff(() => messaging.getInboxSummary(hotelId))).waiting, 1);

      const second = await inbound({ externalId: '905550000041', text: 'Yeni gelen' });
      const afterInbound = await list();
      assert.deepEqual(afterInbound.items.map((row) => row.id), [second.conversationId, first.conversationId]);

      await asStaff(() => messaging.sendStaffMessage(hotelId, first.conversationId, { text: 'Hemen geliyor', internal: false }));
      const afterReply = await list();
      assert.equal(afterReply.items[0].id, first.conversationId, 'cevaplanan en üste çıkar');
      assert.equal(afterReply.items[0].lastMessagePreview, 'Hemen geliyor');

      const row = await conversationRow(first.conversationId);
      await asStaff(() =>
        messaging.updateConversation(hotelId, first.conversationId, {
          assignedToId: staff.id,
          expectedStateVersion: row.stateVersion,
        }),
      );
      const mineFor = async (email) => (await asStaff(() => messaging.getInboxSummary(hotelId), email)).mine;
      assert.equal(await mineFor(STAFF_EMAIL), 1);
      assert.equal(await mineFor('kat@test.local'), 0, 'başka personelin sayısı ortak önbellekten sızmaz');
      assert.equal((await asStaff(() => messaging.getInboxSummary(hotelId))).waiting, 1);
    });
  });

  describe('misafir istekleri', () => {
    const create = (input) =>
      asStaff(() => requests.createRequest(hotelId, { source: 'FRONT_DESK', ...input }));

    it('yalnızca oda seçilince içerideki misafir ve konaklama bağlanır', async () => {
      const request = await create({ category: 'AMENITY', title: '2 havlu', roomId: room['101'].id });
      assert.equal(request.guest.name, 'Elif Demir');
      assert.equal(request.reservation.id, stay.id);
      assert.equal(request.createdBy, STAFF_EMAIL);
    });

    it('boş odaya açılan istek misafirsiz kalır', async () => {
      const request = await create({ category: 'MAINTENANCE', title: 'Musluk damlatıyor', roomId: room['102'].id });
      assert.equal(request.guest, null);
      assert.equal(request.priority, 'HIGH', 'arıza varsayılan olarak yüksek öncelik');
    });

    it('konaklamanın odası dışında oda seçilemez', async () => {
      await assert.rejects(
        () => create({ category: 'AMENITY', title: 'Havlu', reservationId: stay.id, roomId: room['102'].id }),
        (error) => error.code === 'VALIDATION',
      );
    });

    it('hizmet süresi önceliğe göre, uyandırmada istenen saate göre hesaplanır', async () => {
      const complaint = await create({ category: 'COMPLAINT', title: 'Gürültü', roomId: room['101'].id });
      const minutes = (new Date(complaint.dueAt) - new Date(complaint.createdAt)) / 60_000;
      assert.equal(complaint.priority, 'URGENT');
      assert.equal(minutes, 15);

      const at = new Date(Date.now() + 8 * 3_600_000);
      const wake = await create({ category: 'WAKE_UP', title: 'Uyandırma', roomId: room['101'].id, scheduledFor: at });
      assert.equal(new Date(wake.dueAt).getTime(), at.getTime());
    });

    it('konuşmadan açılan istek konuşmanın konaklamasına bağlanır', async () => {
      const { conversationId, message } = await inbound();
      const request = await asStaff(() =>
        requests.createRequestFromConversation(hotelId, conversationId, {
          category: 'AMENITY',
          title: 'İki havlu',
          messageId: message.id,
        }),
      );
      assert.equal(request.room.number, '101');
      assert.equal(request.source, 'CONVERSATION');
      assert.equal(request.conversation.id, conversationId);

      const detail = await messaging.getConversation(hotelId, conversationId);
      assert.equal(detail.openRequestCount, 1);
    });

    it('konaklaması olmayan konuşmadan oda seçmeden istek açılamaz', async () => {
      const { conversationId } = await inbound({ channel: 'WEBCHAT', externalId: `oturum-${randomUUID()}` });
      await assert.rejects(
        () => asStaff(() => requests.createRequestFromConversation(hotelId, conversationId, { category: 'OTHER', title: 'Soru' })),
        (error) => error.code === 'VALIDATION' && error.details?.field === 'roomId',
      );
    });

    it('başka konuşmanın mesajına bağlanamaz', async () => {
      const first = await inbound();
      const second = await inbound({ externalId: '905550000040' });
      await assert.rejects(
        () =>
          asStaff(() =>
            requests.createRequestFromConversation(hotelId, first.conversationId, {
              category: 'AMENITY',
              title: 'Havlu',
              messageId: second.message.id,
            }),
          ),
        (error) => error.code === 'VALIDATION',
      );
    });

    it('başlatan kişi atanmamış isteği üstlenir; tamamlama zamanı ve notu yazılır', async () => {
      const request = await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      const started = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'IN_PROGRESS', expectedUpdatedAt: new Date(request.updatedAt) }),
      );
      assert.equal(started.assignedTo.name, 'Resepsiyon Ayşe');
      assert.ok(started.startedAt);

      const done = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, {
          status: 'DONE',
          note: 'Kat görevlisi bıraktı',
          expectedUpdatedAt: new Date(started.updatedAt),
        }),
      );
      assert.equal(done.status, 'DONE');
      assert.ok(done.completedAt);
      assert.equal(done.resolutionNote, 'Kat görevlisi bıraktı');
      assert.equal(done.overdue, false);
    });

    it('geçersiz geçiş ve bayat sürüm reddedilir', async () => {
      const request = await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      const version = new Date(request.updatedAt);
      const done = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'DONE', expectedUpdatedAt: version }),
      );
      await assert.rejects(
        () =>
          asStaff(() =>
            requests.changeRequestStatus(hotelId, request.id, { status: 'IN_PROGRESS', expectedUpdatedAt: new Date(done.updatedAt) }),
          ),
        (error) => error.code === 'INVALID_TRANSITION',
      );
      await assert.rejects(
        () => asStaff(() => requests.changeRequestStatus(hotelId, request.id, { status: 'OPEN', expectedUpdatedAt: version })),
        (error) => error.code === 'STALE_WRITE',
      );
    });

    it('yeniden açılan istekte süre yeniden başlar, kapanış bilgisi silinir', async () => {
      const request = await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      await db.guestRequest.update({ where: { id: request.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
      const current = await db.guestRequest.findUnique({ where: { id: request.id } });
      const done = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'DONE', expectedUpdatedAt: current.updatedAt }),
      );
      const reopened = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'OPEN', expectedUpdatedAt: new Date(done.updatedAt) }),
      );
      assert.equal(reopened.completedAt, null);
      assert.equal(reopened.overdue, false);
      assert.ok(reopened.minutesLeft > 0);
    });

    it('başlatılmış işi bekleyene almak gecikmeyi silmez', async () => {
      const request = await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      const lateDue = new Date(Date.now() - 20 * 60_000);
      await db.guestRequest.update({ where: { id: request.id }, data: { dueAt: lateDue } });
      const current = await db.guestRequest.findUnique({ where: { id: request.id } });
      const started = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'IN_PROGRESS', expectedUpdatedAt: current.updatedAt }),
      );
      const back = await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'OPEN', expectedUpdatedAt: new Date(started.updatedAt) }),
      );
      assert.equal(back.startedAt, null);
      assert.equal(back.dueAt, lateDue.toISOString());
      assert.equal(back.overdue, true);
    });

    it('öncelik değişince süre isteğin açıldığı andan yeniden hesaplanır', async () => {
      const request = await create({ category: 'INFORMATION', title: 'Kahvaltı saati', roomId: room['101'].id });
      const updated = await asStaff(() =>
        requests.updateRequest(hotelId, request.id, { priority: 'URGENT', expectedUpdatedAt: new Date(request.updatedAt) }),
      );
      const minutes = (new Date(updated.dueAt) - new Date(request.createdAt)) / 60_000;
      assert.equal(minutes, 15);
    });

    it('gecikmiş, bana atanan ve tamamlanan görünümleri ayrışır', async () => {
      const late = await create({ category: 'AMENITY', title: 'Geç kalan', roomId: room['101'].id });
      await db.guestRequest.update({ where: { id: late.id }, data: { dueAt: new Date(Date.now() - 60_000) } });
      const assigned = await create({
        category: 'AMENITY',
        title: 'Bana atanan',
        roomId: room['102'].id,
        assignedToId: staff.id,
      });

      const view = (name) => asStaff(() => requests.listRequests(hotelId, { view: name, page: 1, pageSize: 25 }));
      assert.deepEqual((await view('OVERDUE')).items.map((row) => row.id), [late.id]);
      assert.deepEqual((await view('MINE')).items.map((row) => row.id), [assigned.id]);
      assert.deepEqual(
        (await view('ACTIVE')).items.map((row) => row.id),
        [late.id, assigned.id],
        'en acil önce',
      );
      assert.equal((await view('DONE')).items.length, 0);

      const summary = await asStaff(() => requests.getRequestSummary(hotelId));
      assert.equal(summary.open, 2);
      assert.equal(summary.overdue, 1);
      assert.equal(summary.mine, 1);
      assert.equal(summary.byCategory.AMENITY, 2);
    });

    it('oda numarası, misafir adı ve başlıkla aranır; silinmiş istek kategori sayısına girmez', async () => {
      const guestRequest = await create({ category: 'AMENITY', title: 'Ekstra yastık', roomId: room['101'].id });
      await create({ category: 'MAINTENANCE', title: 'Musluk', roomId: room['102'].id });
      const search = (text) =>
        asStaff(() => requests.listRequests(hotelId, { view: 'ALL', page: 1, pageSize: 25, search: text }));

      assert.deepEqual((await search('101')).items.map((row) => row.id), [guestRequest.id], 'oda numarası (kısa)');
      assert.deepEqual((await search('elif')).items.map((row) => row.id), [guestRequest.id], 'misafir adı');
      assert.deepEqual((await search('yastık')).items.map((row) => row.id), [guestRequest.id], 'başlık');
      assert.deepEqual((await search('zz')).items, [], 'kısa kelime metinde aranmaz');

      await db.guestRequest.update({ where: { id: guestRequest.id }, data: { deletedAt: new Date() } });
      const summary = await asStaff(() => requests.getRequestSummary(hotelId));
      assert.equal(summary.byCategory.AMENITY, undefined);
      assert.equal(summary.byCategory.MAINTENANCE, 1);
    });

    it('bitmiş işlerin sayımı üst sınırlıdır; açık işler tam sayılır', async () => {
      const now = new Date();
      await db.guestRequest.createMany({
        data: Array.from({ length: requests.REQUEST_COUNT_CAP + 5 }, (_, index) => ({
          hotelId,
          category: 'AMENITY',
          title: `Eski ${index}`,
          status: 'DONE',
          source: 'FRONT_DESK',
          dueAt: now,
          completedAt: new Date(now.getTime() - index * 1000),
          completedBy: 'test',
          createdBy: 'test',
        })),
      });
      const done = await asStaff(() => requests.listRequests(hotelId, { view: 'DONE', page: 1, pageSize: 20 }));
      assert.equal(done.meta.total, requests.REQUEST_COUNT_CAP);
      assert.equal(done.meta.totalCapped, true);
      assert.equal(done.items[0].title, 'Eski 0', 'yeni biten önce');

      await create({ category: 'AMENITY', title: 'Açık', roomId: room['101'].id });
      const active = await asStaff(() => requests.listRequests(hotelId, { view: 'ACTIVE', page: 1, pageSize: 20 }));
      assert.equal(active.meta.total, 1);
      assert.equal(active.meta.totalCapped, false);
    });

    it('önbellekli liste ve özet durum değişikliğini hemen yansıtır', async () => {
      const request = await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      const active = () => asStaff(() => requests.listRequests(hotelId, { view: 'ACTIVE', page: 1, pageSize: 25 }));
      assert.equal((await active()).meta.total, 1);
      assert.equal((await asStaff(() => requests.getRequestSummary(hotelId))).open, 1);

      await asStaff(() =>
        requests.changeRequestStatus(hotelId, request.id, { status: 'DONE', expectedUpdatedAt: new Date(request.updatedAt) }),
      );
      assert.equal((await active()).meta.total, 0);
      assert.equal((await asStaff(() => requests.getRequestSummary(hotelId))).open, 0);
    });

    it('oda bağlamı içerideki misafiri ve açık istek sayısını verir', async () => {
      await create({ category: 'AMENITY', title: 'Havlu', roomId: room['101'].id });
      const context = await requests.getRoomContext(hotelId, room['101'].id);
      assert.equal(context.stay.guestName, 'Elif Demir');
      assert.equal(context.openRequests, 1);
      assert.equal((await requests.getRoomContext(hotelId, room['103'].id)).stay, null);
    });

    it('atanabilir personel listesinde pasif ve başka otelin personeli yok', async () => {
      const names = (await requests.listAssignees(hotelId)).map((user) => user.name);
      assert.deepEqual(names, ['Kat Görevlisi Mehmet', 'Resepsiyon Ayşe']);
    });
  });
});
