#!/usr/bin/env node
/**
 * Kılavuzun **otomatik üretilen** teknik referans bölümü: `src/guide/90-teknik-referans.md`.
 *
 * Elle yazılan bölümler (01–50) anlatır; bu dosya koddan çıkarılan olguları listeler ki bir geliştirme yapılınca
 * kılavuz kendiliğinden güncellensin:
 *
 * - Menü haritası: `src/layout/navigation.js` (grup → sayfa → yol → gereken izin)
 * - İzinler ve roller: `@hotelos/hotel-contracts` izin kataloğu ve rol varsayılanları
 * - Aktörler: `hotel/workers`, `hotel/agents`, `shared/agents`, `shared/channels` altındaki bildirgeleri
 *   (ne dinler, ne yayınlar, kapalıyken iş hangi modüle düşer)
 * - Olaylar: `shared/core/events/catalog.js` (ad + kataloğun kendi açıklaması)
 * - Zamanlanmış işler: `hotel/backend/src/modules/<modül>/jobs.js` (açıklama + aralık sabitleri)
 * - Veri modeli: `schema.prisma` modelleri (ad, açıklama, alan sayısı)
 * - Modül durumu: `GOREVLER.md` ([x] / [ ] sayıları, "tamamlandı" notu)
 *
 * `npm run build` ve `npm run dev` öncesi kendiliğinden koşar (`prebuild` / `predev`); elle: `npm run kilavuz`.
 * Üretilen dosya depoya girer (derleme ortamında backend olmasa da kılavuz tam olsun diye).
 */
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const REPO = path.resolve(FRONTEND, '../..');
const OUT = path.join(FRONTEND, 'src/guide/90-teknik-referans.md');

const read = (file) => readFile(file, 'utf8').then((text) => text.replace(/\r\n/g, '\n'));
const exists = (file) => stat(file).then(() => true, () => false);
/** Markdown tablo hücresi: boru ve satır sonu kaçırılır. */
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const table = (headers, rows) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const code = (value) => `\`${value}\``;

/* ─────────────── Menü haritası ─────────────── */

async function menuSection() {
  const { NAV_SECTIONS } = await import(pathToFileURL(path.join(FRONTEND, 'src/layout/navigation.js')).href);
  const { PERMISSION_LABELS } = await import('@hotelos/hotel-contracts');
  const label = (item) => {
    if (item.permission) return PERMISSION_LABELS[item.permission] ?? item.permission;
    if (item.anyPermission?.length) return `şunlardan biri: ${item.anyPermission.map((p) => PERMISSION_LABELS[p] ?? p).join('; ')}`;
    return 'herkes (giriş yapmış)';
  };
  const lines = ['## Menü haritası', '', 'Sol menüdeki her sayfa, yolu ve görmek için gereken izin. Bir sayfa menüde yoksa ya izniniz yoktur ya da sayfa başka bir sayfadan (bağlantıyla) açılır.', ''];
  for (const section of NAV_SECTIONS) {
    lines.push(`### ${section.title}`, '');
    const rows = [];
    for (const item of section.items) {
      rows.push([`**${item.label}**`, code(item.to ?? '—'), label(item)]);
      for (const child of item.children ?? []) rows.push([`↳ ${child.label}`, code(child.to), child.permission || child.anyPermission ? label(child) : `üst menüyle aynı`]);
    }
    lines.push(table(['Sayfa', 'Yol', 'Kim görür'], rows), '');
  }
  return lines.join('\n');
}

/* ─────────────── İzinler ve roller ─────────────── */

async function permissionSection() {
  const { PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, ROLES, ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS } = await import('@hotelos/hotel-contracts');
  const lines = ['## İzinler ve roller', '', `Sistemde ${Object.keys(PERMISSIONS).length} izin var; roller bu izinlerin varsayılan paketleridir. Yönetici (Ayarlar → Kullanıcılar / roller) bir kullanıcıya izin ekleyip çıkarabilir. Aşağıdaki tablo **varsayılan** dağılımdır.`, ''];
  const roleHas = (role, permission) => (DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ? '✓' : '');
  for (const group of PERMISSION_GROUPS) {
    lines.push(`### ${group.label}`, '');
    lines.push(table(['İzin', 'Ne yaptırır', ...ROLES.map((role) => ROLE_LABELS[role] ?? role)], group.permissions.map((permission) => [code(permission), PERMISSION_LABELS[permission] ?? '', ...ROLES.map((role) => roleHas(role, permission))])), '');
  }
  return lines.join('\n');
}

/* ─────────────── Aktörler ─────────────── */

