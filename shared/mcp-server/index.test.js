import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { connectInProcess, createReadOnlyMcpServer } from './index.js';

/**
 * Salt okunur MCP sunucusunun kuralları: girdi tam şemayla doğrulanır, iç
 * hata modele sızmaz, yazan araç kaydedilemez.
 */

const rangeInput = z
  .object({ from: z.string(), to: z.string() })
  .superRefine((value, ctx) => {
    if (value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

function server(handler) {
  return createReadOnlyMcpServer({
    name: 'test',
    version: '1.0.0',
    logger: { error() {} },
    tools: [{ name: 'echo_range', title: 'Aralık', description: 'Aralığı döndürür', input: rangeInput, readOnly: true, handler }],
  });
}

describe('salt okunur MCP sunucusu', () => {
  it('aracı salt okunur ipucuyla listeler, girdisini doğrulayıp sonucu yapılandırılmış döner', async () => {
    const { client, close } = await connectInProcess(server(async (input) => ({ days: input.from === input.to ? 1 : 2 })));
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ['echo_range']);
      assert.equal(tools[0].annotations.readOnlyHint, true);
      assert.deepEqual(Object.keys(tools[0].inputSchema.properties).sort(), ['from', 'to']);

      const ok = await client.callTool({ name: 'echo_range', arguments: { from: '2026-10-01', to: '2026-10-01' } });
      assert.equal(ok.isError, undefined);
      assert.deepEqual(ok.structuredContent, { days: 1 });

      // Alanlar arası kural (superRefine) da uygulanır; işleyici çalışmaz.
      const invalid = await client.callTool({ name: 'echo_range', arguments: { from: '2026-10-02', to: '2026-10-01' } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /to: Bitiş başlangıçtan önce olamaz/);
    } finally {
      await close();
    }
  });

  it('beklenmeyen hata iç ayrıntıyı sızdırmaz; beklenen hata mesajıyla döner', async () => {
    let calls = 0;
    const { client, close } = await connectInProcess(
      server(async () => {
        calls += 1;
        if (calls === 1) throw new Error('relation "Secret" does not exist');
        throw Object.assign(new Error('Rapor en fazla 2028-10-04 tarihine kadar alınır'), { statusCode: 422 });
      }),
    );
    try {
      const hidden = await client.callTool({ name: 'echo_range', arguments: { from: 'a', to: 'b' } });
      assert.equal(hidden.isError, true);
      assert.doesNotMatch(hidden.content[0].text, /Secret|relation/);
      const shown = await client.callTool({ name: 'echo_range', arguments: { from: 'a', to: 'b' } });
      assert.match(shown.content[0].text, /2028-10-04/);
    } finally {
      await close();
    }
  });

  it('salt okunur işaretlenmemiş araç kaydedilmez', () => {
    assert.throws(
      () =>
        createReadOnlyMcpServer({
          name: 'test',
          version: '1.0.0',
          tools: [{ name: 'delete_all', title: 'x', description: 'x', input: z.object({}), handler: async () => null }],
        }),
      /yalnızca salt okunur/,
    );
  });
});
