import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeMinibar, summarizeReceived } from './report.js';
import { chargeItems, chargeTargetError, chargeableStays, laundryTotals, lineTotals, newReference, repriceLines } from './rules.js';

/**
 * Minibar ve çamaşırhanenin kuralları (modül 19): satır ve sipariş tutarları,
 * ekspres farkı yuvarlaması, sayım düzeltmesinde fiyatın korunması, odanın
 * kime yazılabileceği (içerideki / yeni ayrılan / kayıp), rapor özetleri.
 */

describe('tutarlar', () => {
  it('satır = birim × adet; toplam ve parça sayısı', () => {
    const result = lineTotals([
      { unitPrice: '45.50', quantity: 2 },
      { unitPrice: '120', quantity: 1 },
    ]);
    assert.deepEqual(result.lines.map((line) => line.total), ['91.00', '120.00']);
    assert.equal(result.total, '211.00');
    assert.equal(result.itemCount, 3);
  });

  it('ekspres farkı ara toplamın yüzdesi, kuruşa yarım yukarı; ekspres değilse sıfır', () => {
    const lines = [{ unitPrice: '33.33', quantity: 1 }];
    assert.deepEqual(
      (({ subtotal, expressPct, surcharge, total }) => ({ subtotal, expressPct, surcharge, total }))(laundryTotals({ lines, express: true, expressPct: '50' })),
      { subtotal: '33.33', expressPct: '50.00', surcharge: '16.67', total: '50.00' },
    );
    const normal = laundryTotals({ lines, express: false, expressPct: '50' });
    assert.deepEqual([normal.expressPct, normal.surcharge, normal.total], ['0.00', '0.00', '33.33']);
  });

  it('sayım düzeltmesi: siparişteki parça eski fiyatını korur, yeni parça güncel fiyatla', () => {
    const catalog = new Map([
      ['shirt', { name: 'Gömlek', service: 'WASH', price: '150' }],
      ['suit', { name: 'Takım elbise', service: 'DRY_CLEAN', price: '400' }],
    ]);
    const existing = new Map([['shirt', { unitPrice: '120.00' }]]);
    const lines = repriceLines(
      [
        { itemId: 'shirt', quantity: 3 },
        { itemId: 'suit', quantity: 1 },
      ],
      existing,
      catalog,
    );
    assert.deepEqual(lines.map((line) => [line.itemId, line.unitPrice, line.quantity]), [
      ['shirt', '120.00', 3],
      ['suit', '400', 1],
    ]);
  });

  it('folyoya giden satırlar ürün adı, birim fiyat ve adetle', () => {
    assert.deepEqual(chargeItems([{ name: 'Su', unitPrice: '45.00', quantity: 2, total: '90.00' }]), [
      { description: 'Su', unitPrice: '45.00', quantity: 2 },
    ]);
  });

  it('fiş numarası okunur ve karışan karakter içermez', () => {
    for (let index = 0; index < 200; index += 1) {
      assert.match(newReference('MB'), /^MB-[2-9A-HJKMNP-Z]{6}$/);
    }
  });
});

describe('odanın kime yazılabileceği', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  it('içerideki misafir ve son 24 saatte ayrılanlar (çıkış ya da taşınma), en yeni önce, tekrarsız', () => {
    const stays = chargeableStays({
      inHouse: { id: 'in' },
      checkedOut: [
        { id: 'out-1', at: hoursAgo(2) },
        { id: 'out-old', at: hoursAgo(30) },
      ],
      movedOut: [
        { id: 'moved', at: hoursAgo(1) },
        { id: 'in', at: hoursAgo(5) },
      ],
      now,
    });
    assert.deepEqual(stays, { inHouseId: 'in', lateIds: ['moved', 'out-1'] });
  });

  it('seçilen hedef odanın şimdiki durumuyla uyuşmazsa fiş yazılmaz', () => {
    const stays = { inHouseId: 'in', lateIds: ['out-1'] };
    assert.equal(chargeTargetError({ chargeTo: 'IN_HOUSE', reservationId: 'in' }, stays), null);
    assert.match(chargeTargetError({ chargeTo: 'IN_HOUSE', reservationId: 'other' }, stays), /misafir değişmiş/);
    assert.match(chargeTargetError({ chargeTo: 'IN_HOUSE', reservationId: 'in' }, { inHouseId: null, lateIds: [] }), /konaklayan misafir yok/);
    assert.equal(chargeTargetError({ chargeTo: 'LATE', reservationId: 'out-1' }, stays), null);
    assert.match(chargeTargetError({ chargeTo: 'LATE', reservationId: 'in' }, stays), /geç kalem yazılamaz/);
    assert.equal(chargeTargetError({ chargeTo: 'NONE' }, { inHouseId: null, lateIds: [] }), null);
  });
});

describe('rapor özetleri', () => {
  it('minibar: yazılan (içerideki + geç) ve kayıp ayrı; ürün başına iki sütun', () => {
    const summary = summarizeMinibar(
      [
        { target: 'IN_HOUSE', slips: 4, rooms: 4, items: 9, amount: '610.00' },
        { target: 'LATE', slips: 1, rooms: 1, items: 2, amount: '90.00' },
        { target: 'NONE', slips: 1, rooms: 1, items: 1, amount: '45.00' },
      ],
      [
        { itemId: 'water', name: 'Su', loss: false, quantity: 6, amount: '270.00' },
        { itemId: 'water', name: 'Su', loss: true, quantity: 1, amount: '45.00' },
        { itemId: 'beer', name: 'Bira', loss: false, quantity: 2, amount: '430.00' },
      ],
      [{ staff: 'kat@otel.com', slips: 6, rooms: 6, amount: '745.00' }],
    );
    assert.equal(summary.chargedAmount, '700.00');
    assert.equal(summary.lossAmount, '45.00');
    assert.deepEqual(summary.items.map((row) => [row.name, row.quantity, row.charged, row.lossQuantity, row.loss]), [
      ['Bira', 2, '430.00', 0, '0.00'],
      ['Su', 6, '270.00', 1, '45.00'],
    ]);
  });

  it('çamaşır: alınanlar duruma göre; iptal gelir sayılmaz, ekspres ayrıca', () => {
    const received = summarizeReceived([
      { status: 'DELIVERED', express: false, orders: 3, items: 9, amount: '900.00' },
      { status: 'READY', express: true, orders: 1, items: 2, amount: '360.00' },
      { status: 'CANCELLED', express: false, orders: 1, items: 1, amount: '120.00' },
    ]);
    assert.deepEqual(received, {
      orders: 5,
      items: 12,
      express: 1,
      cancelled: 1,
      amount: '1260.00',
      byStatus: { DELIVERED: 3, READY: 1, CANCELLED: 1 },
    });
  });
});
