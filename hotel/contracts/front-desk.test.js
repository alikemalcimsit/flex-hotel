import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkInSchema,
  checkOutSchema,
  identityNumberError,
  isValidTurkishIdNumber,
  looksLikeCardNumber,
  maskIdNumber,
  normalizeIdNumber,
  normalizePlate,
  revertStaySchema,
  stayFeePolicyError,
} from './front-desk.js';
import { updateGeneralSettingsSchema } from './settings.js';

/**
 * Ön büro sözleşmeleri (modül 6). Kimlik numarası emniyete (KBS) gider:
 * yanlışı girişte yakalanmalı. Kart numarası hiçbir alana yazılamamalı.
 */

const VERSION = '2026-10-10T10:00:00.000Z';
const identity = (overrides = {}) => ({ idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR', ...overrides });
const issuesOf = (result) => result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];

describe('TC kimlik numarası', () => {
  it('sağlaması tutan numarayı kabul eder', () => {
    assert.equal(isValidTurkishIdNumber('10000000146'), true);
  });

  it('son hane, onuncu hane, uzunluk ya da baştaki sıfır bozuksa reddeder', () => {
    assert.equal(isValidTurkishIdNumber('10000000147'), false);
    assert.equal(isValidTurkishIdNumber('10000000156'), false);
    assert.equal(isValidTurkishIdNumber('1000000014'), false);
    assert.equal(isValidTurkishIdNumber('01000000146'), false);
    assert.equal(isValidTurkishIdNumber('1000000014A'), false);
  });
});

describe('belge numarası kuralı', () => {
  it('Türk vatandaşının kimlik kartı sağlamayla; yabancının belgesi biçimle denetlenir', () => {
    assert.equal(identityNumberError(identity()), null);
    assert.match(identityNumberError(identity({ idNumber: '12345678901' })), /TC kimlik numarası geçersiz/);
    // Yabancı uyruklunun kimlik kartı TC sağlamasına tabi değil.
    assert.equal(identityNumberError(identity({ nationality: 'DE', idNumber: 'L01X00T47' })), null);
    assert.equal(identityNumberError(identity({ idType: 'PASSPORT', nationality: 'GB', idNumber: 'u12 345-678' })), null);
    assert.match(identityNumberError(identity({ idType: 'PASSPORT', nationality: 'GB', idNumber: 'AB1' })), /5–20/);
    assert.match(identityNumberError(identity({ idNumber: '  ' })), /zorunlu/);
  });

  it('numara saklanmadan önce büyük harfe çevrilir, boşluk ve tire atılır (Türkçe i dahil)', () => {
    assert.equal(normalizeIdNumber(' u12 345-678 '), 'U12345678');
    assert.equal(normalizeIdNumber('abi123'), 'ABI123');
  });

  it('maskeleme ilk üç ve son iki karakteri bırakır', () => {
    assert.equal(maskIdNumber('10000000146'), '100••••••46');
    assert.equal(maskIdNumber('AB123'), 'A••••');
    assert.equal(maskIdNumber(null), null);
  });
});

describe('kart numarası koruması', () => {
  it('boşluklu ya da tireli yazılmış geçerli kart numarasını yakalar', () => {
    assert.equal(looksLikeCardNumber('4111 1111 1111 1111'), true);
    assert.equal(looksLikeCardNumber('kart: 5500-0000-0000-0004 provizyon'), true);
  });

  it('Luhn tutmayan, kısa ya da provizyon numarası gibi dizileri serbest bırakır', () => {
    assert.equal(looksLikeCardNumber('4111 1111 1111 1112'), false);
    assert.equal(looksLikeCardNumber('PROV-834221'), false);
    assert.equal(looksLikeCardNumber('TC 10000000146, oda 1203'), false);
    assert.equal(looksLikeCardNumber(null), false);
  });
});

describe('checkInSchema', () => {
  const base = (overrides = {}) => ({ expectedUpdatedAt: VERSION, guest: identity(), ...overrides });

  it('asgari girişi kabul eder; varsayılanlar dolar', () => {
    const result = checkInSchema.safeParse(base());
    assert.equal(result.success, true, issuesOf(result).join('; '));
    assert.deepEqual(result.data.companions, []);
    assert.equal(result.data.deposit.method, 'NONE');
    assert.equal(result.data.waiveEarlyFee, false);
    assert.equal(result.data.acceptRoomNotReady, false);
  });

  it('rezervasyon sahibinin kimliği eksikse alan alan söyler', () => {
    const result = checkInSchema.safeParse(base({ guest: { idType: null, idNumber: '', nationality: null } }));
    const issues = issuesOf(result);
    assert.ok(issues.some((issue) => issue.startsWith('guest.idType')));
    assert.ok(issues.some((issue) => issue.startsWith('guest.nationality')));
    assert.ok(issues.some((issue) => issue.startsWith('guest.idNumber')));
  });

  it('uyruk listede olmalı; küçük harf kabul edilir', () => {
    assert.equal(checkInSchema.safeParse(base({ guest: identity({ idType: 'PASSPORT', nationality: 'de', idNumber: 'C01X00T47' }) })).success, true);
    assert.match(issuesOf(checkInSchema.safeParse(base({ guest: identity({ nationality: 'XX' }) }))).join(), /listeden/);
  });

  it('yetişkin refakatçinin belgesi zorunlu, çocuğunki değil', () => {
    const adult = { firstName: 'Ali', lastName: 'Yılmaz' };
    const child = { firstName: 'Ece', lastName: 'Yılmaz', isChild: true };
    const missing = checkInSchema.safeParse(base({ companions: [adult, child] }));
    assert.ok(issuesOf(missing).some((issue) => issue.startsWith('companions.0.idNumber')));
    assert.ok(!issuesOf(missing).some((issue) => issue.startsWith('companions.1')));
    const complete = checkInSchema.safeParse(base({ companions: [{ ...adult, ...identity({ idNumber: '10000000146' }) }, child] }));
    assert.equal(complete.success, true, issuesOf(complete).join('; '));
  });

  it('çocuğun belgesi yarım girilirse tamamlanması istenir', () => {
    const result = checkInSchema.safeParse(base({ companions: [{ firstName: 'Ece', lastName: 'Y', isChild: true, idNumber: '123' }] }));
    assert.ok(issuesOf(result).some((issue) => issue.startsWith('companions.0.idType')));
  });

  it('teminat: yöntem seçildiyse tutar zorunlu; referansa kart numarası yazılamaz', () => {
    assert.match(issuesOf(checkInSchema.safeParse(base({ deposit: { method: 'CASH' } }))).join(), /Teminat tutarını/);
    assert.match(
      issuesOf(checkInSchema.safeParse(base({ deposit: { method: 'CARD_PREAUTH', amount: '500', reference: '4111111111111111' } }))).join(),
      /Kart numarası yazılamaz/,
    );
    const ok = checkInSchema.safeParse(base({ deposit: { method: 'CARD_PREAUTH', amount: '500,50', reference: 'PRV-99812' } }));
    assert.equal(ok.success, true);
    assert.equal(ok.data.deposit.amount, '500.5');
  });

  it('plaka büyük harfe ve tek boşluğa çevrilir; yabancı karakter reddedilir', () => {
    assert.equal(checkInSchema.parse(base({ vehiclePlate: ' 34  abc 123 ' })).vehiclePlate, '34 ABC 123');
    assert.equal(normalizePlate('06 çkr 12'), '06 ÇKR 12');
    assert.equal(checkInSchema.safeParse(base({ vehiclePlate: '06 ÇKR 12' })).success, false);
    assert.equal(checkInSchema.parse(base({ vehiclePlate: '' })).vehiclePlate, null);
  });
});

describe('checkOutSchema / revertStaySchema', () => {
  it('bakiyeyle çıkış gerekçe ister', () => {
    assert.match(issuesOf(checkOutSchema.safeParse({ expectedUpdatedAt: VERSION, allowOpenBalance: true })).join(), /gerekçesini/);
    assert.equal(checkOutSchema.safeParse({ expectedUpdatedAt: VERSION, allowOpenBalance: true, openBalanceReason: 'Şirket ödeyecek' }).success, true);
  });

  it('görülen ücret tutar olarak doğrulanır', () => {
    assert.equal(checkOutSchema.parse({ expectedUpdatedAt: VERSION, expectedLateFee: '250,5' }).expectedLateFee, '250.5');
    assert.equal(checkOutSchema.safeParse({ expectedUpdatedAt: VERSION, expectedLateFee: '1.250' }).success, false);
  });

  it('geri alma sebepsiz olmaz', () => {
    assert.equal(revertStaySchema.safeParse({ expectedUpdatedAt: VERSION, reason: '  ' }).success, false);
    assert.equal(revertStaySchema.safeParse({ expectedUpdatedAt: VERSION, reason: 'Yanlış odaya giriş yapıldı' }).success, true);
  });
});

describe('ücret politikası', () => {
  it('ücret yoksa değer önemsiz; varsa pozitif, yüzde 100\'ü geçmez', () => {
    assert.equal(stayFeePolicyError({ mode: 'NONE', value: '0' }), null);
    assert.match(stayFeePolicyError({ mode: 'FIXED', value: '0' }), /tutarını/);
    assert.match(stayFeePolicyError({ mode: 'PERCENT_OF_NIGHT', value: '150' }), /100/);
    assert.equal(stayFeePolicyError({ mode: 'PERCENT_OF_NIGHT', value: '50' }), null);
  });

  it('genel parametreler ekranı aynı kuralı uygular', () => {
    const base = { expectedUpdatedAt: VERSION, defaultBoardType: 'BB', cancellationPolicyDays: 0, cancellationPolicyPenaltyPct: '0' };
    const bad = updateGeneralSettingsSchema.safeParse({ ...base, lateCheckOutFeeMode: 'PERCENT_OF_NIGHT', lateCheckOutFeeValue: '150' });
    assert.ok(issuesOf(bad).some((issue) => issue.startsWith('lateCheckOutFeeValue')));
    const good = updateGeneralSettingsSchema.safeParse({
      ...base,
      earlyCheckInFeeMode: 'FIXED',
      earlyCheckInFeeValue: '300',
      checkInIdentityPolicy: 'ALL_ADULTS',
    });
    assert.equal(good.success, true, issuesOf(good).join('; '));
  });
});
