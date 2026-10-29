import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Kataloğun ekran görüntüleri — gerçek uygulamadan, demo veriyle (gerçek misafir verisi girmez).
 *
 * Kurulu Edge (ya da Chrome) başsız çalıştırılır ve Chrome DevTools protokolüyle Node'un yerleşik
 * WebSocket'i üzerinden sürülür (ek paket yok). Uygulamaya bir kez giriş yapılır (oturum tarayıcının geçici
 * profilinde kalır), sonra her tanımdaki sayfa açılır, beklenen yazı görünene kadar beklenir, isteğe bağlı
 * bir eylem (sekme / pencere açma) çalıştırılır ve görüntü alınır.
 *
 * Giriş bilgisi ortamdan: KATALOG_EPOSTA, KATALOG_SIFRE (yerel önizlemenin demo hesabı; repoda tutulmaz).
 */

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const PORT = 9333;
const WIDTH = 1440;
const SCALE = 1.5;
const WAIT_MS = 20_000;
const SETTLE_MS = 900;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // tarayıcı daha açılmadı
    }
    await sleep(200);
  }
  throw new Error(`Tarayıcıya bağlanılamadı: ${url}`);
}

/** CDP oturumu: komut gönder, olay bekle. */
function session(socket) {
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method) {
      return new Promise((resolve) => {
        const listener = (message) => {
          if (message.method === method) {
            listeners.delete(listener);
            resolve(message.params);
          }
        };
        listeners.add(listener);
      });
    },
  };
}

/**
 * @param {{ base: string, email: string, password: string }} options
 */
export async function openBrowser({ base, email, password }) {
  const { existsSync } = await import('node:fs');
  const executable = BROWSERS.find((file) => existsSync(file));
  if (!executable) throw new Error('Edge / Chrome bulunamadı');
  const profile = await mkdtemp(path.join(tmpdir(), 'katalog-tarayici-'));
  const child = spawn(executable, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions', `--window-size=${WIDTH},900`, 'about:blank'], { stdio: 'ignore' });
  const targets = await json(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const cdp = session(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const navigate = async (url, height, width = WIDTH) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(WAIT_MS)]);
  };
  const waitFor = async (text) => {
    const started = Date.now();
    let stable = 0;
    while (Date.now() - started < WAIT_MS) {
      // Beklenen yazılar (büyük / küçük harf ve ı/i duyarsız) + yükleniyor göstergelerinin (yazı, dönen simge,
      // meşgul işareti) kaybolması; ikisi art arda iki kez tutunca sayfa hazır sayılır.
      const state = await evaluate(`(() => {
        const norm = (s) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i');
        const t = norm(document.body ? document.body.innerText : '');
        const wanted = ${JSON.stringify(text ?? '')}.split('|').filter(Boolean).every((part) => t.includes(norm(part)));
        const loading = t.includes('yükleniyor') || Boolean(document.querySelector('[aria-busy="true"], .animate-spin'));
        const failed = /yüklenemedi|bir hata oluştu/.test(t);
        return failed ? 'hata' : wanted && !loading ? 'hazir' : 'bekle';
      })()`).catch(() => 'bekle');
      if (state === 'hata') return false;
      stable = state === 'hazir' ? stable + 1 : 0;
      if (stable >= 2) return true;
      await sleep(300);
    }
    return false;
  };

  // Giriş: form doldurulur (React'in değer izleyicisi için yerel setter), gönderilir, giriş sayfasından çıkılana kadar beklenir.
  await navigate(`${base}/login`, 900);
  await waitFor('Giriş yap');
  await evaluate(`(() => {
    const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
    set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
    document.querySelector('form').requestSubmit();
  })()`);
  const started = Date.now();
  while ((await evaluate('location.pathname')) === '/login') {
    if (Date.now() - started > WAIT_MS) throw new Error('Giriş yapılamadı (önizleme ve demo hesabı açık mı?)');
    await sleep(250);
  }

  return {
    /**
     * @param {{ dosya: string, yol?: string, bul?: string, bekle?: string, eylem?: string, sonraBekle?: string, yukseklik?: number, genislik?: number, alan?: 'tam' | 'icerik' }} spec
     * @param {string} outDir
     */
    async shoot(spec, outDir) {
      // `bul`: kimliği önceden bilinmeyen sayfa — uygulamanın kendi API istemcisiyle (oturumlu) yol bulunur.
      const route = spec.bul ? await evaluate(`(async () => { const { api } = await import('/src/lib/api.js'); ${spec.bul} })()`) : spec.yol;
      if (!route) throw new Error(`${spec.dosya}: sayfa bulunamadı (demo verisi yüklü mü?)`);
      await navigate(`${base}${route}`, spec.yukseklik ?? 900, spec.genislik ?? WIDTH);
      if (!(await waitFor(spec.bekle))) throw new Error(`${spec.dosya}: sayfa hazır olmadı ya da hata gösterdi (${route}${spec.bekle ? `, beklenen: ${spec.bekle}` : ''})`);
      if (spec.eylem) {
        await evaluate(`(async () => { ${spec.eylem} })()`);
        if (spec.sonraBekle && !(await waitFor(spec.sonraBekle))) throw new Error(`${spec.dosya}: eylemden sonra "${spec.sonraBekle}" görünmedi`);
      }
      await sleep(SETTLE_MS);
      // Bildirim balonları görüntüye girmesin.
      await evaluate(`document.querySelectorAll('[role=status], [role=alert]').forEach((node) => { if (node.closest('[data-toast], .toast, [aria-live]')) node.style.display = 'none'; })`).catch(() => {});
      // Varsayılan: açık pencere varsa pencerenin kendisi, yoksa içerik alanı (yan menü ve üst çubuk dışarıda — A4'te yazı
      // okunaklı kalır); 'tam': bütün uygulama.
      const clip = spec.alan === 'tam' ? null : await evaluate("(() => { const dialog = document.querySelector('[role=dialog]'); const pad = dialog ? 14 : 0; const target = dialog ?? document.querySelector('main'); if (!target) return null; const r = target.getBoundingClientRect(); const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad); return { x: x + scrollX, y: y + scrollY, width: Math.min(r.width + pad * 2, innerWidth - x), height: Math.min(r.height + pad * 2, innerHeight - y), scale: 1 }; })()");
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, ...(clip ? { clip } : {}) });
      await writeFile(path.join(outDir, `${spec.dosya}.jpg`), Buffer.from(shot.data, 'base64'));
    },
    async close() {
      socket.close();
      child.kill();
      await sleep(400);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
