import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateLines, convertAtRate, diffByAccount, documentKeyOf, effectiveJournalDate, groupRecords, journalSourceKeyOf, netDebitOf, payrollLiabilityKeyOf, splitCounter } from './rules.js';

/**
 * Otomatik fiş motorunun saf adımları (modül 48): belge gruplama, karşı tarafın ağırlıkla bölünmesi, hesap bazında
 * toplama, kur çevrimi, dönem kilidi, fark hesabı. Sayılar elle hesaplandı.
 */

describe('belge gruplama', () => {
  it('aynı belgenin kayıtları tek grup; ters kayıtlar ayrı; çek işlemleri hareket bazında (ENDORSEE eki aynı işlem)', () => {
    const records = [
      { sourceType: 'VOUCHER', sourceId: 'v1', sourceKey: 'VOUCHER:v1', date: '2026-11-20' },
      { sourceType: 'VOUCHER', sourceId: 'v1', sourceKey: 'VOUCHER:v1:1', date: '2026-11-20' },
      { sourceType: 'VOUCHER', sourceId: 'v1', sourceKey: 'REVERSAL:e1', date: '2026-11-22' },
      { sourceType: 'INSTRUMENT', sourceId: 'c1', sourceKey: 'INSTRUMENT:c1:m1', date: '2026-11-21' },
      { sourceType: 'INSTRUMENT', sourceId: 'c1', sourceKey: 'INSTRUMENT:c1:m1:ENDORSEE', date: '2026-11-21' },
      { sourceType: 'INSTRUMENT', sourceId: 'c1', sourceKey: 'INSTRUMENT:c1:m2', date: '2026-11-23' },
    ];
    const groups = groupRecords(records);
    assert.deepEqual(
      groups.map((group) => [group.key, group.records.length, group.reversal, group.date]),
      [
        ['VOUCHER:v1', 2, false, '2026-11-20'],
        ['VOUCHER:v1:REVERSAL', 1, true, '2026-11-22'],
        ['INSTRUMENT:c1:m1', 2, false, '2026-11-21'],
        ['INSTRUMENT:c1:m2', 1, false, '2026-11-23'],
      ],
    );
    assert.equal(documentKeyOf({ sourceType: 'FOLIO_PAYMENT', sourceId: 'p1', sourceKey: 'PAYMENT:p1' }), 'FOLIO_PAYMENT:p1');
    // Fark kaynakları kayıt bazında: gerçekleşme ve iptal farkı ayrı fiş.
    assert.equal(documentKeyOf({ sourceType: 'EVENT_CHARGE', sourceId: 'e1', sourceKey: 'EVENT:e1:1' }), 'EVENT_CHARGE:EVENT:e1:1');
    assert.equal(documentKeyOf({ sourceType: 'AGENCY_BONUS', sourceId: 'b1', sourceKey: 'AGENCY_BONUS:b1:2' }), 'AGENCY_BONUS:AGENCY_BONUS:b1:2');
    // Fiş anahtarı grubun en küçük kayıt kimliğini taşır: aynı belgeye sonradan eklenen kayıt yeni anahtar.
    assert.equal(journalSourceKeyOf({ key: 'PAYROLL:r1', records: [{ id: 'b' }, { id: 'a' }] }), 'PAYROLL:r1#a');
    assert.equal(journalSourceKeyOf({ key: 'PAYROLL:r1', records: [{ id: 'c' }] }), 'PAYROLL:r1#c');
  });

  it('bordro yükümlülük anahtarı', () => {
    assert.equal(payrollLiabilityKeyOf('PAYROLL:r1:SGK'), 'SGK');
    assert.equal(payrollLiabilityKeyOf('PAYROLL:r1:GARN:g9'), 'GARN');
    assert.equal(payrollLiabilityKeyOf('REVERSAL:PAYROLL:r1:TAX'), 'TAX');
    assert.equal(payrollLiabilityKeyOf('PAYROLL:r1:11111111-1111-4111-8111-111111111111'), null);
    assert.equal(payrollLiabilityKeyOf('PAYROLL_PAYMENT:p1:e1'), null);
  });
});

