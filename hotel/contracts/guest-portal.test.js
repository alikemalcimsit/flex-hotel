import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GUEST_PORTAL_DEFAULT_TEXTS,
  guestPortalLanguageFor,
  guestPortalOpen,
  guestPortalSettingsSchema,
  guestPortalText,
  onlineCheckinPhotoProblems,
  onlineCheckinSubmitSchema,
  onlineCheckinToCheckInValues,
  onlineCheckinWindow,
} from './guest-portal.js';

const reservation = (overrides = {}) => ({ status: 'CONFIRMED', checkIn: '2026-11-10', checkOut: '2026-11-13', ...overrides });
const window = (res, context = {}) => onlineCheckinWindow(res, { today: '2026-11-05', openDays: 7, enabled: true, ...context });

describe('misafir portalı kuralları', () => {
  it('dil: uyruğa göre; bilinmeyen Türkçe, diğerleri İngilizce', () => {
    assert.deepEqual(['TR', 'AZ', 'DE', 'at', 'RU', 'KZ', 'UA', 'GB', null].map(guestPortalLanguageFor), ['tr', 'tr', 'de', 'de', 'ru', 'ru', 'en', 'en', 'tr']);
  });

  it('online check-in penceresi: açılış günü, kapalı ayar, iptal, giriş yapılmış, çıkış günü geçmiş', () => {
    assert.deepEqual(window(reservation()), { open: true, reason: null, opensOn: '2026-11-03' });
    assert.deepEqual(window(reservation({ checkIn: '2026-11-20', checkOut: '2026-11-22' })), { open: false, reason: 'NOT_YET', opensOn: '2026-11-13' });
    assert.equal(window(reservation(), { enabled: false }).reason, 'DISABLED');
    assert.equal(window(reservation({ status: 'CANCELLED' })).reason, 'CANCELLED');
    assert.equal(window(reservation({ status: 'CHECKED_IN' })).reason, 'COMPLETED');
    assert.equal(window(reservation(), { submission: { status: 'COMPLETED' } }).reason, 'COMPLETED');
    assert.equal(window(reservation({ status: 'CHECKED_OUT' })).reason, 'CLOSED');
    assert.equal(window(reservation({ checkIn: '2026-11-03', checkOut: '2026-11-05' })).reason, 'CLOSED', 'çıkış günü gelen gelmeyen');
    // Gelişi geçmiş ama konaklaması süren (geç gelecek) misafir hâlâ gönderebilir.
    assert.equal(window(reservation({ checkIn: '2026-11-04', checkOut: '2026-11-07' })).open, true);
    // Düzeltme istenmiş / onaylı kayıt yeniden gönderilebilir.
    assert.equal(window(reservation(), { submission: { status: 'REJECTED' } }).open, true);
  });

  it('portal: iptal / gelmedi kapalı; çıkıştan 14 gün sonra kapanır', () => {
    assert.equal(guestPortalOpen({ status: 'CANCELLED', checkOut: '2026-11-13' }, '2026-11-05'), false);
    assert.equal(guestPortalOpen({ status: 'CHECKED_OUT', checkOut: '2026-11-01' }, '2026-11-15'), true);
    assert.equal(guestPortalOpen({ status: 'CHECKED_OUT', checkOut: '2026-11-01' }, '2026-11-16'), false);
  });

  it('metin: otelin o dildeki → otelin İngilizcesi → o dilin varsayılanı; saatler otelin', () => {
    const texts = { tr: { houseRules: 'Evcil hayvan yok.' }, en: { houseRules: 'No pets.' } };
    assert.equal(guestPortalText(texts, 'tr', 'houseRules'), 'Evcil hayvan yok.');
    assert.equal(guestPortalText(texts, 'de', 'houseRules'), 'No pets.');
    assert.match(guestPortalText({}, 'ru', 'houseRules', { checkInTime: '15:00', checkOutTime: '11:00' }), /^Заселение с 15:00, выезд до 11:00\./);
    assert.equal(guestPortalText({ de: { welcome: '   ' } }, 'de', 'welcome'), GUEST_PORTAL_DEFAULT_TEXTS.de.welcome);
  });

  it('belge fotoğrafı: her yetişkine zorunlu, çocuğa değil; kişi başına en fazla 2', () => {
    const input = (primary, companions) => ({ primary: { documentIds: primary }, companions: companions.map(([isChild, ids]) => ({ person: { isChild }, documentIds: ids })) });
    assert.deepEqual(onlineCheckinPhotoProblems(input(['a'], [[true, []]])), []);
    assert.deepEqual(onlineCheckinPhotoProblems(input([], [[false, ['b', 'c', 'd']]])), [
      { person: 0, problem: 'PHOTO_REQUIRED' },
      { person: 1, problem: 'TOO_MANY_PHOTOS' },
    ]);
  });

  it('gönderim şeması: onaylar zorunlu, TC kimlik sağlaması, aynı fotoğraf iki kişiye bağlanamaz, plaka büyük harf', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const base = {
      primary: { identity: { idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR', birthDate: '1990-01-01' }, documentIds: [id] },
      companions: [],
      vehiclePlate: '06 abc 123',
      paymentPreference: 'CASH_AT_DESK',
      consents: { privacy: true, rules: true, documentPhotos: true },
      signature: { contentType: 'image/png', image: 'iVBORw0KGgo=' },
    };
    const parsed = onlineCheckinSubmitSchema.parse(base);
    assert.deepEqual([parsed.vehiclePlate, parsed.language, parsed.consents.marketing], ['06 ABC 123', 'tr', false]);
    assert.equal(onlineCheckinSubmitSchema.safeParse({ ...base, consents: { privacy: true, rules: false, documentPhotos: true } }).success, false);
    assert.equal(onlineCheckinSubmitSchema.safeParse({ ...base, primary: { ...base.primary, identity: { ...base.primary.identity, idNumber: '10000000147' } } }).success, false);
    const shared = onlineCheckinSubmitSchema.safeParse({ ...base, companions: [{ person: { firstName: 'Ali', lastName: 'Kaya', idType: 'PASSPORT', idNumber: 'U1234567', nationality: 'TR' }, documentIds: [id] }] });
    assert.equal(shared.success, false);
    assert.match(shared.error.issues.map((issue) => issue.message).join(' '), /iki kişiye/);
  });

  it('ayar şeması: adres https (yolsuz) ya da yerel; sondaki eğik çizgi atılır; boş → yok', () => {
    const base = { enabled: true, inviteDaysBefore: 3, checkinOpenDays: 7, documentRetentionDays: 7, texts: {} };
    assert.equal(guestPortalSettingsSchema.parse({ ...base, publicBaseUrl: 'https://hotel.flexai.tr/' }).publicBaseUrl, 'https://hotel.flexai.tr');
    assert.equal(guestPortalSettingsSchema.parse({ ...base, publicBaseUrl: 'http://localhost:5174' }).publicBaseUrl, 'http://localhost:5174');
    assert.equal(guestPortalSettingsSchema.parse({ ...base, publicBaseUrl: '' }).publicBaseUrl, null);
    for (const bad of ['http://hotel.flexai.tr', 'https://hotel.flexai.tr/misafir', 'hotel.flexai.tr']) {
      assert.equal(guestPortalSettingsSchema.safeParse({ ...base, publicBaseUrl: bad }).success, false, bad);
    }
    assert.equal(guestPortalSettingsSchema.safeParse({ ...base, inviteDaysBefore: 15 }).success, false);
  });

  it('giriş penceresinin ön dolumu: kişiler ve plaka', () => {
    const values = onlineCheckinToCheckInValues({
      guest: { firstName: 'Anna', idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-04-12' },
      companions: [{ firstName: 'Mia', lastName: 'Müller', isChild: true }],
      vehiclePlate: 'M AB 1234',
    });
    assert.deepEqual(values, {
      guest: { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-04-12' },
      companions: [{ firstName: 'Mia', lastName: 'Müller', isChild: true, idType: null, idNumber: null, nationality: null, birthDate: null }],
      vehiclePlate: 'M AB 1234',
    });
  });
});
