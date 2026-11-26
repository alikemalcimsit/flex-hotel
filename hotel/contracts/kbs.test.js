import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KBS_RETRY_DELAYS_MS, kbsExtraFields, kbsMissingFields, kbsMissingText, kbsRetryAt, kbsSettingsSchema } from './kbs.js';
import { checkInCompanionSchema } from './front-desk.js';

const SETTINGS = { requireGender: true, requireBirthDate: true, requireParentNames: false, requireBirthPlace: false, citizenIdOnly: true };
const foreigner = { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE' };

describe('KBS zorunlu alanları', () => {
  it('belgenin üç alanı her zaman zorunlu', () => {
    assert.deepEqual(kbsMissingFields({ idType: 'PASSPORT', idNumber: null, nationality: null }, SETTINGS), ['idNumber', 'nationality']);
  });

  it('yabancıdan ayarın istediği ek alanlar istenir', () => {
    assert.deepEqual(kbsMissingFields(foreigner, SETTINGS), ['gender', 'birthDate']);
    assert.deepEqual(kbsMissingFields({ ...foreigner, gender: 'FEMALE', birthDate: new Date('1990-01-01') }, SETTINGS), []);
    assert.deepEqual(kbsMissingFields({ ...foreigner, gender: 'MALE', birthDate: '1990-01-01' }, { ...SETTINGS, requireParentNames: true, requireBirthPlace: true }), ['fatherName', 'motherName', 'birthPlace']);
  });

  it('TC vatandaşı TC kimlikle bildirilirken ek alan istenmez (ayar kapalıysa istenir)', () => {
    const citizen = { idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR' };
    assert.deepEqual(kbsMissingFields(citizen, SETTINGS), []);
    assert.deepEqual(kbsMissingFields(citizen, { ...SETTINGS, citizenIdOnly: false }), ['gender', 'birthDate']);
    assert.deepEqual(kbsMissingFields({ ...citizen, idType: 'PASSPORT', idNumber: 'U12345678' }, SETTINGS), ['gender', 'birthDate'], 'pasaportla gelen TC vatandaşı');
  });

  it('ek alan listesi ve okunur metin', () => {
    assert.deepEqual(kbsExtraFields({ ...SETTINGS, requireGender: false, requireParentNames: true }), ['birthDate', 'fatherName', 'motherName']);
    assert.equal(kbsMissingText(['gender', 'birthDate']), 'Cinsiyet, Doğum tarihi');
  });
});

describe('KBS yeniden deneme', () => {
  it('artan aralıkla, hak bitince null', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    assert.equal(kbsRetryAt(1, now).toISOString(), '2026-11-26T10:01:00.000Z');
    assert.equal(kbsRetryAt(4, now).toISOString(), '2026-11-26T11:00:00.000Z');
    assert.equal(kbsRetryAt(KBS_RETRY_DELAYS_MS.length + 1, now), null);
  });
});

describe('KBS ayar şeması', () => {
  const base = { expectedUpdatedAt: null, isEnabled: true, provider: 'TEST', facilityCode: '06-1234', username: 'otel' };
  it('açık ayarda tesis kodu ve kullanıcı zorunlu', () => {
    const result = kbsSettingsSchema.safeParse({ ...base, facilityCode: ' ', username: '' });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map((issue) => issue.path[0]).sort(), ['facilityCode', 'username']);
  });

  it('hazır olmayan sağlayıcı açık ayarda seçilemez; kapalıyken kaydedilebilir', () => {
    const result = kbsSettingsSchema.safeParse({ ...base, provider: 'EGM' });
    assert.equal(result.success, false);
    assert.match(result.error.issues[0].message, /henüz kurulmadı/);
    assert.equal(kbsSettingsSchema.safeParse({ ...base, provider: 'EGM', isEnabled: false }).success, true);
  });

  it('varsayılanlar', () => {
    const parsed = kbsSettingsSchema.parse(base);
    assert.deepEqual([parsed.sendCheckOut, parsed.requireGender, parsed.requireParentNames, parsed.citizenIdOnly, parsed.testBehavior, parsed.clearPassword], [true, true, false, true, 'ACCEPT', false]);
  });
});

describe('girişte KBS ek alanları', () => {
  it('cinsiyet, doğum yeri, anne / baba adı kabul edilir; boş metin null olur', () => {
    const parsed = checkInCompanionSchema.parse({ firstName: 'Anna', lastName: 'Schmidt', ...foreigner, gender: 'FEMALE', birthPlace: ' Berlin ', fatherName: '', motherName: 'Eva' });
    assert.deepEqual([parsed.gender, parsed.birthPlace, parsed.fatherName, parsed.motherName], ['FEMALE', 'Berlin', null, 'Eva']);
    assert.equal(checkInCompanionSchema.safeParse({ firstName: 'A', lastName: 'B', ...foreigner, gender: 'X' }).success, false);
  });
});
