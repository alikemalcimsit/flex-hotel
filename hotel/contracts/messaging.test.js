import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUEST_REQUEST_SLA_MINUTES, MAX_MESSAGE_LENGTH } from './constants.js';
import {
  changeGuestRequestStatusSchema,
  createGuestRequestSchema,
  createRequestFromConversationSchema,
  defaultGuestRequestPriority,
  deliveryReportSchema,
  guestRequestDueAt,
  guestRequestTiming,
  guestRequestTransitionError,
  inboundMessageSchema,
  inboxQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from './messaging.js';

/**
 * Misafir mesajları ve istekleri. Bu kurallar yanlış olursa istek "tamamlandı"
 * görünüp yapılmamış olur ya da uyandırma saati kaçar — misafir şikâyeti.
 */

const ROOM_ID = '00000000-0000-4000-8000-000000000001';
const VERSION = '2026-09-17T08:00:00.000Z';
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000);

describe('guestRequestTransitionError', () => {
  it('bekleyen iş başlatılır, tamamlanır ya da iptal edilir', () => {
    for (const to of ['IN_PROGRESS', 'DONE', 'CANCELLED']) {
      assert.equal(guestRequestTransitionError('OPEN', to), null, to);
    }
  });

  it('başlatılmış iş geri alınabilir', () => {
    assert.equal(guestRequestTransitionError('IN_PROGRESS', 'OPEN'), null);
  });

  it('tamamlanan ya da iptal edilen iş yeniden açılabilir ama doğrudan başlatılamaz', () => {
    assert.equal(guestRequestTransitionError('DONE', 'OPEN'), null);
    assert.equal(guestRequestTransitionError('CANCELLED', 'OPEN'), null);
    assert.match(guestRequestTransitionError('DONE', 'IN_PROGRESS'), /Tamamlandı/);
    assert.ok(guestRequestTransitionError('CANCELLED', 'DONE'));
  });

  it('aynı duruma geçiş zararsızdır', () => {
    assert.equal(guestRequestTransitionError('DONE', 'DONE'), null);
  });

  it('bilinmeyen durum reddedilir', () => {
    assert.ok(guestRequestTransitionError('OPEN', 'BEKLEMEDE'));
  });
});

describe('guestRequestDueAt / guestRequestTiming', () => {
  const createdAt = new Date('2026-09-17T08:00:00.000Z');

  it('öncelik süresini ekler', () => {
    const due = guestRequestDueAt({ priority: 'URGENT', createdAt });
    assert.equal(due.getTime() - createdAt.getTime(), GUEST_REQUEST_SLA_MINUTES.URGENT * 60_000);
  });

  it('zamanlı istekte hedef istenen saattir', () => {
    const scheduledFor = new Date('2026-09-18T04:30:00.000Z');
    assert.equal(guestRequestDueAt({ priority: 'LOW', createdAt, scheduledFor }).getTime(), scheduledFor.getTime());
  });

  it('süresi geçen açık istek gecikmiştir, tamamlanan gecikmiş sayılmaz', () => {
    const now = new Date('2026-09-17T09:10:00.000Z');
    const dueAt = new Date('2026-09-17T09:00:00.000Z');
    assert.deepEqual(guestRequestTiming({ status: 'OPEN', dueAt }, now), { active: true, overdue: true, minutesLeft: -10 });
    assert.equal(guestRequestTiming({ status: 'DONE', dueAt }, now).overdue, false);
  });

  it('kalan süre dakika olarak döner', () => {
    const now = new Date('2026-09-17T08:45:00.000Z');
    assert.equal(guestRequestTiming({ status: 'IN_PROGRESS', dueAt: '2026-09-17T09:00:00.000Z' }, now).minutesLeft, 15);
  });

  it('şikâyet varsayılan olarak acil, bilgi talebi düşük önceliktir', () => {
    assert.equal(defaultGuestRequestPriority('COMPLAINT'), 'URGENT');
    assert.equal(defaultGuestRequestPriority('INFORMATION'), 'LOW');
    assert.equal(defaultGuestRequestPriority('BILINMEYEN'), 'NORMAL');
  });
});

