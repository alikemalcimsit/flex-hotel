import {
  MAX_REPORT_CHART_SERIES,
  MAX_REPORT_COMMENT_LENGTH,
  MAX_REPORT_TITLE_LENGTH,
  REPORT_CHART_TYPES,
  REPORT_CHAT_BUDGET_SCOPES,
  REPORT_CHAT_REPORTS,
  REPORT_GROUPINGS,
  REPORT_PERIODS,
} from '@hotelos/hotel-contracts';

/**
 * Rapor ajanının talimatı ve araçları (modül 24). Ajan paketi ürün bilmez: talimatı, araç şemalarını ve aracın
 * sonucunu bu modül verir.
 *
 * Araç şemaları OpenAI'ın katı (`strict`) kipine uygundur: her alan zorunlu, boş bırakılacak alan `null`.
 */

export const RUN_REPORT_TOOL = 'run_report';
export const PRESENT_REPORT_TOOL = 'present_report';

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });

const SPEC_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['report', 'period', 'from', 'to', 'groupBy', 'forecastDays', 'budgetScope'],
  properties: {
    report: { type: 'string', enum: [...REPORT_CHAT_REPORTS] },
    period: { type: 'string', enum: [...REPORT_PERIODS], description: 'Relative period (preferred) or CUSTOM with from/to.' },
    from: nullable('string', { description: 'YYYY-MM-DD, only when period is CUSTOM; otherwise null.' }),
    to: nullable('string', { description: 'YYYY-MM-DD, only when period is CUSTOM; otherwise null.' }),
    groupBy: nullable('string', { enum: [...REPORT_GROUPINGS, null], description: 'DAY / WEEK / MONTH for OCCUPANCY and REVENUE; null = automatic.' }),
    forecastDays: nullable('integer', { description: 'Only FORECAST: 1-30 days from today; null = 30 or the NEXT_7_DAYS / NEXT_30_DAYS period.' }),
    budgetScope: nullable('string', { enum: [...REPORT_CHAT_BUDGET_SCOPES, null], description: 'Only BUDGET_VARIANCE: MONTH or YTD (year to date).' }),
  },
});

/** Ajanın araçları (sağlayıcı adaptörünün `tools` biçimi). */
export const REPORT_AGENT_TOOLS = Object.freeze([
  {
    name: RUN_REPORT_TOOL,
    description:
      'Run one hotel report and return its table (columns with keys, rows, summary). Use it to look at the numbers before answering. ' +
      'The table columns are the only valid chart series keys.',
    parameters: SPEC_SCHEMA,
  },
  {
    name: PRESENT_REPORT_TOOL,
    description:
      'Show the final answer: the report the user should see (spec), a chart and a short Turkish comment. Call it exactly once, at the end. ' +
      'The system runs the spec itself and shows the table; your comment must only use numbers you saw in run_report results.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'comment', 'spec', 'chart'],
      properties: {
        title: { type: 'string', description: `Turkish title, at most ${MAX_REPORT_TITLE_LENGTH} characters.` },
        comment: { type: 'string', description: `Turkish, 2-4 sentences, at most ${MAX_REPORT_COMMENT_LENGTH} characters.` },
        spec: SPEC_SCHEMA,
        chart: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'series'],
          properties: {
            type: { type: 'string', enum: [...REPORT_CHART_TYPES], description: 'LINE for trends over time, BAR for comparisons / breakdowns, TABLE when a chart adds nothing.' },
            series: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_REPORT_CHART_SERIES} numeric column keys from the run_report result.` },
          },
        },
      },
    },
  },
]);

/**
 * Sistem talimatı.
 * @param {{ hotelName: string, today: string, currency: string }} context
 */
export function reportAgentSystemPrompt({ hotelName, today, currency }) {
  return [
    `You are the reporting assistant of the hotel "${hotelName}". Today (the hotel's business date) is ${today}. Money is in ${currency}.`,
    'The user is hotel management writing in Turkish. Answer in Turkish.',
    '',
    'Reports you can run (tool run_report):',
    '- OCCUPANCY: sold vs sellable rooms and occupancy % per period, with last year (same weekday, 364 days earlier).',
    '- REVENUE: room revenue (taxes excluded), ADR (revenue / sold room), RevPAR (revenue / sellable room), occupancy, with last year.',
    '- REVENUE_BY_ROOM_TYPE / REVENUE_BY_SOURCE: the period total split by room type / booking source (share %, ADR, last year).',
    '- FORECAST: next 1-30 days from today: on-the-books and forecast occupancy and revenue, critical days.',
    '- BUDGET_VARIANCE: budget plan vs actual for a month (MONTH) or year to date (YTD): revenue, expense, GOP, biggest variances.',
    'Past days are actual stays and posted revenue; today and later are reservations on the books.',
    '',
    'How to answer:',
    '1. Pick the report and the period. Prefer relative periods (LAST_MONTH, THIS_YEAR, LAST_7_DAYS, NEXT_30_DAYS…) whenever the question is relative ("geçen ay", "bu yıl", "son 7 gün", "önümüzdeki ay") so a saved report stays relative; use CUSTOM with from/to only for explicit dates.',
    '   Grouping: "günlük" → DAY, "haftalık" → WEEK, "aylık" → MONTH; otherwise null (automatic by length).',
    '2. Call run_report (at most twice) to see the numbers.',
    '3. Call present_report once with: the spec to show, a chart (series must be numeric column keys of that report\'s table), a short title and a 2-4 sentence comment that highlights the main finding (level, trend, best / worst period, change vs last year).',
    'Never invent or estimate numbers; use only run_report results. If a value is null, say there is no data.',
    'If the question cannot be answered with these reports (e.g. restaurant sales, staff, stock, guests), do not call any tool: reply in one or two Turkish sentences saying which reports you can prepare.',
  ].join('\n');
}

/**
 * Kullanıcı mesajı (devam sorusunda önceki raporun tanımıyla).
 * @param {{ question: string, previous: { question: string, title: string | null, spec: unknown } | null }} input
 */
export function reportAgentUserMessage({ question, previous }) {
  if (!previous) return question;
  return [
    `Önceki soru: ${previous.question}`,
    `Önceki rapor (${previous.title ?? 'başlıksız'}) tanımı: ${JSON.stringify(previous.spec)}`,
    `Yeni soru (önceki rapora göre olabilir): ${question}`,
  ].join('\n');
}
