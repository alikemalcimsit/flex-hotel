import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  amountInWordsTr,
  buildInvoiceLines,
  chooseInvoiceDocumentType,
  edocRetryAt,
  EDOC_RETRY_DELAYS_MS,
  formatInvoiceNumber,
  integerInWordsTr,
  invoiceBuyerId,
  invoiceBuyerName,
  invoiceBuyerProblems,
  invoiceCancelSchema,
  invoiceDeadline,
  invoiceDraftCreateSchema,
  invoiceQrPayload,
  invoiceSettingsSchema,
  invoiceTotals,
  isValidTckn,
  isValidVkn,
  parseInvoiceNumber,
  testTaxpayerSchema,
} from './invoicing.js';

const KDV = 'tax-kdv';
const KV = 'tax-kv';
const KDV20 = 'tax-kdv20';
const TAX_CODES = new Map([
  [KDV, { code: '0015', name: 'KDV' }],
  [KDV20, { code: '0015', name: 'KDV' }],
  [KV, { code: '0059', name: 'Konaklama vergisi' }],
]);

/** Gece: brüt 1.120 (KDV %10 + konaklama vergisi %2 dahil) → net 1.000, KDV 100, KV 20. */
const night = (date, sign = 1) => ({
  group: 'ROOM',
  description: 'Konaklama',
  net: String(1000 * sign),
  taxes: [
    { taxId: KDV, rate: '10.000', amount: String(100 * sign) },
    { taxId: KV, rate: '2', amount: String(20 * sign) },
  ],
  serviceDate: date,
});

describe('kimlik numaraları', () => {
  it('TC kimlik no: denetim haneleri; 11111111111 geçerli bir TCKN değildir (yabancı için yer tutucu)', () => {
    assert.equal(isValidTckn('10000000146'), true);
    assert.equal(isValidTckn('10000000147'), false);
    assert.equal(isValidTckn('01234567890'), false, 'ilk hane 0 olamaz');
    assert.equal(isValidTckn('1000000014'), false);
    assert.equal(isValidTckn('11111111111'), false);
  });

  it('vergi no: GİB denetim hanesi; tek hane değişince geçersiz', () => {
    for (const vkn of ['1234567890', '9876543217', '4730012344']) {
      assert.equal(isValidVkn(vkn), true, vkn);
      assert.equal(isValidVkn(vkn.slice(0, 9) + ((Number(vkn[9]) + 1) % 10)), false, `${vkn} bozuk`);
    }
    assert.equal(isValidVkn('123456789'), false);
    assert.equal(isValidVkn('12345678ab'), false);
  });
});

describe('fatura numarası', () => {
  it('seri + yıl + 9 hane; sınır dışı sıra ve geçersiz seri reddedilir', () => {
    assert.equal(formatInvoiceNumber('FTR', 2026, 1), 'FTR2026000000001');
    assert.equal(formatInvoiceNumber('EA1', 2026, 999_999_999), 'EA12026999999999');
    assert.deepEqual(parseInvoiceNumber('FTR2026000000042'), { prefix: 'FTR', year: 2026, sequence: 42 });
    assert.equal(parseInvoiceNumber('FTR202600000042'), null);
    assert.throws(() => formatInvoiceNumber('ft', 2026, 1));
    assert.throws(() => formatInvoiceNumber('FTR', 2026, 0));
    assert.throws(() => formatInvoiceNumber('FTR', 2026, 1_000_000_000));
  });
});

