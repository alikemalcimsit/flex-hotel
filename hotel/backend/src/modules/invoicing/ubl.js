import {
  INVOICE_PROFILE_IDS,
  INVOICE_TYPE_CODE,
  UBL_TR_CUSTOMIZATION_ID,
  UBL_VERSION_ID,
  amountInWordsTr,
  invoiceBuyerId,
  invoiceBuyerName,
  isCompanyBuyer,
} from '@hotelos/hotel-contracts';

/**
 * UBL-TR fatura belgesi (modül 49). Saf: veritabanına dokunmaz, birim testlidir.
 *
 * - Eleman sırası UBL 2.1 şemasındaki sıradır (şema sıra dışı elemanı reddeder).
 * - İmza (`UBLExtensions` içi) entegratörün işidir: boş uzantı bırakılır, `cac:Signature` satıcının VKN'siyle.
 * - Tutarlar 2 ondalık; oranlar yalın ("10", "2", "0").
 * - Satır iskontosu (`AllowanceCharge`) satır tutarından düşülmüş olarak gelir: `LineExtensionAmount` = miktar ×
 *   fiyat − iskonto; belge toplamı satır tutarlarının toplamıdır (belge düzeyinde iskonto yok).
 * - Yabancı uyruklu alıcı: kimlik 11111111111, `Person/NationalityID`; pasaport no not satırında.
 */

/** @param {unknown} value */
export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Boş değerde hiç yazılmayan basit eleman. @param {string} name @param {unknown} value @param {string} [attributes] */
const el = (name, value, attributes = '') => (value === null || value === undefined || value === '' ? '' : `<${name}${attributes}>${xmlEscape(value)}</${name}>`);
/** @param {string} currency */
const amountAttr = (currency) => ` currencyID="${xmlEscape(currency)}"`;

/**
 * @param {{ street?: string | null, district?: string | null, city?: string | null, postalCode?: string | null, country?: string | null }} address
 */
function postalAddress(address) {
  return (
    '<cac:PostalAddress>' +
    el('cbc:StreetName', address.street) +
    el('cbc:CitySubdivisionName', address.district) +
    el('cbc:CityName', address.city) +
    el('cbc:PostalZone', address.postalCode) +
    `<cac:Country>${el('cbc:Name', address.country)}</cac:Country>` +
    '</cac:PostalAddress>'
  );
}

/** Ad soyad: son sözcük soyad (11 haneli satıcı / alıcı kişide). @param {string} name */
function personName(name) {
  const parts = name.trim().split(/\s+/);
  return { first: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] ?? '', family: parts.length > 1 ? parts.at(-1) : '' };
}

/**
 * @param {{ code: string, name: string, rate: string, base: string, amount: string, exemptionCode?: string | null, exemptionReason?: string | null }} tax
 * @param {string} currency
 */
function taxSubtotal(tax, currency) {
  return (
    '<cac:TaxSubtotal>' +
    `<cbc:TaxableAmount${amountAttr(currency)}>${xmlEscape(tax.base)}</cbc:TaxableAmount>` +
    `<cbc:TaxAmount${amountAttr(currency)}>${xmlEscape(tax.amount)}</cbc:TaxAmount>` +
    `<cbc:Percent>${xmlEscape(tax.rate)}</cbc:Percent>` +
    '<cac:TaxCategory>' +
    el('cbc:TaxExemptionReasonCode', tax.exemptionCode) +
    el('cbc:TaxExemptionReason', tax.exemptionReason) +
    `<cac:TaxScheme>${el('cbc:Name', tax.name)}${el('cbc:TaxTypeCode', tax.code)}</cac:TaxScheme>` +
    '</cac:TaxCategory>' +
    '</cac:TaxSubtotal>'
  );
}

/**
 * @typedef {{
 *   legalName: string, taxNumber: string, taxOffice: string, mersisNo?: string | null, tradeRegistryNo?: string | null,
 *   street: string, district: string, city: string, postalCode?: string | null, country: string,
 *   phone?: string | null, email?: string | null, website?: string | null,
 * }} UblSeller
 */

/**
 * @param {{
 *   number: string, uuid: string, documentType: 'E_FATURA' | 'E_ARSIV', issueDate: string, issueTime: string,
 *   currency: string, exchangeRate?: string | null, serviceFrom?: string | null, serviceTo?: string | null,
 *   notes?: string[], seller: UblSeller, buyer: import('@hotelos/hotel-contracts').InvoiceBuyer,
 *   lines: Array<Pick<import('@hotelos/hotel-contracts').InvoiceLine, 'description' | 'quantity' | 'unitCode' | 'unitPrice' | 'gross' | 'discount' | 'net' | 'taxAmount' | 'taxes'>>,
 *   totals: ReturnType<typeof import('@hotelos/hotel-contracts').invoiceTotals>,
 * }} input
 * @returns {string}
 */
