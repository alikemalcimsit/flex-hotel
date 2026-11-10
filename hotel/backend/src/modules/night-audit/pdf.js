import { PAYMENT_METHOD_LABELS } from '@hotelos/hotel-contracts';
import { COLOR, PAGE, SIZE, renderPdf } from '../../lib/pdf-writer.js';
import { getHotelSettings } from '../settings/service.js';
import { getClosure } from './service.js';

const methodLabel = (method) => PAYMENT_METHOD_LABELS?.[method] ?? method;

/**
 * Vardiya devir raporu (PDF; modül 18): kapanan günün kasa sayımı (yöntem
 * bazında beklenen / sayılan / fark), devir notu ve günlük özet göstergeleri.
 *
 * @param {string} hotelId
 * @param {string} iso "YYYY-AA-GG"
 * @returns {Promise<{ buffer: Buffer, fileName: string }>}
 */
export async function renderShiftReportPdf(hotelId, iso) {
  const [hotel, closure] = await Promise.all([getHotelSettings(hotelId), getClosure(hotelId, iso)]);
  const money = (value) => `${value} ${closure.stats?.currency ?? hotel.currency}`;

  const buffer = await renderPdf({
    info: { Title: `Vardiya Devir Raporu ${iso}` },
    draw: (w) => {
      w.bold(SIZE.title, COLOR.accent);
      w.doc.text('Vardiya Devir Raporu', w.left, w.y);
      w.y += 24;
      w.pairs([
        ['Otel', hotel.name],
        ['İş günü', iso],
        ['Kapatan', closure.closedBy ?? '—'],
        ['Devralan', closure.shift?.handedOverBy ?? '—'],
        ['Kapanış', closure.closedAt ? closure.closedAt.slice(0, 16).replace('T', ' ') : '—'],
      ]);
      w.gap(10);

      w.heading('Kasa sayımı');
      const counts = closure.shift?.counts ?? [];
      w.table(
        [
          { label: 'Yöntem', width: 40 },
          { label: 'Beklenen', width: 30, align: 'right' },
          { label: 'Sayılan', width: 30, align: 'right' },
          { label: 'Fark', width: 30, align: 'right' },
        ],
        [
          ...counts.map((row) => [methodLabel(row.method), money(row.expected), money(row.counted), money(row.variance)]),
          ['Toplam', money(closure.shift?.expectedTotal ?? '0.00'), money(closure.shift?.countedTotal ?? '0.00'), money(closure.shift?.variance ?? '0.00')],
        ],
        { boldLastRow: true },
      );
      w.gap(10);

      if (closure.stats) {
        w.heading('Günlük özet');
        w.pairs([
          ['Doluluk', `%${closure.stats.occupancyPct} (${closure.stats.roomsSold}/${closure.stats.roomsSellable})`],
          ['Oda geliri', money(closure.stats.roomRevenue)],
          ['ADR', money(closure.stats.adr)],
          ['RevPAR', money(closure.stats.revpar)],
          ['Tahsilat', money(closure.stats.collections)],
          ['Gelmeyen', String(closure.noShowCount)],
        ]);
      }

      if (closure.notes) {
        w.gap(10);
        w.heading('Not');
        w.paragraph(closure.notes);
      }
    },
    footer: (doc) => {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.font('regular').fontSize(SIZE.small).fillColor(COLOR.muted);
        doc.text(`HotelOS — ${hotel.name} · Gün kapanış ${iso}`, PAGE.margin, doc.page.height - PAGE.footer, { width: doc.page.width - PAGE.margin * 2, align: 'center' });
      }
    },
  });

  return { buffer, fileName: `vardiya-devir-${iso}.pdf` };
}
