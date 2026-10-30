import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INSTRUMENT_STATUSES,
  ageBalance,
  formatIban,
  fromCents,
  instrumentActions,
  instrumentTransition,
  isValidIban,
  needsPaymentApproval,
  openingBalanceSchema,
  resolveTreasuryMapping,
  statementQuerySchema,
  toCents,
  treasuryAccountCreateSchema,
  treasuryMappingSchema,
  voucherCreateSchema,
  voucherEffect,
} from './accounting.js';

/**
 * Ön muhasebenin saf kuralları (modül 47): kuruş aritmetiği, IBAN, çek / senet durum makinesi ve muhasebe
 * etkisi, fiş etkisi, onay eşiği, FIFO yaşlandırma, eşleme çözümü ve şema denetimleri. Sayılar elle hesaplandı.
 */

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('kuruş aritmetiği', () => {
  it('metin ↔ kuruş, eksi ve tek ondalık dahil', () => {
    assert.equal(toCents('123.45'), 12345n);
    assert.equal(toCents('-0.5'), -50n);
    assert.equal(toCents('7'), 700n);
    assert.equal(fromCents(-12345n), '-123.45');
    assert.equal(fromCents(5n), '0.05');
    assert.equal(fromCents(toCents('99999999.99') + 1n), '100000000.00');
  });
});

describe('IBAN', () => {
  it('TR + 24 hane ve mod-97 denetimi; boşluk ve küçük harf kabul', () => {
    assert.equal(isValidIban('TR33 0006 1005 1978 6457 8413 26'), true);
    assert.equal(isValidIban('tr330006100519786457841326'), true);
    assert.equal(isValidIban('TR330006100519786457841327'), false, 'tek hane değişti');
    assert.equal(isValidIban('TR33000610051978645784132'), false, '23 hane');
    assert.equal(isValidIban('DE89370400440532013000'), false, 'TR dışı');
    assert.equal(formatIban('tr330006100519786457841326'), 'TR33 0006 1005 1978 6457 8413 26');
  });
});

describe('çek / senet durum makinesi', () => {
  it('alınan: portföy → tahsile ver / tahsil / iade / karşılıksız; bankada → tahsil / karşılıksız / geri al; ciro → yalnız karşılıksız', () => {
    assert.deepEqual(instrumentActions('RECEIVED', 'PORTFOLIO'), ['DEPOSIT', 'COLLECT', 'RETURN', 'BOUNCE']);
    assert.deepEqual(instrumentActions('RECEIVED', 'AT_BANK'), ['COLLECT', 'BOUNCE', 'WITHDRAW']);
    assert.deepEqual(instrumentActions('RECEIVED', 'ENDORSED'), ['BOUNCE']);
    assert.deepEqual(instrumentActions('ISSUED', 'OUTSTANDING'), ['PAY', 'BOUNCE', 'RETURN']);
    for (const terminal of ['COLLECTED', 'BOUNCED', 'RETURNED', 'PAID', 'CANCELLED']) {
      assert.deepEqual(instrumentActions('RECEIVED', terminal), [], terminal);
      assert.deepEqual(instrumentActions('ISSUED', terminal), [], terminal);
    }
  });

  it('muhasebe etkisi: tahsil girer, ödeme çıkar, karşılıksız / iade cariyi yeniden borçlandırır; ciro edilen dönerse ciro edilene alacak', () => {
    assert.deepEqual(instrumentTransition('RECEIVED', 'PORTFOLIO', 'COLLECT'), { status: 'COLLECTED', treasury: 1, ledger: null, endorseeCredit: false, needsTreasury: true });
    assert.deepEqual(instrumentTransition('RECEIVED', 'AT_BANK', 'COLLECT'), { status: 'COLLECTED', treasury: 1, ledger: null, endorseeCredit: false, needsTreasury: false });
    assert.deepEqual(instrumentTransition('RECEIVED', 'PORTFOLIO', 'DEPOSIT'), { status: 'AT_BANK', treasury: 0, ledger: null, endorseeCredit: false, needsTreasury: true });
    assert.equal(instrumentTransition('RECEIVED', 'AT_BANK', 'WITHDRAW').status, 'PORTFOLIO');
    assert.deepEqual(instrumentTransition('RECEIVED', 'PORTFOLIO', 'BOUNCE'), { status: 'BOUNCED', treasury: 0, ledger: 'DEBIT', endorseeCredit: false, needsTreasury: false });
    assert.deepEqual(instrumentTransition('RECEIVED', 'ENDORSED', 'BOUNCE'), { status: 'BOUNCED', treasury: 0, ledger: 'DEBIT', endorseeCredit: true, needsTreasury: false });
    assert.equal(instrumentTransition('RECEIVED', 'PORTFOLIO', 'RETURN').ledger, 'DEBIT');
    assert.deepEqual(instrumentTransition('ISSUED', 'OUTSTANDING', 'PAY'), { status: 'PAID', treasury: -1, ledger: null, endorseeCredit: false, needsTreasury: true });
    assert.equal(instrumentTransition('ISSUED', 'OUTSTANDING', 'BOUNCE').ledger, 'CREDIT');
    assert.equal(instrumentTransition('ISSUED', 'OUTSTANDING', 'RETURN').ledger, 'CREDIT');
    assert.throws(() => instrumentTransition('RECEIVED', 'COLLECTED', 'BOUNCE'), /Geçersiz/);
    assert.throws(() => instrumentTransition('ISSUED', 'OUTSTANDING', 'DEPOSIT'), /Geçersiz/);
  });

  it('her geçişin hedefi geçerli bir durum', () => {
    for (const direction of ['RECEIVED', 'ISSUED']) {
      for (const status of INSTRUMENT_STATUSES) {
        for (const action of instrumentActions(direction, status)) assert.ok(INSTRUMENT_STATUSES.includes(instrumentTransition(direction, status, action).status));
      }
    }
  });
});

