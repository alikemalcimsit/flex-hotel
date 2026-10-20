import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addToCart, cartCount, cartPayload, cartTotal, cashSuggestions, changeDue, changeQuantity, groupByOrder, selectionTotal, setNote, splitLines } from './posCart.js';

/**
 * POS ekranının saf dönüşümleri: sepet (aynı ürün birleşir, notlu satır ayrı kalır, adet
 * sınırı), tutar kuruşla, para üstü, hızlı nakit, bölme seçimi, turlara ayırma.
 */

const kofte = { id: 'k', name: 'Köfte', price: '450.00' };
const bira = { id: 'b', name: 'Bira', price: '180.10' };

describe('sepet', () => {
  it('aynı ürün notsuz satıra katılır; notlu satır ayrı kalır; sıfıra inen çıkar', () => {
    let cart = addToCart([], kofte);
    cart = addToCart(cart, kofte);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 2);
    cart = setNote(cart, cart[0].key, 'Az pişmiş');
    cart = addToCart(cart, kofte);
    assert.equal(cart.length, 2);
    cart = addToCart(cart, bira);
    assert.equal(cartCount(cart), 4);
    assert.equal(cartTotal(cart), '1530.10');
    cart = changeQuantity(cart, cart[2].key, -1);
    assert.equal(cart.length, 2);
    assert.deepEqual(cartPayload(cart, 'r1'), {
      requestId: 'r1',
      lines: [
        { menuItemId: 'k', quantity: 2, note: 'Az pişmiş' },
        { menuItemId: 'k', quantity: 1, note: null },
      ],
    });
  });

  it('adet 99 ile sınırlı; kuruş toplamı kayan noktaya düşmez', () => {
    let cart = addToCart([], { id: 'x', name: 'Su', price: '0.10' });
    cart = changeQuantity(cart, cart[0].key, 200);
    assert.equal(cart[0].quantity, 99);
    assert.equal(cartTotal(addToCart(addToCart([], { id: 'a', name: 'a', price: '0.1' }), { id: 'b', name: 'b', price: '0.2' })), '0.30');
  });
});

describe('ödeme yardımcıları', () => {
  it('para üstü; yetmeyen nakitte yok; virgül kabul', () => {
    assert.equal(changeDue('500', '432.50'), '67.50');
    assert.equal(changeDue('432,50', '432.50'), '0.00');
    assert.equal(changeDue('400', '432.50'), null);
    assert.equal(changeDue('abc', '1'), null);
  });

  it('hızlı nakit: tam tutar ve yuvarlak banknotlar (en çok 4)', () => {
    assert.deepEqual(cashSuggestions('432.50'), ['432.50', '440.00', '450.00', '500.00']);
    assert.deepEqual(cashSuggestions('100.00'), ['100.00', '200.00', '500.00']);
    assert.deepEqual(cashSuggestions('0'), []);
  });
});

describe('bölme ve turlar', () => {
  it('bölme gövdesi sıfır adetleri atar; taşınan tutar önizlemesi', () => {
    assert.deepEqual(splitLines({ a: 2, b: 0, c: 1 }), [
      { lineId: 'a', quantity: 2 },
      { lineId: 'c', quantity: 1 },
    ]);
    assert.equal(selectionTotal([{ id: 'a', unitPrice: '450.00' }, { id: 'c', unitPrice: '180.10' }], { a: 2, c: 1 }), '1080.10');
  });

  it('kalemler tur kimliğiyle, gönderiliş sırasıyla gruplanır; aynı numaralı iki tur ayrı kalır', () => {
    const orders = [
      { id: 'o1', seq: 1, sentAt: '2026-10-17T19:00:00Z' },
      { id: 'x1', seq: 1, sentAt: '2026-10-17T19:30:00Z' },
      { id: 'o2', seq: 2, sentAt: '2026-10-17T20:00:00Z' },
    ];
    const lines = [
      { id: 1, orderId: 'o2', orderSeq: 2 },
      { id: 2, orderId: 'o1', orderSeq: 1 },
      { id: 3, orderId: 'x1', orderSeq: 1 },
      { id: 4, orderId: 'o2', orderSeq: 2 },
    ];
    assert.deepEqual(groupByOrder(lines, orders).map((group) => [group.orderId, group.seq, group.lines.map((line) => line.id)]), [
      ['o1', 1, [2]],
      ['x1', 1, [3]],
      ['o2', 2, [1, 4]],
    ]);
  });
});
