import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GUEST_PORTAL_LANGUAGES,
  ID_DOCUMENT_TYPES,
  MAX_GUEST_ACTIVE_ORDERS,
  MAX_GUEST_ORDER_LINES,
  ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON,
  ONLINE_CHECKIN_PAYMENT_PREFERENCES,
  ONLINE_CHECKIN_PHOTO_MAX_BYTES,
  ONLINE_CHECKIN_PHOTO_MAX_EDGE,
  ONLINE_CHECKIN_SIGNATURE_MAX_BYTES,
  ONLINE_CHECKIN_THUMB_MAX_BYTES,
  ONLINE_CHECKIN_THUMB_MAX_EDGE,
  GUEST_REQUEST_CATEGORIES,
  identityNumberError,
} from '@hotelos/hotel-contracts';
import * as limits from '../../guest/src/limits.js';
import { MESSAGES } from '../../guest/src/messages.js';

/**
 * Misafir uygulaması (modül 53) zod / sözleşme paketini taşımaz; sınırlarını ve belge numarası kuralını kendinde tutar.
 * Bu test ikisinin aynı kaldığını ve dört dilin aynı anahtarlara sahip olduğunu denetler.
 */
describe('misafir uygulaması ↔ sözleşme', () => {
  it('sınırlar ve listeler sözleşmeyle aynı', () => {
    assert.equal(limits.PHOTO_MAX_EDGE, ONLINE_CHECKIN_PHOTO_MAX_EDGE);
    assert.equal(limits.PHOTO_MAX_BYTES, ONLINE_CHECKIN_PHOTO_MAX_BYTES);
    assert.equal(limits.THUMB_MAX_EDGE, ONLINE_CHECKIN_THUMB_MAX_EDGE);
    assert.equal(limits.THUMB_MAX_BYTES, ONLINE_CHECKIN_THUMB_MAX_BYTES);
    assert.equal(limits.MAX_PHOTOS_PER_PERSON, ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON);
    assert.equal(limits.SIGNATURE_MAX_BYTES, ONLINE_CHECKIN_SIGNATURE_MAX_BYTES);
    assert.deepEqual([...limits.PORTAL_LANGUAGES], [...GUEST_PORTAL_LANGUAGES]);
    assert.deepEqual([...limits.PAYMENT_PREFERENCES], [...ONLINE_CHECKIN_PAYMENT_PREFERENCES]);
    assert.deepEqual([...limits.REQUEST_CATEGORIES], [...GUEST_REQUEST_CATEGORIES]);
    assert.deepEqual([...limits.ID_TYPES], [...ID_DOCUMENT_TYPES]);
    assert.equal(limits.MAX_ORDER_LINES, MAX_GUEST_ORDER_LINES);
    assert.equal(limits.MAX_ACTIVE_ORDERS, MAX_GUEST_ACTIVE_ORDERS);
  });

  it('belge numarası kuralı sözleşmedekiyle aynı sonucu verir', () => {
    const cases = [
      ['NATIONAL_ID', '10000000146', 'TR'],
      ['NATIONAL_ID', '10000000147', 'TR'],
      ['NATIONAL_ID', '01234567890', 'TR'],
      ['NATIONAL_ID', 'AB12345', 'DE'],
      ['PASSPORT', 'u12 345-67', 'TR'],
      ['PASSPORT', 'ABC', 'GB'],
      ['OTHER', 'Ç123456', 'RU'],
    ];
    for (const [idType, idNumber, nationality] of cases) {
      const expected = identityNumberError({ idType, idNumber, nationality }) === null;
      assert.equal(limits.idNumberProblem({ idType, idNumber, nationality }) === null, expected, `${idType} ${idNumber} ${nationality}`);
    }
  });

  it('dört dilin metin anahtarları aynı, boş metin yok', () => {
    const reference = Object.keys(MESSAGES.tr).sort();
    for (const language of GUEST_PORTAL_LANGUAGES) {
      assert.deepEqual(Object.keys(MESSAGES[language]).sort(), reference, language);
      for (const [key, text] of Object.entries(MESSAGES[language])) assert.ok(text.trim(), `${language}.${key}`);
    }
  });
});
