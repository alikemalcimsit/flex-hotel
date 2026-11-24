import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { filterImportRows, importCellText, importKindsFor, mapImportRows, missingRequired, rowErrorText, sampleValues, splitSheet, templateRows } from './dataImport.js';

describe('Excel yükleme sihirbazı (modül 26)', () => {
  it('hücre metni: Excel tarihi gün, tam sayı olduğu gibi, ondalık iki basamak, boş ""', () => {
    assert.equal(importCellText(new Date(Date.UTC(2026, 10, 16))), '2026-11-16');
    assert.equal(importCellText(10000000146), '10000000146');
    assert.equal(importCellText(3250.456), '3250.46');
    assert.equal(importCellText(null), '');
    assert.equal(importCellText('  Ayşe '), 'Ayşe');
  });

  it('sayfa: başlık ayrılır, boş satır atlanır, boş başlık adlandırılır', () => {
    const sheet = splitSheet([['Ad', null, 'Soyad'], ['Ayşe', null, 'Kaya'], [null, '', null], ['Ali', 'x', 'Can']]);
    assert.deepEqual(sheet.headers, ['Ad', 'Sütun 2', 'Soyad']);
    assert.equal(sheet.rows.length, 2);
    assert.deepEqual(splitSheet([['Ad']]).errors, ['Dosyada başlıktan sonra satır yok.']);
  });

  it('eşleştirme: yalnız eşlenen alanlar gider; eksik zorunlu alan; örnek değerler', () => {
    const rows = [['Ayşe', 'Kaya', 5321112233], ['Ali', '', null]];
    const mapping = { firstName: 0, lastName: 1, phone: 2, email: null };
    assert.deepEqual(mapImportRows(rows, mapping), [
      { firstName: 'Ayşe', lastName: 'Kaya', phone: '5321112233' },
      { firstName: 'Ali', lastName: '', phone: '' },
    ]);
    assert.deepEqual(missingRequired('GUESTS', { firstName: 0, lastName: null }), ['Soyad']);
    assert.deepEqual(sampleValues(rows, 1), ['Kaya']);
    assert.deepEqual(sampleValues(rows, null), []);
  });

  it('şablon, yetki, süzgeç ve hata metni', () => {
    const [header, example] = templateRows('RATE_PLANS');
    assert.equal(header[0], 'Oda tipi*');
    assert.equal(example[2], 'BB');
    assert.deepEqual(importKindsFor((permission) => permission === PERMISSIONS.SETTINGS_MANAGE), ['RATE_PLANS']);
    const rows = [{ status: 'OK' }, { status: 'ERROR' }, { status: 'SKIP' }];
    assert.equal(filterImportRows(rows, 'ALL').length, 3);
    assert.deepEqual(filterImportRows(rows, 'SKIP'), [{ status: 'SKIP' }]);
    assert.equal(rowErrorText('GUESTS', { errors: [{ field: 'email', message: 'E-posta geçersiz' }, { field: '', message: 'Genel' }] }), 'E-posta: E-posta geçersiz · Genel');
  });
});
