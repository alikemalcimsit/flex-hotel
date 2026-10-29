#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, collectEvents, collectMigrations, collectModels, collectPermissions, collectRoutes, describeFiles, measureCode } from './araclar/olgular.mjs';
import { MODULLER } from './moduller.mjs';

/**
 * FlexHotel modül kataloğu üreticisi.
 *
 *   node docs/katalog/uret.mjs                     # bütün modüller: olgular + görüntüler + modül PDF'leri + iki kitap
 *   node docs/katalog/uret.mjs --modul 45,43       # yalnız bu modüller (kitaplar yine bütün modüllerle)
 *   node docs/katalog/uret.mjs --adim veri,pdf     # adımlar: veri (olgular), goruntu, pdf (modül başına), kitap
 *   node docs/katalog/uret.mjs --adim kitap        # yalnız iki kitap: ürün kataloğu + teknik referans
 *
 * Gerekenler:
 * - veri: veritabanı gerekmez (rota eklentileri yüklenir, sorgu atılmaz); `DATABASE_URL` tanımlı olmalı.
 * - goruntu: demo verili önizleme açık (ön yüz KATALOG_TABAN, varsayılan http://localhost:5173) ve
 *   KATALOG_EPOSTA / KATALOG_SIFRE (önizlemenin demo hesabı). Edge ya da Chrome kurulu olmalı.
 * - pdf: Typst (KATALOG_TYPST ya da PATH'te `typst`). Fontlar `fontlar/` altında (OFL).
 *
 * Çıktı — iki ayrı kitap, iki ayrı tema (`veri/` bütün modüller için güncel olmalı):
 * - `cikti/FlexHotel-Urun-Katalogu.pdf`: müşteri — tanıtım, ekranlar, kim ne yapar (sablon/musteri.typ)
 * - `cikti/FlexHotel-Teknik-Referans.pdf`: teknik — mimari, veri modeli, API, izinler, olaylar, kurallar (sablon/teknik.typ)
 * - modül başına iki ayrı PDF, tek klasörde: `cikti/moduller/NN-slug-musteri.pdf` ve `cikti/moduller/NN-slug-teknik.pdf`
 *   (her yeni modül üretildikçe bu klasöre eklenir)
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const wanted = option('modul')?.split(',').map(Number);
const steps = (option('adim') ?? 'veri,goruntu,pdf,kitap').split(',');
const modules = MODULLER.filter((entry) => !wanted || wanted.includes(entry.numara));
if (modules.length === 0) {
  console.error('Seçilen modül katalog kaydında yok (moduller.mjs).');
  process.exit(1);
}

const pad = (numara) => String(numara).padStart(2, '0');
const key = (entry) => `${pad(entry.numara)}-${entry.slug}`;

/** İki kitabın kısımları (iş alanları); her modül tam bir alanda olmalı (yoksa kitap adımı durur). */
const ALANLAR = [
  { ad: 'Ön büro ve konaklama', aciklama: 'Oda envanterinden rezervasyona, oda planından giriş-çıkışa: resepsiyonun günlük işi.', moduller: [3, 4, 5, 6, 21] },
  { ad: 'Misafir iletişimi', aciklama: 'WhatsApp ve web sohbet, yapay zekâ asistanı, istekler ve otomatik bildirimler.', moduller: [7, 8, 9] },
  { ad: 'Hesap ve kasa', aciklama: 'Folyo, ödeme ve kasa; minibar ve çamaşır gibi ek hizmetlerin folyoya akışı.', moduller: [15, 17, 19] },
  { ad: 'Satış, dağıtım ve gelir', aciklama: 'Acente kontratları, promosyonlar, OTA kanalları; gelir raporu, tahmin ve bütçe.', moduller: [29, 31, 33, 35, 23, 25, 27] },
  { ad: 'Yiyecek-içecek ve etkinlik', aciklama: 'Restoran, oda servisi, banket ve etkinlik satışı; reçete ve mutfak planı.', moduller: [39, 41, 37, 43] },
  { ad: 'Satın alma ve stok', aciklama: 'Talepten teklife, siparişten mal kabulüne; depo ve stok hareketleri.', moduller: [45] },
  { ad: 'Yönetim ve denetim', aciklama: 'Ayarlar, roller ve yetkiler, onaylar, otomasyon paneli, canlı akış ve günlük durum.', moduller: [13, 1, 2, 11, 12, 10] },
];
const alanOf = (numara) => ALANLAR.find((alan) => alan.moduller.includes(numara))?.ad ?? '';

/* ─────────────── 1. Olgular ─────────────── */

