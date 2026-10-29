import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Kataloğun teknik olguları — elle yazılmaz, koddan çıkarılır (katalog kodla birlikte eskimesin):
 *
 * - **Rotalar:** uygulamanın kendi rota eklentileri ayrı bir Fastify örneğine kaydedilir (`onRoute` ile
 *   toplanır); her rotanın izin denetimi sahte bir istekle çalıştırılır ve hangi izni sorduğu kaydedilir
 *   (`requirePermission` / `requireAnyPermission` — sunucu tarafındaki gerçek kontrolün kendisi).
 * - **Tablolar:** `schema.prisma` model blokları (alan, ilişki, index / tekil sayısı, `///` açıklaması) ve
 *   modülün migration'larının `CREATE TABLE` / elle eklenmiş `CHECK` / kısmi tekil index'leri.
 * - **İzinler:** sözleşmedeki izin kataloğu (etiket, grup, rol varsayılanları).
 * - **Olaylar:** olay kataloğundaki adlar (öneke göre modüle düşer).
 * - **Test ve kod büyüklüğü:** modül klasörlerindeki test sayısı (`it(`) ve satır sayıları.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
const BACKEND = path.join(REPO, 'hotel/backend');

/** @param {string} file */
const read = (file) => readFile(file, 'utf8').then((text) => text.replace(/\r\n/g, '\n'));

/* ─────────────── Rotalar ─────────────── */

/**
 * app.js'teki rota eklentilerini (import + register önekleri) okur, ayrı bir Fastify örneğine kaydeder.
 * @returns {Promise<Array<{ method: string, url: string, permissions: string[], any: boolean, access: 'permission' | 'signed-in' | 'open' }>>}
 */