describe('fiş etkisi ve onay eşiği', () => {
  it('tahsilat cariyi alacaklandırır, ödeme borçlandırır; toplam kuruşla', () => {
    const lines = [{ kind: 'TREASURY', amount: '1000.10' }, { kind: 'CHEQUE_IN', amount: '2499.95' }];
    assert.deepEqual(voucherEffect('COLLECTION', lines), { total: '3500.05', ledgerSide: 'CREDIT', treasurySign: 1 });
    assert.deepEqual(voucherEffect('PAYMENT', lines), { total: '3500.05', ledgerSide: 'DEBIT', treasurySign: -1 });
    assert.deepEqual(voucherEffect('TREASURY_OUT', [{ kind: 'TREASURY', amount: '10' }]), { total: '10.00', ledgerSide: null, treasurySign: -1 });
    assert.deepEqual(voucherEffect('TRANSFER', [{ kind: 'TREASURY', amount: '10' }]), { total: '10.00', ledgerSide: null, treasurySign: 0 });
  });

  it('eşik 0 ise onay yok; eşiğe eşit tutar onaya gider', () => {
    assert.equal(needsPaymentApproval('1000000.00', '0'), false);
    assert.equal(needsPaymentApproval('9999.99', '10000'), false);
    assert.equal(needsPaymentApproval('10000.00', '10000'), true);
  });
});

