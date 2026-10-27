import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { qrModuleCount, qrSvg } from './qr.js';

/** Oda servisi bağlantısının gerçek boyu: kaynak + yol + bağlantı kimliği + imza. */
const LINK = `https://hotel.flexai.tr/misafir/oda-servisi/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.${'A'.repeat(43)}`;

describe('QR kodu', () => {
  it('ölçeklenebilir SVG: sessiz bölgeli görünüm alanı, beyaz zemin, siyah modüller, ekran okuyucu adı', () => {
    const svg = qrSvg(LINK, { title: 'Oda <412> servisi' });
    const size = qrModuleCount(LINK) + 8;
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));
    assert.ok(!/ width="\d+px"/.test(svg), 'sabit genişlik yok (kapsayıcıya uyar)');
    assert.ok(svg.includes('fill="white"') && svg.includes('fill="black"'));
    assert.ok(svg.includes('role="img"'));
    assert.ok(svg.includes('Oda &lt;412&gt; servisi'), 'başlık kaçışlanır');
  });

  it('bağlantının boyu okunabilir bir sürüme sığar (oda kartında küçük basılsa da)', () => {
    // M düzeyinde ~120 bayt sürüm 7 (45 modül) civarıdır; çok daha büyük kod basılı kartta okunmaz.
    assert.ok(LINK.length > 100);
    assert.ok(qrModuleCount(LINK) <= 49, `modül: ${qrModuleCount(LINK)}`);
  });

  it('aynı metin aynı kod (belirlenimci)', () => {
    assert.equal(qrSvg(LINK), qrSvg(LINK));
    assert.notEqual(qrSvg(LINK), qrSvg(`${LINK}B`));
  });
});
