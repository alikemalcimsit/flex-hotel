import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { NAV_SECTIONS } from '../layout/navigation.js';

/**
 * Kılavuz kapsam denetimi: yeni bir menü sayfası eklenip kılavuzda anlatılmazsa bu test düşer — "geliştirme yapılınca
 * kılavuza eklensin" kuralının bekçisi. Anlatım elle yazılan bölümlerde (01–50) aranır; otomatik üretilen teknik
 * referans (90) sayılmaz (orada her yol zaten listelenir).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function handWrittenText() {
  const files = (await readdir(HERE)).filter((name) => /^\d{2}-.*\.md$/.test(name) && !name.startsWith('9'));
  const texts = await Promise.all(files.map((name) => readFile(path.join(HERE, name), 'utf8')));
  return { files, text: texts.join('\n') };
}

describe('kılavuz kapsamı', () => {
  it('her menü sayfası elle yazılan bölümlerde yoluyla ya da adıyla anlatılıyor', async () => {
    const { files, text } = await handWrittenText();
    assert.ok(files.length >= 5, `kılavuz bölümleri eksik: ${files.join(', ')}`);
    const missing = [];
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const entries = [item, ...(item.children ?? [])];
        for (const entry of entries) {
          if (!entry.to) continue;
          const mentioned = text.includes(entry.to) || text.includes(`**${entry.label}**`) || text.includes(`${item.label} → ${entry.label}`);
          if (!mentioned) missing.push(`${section.title} › ${item.label}${entry === item ? '' : ` › ${entry.label}`} (${entry.to})`);
        }
      }
    }
    assert.deepEqual(missing, [], `Kılavuzda anlatılmayan sayfalar var; ilgili bölüme yolunu (ör. ${missing[0]?.match(/\((.+)\)/)?.[1]}) ya da **adını** içeren bir anlatım ekleyin:\n${missing.join('\n')}`);
  });

  it('otomatik teknik referans üretilmiş ve güncel biçimde', async () => {
    const text = await readFile(path.join(HERE, '90-teknik-referans.md'), 'utf8');
    for (const heading of ['## Menü haritası', '## İzinler ve roller', '## Aktörler', '## Olay kataloğu', '## Zamanlanmış işler', '## Veri modeli', '## Modül durumu']) {
      assert.ok(text.includes(heading), `${heading} bölümü yok — npm run kilavuz`);
    }
    assert.ok(!text.includes('Bu bölüm üretilemedi'), 'teknik referansta üretilemeyen bölüm var — npm run kilavuz çıktısına bakın');
  });
});
