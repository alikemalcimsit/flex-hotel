import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boardSummary, cardTone, kdsActions, waitedMinutes } from './kds.js';

/**
 * Mutfak ekranının saf kuralları: geçen süre, kart rengi (yeni / hazırlanıyor /
 * uyarı / gecikti / hazır), kart düğmeleri (oda servisinde "servis edildi" yok)
 * ve üst sayaçlar.
 */

const SENT = '2026-11-16T12:00:00.000Z';
const at = (minutes) => Date.parse(SENT) + minutes * 60_000;
const card = (overrides = {}) => ({ status: 'NEW', sentAt: SENT, roomService: null, ...overrides });

describe('geçen süre', () => {
  it('tam dakika sayar; saat kayması eksiye düşürmez', () => {
    assert.equal(waitedMinutes(SENT, at(9.9)), 9);
    assert.equal(waitedMinutes(SENT, at(-2)), 0);
  });
});

describe('kart rengi', () => {
  it('eşik altında duruma göre: yeni / hazırlanıyor', () => {
    assert.equal(cardTone(card(), at(3)), 'new');
    assert.equal(cardTone(card({ status: 'PREPARING' }), at(3)), 'preparing');
  });

  it('10. dakikada uyarı, 20. dakikada gecikti', () => {
    assert.equal(cardTone(card(), at(9)), 'new');
    assert.equal(cardTone(card({ status: 'PREPARING' }), at(10)), 'warn');
    assert.equal(cardTone(card(), at(20)), 'late');
  });

  it('hazır tur süreden bağımsız yeşil kalır', () => {
    assert.equal(cardTone(card({ status: 'READY' }), at(45)), 'ready');
  });
});

describe('kart düğmeleri', () => {
  it('yeni: başla + hazır; hazırlanıyor: hazır; hazır: servis edildi', () => {
    assert.deepEqual(kdsActions(card()).map((action) => action.status), ['PREPARING', 'READY']);
    assert.deepEqual(kdsActions(card({ status: 'PREPARING' })).map((action) => action.status), ['READY']);
    assert.deepEqual(kdsActions(card({ status: 'READY' })).map((action) => action.status), ['SERVED']);
  });

  it('oda servisi turu hazırda biter (teslim oda servisi panosunda)', () => {
    assert.deepEqual(kdsActions(card({ status: 'READY', roomService: { roomNumber: '412', deliverAt: null } })), []);
  });

  it('paket turu da hazırda biter (teslim paket panosunda); öncesinde düğmeler aynı', () => {
    const delivery = { id: 'd1', number: 'PS-2026-000001', customerName: 'Ayşe Yılmaz' };
    assert.deepEqual(kdsActions(card({ status: 'READY', delivery })), []);
    assert.deepEqual(kdsActions(card({ status: 'NEW', delivery })).map((action) => action.status), ['PREPARING', 'READY']);
  });
});

describe('üst sayaçlar', () => {
  it('durum başına sayar; gecikmeyi hazır olmayanlardan sayar', () => {
    const cards = [card(), card({ status: 'PREPARING', sentAt: '2026-11-16T11:30:00.000Z' }), card({ status: 'READY', sentAt: '2026-11-16T11:00:00.000Z' })];
    assert.deepEqual(boardSummary(cards, at(5)), { NEW: 1, PREPARING: 1, READY: 1, late: 1 });
  });
});
