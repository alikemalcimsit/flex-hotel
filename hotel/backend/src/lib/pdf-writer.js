import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

/**
 * Sunucuda PDF üretiminin ortak parçaları (modül 37'de banket belgeleri için yazıldı; modül 45'te satın alma
 * siparişi için ortaklaştırıldı): gömülü DejaVu yazı tipi (Türkçe harfler her görüntüleyicide doğru), ligatür
 * kapatma, sayfa ölçüleri ve renkler, başlık / paragraf / anahtar-değer / sayfaya bölünen tablo / toplam
 * satırları çizen `Writer`, belgeyi bellekte üreten `renderPdf`.
 */

const require = createRequire(import.meta.url);
export const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
export const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

export const PAGE = Object.freeze({ size: 'A4', margin: 40, footer: 28 });
export const COLOR = Object.freeze({ text: '#1f2937', muted: '#6b7280', line: '#d1d5db', fill: '#f3f4f6', accent: '#1e3a5f' });
export const SIZE = Object.freeze({ title: 16, heading: 10.5, body: 8.5, small: 7.5 });
const CELL_PADDING = 4;

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

export class Writer {
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
export function disableLigatures(doc) {
  const text = doc.text.bind(doc);
  const heightOfString = doc.heightOfString.bind(doc);
  doc.text = (value, x, y, options = {}) => text(value, x, y, { features: noLigatures(), ...options });
  doc.heightOfString = (value, options = {}) => heightOfString(value, { features: noLigatures(), ...options });
}

/**
 * Belgeyi bellekte üretir: yazı tipleri kayıtlı, ligatürler kapalı, sayfalar tamponlu (altlık için).
 * @param {{ info: Record<string, string>, draw: (writer: Writer) => void, footer?: (doc: any) => void }} input
 * @returns {Promise<Buffer>}
 */
export function renderPdf({ info, draw, footer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true, info: { Creator: 'HotelOS', ...info } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      disableLigatures(doc);
      doc.registerFont('regular', FONT_REGULAR);
      doc.registerFont('bold', FONT_BOLD);
      draw(new Writer(doc));
      footer?.(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
