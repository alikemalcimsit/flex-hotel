import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headerMatches, parseRoomingRows, ROOMING_LIST_HEADER } from './roomingList.js';

const STD = '11111111-1111-4111-8111-111111111111';
const DLX = '22222222-2222-4222-8222-222222222222';
const roomTypes = [
  { id: STD, code: 'STD' },
  { id: DLX, code: 'DLX' },
];

const header = [...ROOMING_LIST_HEADER];

describe('headerMatches', () => {
  it('büyük/küçük harf duyarsız eşleşir; eksik başlık reddedilir', () => {
    assert.equal(headerMatches(header), true);
    assert.equal(headerMatches(header.map((label) => label.toLocaleUpperCase('tr'))), true);
    assert.equal(headerMatches(['Ad', 'Soyad']), false);
  });
});

describe('parseRoomingRows', () => {
  it('geçerli satırlar oda + misafir satırına çevrilir; boş pansiyon / kişi varsayılan alır', () => {
    const { lines, errors } = parseRoomingRows(
      [header, ['Ayşe', 'Yılmaz', 'STD', 'HB', 3, 1], ['Ali', 'Veli', 'dlx', '', '', '']],
      { roomTypes },
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(lines, [
      { roomTypeId: STD, adults: 3, children: 1, boardType: 'HB', quantity: 1, guest: { firstName: 'Ayşe', lastName: 'Yılmaz' } },
      { roomTypeId: DLX, adults: 2, children: 0, boardType: 'BB', quantity: 1, guest: { firstName: 'Ali', lastName: 'Veli' } },
    ]);
  });

  it('hatalı satırlar satır numarasıyla raporlanır, geçerliler yine döner', () => {
    const { lines, errors } = parseRoomingRows(
      [
        header,
        ['', 'Soyadsız', 'STD', '', '', ''],      // ad yok
        ['Can', 'Demir', 'YOK', '', '', ''],      // bilinmeyen tip
        ['Ece', 'Kaya', 'STD', 'XX', '', ''],     // bilinmeyen pansiyon
        ['Ali', 'Veli', 'STD', '', 'bozuk', ''],  // yetişkin sayı değil
        ['Zeynep', 'Ak', 'STD', 'AI', 2, 1],      // geçerli
      ],
      { roomTypes },
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].guest.firstName, 'Zeynep');
    assert.equal(errors.length, 4);
    assert.match(errors[0], /^2\. satır/);
    assert.match(errors[1], /"YOK" kodlu oda tipi/);
    assert.match(errors[2], /"XX" pansiyonu/);
    assert.match(errors[3], /^5\. satır/);
  });

  it('tamamen boş satır sessizce atlanır; bozuk başlık tek hatayla döner', () => {
    const blank = parseRoomingRows([header, ['', '', '', '', '', ''], ['Ayşe', 'Yılmaz', 'STD', '', '', '']], { roomTypes });
    assert.equal(blank.lines.length, 1);
    assert.deepEqual(blank.errors, []);

    const bad = parseRoomingRows([['Yanlış', 'Başlık'], ['Ayşe', 'Yılmaz', 'STD', '', '', '']], { roomTypes });
    assert.equal(bad.lines.length, 0);
    assert.equal(bad.errors.length, 1);
    assert.match(bad.errors[0], /Başlık satırı tanınmadı/);
  });

  it('misafir satırı olmayan dosya hata döner', () => {
    const { lines, errors } = parseRoomingRows([header], { roomTypes });
    assert.equal(lines.length, 0);
    assert.match(errors[0], /misafir satırı yok/);
  });
});
