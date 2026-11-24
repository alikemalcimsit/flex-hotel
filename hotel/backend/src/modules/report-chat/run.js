import { toIsoDay } from '@hotelos/core';
import { reportSpecSchema, resolveReportSpec } from '@hotelos/hotel-contracts';
import { getBusinessDate } from '../../lib/business-date.js';
import { ValidationError } from '../../lib/errors.js';
import { callReportingTool } from '../reports/mcp.js';
import { buildDataset, chartFor } from './datasets.js';

/**
 * Rapor tanımını çalıştırır (modül 24): tanım doğrulanır, dönem otelin bugününe göre çözülür, rapor MCP aracıyla
 * üretilir ve tabloya çevrilir. Soru cevabı da kayıtlı raporun "tekrar çalıştır"ı da buradan geçer (AI yok).
 *
 * @param {string} hotelId
 * @param {unknown} rawSpec
 * @param {{ chart?: { type: string, series: string[] } | null, today?: string }} [options]
 * @returns {Promise<{ spec: import('@hotelos/hotel-contracts').ReportSpec, periodLabel: string, dataset: ReturnType<typeof buildDataset>, chart: { type: string, series: string[] } }>}
 */
export async function runReportSpec(hotelId, rawSpec, { chart = null, today } = {}) {
  const parsed = reportSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new ValidationError(`Rapor tanımı geçersiz: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'tanım'}: ${issue.message}`).join('; ')}`);
  }
  const day = today ?? toIsoDay(await getBusinessDate(hotelId));
  const resolved = resolveReportSpec(parsed.data, day);
  const data = await callReportingTool(hotelId, resolved.tool, resolved.input);
  const dataset = buildDataset(resolved.tool, data);
  return { spec: parsed.data, periodLabel: resolved.periodLabel, dataset, chart: chartFor(resolved.tool, dataset, chart) };
}