describe('FIFO yaşlandırma', () => {
  const today = '2026-10-30';

  it('bakiye en yeni borçlarla kapanır; kalan parça vadesine göre dilime girer', () => {
    const entries = [
      { date: '2026-06-01', dueDate: '2026-06-01', debit: '1000.00', credit: '0' }, // 151 gün
      { date: '2026-08-01', dueDate: '2026-08-31', debit: '2000.00', credit: '0' }, // 60 gün
      { date: '2026-10-01', dueDate: '2026-10-15', debit: '500.00', credit: '0' }, // 15 gün
      { date: '2026-10-20', dueDate: '2026-11-19', debit: '700.00', credit: '0' }, // vadesi gelmemiş
      { date: '2026-10-25', dueDate: null, debit: '0', credit: '1800.00' },
    ];
    // Bakiye 2.400 = 700 (vadesi gelmemiş) + 500 (1–30) + 1.200 / 2.000 (31–60); 1.000'lik en eski borç ödenmiş sayılır.
    const result = ageBalance(entries, '2400.00', today);
    assert.equal(result.side, 'DEBIT');
    assert.deepEqual(result.buckets, { NOT_DUE: '700.00', D30: '500.00', D60: '1200.00', D90: '0.00', D90_PLUS: '0.00' });
    assert.equal(result.overdue, '1700.00');
    assert.equal(result.oldestDueDate, '2026-08-31');
  });

  it('alacaklı cari (borcumuz) alacak hareketleriyle yaşlanır; vadesiz kayıt belge gününe göre', () => {
    const entries = [
      { date: '2026-07-01', dueDate: null, debit: '0', credit: '4000.00' }, // 121 gün
      { date: '2026-10-29', dueDate: '2026-11-28', debit: '0', credit: '1000.00' },
      { date: '2026-10-10', dueDate: null, debit: '2000.00', credit: '0' },
    ];
    const result = ageBalance(entries, '-3000.00', today);
    assert.equal(result.side, 'CREDIT');
    assert.deepEqual(result.buckets, { NOT_DUE: '1000.00', D30: '0.00', D60: '0.00', D90: '0.00', D90_PLUS: '2000.00' });
  });

  it('sıfır bakiye boş dilimler', () => {
    assert.deepEqual(ageBalance([], '0.00', today), { side: null, buckets: { NOT_DUE: '0.00', D30: '0.00', D60: '0.00', D90: '0.00', D90_PLUS: '0.00' }, overdue: '0.00', oldestDueDate: null });
  });
});