async function buildFacts() {
  await mkdir(path.join(HERE, 'veri'), { recursive: true });
  const [routes, models, permissions, events] = await Promise.all([collectRoutes(), collectModels(), collectPermissions(), collectEvents()]);
  for (const entry of modules) {
    const migrations = await collectMigrations(entry.migrationlar ?? []);
    const tableNames = entry.tablolar ?? [...new Set(migrations.flatMap((migration) => migration.tables))];
    const backend = await measureCode([...(entry.arka ?? []), ...(entry.aktor ?? [])]);
    const frontend = await measureCode(entry.on ?? []);
    const contracts = await measureCode(entry.sozlesme ?? []);
    const moduleRoutes = routes.filter((route) => (entry.rotalar ?? []).some((pattern) => pattern.test(route.url)) && !(entry.rotaHaric ?? []).some((pattern) => pattern.test(route.url)));
    const facts = {
      bilgi: {
        numara: entry.numara,
        ad: entry.ad,
        slogan: entry.slogan,
        alan: alanOf(entry.numara),
      },
      kaynaklar: { arka: entry.arka ?? [], on: entry.on ?? [], sozlesme: entry.sozlesme ?? [], aktor: entry.aktor ?? [] },
      rotalar: moduleRoutes,
      tablolar: tableNames.map((name) => models.get(name)).filter(Boolean),
      kisitlar: [...new Set(migrations.flatMap((migration) => [...migration.checks, ...migration.partialUniques, ...migration.expressionUniques]))],
      migrationlar: migrations.map((migration) => ({ ad: migration.folder, satir: migration.lines, tablo: migration.tables.length })),
      izinler: [...permissions.byPermission.values()].filter((permission) => (entry.izinGruplari ?? []).includes(permission.group) || (entry.izinler ?? []).includes(permission.permission)),
      olaylar: events.filter((event) => (entry.olaylar ?? []).some((prefix) => event.name.startsWith(prefix))),
      kod: {
        arka: { dosya: backend.files, satir: backend.lines, test: backend.tests, entegrasyon: backend.integrationTests, testDosyalari: backend.testFiles },
        on: { dosya: frontend.files, satir: frontend.lines, test: frontend.tests },
        sozlesme: { dosya: contracts.files, satir: contracts.lines, test: contracts.tests },
      },
      dosyalar: await describeFiles([...(entry.sozlesme ?? []), ...(entry.arka ?? []), ...(entry.aktor ?? []), ...(entry.on ?? []), ...(entry.betik ?? [])]),
      ekranlar: Object.fromEntries((entry.ekranlar ?? []).map((shot) => [shot.dosya, { aciklama: shot.aciklama, var: existsSync(path.join(HERE, 'goruntuler', `${shot.dosya}.jpg`)) }])),
    };
    await writeFile(path.join(HERE, 'veri', `${pad(entry.numara)}.json`), JSON.stringify(facts, null, 1));
    console.log(`veri  ${key(entry)}: ${facts.rotalar.length} uç, ${facts.tablolar.length} tablo, ${facts.izinler.length} izin, ${facts.olaylar.length} olay, ${backend.tests + backend.integrationTests} backend testi`);
  }
}

/* ─────────────── 2. Ekran görüntüleri ─────────────── */

