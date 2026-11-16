import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { guestImportRowSchema, importAmount, importDay, ratePlanImportRowSchema, suggestImportMapping } from './data-import.js';

const fields = (result) => [...new Set(result.error?.issues.map((issue) => issue.path[0]) ?? [])].sort();

describe('Excel içe aktarma', () => {
  test('başlıklardan alan önerisi: ad, eş anlamlı, büyük / küçük harf, yıldız', () => {
    const mapping = suggestImportMapping('GUESTS', ['Adı*', 'SOYAD', 'Cep', 'E-mail', 'Kimlik No', 'Bilinmeyen']);
    assert.equal(mapping.firstName, 0);
    assert.equal(mapping.lastName, 1);
    assert.equal(mapping.phone, 2);
    assert.equal(mapping.email, 3);
    assert.equal(mapping.idNumber, 4);
    assert.equal(mapping.birthDate, null);
    const spelled = suggestImportMapping('GUESTS', ['Ad', 'Soyad', 'Cep Telefonu', 'E-posta Adresi', 'TC Kimlik No']);
    assert.deepEqual([spelled.phone, spelled.email, spelled.idNumber], [2, 3, 4]);
  });

  test('tarih ve tutar biçimleri', () => {
    assert.equal(importDay('5.3.2026'), '2026-03-05');
    assert.equal(importDay('2026-03-05'), '2026-03-05');
    assert.equal(importAmount('2.500,50'), '2500.50');
    assert.equal(importAmount('2500,5'), '2500.5');
    assert.equal(importAmount(' 1250 '), '1250');
  });

  test('misafir satırı: boşlar null; belge türü adla; TC kimlik sağlaması; e-posta', () => {
    const row = guestImportRowSchema.parse({ firstName: 'Ayşe', lastName: 'Kaya', idType: 'TC Kimlik', idNumber: '100 000 001-46', nationality: 'tr', tags: 'VIP, Sadık', birthDate: '01.02.1990' });
    assert.deepEqual([row.idType, row.idNumber, row.nationality, row.tags, row.birthDate, row.phone], ['NATIONAL_ID', '10000000146', 'TR', ['VIP', 'Sadık'], '1990-02-01', null]);
    assert.deepEqual(fields(guestImportRowSchema.safeParse({ firstName: '', lastName: 'X', email: 'yok@', idType: 'Ehliyet' })), ['email', 'firstName', 'idType']);
    assert.deepEqual(fields(guestImportRowSchema.safeParse({ firstName: 'A', lastName: 'B', nationality: 'TR', idType: 'TC kimlik', idNumber: '12345678901' })), ['idNumber']);
    assert.equal(guestImportRowSchema.parse({ firstName: 'A', lastName: 'B', idType: 'national_id', idNumber: 'U1234567' }).idType, 'NATIONAL_ID', 'kodda "I" Türkçe küçük harfe takılmaz');
  });

  test('fiyat satırı: pansiyon adla, tarih sırası, fiyat zorunlu', () => {
    const row = ratePlanImportRowSchema.parse({ roomType: 'STD', name: 'Yaz', boardType: 'bb', startDate: '01.06.2026', endDate: '31.08.2026', price: '3.250,00', baseOccupancy: '' });
    assert.deepEqual([row.boardType, row.startDate, row.price, row.baseOccupancy, row.minStay], ['BB', '2026-06-01', '3250.00', null, null]);
    const board = (boardType) => ratePlanImportRowSchema.parse({ roomType: 'STD', name: 'Yaz', boardType, startDate: '01.06.2026', endDate: '02.06.2026', price: '1' }).boardType;
    assert.deepEqual(['Oda Kahvaltı', 'oda + kahvaltı', 'BB — Oda + kahvaltı', 'Yarım pansiyon', 'her şey dahil', 'UAI', 'ai'].map(board), ['BB', 'BB', 'BB', 'HB', 'AI', 'UAI', 'AI']);
    assert.deepEqual(fields(ratePlanImportRowSchema.safeParse({ roomType: 'STD', name: 'Yaz', boardType: 'XX', startDate: '31.08.2026', endDate: '01.06.2026', price: '' })), ['boardType', 'endDate', 'price']);
  });
});
