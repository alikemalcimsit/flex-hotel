import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { journalRulesSchema } from '@hotelos/hotel-contracts';
import { buildRuleRows, defaultCodeFor, hasRuleKey, newRuleRow, ruleKeyLabel, ruleRowsToRequest } from './ledgerRules.js';

/** Otomatik fiş kuralları ekranı (modül 48): satır kurulumu, etiketler, gövde. */

const GL = (code) => ({ id: `00000000-0000-4000-8000-0000000000${code.replace('.', '').padStart(2, '0').slice(-2)}`, code, name: `Hesap ${code}` });
const LISTS = {
  treasuryAccounts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ön büro kasası' }],
  departments: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Mutfak' }],
};

describe('satır kurulumu', () => {
  it('liste türünde her anahtar bir satır; gelen kural hesabını, eksik olan boş hesabı taşır', () => {
    const rules = [{ source: 'REVENUE', key: 'ROOM', accountId: GL('600.01').id, account: GL('600.01'), isDefault: true }];
    const revenue = buildRuleRows(rules, LISTS).filter((row) => row.source === 'REVENUE');
    assert.equal(revenue.length, 11);
    const room = revenue.find((row) => row.key === 'ROOM');
    assert.equal(room.account.code, '600.01');
    assert.equal(room.isDefault, true);
    assert.equal(room.serverAccountId, null);
    assert.equal(revenue.find((row) => row.key === 'POS').account, null);
  });

  it('kasa / banka, departman ve oran satırları listelerden kurulur', () => {
    const rules = [{ source: 'VAT_OUTPUT', key: '10', accountId: GL('391').id, account: GL('391'), isDefault: false }];
    const rows = buildRuleRows(rules, LISTS);
    assert.deepEqual(rows.filter((row) => row.source === 'TREASURY').map((row) => row.keyLabel), ['Ön büro kasası']);
    assert.deepEqual(rows.filter((row) => row.source === 'PAYROLL_EXPENSE').map((row) => row.keyLabel), ['Mutfak', 'Diğer / belirtilmemiş']);
    assert.deepEqual(rows.filter((row) => row.source === 'VAT_OUTPUT').map((row) => row.keyLabel), ['Bütün oranlar', '%10']);
    assert.equal(rows.find((row) => row.uid === 'VAT_OUTPUT|10').serverAccountId, GL('391').id);
    assert.equal(rows.filter((row) => row.source === 'LEDGER_ACCOUNT').length, 0);
  });

  it('cari kuralının etiketi sunucunun verdiği ad, yoksa anahtar', () => {
    assert.equal(ruleKeyLabel('LEDGER_ACCOUNT', 'abc', LISTS, 'SGK'), 'SGK');
    assert.equal(ruleKeyLabel('LEDGER_ACCOUNT', 'abc', LISTS), 'abc');
  });
});

describe('varsayılan kod', () => {
  it('anahtara özel yoksa oran / departman boş anahtara düşer, diğerleri null', () => {
    assert.equal(defaultCodeFor('REVENUE', 'ROOM'), '600.01');
    assert.equal(defaultCodeFor('VAT_OUTPUT', '10'), '391');
    assert.equal(defaultCodeFor('PAYROLL_EXPENSE', 'x'), '770');
    assert.equal(defaultCodeFor('LEDGER_ACCOUNT', 'x'), null);
  });
});

describe('gövde', () => {
  it('hesaplı satır yazılır, kaldırılan sunucu kuralı null ile silinir, boş eklenen satır gitmez; şemadan geçer', () => {
    const rows = [
      { ...newRuleRow('VAT_INPUT', '20', '%20'), account: GL('191') },
      { uid: 'VAT_OUTPUT|10', source: 'VAT_OUTPUT', key: '10', keyLabel: '%10', account: null, isDefault: false, serverAccountId: GL('391').id, isCustomKey: false },
      { uid: 'REVENUE|ROOM', source: 'REVENUE', key: 'ROOM', keyLabel: 'Oda', account: null, isDefault: true, serverAccountId: null, isCustomKey: false },
      newRuleRow('VAT_INPUT', '1', '%1'),
    ];
    const body = { rows: ruleRowsToRequest(rows) };
    assert.deepEqual(body.rows, [
      { source: 'VAT_INPUT', key: '20', accountId: GL('191').id },
      { source: 'VAT_OUTPUT', key: '10', accountId: null },
    ]);
    assert.equal(journalRulesSchema.safeParse(body).success, true);
  });

  it('aynı anahtar denetimi', () => {
    const rows = buildRuleRows([], LISTS);
    assert.equal(hasRuleKey(rows, 'VAT_OUTPUT', ''), true);
    assert.equal(hasRuleKey(rows, 'VAT_OUTPUT', '10'), false);
  });
});
