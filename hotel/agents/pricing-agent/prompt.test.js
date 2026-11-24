import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAgentSuggestions } from './prompt.js';

/**
 * Fiyat ajanının çıktı doğrulaması — LLM hatasının onay kuyruğuna taşmaması
 * gereken yer: bozuk JSON, bilinmeyen tip, pencere dışı tarih, emniyet dışı
 * yüzde, bekleyen dönemle çakışma.
 */

const STD = '11111111-1111-4111-8111-111111111111';
const INPUTS = {
  roomTypes: [{ id: STD }],
  today: '2027-07-01',
  horizonDays: 30,
  pendingPeriods: [{ roomTypeId: STD, startDate: '2027-07-20', endDate: '2027-07-22' }],
};

const row = (overrides = {}) => ({
  roomTypeId: STD,
  startDate: '2027-07-05',
  endDate: '2027-07-07',
  adjustmentPct: 10,
  reason: 'Doluluk %85, geçen yıl %60 — talep belirgin yüksek.',
  ...overrides,
});

const wrap = (rows) => JSON.stringify({ suggestions: rows });

describe('parseAgentSuggestions', () => {
  it('geçerli öneriyi çarpana çevirir; metin içindeki JSON bloğunu bulur', () => {
    const { accepted, dropped } = parseAgentSuggestions(`İşte önerilerim:\n${wrap([row()])}`, INPUTS);
    assert.equal(dropped, 0);
    assert.deepEqual(accepted, [
      {
        roomTypeId: STD,
        startDate: '2027-07-05',
        endDate: '2027-07-07',
        multiplier: '1.100',
        reason: 'Doluluk %85, geçen yıl %60 — talep belirgin yüksek.',
      },
    ]);
  });

  it('indirim negatif yüzdeyle: −15 → 0.850', () => {
    const { accepted } = parseAgentSuggestions(wrap([row({ adjustmentPct: -15 })]), INPUTS);
    assert.equal(accepted[0].multiplier, '0.850');
  });

  it('bozuk satırlar tek tek elenir, geçerli kalır', () => {
    const { accepted, dropped } = parseAgentSuggestions(
      wrap([
        row(),
        row({ roomTypeId: 'bilinmeyen' }), // tip listede yok
        row({ startDate: '2027-08-15', endDate: '2027-08-16' }), // pencere dışı (30 gün)
        row({ adjustmentPct: 400 }), // emniyet dışı
        row({ adjustmentPct: 0 }), // sıfır değişiklik anlamsız
        row({ startDate: '2027-07-21', endDate: '2027-07-21' }), // bekleyenle çakışıyor
        row({ reason: 'kısa' }), // gerekçesiz
      ]),
      INPUTS,
    );
    assert.equal(accepted.length, 1);
    assert.equal(dropped, 6);
  });

  it('beşten fazlası kırpılır; bozuk JSON ve boş metin boş döner', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      row({ startDate: `2027-07-0${index + 2}`, endDate: `2027-07-0${index + 2}` }),
    );
    const { accepted, dropped } = parseAgentSuggestions(wrap(many), INPUTS);
    assert.equal(accepted.length, 5);
    assert.equal(dropped, 3);
    assert.deepEqual(parseAgentSuggestions('model saçmaladı {bozuk', INPUTS), { accepted: [], dropped: 0 });
    assert.deepEqual(parseAgentSuggestions(null, INPUTS), { accepted: [], dropped: 0 });
  });
});
