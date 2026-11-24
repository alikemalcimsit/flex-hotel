import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetLabelsHtml,
  assetQrUrl,
  excelDay,
  locationOptions,
  locationValue,
  monthlyShare,
  parseAssetImportRows,
  parseLocationValue,
  scanFeedback,
  warrantyTone,
} from './assets.js';

/**
 * Demirbaş ekranlarının saf kuralları (modül 46): etiket belgesi (QR bağlantısı, kaçışlama, A4 başlangıç konumu),
 * Excel okuma (başlık eşleme, tarih ve sayı dönüşümü), konum seçici kodlaması, okutma bandı, garanti rengi, aylık pay.
 */

describe('etiket', () => {
  it('QR bağlantısı uygulamanın adresi + /demirbas/k/<kod>', () => {
    assert.equal(assetQrUrl('https://otel.example/', 'DM-000123'), 'https://otel.example/demirbas/k/DM-000123');
  });

  it('metinler kaçışlanır; her etikette kod ve QR (SVG) var', () => {
    const html = assetLabelsHtml({ items: [{ code: 'DM-000001', name: '<script>alert(1)</script> & koltuk' }], hotelName: 'Otel "Mavi"', format: 'THERMAL_50x30', origin: 'https://otel.example' });
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; koltuk'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('Otel &quot;Mavi&quot;'));
    assert.ok(html.includes('DM-000001'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('size: 50mm 30mm'));
  });

  it('A4 sayfasında başlangıç konumu kadar boş etiket atlanır (1–24 arasına kırpılır)', () => {
    const blanks = (start) => (assetLabelsHtml({ items: [{ code: 'DM-000001', name: 'TV' }], format: 'A4_3x8', start, origin: 'https://x' }).match(/label blank/g) ?? []).length;
    assert.equal(blanks(1), 0);
    assert.equal(blanks(5), 4);
    assert.equal(blanks(99), 23);
    assert.equal(blanks(0), 0);
  });
});

describe('Excel okuma', () => {
  it('Excel tarihi ve GG.AA.YYYY metni günü verir; tanınmayan metin olduğu gibi kalır', () => {
    assert.equal(excelDay(new Date(Date.UTC(2024, 2, 5))), '2024-03-05');
    assert.equal(excelDay('5.3.2024'), '2024-03-05');
    assert.equal(excelDay('15/03/2024'), '2024-03-15');
    assert.equal(excelDay('2024-03-15'), '2024-03-15');
    assert.equal(excelDay('mart 2024'), 'mart 2024');
  });

  it('başlıklar (harf / boşluk duyarsız) eşlenir; sayılar metne, boş hücre "" olur; boş satır atlanır', () => {
    const rows = [
      ['  DEMİRBAŞ ADI ', 'Kategori', 'Konum (oda no ya da alan)', 'Alış tarihi', 'Tutar (KDV hariç)', 'Faydalı ömür (yıl)', 'Zimmet (sicil no)', 'Bilinmeyen sütun'],
      ['Koltuk', 'Mobilya', 'Lobi', new Date(Date.UTC(2024, 0, 10)), 18500.5, 5, null, 'yok sayılır'],
      [null, null, null, null, null, null, null, null],
      ['TV', 'Elektronik', 101, '01.02.2025', 12000, null, 'P-0003', ''],
    ];
    const { rows: parsed, errors } = parseAssetImportRows(rows);
    assert.deepEqual(errors, []);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, 'Koltuk');
    assert.equal(parsed[0].purchaseDate, '2024-01-10');
    assert.equal(parsed[0].cost, '18500.5');
    assert.equal(parsed[0].usefulLifeYears, '5');
    assert.equal(parsed[0].employeeCode, '');
    assert.equal(parsed[0].warrantyUntil, '');
    assert.equal(parsed[1].location, '101');
    assert.equal(parsed[1].purchaseDate, '2025-02-01');
    assert.equal(parsed[1].employeeCode, 'P-0003');
  });

  it('zorunlu sütun eksikse ve dosya boşsa hata', () => {
    assert.match(parseAssetImportRows([['Demirbaş adı', 'Kategori']]).errors[0], /eksik sütun: Konum/);
    assert.deepEqual(parseAssetImportRows([]).errors, ['Dosya boş.']);
    const header = ['Demirbaş adı', 'Kategori', 'Konum (oda no ya da alan)', 'Alış tarihi', 'Tutar (KDV hariç)'];
    assert.deepEqual(parseAssetImportRows([header]).errors, ['Dosyada demirbaş satırı yok.']);
  });
});

describe('konum seçici', () => {
  it('oda / alan değeri gidiş-dönüş', () => {
    assert.equal(locationValue({ roomId: 'r1', areaId: null }), 'room:r1');
    assert.equal(locationValue({ roomId: null, areaId: 'a1' }), 'area:a1');
    assert.equal(locationValue({}), '');
    assert.deepEqual(parseLocationValue('area:a1'), { roomId: null, areaId: 'a1' });
    assert.deepEqual(parseLocationValue('room:r1'), { roomId: 'r1', areaId: null });
    assert.deepEqual(parseLocationValue(''), { roomId: null, areaId: null });
  });

  it('önce alanlar (ada göre), sonra odalar (kat, numara)', () => {
    const options = locationOptions({
      areas: [{ id: 'a2', name: 'Restoran' }, { id: 'a1', name: 'Lobi' }],
      rooms: [{ id: 'r3', number: '201', floor: 2 }, { id: 'r2', number: '110', floor: 1 }, { id: 'r1', number: '102', floor: 1 }],
    });
    assert.deepEqual(options.map((option) => option.label), ['Alan · Lobi', 'Alan · Restoran', 'Oda 102', 'Oda 110', 'Oda 201']);
  });
});

describe('okutma, garanti, aylık pay', () => {
  it('okutma sonucu bandın rengini ve sesin olumlu olup olmadığını belirler', () => {
    assert.deepEqual(scanFeedback({ result: 'FOUND', message: 'Lobi' }), { tone: 'success', title: 'Yerinde', ok: true, message: 'Lobi' });
    assert.equal(scanFeedback({ result: 'MISPLACED' }).tone, 'warning');
    assert.equal(scanFeedback({ result: 'UNKNOWN' }).ok, false);
    assert.equal(scanFeedback({ result: 'DUPLICATE' }).tone, 'info');
    assert.equal(scanFeedback({ result: 'BAŞKA' }).tone, 'danger');
  });

  it('garanti: bitmiş kırmızı, 30 gün içinde turuncu', () => {
    assert.equal(warrantyTone(-1), 'danger');
    assert.equal(warrantyTone(0), 'warning');
    assert.equal(warrantyTone(30), 'warning');
    assert.equal(warrantyTone(31), 'neutral');
  });

  it('aylık pay = yıllık / 12 (kuruş yuvarlanır)', () => {
    assert.equal(monthlyShare('1200.00'), '100.00');
    assert.equal(monthlyShare('1000.00'), '83.33');
    assert.equal(monthlyShare('0.10'), '0.01');
    assert.equal(monthlyShare(''), '0.00');
  });
});
