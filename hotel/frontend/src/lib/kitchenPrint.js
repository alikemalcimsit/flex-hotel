import { KITCHEN_UNIT_LABELS, POS_STATION_LABELS, PURCHASE_REQUEST_STATUS_LABELS, STOCK_ITEM_GROUP_LABELS } from '@hotelos/hotel-contracts';
import { policyPctText, quantityText } from './kitchenFormat.js';
import { escapeHtml } from './posPrint.js';

/**
 * Mutfak çıktıları (modül 43), A4: üretim planı (mutfak duvarı), malzeme ihtiyaç listesi
 * (gruba göre — kasap, manav…) ve satın alma talebi. Ayrı pencerede çizilip yazdırılır;
 * yemek, not, etkinlik adı kullanıcı girdisidir — her metin kaçışlanır.
 */

const MONEY = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
const STAMP = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** "2026-11-14" → "14 Kasım 2026 Cumartesi". @param {string} day */
const dayLong = (day) => DAY.format(new Date(`${day}T00:00:00Z`));
/** "2026-11-14T20:00" → "14.11 20:00". @param {string} wall */
const shortWall = (wall) => `${wall.slice(8, 10)}.${wall.slice(5, 7)} ${wall.slice(11, 16)}`;

const STYLE = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 1mm; }
  h2 { font-size: 13px; margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 1.5px solid #111; }
  h3 { font-size: 11.5px; margin: 3mm 0 1mm; color: #333; }
  .meta { color: #555; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1.2mm 1.5mm; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; border-bottom: 1px solid #999; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .muted { color: #666; font-size: 10px; }
  .tag { display: inline-block; padding: 0 1.5mm; border: 1px solid #999; border-radius: 2mm; font-size: 9.5px; margin-right: 1mm; }
  .draft { color: #b45309; font-weight: 600; }
  .box { display: inline-block; width: 4mm; height: 4mm; border: 1px solid #111; }
  tr { page-break-inside: avoid; }
`;

/** @param {string} title @param {string} body */
const documentOf = (title, body) =>
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

/** @param {string} title @param {string} subtitle */
const header = (title, subtitle) => `<h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(subtitle)} · Basım ${escapeHtml(STAMP.format(new Date()))}</p>`;

/**
 * Üretim planı: gün → saat → görev (istasyon, yemek / ara ürün, miktar, hazır olacağı an,
 * etkinlik, salon). Kesinleşmemiş menünün görevi "taslak" işaretlidir; işaret kutusu
 * mutfakta elle "yapıldı" için.
 * @param {any} plan `GET /banquet/fnb/production` yanıtı @param {{ hotelName: string, stationLabel?: string }} options
 */
export function productionPlanHtml(plan, { hotelName, stationLabel }) {
  const days = plan.days
    .map((day) => {
      const rows = day.hours
        .flatMap((hour) =>
          hour.tasks.map(
            (task) => `<tr>
              <td><span class="box"></span></td>
              <td>${escapeHtml(task.startLocal.slice(11, 16))}</td>
              <td>${escapeHtml(POS_STATION_LABELS[task.station] ?? task.station)}</td>
              <td><strong>${escapeHtml(task.name)}</strong>${task.kind === 'PREP' ? ' <span class="tag">ara ürün</span>' : ''}${task.usedBy.length ? `<div class="muted">→ ${escapeHtml(task.usedBy.join(', '))}</div>` : ''}</td>
              <td class="r">${escapeHtml(quantityText(task.quantity, task.unit))}</td>
              <td>${escapeHtml(shortWall(task.readyLocal))}</td>
              <td>${escapeHtml(task.event.code)} · ${escapeHtml(task.event.name)}${task.menu.finalized ? '' : ' <span class="draft">(taslak menü)</span>'}<div class="muted">${escapeHtml(task.venueName)} · servis ${escapeHtml(shortWall(task.serveLocal))} · ${task.menu.guests} kişi</div>${task.menu.notes ? `<div class="muted">Not: ${escapeHtml(task.menu.notes)}</div>` : ''}</td>
            </tr>`,
          ),
        )
        .join('');
      return `<h2>${escapeHtml(dayLong(day.day))}</h2><table><thead><tr><th></th><th>Başla</th><th>İstasyon</th><th>Ne</th><th class="r">Miktar</th><th>Hazır</th><th>Etkinlik</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');
  const scope = `${plan.from === plan.to ? dayLong(plan.from) : `${dayLong(plan.from)} – ${dayLong(plan.to)}`}${stationLabel ? ` · ${stationLabel}` : ''}`;
  const empty = plan.days.length ? '' : '<p>Bu aralıkta hazırlık görevi yok.</p>';
  return documentOf(`Üretim planı ${plan.from}`, `${header(`${hotelName} — Mutfak üretim planı`, scope)}${empty}${days}`);
}

/**
 * Malzeme ihtiyaç listesi: gruba göre (kasap, manav…); kesin, talep edilmiş, eksik, ihtiyaç günü.
 * @param {any} needs `GET /banquet/fnb/needs` yanıtı @param {{ hotelName: string }} options
 */
export function needsListHtml(needs, { hotelName }) {
  const groups = new Map();
  for (const row of needs.items) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  const body = [...groups]
    .map(
      ([group, rows]) => `<h3>${escapeHtml(STOCK_ITEM_GROUP_LABELS[group] ?? group)}</h3><table><thead><tr><th>Malzeme</th><th class="r">Kesin ihtiyaç</th>${needs.includeTentative ? '<th class="r">Olası</th>' : ''}<th class="r">Talep edildi</th><th class="r">Eksik</th><th>İhtiyaç günü</th></tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.name)}${row.code ? ` <span class="muted">${escapeHtml(row.code)}</span>` : ''}</td><td class="r">${escapeHtml(quantityText(row.definite, row.unit))}</td>${needs.includeTentative ? `<td class="r">${escapeHtml(quantityText(row.tentative, row.unit))}</td>` : ''}<td class="r">${escapeHtml(quantityText(row.requested, row.unit))}</td><td class="r"><strong>${escapeHtml(quantityText(row.shortfall, row.unit))}</strong></td><td>${escapeHtml(row.needDay ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`,
    )
    .join('');
  const subtitle = `Servis ${needs.from} – ${needs.to} · ${needs.events} etkinlik · ${needs.menus} menü · fazla hazırlık ${policyPctText(needs.overproductionPct)} · eksik etkinlik başına`;
  return documentOf(`Malzeme ihtiyacı ${needs.from}`, `${header(`${hotelName} — Banket malzeme ihtiyacı`, subtitle)}${needs.items.length ? body : '<p>Bu aralıkta ihtiyaç yok.</p>'}`);
}

/**
 * Satın alma talebi: malzeme başına toplam, tahmini birim maliyet ve tutar; altında etkinlik dökümü.
 * @param {any} request `GET /purchasing/requests/:id` yanıtı @param {{ hotelName: string }} options
 */
export function purchaseRequestHtml(request, { hotelName }) {
  const rows = request.items
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.name)}</strong>${item.code ? ` <span class="muted">${escapeHtml(item.code)}</span>` : ''}<div class="muted">${escapeHtml(STOCK_ITEM_GROUP_LABELS[item.group] ?? item.group)}</div></td>
        <td class="r">${escapeHtml(quantityText(item.quantity, item.unit))}</td>
        <td class="r">${MONEY.format(Number(item.unitCost))} / ${escapeHtml(KITCHEN_UNIT_LABELS[item.unit] ?? item.unit)}</td>
        <td class="r">${MONEY.format(Number(item.cost))}</td>
        <td>${escapeHtml(item.neededBy)}</td>
        <td class="muted">${item.events.map((entry) => `${escapeHtml(entry.code ?? '—')}: ${escapeHtml(quantityText(entry.quantity, item.unit))} (${escapeHtml(entry.neededBy)})`).join('<br>')}</td>
      </tr>`,
    )
    .join('');
  const subtitle = `${PURCHASE_REQUEST_STATUS_LABELS[request.status] ?? request.status} · ihtiyaç ${request.neededBy} · talep eden ${request.requestedBy}`;
  return documentOf(
    request.number,
    `${header(`${hotelName} — Satın alma talebi ${request.number}`, subtitle)}${request.note ? `<p><strong>Not:</strong> ${escapeHtml(request.note)}</p>` : ''}<table><thead><tr><th>Malzeme</th><th class="r">Miktar</th><th class="r">Tahmini birim</th><th class="r">Tahmini tutar</th><th>İhtiyaç</th><th>Etkinlik dökümü</th></tr></thead><tbody>${rows}</tbody></table><p class="r"><strong>Tahmini toplam: ${MONEY.format(Number(request.estimatedTotal))}</strong></p><p class="muted">Birim maliyet talep anındaki malzeme kartından (KDV hariç); teklif ve sipariş satın alma modülünde.</p>`,
  );
}

/**
 * A4 belgeyi ayrı pencerede açıp yazdırır (tıklama içinde çağrılmalı). Açılamazsa `false`.
 * @param {string} html
 */
export function printDocument(html) {
  const view = window.open('', '_blank', 'width=960,height=760');
  if (!view) return false;
  view.document.open();
  view.document.write(html);
  view.document.close();
  view.focus();
  view.print();
  return true;
}
