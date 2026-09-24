import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OFFER_TTL_MS,
  TOOL_SPECS,
  confirmationMessage,
  guessLanguage,
  handoffMessage,
  offerFresh,
  offersFrom,
  rejectionMessage,
  requestBlocker,
  validateGuestArgs,
  validateStayArgs,
} from './index.js';

/**
 * Concierge'ın saf kuralları: tarih ve kişi doğrulaması, teklif listesi,
 * "evet olmadan rezervasyon yok" korumaları ve modelden değil şablondan giden
 * mesajlar (onay kodu, ret, devir).
 */

const TODAY = '2026-10-10';

describe('konaklama argümanları', () => {
  it('geçerli tarih ve kişi', () => {
    assert.deepEqual(validateStayArgs({ check_in: '2026-10-15', check_out: '2026-10-18', adults: 2, children: 1 }, TODAY), {
      ok: true,
      value: { checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, adults: 2, children: 1 },
    });
  });

  it('geçmiş tarih, ters tarih, taşan tarih, uzun konaklama, büyük grup reddedilir (sebep modele)', () => {
    assert.match(validateStayArgs({ check_in: '2026-10-09', check_out: '2026-10-12', adults: 2, children: 0 }, TODAY).error, /past/);
    assert.match(validateStayArgs({ check_in: '2026-10-15', check_out: '2026-10-15', adults: 2, children: 0 }, TODAY).error, /after arrival/);
    assert.match(validateStayArgs({ check_in: '2026-02-30', check_out: '2026-03-02', adults: 2, children: 0 }, TODAY).error, /valid/);
    assert.match(validateStayArgs({ check_in: '2026-10-15', check_out: '2026-11-20', adults: 2, children: 0 }, TODAY).error, /30 nights/);
    assert.match(validateStayArgs({ check_in: '2026-10-15', check_out: '2026-10-18', adults: 11, children: 0 }, TODAY).error, /Adults/);
    assert.match(validateStayArgs({ check_in: '2026-10-15', check_out: '2026-10-18', adults: 0, children: 0 }, TODAY).error, /Adults/);
  });
});

describe('teklifler', () => {
  const quote = {
    currency: 'TRY',
    roomTypes: [
      { id: 't1', code: 'DLX', name: 'Deluxe', capacityAdults: 3, capacityChildren: 1, available: 2, total: '9000.00' },
      { id: 't2', code: 'STD', name: 'Standart', capacityAdults: 2, capacityChildren: 1, available: 5, total: '6000.00' },
      { id: 't3', code: 'SGL', name: 'Tek', capacityAdults: 1, capacityChildren: 0, available: 3, total: '3000.00' },
      { id: 't4', code: 'SUI', name: 'Suit', capacityAdults: 4, capacityChildren: 2, available: 0, total: '20000.00' },
    ],
  };
  const stay = { checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, adults: 2, children: 1 };

  it('yalnızca kişi sayısı sığan ve boş odası olan tipler, en ucuz önce; kimlik okunur ve sorguya özgü', () => {
    const offers = offersFrom(quote, stay);
    assert.deepEqual(offers.map((offer) => offer.offerId), ['STD-2026-10-15-2026-10-18-2-1', 'DLX-2026-10-15-2026-10-18-2-1']);
    assert.equal(offers[0].totalPrice, '6000.00');
  });

  it('teklif 30 dakika geçerli', () => {
    const at = '2026-10-10T10:00:00.000Z';
    assert.equal(offerFresh(at, Date.parse(at) + OFFER_TTL_MS), true);
    assert.equal(offerFresh(at, Date.parse(at) + OFFER_TTL_MS + 1), false);
    assert.equal(offerFresh(null, Date.now()), false);
  });
});

describe('misafir bilgisi', () => {
  it('ad-soyad ve bir iletişim bilgisi; WhatsApp\'ta numara zaten bilinir', () => {
    assert.match(validateGuestArgs({ first_name: 'Ayşe', last_name: '', phone: null, email: null }, { knownPhone: null }).error, /last name/);
    assert.match(validateGuestArgs({ first_name: 'Ayşe', last_name: 'Yılmaz', phone: null, email: null }, { knownPhone: null }).error, /phone number or an email/);
    assert.deepEqual(validateGuestArgs({ first_name: 'Ayşe', last_name: 'Yılmaz', phone: null, email: null }, { knownPhone: '+905321110001' }).value, {
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      phone: '+905321110001',
      email: null,
    });
    assert.match(validateGuestArgs({ first_name: 'A', last_name: 'B', phone: null, email: 'bozuk@' }, { knownPhone: null }).error, /Email/);
  });
});

