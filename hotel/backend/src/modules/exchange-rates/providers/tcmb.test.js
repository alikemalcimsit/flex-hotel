import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createTcmbProvider, parseTcmbXml, tcmbArchiveUrl } from './tcmb.js';

/** TCMB bülteni: gerçek bir günün XML'i (tcmb-sample.xml, 25.11.2026) okunur; sağlayıcı arşiv adresi ve 404 (tatil) davranışı. */

const SAMPLE = readFileSync(new URL('./tcmb-sample.xml', import.meta.url), 'utf8');

describe('TCMB bülteni', () => {
  it('gerçek bülten okunur: gün, birim (JPY 100), kur türleri', () => {
    const bulletin = parseTcmbXml(SAMPLE);
    assert.equal(bulletin.date, '2026-11-25');
    assert.deepEqual(bulletin.currencies.USD, { unit: 1, rates: { FOREX_BUYING: '50.5531', FOREX_SELLING: '50.6441', BANKNOTE_BUYING: '50.5177', BANKNOTE_SELLING: '50.7201' } });
    assert.equal(bulletin.currencies.JPY.unit, 100);
    assert.ok(bulletin.currencies.EUR.rates.FOREX_BUYING);
    assert.equal(parseTcmbXml('<html>bakım</html>'), null);
  });

  it('arşiv adresi; tatil (404) → yok; başka günün bülteni → yok', async () => {
    assert.equal(tcmbArchiveUrl('2026-11-25'), 'https://www.tcmb.gov.tr/kurlar/202611/25112026.xml');
    const calls = [];
    const provider = createTcmbProvider(async (url) => {
      calls.push(url);
      if (url.includes('28112026')) return { status: 404, ok: false };
      return { status: 200, ok: true, text: async () => SAMPLE };
    });
    assert.equal(await provider.bulletin('2026-11-28'), null);
    assert.equal((await provider.bulletin('2026-11-25')).date, '2026-11-25');
    assert.equal(await provider.bulletin('2026-11-26'), null, 'istenen gün değil');
    const failing = createTcmbProvider(async () => ({ status: 503, ok: false }));
    await assert.rejects(failing.bulletin('2026-11-25'), /HTTP 503/);
  });
});