async function buildScreens() {
  const { openBrowser } = await import('./araclar/goruntu.mjs');
  if (!process.env.KATALOG_EPOSTA || !process.env.KATALOG_SIFRE) throw new Error('KATALOG_EPOSTA ve KATALOG_SIFRE tanımlı olmalı (önizlemenin demo hesabı)');
  const out = path.join(HERE, 'goruntuler');
  await mkdir(out, { recursive: true });
  const browser = await openBrowser({ base: process.env.KATALOG_TABAN ?? 'http://localhost:5173', email: process.env.KATALOG_EPOSTA, password: process.env.KATALOG_SIFRE });
  try {
    for (const entry of modules) {
      for (const shot of entry.ekranlar ?? []) {
        try {
          await browser.shoot(shot, out);
          console.log(`ekran ${shot.dosya}`);
        } catch (error) {
          console.error(`EKRAN HATASI ${shot.dosya}: ${error.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

/* ─────────────── 3. PDF ─────────────── */

function typstBinary() {
  if (process.env.KATALOG_TYPST) return process.env.KATALOG_TYPST;
  const local = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'tools/typst/typst-x86_64-pc-windows-msvc/typst.exe');
  return existsSync(local) ? local : 'typst';
}

function compile(wrapperPath, lines, output) {
  writeFileSync(wrapperPath, [...lines, ''].join('\n'));
  execFileSync(typstBinary(), ['compile', '--root', HERE, '--font-path', path.join(HERE, 'fontlar'), '--ignore-system-fonts', wrapperPath, output], { stdio: 'inherit' });
  console.log(`pdf   ${path.relative(REPO, output)}`);
}

/** Modül başına iki belge: müşteri ve teknik — ayrı şablon, ayrı tema. */
const SURUMLER = [
  { ad: 'musteri', sablon: 'musteri-belgesi' },
  { ad: 'teknik', sablon: 'teknik-belgesi' },
];

async function buildPdfs() {
  await mkdir(path.join(HERE, '.uret'), { recursive: true });
  await mkdir(path.join(HERE, 'cikti', 'moduller'), { recursive: true });
  for (const entry of modules) {
    const content = `/moduller/${key(entry)}.typ`;
    if (!existsSync(path.join(HERE, content))) {
      console.error(`İÇERİK YOK ${content}`);
      continue;
    }
    for (const surum of SURUMLER) {
      compile(
        path.join(HERE, '.uret', `${key(entry)}-${surum.ad}.typ`),
        [
          `#import "/sablon/${surum.ad}.typ": ${surum.sablon}`,
          `#import "${content}": ${surum.ad}`,
          `#let veri = json("/veri/${pad(entry.numara)}.json")`,
          `#${surum.sablon}(veri.bilgi, ${surum.ad}(veri))`,
        ],
        path.join(HERE, 'cikti', 'moduller', `${key(entry)}-${surum.ad}.pdf`),
      );
    }
  }
}

/* ─────────────── 4. Kitaplar ─────────────── */


async function buildBooks() {
  const placed = ALANLAR.flatMap((alan) => alan.moduller);
  const missing = MODULLER.filter((entry) => !placed.includes(entry.numara)).map((entry) => entry.numara);
  const unknown = placed.filter((numara) => !MODULLER.some((entry) => entry.numara === numara));
  if (missing.length || unknown.length || new Set(placed).size !== placed.length) {
    throw new Error(`Alan dağılımı hatalı — alansız: ${missing.join(', ') || '-'}; kayıtsız: ${unknown.join(', ') || '-'}; tekrar: ${placed.length - new Set(placed).size}`);
  }
  const byNumber = new Map(MODULLER.map((entry) => [entry.numara, entry]));
  const imports = placed.flatMap((numara) => [`#import "/moduller/${key(byNumber.get(numara))}.typ" as m${pad(numara)}`, `#let v${pad(numara)} = json("/veri/${pad(numara)}.json")`]);
  const areas = (part) =>
    ALANLAR.map(
      (alan) =>
        `(ad: ${JSON.stringify(alan.ad)}, aciklama: ${JSON.stringify(alan.aciklama)}, moduller: (${alan.moduller
          .map((numara) => `(bilgi: v${pad(numara)}.bilgi, veri: v${pad(numara)}, icerik: m${pad(numara)}.${part}(v${pad(numara)})),`)
          .join(' ')}))`,
    ).join(',\n  ');
  await mkdir(path.join(HERE, '.uret'), { recursive: true });
  await mkdir(path.join(HERE, 'cikti'), { recursive: true });
  // Kapaktaki test toplamı: modüllerin paylaştığı dosyalar (ör. actor-kit) bir kez sayılsın diye birleşimden.
  const all = await measureCode([...new Set(MODULLER.flatMap((entry) => [...(entry.arka ?? []), ...(entry.aktor ?? []), ...(entry.on ?? []), ...(entry.sozlesme ?? [])]))]);
  compile(path.join(HERE, '.uret', 'urun-katalogu.typ'), ['#import "/sablon/musteri.typ": urun-katalogu', ...imports, `#urun-katalogu((${areas('musteri')},))`], path.join(HERE, 'cikti', 'FlexHotel-Urun-Katalogu.pdf'));
  compile(path.join(HERE, '.uret', 'teknik-referans.typ'), ['#import "/sablon/teknik.typ": teknik-referans', ...imports, `#teknik-referans((${areas('teknik')},), toplam-test: ${all.tests + all.integrationTests})`], path.join(HERE, 'cikti', 'FlexHotel-Teknik-Referans.pdf'));
}

if (steps.includes('veri')) await buildFacts();
if (steps.includes('goruntu')) await buildScreens();
if (steps.includes('goruntu') && steps.includes('veri')) await buildFacts(); // ekran varlıkları güncellensin
if (steps.includes('pdf')) await buildPdfs();
if (steps.includes('kitap')) await buildBooks();
process.exit(0);
