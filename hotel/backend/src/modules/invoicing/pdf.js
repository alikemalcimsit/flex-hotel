import qrcode from 'qrcode-generator';
import {
  INVOICE_BUYER_TYPE_LABELS,
  INVOICE_DOCUMENT_TYPE_LABELS,
  INVOICE_PROFILE_IDS,
  INVOICE_UNIT_LABELS,
  amountInWordsTr,
  invoiceBuyerId,
  invoiceBuyerName,
  invoiceQrPayload,
  isCompanyBuyer,
  invoiceTotals,
} from '@hotelos/hotel-contracts';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';
import { getInvoice } from './invoices.js';
import { clockTime, loadInvoiceSettings, prisma } from './shared.js';

/**
 * Fatura görüntüsü (PDF; modül 16 / 49). Kesilmiş faturada GİB karekodu (Karekod Standardı Kılavuzu v1.1),
 * ETTN, senaryo ve tip; taslakta "TASLAK", iptal edilmişte "İPTAL", test ortamında "mali değeri yoktur"
 * uyarısı. Resmî görüntü entegratörün ürettiğidir; bu belge otelin kendi kopyası ve taslak önizlemesidir.
 */

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trQuantity = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
/** @param {string} amount @param {string} currency */
const moneyText = (amount, currency) => `${trMoney.format(Number(amount))} ${currency}`;
/** @param {string | null | undefined} text */
const dayText = (text) => (text ? text.slice(0, 10).split('-').reverse().join('.') : '—');

/** Karekodun kenarı (pt). */
const QR_SIZE = 84;

/**
 * Karekodu dikdörtgenlerle çizer (satırdaki ardışık koyu modüller tek dikdörtgen).
 * @param {any} doc @param {string} text @param {number} x @param {number} y @param {number} size
 */
function drawQr(doc, text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  doc.save().fillColor('#000000');
  for (let row = 0; row < count; row += 1) {
    let start = -1;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && qr.isDark(row, column);
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        doc.rect(x + start * cell, y + row * cell, (column - start) * cell + 0.05, cell + 0.05).fill();
        start = -1;
      }
    }
  }
  doc.restore();
}

/**
 * @param {string} hotelId @param {string} invoiceId
 * @returns {Promise<{ buffer: Buffer, fileName: string }>}
 */
export async function renderInvoicePdf(hotelId, invoiceId) {
  const [detail, settings, hotel] = await Promise.all([getInvoice(hotelId, invoiceId), loadInvoiceSettings(prisma, hotelId), prisma.hotel.findFirst({ where: { id: hotelId }, select: { name: true, timezone: true } })]);
  const { invoice } = detail;
  const title = invoice.number ?? `TASLAK-${invoice.uuid.slice(0, 8)}`;
  const buffer = await renderPdf({
    info: { Title: `Fatura ${title}`, Author: settings?.legalName ?? hotel?.name ?? '', Subject: invoice.buyerName ?? '' },
    draw: (w) => draw(w, { detail, settings, hotelName: hotel?.name ?? '', timezone: hotel?.timezone ?? 'Europe/Istanbul' }),
    footer: (doc) => footer(doc, invoice),
  });
  return { buffer, fileName: `${title}.pdf` };
}