describe('mesaj sözleşmeleri', () => {
  it('mesaj kırpılır; boş ve çok uzun mesaj reddedilir', () => {
    assert.equal(sendMessageSchema.parse({ text: '  merhaba  ' }).text, 'merhaba');
    assert.equal(sendMessageSchema.safeParse({ text: '   ' }).success, false);
    assert.equal(sendMessageSchema.safeParse({ text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }).success, false);
  });

  it('iç not varsayılan olarak kapalıdır', () => {
    assert.equal(sendMessageSchema.parse({ text: 'a' }).internal, false);
  });

  it('gelen mesajda kanal mesaj kimliği zorunludur (webhook tekrarı)', () => {
    const base = { channel: 'WHATSAPP', externalId: '+905551112233', text: 'Havlu lazım' };
    assert.equal(inboundMessageSchema.safeParse(base).success, false);
    assert.equal(inboundMessageSchema.safeParse({ ...base, externalMessageId: 'wamid.1' }).success, true);
  });

  it('kanal yalnızca giden mesaj durumlarını bildirebilir', () => {
    assert.equal(deliveryReportSchema.safeParse({ delivery: 'DELIVERED' }).success, true);
    assert.equal(deliveryReportSchema.safeParse({ delivery: 'RECEIVED' }).success, false);
  });

  it('konuşma güncellemesi en az bir alan ister', () => {
    assert.equal(updateConversationSchema.safeParse({ expectedStateVersion: 3 }).success, false);
    assert.equal(updateConversationSchema.safeParse({ mode: 'MANUAL', expectedStateVersion: 3 }).success, true);
  });

  it('atama kaldırılabilir (null)', () => {
    const parsed = updateConversationSchema.parse({ assignedToId: null, expectedStateVersion: 0 });
    assert.equal(parsed.assignedToId, null);
  });

  it('yönetim işlemi sürüm bilgisi ister', () => {
    assert.equal(updateConversationSchema.safeParse({ mode: 'MANUAL' }).success, false);
    assert.equal(updateConversationSchema.safeParse({ mode: 'MANUAL', expectedStateVersion: -1 }).success, false);
  });

  it('gelen kutusu varsayılanı açık konuşmalardır', () => {
    assert.equal(inboxQuerySchema.parse({}).view, 'OPEN');
    assert.equal(inboxQuerySchema.safeParse({ limit: 500 }).success, false);
  });
});

describe('istek sözleşmeleri', () => {
  const base = { category: 'AMENITY', title: '2 havlu', roomId: ROOM_ID };

  it('oda ya da konaklama olmadan istek açılmaz', () => {
    const result = createGuestRequestSchema.safeParse({ category: 'AMENITY', title: 'Havlu' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].path[0], 'roomId');
  });

  it('uyandırma saati zorunludur', () => {
    const result = createGuestRequestSchema.safeParse({ ...base, category: 'WAKE_UP' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'Uyandırma için saat seçin');
    assert.equal(
      createGuestRequestSchema.safeParse({ ...base, category: 'WAKE_UP', scheduledFor: inMinutes(600) }).success,
      true,
    );
  });

  it('geçmiş saate zamanlı istek kurulamaz (kısa tolerans hariç)', () => {
    assert.equal(createGuestRequestSchema.safeParse({ ...base, scheduledFor: inMinutes(-60) }).success, false);
    assert.equal(createGuestRequestSchema.safeParse({ ...base, scheduledFor: inMinutes(-2) }).success, true);
  });

  it('çok ileri tarihe zamanlı istek kurulamaz', () => {
    assert.equal(createGuestRequestSchema.safeParse({ ...base, scheduledFor: inMinutes(60 * 24 * 45) }).success, false);
  });

  it('personel AI ya da mesaj kaynaklı istek açamaz', () => {
    assert.equal(createGuestRequestSchema.safeParse({ ...base, source: 'AI' }).success, false);
    assert.equal(createGuestRequestSchema.parse(base).source, 'FRONT_DESK');
  });

  it('konuşmadan istek odası olmadan açılabilir (konuşmanın konaklamasından alınır)', () => {
    assert.equal(createRequestFromConversationSchema.safeParse({ category: 'AMENITY', title: 'Havlu' }).success, true);
  });

  it('iptal sebep ister', () => {
    const result = changeGuestRequestStatusSchema.safeParse({ status: 'CANCELLED', expectedUpdatedAt: VERSION });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'İptal sebebini yazın');
    assert.equal(
      changeGuestRequestStatusSchema.safeParse({ status: 'CANCELLED', note: 'Misafir vazgeçti', expectedUpdatedAt: VERSION })
        .success,
      true,
    );
  });
});