describe('fatura satırları (folyo)', () => {
  it('geceler tek satırda; iptal edilen gece aslını götürür; indirim iskonto olur; vergiler folyo toplamıyla kuruşu kuruşuna aynı', () => {
    const charges = [
      night('2026-10-12'),
      night('2026-10-13'),
      night('2026-10-14'),
      night('2026-10-14', -1),
      { group: 'ROOM', description: 'Konaklama', discount: true, net: '-200', taxes: [{ taxId: KDV, rate: '10', amount: '-20' }, { taxId: KV, rate: '2', amount: '-4' }], serviceDate: '2026-10-14' },
      { group: 'MINIBAR', description: 'Minibar', net: '200', taxes: [{ taxId: KDV20, rate: '20', amount: '40' }], serviceDate: '2026-10-13' },
    ];
    const { lines, problems } = buildInvoiceLines({ charges, taxCodes: TAX_CODES });
    assert.deepEqual(problems, []);
    assert.equal(lines.length, 2);
    const room = lines.find((line) => line.description === 'Konaklama');
    assert.deepEqual(
      { gross: room.gross, discount: room.discount, net: room.net, tax: room.taxAmount, total: room.total, quantity: room.quantity, from: room.serviceFrom, to: room.serviceTo },
      { gross: '2000.00', discount: '200.00', net: '1800.00', tax: '216.00', total: '2016.00', quantity: '1', from: '2026-10-12', to: '2026-10-14' },
    );
    assert.deepEqual(
      room.taxes.map((tax) => [tax.code, tax.rate, tax.base, tax.amount]),
      [
        ['0015', '10', '1800.00', '180.00'],
        ['0059', '2', '1800.00', '36.00'],
      ],
      'KDV ve konaklama vergisi aynı matrah (KDV hariç bedel) üzerinden',
    );

    const totals = invoiceTotals(lines);
    assert.deepEqual(
      { gross: totals.gross, discount: totals.discount, net: totals.lineExtension, tax: totals.taxTotal, payable: totals.payable },
      { gross: '2200.00', discount: '200.00', net: '2000.00', tax: '256.00', payable: '2256.00' },
      'folyo: 3 × 1.120 − 1.120 (iptal) − 224 (indirim) + 240 (minibar) = 2.256',
    );
    assert.deepEqual(
      totals.taxes.map((tax) => [tax.code, tax.rate, tax.base, tax.amount]),
      [
        ['0015', '20', '200.00', '40.00'],
        ['0015', '10', '1800.00', '180.00'],
        ['0059', '2', '1800.00', '36.00'],
      ],
    );
  });

  it('tamamı iptal edilmiş grup satır üretmez; vergisiz satıra %0 KDV ve 351 muafiyet kodu eklenir', () => {
    const { lines, problems } = buildInvoiceLines({
      charges: [night('2026-10-12'), night('2026-10-12', -1), { group: 'OTHER', description: 'Diğer hizmetler', net: '150', taxes: [] }],
      taxCodes: TAX_CODES,
    });
    assert.deepEqual(problems, []);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].taxes, [{ code: '0015', name: 'KDV', rate: '0', base: '150.00', amount: '0.00', exemptionCode: '351', exemptionReason: 'İstisna olmayan diğer' }]);
    assert.equal(lines[0].total, '150.00');
  });

  it('net eksiye düşen grup, eşlenmemiş vergi ve iki kez eşlenmiş kod sorun olarak döner', () => {
    const negative = buildInvoiceLines({
      charges: [{ group: 'ROOM', description: 'Konaklama', discount: true, net: '-100', taxes: [{ taxId: KDV, rate: '10', amount: '-10' }] }],
      taxCodes: TAX_CODES,
    });
    assert.equal(negative.lines.length, 0);
    assert.match(negative.problems[0], /eksiye düşüyor/);

    const unmapped = buildInvoiceLines({ charges: [{ group: 'SPA', description: 'Spa', net: '100', taxes: [{ taxId: 'bilinmeyen', rate: '20', amount: '20' }] }], taxCodes: TAX_CODES });
    assert.match(unmapped.problems[0], /Vergi kodu eşlemesi eksik/);

    const twice = buildInvoiceLines({
      charges: [{ group: 'FNB', description: 'Yiyecek', net: '100', taxes: [{ taxId: KDV, rate: '10', amount: '10' }, { taxId: KDV20, rate: '20', amount: '20' }] }],
      taxCodes: TAX_CODES,
    });
    assert.match(twice.problems[0], /aynı vergi koduna/);
  });

  it('farklı vergi imzalı aynı gelir iki satır olur (oran değişmiş geceler)', () => {
    const { lines } = buildInvoiceLines({
      charges: [night('2026-10-12'), { ...night('2026-10-13'), taxes: [{ taxId: KDV, rate: '10', amount: '100' }] }],
      taxCodes: TAX_CODES,
    });
    assert.equal(lines.length, 2);
  });
});

