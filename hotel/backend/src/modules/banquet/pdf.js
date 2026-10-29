import {
  ALLERGEN_LABELS,
  EVENT_CLIENT_TYPE_LABELS,
  EVENT_DOCUMENT_KIND_LABELS,
  EVENT_ITEM_UNIT_LABELS,
  EVENT_TYPE_LABELS,
  VENUE_LAYOUT_LABELS,
  cancellationTierRanges,
} from '@hotelos/hotel-contracts';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';

export { splitLongLine } from '../../lib/pdf-writer.js';

/**
 * Etkinlik belgesinin PDF'i (modül 37): teklif, sözleşme, proforma.
 *
 * Belge **anlık görüntüden** (snapshot) çizilir: veritabanına dokunmaz, aynı görüntü
 * her zaman aynı belgeyi verir (sonradan kalem / fiyat değişse de üretilmiş sürüm
 * değişmez). Yazı tipi gömülüdür (DejaVu Sans): Türkçe harfler her görüntüleyicide
 * doğru çıkar. Uzun tablolar sayfaya bölünür, başlık satırı yeni sayfada tekrarlanır;
 * her sayfanın altında belge numarası ve "sayfa i / n" yazar.
 */

export const DOCUMENT_TITLES = Object.freeze({ OFFER: 'TEKLİF', CONTRACT: 'ETKİNLİK SÖZLEŞMESİ', PROFORMA: 'PROFORMA FATURA' });

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trNumber = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
/** "12345.6" → "12.345,60 TRY" @param {string} amount @param {string} currency */
export const moneyText = (amount, currency) => `${trMoney.format(Number(amount))} ${currency}`;
/** "2026-11-20" → "20.11.2026" @param {string | null} day */
export const dayText = (day) => (day ? day.slice(0, 10).split('-').reverse().join('.') : '—');
/** "2026-11-20T19:00" → "20.11.2026 19:00" @param {string} wall */
const wallText = (wall) => `${dayText(wall.slice(0, 10))} ${wall.slice(11, 16)}`;
/** Oturum saatleri: aynı günse "20.11.2026 19:00–23:30". */
const sessionRange = (startLocal, endLocal) =>
  startLocal.slice(0, 10) === endLocal.slice(0, 10) ? `${wallText(startLocal)}–${endLocal.slice(11, 16)}` : `${wallText(startLocal)} – ${wallText(endLocal)}`;

/**
 * Belge görüntüsünü PDF'e çizer.
 *
 * @param {import('./documents.js').DocumentSnapshot} snapshot
 * @returns {Promise<Buffer>}
 */
export function renderEventDocument(snapshot) {
  const title = DOCUMENT_TITLES[snapshot.kind];
  return renderPdf({
    info: { Title: `${title} ${snapshot.number}`, Author: snapshot.hotel.name, Subject: snapshot.event.name },
    draw: (writer) => draw(writer, snapshot, title),
    footer: (doc) => footer(doc, snapshot),
  });
}

