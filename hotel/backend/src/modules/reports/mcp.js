import { z } from 'zod';
import { runWithContext } from '@hotelos/core';
import {
  FORECAST_DAYS,
  forecastQuerySchema,
  REPORT_BREAKDOWN_LABELS,
  REPORT_GROUPINGS,
  REPORT_QUERY_DESCRIPTIONS,
  REPORT_QUERY_NAMES,
  reportRangeSchema,
} from '@hotelos/hotel-contracts';
import { createReadOnlyMcpServer } from '@hotelos/mcp-server';
import { getForecast } from '../forecast/service.js';
import { getRevenueReport } from './service.js';

/**
 * Otelin raporlama MCP araçları (modül 23; `get_forecast` modül 25). Tüketici: report-agent (modül 24),
 * ya da stdio üzerinden bir masaüstü MCP istemcisi (`scripts/reporting-mcp.js`).
 *
 * - Sunucu **tek bir otele bağlıdır** (`hotelId` oluşturulurken verilir);
 *   araçların otel parametresi yoktur — model başka otelin verisini isteyemez.
 * - Araçlar rapor servisini çağırır: ekrandaki raporla aynı tanımlar, aynı
 *   salt okunur işlem ve süre sınırı (`queries.js` → `readOnly`).
 * - `run_report_query` serbest SQL **değildir**: yalnızca adı verilen,
 *   girdisi doğrulanan raporlardan birini çalıştırır.
 */

const SERVER_VERSION = '1.0.0';

const INSTRUCTIONS =
  'Otelin doluluk ve oda geliri raporları. Tarihler YYYY-AA-GG, aralık en fazla 366 gün. ' +
  'Gelir vergiler hariçtir; geçmiş günler folyoya işlenen gerçekleşen gelir, bugün ve sonrası eldeki rezervasyon. ' +
  'Satılan gece: bugün ve sonrası eldeki rezervasyon; geçmişte yalnızca misafirin gerçekten kaldığı geceler (gelmeyen sayılmaz). ' +
  'ADR = oda geliri / satılan gece; RevPAR = oda geliri / satılabilir oda. Geçen yıl: haftanın aynı günü (364 gün önce). ' +
  'Oranlar dönem toplamlarından hesaplanır; değişimler yüzde, doluluk farkı yüzde puanı. ' +
  'Tahmin (get_forecast) = eldeki + geçen yılın aynı günlerinin aynı gün kala gerçekleşen net satışı (yoksa son haftalar); ' +
  'her gün için kaynağı (basis) ve kritik gün işareti (alert) verilir.';

const runQueryInput = z
  .object({
    report: z.enum(REPORT_QUERY_NAMES, { error: `Rapor adı şunlardan biri olmalı: ${REPORT_QUERY_NAMES.join(', ')}` }),
    from: z.string(),
    to: z.string(),
    groupBy: z.enum(REPORT_GROUPINGS).default('DAY'),
  })
  .superRefine((value, ctx) => {
    const range = reportRangeSchema.safeParse({ from: value.from, to: value.to, groupBy: value.groupBy });
    if (!range.success) for (const issue of range.error.issues) ctx.addIssue({ ...issue, code: 'custom' });
  });

/** Dönem satırının doluluk görünümü. */
const occupancyRow = (row) => ({
  from: row.from,
  to: row.to,
  days: row.days,
  onTheBooksDays: row.onTheBooksDays,
  sold: row.sold,
  sellable: row.sellable,
  occupancyPct: row.occupancyPct,
  lastYear: { from: row.lastYear.from, to: row.lastYear.to, sold: row.lastYear.sold, sellable: row.lastYear.sellable, occupancyPct: row.lastYear.occupancyPct },
  change: { occupancyPts: row.change.occupancyPts, sold: row.change.sold },
});