describe('fatura satırları (etkinlik / serbest)', () => {
  it('miktar ve birim, birim fiyat kuruşa tam bölünüyorsa korunur; bölünmüyorsa 1 adet × net', () => {
    const { lines } = buildInvoiceLines({
      charges: [
        { group: 'a', description: 'Gala menüsü', net: '54000', quantity: '120', unitCode: 'C62', taxes: [{ taxId: KDV, rate: '10', amount: '5400' }] },
        { group: 'b', description: 'Salon kirası', net: '1000', quantity: '3', unitCode: 'HUR', taxes: [{ taxId: KDV20, rate: '20', amount: '200' }] },
        { group: 'c', description: 'Ses sistemi', net: '2500', quantity: '2.5', unitCode: 'DAY', taxes: [{ taxId: KDV20, rate: '20', amount: '500' }] },
      ],
      taxCodes: TAX_CODES,
    });
    assert.deepEqual(
      lines.map((line) => [line.description, line.quantity, line.unitCode, line.unitPrice, line.net]),
      [
        ['Gala menüsü', '120', 'C62', '450.00', '54000.00'],
        ['Salon kirası', '1', 'C62', '1000.00', '1000.00'],
        ['Ses sistemi', '2.50', 'DAY', '1000.00', '2500.00'],
      ],
    );
  });
});

describe('alıcı', () => {
  it('kişi: ad, soyad, geçerli TCKN, adres; şirket: ünvan, VKN ya da şahıs işletmesi TCKN, vergi dairesi', () => {
    const address = { district: 'Çankaya', city: 'Ankara', country: 'Türkiye' };
    assert.deepEqual(invoiceBuyerProblems({ type: 'PERSON', firstName: 'Ayşe', lastName: 'Demir', taxNumber: '10000000146', ...address }), {});
    assert.deepEqual(Object.keys(invoiceBuyerProblems({ type: 'PERSON', firstName: 'Ayşe', taxNumber: '10000000147' })).sort(), ['city', 'country', 'district', 'lastName', 'taxNumber']);
    assert.deepEqual(invoiceBuyerProblems({ type: 'COMPANY', name: 'Demir Holding', taxNumber: '1234567890', taxOffice: 'Kavaklıdere', ...address }), {});
    assert.deepEqual(invoiceBuyerProblems({ type: 'COMPANY', name: 'Ayşe Demir Ltd', taxNumber: '10000000146', taxOffice: 'Çankaya', ...address }), {}, 'şahıs işletmesi TCKN ile');
    assert.equal(invoiceBuyerProblems({ type: 'COMPANY', name: 'X', taxNumber: '1234567891', taxOffice: 'Y', ...address }).taxNumber !== undefined, true);
  });

  it('yabancı: uyruk ve pasaport zorunlu; UBL kimliği 11111111111; e-Fatura olamaz', () => {
    const buyer = { type: 'FOREIGN', firstName: 'Hans', lastName: 'Müller', nationality: 'DE', passportNo: 'C01X00T47', district: 'Mitte', city: 'Berlin', country: 'Almanya' };
    assert.deepEqual(invoiceBuyerProblems(buyer), {});
    assert.deepEqual(invoiceBuyerId(buyer), { scheme: 'TCKN', value: '11111111111' });
    assert.equal(chooseInvoiceDocumentType({ buyer, registered: true, aliases: ['urn:mail:x@y'] }), 'E_ARSIV');
    assert.deepEqual(Object.keys(invoiceBuyerProblems({ ...buyer, passportNo: null, nationality: '' })).sort(), ['nationality', 'passportNo']);
  });

  it('yabancı şirket (tur operatörü): Türk VKN gerekmez; UBL kimliği 2222222222; e-Fatura olamaz; Türkiye adresiyle olmaz', () => {
    const buyer = { type: 'FOREIGN_COMPANY', name: 'Sunway Reisen GmbH', foreignTaxId: 'DE298765431', district: 'Innenstadt', city: 'Köln', country: 'Almanya' };
    assert.deepEqual(invoiceBuyerProblems(buyer), {});
    assert.deepEqual(invoiceBuyerProblems({ ...buyer, foreignTaxId: null }), {}, 'kendi vergi no isteğe bağlı');
    assert.deepEqual(invoiceBuyerId(buyer), { scheme: 'VKN', value: '2222222222' });
    assert.equal(chooseInvoiceDocumentType({ buyer, registered: true, aliases: ['urn:mail:x@y'] }), 'E_ARSIV');
    assert.equal(invoiceBuyerName(buyer), 'Sunway Reisen GmbH');
    assert.deepEqual(Object.keys(invoiceBuyerProblems({ ...buyer, name: ' ', country: 'TÜRKİYE' })).sort(), ['country', 'name']);
  });

  it('e-Fatura yalnız kayıtlı mükellefe ve posta kutusu varsa', () => {
    const company = { type: 'COMPANY', name: 'X', taxNumber: '1234567890' };
    assert.equal(chooseInvoiceDocumentType({ buyer: company, registered: true, aliases: ['urn:mail:defaultpk@x.com'] }), 'E_FATURA');
    assert.equal(chooseInvoiceDocumentType({ buyer: company, registered: true, aliases: [] }), 'E_ARSIV');
    assert.equal(chooseInvoiceDocumentType({ buyer: company, registered: false, aliases: [] }), 'E_ARSIV');
    assert.deepEqual(invoiceBuyerId(company), { scheme: 'VKN', value: '1234567890' });
  });
});