/** @param {Writer} w @param {any} s @param {string} title */
function draw(w, s, title) {
  const { doc } = w;
  const currency = s.currency;

  // Başlık: solda otel, sağda belge.
  const rightWidth = 210;
  const top = w.y;
  w.bold(SIZE.title, COLOR.accent);
  doc.text(s.hotel.name, w.left, top, { width: w.width - rightWidth - 10 });
  let leftY = top + doc.heightOfString(s.hotel.name, { width: w.width - rightWidth - 10 }) + 2;
  w.regular(SIZE.small, COLOR.muted);
  for (const line of [s.hotel.address, [s.hotel.phone, s.hotel.email].filter(Boolean).join(' · ')].filter(Boolean)) {
    doc.text(line, w.left, leftY, { width: w.width - rightWidth - 10 });
    leftY += doc.heightOfString(line, { width: w.width - rightWidth - 10 }) + 1;
  }
  const rightX = w.left + w.width - rightWidth;
  w.bold(SIZE.title);
  doc.text(title, rightX, top, { width: rightWidth, align: 'right' });
  let rightY = top + doc.heightOfString(title, { width: rightWidth }) + 2;
  w.regular();
  const meta = [
    `No: ${s.number}${s.version > 1 ? ` · Sürüm ${s.version}` : ''}`,
    `Tarih: ${dayText(s.issuedDay)}`,
    ...(s.validUntil ? [`Geçerlilik: ${dayText(s.validUntil)}`] : []),
    `Dosya: ${s.event.code}`,
  ];
  for (const line of meta) {
    doc.text(line, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY += 11;
  }
  w.y = Math.max(leftY, rightY) + 6;
  doc.moveTo(w.left, w.y).lineTo(w.left + w.width, w.y).lineWidth(1.2).strokeColor(COLOR.accent).stroke();
  w.gap(12);

  w.heading('Müşteri');
  w.pairs([
    ['Ad / unvan', s.client.name],
    ['Tür', EVENT_CLIENT_TYPE_LABELS[s.client.type]],
    ['Yetkili', s.client.contactName],
    ['Telefon', s.client.phone],
    ['E-posta', s.client.email],
    ['Vergi dairesi / no', [s.client.taxOffice, s.client.taxNumber].filter(Boolean).join(' / ') || null],
    ['Adres', s.client.address],
  ]);
  w.gap();

  w.heading('Etkinlik');
  w.pairs([
    ['Etkinlik', s.event.name],
    ['Tür', EVENT_TYPE_LABELS[s.event.type]],
    ['Tahmini kişi', String(s.event.expectedPax)],
    ['Garanti kişi', s.event.guaranteedPax ? String(s.event.guaranteedPax) : null],
    ['Gerçekleşen kişi', s.event.actualPax !== null && s.event.actualPax !== undefined ? String(s.event.actualPax) : null],
    ['Faturalanan kişi', String(s.event.billablePax)],
  ]);
  w.gap();

  if (s.sessions.length) {
    w.heading('Program');
    w.table(
      [
        { label: 'Oturum', width: 150 },
        { label: 'Salon', width: 110 },
        { label: 'Düzen', width: 80 },
        { label: 'Tarih / saat', width: 140 },
        { label: 'Kişi', width: 45, align: 'right' },
      ],
      s.sessions.map((session) => [session.title, session.venueName, VENUE_LAYOUT_LABELS[session.layout], sessionRange(session.startLocal, session.endLocal), String(session.pax)]),
    );
    w.gap(10);
  }

  // Modül 43: menünün içeriği (eski anlık görüntülerde alan yok).
  if (s.menus?.length) {
    w.heading('Menü');
    for (const menu of s.menus) {
      w.paragraph(`${menu.name} · ${menu.sessionTitle} · ${wallText(menu.serveLocal)} · ${menu.guests} kişi`, { bold: true });
      for (const course of menu.courses) {
        const dishes = course.dishes.map((dish) => (course.mode === 'CHOICE' && dish.guestCount ? `${dish.name} (${dish.guestCount} kişi)` : dish.name));
        w.paragraph(`• ${course.name}${course.mode === 'CHOICE' ? ' (seçmeli)' : ''}: ${dishes.join(course.mode === 'CHOICE' ? ' / ' : ', ')}`);
      }
      const allergens = [...new Set(menu.courses.flatMap((course) => course.dishes.flatMap((dish) => dish.allergens)))];
      if (allergens.length) w.paragraph(`Alerjen içerir: ${allergens.map((allergen) => ALLERGEN_LABELS[allergen] ?? allergen).join(', ')}`, { size: SIZE.small, color: COLOR.muted });
      w.gap(4);
    }
    w.gap(6);
  }

  w.heading(s.kind === 'PROFORMA' && s.cancellation ? 'İptal bedeli' : 'Fiyat kalemleri');
  w.table(
    [
      { label: 'Açıklama', width: 200 },
      { label: 'Miktar', width: 55, align: 'right' },
      { label: 'Birim', width: 40 },
      { label: 'Birim fiyat', width: 80, align: 'right' },
      { label: 'İnd. %', width: 40, align: 'right' },
      { label: `Tutar (${currency})`, width: 95, align: 'right' },
    ],
    s.items.map((item) => [
      item.sessionTitle ? `${item.description}\n${item.sessionTitle}` : item.description,
      trNumber.format(Number(item.billedQuantity)),
      EVENT_ITEM_UNIT_LABELS[item.unit],
      trMoney.format(Number(item.unitPrice)),
      Number(item.discountPct) > 0 ? trNumber.format(Number(item.discountPct)) : '',
      trMoney.format(Number(item.total)),
    ]),
  );
  w.gap(6);
  w.totals([
    { label: 'Vergisiz toplam', value: moneyText(s.totals.netTotal, currency) },
    ...s.totals.taxes.map((tax) => ({ label: `${tax.name} %${trNumber.format(Number(tax.rate))}${tax.included ? ' (dahil)' : ''}`, value: moneyText(tax.amount, currency) })),
    { label: 'Genel toplam', value: moneyText(s.totals.grandTotal, currency), strong: true },
    ...(s.kind === 'PROFORMA'
      ? [
          { label: 'Ödenen', value: moneyText(s.paid, currency) },
          { label: 'Kalan', value: moneyText(s.balance, currency), strong: true },
        ]
      : []),
  ]);
  w.gap(10);

  if (s.installments.length && s.kind !== 'PROFORMA') {
    w.heading('Ödeme planı');
    w.table(
      [
        { label: 'Açıklama', width: 260 },
        { label: 'Vade', width: 100 },
        { label: `Tutar (${currency})`, width: 140, align: 'right' },
      ],
      s.installments.map((entry) => [entry.label, dayText(entry.dueDate), trMoney.format(Number(entry.amount))]),
    );
    w.gap(10);
  }

  if (s.kind === 'CONTRACT') {
    w.heading('İptal koşulları');
    if (s.cancellationTiers.length) {
      w.paragraph('İptal bedeli, iptalin etkinliğin ilk gününe kaç gün kala yapıldığına göre toplam tutar üzerinden alınır:');
      for (const tier of cancellationTierRanges(s.cancellationTiers)) w.paragraph(`• ${tier.label}: %${trNumber.format(Number(tier.feePct))}`);
    } else {
      w.paragraph('İptal bedeli uygulanmaz.');
    }
    w.gap(6);
    if (s.terms) {
      w.heading('Sözleşme şartları');
      w.paragraph(s.terms);
      w.gap(6);
    }
  }

  if (s.note) {
    w.heading('Not');
    w.paragraph(s.note);
    w.gap(6);
  }

  if (s.kind === 'OFFER') {
    w.paragraph(`Bu teklif ${dayText(s.validUntil)} tarihine kadar geçerlidir. Fiyatlara vergiler dahildir; kişi başı kalemler garanti edilen kişi sayısıyla faturalanır.`, { size: SIZE.small, color: COLOR.muted });
  } else if (s.kind === 'PROFORMA') {
    w.paragraph('Bu belge proformadır; fatura yerine geçmez. Resmî fatura ayrıca düzenlenir.', { size: SIZE.small, color: COLOR.muted });
  } else {
    signatureBoxes(w, s);
  }
}

/** Sözleşme imza alanları. @param {Writer} w @param {any} s */
function signatureBoxes(w, s) {
  w.gap(14);
  w.ensure(90);
  const boxWidth = (w.width - 30) / 2;
  const top = w.y;
  [
    ['Otel adına', s.hotel.name],
    ['Müşteri adına', s.client.name],
  ].forEach(([label, name], index) => {
    const x = w.left + index * (boxWidth + 30);
    w.bold();
    w.doc.text(label, x, top, { width: boxWidth });
    w.regular(SIZE.small, COLOR.muted);
    w.doc.text(name, x, top + 12, { width: boxWidth });
    w.doc.text('Ad soyad / imza / tarih', x, top + 62, { width: boxWidth });
    w.doc.moveTo(x, top + 58).lineTo(x + boxWidth, top + 58).lineWidth(0.6).strokeColor(COLOR.muted).stroke();
  });
  w.y = top + 80;
}

/** Her sayfanın altlığı: belge numarası ve sayfa i / n. @param {any} doc @param {any} s */
function footer(doc, s) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - PAGE.margin - 10;
    const width = doc.page.width - PAGE.margin * 2;
    // Alt kenar boşluğuna yazarken otomatik sayfa açılmasın.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
    doc.text(`${EVENT_DOCUMENT_KIND_LABELS[s.kind]} ${s.number}${s.version > 1 ? ` · Sürüm ${s.version}` : ''} · ${s.event.code}`, PAGE.margin, y, { width: width / 2, lineBreak: false });
    doc.text(`Sayfa ${index - range.start + 1} / ${range.count}`, PAGE.margin + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}
