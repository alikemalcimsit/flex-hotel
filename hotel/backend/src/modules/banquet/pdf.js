import { createRequire } from 'node:module';
import {
  ALLERGEN_LABELS,
  EVENT_CLIENT_TYPE_LABELS,
  EVENT_DOCUMENT_KIND_LABELS,
  EVENT_ITEM_UNIT_LABELS,
  EVENT_TYPE_LABELS,
  VENUE_LAYOUT_LABELS,
  cancellationTierRanges,
} from '@hotelos/hotel-contracts';
import PDFDocument from 'pdfkit';

/**
 * Etkinlik belgesinin PDF'i (modül 37): teklif, sözleşme, proforma.
 *
 * Belge **anlık görüntüden** (snapshot) çizilir: veritabanına dokunmaz, aynı görüntü
 * her zaman aynı belgeyi verir (sonradan kalem / fiyat değişse de üretilmiş sürüm
 * değişmez). Yazı tipi gömülüdür (DejaVu Sans): Türkçe harfler her görüntüleyicide
 * doğru çıkar. Uzun tablolar sayfaya bölünür, başlık satırı yeni sayfada tekrarlanır;
 * her sayfanın altında belge numarası ve "sayfa i / n" yazar.
 */

const require = createRequire(import.meta.url);
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const PAGE = Object.freeze({ size: 'A4', margin: 40, footer: 28 });
const COLOR = Object.freeze({ text: '#1f2937', muted: '#6b7280', line: '#d1d5db', fill: '#f3f4f6', accent: '#1e3a5f' });
const SIZE = Object.freeze({ title: 16, heading: 10.5, body: 8.5, small: 7.5 });
const CELL_PADDING = 4;

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
 * @typedef {{ label: string, width: number, align?: 'left' | 'right' | 'center' }} Column
 */

/** Tek parçada çizilen en uzun metin (≈ 15 satır): parça her zaman bir sayfaya sığar, `y` sayımı kaymaz. */
const MAX_CHUNK_CHARS = 1500;

/**
 * Satır sonu olmayan uzun metni kelime sınırından parçalar.
 * @param {string} line
 * @returns {string[]}
 */
