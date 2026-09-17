import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toFieldErrors, listQuerySchema } from './fields.js';
import {
  generalSettingsSchema,
  hotelInfoSchema,
  roomTypeInputSchema,
  seasonInputSchema,
  taxInputSchema,
  updateGeneralSettingsSchema,
  updateHotelSchema,
  updateSeasonSchema,
} from './settings.js';

/**
 * Bu şemalar hem sunucunun hem tarayıcının tek doğrulama kaynağı. Bozulurlarsa
 * ya geçersiz veri veritabanına girer ya da kullanıcı formu kaydedemez —
 * ikisi de sessizce olur.
 */

const validHotel = {
  name: 'Demo Otel',
  currency: 'try',
  timezone: 'Europe/Istanbul',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  expectedUpdatedAt: '2026-09-09T10:00:00.000Z',
};

describe('roomTypeInputSchema', () => {
  it('kodu büyük harfe çevirir, boşlukları kırpar', () => {
    const result = roomTypeInputSchema.parse({
      code: ' std ',
      name: ' Standart ',
      capacityAdults: '2',
      capacityChildren: 0,
      basePrice: '2500.00',
    });
    assert.equal(result.code, 'STD');
    assert.equal(result.name, 'Standart');
  });

  it('fiyatı normalize edilmiş string olarak tutar', () => {
    const result = roomTypeInputSchema.parse({
      code: 'STD',
      name: 'X',
      capacityAdults: 1,
      capacityChildren: 0,
      basePrice: 3500,
    });
    assert.equal(result.basePrice, '3500');
    assert.equal(typeof result.basePrice, 'string');
  });

  it('2 basamaktan fazla kuruş kabul etmez', () => {
    const result = roomTypeInputSchema.safeParse({
      code: 'STD',
      name: 'X',
      capacityAdults: 1,
      capacityChildren: 0,
      basePrice: '12.345',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).basePrice, /ondalık/);
  });

  it('boşluklu/işaretli kodu reddeder', () => {
    const result = roomTypeInputSchema.safeParse({
      code: 'ST D!',
      name: 'X',
      capacityAdults: 1,
      capacityChildren: 0,
      basePrice: '1',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).code, /yalnızca harf/);
  });

  it('sıfır yetişkin kapasitesini reddeder', () => {
    const result = roomTypeInputSchema.safeParse({
      code: 'STD',
      name: 'X',
      capacityAdults: 0,
      capacityChildren: 0,
      basePrice: '1',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).capacityAdults, /En az 1/);
  });

  it('eksik alanlar için Türkçe mesaj verir', () => {
    // Alan hiç gönderilmediğinde Zod'un *tip* hatası devreye girer; global
    // Türkçe yerel ayarı olmasa buradan İngilizce mesaj sızardı.
    const result = roomTypeInputSchema.safeParse({});
    assert.equal(result.success, false);
    const fields = toFieldErrors(result.error);
    assert.ok(Object.keys(fields).length > 0);
    for (const message of Object.values(fields)) {
      assert.doesNotMatch(message, /Invalid input|expected \w+, received|Required/, `İngilizce mesaj sızdı: ${message}`);
    }
  });
});

describe('taxInputSchema', () => {
  it('geçerli vergiyi kabul eder', () => {
    const result = taxInputSchema.parse({ name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] });
    assert.equal(result.rate, '10');
  });

  it('aynı kalem tipini iki kez kabul etmez', () => {
    const result = taxInputSchema.safeParse({
      name: 'KDV',
      rate: '10',
      isIncluded: true,
      appliesTo: ['ROOM', 'ROOM'],
    });
    assert.equal(result.success, false);
  });

  it('bilinmeyen kalem tipini reddeder', () => {
    const result = taxInputSchema.safeParse({ name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['UZAY'] });
    assert.equal(result.success, false);
  });

  it('"false" metnini fiyata dahil değil olarak okur', () => {
    const result = taxInputSchema.parse({ name: 'KDV', rate: '10', isIncluded: 'false', appliesTo: ['ROOM'] });
    assert.equal(result.isIncluded, false);
  });

  it('%100 üstü oranı reddeder', () => {
    const result = taxInputSchema.safeParse({ name: 'KDV', rate: '120', isIncluded: true, appliesTo: ['ROOM'] });
    assert.equal(result.success, false);
  });
});

