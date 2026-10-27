import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billSlipHtml, escapeHtml, kitchenSlipHtml, prepListHtml, roomServiceSlipHtml, shiftSlipHtml } from './posPrint.js';

/**
 * POS fişleri: kullanıcı girdisi (ürün adı, not) kaçışlanır; hesap fişi faturalanan adedi,
 * ikram / iptali, vergiyi, kalanı ve kişi başını gösterir; mutfak fişi turun kalemlerini
 * istasyona göre ve mutfağa gitmeyenler hariç verir.
 */

const check = {
  number: 'ADS-2026-000042',
  currency: 'TRY',
  covers: 3,
  waiterEmail: 'garson@otel.test',
  outlet: { name: 'Ana <Restoran>' },
  table: { name: '12' },
  paidTotal: '100.00',
  roomChargeTotal: '0.00',
  balance: '1000.00',
  totals: { subtotal: '1100.00', discountTotal: '0.00', grandTotal: '1100.00', taxes: [{ name: 'KDV', rate: '10', included: true, amount: '100.00' }] },
  orders: [{ id: 'o1', seq: 1, sentAt: '2026-10-17T19:00:00.000Z' }, { id: 'o2', seq: 2, sentAt: '2026-10-17T19:30:00.000Z' }],
  lines: [
    { name: 'Köfte <b>acılı</b>', quantity: 3, voidedQuantity: 0, compedQuantity: 1, total: '900.00', orderId: 'o1', orderSeq: 1, station: 'HOT', note: 'Az "pişmiş"' },
    { name: 'Bira', quantity: 1, voidedQuantity: 0, compedQuantity: 0, total: '200.00', orderId: 'o1', orderSeq: 1, station: 'BAR', note: null },
    { name: 'Çikolata', quantity: 1, voidedQuantity: 0, compedQuantity: 0, total: '0.00', orderId: 'o2', orderSeq: 2, station: 'NONE', note: null },
  ],
};

describe('fişler', () => {
  it('kaçış: etiket ve tırnak metne dönüşür', () => {
    assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });

  it('hesap fişi: faturalanan adet, ikram notu, vergi, kalan ve kişi başı; ham HTML yok', () => {
    const html = billSlipHtml(check);
    assert.ok(html.includes('2 × Köfte &lt;b&gt;acılı&lt;/b&gt;'));
    assert.ok(html.includes('(1 ikram)'));
    assert.ok(html.includes('Ana &lt;Restoran&gt;'));
    assert.ok(html.includes('KDV %10 (dahil)'));
    assert.ok(html.includes('KALAN'));
    assert.ok(html.includes('Kişi başı (3): 333,34 / 333,33 / 333,33'));
    assert.ok(html.includes('mali değeri yoktur'));
    assert.ok(!html.includes('<b>acılı'));
  });

  it('mutfak fişi: turun kalemleri istasyona göre, notlu; mutfağa gitmeyen yok', () => {
    const first = kitchenSlipHtml(check, 'o1');
    assert.ok(first.includes('Sıcak mutfak'));
    assert.ok(first.includes('Bar'));
    assert.ok(first.includes('Az &quot;pişmiş&quot;'));
    const second = kitchenSlipHtml(check, 'o2');
    assert.ok(second.includes('mutfağa giden kalem yok'));
    assert.ok(!second.includes('Çikolata'));
  });

  it('vardiya fişi: kasa farkı, yöntemler, satış; adlar kaçışlanır', () => {
    const html = shiftSlipHtml(
      {
        currency: 'TRY',
        shift: {
          waiterEmail: 'garson@otel.test',
          outletName: null,
          openedAt: '2026-10-17T08:00:00.000Z',
          closedAt: '2026-10-17T16:00:00.000Z',
          countedCash: '1250.00',
          variance: '-150.00',
          cash: { openingFloat: '500.00', cashNet: '900.00', expectedCash: '1400.00' },
          payments: [{ method: 'CASH', net: '900.00' }, { method: 'CARD', net: '990.00' }],
        },
        sales: { checks: 3, covers: 5, discountTotal: '0.00', compTotal: '0.00', voidTotal: '450.00', wasteCount: 1, wasteTotal: '450.00', grandTotal: '1890.00' },
        roomCharges: { amount: '0.00' },
        topItems: [{ quantity: 3, name: 'Köfte <x>', amount: '1350.00' }],
      },
      { CASH: 'Nakit', CARD: 'Kredi kartı' },
    );
    assert.ok(html.includes('FARK'));
    assert.ok(html.includes('-150,00'));
    assert.ok(html.includes('Kredi kartı'));
    assert.ok(html.includes('3 × Köfte &lt;x&gt;'));
  });

  it('oda servisi teslim fişi: oda (taşındıysa yenisi), misafir, otelin saatiyle teslim, notlar kaçışlanır', () => {
    const html = roomServiceSlipHtml(
      {
        number: 'OS-2026-000007',
        roomNumber: '101',
        movedTo: '305',
        guestName: 'Ayşe <b>Kaya</b>',
        outletName: 'Oda Servisi',
        covers: 2,
        source: 'GUEST',
        createdAt: '2026-10-25T20:00:00.000Z',
        deliverAt: '2026-10-26T04:30:00.000Z',
        dueAt: '2026-10-26T04:30:00.000Z',
        items: [{ name: 'Omlet', quantity: 2, unitPrice: '180.00', note: 'az <tuz>' }],
        note: 'Kapıyı çalmayın',
        trayExpected: true,
        check: { grandTotal: '410.00' },
        itemsTotal: '360.00',
      },
      'Europe/Istanbul',
    );
    assert.ok(html.includes('<h1>Oda 305</h1>'));
    assert.ok(html.includes('Ayşe &lt;b&gt;Kaya&lt;/b&gt;'));
    assert.ok(html.includes('Teslim 26.10 07:30'));
    assert.ok(html.includes('az &lt;tuz&gt;'));
    assert.ok(html.includes('410,00'));
    assert.ok(html.includes('101 numaralı odadan taşındı'));
  });

  it('hazırlık listesi: gün toplamı, aralıklar, oda kalemleri; kesilme notu', () => {
    const html = prepListHtml({
      date: '2026-10-26',
      timezone: 'Europe/Istanbul',
      total: 1,
      truncated: true,
      items: [{ name: 'Omlet', note: null, quantity: 3 }],
      slots: [{ time: '07:30', items: [{ name: 'Omlet', note: null, quantity: 3 }], orders: [{ roomNumber: '412', movedTo: null, deliverAt: '2026-10-26T04:40:00.000Z', covers: 2, items: [{ name: 'Omlet', quantity: 3, note: 'acı <yok>' }], note: null }] }],
    });
    assert.ok(html.includes('07:30 · 1 oda'));
    assert.ok(html.includes('Oda 412</strong> · 07:40'));
    assert.ok(html.includes('acı &lt;yok&gt;'));
    assert.ok(html.includes('Liste kesildi'));
  });
});