export function splitLongLine(line) {
  if (line.length <= MAX_CHUNK_CHARS) return [line];
  const chunks = [];
  let rest = line;
  while (rest.length > MAX_CHUNK_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_CHUNK_CHARS);
    const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

class Writer {
  /** @param {any} doc */
  constructor(doc) {
    this.doc = doc;
    this.left = PAGE.margin;
    this.width = doc.page.width - PAGE.margin * 2;
    this.bottom = doc.page.height - PAGE.margin - PAGE.footer;
    this.y = PAGE.margin;
  }

  regular(size = SIZE.body, color = COLOR.text) {
    this.doc.font('regular').fontSize(size).fillColor(color);
    return this;
  }

  bold(size = SIZE.body, color = COLOR.text) {
    this.doc.font('bold').fontSize(size).fillColor(color);
    return this;
  }

  /** Yer yoksa yeni sayfa. @param {number} height */
  ensure(height) {
    if (this.y + height <= this.bottom) return false;
    this.doc.addPage();
    this.y = PAGE.margin;
    return true;
  }

  /** @param {number} amount */
  gap(amount = 8) {
    this.y += amount;
  }

  /** Bölüm başlığı (altındaki ilk satırla birlikte sayfaya sığmalı). @param {string} text */
  heading(text) {
    this.ensure(40);
    this.bold(SIZE.heading, COLOR.accent);
    this.doc.text(text, this.left, this.y, { width: this.width });
    this.y += this.doc.heightOfString(text, { width: this.width }) + 3;
    this.doc.moveTo(this.left, this.y).lineTo(this.left + this.width, this.y).lineWidth(0.6).strokeColor(COLOR.line).stroke();
    this.y += 5;
  }

  /** Paragraf (sayfaya bölünebilir). @param {string} text @param {{ size?: number, color?: string, bold?: boolean }} [options] */
  paragraph(text, { size = SIZE.body, color = COLOR.text, bold = false } = {}) {
    const style = () => (bold ? this.bold(size, color) : this.regular(size, color));
    for (const line of String(text).split(/\r?\n/).flatMap(splitLongLine)) {
      const piece = line.length ? line : ' ';
      style();
      const height = this.doc.heightOfString(piece, { width: this.width });
      // Uzun metin satır satır: sayfa sonunda bölünür, yazı tipi yeni sayfada yeniden kurulur.
      this.ensure(height);
      style();
      this.doc.text(piece, this.left, this.y, { width: this.width });
      this.y += height + 1;
    }
  }

  /**
   * Anahtar / değer satırları, iki sütunda.
   * @param {Array<[string, string | null | undefined]>} pairs
   */
  pairs(pairs) {
    const filled = pairs.filter(([, value]) => value !== null && value !== undefined && value !== '');
    const half = this.width / 2;
    const labelWidth = 92;
    for (let index = 0; index < filled.length; index += 2) {
      const row = filled.slice(index, index + 2);
      this.regular();
      const height = Math.max(...row.map(([, value]) => this.doc.heightOfString(String(value), { width: half - labelWidth - 6 }))) + 2;
      this.ensure(height);
      row.forEach(([label, value], column) => {
        const x = this.left + column * half;
        this.regular(SIZE.body, COLOR.muted);
        this.doc.text(label, x, this.y, { width: labelWidth });
        this.regular();
        this.doc.text(String(value), x + labelWidth, this.y, { width: half - labelWidth - 6 });
      });
      this.y += height;
    }
  }

  /**
   * Tablo: başlık satırı yeni sayfada tekrarlanır; satır sayfaya sığmazsa yeni sayfaya geçer.
   * @param {Column[]} columns genişlikler toplamı içerik genişliğine ölçeklenir
   * @param {string[][]} rows
   * @param {{ boldLastRow?: boolean }} [options]
   */
  table(columns, rows, { boldLastRow = false } = {}) {
    const scale = this.width / columns.reduce((sum, column) => sum + column.width, 0);
    const widths = columns.map((column) => column.width * scale);
    const header = () => {
      this.bold(SIZE.small);
      const height = Math.max(...columns.map((column, index) => this.doc.heightOfString(column.label, { width: widths[index] - CELL_PADDING * 2 }))) + CELL_PADDING * 2;
      this.ensure(height + 16);
      this.doc.rect(this.left, this.y, this.width, height).fill(COLOR.fill);
      this.bold(SIZE.small);
      let x = this.left;
      columns.forEach((column, index) => {
        this.doc.text(column.label, x + CELL_PADDING, this.y + CELL_PADDING, { width: widths[index] - CELL_PADDING * 2, align: column.align ?? 'left' });
        x += widths[index];
      });
      this.y += height;
    };
    header();
    rows.forEach((cells, rowIndex) => {
      const strong = boldLastRow && rowIndex === rows.length - 1;
      if (strong) this.bold();
      else this.regular();
      const height = Math.max(...cells.map((cell, index) => this.doc.heightOfString(cell ?? '', { width: widths[index] - CELL_PADDING * 2 }))) + CELL_PADDING * 2;
      if (this.ensure(height)) header();
      if (strong) this.bold();
      else this.regular();
      let x = this.left;
      cells.forEach((cell, index) => {
        this.doc.text(cell ?? '', x + CELL_PADDING, this.y + CELL_PADDING, { width: widths[index] - CELL_PADDING * 2, align: columns[index].align ?? 'left' });
        x += widths[index];
      });
      this.y += height;
      this.doc.moveTo(this.left, this.y).lineTo(this.left + this.width, this.y).lineWidth(0.4).strokeColor(COLOR.line).stroke();
    });
  }

  /**
   * Sağa yaslı toplam satırları.
   * @param {Array<{ label: string, value: string, strong?: boolean }>} lines
   */
  totals(lines) {
    const labelWidth = 200;
    const valueWidth = 120;
    const x = this.left + this.width - labelWidth - valueWidth;
    this.ensure(lines.length * 14 + 6);
    for (const line of lines) {
      if (line.strong) this.bold(SIZE.heading);
      else this.regular();
      this.doc.text(line.label, x, this.y, { width: labelWidth, align: 'right' });
      this.doc.text(line.value, x + labelWidth, this.y, { width: valueWidth, align: 'right' });
      this.y += (line.strong ? 15 : 12);
    }
  }
}

/**
 * Belge görüntüsünü PDF'e çizer.
 *
 * @param {import('./documents.js').DocumentSnapshot} snapshot
 * @returns {Promise<Buffer>}
 */
export function renderEventDocument(snapshot) {
  return new Promise((resolve, reject) => {
    const title = DOCUMENT_TITLES[snapshot.kind];
    const doc = new PDFDocument({
      size: PAGE.size,
      margin: PAGE.margin,
      bufferPages: true,
      info: { Title: `${title} ${snapshot.number}`, Author: snapshot.hotel.name, Subject: snapshot.event.name, Creator: 'HotelOS' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      disableLigatures(doc);
      doc.registerFont('regular', FONT_REGULAR);
      doc.registerFont('bold', FONT_BOLD);
      draw(new Writer(doc), snapshot, title);
      footer(doc, snapshot);
      doc.end();
    } catch (error) {
      reject(error);
    }
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

/**
 * Bitişik harf (ligatür) kapalı: Türkçede "fi" birleşince i'nin noktası kaybolur,
 * kopyalanan metin "fyat" olur. Her çağrıya yeni nesne (yazı tipi motoru nesneyi
 * yerinde genişletir).
 */
const noLigatures = () => ({ liga: false, clig: false });

/**
 * Belgenin bütün metin çizimi ve ölçümü ligatürsüz yapılır (ölçüm ile çizim aynı
 * genişliği görmeli). Yalnızca bu belge nesnesine uygulanır.
 * @param {any} doc
 */
function disableLigatures(doc) {
  const text = doc.text.bind(doc);
  const heightOfString = doc.heightOfString.bind(doc);
  doc.text = (value, x, y, options = {}) => text(value, x, y, { features: noLigatures(), ...options });
  doc.heightOfString = (value, options = {}) => heightOfString(value, { features: noLigatures(), ...options });
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
