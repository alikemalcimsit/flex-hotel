import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayText, moneyText, renderEventDocument, splitLongLine } from './pdf.js';

/**
 * Etkinlik belgesinin PDF'i (modül 37): Türkçe yazı tipi gömülü, uzun kalem tablosu
 * sayfalara bölünür, her türün belgesi çizilebilir.
 */

/** @param {Buffer} pdf */
const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

const snapshot = (overrides = {}) => ({
  kind: 'CONTRACT',
  number: 'SZL-2026-0003/2',
  version: 2,
  issuedDay: '2026-10-16',
  issuedAt: '2026-10-16T09:00:00.000Z',
  issuedBy: 'satis@otel.test',
  note: 'Çiçek düzenlemesi müşteriden; şişe açma ücreti alınmaz.',
  currency: 'TRY',
  hotel: { name: 'Büyük Ankara Oteli', address: 'Atatürk Bulvarı No:1, Çankaya / Ankara', phone: '+90 312 000 00 00', email: 'banket@otel.test' },
  client: { type: 'COMPANY', name: 'Öztürk İnşaat A.Ş.', contactName: 'Şule Çağlar', phone: '+90 532 000 00 00', email: 'sule@ozturk.test', taxOffice: 'Çankaya', taxNumber: '1234567890', address: 'Söğütözü, Ankara' },
  event: { code: 'ETK-2026-0012', name: 'Yıl sonu galası', type: 'GALA', status: 'TENTATIVE', expectedPax: 420, guaranteedPax: 400, actualPax: null, billablePax: 400, firstDay: '2026-12-20' },
  sessions: [
    { title: 'Kokteyl', venueName: 'Fuaye', layout: 'COCKTAIL', pax: 420, startLocal: '2026-12-20T18:00', endLocal: '2026-12-20T19:30' },
    { title: 'Gala yemeği', venueName: 'Büyük Balo Salonu', layout: 'BANQUET', pax: 400, startLocal: '2026-12-20T19:30', endLocal: '2026-12-21T01:00' },
  ],
  items: Array.from({ length: 300 }, (_, index) => ({
    sessionTitle: index % 2 ? 'Gala yemeği' : null,
    category: 'FNB',
    description: `Kalem ${index + 1}: ızgara levrek, şiş köfte, çoban salatası ğüşıöç`,
    perPerson: index % 3 === 0,
    billedQuantity: index % 3 === 0 ? '400' : '2',
    unit: index % 3 === 0 ? 'PERSON' : 'PIECE',
    unitPrice: '1250.00',
    discountPct: index % 5 === 0 ? '10' : '0',
    netAmount: '1136.36',
    taxAmount: '113.64',
    total: '1250.00',
  })),
  totals: { netTotal: '340909.09', taxTotal: '34090.91', grandTotal: '375000.00', taxes: [{ name: 'KDV', rate: '10.00', included: true, amount: '34090.91' }] },
  installments: [
    { label: 'Depozito', dueDate: '2026-10-16', amount: '112500.00' },
    { label: 'Kalan ödeme', dueDate: '2026-12-13', amount: '262500.00' },
  ],
  cancellationTiers: [
    { daysBefore: 60, feePct: '25' },
    { daysBefore: 14, feePct: '50' },
    { daysBefore: 0, feePct: '100' },
  ],
  terms: `${'Ödemeler banka havalesiyle yapılır. '.repeat(120)}\nSon satır.`,
  validUntil: null,
  cancellation: null,
  paid: '112500.00',
  balance: '262500.00',
  ...overrides,
});

describe('etkinlik belgesi PDF', () => {
  it('uzun sözleşme birkaç sayfaya bölünür ve geçerli PDF olur', async () => {
    const pdf = await renderEventDocument(snapshot());
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
    assert.ok(pageCount(pdf) >= 5, `sayfa sayısı ${pageCount(pdf)}`);
    // Yazı tipi gömülü (Türkçe harfler için).
    assert.match(pdf.toString('latin1'), /DejaVuSans/);
  });

  it('teklif ve proforma (iptal bedeli dahil) çizilir', async () => {
    const offer = await renderEventDocument(snapshot({ kind: 'OFFER', number: 'TKL-2026-0001', version: 1, items: snapshot().items.slice(0, 5), terms: null, validUntil: '2026-10-30' }));
    assert.equal(pageCount(offer), 1);
    const proforma = await renderEventDocument(
      snapshot({
        kind: 'PROFORMA',
        number: 'PRF-2026-0001',
        version: 1,
        installments: [],
        cancellationTiers: [],
        terms: null,
        cancellation: { fee: '93750.00', feePct: '25' },
        items: [{ sessionTitle: null, category: 'OTHER', description: 'İptal bedeli (%25)', perPerson: false, billedQuantity: '1', unit: 'PACKAGE', unitPrice: '93750.00', discountPct: '0', netAmount: '78125.00', taxAmount: '15625.00', total: '93750.00' }],
      }),
    );
    assert.equal(pageCount(proforma), 1);
  });

  it('biçimler: para, gün, satır sonu olmayan uzun metin', () => {
    assert.equal(moneyText('1234567.5', 'TRY'), '1.234.567,50 TRY');
    assert.equal(dayText('2026-12-20'), '20.12.2026');
    assert.equal(dayText(null), '—');
    const parts = splitLongLine('kelime '.repeat(1000).trim());
    assert.ok(parts.length >= 4);
    assert.ok(parts.every((part) => part.length <= 1500));
    assert.equal(parts.join(' ').split(' ').length, 1000);
    assert.deepEqual(splitLongLine('kısa'), ['kısa']);
  });
});