describe('karşı tarafın bölünmesi', () => {
  it('ağırlıklarla kuruşa böler, kalan en büyük paya; toplam her zaman tutara eşit', () => {
    // Mal kabul 1.180,00 (net 1.000 + %18 KDV 180): tedarikçi alacaklandı → karşı taraf +118000 kuruş.
    const parts = splitCounter(118000n, [
      { key: 'PURCHASE|', weight: '1000.00' },
      { key: 'VAT_INPUT|18', weight: '180.00' },
    ]);
    assert.deepEqual(parts, [
      { key: 'PURCHASE|', amount: 100000n },
      { key: 'VAT_INPUT|18', amount: 18000n },
    ]);
    const odd = splitCounter(10001n, [
      { key: 'a', weight: '1' },
      { key: 'b', weight: '1' },
      { key: 'c', weight: '1' },
    ]);
    assert.equal(odd.reduce((sum, part) => sum + part.amount, 0n), 10001n);
    assert.deepEqual(odd.map((part) => part.amount), [3335n, 3333n, 3333n]);
  });

  it('eksi toplam (ters kayıt) aynı oranlarla eksi paylar; sıfır ağırlıklar atılır; ağırlık yoksa tek parça', () => {
    assert.deepEqual(
      splitCounter(-118000n, [
        { key: 'net', weight: '1000.00' },
        { key: 'kdv0', weight: '0.00' },
        { key: 'kdv18', weight: '180.00' },
      ]),
      [
        { key: 'net', amount: -100000n },
        { key: 'kdv18', amount: -18000n },
      ],
    );
    assert.deepEqual(splitCounter(500n, [{ key: 'x', weight: '0' }]), [{ key: 'x', amount: 500n }]);
    assert.deepEqual(splitCounter(0n, [{ key: 'x', weight: '1' }]), []);
  });
});

describe('satır toplama', () => {
  it('hesap bazında toplar, borçlar önce; tek cari izi kalır, çok cari iz silinir; sıfırlanan hesap düşer', () => {
    const lines = aggregateLines([
      { accountId: 'A335', code: '335', amount: -150000n, ledgerAccountId: 'p1' },
      { accountId: 'A335', code: '335', amount: -250000n, ledgerAccountId: 'p2' },
      { accountId: 'A100', code: '100.01', amount: 400000n, treasuryAccountId: 'k1', description: 'Kasa' },
      { accountId: 'A999', code: '999', amount: 100n },
      { accountId: 'A999', code: '999', amount: -100n },
    ]);
    assert.deepEqual(lines, [
      { accountId: 'A100', debit: '4000.00', credit: '0.00', ledgerAccountId: null, treasuryAccountId: 'k1', description: 'Kasa' },
      { accountId: 'A335', debit: '0.00', credit: '4000.00', ledgerAccountId: null, treasuryAccountId: null, description: null },
    ]);
    assert.equal(netDebitOf([{ amount: 400000n }, { amount: -400000n }]), 0n);
  });

  it('hesap bazında tamamen sıfırlanan belge borç ve alacak satırlarıyla iz bırakır (fiş dengeli, net sıfır)', () => {
    const lines = aggregateLines([
      { accountId: 'A100', code: '100.01', amount: -30000n, treasuryAccountId: 'k1' },
      { accountId: 'A100', code: '100.01', amount: 30000n, treasuryAccountId: 'b1' },
    ]);
    assert.deepEqual(
      lines.map((line) => [line.debit, line.credit]),
      [
        ['300.00', '0.00'],
        ['0.00', '300.00'],
      ],
    );
  });
});

describe('kur, kilit, fark', () => {
  it('kur çevrimi kuruşa yuvarlar (yarım yukarı), eksi tutarda simetrik', () => {
    assert.equal(convertAtRate('100.00', '36.5'), '3650.00');
    assert.equal(convertAtRate('33.33', '36.123456'), '1203.99');
    assert.equal(convertAtRate('-33.33', '36.123456'), '-1203.99');
  });

  it('kilitli dönemdeki fiş kilit sonrası ilk güne düşer', () => {
    assert.deepEqual(effectiveJournalDate('2026-11-20', null), { date: '2026-11-20', deferred: false });
    assert.deepEqual(effectiveJournalDate('2026-11-20', '2026-11-19'), { date: '2026-11-20', deferred: false });
    assert.deepEqual(effectiveJournalDate('2026-11-20', '2026-11-30'), { date: '2026-12-01', deferred: true });
  });

  it('hedef − yazılmış farkı; sıfırlar düşer', () => {
    const diff = diffByAccount(new Map([['a', 500n], ['b', -300n], ['c', 100n]]), new Map([['a', 500n], ['b', -100n], ['d', 50n]]));
    assert.deepEqual([...diff], [['b', -200n], ['c', 100n], ['d', -50n]]);
  });
});
