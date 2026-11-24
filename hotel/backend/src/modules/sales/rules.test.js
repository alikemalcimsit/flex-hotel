import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { assertLeadTransition, assertQuoteTransition, generateQuoteCode, splitLeadName } from './rules.js';

/**
 * Satış CRM kuralları (modül 36): pano geçişleri (sonuçlar elle oynanamaz),
 * teklif yaşam döngüsü, kod üretimi ve ad bölme.
 */

describe('assertLeadTransition — pano geçişleri', () => {
  it('açık durumlar arası geçiş serbest; aynı durum sessiz geçer', () => {
    assert.doesNotThrow(() => assertLeadTransition('NEW', 'QUOTED'));
    assert.doesNotThrow(() => assertLeadTransition('QUOTED', 'WAITING'));
    assert.doesNotThrow(() => assertLeadTransition('WAITING', 'QUOTED'));
    assert.doesNotThrow(() => assertLeadTransition('NEW', 'NEW'));
  });

  it('WON elle verilemez (yalnız teklif kabulü)', () => {
    assert.throws(() => assertLeadTransition('QUOTED', 'WON'), /teklifi kabul/i);
  });

  it('kapanmış fırsat taşınamaz', () => {
    assert.throws(() => assertLeadTransition('WON', 'WAITING'), /geçilemez/);
    assert.throws(() => assertLeadTransition('LOST', 'NEW'), /geçilemez/);
  });
});

describe('assertQuoteTransition — teklif yaşam döngüsü', () => {
  it('taslak gönderilir; gönderilen karar alır', () => {
    assert.doesNotThrow(() => assertQuoteTransition('DRAFT', 'SENT'));
    assert.doesNotThrow(() => assertQuoteTransition('SENT', 'ACCEPTED'));
    assert.doesNotThrow(() => assertQuoteTransition('SENT', 'REJECTED'));
    assert.doesNotThrow(() => assertQuoteTransition('SENT', 'EXPIRED'));
  });

  it('taslak doğrudan kabul edilemez; karar değiştirilemez', () => {
    assert.throws(() => assertQuoteTransition('DRAFT', 'ACCEPTED'), /önce gönderilmeli/);
    assert.throws(() => assertQuoteTransition('ACCEPTED', 'REJECTED'), /değiştirilemez/);
    assert.throws(() => assertQuoteTransition('EXPIRED', 'SENT'), /yeni teklif/);
  });
});

describe('generateQuoteCode', () => {
  it('TKF- öneki + 6 karışmaz karakter; her çağrı farklı', () => {
    const code = generateQuoteCode((size) => randomBytes(size));
    assert.match(code, /^TKF-[ACDEFHJKMNPQRTUVWXY347]{6}$/);
    const other = generateQuoteCode((size) => randomBytes(size));
    assert.notEqual(code, other);
  });
});

describe('splitLeadName', () => {
  it('son kelime soyad; tek kelimede soyad "—"', () => {
    assert.deepEqual(splitLeadName('Ahmet Yılmaz'), { firstName: 'Ahmet', lastName: 'Yılmaz' });
    assert.deepEqual(splitLeadName('Ayşe Nur Demir'), { firstName: 'Ayşe Nur', lastName: 'Demir' });
    assert.deepEqual(splitLeadName('  Tek  '), { firstName: 'Tek', lastName: '—' });
  });
});
