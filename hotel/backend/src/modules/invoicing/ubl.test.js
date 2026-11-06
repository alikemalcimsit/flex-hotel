import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildInvoiceLines, invoiceTotals } from '@hotelos/hotel-contracts';
import { buildUblInvoice, xmlEscape } from './ubl.js';

const TAX_CODES = new Map([
  ['kdv', { code: '0015', name: 'KDV' }],
  ['kv', { code: '0059', name: 'Konaklama vergisi' }],
]);

const SELLER = {
  legalName: 'Demo Otel Turizm A.Ş.',
  taxNumber: '1234567890',
  taxOffice: 'Çankaya',
  mersisNo: '0123456789012345',
  street: 'Atatürk Bulvarı No: 1',
  district: 'Çankaya',
  city: 'Ankara',
  postalCode: '06420',
  country: 'Türkiye',
  phone: '+90 312 000 00 00',
  email: 'muhasebe@demo-otel.test',
  website: 'https://demo-otel.test',
};

/** Etiket dengesi (iyi biçimlilik) ve eleman adları sırası. @param {string} xml */
function parse(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  const order = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z:]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (closing) assert.equal(stack.pop(), name, `kapanmayan eleman: ${name}`);
    else {
      order.push({ name, depth: stack.length });
      if (!selfClosing) stack.push(name);
    }
  }
  assert.equal(stack.length, 0, 'açık kalan eleman');
  return order;
}

/** Bir elemanın bütün metin değerleri. @param {string} xml @param {string} name */
const values = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'g'))].map((match) => match[1]);
const cents = (text) => Math.round(Number(text) * 100);

function sample({ buyer, charges }) {
  const { lines } = buildInvoiceLines({ charges, taxCodes: TAX_CODES });
  const totals = invoiceTotals(lines);
  return {
    xml: buildUblInvoice({
      number: 'EAR2026000000012',
      uuid: '04e26a62-7c00-46d0-878c-6f7c60834525',
      documentType: 'E_ARSIV',
      issueDate: '2026-11-01',
      issueTime: '14:05:09',
      currency: 'TRY',
      serviceFrom: '2026-10-12',
      serviceTo: '2026-10-14',
      notes: ['Oda 204 · Konaklama 12.10.2026 – 14.10.2026'],
      seller: SELLER,
      buyer,
      lines,
      totals,
    }),
    lines,
    totals,
  };
}

const night = (sign = 1) => ({ group: 'ROOM', description: 'Konaklama', net: String(1000 * sign), taxes: [{ taxId: 'kdv', rate: '10', amount: String(100 * sign) }, { taxId: 'kv', rate: '2', amount: String(20 * sign) }], quantity: '1', unitCode: 'DAY' });