export async function collectRoutes() {
  const appFile = path.join(BACKEND, 'src/app.js');
  const source = await read(appFile);
  /** @type {Map<string, string>} eklenti adı → modül yolu */
  const imports = new Map();
  for (const match of source.matchAll(/^import \{([^}]+)\} from '(\.\/modules\/[^']+)';$/gm)) {
    for (const name of match[1].split(',').map((entry) => entry.trim()).filter(Boolean)) imports.set(name, match[2]);
  }
  const registrations = [...source.matchAll(/await app\.register\((\w+), \{ prefix: '([^']+)' \}\);/g)].map((match) => ({ name: match[1], prefix: match[2] })).filter((entry) => imports.has(entry.name));

  const { default: Fastify } = await import(pathToFileURL(path.join(BACKEND, 'node_modules/fastify/fastify.js')).href).catch(() => import('fastify'));
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('allowedOrigins', []);
  /** @type {any[]} */
  const routes = [];
  app.addHook('onRoute', (route) => routes.push(route));
  for (const entry of registrations) {
    const module = await import(pathToFileURL(path.join(BACKEND, 'src', imports.get(entry.name))).href);
    await app.register(module[entry.name], { prefix: entry.prefix });
  }
  await app.ready();

  const result = [];
  for (const route of routes) {
    const methods = [route.method].flat().filter((method) => method !== 'HEAD');
    const handlers = [route.preHandler, route.onRequest].flat().filter(Boolean);
    const permissions = [];
    let any = false;
    for (const handler of handlers) {
      if (!['permissionPreHandler', 'anyPermissionPreHandler'].includes(handler.name)) continue;
      any ||= handler.name === 'anyPermissionPreHandler';
      // Sahte istek: izin listesi her soruyu kaydeder ve "yok" der; denetim 403 atar, sorulanlar elde kalır.
      const asked = [];
      const request = { auth: { permissions: { includes: (permission) => (asked.push(permission), false) } } };
      await handler(request).catch(() => {});
      permissions.push(...asked);
    }
    // Erişim: izin(ler) / yalnız oturum (`requireAuth`) / izin denetimi yok (giriş, herkese açık bağlantı, imzalı webhook).
    const signedIn = handlers.some((handler) => handler.name === 'requireAuth');
    const access = permissions.length ? 'permission' : signedIn ? 'signed-in' : 'open';
    for (const method of methods) result.push({ method, url: route.url, permissions: [...new Set(permissions)], any, access });
  }
  await app.close();
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return result.sort((a, b) => a.url.localeCompare(b.url) || order.indexOf(a.method) - order.indexOf(b.method));
}

/* ─────────────── Şema ─────────────── */

/**
 * @returns {Promise<Map<string, { name: string, doc: string, fields: number, relations: number, indexes: number, uniques: number, enums: string[] }>>}
 */
export async function collectModels() {
  const schema = await read(path.join(BACKEND, 'prisma/schema.prisma'));
  const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((match) => match[1]));
  const models = new Map();
  for (const match of schema.matchAll(/((?:^\/\/\/[^\n]*\n)*)^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
    const [, docBlock, name, body] = match;
    const doc = docBlock
      .split('\n')
      .map((line) => line.replace(/^\/\/\/\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
    let fields = 0;
    let relations = 0;
    const usedEnums = new Set();
    for (const line of body.split('\n')) {
      const field = line.match(/^\s+(\w+)\s+([\w]+)(\[\])?(\?)?/);
      if (!field || line.trim().startsWith('//') || line.trim().startsWith('@@')) continue;
      if (/@relation|^[A-Z]/.test(field[2]) && !enums.has(field[2]) && !['String', 'Int', 'Decimal', 'DateTime', 'Boolean', 'Json', 'BigInt', 'Float', 'Bytes'].includes(field[2])) relations += 1;
      else fields += 1;
      if (enums.has(field[2])) usedEnums.add(field[2]);
    }
    models.set(name, {
      name,
      doc,
      fields,
      relations,
      indexes: (body.match(/@@index\(/g) ?? []).length,
      uniques: (body.match(/@@unique\(/g) ?? []).length + (body.match(/@unique/g) ?? []).length,
      enums: [...usedEnums],
    });
  }
  return models;
}

/**
 * Migration klasörlerindeki tablolar ve elle eklenmiş kısıtlar.
 * @param {string[]} folders
 */
export async function collectMigrations(folders) {
  const out = [];
  for (const folder of folders) {
    const sql = await read(path.join(BACKEND, 'prisma/migrations', folder, 'migration.sql'));
    out.push({
      folder,
      tables: [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]),
      checks: [...sql.matchAll(/ADD CONSTRAINT "(\w+)" CHECK/g)].map((match) => match[1]),
      partialUniques: [...sql.matchAll(/CREATE UNIQUE INDEX "(\w+)" ON "\w+"\([^)]*\)[^;]*WHERE/g)].map((match) => match[1]),
      expressionUniques: [...sql.matchAll(/CREATE UNIQUE INDEX "(\w+)" ON "\w+"\("hotelId", lower/g)].map((match) => match[1]),
      lines: sql.split('\n').length,
    });
  }
  return out;
}

/* ─────────────── İzin ve olay katalogları ─────────────── */

export async function collectPermissions() {
  const contracts = await import(pathToFileURL(path.join(REPO, 'hotel/contracts/index.js')).href);
  const labels = contracts.PERMISSION_LABELS ?? {};
  const groups = contracts.PERMISSION_GROUPS ?? [];
  const defaults = contracts.ROLE_DEFAULT_PERMISSIONS ?? contracts.DEFAULT_ROLE_PERMISSIONS ?? {};
  const roleLabels = contracts.ROLE_LABELS ?? {};
  const byPermission = new Map();
  for (const group of groups) {
    for (const permission of group.permissions) {
      byPermission.set(permission, {
        permission,
        label: labels[permission] ?? permission,
        group: group.key,
        groupLabel: group.label,
        roles: Object.entries(defaults)
          .filter(([, list]) => [...list].includes(permission))
          .map(([role]) => roleLabels[role] ?? role),
      });
    }
  }
  return { byPermission, groups };
}

export async function collectEvents() {
  const core = await import(pathToFileURL(path.join(REPO, 'shared/core/events/catalog.js')).href);
  const contracts = await import(pathToFileURL(path.join(REPO, 'hotel/contracts/index.js')).href);
  const labels = contracts.EVENT_LABELS ?? {};
  return Object.keys(core.EVENT_CATALOG).map((name) => ({ name, label: labels[name] ?? null }));
}

/* ─────────────── Test ve kod ─────────────── */

/**
 * Klasör ve dosyalar iç içe verilse de her dosya bir kez sayılır (toplamlar bütün modüllerin birleşimiyle de alınır).
 * @param {string[]} dirs repo köküne göre klasör / dosya
 * @returns {Promise<{ files: number, lines: number, tests: number, testFiles: string[], integrationTests: number }>}
 */
export async function measureCode(dirs) {
  const stats = { files: 0, lines: 0, tests: 0, integrationTests: 0, testFiles: [] };
  const counted = new Set();
  const visit = async (target) => {
    const full = path.join(REPO, target);
    let entries;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch {
      entries = null;
    }
    if (!entries) {
      if (!/\.(m?js|jsx)$/.test(full)) return;
      await count(full, target);
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (/\.(m?js|jsx)$/.test(entry.name)) await count(path.join(REPO, child), child);
    }
  };
  const count = async (file, relative) => {
    if (counted.has(path.resolve(file))) return;
    counted.add(path.resolve(file));
    const text = await read(file).catch(() => null);
    if (text === null) return;
    stats.files += 1;
    stats.lines += text.split('\n').length;
    if (/\.test\.m?js$/.test(file)) {
      const tests = (text.match(/^\s*it\(/gm) ?? []).length;
      if (/integration\.test/.test(file)) stats.integrationTests += tests;
      else stats.tests += tests;
      stats.testFiles.push(relative.replace(/\\/g, '/'));
    }
  };
  for (const dir of dirs) await visit(dir);
  return stats;
}

/* ─────────────── Dosya haritası ─────────────── */

/**
 * Klasörlerdeki kaynak dosyalar ve ilk belge yorumunun ilk cümlesi (dosyanın ne yaptığı). Test ve
 * index dosyaları atlanır.
 * @param {string[]} dirs repo köküne göre
 * @returns {Promise<Array<{ path: string, summary: string, lines: number }>>}
 */
export async function describeFiles(dirs) {
  const out = [];
  const visit = async (target) => {
    const full = path.join(REPO, target);
    let entries = null;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch {
      entries = null;
    }
    if (!entries) {
      if (/\.(m?js|jsx)$/.test(full) && !/\.test\.m?js$/.test(full)) await describe(full, target);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (/\.(m?js|jsx)$/.test(entry.name) && !/\.test\.m?js$/.test(entry.name)) await describe(path.join(REPO, child), child);
    }
  };
  const describe = async (file, relative) => {
    const text = await read(file).catch(() => null);
    if (text === null) return;
    // Dosyanın açıklaması: (1) dosya adıyla aynı adlı dışa aktarılan işlevin / bileşenin hemen üstündeki
    // yorum; (2) ardından boş satır gelen ilk blok yorum (modül açıklaması — sabitlerin yorumu doğrudan
    // tanıma bitişiktir); (3) ilk blok yorum.
    const base = path.basename(relative).replace(/\.(m?js|jsx)$/, '');
    const blocks = [...text.matchAll(/\/\*\*([\s\S]*?)\*\/(\s*)/g)];
    const named = blocks.find((match) => new RegExp(`^export (default )?(async )?function ${base}\\b`).test(text.slice(match.index + match[0].length)));
    const moduleDoc = blocks.find((match) => /\n\s*\n/.test(match[2]));
    const block = named ?? moduleDoc ?? blocks[0];
    let summary = '';
    if (block) {
      summary = block[1]
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, '').trim())
        .filter((line) => line && !line.startsWith('@'))
        .join(' ')
        .replace(/\s+/g, ' ');
      // İlk cümle; kısaltmalarda (bkz., ör., vb., vs., yak., No.) kesilmez.
      const sentence = /[.:](\s|$)/g;
      let cut = -1;
      for (const match of summary.matchAll(sentence)) {
        const before = summary.slice(0, match.index + 1);
        if (/(\b(bkz|ör|vb|vs|yak|No|örn|maks|min|sn|dk)\.)$/i.test(before)) continue;
        cut = match.index;
        break;
      }
      if (cut > 0) summary = summary.slice(0, cut + 1);
      if (summary.length > 220) summary = `${summary.slice(0, 217).replace(/\s+\S*$/, '')}…`;
    }
    out.push({ path: relative.replace(/\\/g, '/'), summary, lines: text.split('\n').length });
  };
  for (const dir of dirs) await visit(dir);
  return out;
}