async function manifestFiles() {
  const roots = ['hotel/workers', 'hotel/agents', 'shared/agents', 'shared/workers', 'shared/channels'];
  const files = [];
  for (const root of roots) {
    const dir = path.join(REPO, root);
    if (!(await exists(dir))) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Bildirge çoğunlukla manifest.js'te; bazı paketler (bildirim işçisi, kanal geçitleri) index.js içinde tanımlar.
      for (const name of ['manifest.js', 'index.js']) {
        const file = path.join(dir, entry.name, name);
        if (await exists(file)) {
          files.push(file);
          break;
        }
      }
    }
  }
  return files;
}

async function actorSection() {
  const lines = ['## Aktörler (otomatik çalışan işçiler ve ajanlar)', '', 'Her aktör bir bildirgeyle tanımlıdır: hangi olayları dinler, hangilerini yayınlar, kapatılınca işi hangi modülün manuel görev listesine düşer. Aktörler **Aktörler** sayfasından otel başına açılıp kapatılır. Aşağıdaki metinler bildirgelerden alınmıştır.', ''];
  const rows = [];
  const seen = new Set();
  for (const file of await manifestFiles()) {
    let module;
    try {
      module = await import(pathToFileURL(file).href);
    } catch (error) {
      rows.push([path.relative(REPO, file), error.message.split('\n')[0]]);
      continue;
    }
    for (let value of Object.values(module)) {
      // Bazı bildirgeler ayarla üretilir (bildirim aktörü tetikleyici listesi alır): boş ayarla çağrılır.
      if (typeof value === 'function' && /Manifest$/.test(value.name)) {
        try {
          const { NOTIFICATION_TRIGGER_EVENTS = {} } = await import('@hotelos/hotel-contracts');
          const eventNames = Object.values(NOTIFICATION_TRIGGER_EVENTS).flat();
          value = value(Object.fromEntries(eventNames.map((name) => [name, {}])));
        } catch {
          continue;
        }
      }
      if (!value || typeof value !== 'object' || !value.name || !Array.isArray(value.subscribes) || seen.has(value.name)) continue;
      seen.add(value.name);
      lines.push(`### ${value.title ?? value.name} (${code(value.name)})`, '', `**Tür:** ${value.type ?? '—'} · **Paket:** ${code(value.packageName ?? '—')} · **Kapalıyken iş düşer:** ${value.fallbackModule ?? '—'}${value.retry ? ` · **Tekrar deneme:** ${value.retry.attempts} kez (${value.retry.backoffMs} ms artan bekleme)` : ''}`, '', value.description ?? '', '');
      lines.push(table(['Dinlediği olaylar', 'Yayınladığı olaylar', 'Onaya götürdüğü işler'], [[value.subscribes.map(code).join(', ') || '—', (value.publishes ?? []).map(code).join(', ') || '—', (value.requiresApproval ?? []).map(code).join(', ') || '—']]), '');
    }
  }
  if (rows.length) lines.push('### Bildirgesi okunamayan paketler', '', 'Bu paketlerin bildirgesi derleme ortamında yüklenemedi (bağımlılık gerektiriyor); Aktörler sayfasında yine görünürler.', '', table(['Paket', 'Sebep'], rows), '');
  return lines.join('\n');
}

/* ─────────────── Olaylar ─────────────── */

async function eventSection() {
  const file = path.join(REPO, 'shared/core/events/catalog.js');
  const source = await read(file);
  const { EVENT_CATALOG } = await import(pathToFileURL(file).href);
  /** Katalogdaki her olayın hemen üstündeki /** … *\/ ya da // açıklaması. */
  const docOf = new Map();
  const pattern = /(?:\/\*\*([\s\S]*?)\*\/\s*|\/\/[^\n]*\n\s*)?'([a-z0-9_.]+)':\s*(?:hotelScoped|z\.)/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1] ?? '';
    const text = raw.split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
    docOf.set(match[2], text);
  }
  const groups = new Map();
  for (const name of Object.keys(EVENT_CATALOG)) {
    const prefix = name.split('.')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(name);
  }
  const lines = ['## Olay kataloğu', '', `Sistem ${Object.keys(EVENT_CATALOG).length} tür olay yayınlar. Olay = "şu oldu" kaydı; aktörler ve ekranlar bunları dinler. Açıklamalar kataloğun kendi yorumlarından alınmıştır (boşsa olayın adı yeterince anlatıyor demektir).`, ''];
  for (const [prefix, names] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${prefix}.*`, '', table(['Olay', 'Açıklama'], names.map((name) => [code(name), docOf.get(name) ?? ''])), '');
  }
  return lines.join('\n');
}

/* ─────────────── Zamanlanmış işler ─────────────── */

async function jobsSection() {
  const dir = path.join(REPO, 'hotel/backend/src/modules');
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'jobs.js');
    if (!(await exists(file))) continue;
    const source = await read(file);
    const head = source.match(/\/\*\*([\s\S]*?)\*\//);
    // Dosya başı açıklaması olduğu gibi (çoğu modül orada "İş | Sıklık | Neden" tablosu tutar).
    const doc = head ? head[1].split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trimEnd()).join('\n').trim() : '';
    const intervals = [...source.matchAll(/const\s+([A-Z0-9_]+(?:_MS|_INTERVAL|INTERVAL_MS))\s*=\s*([^;]+);/g)].map((match) => `${code(match[1])} = ${match[2].replace(/\s+/g, ' ').trim()}`);
    rows.push(`### ${entry.name}\n\n${intervals.length ? `Aralık sabitleri: ${intervals.join(' · ')}\n\n` : ''}${doc || '_Açıklama yok._'}\n`);
  }
  return ['## Zamanlanmış işler', '', 'Olay beklemeden belirli aralıklarla kendiliğinden koşan işler (sunucu açıkken). Aralıklar koddaki sabitlerden okunur (ms: milisaniye; 60_000 = 1 dakika). Açıklamalar iş dosyalarının başındaki yorumlardır.', '', ...rows].join('\n');
}