describe('"evet" olmadan rezervasyon yok', () => {
  const pendingOffer = { offerId: 'STD-x', proposedAt: '2026-10-10T10:00:00.000Z' };
  const base = { offerId: 'STD-x', pendingOffer, latestGuestMessageAt: '2026-10-10T10:02:00.000Z', affirmative: true, pendingRequestId: null };

  it('dört koşul da tutuyorsa engel yok', () => {
    assert.equal(requestBlocker(base), null);
  });

  it('teklif sunulmamış / başka teklif / aynı turda sunulmuş / misafir onaylamamış / zaten istek var', () => {
    assert.match(requestBlocker({ ...base, pendingOffer: null }), /No proposal/);
    assert.match(requestBlocker({ ...base, offerId: 'DLX-y' }), /not proposed/);
    assert.match(requestBlocker({ ...base, latestGuestMessageAt: '2026-10-10T09:59:00.000Z' }), /not seen/);
    assert.match(requestBlocker({ ...base, affirmative: false }), /not explicitly confirmed/);
    assert.match(requestBlocker({ ...base, pendingRequestId: 'r-1' }), /already being processed/);
  });
});

describe('araç şemaları', () => {
  it('katı şema: her alan zorunlu, fazladan alan yok', () => {
    for (const spec of TOOL_SPECS) {
      assert.equal(spec.parameters.additionalProperties, false, spec.name);
      assert.deepEqual([...spec.parameters.required].sort(), Object.keys(spec.parameters.properties).sort(), spec.name);
    }
  });
});

describe('sabit mesajlar', () => {
  const reservation = {
    confirmationCode: 'DEM4XK7',
    checkIn: '2026-10-15',
    checkOut: '2026-10-18',
    roomTypeName: 'Standart',
    adults: 2,
    children: 1,
    totalPrice: '6000.00',
    currency: 'TRY',
    status: 'CONFIRMED',
  };

  it('onay mesajı kodu, tarihleri ve tutarı şablondan yazar; dil yoksa İngilizce', () => {
    const tr = confirmationMessage(reservation, 'tr');
    assert.match(tr, /Onay kodu: DEM4XK7/);
    assert.match(tr, /15\.10\.2026 – 18\.10\.2026 · Standart · 2 yetişkin, 1 çocuk/);
    assert.match(tr, /Toplam: 6000\.00 TRY/);
    assert.match(confirmationMessage(reservation, 'de'), /Confirmation code: DEM4XK7/);
    assert.match(confirmationMessage({ ...reservation, status: 'PENDING' }, 'tr'), /talebiniz alındı[\s\S]*kesinleştirip/);
  });

  it('ret ve devir mesajları', () => {
    assert.match(rejectionMessage('NO_AVAILABILITY', 'tr'), /yer kalmadı/);
    assert.match(rejectionMessage('VALIDATION', 'en'), /could not create/);
    assert.match(handoffMessage('COMPLAINT', 'tr'), /üzgünüz/i);
    assert.match(handoffMessage('HUMAN', 'ru'), /connecting you/);
  });
});

describe('modelsiz dil tahmini (devir bilgisi)', () => {
  it('Türkçe harf ya da sık kelime varsa "tr"; yoksa bilinmiyor (şablon İngilizce)', () => {
    assert.equal(guessLanguage('Merhaba, oda bakıyorum'), 'tr');
    assert.equal(guessLanguage('fiyat nedir'), 'tr');
    assert.equal(guessLanguage('ODANIZ VAR MI'), 'tr');
    assert.equal(guessLanguage('Do you have a room for two?'), null);
    assert.equal(guessLanguage('Guten Tag, haben Sie ein Zimmer?'), null);
    assert.equal(guessLanguage(null), null);
    assert.match(handoffMessage('UNAVAILABLE', guessLanguage('Kaç para?')), /ekibimize iletildi/);
  });
});
