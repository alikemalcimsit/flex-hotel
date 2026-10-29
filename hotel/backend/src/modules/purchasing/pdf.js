import { KITCHEN_UNIT_LABELS, PURCHASE_ORDER_STATUS_LABELS, utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';
import { getHotelSettings } from '../settings/service.js';
import { getOrder } from './orders.js';

/**
 * Satın alma siparişi PDF'i (modül 45): tedarikçiye gönderilen belge. Her istekte güncel siparişten
 * üretilir (saklanmaz); onaysız / kapanmış siparişin üstünde durumu yazar, tedarikçiye gönderilmemesi
 * gerektiği açıkça görünür.
 */

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trQuantity = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
const trPrice = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** @param {string} amount @param {string} currency */
const moneyText = (amount, currency) => `${trMoney.format(Number(amount))} ${currency}`;
/** "2026-11-20" → "20.11.2026" @param {string | null} day */
const dayText = (day) => (day ? day.slice(0, 10).split('-').reverse().join('.') : '—');
/** Tedarikçiye gönderilebilen durumlar; diğerlerinde belgenin üstüne durum yazılır. */
const SENDABLE_STATUSES = Object.freeze(['APPROVED', 'PARTIALLY_RECEIVED']);

/**
 * @param {string} hotelId @param {string} orderId
 * @returns {Promise<{ buffer: Buffer, fileName: string }>}
 */
export async function renderOrderPdf(hotelId, orderId) {
  const [order, hotel] = await Promise.all([getOrder(hotelId, orderId), getHotelSettings(hotelId)]);
  const issuedDay = utcToZonedWallTime(order.createdAt, hotel.timezone).slice(0, 10);
  const buffer = await renderPdf({
    info: { Title: `Satın alma siparişi ${order.number}`, Author: hotel.name, Subject: order.supplier.name },
    draw: (w) => draw(w, { order, hotel, issuedDay }),
    footer: (doc) => footer(doc, order),
  });
  return { buffer, fileName: `${order.number}.pdf` };
}

/** @param {import('../../lib/pdf-writer.js').Writer} w @param {{ order: any, hotel: any, issuedDay: string }} input */
function draw(w, { order, hotel, issuedDay }) {
  const { doc } = w;
  const currency = order.currency;
  const rightWidth = 210;
  const top = w.y;
  w.bold(SIZE.title, COLOR.accent);
  doc.text(hotel.name, w.left, top, { width: w.width - rightWidth - 10 });
  let leftY = top + doc.heightOfString(hotel.name, { width: w.width - rightWidth - 10 }) + 2;
  w.regular(SIZE.small, COLOR.muted);
  for (const line of [hotel.address, [hotel.phone, hotel.email].filter(Boolean).join(' · ')].filter(Boolean)) {
    doc.text(line, w.left, leftY, { width: w.width - rightWidth - 10 });
    leftY += doc.heightOfString(line, { width: w.width - rightWidth - 10 }) + 1;
  }
  const rightX = w.left + w.width - rightWidth;
  w.bold(SIZE.title);
  doc.text('Satın Alma Siparişi', rightX, top, { width: rightWidth, align: 'right' });
  let rightY = top + doc.heightOfString('Satın Alma Siparişi', { width: rightWidth }) + 2;
  w.regular();
  for (const line of [`No: ${order.number}`, `Tarih: ${dayText(issuedDay)}`, `Beklenen teslim: ${dayText(order.expectedOn)}`, ...(order.round ? [`Teklif turu: ${order.round.number}`] : [])]) {
    doc.text(line, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY += 11;
  }
  w.y = Math.max(leftY, rightY) + 6;
  doc.moveTo(w.left, w.y).lineTo(w.left + w.width, w.y).lineWidth(1.2).strokeColor(COLOR.accent).stroke();
  w.gap(12);

  if (!SENDABLE_STATUSES.includes(order.status)) {
    w.paragraph(`DURUM: ${PURCHASE_ORDER_STATUS_LABELS[order.status].toLocaleUpperCase('tr-TR')} — bu belge tedarikçiye gönderilmez.`, { bold: true, color: '#b91c1c' });
    w.gap();
  }

  w.heading('Tedarikçi');
  w.pairs([
    ['Unvan', order.supplier.name],
    ['Kod', order.supplier.code],
    ['Yetkili', order.supplier.contactName],
    ['Telefon', order.supplier.phone],
    ['E-posta', order.supplier.email],
    ['Vergi dairesi / no', [order.supplier.taxOffice, order.supplier.taxNumber].filter(Boolean).join(' / ') || null],
    ['Adres', order.supplier.address],
    ['Ödeme vadesi', `Teslimden itibaren ${order.paymentTermDays} gün`],
  ]);
  w.gap();

  w.heading('Sipariş kalemleri');
  w.table(
    [
      { label: '#', width: 22, align: 'right' },
      { label: 'Kod', width: 60 },
      { label: 'Malzeme', width: 170 },
      { label: 'Miktar', width: 60, align: 'right' },
      { label: 'Birim', width: 40 },
      { label: 'Birim fiyat', width: 75, align: 'right' },
      { label: 'KDV %', width: 40, align: 'right' },
      { label: `Tutar (${currency})`, width: 80, align: 'right' },
    ],
    order.lines.map((line, index) => [
      String(index + 1),
      line.code ?? '—',
      line.name,
      trQuantity.format(Number(line.quantity)),
      KITCHEN_UNIT_LABELS[line.unit] ?? line.unit,
      trPrice.format(Number(line.unitPrice)),
      trQuantity.format(Number(line.taxRatePct)),
      trMoney.format(Number(line.netAmount)),
    ]),
  );
  w.gap(10);
  w.totals([
    { label: 'KDV hariç toplam', value: moneyText(order.netTotal, currency) },
    { label: 'KDV', value: moneyText(order.taxTotal, currency) },
    { label: 'Genel toplam', value: moneyText(order.grandTotal, currency), strong: true },
  ]);
  w.gap(14);

  w.heading('Notlar');
  w.paragraph(
    [
      'Fiyatlar KDV hariçtir; KDV satır bazında hesaplanmıştır.',
      'Lütfen irsaliyede sipariş numarasını belirtiniz. Teslimat, sipariş miktarını aşmamalıdır (tartılan ürünlerde en fazla %5 fark kabul edilir).',
      ...(order.note ? [order.note] : []),
    ].join('\n'),
    { size: SIZE.small, color: COLOR.muted },
  );
}

/** @param {any} doc @param {any} order */
function footer(doc, order) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - PAGE.margin - 10;
    const width = doc.page.width - PAGE.margin * 2;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
    doc.text(`Satın alma siparişi ${order.number} · ${order.supplier.name}`, PAGE.margin, y, { width: width / 2, lineBreak: false });
    doc.text(`Sayfa ${index - range.start + 1} / ${range.count}`, PAGE.margin + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}
