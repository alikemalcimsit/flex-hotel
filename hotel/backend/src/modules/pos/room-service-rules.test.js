import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { doorSettlement, menuLineErrors, pickReleaseShift, prepSlots, quoteItems, roomServiceNumber } from './room-service-rules.js';

const item = (id, overrides = {}) => ({
  id,
  name: `Ürün ${id}`,
  price: '100.00',
  station: 'HOT',
  taxCategory: 'FNB',
  isActive: true,
  soldOut: false,
  system: null,
  category: { isActive: true, outletIds: [] },
  ...overrides,
});

describe('oda servisi numarası', () => {
  it('yıl ve altı haneli sıra', () => {
    assert.equal(roomServiceNumber(2026, 7), 'OS-2026-000007');
    assert.equal(roomServiceNumber(2027, 123456), 'OS-2027-123456');
  });
});

describe('menü kalemi denetimi', () => {
  const byId = new Map([
    ['a', item('a')],
    ['off', item('off', { isActive: false })],
    ['catoff', item('catoff', { category: { isActive: false, outletIds: [] } })],
    ['sold', item('sold', { soldOut: true })],
    ['bar', item('bar', { category: { isActive: true, outletIds: ['BAR'] } })],
    ['rs', item('rs', { category: { isActive: true, outletIds: ['RS', 'BAR'] } })],
    ['tray', item('tray', { system: 'TRAY_CHARGE' })],
  ]);

  it('geçerli kalemde hata yok; nokta kısıtı noktayı içeriyorsa geçer', () => {
    assert.deepEqual(menuLineErrors([{ menuItemId: 'a' }, { menuItemId: 'rs' }], byId, 'RS'), {});
  });

  it('bulunamayan, sistem ürünü, kalkmış, grubu kalkmış, tükenmiş, başka noktanın ürünü', () => {
    const errors = menuLineErrors(
      ['nope', 'tray', 'off', 'catoff', 'sold', 'bar'].map((menuItemId) => ({ menuItemId })),
      byId,
      'RS',
    );
    assert.deepEqual(errors, {
      'lines.0.menuItemId': 'Ürün bulunamadı',
      'lines.1.menuItemId': 'Ürün bulunamadı',
      'lines.2.menuItemId': 'Ürün off satıştan kalkmış',
      'lines.3.menuItemId': 'Ürün catoff satıştan kalkmış',
      'lines.4.menuItemId': 'Ürün sold tükendi',
      'lines.5.menuItemId': 'Ürün bar bu satış noktasında satılmıyor',
    });
  });
});

describe('sipariş kopyası', () => {
  it('ad, fiyat, istasyon, not ve toplam (kuruş hatasız)', () => {
    const byId = new Map([
      ['a', item('a', { price: '33.33' })],
      ['b', item('b', { price: '0.10', station: 'BAR', taxCategory: 'FNB' })],
    ]);
    const quote = quoteItems(
      [
        { menuItemId: 'a', quantity: 3, note: 'acısız' },
        { menuItemId: 'b', quantity: 3 },
      ],
      byId,
    );
    assert.equal(quote.itemsTotal, '100.29');
    assert.deepEqual(quote.items[0], { menuItemId: 'a', name: 'Ürün a', unitPrice: '33.33', quantity: 3, note: 'acısız', station: 'HOT', taxCategory: 'FNB' });
    assert.equal(quote.items[1].note, null);
  });
});

describe('teslimde ödeme planı', () => {
  it('ödeme yok: kalanın tamamı odaya', () => {
    assert.deepEqual(doorSettlement({ balance: '420.00', payments: [], chargeRemainder: true }), { error: null, field: null, paid: '0.00', remainder: '420.00' });
  });

  it('kapıda bölünmüş ödeme + kalan odaya', () => {
    const plan = doorSettlement({ balance: '420.00', payments: [{ amount: '100' }, { amount: '120.50' }], chargeRemainder: true });
    assert.deepEqual(plan, { error: null, field: null, paid: '220.50', remainder: '199.50' });
  });

  it('kapıda tamamı: kalan sıfır, odaya yazma gerekmez', () => {
    assert.deepEqual(doorSettlement({ balance: '420.00', payments: [{ amount: '420' }], chargeRemainder: false }), { error: null, field: null, paid: '420.00', remainder: '0.00' });
  });

  it('kalan var ve odaya yazılmıyor: teslim edilmez', () => {
    const plan = doorSettlement({ balance: '420.00', payments: [{ amount: '400' }], chargeRemainder: false });
    assert.equal(plan.field, 'chargeRemainder');
    assert.match(plan.error, /Kalan 20\.00 ödenmedi/);
  });

  it('fazla ödeme yazılmaz (para üstü elde)', () => {
    const plan = doorSettlement({ balance: '420.00', payments: [{ amount: '400' }, { amount: '20.01' }], chargeRemainder: true });
    assert.equal(plan.field, 'payments');
    assert.match(plan.error, /aşıyor/);
  });

  it('bakiye yokken (tamamı ikram) ödeme alınmaz; ödemesiz teslim olur', () => {
    assert.equal(doorSettlement({ balance: '0.00', payments: [{ amount: '1' }], chargeRemainder: true }).field, 'payments');
    assert.deepEqual(doorSettlement({ balance: '0.00', payments: [], chargeRemainder: false }), { error: null, field: null, paid: '0.00', remainder: '0.00' });
  });
});

