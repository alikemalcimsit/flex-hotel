import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeCursor,
  deliveryAdvances,
  encodeCursor,
  messagePreview,
  normalizeEmail,
  olderThan,
  phoneMatchKey,
  phoneMatchScore,
} from './rules.js';

/**
 * Gelen kutusunun saf kuralları. Yanlış imleç konuşma kaybettirir, yanlış
 * telefon eşleşmesi misafire başkasının odasını gösterir.
 */

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('imleç', () => {
  it('kodlanıp aynen çözülür', () => {
    const at = new Date('2026-09-17T08:15:30.123Z');
    assert.deepEqual(decodeCursor(encodeCursor({ at, id: ID })), { at, id: ID });
  });

  it('bozuk imleç hata fırlatmaz, null döner', () => {
    for (const value of ['', 'abc', Buffer.from('tarih-degil|x').toString('base64url'), Buffer.from(`2026-09-17T08:00:00Z|kimlik`).toString('base64url')]) {
      assert.equal(decodeCursor(value), null, value);
    }
  });

  it('aynı zamanda yazılmış kayıtlar kimlikle ayrılır', () => {
    const at = new Date('2026-09-17T08:00:00.000Z');
    assert.deepEqual(olderThan('lastMessageAt', { at, id: ID }), {
      OR: [{ lastMessageAt: { lt: at } }, { lastMessageAt: at, id: { lt: ID } }],
    });
  });
});

describe('messagePreview', () => {
  it('satır sonlarını tek boşluğa indirir', () => {
    assert.equal(messagePreview('Merhaba\n\n  iki havlu   lazım'), 'Merhaba iki havlu lazım');
  });

  it('uzun metni üç noktayla keser', () => {
    const preview = messagePreview('a'.repeat(300), 20);
    assert.equal(preview.length, 20);
    assert.ok(preview.endsWith('…'));
  });
});

describe('telefon eşleştirme', () => {
  const TR = '90';

  it('arama anahtarı yazım biçiminden bağımsızdır', () => {
    for (const written of ['905321110001', '+90 (532) 111-00-01', '0090 532 111 00 01', '0532 111 00 01']) {
      assert.equal(phoneMatchKey(written), '1110001', written);
    }
  });

  it('telefon olmayan adreste anahtar yoktur', () => {
    assert.equal(phoneMatchKey('webchat-oturum-abc'), null);
    assert.equal(phoneMatchKey('1234'), null);
    assert.equal(phoneMatchKey(''), null);
  });

  it('ülke koduyla yazılmış kart birebir eşleşir', () => {
    assert.equal(phoneMatchScore('+90 532 111 00 01', '905321110001', TR), 2);
    assert.equal(phoneMatchScore('0090 532 111 00 01', '905321110001', TR), 2);
    assert.equal(phoneMatchScore('905321110001', '905321110001', TR), 2);
  });

  it('yerel biçimde yazılmış kart otelin ülke koduyla eşleşir', () => {
    assert.equal(phoneMatchScore('0532 111 00 01', '905321110001', TR), 1);
    assert.equal(phoneMatchScore('532 111 00 01', '905321110001', TR), 1);
    assert.equal(phoneMatchScore('06 12 34 56 78', '33612345678', '33'), 1);
  });

  it('son rakamları aynı ama ülkesi farklı numara eşleşmez', () => {
    assert.equal(phoneMatchScore('0533 222 33 44', '15332223344', TR), 0);
    assert.equal(phoneMatchScore('+44 7321 110001', '905321110001', TR), 0);
    assert.equal(phoneMatchScore('06 12 34 56 78', '33612345678', TR), 0);
  });

  it('ülke kodu bilinmiyorsa yerel yazım tahmin edilmez', () => {
    assert.equal(phoneMatchScore('0532 111 00 01', '905321110001', null), 0);
  });

  it('kısa ya da boş numara eşleşmez', () => {
    assert.equal(phoneMatchScore(null, '905321110001', TR), 0);
    assert.equal(phoneMatchScore('110001', '905321110001', TR), 0);
    assert.equal(phoneMatchScore('0532 111 00 01', 'oturum-1', TR), 0);
  });
});

describe('normalizeEmail', () => {
  it('küçük harfe çevirir, geçersizi atar', () => {
    assert.equal(normalizeEmail('  Ayse@Example.COM '), 'ayse@example.com');
    assert.equal(normalizeEmail('ayse@'), null);
  });
});

describe('deliveryAdvances', () => {
  it('teslim durumu yalnızca ileri gider', () => {
    assert.equal(deliveryAdvances('PENDING', 'SENT'), true);
    assert.equal(deliveryAdvances('READ', 'DELIVERED'), false, 'geç gelen bildirim geri almaz');
    assert.equal(deliveryAdvances('SENT', 'SENT'), false);
  });

  it('hata yalnızca iletilmemiş mesaja yazılır', () => {
    assert.equal(deliveryAdvances('PENDING', 'FAILED'), true);
    assert.equal(deliveryAdvances('DELIVERED', 'FAILED'), false);
  });

  it('başarısız mesaj yeniden denenip gönderilebilir', () => {
    assert.equal(deliveryAdvances('FAILED', 'SENT'), true);
  });
});