/* ─────────────── Veri modeli ─────────────── */

async function modelSection() {
  const source = await read(path.join(REPO, 'hotel/backend/prisma/schema.prisma'));
  const rows = [];
  const scalars = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Decimal', 'Json', 'BigInt', 'Float', 'Bytes']);
  for (const match of source.matchAll(/^enum\s+(\w+)\s*\{/gm)) scalars.add(match[1]);
  const pattern = /((?:^\/\/\/[^\n]*\n)*)^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(pattern)) {
    const doc = match[1].split('\n').map((line) => line.replace(/^\/\/\/\s?/, '').trim()).filter(Boolean).join(' ');
    const body = match[3].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'));
    // İlişki alanları (başka bir modele işaret eden) sayılmaz; skaler ve enum alanlar sayılır.
    const fields = body.filter((line) => {
      const type = line.match(/^\w+\s+(\w+)/)?.[1];
      return type ? scalars.has(type) : false;
    });
    rows.push([code(match[2]), String(fields.length), doc]);
  }
  return ['## Veri modeli', '', `Veritabanında ${rows.length} tablo var. Açıklamalar şemadaki \`///\` yorumlarından; alan sayısı ilişkiler hariç yaklaşık değerdir.`, '', table(['Tablo', 'Alan', 'Açıklama'], rows), ''].join('\n');
}

/* ─────────────── Modül durumu ─────────────── */

async function moduleSection() {
  const source = await read(path.join(REPO, 'GOREVLER.md'));
  const rows = [];
  const parts = source.split(/^### /m).slice(1);
  for (const part of parts) {
    const title = part.split('\n')[0].trim();
    const match = title.match(/^(\d+)\.\s+(.+?)(?:\s+—\s+(.+))?$/);
    if (!match) continue;
    const done = (part.match(/^- \[x\]/gm) ?? []).length;
    const open = (part.match(/^- \[ \]/gm) ?? []).length;
    const finished = /📌\s*\*\*Modül \d+ tamamlandı/i.test(part) || (open === 0 && done > 0);
    const state = finished ? 'tamamlandı' : done > 0 ? `kısmi (${done}/${done + open})` : 'planlı';
    rows.push([match[1], match[2], match[3] ?? '', state]);
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]));
  return ['## Modül durumu', '', 'Geliştirme listesinden (GOREVLER.md) türetilir: işaretli maddeler ve "tamamlandı" notu. "Planlı" modüller için ekranlar henüz yoktur.', '', table(['No', 'Modül', 'Sorumlu', 'Durum'], rows), ''].join('\n');
}

/* ─────────────── Çıktı ─────────────── */

const sections = [
  ['Menü haritası', menuSection],
  ['İzinler ve roller', permissionSection],
  ['Aktörler', actorSection],
  ['Olay kataloğu', eventSection],
  ['Zamanlanmış işler', jobsSection],
  ['Veri modeli', modelSection],
  ['Modül durumu', moduleSection],
];
const parts = [
  '# Teknik referans (otomatik)',
  '',
  '> Bu bölüm **koddan üretilir**; elle düzenlenmez. Her derlemede (`npm run build`) ve geliştirme sunucusu açılışında yenilenir: menüye sayfa, sisteme izin, olay, aktör, zamanlanmış iş ya da tablo eklendiğinde burada kendiliğinden görünür. Anlatım için soldaki diğer bölümlere bakın.',
  '',
];
for (const [name, build] of sections) {
  try {
    parts.push(await build());
  } catch (error) {
    parts.push(`## ${name}`, '', `> Bu bölüm üretilemedi: ${error.message}`, '');
    console.error(`[kilavuz] ${name}: ${error.message}`);
  }
}
await writeFile(OUT, parts.join('\n'));
console.log(`[kilavuz] ${path.relative(REPO, OUT)} yazıldı (${parts.join('\n').split('\n').length} satır)`);