/** @param {import('../../lib/pdf-writer.js').Writer} w @param {{ detail: Awaited<ReturnType<typeof getInvoice>>, settings: any, hotelName: string, timezone: string }} input */
function draw(w, { detail, settings, hotelName, timezone }) {
  const { doc } = w;
  const { invoice, lines } = detail;
  const buyer = /** @type {any} */ (invoice.buyer);
  const currency = invoice.currency;
  const issued = invoice.status !== 'DRAFT';
  const totals = invoiceTotals(lines.map((line) => ({ gross: line.gross, discount: line.discount, net: line.net, taxAmount: line.taxAmount, total: line.total, taxes: /** @type {any} */ (line.taxes) })));

  // Üst: satıcı (sol), belge bilgisi + karekod (sağ).
  const top = w.y;
  const rightWidth = 190;
  const leftWidth = w.width - rightWidth - QR_SIZE - 20;
  w.bold(SIZE.title - 3, COLOR.accent);
  const sellerName = settings?.legalName ?? hotelName;
  doc.text(sellerName, w.left, top, { width: leftWidth });
  let leftY = top + doc.heightOfString(sellerName, { width: leftWidth }) + 3;
  w.regular(SIZE.small, COLOR.text);
  const sellerLines = settings
    ? [
        [settings.street, `${settings.district} / ${settings.city}`, settings.postalCode].filter(Boolean).join(' · '),
        `Vergi dairesi: ${settings.taxOffice} · ${settings.taxNumber.length === 10 ? 'VKN' : 'TCKN'}: ${settings.taxNumber}`,
        settings.mersisNo ? `MERSİS: ${settings.mersisNo}` : null,
        settings.tradeRegistryNo ? `Ticaret sicil: ${settings.tradeRegistryNo}` : null,
        [settings.phone, settings.email, settings.website].filter(Boolean).join(' · ') || null,
      ].filter(Boolean)
    : ['Fatura ayarları girilmemiş'];
  for (const line of /** @type {string[]} */ (sellerLines)) {
    doc.text(line, w.left, leftY, { width: leftWidth });
    leftY += doc.heightOfString(line, { width: leftWidth }) + 1;
  }

  const rightX = w.left + leftWidth + 10;
  w.bold(SIZE.title - 2, COLOR.text);
  const heading = issued ? (INVOICE_DOCUMENT_TYPE_LABELS[/** @type {'E_FATURA' | 'E_ARSIV'} */ (invoice.documentType)] ?? 'Fatura').toLocaleUpperCase('tr-TR') : 'FATURA TASLAĞI';
  doc.text(heading, rightX, top, { width: rightWidth, align: 'right' });
  let rightY = top + doc.heightOfString(heading, { width: rightWidth }) + 3;
  w.regular(SIZE.small, COLOR.text);
  const meta = [
    ['Fatura no', invoice.number ?? '—'],
    ['Tarih', issued ? `${dayText(invoice.issueDate)} ${invoice.issuedAt ? clockTime(new Date(invoice.issuedAt), timezone).slice(0, 5) : ''}`.trim() : '—'],
    ['Senaryo', issued ? INVOICE_PROFILE_IDS[/** @type {'E_FATURA' | 'E_ARSIV'} */ (invoice.documentType)] : '—'],
    ['Fatura tipi', 'SATIŞ'],
    ['ETTN', invoice.uuid],
  ];
  for (const [label, value] of meta) {
    const text = `${label}: ${value}`;
    doc.text(text, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY += doc.heightOfString(text, { width: rightWidth }) + 1;
  }
  if (issued && settings) {
    const payload = invoiceQrPayload({
      sellerId: settings.taxNumber,
      buyerId: invoiceBuyerId(buyer).value,
      documentType: /** @type {'E_FATURA' | 'E_ARSIV'} */ (invoice.documentType),
      issueDate: /** @type {string} */ (invoice.issueDate),
      number: /** @type {string} */ (invoice.number),
      uuid: invoice.uuid,
      currency,
      totals,
    });
    drawQr(doc, JSON.stringify(payload), w.left + w.width - QR_SIZE, top, QR_SIZE);
  }
  w.y = Math.max(leftY, rightY, top + (issued ? QR_SIZE : 0)) + 6;
  doc.moveTo(w.left, w.y).lineTo(w.left + w.width, w.y).lineWidth(1.2).strokeColor(COLOR.accent).stroke();
  w.gap(10);

  const banners = [];
  if (invoice.status === 'DRAFT') banners.push('TASLAK — kesilmemiş faturadır, geçerli belge değildir.');
  if (invoice.status === 'CANCELLED') banners.push(`İPTAL EDİLDİ — ${dayText(invoice.cancelledAt)}${invoice.cancelReason ? ` · ${invoice.cancelReason}` : ''}`);
  if (invoice.status === 'CANCEL_PENDING') banners.push('İPTAL ONAYI BEKLİYOR');
  if (invoice.edocEnvironment === 'TEST' || (!issued && settings?.environment === 'TEST')) banners.push("TEST ORTAMI — GİB'e gönderilmemiştir, mali değeri yoktur.");
  for (const banner of banners) {
    w.paragraph(banner, { bold: true, color: '#b91c1c' });
  }
  if (banners.length) w.gap(6);

  w.heading('Sayın');
  const id = invoiceBuyerId(buyer);
  w.pairs([
    ['Alıcı', invoiceBuyerName(buyer)],
    ['Tür', INVOICE_BUYER_TYPE_LABELS[/** @type {'PERSON' | 'COMPANY' | 'FOREIGN' | 'FOREIGN_COMPANY'} */ (buyer.type)] ?? null],
    [buyer.type === 'FOREIGN' ? 'Uyruk / pasaport' : id.scheme, buyer.type === 'FOREIGN' ? `${buyer.nationality ?? '—'} / ${buyer.passportNo ?? '—'}` : id.value || '—'],
    ['Yabancı vergi no', buyer.type === 'FOREIGN_COMPANY' ? buyer.foreignTaxId : null],
    [buyer.type === 'FOREIGN_COMPANY' ? 'Vergi makamı' : 'Vergi dairesi', isCompanyBuyer(buyer) ? buyer.taxOffice : null],
    ['Adres', [buyer.street, [buyer.district, buyer.city].filter(Boolean).join(' / '), buyer.postalCode, buyer.country].filter(Boolean).join(' · ') || null],
    ['E-posta / telefon', [buyer.email, buyer.phone].filter(Boolean).join(' · ') || null],
    ['Posta kutusu', invoice.receiverAlias],
  ]);
  w.gap();

  w.heading('Mal / hizmet');
  w.table(
    [
      { label: '#', width: 20, align: 'right' },
      { label: 'Açıklama', width: 170 },
      { label: 'Miktar', width: 52, align: 'right' },
      { label: 'Birim fiyat', width: 66, align: 'right' },
      { label: 'İskonto', width: 54, align: 'right' },
      { label: 'Vergiler', width: 92 },
      { label: `Tutar (${currency})`, width: 70, align: 'right' },
    ],
    lines.map((line, index) => [
      String(index + 1),
      line.description,
      `${trQuantity.format(Number(line.quantity))} ${INVOICE_UNIT_LABELS[/** @type {keyof typeof INVOICE_UNIT_LABELS} */ (line.unitCode)] ?? line.unitCode}`,
      trMoney.format(Number(line.discount !== '0.00' ? line.gross : line.unitPrice)),
      line.discount !== '0.00' ? trMoney.format(Number(line.discount)) : '—',
      /** @type {any[]} */ (line.taxes).map((tax) => `${tax.name} %${tax.rate}${tax.exemptionCode ? ` (${tax.exemptionCode})` : ''}`).join(', '),
      trMoney.format(Number(line.net)),
    ]),
  );
  w.gap(10);
  w.totals([
    { label: 'Mal / hizmet toplamı', value: moneyText(totals.gross, currency) },
    ...(totals.discount !== '0.00' ? [{ label: 'Toplam iskonto', value: moneyText(totals.discount, currency) }] : []),
    { label: 'Vergi matrahı', value: moneyText(totals.lineExtension, currency) },
    ...totals.taxes.map((tax) => ({ label: `${tax.name} %${tax.rate} (matrah ${trMoney.format(Number(tax.base))})`, value: moneyText(tax.amount, currency) })),
    { label: 'Vergiler dahil toplam', value: moneyText(totals.taxInclusive, currency) },
    { label: 'Ödenecek tutar', value: moneyText(totals.payable, currency), strong: true },
  ]);
  w.gap(8);
  w.paragraph(amountInWordsTr(totals.payable, currency), { size: SIZE.small, bold: true });
  w.gap(10);

  const notes = [
    invoice.note,
    invoice.serviceFrom && invoice.serviceTo ? `Hizmet dönemi: ${dayText(invoice.serviceFrom)} – ${dayText(invoice.serviceTo)}` : null,
    settings?.footerNote,
    settings?.bankInfo,
    invoice.documentType === 'E_ARSIV' ? 'e-Arşiv izni kapsamında elektronik ortamda iletilmiştir.' : null,
  ].filter(Boolean);
  if (notes.length) {
    w.heading('Notlar');
    w.paragraph(notes.join('\n'), { size: SIZE.small, color: COLOR.muted });
  }
}

/** @param {any} doc @param {any} invoice */
function footer(doc, invoice) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - PAGE.margin - 10;
    const width = doc.page.width - PAGE.margin * 2;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
    doc.text(`${invoice.number ?? 'Fatura taslağı'} · ETTN ${invoice.uuid}`, PAGE.margin, y, { width: width * 0.7, lineBreak: false });
    doc.text(`Sayfa ${index - range.start + 1} / ${range.count}`, PAGE.margin + width * 0.7, y, { width: width * 0.3, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}