describe('karekod ve yazıyla tutar', () => {
  it('karekod alanları GİB kılavuzundaki adlarla; KDV oran başına; dövizde uygulanan kur', () => {
    const { lines } = buildInvoiceLines({ charges: [night('2026-10-12')], taxCodes: TAX_CODES });
    const totals = invoiceTotals(lines);
    const payload = invoiceQrPayload({ sellerId: '1234567890', buyerId: '10000000146', documentType: 'E_ARSIV', issueDate: '2026-10-15', number: 'EAR2026000000007', uuid: '04e26a62-7c00-46d0-878c-6f7c60834525', currency: 'TRY', totals });
    assert.deepEqual(Object.keys(payload), ['vkntckn', 'avkntckn', 'senaryo', 'tip', 'tarih', 'no', 'ettn', 'parabirimi', 'malhizmettoplam', 'kdvmatrah(10)', 'hesaplanankdv(10)', 'vergidahil', 'odenecek']);
    assert.deepEqual([payload.senaryo, payload.tip, payload.malhizmettoplam, payload['kdvmatrah(10)'], payload['hesaplanankdv(10)'], payload.vergidahil], ['EARSIVFATURA', 'SATIS', '1000.00', '1000.00', '100.00', '1120.00']);
    const euro = invoiceQrPayload({ sellerId: '1', buyerId: '2', documentType: 'E_FATURA', issueDate: '2026-10-15', number: 'X', uuid: 'u', currency: 'EUR', exchangeRate: '36.5', totals });
    assert.equal(euro.uygulanankur, '36.5');
    assert.equal(euro.senaryo, 'TEMELFATURA');
  });

  it('Türkçe sayı kuralları: "bin" ("bir bin" değil), "yüz"; kuruş ayrı', () => {
    assert.equal(integerInWordsTr(1000n), 'bin');
    assert.equal(integerInWordsTr(1100n), 'bin yüz');
    assert.equal(integerInWordsTr(2_001_000n), 'iki milyon bin');
    assert.equal(integerInWordsTr(1_000_000n), 'bir milyon');
    assert.equal(integerInWordsTr(999n), 'dokuz yüz doksan dokuz');
    assert.equal(amountInWordsTr('1234.15', 'TRY'), 'Yalnız bin iki yüz otuz dört Türk lirası on beş kuruş');
    assert.equal(amountInWordsTr('2100.05', 'EUR'), 'Yalnız iki bin yüz avro beş sent');
    assert.equal(amountInWordsTr('0.50', 'TRY'), 'Yalnız sıfır Türk lirası elli kuruş');
  });
});

