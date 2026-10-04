import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Salt okunur raporlama MCP sunucusu (modül 23; tüketicisi report-agent, 24).
 *
 * Bu paket ürün bilmez: araçları (ad, açıklama, zod girdi şeması, işleyici)
 * çağıran verir — otel raporlarının araçları `hotel/backend/src/modules/reports/mcp.js`.
 * Burada kurallar:
 *
 * - Her araç **salt okunur** işaretlenir (`readOnlyHint`); yazan araç kaydı reddedilir.
 * - Girdi, şemanın **tamamıyla** (alanlar arası kurallar dahil) doğrulanır;
 *   geçersiz girdi araç hatası olarak döner, işleyici çalışmaz.
 * - Beklenen hata (4xx, doğrulama) mesajıyla; beklenmeyen hata genel bir
 *   mesajla döner (iç ayrıntı — SQL, yığın izi — modele sızmaz), log'a düşer.
 * - Sonuç hem metin (JSON) hem yapılandırılmış içerik olarak döner.
 *
 * Bağlantı: aynı süreçte (ajan → `connectInProcess`) ya da stdio (`serveStdio`,
 * masaüstü MCP istemcileri).
 */

/**
 * @typedef {{
 *   name: string,
 *   title: string,
 *   description: string,
 *   input: import('zod').ZodObject<any>,
 *   readOnly: true,
 *   handler: (input: any) => Promise<unknown>,
 * }} ReadOnlyTool
 */

/** Modelin göreceği en uzun hata metni. */
const MAX_ERROR_TEXT = 500;

/**
 * @param {import('zod').ZodError} error
 */
function describeIssues(error) {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
    .slice(0, MAX_ERROR_TEXT);
}

/**
 * Hata beklenen mi (kullanıcıya / modele mesajı gösterilir)?
 * @param {any} error
 */
const isExpected = (error) => Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500;

/**
 * @param {string} text
 */
const toolError = (text) => ({ isError: true, content: [{ type: 'text', text: text.slice(0, MAX_ERROR_TEXT) }] });

/**
 * @param {{
 *   name: string,
 *   version: string,
 *   instructions?: string,
 *   tools: ReadOnlyTool[],
 *   logger?: { error: Function },
 * }} options
 * @returns {McpServer}
 */
export function createReadOnlyMcpServer({ name, version, instructions, tools, logger = console }) {
  const server = new McpServer({ name, version }, instructions ? { instructions } : undefined);
  const names = new Set();
  for (const tool of tools) {
    if (tool.readOnly !== true) throw new Error(`${tool.name}: yalnızca salt okunur araç kaydedilir`);
    if (names.has(tool.name)) throw new Error(`${tool.name}: aynı adla iki araç`);
    names.add(tool.name);

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        const parsed = tool.input.safeParse(args ?? {});
        if (!parsed.success) return toolError(`Geçersiz girdi: ${describeIssues(parsed.error)}`);
        try {
          const data = await tool.handler(parsed.data);
          return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: /** @type {any} */ (data) };
        } catch (error) {
          if (isExpected(error)) return toolError(error.message);
          logger.error?.({ err: error, tool: tool.name }, 'MCP aracı başarısız');
          return toolError('Rapor şu an üretilemedi; biraz sonra tekrar deneyin.');
        }
      },
    );
  }
  return server;
}

/**
 * Aynı süreçteki istemci (ajanlar): bağlı bir MCP istemcisi ve kapatıcı.
 * @param {McpServer} server
 * @param {{ name?: string, version?: string }} [clientInfo]
 * @returns {Promise<{ client: Client, close: () => Promise<void> }>}
 */
export async function connectInProcess(server, { name = 'hotelos-in-process', version = '1.0.0' } = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Stdio üzerinden sunar (standart çıktı protokole ayrılmıştır; log stderr'e).
 * @param {McpServer} server
 */
export async function serveStdio(server) {
  await server.connect(new StdioServerTransport());
}