describe('UBL-TR belgesi', () => {
  it('iyi biçimli; üst düzey eleman sırası UBL 2.1 şemasındaki gibi; senaryo, tip, numara, ETTN', () => {
    const { xml } = sample({
      buyer: { type: 'PERSON', firstName: 'Ayşe', lastName: 'Demir', taxNumber: '10000000146', district: 'Çankaya', city: 'Ankara', country: 'Türkiye' },
      charges: [night(), night()],
    });
    const top = parse(xml)
      .filter((entry) => entry.depth === 1)
      .map((entry) => entry.name);
    assert.deepEqual(top, [
      'ext:UBLExtensions',
      'cbc:UBLVersionID',
      'cbc:CustomizationID',
      'cbc:ProfileID',
      'cbc:ID',
      'cbc:CopyIndicator',
      'cbc:UUID',
      'cbc:IssueDate',
      'cbc:IssueTime',
      'cbc:InvoiceTypeCode',
      'cbc:Note',
      'cbc:Note',
      'cbc:DocumentCurrencyCode',
      'cbc:LineCountNumeric',
      'cac:InvoicePeriod',
      'cac:Signature',
      'cac:AccountingSupplierParty',
      'cac:AccountingCustomerParty',
      'cac:TaxTotal',
      'cac:LegalMonetaryTotal',
      'cac:InvoiceLine',
    ]);
    assert.deepEqual(values(xml, 'cbc:ProfileID'), ['EARSIVFATURA']);
    assert.deepEqual(values(xml, 'cbc:InvoiceTypeCode'), ['SATIS']);
    assert.equal(values(xml, 'cbc:Note')[0], 'Yalnız iki bin iki yüz kırk Türk lirası');
    assert.match(xml, /<cbc:ID schemeID="TCKN">10000000146<\/cbc:ID>/);
    assert.match(xml, /<cac:Person><cbc:FirstName>Ayşe<\/cbc:FirstName><cbc:FamilyName>Demir<\/cbc:FamilyName><\/cac:Person>/);
  });

  it('tutarlar tutarlı: satır tutarları = belge tutarı; vergi dökümü = vergi toplamı; ödenecek = vergiler dahil', () => {
    const { xml, totals } = sample({
      buyer: { type: 'COMPANY', name: 'Demir Holding A.Ş.', taxNumber: '1234567890', taxOffice: 'Kavaklıdere', district: 'Çankaya', city: 'Ankara', country: 'Türkiye' },
      charges: [night(), night(), night(), night(-1), { group: 'ROOM', description: 'Konaklama', discount: true, net: '-200', taxes: [{ taxId: 'kdv', rate: '10', amount: '-20' }, { taxId: 'kv', rate: '2', amount: '-4' }] }],
    });
    const monetary = xml.slice(xml.indexOf('<cac:LegalMonetaryTotal>'), xml.indexOf('</cac:LegalMonetaryTotal>'));
    const lineAmounts = values(xml.slice(xml.indexOf('<cac:InvoiceLine>')), 'cbc:LineExtensionAmount');
    assert.equal(lineAmounts.reduce((sum, value) => sum + cents(value), 0), cents(values(monetary, 'cbc:LineExtensionAmount')[0]));
    const documentTax = xml.slice(xml.indexOf('<cac:TaxTotal>'), xml.indexOf('<cac:LegalMonetaryTotal>'));
    const subtotalAmounts = values(documentTax, 'cbc:TaxAmount').slice(1);
    assert.equal(subtotalAmounts.reduce((sum, value) => sum + cents(value), 0), cents(values(documentTax, 'cbc:TaxAmount')[0]));
    assert.equal(values(monetary, 'cbc:PayableAmount')[0], totals.payable);
    assert.equal(totals.payable, '2016.00');
    // İskontolu satır: 1 × brüt fiyat, iskonto ayrı, satır tutarı brüt − iskonto.
    assert.match(xml, /<cbc:InvoicedQuantity unitCode="C62">1<\/cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">1800\.00<\/cbc:LineExtensionAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false<\/cbc:ChargeIndicator><cbc:Amount currencyID="TRY">200\.00<\/cbc:Amount><cbc:BaseAmount currencyID="TRY">2000\.00<\/cbc:BaseAmount><\/cac:AllowanceCharge>/);
    assert.match(xml, /<cbc:PriceAmount currencyID="TRY">2000\.00<\/cbc:PriceAmount>/);
    assert.match(xml, /<cac:PartyName><cbc:Name>Demir Holding A\.Ş\.<\/cbc:Name><\/cac:PartyName>/);
    assert.match(xml, /<cbc:TaxTypeCode>0059<\/cbc:TaxTypeCode>/);
  });

  it('yabancı uyruklu alıcı: 11111111111, uyruk kişide, pasaport notta; KDV\'siz satırda 351 muafiyet kodu', () => {
    const { xml } = sample({
      buyer: { type: 'FOREIGN', firstName: 'Hans', lastName: 'Müller', nationality: 'DE', passportNo: 'C01X00T47', district: 'Mitte', city: 'Berlin', country: 'Almanya' },
      charges: [{ group: 'OTHER', description: 'Transfer', net: '500', taxes: [] }],
    });
    assert.match(xml, /<cbc:ID schemeID="TCKN">11111111111<\/cbc:ID>/);
    assert.match(xml, /<cbc:NationalityID>DE<\/cbc:NationalityID>/);
    assert.ok(values(xml, 'cbc:Note').some((note) => note.includes('C01X00T47')));
    assert.match(xml, /<cbc:Percent>0<\/cbc:Percent><cac:TaxCategory><cbc:TaxExemptionReasonCode>351<\/cbc:TaxExemptionReasonCode>/);
  });

  it('yabancı şirket: 2222222222 VKN şemasıyla, ünvan; kişi öğesi yok; ülke ve kendi vergi no notta', () => {
    const { xml } = sample({
      buyer: { type: 'FOREIGN_COMPANY', name: 'Sunway Reisen GmbH', foreignTaxId: 'DE298765431', street: 'Hohenzollernring 12', district: 'Innenstadt', city: 'Köln', country: 'Almanya' },
      charges: [{ group: 'OTHER', description: 'Transfer', net: '500', taxes: [] }],
    });
    const customer = xml.slice(xml.indexOf('<cac:AccountingCustomerParty>'), xml.indexOf('</cac:AccountingCustomerParty>'));
    assert.match(customer, /<cbc:ID schemeID="VKN">2222222222<\/cbc:ID>/);
    assert.match(customer, /<cac:PartyName><cbc:Name>Sunway Reisen GmbH<\/cbc:Name><\/cac:PartyName>/);
    assert.doesNotMatch(customer, /<cac:Person>/);
    assert.doesNotMatch(customer, /<cac:PartyTaxScheme>/, 'vergi makamı boşsa yazılmaz');
    assert.ok(values(xml, 'cbc:Note').some((note) => note.includes('Ülke: Almanya') && note.includes('DE298765431')));
  });

  it('özel karakterler kaçırılır; boş isteğe bağlı alan yazılmaz', () => {
    assert.equal(xmlEscape(`A & B <"C">'`), 'A &amp; B &lt;&quot;C&quot;&gt;&apos;');
    const { xml } = sample({
      buyer: { type: 'COMPANY', name: 'Tom & Jerry <Ltd>', taxNumber: '1234567890', taxOffice: 'Kadıköy', street: null, district: 'Kadıköy', city: 'İstanbul', country: 'Türkiye' },
      charges: [night()],
    });
    parse(xml);
    assert.match(xml, /Tom &amp; Jerry &lt;Ltd&gt;/);
    const customer = xml.slice(xml.indexOf('<cac:AccountingCustomerParty>'), xml.indexOf('</cac:AccountingCustomerParty>'));
    assert.equal(customer.includes('<cbc:StreetName>'), false);
  });
});
