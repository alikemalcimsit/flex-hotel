import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activityFeedQuerySchema,
  actorKind,
  auditQuerySchema,
  chainParamSchema,
  eventLogQuerySchema,
  maskValue,
  redactPayload,
} from './activity.js';

/**
 * Aktivite ve denetim sözleşmesi: kişisel veri maskelemesi (olay listesi
 * teknik bir görünüm; telefon, e-posta, kimlik tam görünmez), aktör türü ve
 * süzgeç şemalarının kötü girdiyi reddetmesi.
 */

describe('kişisel veri maskeleme', () => {
  it('telefon ve metin baştan/sondan kısmen görünür; kısa değer tamamen gizlenir', () => {
    assert.equal(maskValue('+905321110001'), '+9*********01');
    assert.equal(maskValue('12345'), '1***5');
    assert.equal(maskValue('abcd'), '****');
  });

  it('e-postada kullanıcı adı ve alan adı ayrı maskelenir', () => {
    assert.equal(maskValue('ayse@example.com'), '****@ex*******om');
  });

  it('olay gövdesindeki hassas alanlar iç içe de maskelenir; kimlikler, tarihler, adlar kalır', () => {
    const payload = {
      hotelId: '11111111-1111-4111-8111-111111111111',
      requestId: 'req-1',
      checkIn: '2026-10-15',
      guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: 'ayse@example.com', nationality: 'TR' },
      companions: [{ identityNumber: '10000000146', documentType: 'ID_CARD' }],
      hasAccessToken: true,
      settings: { accessToken: null },
    };
    const redacted = redactPayload(payload);
    assert.equal(redacted.hotelId, payload.hotelId);
    assert.equal(redacted.checkIn, '2026-10-15');
    assert.equal(redacted.guest.firstName, 'Ayşe');
    assert.equal(redacted.guest.nationality, 'TR');
    assert.equal(redacted.guest.phone, '+9*********01');
    assert.equal(redacted.guest.email, '****@ex*******om');
    assert.equal(redacted.companions[0].identityNumber, '10*******46');
    assert.equal(redacted.hasAccessToken, true, 'mantıksal değer maskelenmez');
    assert.equal(redacted.settings.accessToken, null);
    assert.equal(payload.guest.phone, '+905321110001', 'girdi değişmez');
  });

  it('aşırı derin gövde kesilir (sonsuz iç içe yapı sunucuyu yormaz)', () => {
    let deep = { value: 1 };
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    let node = redactPayload(deep);
    let depth = 0;
    while (node && typeof node === 'object') {
      node = node.child;
      depth += 1;
    }
    assert.equal(node, '[…]');
    assert.ok(depth <= 9);
  });
});

describe('aktör türü', () => {
  it('kişi, kanal, sistem, aktör', () => {
    assert.equal(actorKind('mudur@otel.com'), 'USER');
    assert.equal(actorKind('kanal:whatsapp'), 'CHANNEL');
    assert.equal(actorKind('system'), 'SYSTEM');
    assert.equal(actorKind(null), 'SYSTEM');
    assert.equal(actorKind('room-worker'), 'ACTOR');
  });
});

describe('süzgeç şemaları', () => {
  it('akış: seviye, tarih aralığı ve imleç birlikte doğrulanır', () => {
    const ok = activityFeedQuerySchema.parse({ level: 'PROBLEMS', from: '2026-09-24T00:00:00Z', limit: '20' });
    assert.equal(ok.limit, 20);
    assert.ok(ok.from instanceof Date);
    assert.equal(activityFeedQuerySchema.safeParse({ level: 'DEBUG' }).success, false);
    assert.equal(activityFeedQuerySchema.safeParse({ from: '2026-09-25', to: '2026-09-24' }).success, false);
    assert.equal(activityFeedQuerySchema.safeParse({ cursor: 'a', ids: crypto.randomUUID() }).success, false);
    const id = crypto.randomUUID();
    assert.deepEqual(activityFeedQuerySchema.parse({ ids: `${id}, ${id}` }).ids, [id], 'tekrar atılır');
    assert.equal(activityFeedQuerySchema.safeParse({ ids: 'abc' }).success, false);
    assert.equal(activityFeedQuerySchema.safeParse({ limit: 500 }).success, false);
    assert.equal(activityFeedQuerySchema.safeParse({ correlationId: 'x' }).success, false);
  });

  it('olay listesi: "dağıtılmamış" seçeneği metinden mantıksal değere', () => {
    assert.equal(eventLogQuerySchema.parse({ unpublished: 'true' }).unpublished, true);
    assert.equal(eventLogQuerySchema.parse({}).unpublished, undefined);
    assert.equal(eventLogQuerySchema.safeParse({ unpublished: 'evet' }).success, false);
  });

  it('denetim: kayıt kimliği türsüz aranmaz; kişi küçük harfe çevrilir', () => {
    assert.equal(auditQuerySchema.safeParse({ entityId: 'abc' }).success, false);
    assert.equal(auditQuerySchema.parse({ actor: 'Mudur@Otel.com' }).actor, 'mudur@otel.com');
    assert.equal(auditQuerySchema.safeParse({ action: 'CHECK_IN' }).success, false);
  });

  it('zincir kimliği: kısa ya da tuhaf karakterli kimlik reddedilir', () => {
    assert.equal(chainParamSchema.safeParse({ correlationId: 'abc' }).success, false);
    assert.equal(chainParamSchema.safeParse({ correlationId: 'drop table;--' }).success, false);
    assert.equal(chainParamSchema.safeParse({ correlationId: crypto.randomUUID() }).success, true);
  });
});
