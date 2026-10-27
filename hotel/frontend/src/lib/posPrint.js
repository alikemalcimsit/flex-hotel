import { POS_STATION_LABELS, ROOM_SERVICE_SOURCE_LABELS, equalShares, utcToZonedWallTime } from '@hotelos/hotel-contracts';

/**
 * POS fişleri (modül 39): hesap (bilgi) fişi ve mutfak fişi. Fiş ayrı bir pencerede 80 mm
 * rulo genişliğinde çizilip yazdırılır; uygulamanın sayfa düzenine yazdırma kuralı
 * eklenmez. Ürün adı, not ve gerekçe kullanıcı girdisidir: her metin kaçışlanır.
 *
 * Mali fiş (ÖKC / yazar kasa) bu modülün kapsamında değildir: hesap fişi "bilgi fişidir"
 * notunu taşır.
 */

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
/** @param {unknown} value */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const MONEY = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** @param {string | number} value */
const amount = (value) => MONEY.format(Number(value));
const STAMP = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; width: 72mm; margin: 0 auto; padding: 4mm 0; color: #000; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2mm; }
  h2 { font-size: 13px; margin: 3mm 0 1mm; border-bottom: 1px dashed #000; }
  p { margin: 0 0 1mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.5mm 0; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; }
  .muted { color: #444; font-size: 11px; }
  .big { font-size: 15px; font-weight: bold; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .note { font-style: italic; padding-left: 4mm; }
  .center { text-align: center; }
`;

/** @param {string} title @param {string} body */
const documentOf = (title, body) =>
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

/** @param {any} check */
const headerOf = (check) =>
  `<h1>${escapeHtml(check.outlet.name)}</h1>` +
  `<p>${check.table ? `Masa <strong>${escapeHtml(check.table.name)}</strong> · ` : ''}${escapeHtml(check.number)}</p>` +
  `<p class="muted">${escapeHtml(STAMP.format(new Date()))} · ${escapeHtml(check.waiterEmail)} · ${check.covers} kişi</p>`;

/**
 * Hesap fişi: faturalanan kalemler (ikram / iptal düşülmüş), indirim, vergi dökümü, toplam,
 * alınan / odaya yazılan, kalan ve kişi başı öneri.
 * @param {any} check `GET /pos/checks/:id` yanıtı
 */
export function billSlipHtml(check) {
  const rows = check.lines
    .map((line) => {
      const billable = line.quantity - line.voidedQuantity - line.compedQuantity;
      const extra = [line.compedQuantity ? `${line.compedQuantity} ikram` : '', line.voidedQuantity ? `${line.voidedQuantity} iptal` : ''].filter(Boolean).join(', ');
      if (billable <= 0 && !extra) return '';
      return `<tr><td>${billable} × ${escapeHtml(line.name)}${extra ? `<div class="muted">(${escapeHtml(extra)})</div>` : ''}</td><td class="r">${amount(line.total)}</td></tr>`;
    })
    .join('');
  const totals = check.totals;
  const taxes = totals.taxes.map((tax) => `<tr><td class="muted">${escapeHtml(tax.name)} %${escapeHtml(tax.rate)}${tax.included ? ' (dahil)' : ''}</td><td class="r muted">${amount(tax.amount)}</td></tr>`).join('');
  const settled = Number(check.paidTotal) + Number(check.roomChargeTotal);
  const shares = check.covers > 1 && Number(check.balance) > 0 ? equalShares(check.balance, check.covers) : [];
  const body =
    headerOf(check) +
    '<h2>Hesap</h2>' +
    `<table>${rows}</table><div class="rule"></div><table>` +
    `<tr><td>Ara toplam</td><td class="r">${amount(totals.subtotal)}</td></tr>` +
    (Number(totals.discountTotal) ? `<tr><td>İndirim</td><td class="r">−${amount(totals.discountTotal)}</td></tr>` : '') +
    taxes +
    `<tr><td class="big">TOPLAM</td><td class="r big">${amount(totals.grandTotal)} ${escapeHtml(check.currency)}</td></tr>` +
    (settled ? `<tr><td>Alınan / odaya</td><td class="r">−${amount(settled)}</td></tr><tr><td class="big">KALAN</td><td class="r big">${amount(check.balance)}</td></tr>` : '') +
    '</table>' +
    (shares.length ? `<p class="muted">Kişi başı (${check.covers}): ${shares.map(amount).join(' / ')}</p>` : '') +
    '<div class="rule"></div><p class="center muted">Bilgi fişidir, mali değeri yoktur.</p>';
  return documentOf(`Hesap ${check.number}`, body);
}

/**
 * Mutfak fişi: bir sipariş turunun kalemleri istasyona göre (mutfağa gitmeyenler hariç),
 * notlarıyla.
 * @param {any} check @param {string} orderId tur
 */
export function kitchenSlipHtml(check, orderId) {
  const order = check.orders.find((entry) => entry.id === orderId);
  const seq = order?.seq ?? '';
  const lines = check.lines.filter((line) => line.orderId === orderId && line.station !== 'NONE');
  const stations = [...new Set(lines.map((line) => line.station))];
  const body =
    headerOf(check) +
    `<p class="big">Tur ${seq}${order ? ` · ${escapeHtml(STAMP.format(new Date(order.sentAt)))}` : ''}</p>` +
    stations
      .map(
        (station) =>
          `<h2>${escapeHtml(POS_STATION_LABELS[station] ?? station)}</h2><table>` +
          lines
            .filter((line) => line.station === station)
            .map((line) => `<tr><td class="big">${line.quantity} × ${escapeHtml(line.name)}${line.note ? `<div class="note">${escapeHtml(line.note)}</div>` : ''}</td></tr>`)
            .join('') +
          '</table>',
      )
      .join('') +
    (lines.length ? '' : '<p>Bu turda mutfağa giden kalem yok.</p>');
  return documentOf(`Mutfak ${check.number} tur ${seq}`, body);
}

/**
 * Garson vardiya fişi (gün sonu): kasa (avans, nakit, beklenen, sayılan, fark), yöntem
 * bazında tahsilat, satış, indirim / ikram / iptal / zayi, odaya yazılan, en çok satanlar.
 * @param {any} report `GET /pos/shifts/:id/report` yanıtı
 * @param {Record<string, string>} methodLabels yöntem adları
 */
export function shiftSlipHtml(report, methodLabels) {
  const { shift, sales, currency } = report;
  const line = (label, value) => `<tr><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const body =
    `<h1>Vardiya raporu</h1><p>${escapeHtml(shift.waiterEmail)}${shift.outletName ? ` · ${escapeHtml(shift.outletName)}` : ''}</p>` +
    `<p class="muted">${escapeHtml(STAMP.format(new Date(shift.openedAt)))} – ${shift.closedAt ? escapeHtml(STAMP.format(new Date(shift.closedAt))) : 'açık'}</p>` +
    '<h2>Kasa</h2><table>' +
    line('Avans', amount(shift.cash.openingFloat)) +
    line('Nakit (net)', amount(shift.cash.cashNet)) +
    line('Beklenen nakit', amount(shift.cash.expectedCash)) +
    (shift.countedCash !== null ? line('Sayılan', amount(shift.countedCash)) + `<tr><td class="big">FARK</td><td class="r big">${amount(shift.variance)}</td></tr>` : '') +
    '</table><h2>Tahsilat</h2><table>' +
    shift.payments.map((row) => line(methodLabels[row.method] ?? row.method, amount(row.net))).join('') +
    line('Odaya yazılan', amount(report.roomCharges.amount)) +
    '</table><h2>Satış</h2><table>' +
    line('Adisyon / kişi', `${sales.checks} / ${sales.covers}`) +
    line('İndirim', amount(sales.discountTotal)) +
    line('İkram', amount(sales.compTotal)) +
    line('İptal', amount(sales.voidTotal)) +
    line(`Zayi (${sales.wasteCount})`, amount(sales.wasteTotal)) +
    `<tr><td class="big">TOPLAM</td><td class="r big">${amount(sales.grandTotal)} ${escapeHtml(currency)}</td></tr>` +
    '</table>' +
    (report.topItems.length ? '<h2>En çok satan</h2><table>' + report.topItems.map((item) => line(`${item.quantity} × ${item.name}`, amount(item.amount))).join('') + '</table>' : '');
  return documentOf(`Vardiya ${shift.waiterEmail}`, body);
}

/** Otelin saati "26.10 07:30". @param {string | null} value @param {string} timeZone */
const hotelClock = (value, timeZone) => {
  if (!value) return '—';
  const wall = utcToZonedWallTime(value, timeZone);
  return `${wall.slice(8, 10)}.${wall.slice(5, 7)} ${wall.slice(11, 16)}`;
};

/**
 * Oda servisi teslim fişi (modül 41): götürenin tepsideki fişi — oda, misafir, sipariş no, istenen / hedef saat,
 * kalemler (notlarıyla), misafirin notu, tutar. Saatler otelin saatiyle.
 * @param {any} order `GET /pos/room-service/orders/:id` yanıtı
 * @param {string} timeZone
 */
export function roomServiceSlipHtml(order, timeZone) {
  const room = order.movedTo ?? order.roomNumber;
  const items = order.items
    .map((item) => `<tr><td>${item.quantity} × ${escapeHtml(item.name)}${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ''}</td><td class="r">${amount(Number(item.unitPrice) * item.quantity)}</td></tr>`)
    .join('');
  const body =
    `<h1>Oda ${escapeHtml(room)}</h1>` +
    `<p class="center big">${escapeHtml(order.guestName)}</p>` +
    `<p>${escapeHtml(order.number)} · ${escapeHtml(order.outletName ?? '')} · ${order.covers} kişi</p>` +
    `<p class="muted">${escapeHtml(ROOM_SERVICE_SOURCE_LABELS[order.source] ?? '')} · sipariş ${hotelClock(order.createdAt, timeZone)}</p>` +
    `<p class="big">${order.deliverAt ? `Teslim ${hotelClock(order.deliverAt, timeZone)}` : `Hedef ${hotelClock(order.dueAt, timeZone)}`}</p>` +
    (order.movedTo ? `<p>Not: misafir ${escapeHtml(order.roomNumber)} numaralı odadan taşındı.</p>` : '') +
    '<div class="rule"></div>' +
    `<table>${items}</table>` +
    (order.note ? `<div class="rule"></div><p class="note">${escapeHtml(order.note)}</p>` : '') +
    '<div class="rule"></div>' +
    `<table><tr><td>Hesap</td><td class="r big">${amount(order.check?.grandTotal ?? order.itemsTotal)}</td></tr></table>` +
    `<p class="muted">${order.trayExpected ? 'Tepsi bırakılacak — toplanınca işaretleyin.' : 'Tepsisiz teslim.'}</p>`;
  return documentOf(`Oda servisi ${order.number}`, body);
}

/**
 * Hazırlık listesi (kahvaltı kartı): günün üretim toplamı ve teslim saati aralıkları — her aralıkta ürün toplamı ve
 * odalar (kalemleri, notlarıyla).
 * @param {any} prep `GET /pos/room-service/prep` yanıtı
 */
export function prepListHtml(prep) {
  const totals = (items) => items.map((item) => `<tr><td>${escapeHtml(item.name)}${item.note ? ` <span class="muted">(${escapeHtml(item.note)})</span>` : ''}</td><td class="r big">${item.quantity}</td></tr>`).join('');
  const slots = prep.slots
    .map(
      (slot) =>
        `<h2>${escapeHtml(slot.time)} · ${slot.orders.length} oda</h2><table>${totals(slot.items)}</table>` +
        slot.orders
          .map(
            (order) =>
              `<p><strong>Oda ${escapeHtml(order.movedTo ?? order.roomNumber)}</strong> · ${escapeHtml(utcToZonedWallTime(order.deliverAt, prep.timezone).slice(11, 16))} · ${order.covers} kişi</p>` +
              order.items.map((item) => `<p class="note">${item.quantity} × ${escapeHtml(item.name)}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</p>`).join('') +
              (order.note ? `<p class="note muted">${escapeHtml(order.note)}</p>` : ''),
          )
          .join(''),
    )
    .join('');
  const body =
    `<h1>Hazırlık listesi</h1><p class="center">${escapeHtml(prep.date)} · ${prep.total} sipariş</p>` +
    `<h2>Günün toplamı</h2><table>${totals(prep.items)}</table>` +
    slots +
    (prep.truncated ? '<p class="big">Liste kesildi: bu günün siparişleri sınırı aştı.</p>' : '');
  return documentOf(`Hazırlık ${prep.date}`, body);
}

/**
 * Fişi ayrı pencerede açıp yazdırır (tıklama içinde çağrılmalı; açılır pencere engelinden
 * geçer). Pencere açılamazsa `false`.
 * @param {string} html
 */
export function printHtml(html) {
  const view = window.open('', '_blank', 'width=420,height=680');
  if (!view) return false;
  view.document.open();
  view.document.write(html);
  view.document.close();
  view.focus();
  view.print();
  return true;
}