/** @param {Awaited<ReturnType<typeof getRevenueReport>>} report */
const occupancyView = (report) => ({
  from: report.from,
  to: report.to,
  groupBy: report.groupBy,
  businessDate: report.businessDate,
  totals: {
    sold: report.totals.sold,
    sellable: report.totals.sellable,
    occupancyPct: report.totals.occupancyPct,
    lastYear: { from: report.lastYear.from, to: report.lastYear.to, sold: report.totals.lastYear.sold, sellable: report.totals.lastYear.sellable, occupancyPct: report.totals.lastYear.occupancyPct },
    change: { occupancyPts: report.totals.change.occupancyPts, sold: report.totals.change.sold },
  },
  periods: report.buckets.map(occupancyRow),
});

/** @param {Awaited<ReturnType<typeof getRevenueReport>>} report */
const revenueView = (report) => ({
  from: report.from,
  to: report.to,
  groupBy: report.groupBy,
  businessDate: report.businessDate,
  currency: report.currency,
  totals: report.totals,
  periods: report.buckets,
});

/** @param {Awaited<ReturnType<typeof getRevenueReport>>} report @param {'roomType' | 'source'} key */
const breakdownView = (report, key) => ({
  from: report.from,
  to: report.to,
  businessDate: report.businessDate,
  currency: report.currency,
  breakdown: key === 'roomType' ? REPORT_BREAKDOWN_LABELS.ROOM_TYPE : REPORT_BREAKDOWN_LABELS.SOURCE,
  rows: report.breakdowns[key],
});

/**
 * @param {{ hotelId: string, actor?: string, logger?: { error: Function } }} options
 */
export function createReportingMcpServer({ hotelId, actor = 'mcp:raporlama', logger }) {
  // Her çağrı otel ve aktör bağlamında (denetim izi ve log'larda kim olduğu belli olsun).
  const report = (input) => runWithContext({ actor }, () => getRevenueReport(hotelId, input));
  const forecast = (input) => runWithContext({ actor }, () => getForecast(hotelId, input));

  return createReadOnlyMcpServer({
    name: 'hotelos-reporting',
    version: SERVER_VERSION,
    instructions: INSTRUCTIONS,
    logger,
    tools: [
      {
        name: 'get_occupancy',
        title: 'Doluluk',
        description: 'Tarih aralığında gün / hafta / ay doluluğu: satılan ve satılabilir oda, doluluk yüzdesi, geçen yılın aynı dönemi.',
        input: reportRangeSchema,
        readOnly: true,
        handler: async (input) => occupancyView(await report(input)),
      },
      {
        name: 'get_revenue',
        title: 'Oda geliri, ADR, RevPAR',
        description: 'Tarih aralığında gün / hafta / ay oda geliri (vergiler hariç), ADR, RevPAR, ek ücretler ve iptal geliri; geçen yılla.',
        input: reportRangeSchema,
        readOnly: true,
        handler: async (input) => revenueView(await report(input)),
      },
      {
        name: 'get_forecast',
        title: 'Doluluk ve gelir tahmini',
        description: `Bugünden itibaren en fazla ${FORECAST_DAYS} günün eldeki rezervasyonu, tahmini doluluk ve oda geliri (vergiler hariç), geçen yılın aynı günü, kritik günler (düşük / yüksek doluluk, fazla satış) ve eşikler.`,
        input: forecastQuerySchema,
        readOnly: true,
        handler: async (input) => forecast(input),
      },
      {
        name: 'run_report_query',
        title: 'Hazır rapor',
        description: `Adı verilen hazır raporu çalıştırır (serbest SQL yok). Raporlar: ${REPORT_QUERY_NAMES.map((name) => `${name} — ${REPORT_QUERY_DESCRIPTIONS[name]}`).join(' | ')}`,
        input: runQueryInput,
        readOnly: true,
        handler: async ({ report: name, from, to, groupBy }) => {
          const result = await report({ from, to, groupBy });
          if (name === 'occupancy_by_period') return { report: name, ...occupancyView(result) };
          if (name === 'revenue_by_period') return { report: name, ...revenueView(result) };
          if (name === 'revenue_by_room_type') return { report: name, ...breakdownView(result, 'roomType') };
          return { report: name, ...breakdownView(result, 'source') };
        },
      },
    ],
  });
}
