import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Sunucu diskindeki dosyalar (modül 21: kayıp eşya fotoğrafları).
 *
 * - Kök: `FILE_STORAGE_DIR` (üretimde uygulama klasörünün dışında, yedeğe
 *   alınan bir yol); verilmezse backend'in `storage/` klasörü (git'e girmez).
 * - Dosyalar **herkese açık değildir**: statik olarak sunulmaz, yalnızca yetki
 *   denetleyen route okur.
 * - Anahtar ("lost-items/<otel>/<id>.jpg") yalnızca servislerin ürettiği
 *   biçimdedir; `..` ve beklenmeyen karakter reddedilir (kök dışına çıkılamaz).
 * - Yazım atomiktir: geçici dosyaya yazılıp yeniden adlandırılır, yarım dosya
 *   okunmaz.
 */

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage');

/** "klasör/alt-klasör/dosya.uzantı": küçük harf klasör, kimlik + uzantı dosya adı. */
const SAFE_KEY = /^[a-z0-9-]+(\/[A-Za-z0-9-]+)*\/[A-Za-z0-9-]+(\.[a-z0-9]+)+$/;

/** Dosyalar yalnızca uygulama kullanıcısınca okunur. */
const FILE_MODE = 0o640;

export function storageRoot() {
  return path.resolve(process.env.FILE_STORAGE_DIR || DEFAULT_ROOT);
}

/**
 * @param {string} key
 * @returns {string} mutlak yol
 */
function resolveKey(key) {
  if (typeof key !== 'string' || !SAFE_KEY.test(key) || key.split('/').includes('..')) {
    throw new Error(`Geçersiz dosya anahtarı: ${key}`);
  }
  const root = storageRoot();
  const target = path.resolve(root, ...key.split('/'));
  if (!target.startsWith(root + path.sep)) throw new Error(`Geçersiz dosya anahtarı: ${key}`);
  return target;
}

/**
 * Dosyayı atomik yazar (varsa üzerine).
 * @param {string} key
 * @param {Buffer} buffer
 */
export async function saveFile(key, buffer) {
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { flag: 'wx', mode: FILE_MODE });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Okuma akışı ve boyutu; dosya yoksa `null`.
 * @param {string} key
 * @returns {Promise<{ stream: import('node:fs').ReadStream, size: number } | null>}
 */
export async function openFile(key) {
  const target = resolveKey(key);
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    return { stream: createReadStream(target), size: info.size };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Dosyaları siler; olmayan dosya hata değildir. Silinemeyenlerin anahtarları döner
 * (çağıran log'a yazar; veritabanı kaydı zaten gitti, dosya yetim kalır).
 * @param {string[]} keys
 * @returns {Promise<string[]>}
 */
export async function removeFiles(keys) {
  const results = await Promise.allSettled(keys.map((key) => rm(resolveKey(key), { force: true })));
  return keys.filter((_, index) => results[index].status === 'rejected');
}