export function buildUblInvoice(input) {
  const { seller, buyer, currency, totals } = input;
  const sellerScheme = seller.taxNumber.length === 10 ? 'VKN' : 'TCKN';
  const buyerId = invoiceBuyerId(buyer);

  const notes = [amountInWordsTr(totals.payable, currency), ...(input.notes ?? [])].filter(Boolean);
  if (buyer.type === 'FOREIGN') notes.push(`Yabancı uyruklu alıcı · Uyruk: ${buyer.nationality ?? '—'} · Pasaport / belge no: ${buyer.passportNo ?? '—'}`);
  if (buyer.type === 'FOREIGN_COMPANY') notes.push(`Yurt dışındaki alıcı · Ülke: ${buyer.country ?? '—'}${buyer.foreignTaxId ? ` · Vergi no: ${buyer.foreignTaxId}` : ''}`);

  const supplierParty =
    '<cac:AccountingSupplierParty><cac:Party>' +
    el('cbc:WebsiteURI', seller.website) +
    `<cac:PartyIdentification><cbc:ID schemeID="${sellerScheme}">${xmlEscape(seller.taxNumber)}</cbc:ID></cac:PartyIdentification>` +
    (seller.mersisNo ? `<cac:PartyIdentification><cbc:ID schemeID="MERSISNO">${xmlEscape(seller.mersisNo)}</cbc:ID></cac:PartyIdentification>` : '') +
    (seller.tradeRegistryNo ? `<cac:PartyIdentification><cbc:ID schemeID="TICARETSICILNO">${xmlEscape(seller.tradeRegistryNo)}</cbc:ID></cac:PartyIdentification>` : '') +
    `<cac:PartyName>${el('cbc:Name', seller.legalName)}</cac:PartyName>` +
    postalAddress(seller) +
    `<cac:PartyTaxScheme><cac:TaxScheme>${el('cbc:Name', seller.taxOffice)}</cac:TaxScheme></cac:PartyTaxScheme>` +
    (seller.phone || seller.email ? `<cac:Contact>${el('cbc:Telephone', seller.phone)}${el('cbc:ElectronicMail', seller.email)}</cac:Contact>` : '') +
    (sellerScheme === 'TCKN' ? (() => {
      const name = personName(seller.legalName);
      return `<cac:Person>${el('cbc:FirstName', name.first)}${el('cbc:FamilyName', name.family)}</cac:Person>`;
    })() : '') +
    '</cac:Party></cac:AccountingSupplierParty>';

  const company = isCompanyBuyer(buyer);
  const customerParty =
    '<cac:AccountingCustomerParty><cac:Party>' +
    `<cac:PartyIdentification><cbc:ID schemeID="${buyerId.scheme}">${xmlEscape(buyerId.value)}</cbc:ID></cac:PartyIdentification>` +
    (company ? `<cac:PartyName>${el('cbc:Name', invoiceBuyerName(buyer))}</cac:PartyName>` : '') +
    postalAddress(buyer) +
    (company && buyer.taxOffice ? `<cac:PartyTaxScheme><cac:TaxScheme>${el('cbc:Name', buyer.taxOffice)}</cac:TaxScheme></cac:PartyTaxScheme>` : '') +
    (buyer.phone || buyer.email ? `<cac:Contact>${el('cbc:Telephone', buyer.phone)}${el('cbc:ElectronicMail', buyer.email)}</cac:Contact>` : '') +
    (company
      ? buyerId.scheme === 'TCKN'
        ? (() => {
            const name = personName(invoiceBuyerName(buyer));
            return `<cac:Person>${el('cbc:FirstName', name.first)}${el('cbc:FamilyName', name.family)}</cac:Person>`;
          })()
        : ''
      : `<cac:Person>${el('cbc:FirstName', buyer.firstName)}${el('cbc:FamilyName', buyer.lastName)}${buyer.type === 'FOREIGN' ? el('cbc:NationalityID', buyer.nationality) : ''}</cac:Person>`) +
    '</cac:Party></cac:AccountingCustomerParty>';

  const exchange =
    currency !== 'TRY' && input.exchangeRate
      ? `<cac:PricingExchangeRate><cbc:SourceCurrencyCode>${xmlEscape(currency)}</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>${xmlEscape(input.exchangeRate)}</cbc:CalculationRate></cac:PricingExchangeRate>`
      : '';

  const taxTotal =
    `<cac:TaxTotal><cbc:TaxAmount${amountAttr(currency)}>${xmlEscape(totals.taxTotal)}</cbc:TaxAmount>` +
    totals.taxes.map((tax) => taxSubtotal(tax, currency)).join('') +
    '</cac:TaxTotal>';

  const monetary =
    '<cac:LegalMonetaryTotal>' +
    `<cbc:LineExtensionAmount${amountAttr(currency)}>${xmlEscape(totals.lineExtension)}</cbc:LineExtensionAmount>` +
    `<cbc:TaxExclusiveAmount${amountAttr(currency)}>${xmlEscape(totals.taxExclusive)}</cbc:TaxExclusiveAmount>` +
    `<cbc:TaxInclusiveAmount${amountAttr(currency)}>${xmlEscape(totals.taxInclusive)}</cbc:TaxInclusiveAmount>` +
    `<cbc:PayableAmount${amountAttr(currency)}>${xmlEscape(totals.payable)}</cbc:PayableAmount>` +
    '</cac:LegalMonetaryTotal>';

  const lines = input.lines
    .map((line, index) => {
      const hasDiscount = line.discount !== '0.00';
      // İskontolu satır 1 × brüt fiyat, iskonto ayrıca; iskontosuz satır miktar × birim fiyat.
      const price = hasDiscount ? line.gross : line.unitPrice;
      return (
        '<cac:InvoiceLine>' +
        `<cbc:ID>${index + 1}</cbc:ID>` +
        `<cbc:InvoicedQuantity unitCode="${xmlEscape(line.unitCode)}">${xmlEscape(hasDiscount ? '1' : line.quantity)}</cbc:InvoicedQuantity>` +
        `<cbc:LineExtensionAmount${amountAttr(currency)}>${xmlEscape(line.net)}</cbc:LineExtensionAmount>` +
        (hasDiscount
          ? '<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator>' +
            `<cbc:Amount${amountAttr(currency)}>${xmlEscape(line.discount)}</cbc:Amount>` +
            `<cbc:BaseAmount${amountAttr(currency)}>${xmlEscape(line.gross)}</cbc:BaseAmount></cac:AllowanceCharge>`
          : '') +
        `<cac:TaxTotal><cbc:TaxAmount${amountAttr(currency)}>${xmlEscape(line.taxAmount)}</cbc:TaxAmount>${line.taxes.map((tax) => taxSubtotal(tax, currency)).join('')}</cac:TaxTotal>` +
        `<cac:Item>${el('cbc:Name', line.description)}</cac:Item>` +
        `<cac:Price><cbc:PriceAmount${amountAttr(currency)}>${xmlEscape(price)}</cbc:PriceAmount></cac:Price>` +
        '</cac:InvoiceLine>'
      );
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"' +
    ' xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"' +
    ' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"' +
    ' xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">' +
    '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>' +
    el('cbc:UBLVersionID', UBL_VERSION_ID) +
    el('cbc:CustomizationID', UBL_TR_CUSTOMIZATION_ID) +
    el('cbc:ProfileID', INVOICE_PROFILE_IDS[input.documentType]) +
    el('cbc:ID', input.number) +
    '<cbc:CopyIndicator>false</cbc:CopyIndicator>' +
    el('cbc:UUID', input.uuid) +
    el('cbc:IssueDate', input.issueDate) +
    el('cbc:IssueTime', input.issueTime) +
    el('cbc:InvoiceTypeCode', INVOICE_TYPE_CODE) +
    notes.map((note) => el('cbc:Note', note)).join('') +
    el('cbc:DocumentCurrencyCode', currency) +
    el('cbc:LineCountNumeric', input.lines.length) +
    (input.serviceFrom && input.serviceTo ? `<cac:InvoicePeriod>${el('cbc:StartDate', input.serviceFrom)}${el('cbc:EndDate', input.serviceTo)}</cac:InvoicePeriod>` : '') +
    '<cac:Signature>' +
    `<cbc:ID schemeID="VKN_TCKN">${xmlEscape(seller.taxNumber)}</cbc:ID>` +
    `<cac:SignatoryParty><cac:PartyIdentification><cbc:ID schemeID="${sellerScheme}">${xmlEscape(seller.taxNumber)}</cbc:ID></cac:PartyIdentification>${postalAddress(seller)}</cac:SignatoryParty>` +
    `<cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#Signature_${xmlEscape(input.number)}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>` +
    '</cac:Signature>' +
    supplierParty +
    customerParty +
    exchange +
    taxTotal +
    monetary +
    lines +
    '</Invoice>'
  );
}