describe('süre ve yeniden deneme', () => {
  it('hizmetin son gününden 7 gün; geçince gecikmiş', () => {
    assert.deepEqual(invoiceDeadline('2026-10-14', '2026-10-20'), { deadline: '2026-10-21', daysLeft: 1, overdue: false });
    assert.deepEqual(invoiceDeadline('2026-10-14', '2026-10-22'), { deadline: '2026-10-21', daysLeft: -1, overdue: true });
  });

  it('artan aralıklar; hak bitince null', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    assert.equal(edocRetryAt(1, now).getTime() - now.getTime(), EDOC_RETRY_DELAYS_MS[0]);
    assert.equal(edocRetryAt(EDOC_RETRY_DELAYS_MS.length, now).getTime() - now.getTime(), EDOC_RETRY_DELAYS_MS.at(-1));
    assert.equal(edocRetryAt(EDOC_RETRY_DELAYS_MS.length + 1, now), null);
  });
});

describe('şemalar', () => {
  const settings = {
    legalName: 'Demo Otel Turizm A.Ş.',
    taxNumber: '1234567890',
    taxOffice: 'Çankaya',
    street: 'Atatürk Bulvarı 1',
    district: 'Çankaya',
    city: 'Ankara',
    eFaturaPrefix: 'ftr',
    eArsivPrefix: 'EAR',
    provider: 'TEST',
    environment: 'TEST',
    startDate: '2026-11-01',
    taxCodes: [],
  };

  it('ayar: seriler büyük harfe çevrilir, farklı olmalı; test entegratörüyle canlı ortam olmaz; geçersiz VKN reddedilir', () => {
    const parsed = invoiceSettingsSchema.parse(settings);
    assert.equal(parsed.eFaturaPrefix, 'FTR');
    assert.equal(parsed.country, 'Türkiye');
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, eArsivPrefix: 'FTR' }).success, false);
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, environment: 'LIVE' }).success, false);
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, taxNumber: '1234567891' }).success, false);
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, eFaturaPrefix: 'FT' }).success, false);
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, startDate: undefined }).success, false, 'faturalama başlangıcı zorunlu');
    assert.equal(invoiceSettingsSchema.safeParse({ ...settings, startDate: '2026-02-30' }).success, false);
  });

  it('taslak: kaynağa göre alanlar; serbest faturada en az bir satır ve vergi kategorisi', () => {
    assert.equal(invoiceDraftCreateSchema.safeParse({ source: 'FOLIO', folioId: '7b0c4b6e-2a7c-4c8e-9b55-1c4c1f0f2a11' }).success, true);
    assert.equal(invoiceDraftCreateSchema.safeParse({ source: 'MANUAL', ledgerAccountId: '7b0c4b6e-2a7c-4c8e-9b55-1c4c1f0f2a11', lines: [] }).success, false);
    const manual = invoiceDraftCreateSchema.parse({
      source: 'MANUAL',
      ledgerAccountId: '7b0c4b6e-2a7c-4c8e-9b55-1c4c1f0f2a11',
      lines: [{ description: 'Toplantı salonu', quantity: '2', unitAmount: '1500', taxCategory: 'OTHER' }],
    });
    assert.equal(manual.lines[0].unitCode, 'C62');
    assert.equal(invoiceDraftCreateSchema.safeParse({ source: 'OTHER' }).success, false);
  });

  it('iptal gerekçesi en az 5 karakter; test mükellefi etiketi urn:mail biçiminde', () => {
    assert.equal(invoiceCancelSchema.safeParse({ reason: 'yok' }).success, false);
    assert.equal(testTaxpayerSchema.safeParse({ taxNumber: '1234567890', title: 'Demir Holding', alias: 'urn:mail:defaultpk@demir.com.tr' }).success, true);
    assert.equal(testTaxpayerSchema.safeParse({ taxNumber: '1234567890', title: 'Demir Holding', alias: 'defaultpk@demir' }).success, false);
  });
});
