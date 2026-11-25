import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mrzCheckDigit, parseMrz } from '@hotelos/hotel-contracts';
import { applyScan, compareScan, isMinor, stillFromDocument } from './idScan.js';

const TODAY = '2026-11-25';
const d = (text) => String(mrzCheckDigit(text));

/** Kurgusal TC kimlik kartı (TD1), sağlamaları hesaplı. */
function card({ name = 'OZTURK<<AHMET<YUSUF', birth = '900115' } = {}) {
  const doc = 'A01B23456';
  const optional1 = '10000000146'.padEnd(15, '<');
  const line1 = `I<TUR${doc}${d(doc)}${optional1}`;
  const optional2 = '<'.repeat(11);
  const expiry = '310101';
  const composite = d(`${line1.slice(5, 30)}${birth}${d(birth)}${expiry}${d(expiry)}${optional2}`);
  const lines = [line1, `${birth}${d(birth)}M${expiry}${d(expiry)}TUR${optional2}${composite}`, name.padEnd(30, '<')];
  return { lines, text: lines.join('\n'), mrz: parseMrz(lines, { today: TODAY }) };
}

describe('kimlik taraması (modül 59)', () => {
  it('Türkçe harf farkındaki ad kayıttaki gibi kalır; boş kimlik okunanla dolar ve okuma gönderilir', () => {
    const { mrz, text } = card();
    const rows = compareScan({ firstName: 'Ahmet Yusuf', lastName: 'Öztürk', idType: '', idNumber: '', nationality: '', birthDate: '' }, mrz);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.lastName.same, true);
    assert.equal(byKey.lastName.choice, 'current');
    assert.equal(byKey.idNumber.choice, 'read');
    const result = applyScan(rows, text, 'STAFF_SCAN');
    assert.equal(result.values.lastName, 'Öztürk', 'Türkçe harf korunur');
    assert.equal(result.values.idNumber, '10000000146');
    assert.equal(result.values.birthDate, '1990-01-15');
    assert.deepEqual(result.documentRead, { mrz: text, via: 'STAFF_SCAN' });
    assert.equal(result.nameChanged, false);
  });

  it('farklı ad: varsayılan kayıttaki (sağlamasız), personel belgedekini seçebilir; yeni kişide belgedeki', () => {
    const { mrz, text } = card({ name: 'KAYA<<MEHMET' });
    const rows = compareScan({ firstName: 'Mehmet Ali', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR', birthDate: '1990-01-15' }, mrz);
    const first = rows.find((row) => row.key === 'firstName');
    assert.equal(first.same, false);
    assert.equal(rows.find((row) => row.key === 'lastName').same, true, 'soyad tek başına aynı');
    // Adın sağlaması yok (OCR bozabilir): kayıttaki varsayılan, fark işaretli.
    assert.equal(first.choice, 'current');
    const kept = applyScan(rows, text, 'STAFF_SCAN');
    assert.equal(kept.values.firstName, 'Mehmet Ali');
    assert.equal(kept.nameChanged, false);
    assert.ok(kept.documentRead, 'ad seçimi okumayı düşürmez');
    first.choice = 'read';
    const renamed = applyScan(rows, text, 'STAFF_SCAN');
    assert.equal(renamed.values.firstName, 'Mehmet');
    assert.equal(renamed.nameChanged, true);
  });

  it('boş kayıtta (yeni refakatçi) ad belgeden', () => {
    const { mrz } = card();
    const rows = compareScan({}, mrz);
    assert.deepEqual(rows.filter((row) => row.key.endsWith('Name')).map((row) => [row.key, row.choice, row.read]), [['lastName', 'read', 'Ozturk'], ['firstName', 'read', 'Ahmet Yusuf']]);
  });

  it('kimlik alanında kayıttakini seçmek okumayı düşürür (elle girilmiş sayılır)', () => {
    const { mrz, text } = card();
    const rows = compareScan({ firstName: 'Ahmet Yusuf', lastName: 'Ozturk', idType: 'NATIONAL_ID', idNumber: '10000000078', nationality: 'TR', birthDate: '1990-01-15' }, mrz);
    const number = rows.find((row) => row.key === 'idNumber');
    assert.equal(number.same, false);
    number.choice = 'current';
    const result = applyScan(rows, text, 'STAFF_SCAN');
    assert.equal(result.values.idNumber, '10000000078');
    assert.equal(result.documentRead, null);
  });

  it('okumadan sonra elle değişen kimlik okumayı düşürür', () => {
    const snapshot = { idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR', birthDate: '1990-01-15' };
    assert.equal(stillFromDocument({ ...snapshot }, snapshot), true);
    assert.equal(stillFromDocument({ ...snapshot, birthDate: '1990-01-16' }, snapshot), false);
    assert.equal(stillFromDocument(snapshot, null), false);
  });

  it('reşit değil önerisi doğum gününe göre', () => {
    assert.equal(isMinor('2008-11-26', TODAY), true);
    assert.equal(isMinor('2008-11-25', TODAY), false);
    assert.equal(isMinor(null, TODAY), false);
  });
});