describe('seasonInputSchema', () => {
  it('geçerli sezonu kabul eder', () => {
    const result = seasonInputSchema.parse({
      name: 'Yaz',
      startDate: '2026-06-01',
      endDate: '2026-09-15',
      multiplier: '1.3',
    });
    assert.equal(result.multiplier, '1.3');
    assert.equal(result.startDate.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('bitiş başlangıçtan önceyse reddeder', () => {
    const result = seasonInputSchema.safeParse({
      name: 'Yaz',
      startDate: '2026-09-15',
      endDate: '2026-06-01',
      multiplier: '1.3',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).endDate, /önce olamaz/);
  });

  it('sıfır çarpanı reddeder', () => {
    const result = seasonInputSchema.safeParse({
      name: 'Yaz',
      startDate: '2026-06-01',
      endDate: '2026-09-15',
      multiplier: '0',
    });
    assert.equal(result.success, false);
  });

  it('güncelleme şeması da tarih sırasını denetler', () => {
    const result = updateSeasonSchema.safeParse({
      name: 'Yaz',
      startDate: '2026-09-15',
      endDate: '2026-06-01',
      multiplier: '1.3',
      expectedUpdatedAt: '2026-09-09T10:00:00.000Z',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).endDate, /önce olamaz/);
  });

  it('güncelleme şeması sürüm damgası ister', () => {
    const result = updateSeasonSchema.safeParse({
      name: 'Yaz',
      startDate: '2026-06-01',
      endDate: '2026-09-15',
      multiplier: '1.3',
    });
    assert.equal(result.success, false);
  });
});

describe('updateHotelSchema', () => {
  it('para birimini büyük harfe çevirir', () => {
    assert.equal(updateHotelSchema.parse(validHotel).currency, 'TRY');
  });

  it('bozuk e-postayı reddeder', () => {
    const result = updateHotelSchema.safeParse({ ...validHotel, email: 'bozuk' });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).email, /e-posta/);
  });

  it('boş e-postaya izin verir (alan isteğe bağlı)', () => {
    assert.equal(updateHotelSchema.safeParse({ ...validHotel, email: '' }).success, true);
  });

  it('tek haneli saati reddeder', () => {
    const result = updateHotelSchema.safeParse({ ...validHotel, checkInTime: '9:00' });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).checkInTime, /SS:DD/);
  });

  it('çıkış saati girişten sonra olamaz (aynı gün oda devri bozulur)', () => {
    const result = updateHotelSchema.safeParse({ ...validHotel, checkInTime: '14:00', checkOutTime: '15:00' });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).checkOutTime, /giriş saatinden önce/);
  });

  it('çıkış ve giriş aynı saatte olamaz', () => {
    assert.equal(updateHotelSchema.safeParse({ ...validHotel, checkInTime: '12:00', checkOutTime: '12:00' }).success, false);
  });

  it('form şeması da aynı kuralı uygular', () => {
    const { expectedUpdatedAt, ...form } = validHotel;
    assert.equal(hotelInfoSchema.safeParse({ ...form, checkOutTime: '16:00' }).success, false);
  });

  it('logo adresi yalnızca http(s) olabilir', () => {
    assert.equal(updateHotelSchema.safeParse({ ...validHotel, logoUrl: 'javascript:alert(1)' }).success, false);
    assert.equal(updateHotelSchema.safeParse({ ...validHotel, logoUrl: 'https://cdn.otel.com/logo.png' }).success, true);
    assert.equal(updateHotelSchema.safeParse({ ...validHotel, logoUrl: '' }).success, true);
  });
});

describe('generalSettingsSchema — iptal politikası tutarlılığı', () => {
  it('gün girilip ceza girilmezse reddeder', () => {
    const result = generalSettingsSchema.safeParse({
      defaultBoardType: 'BB',
      cancellationPolicyDays: 3,
      cancellationPolicyPenaltyPct: '0',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).cancellationPolicyPenaltyPct, /ceza oranı/i);
  });

  it('ceza girilip gün girilmezse reddeder', () => {
    const result = generalSettingsSchema.safeParse({
      defaultBoardType: 'BB',
      cancellationPolicyDays: 0,
      cancellationPolicyPenaltyPct: '50',
    });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).cancellationPolicyDays, /kaç gün/i);
  });

  it('ikisi de doluysa kabul eder', () => {
    assert.equal(
      generalSettingsSchema.safeParse({
        defaultBoardType: 'BB',
        cancellationPolicyDays: 3,
        cancellationPolicyPenaltyPct: '50',
      }).success,
      true,
    );
  });

  it('politika tamamen kapalıysa kabul eder', () => {
    assert.equal(
      generalSettingsSchema.safeParse({
        defaultBoardType: 'BB',
        cancellationPolicyDays: 0,
        cancellationPolicyPenaltyPct: '0',
      }).success,
      true,
    );
  });

  it('güncelleme şeması aynı tutarlılık kuralını uygular', () => {
    const result = updateGeneralSettingsSchema.safeParse({
      defaultBoardType: 'BB',
      cancellationPolicyDays: 3,
      cancellationPolicyPenaltyPct: '0',
      expectedUpdatedAt: '2026-09-09T10:00:00.000Z',
    });
    assert.equal(result.success, false);
  });

  it('bilinmeyen pansiyon tipini reddeder', () => {
    const result = generalSettingsSchema.safeParse({
      defaultBoardType: 'XX',
      cancellationPolicyDays: 0,
      cancellationPolicyPenaltyPct: '0',
    });
    assert.equal(result.success, false);
  });
});

describe('listQuerySchema', () => {
  it('varsayılan sayfa ve boyut verir', () => {
    assert.deepEqual(listQuerySchema.parse({}), { page: 1, pageSize: 25 });
  });

  it('üst sınırı aşan sayfa boyutunu reddeder', () => {
    const result = listQuerySchema.safeParse({ pageSize: 999 });
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).pageSize, /en fazla 200/);
  });

  it('metin sayıları çevirir (query string her zaman metindir)', () => {
    assert.deepEqual(listQuerySchema.parse({ page: '3', pageSize: '50' }), { page: 3, pageSize: 50 });
  });
});

describe('generalSettingsSchema — telefon ülke kodu', () => {
  const base = { defaultBoardType: 'BB', cancellationPolicyDays: 0, cancellationPolicyPenaltyPct: '0' };

  it('başındaki + atılır', () => {
    assert.equal(generalSettingsSchema.parse({ ...base, phoneCountryCode: ' +90 ' }).phoneCountryCode, '90');
  });

  it('0 ile başlayan, harfli ya da uzun kod reddedilir', () => {
    for (const phoneCountryCode of ['090', 'TR', '1234', '']) {
      assert.equal(generalSettingsSchema.safeParse({ ...base, phoneCountryCode }).success, false, phoneCountryCode);
    }
  });

  it('gönderilmezse değişmez (alan isteğe bağlı)', () => {
    assert.equal(generalSettingsSchema.parse(base).phoneCountryCode, undefined);
  });
});