describe('planlı siparişin düşeceği vardiya', () => {
  const at = (minute) => new Date(Date.UTC(2026, 9, 26, 5, minute));
  const shifts = [
    { id: 's3', waiterEmail: 'gece@otel', outletId: 'RS', openedAt: at(30) },
    { id: 's1', waiterEmail: 'sabah@otel', outletId: 'RS', openedAt: at(0) },
    { id: 's2', waiterEmail: 'bar@otel', outletId: 'BAR', openedAt: at(-60) },
  ];

  it('siparişi girenin açık vardiyası önce (başka noktada olsa da)', () => {
    assert.equal(pickReleaseShift(shifts, { createdBy: 'bar@otel', outletId: 'RS' }).id, 's2');
  });

  it('yoksa oda servisi noktasında en erken açılan', () => {
    assert.equal(pickReleaseShift(shifts, { createdBy: 'aksam@otel', outletId: 'RS' }).id, 's1');
  });

  it('eşit açılışta kimlik sırası; hiç yoksa boş', () => {
    const tie = [
      { id: 'b', waiterEmail: 'x', outletId: 'RS', openedAt: at(0) },
      { id: 'a', waiterEmail: 'y', outletId: 'RS', openedAt: at(0) },
    ];
    assert.equal(pickReleaseShift(tie, { createdBy: 'z', outletId: 'RS' }).id, 'a');
    assert.equal(pickReleaseShift(shifts.filter((shift) => shift.outletId === 'BAR'), { createdBy: 'z', outletId: 'RS' }), null);
  });
});

describe('hazırlık listesi', () => {
  const order = (id, iso, items) => ({ id, deliverAt: new Date(iso), items });
  const omlet = { menuItemId: 'om', name: 'Omlet', quantity: 1, station: 'HOT' };
  const cay = { menuItemId: 'cay', name: 'Çay', quantity: 2, station: 'BAR' };
  const tray = { menuItemId: 'tray', name: 'Oda servisi ücreti', quantity: 1, station: 'NONE' };

  it('otelin saatiyle 15 dakikalık aralıklar; aralık ve gün toplamı; mutfağa gitmeyen sayılmaz', () => {
    const result = prepSlots(
      [
        order('o3', '2026-10-26T04:44:00Z', [{ ...omlet, quantity: 2 }]),
        order('o1', '2026-10-26T04:30:00Z', [omlet, cay, tray]),
        order('o2', '2026-10-26T04:40:00Z', [{ ...omlet, note: 'az pişmiş' }]),
        order('o4', '2026-10-26T05:00:00Z', [cay]),
      ],
      { timeZone: 'Europe/Istanbul', slotMinutes: 15 },
    );
    assert.deepEqual(
      result.slots.map((slot) => [slot.time, slot.orders.map((entry) => entry.id)]),
      [
        ['07:30', ['o1', 'o2', 'o3']],
        ['08:00', ['o4']],
      ],
    );
    assert.deepEqual(result.slots[0].items, [
      { menuItemId: 'om', name: 'Omlet', note: null, quantity: 3 },
      { menuItemId: 'cay', name: 'Çay', note: null, quantity: 2 },
      { menuItemId: 'om', name: 'Omlet', note: 'az pişmiş', quantity: 1 },
    ]);
    assert.deepEqual(result.items, [
      { menuItemId: 'cay', name: 'Çay', note: null, quantity: 4 },
      { menuItemId: 'om', name: 'Omlet', note: null, quantity: 3 },
      { menuItemId: 'om', name: 'Omlet', note: 'az pişmiş', quantity: 1 },
    ]);
  });

  it('boş gün', () => {
    assert.deepEqual(prepSlots([], { timeZone: 'Europe/Istanbul', slotMinutes: 15 }), { slots: [], items: [] });
  });
});