describe('eşleme çözümü', () => {
  it('önce tam para birimi, yoksa "her para birimi" satırı; kanal ve yöntem ayrı', () => {
    const rows = [
      { channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: 'try-kasa' },
      { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR', treasuryAccountId: 'eur-kasa' },
      { channel: 'POS', method: 'CASH', currency: '', treasuryAccountId: 'restoran-kasa' },
    ];
    assert.equal(resolveTreasuryMapping(rows, { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR' }), 'eur-kasa');
    assert.equal(resolveTreasuryMapping(rows, { channel: 'FRONT_DESK', method: 'CASH', currency: 'USD' }), 'try-kasa');
    assert.equal(resolveTreasuryMapping(rows, { channel: 'POS', method: 'CASH', currency: 'TRY' }), 'restoran-kasa');
    assert.equal(resolveTreasuryMapping(rows, { channel: 'FRONT_DESK', method: 'CARD', currency: 'TRY' }), null);
  });
});

describe('şemalar', () => {
  const base = { requestId: ID, date: '2026-10-30', description: 'Tahsilat' };

  it('tahsilat cari ve satır ister; satır türü fiş türüne uymalı; aynı çek iki kez ciro edilemez', () => {
    assert.equal(voucherCreateSchema.safeParse({ ...base, type: 'COLLECTION', lines: [] }).success, false);
    const wrongKind = voucherCreateSchema.safeParse({ ...base, type: 'COLLECTION', ledgerAccountId: ID, lines: [{ kind: 'ENDORSE', amount: '5', instrumentId: ID2 }] });
    assert.match(wrongKind.error.issues[0].message, /bu satırı almaz/);
    const twice = voucherCreateSchema.safeParse({
      ...base,
      type: 'PAYMENT',
      ledgerAccountId: ID,
      lines: [
        { kind: 'ENDORSE', amount: '5', instrumentId: ID2 },
        { kind: 'ENDORSE', amount: '5', instrumentId: ID2 },
      ],
    });
    assert.match(twice.error.issues[0].message, /iki kez ciro/);
  });

  it('çek satırı: tür, numara, vade, (çekte) banka; verilen çekte ödeneceği hesap', () => {
    const missing = voucherCreateSchema.safeParse({ ...base, type: 'COLLECTION', ledgerAccountId: ID, lines: [{ kind: 'CHEQUE_IN', amount: '100', instrumentKind: 'CHEQUE' }] });
    const messages = missing.error.issues.map((issue) => issue.message);
    assert.ok(messages.includes('Çek / senet no zorunlu') && messages.includes('Vade zorunlu') && messages.includes('Çekin bankası zorunlu'));
    const issued = voucherCreateSchema.safeParse({ ...base, type: 'PAYMENT', ledgerAccountId: ID, lines: [{ kind: 'CHEQUE_OUT', amount: '100', instrumentKind: 'CHEQUE', number: '1', bankName: 'Ziraat', dueDate: '2026-12-01' }] });
    assert.match(issued.error.issues[0].message, /ödeneceği banka/);
    const note = voucherCreateSchema.safeParse({ ...base, type: 'COLLECTION', ledgerAccountId: ID, lines: [{ kind: 'CHEQUE_IN', amount: '100', instrumentKind: 'NOTE', number: 'S1', dueDate: '2026-12-01' }] });
    assert.equal(note.success, true, 'senette banka gerekmez');
  });

  it('virman: kaynak ≠ hedef, satır almaz, tutar ister', () => {
    assert.match(voucherCreateSchema.safeParse({ ...base, type: 'TRANSFER', treasuryAccountId: ID, targetTreasuryAccountId: ID, amount: '5' }).error.issues[0].message, /aynı olamaz/);
    assert.match(voucherCreateSchema.safeParse({ ...base, type: 'TREASURY_IN', treasuryAccountId: ID }).error.issues[0].message, /Tutar zorunlu/);
    assert.equal(voucherCreateSchema.safeParse({ ...base, type: 'TREASURY_IN', treasuryAccountId: ID, amount: '0.00' }).success, false);
  });

  it('kasada banka bilgisi olmaz, bankanın adı ve geçerli IBAN', () => {
    assert.equal(treasuryAccountCreateSchema.safeParse({ kind: 'CASH', name: 'Kasa', currency: 'TRY', bankName: 'X' }).success, false);
    assert.equal(treasuryAccountCreateSchema.safeParse({ kind: 'BANK', name: 'Banka', currency: 'TRY' }).success, false);
    assert.equal(treasuryAccountCreateSchema.safeParse({ kind: 'BANK', name: 'Banka', currency: 'try', bankName: 'Ziraat', iban: 'TR33 0006 1005 1978 6457 8413 26' }).data.iban, 'TR330006100519786457841326');
    assert.match(treasuryAccountCreateSchema.safeParse({ kind: 'BANK', name: 'Banka', currency: 'TRY', bankName: 'Ziraat', iban: 'TR330006100519786457841327' }).error.issues[0].message, /Geçersiz IBAN/);
  });

  it('eşleme: kanalın yöntemi ve tekil satır; açılış: cari ya da kasa (ikisi değil); ekstre dönemi', () => {
    const rows = [
      { channel: 'POS', method: 'TRANSFER', treasuryAccountId: ID },
      { channel: 'FRONT_DESK', method: 'CASH', currency: 'eur', treasuryAccountId: ID },
      { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR', treasuryAccountId: ID2 },
    ];
    const messages = treasuryMappingSchema.safeParse({ rows }).error.issues.map((issue) => issue.message);
    assert.ok(messages.some((message) => /bu yöntemle tahsilat almaz/.test(message)));
    assert.ok(messages.some((message) => /iki kez eşlenemez/.test(message)));
    assert.equal(openingBalanceSchema.safeParse({ requestId: ID, ledgerAccountId: ID, treasuryAccountId: ID2, amount: '5' }).success, false);
    assert.equal(openingBalanceSchema.safeParse({ requestId: ID, amount: '5' }).success, false);
    assert.equal(statementQuerySchema.safeParse({ from: '2026-10-30', to: '2026-10-01' }).success, false);
    assert.equal(statementQuerySchema.safeParse({ from: '2020-01-01', to: '2026-10-01' }).success, false, '3 yılı aşan dönem');
    assert.equal(statementQuerySchema.parse({}).limit, 100);
  });
});
