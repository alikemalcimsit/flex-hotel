#!/usr/bin/env node
import { serveStdio } from '@hotelos/mcp-server';
import { prismaUnfiltered } from '../src/db.js';
import { resolveHotelId } from '../src/lib/tenant.js';
import { disconnectReporting } from '../src/modules/reports/queries.js';
import { createReportingMcpServer } from '../src/modules/reports/mcp.js';

/**
 * Raporlama MCP sunucusu, stdio (modül 23).
 *
 * Masaüstü MCP istemcisine (ör. Claude Desktop) ya da süreç dışı bir ajana
 * otelin doluluk / gelir araçlarını salt okunur sunar. Otel `HOTEL_CODE`'dan;
 * bağlantı `REPORTING_DATABASE_URL` (tercihen yalnızca okuma yetkili bir
 * veritabanı kullanıcısı) ya da `DATABASE_URL`. Bütün sorgular yine de salt
 * okunur işlemde çalışır.
 *
 *   node --env-file=../../.env scripts/reporting-mcp.js
 *
 * Standart çıktı protokole ayrılmıştır: log'lar stderr'e yazılır.
 */

const logger = {
  error: (context, message) => process.stderr.write(`${message ?? ''} ${JSON.stringify({ error: context?.err?.message, tool: context?.tool })}\n`),
};

async function shutdown() {
  await disconnectReporting();
  await prismaUnfiltered.$disconnect();
  process.exit(0);
}

try {
  const hotelId = await resolveHotelId();
  await serveStdio(createReportingMcpServer({ hotelId, actor: 'mcp:stdio', logger }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
  process.stdin.once('end', shutdown);
} catch (error) {
  process.stderr.write(`Raporlama MCP sunucusu açılamadı: ${error.message}\n`);
  process.exit(1);
}
