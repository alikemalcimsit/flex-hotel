import { BOARD_TYPE_LABELS, QUOTE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';
import { getQuoteSnapshot } from './service.js';

/**
 * Teklif PDF'i (modül 36). Anlık görüntüden çizilir: teklifin kilitli gece
 * fiyatları — sonradan sistem fiyatı değişse de üretilen belge değişmez.
 * Yazı tipi gömülü (DejaVu Sans): Türkçe her görüntüleyicide doğru çıkar.
 */

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyText = (amount, currency) => `${trMoney.format(Number(amount))} ${currency}`;
const dayText = (day) => (day ? day.split('-').reverse().join('.') : '—');

/**
 * @param {string} hotelId
 * @param {string} quoteId
 * @returns {Promise<{ buffer: Buffer, fileName: string }>}
 */
export async function renderQuotePdf(hotelId, quoteId) {
  const { quote, lead, hotel } = await getQuoteSnapshot(hotelId, quoteId);
  const nights = quote.nights;

  const buffer = await renderPdf({
    info: { Title: `Teklif ${quote.code}`, Author: hotel.name, Subject: lead.name },
    draw: (w) => {
      // Başlık: solda otel, sağda belge.
      const top = w.y;
      w.bold(SIZE.title, COLOR.accent);
      w.doc.text(hotel.name, w.left, top);
      w.bold(SIZE.title, COLOR.ink);
      w.doc.text('KONAKLAMA TEKLİFİ', w.left, top, { width: w.width, align: 'right' });
      w.regular(SIZE.small, COLOR.muted);
      w.doc.text(quote.code, w.left, w.doc.y, { width: w.width, align: 'right' });
      w.y = w.doc.y + 18;

      w.pairs([
        ['Sayın', lead.company ? `${lead.name} — ${lead.company}` : lead.name],
        ['Giriş – Çıkış', `${dayText(quote.checkIn)} – ${dayText(quote.checkOut)} (${nights.length} gece)`],
        ['Oda', `${quote.roomTypeName ?? '—'} · ${BOARD_TYPE_LABELS[quote.boardType] ?? quote.boardType}`],
        ['Kişi', `${quote.adults} yetişkin${quote.children ? `, ${quote.children} çocuk` : ''}`],
        ['Son geçerlilik', dayText(quote.validUntil)],
        ['Durum', QUOTE_STATUS_LABELS[quote.status] ?? quote.status],
      ]);
      w.gap(10);

      w.heading('Gece gece fiyat');
      w.table(
        [
          { label: 'Gece', width: 60 },
          { label: 'Tutar', width: 40, align: 'right' },
        ],
        nights.map((night) => [dayText(night.date), moneyText(night.amount, quote.currency)]),
      );
      w.totals([['Toplam', moneyText(quote.total, quote.currency)]]);

      if (quote.notes) {
        w.gap(10);
        w.heading('Not');
        w.paragraph(quote.notes);
      }

      w.gap(12);
      w.regular(SIZE.small, COLOR.muted);
      w.paragraph(
        `Bu teklif ${dayText(quote.validUntil)} gününe kadar (dahil) geçerlidir; fiyatlar teklif anında ` +
          'sabitlenmiştir ve belirtilen oda tipi ile pansiyonu kapsar. Onayınız üzerine rezervasyonunuz bu toplam ile açılır.',
      );
    },
    footer: (doc) => {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
        doc.text(`${hotel.name} · Teklif ${quote.code} · sayfa ${i - range.start + 1} / ${range.count}`, PAGE.margin, doc.page.height - PAGE.footer, {
          width: doc.page.width - PAGE.margin * 2,
          align: 'center',
        });
      }
    },
  });

  return { buffer, fileName: `teklif-${quote.code}.pdf` };
}
