import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { openFile, removeFiles, saveFile, storageRoot } from './file-storage.js';

/** Akışı sonuna kadar okur. */
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('file-storage', () => {
  let root;
  let previous;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'hotelos-storage-'));
    previous = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = root;
  });

  after(async () => {
    if (previous === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  it('kökü ortam değişkeninden okur', () => {
    assert.equal(storageRoot(), path.resolve(root));
  });

  it('yazar, okur, siler; geçici dosya bırakmaz', async () => {
    const key = 'lost-items/hotel-1/photo-1.jpg';
    await saveFile(key, Buffer.from('merhaba'));
    const opened = await openFile(key);
    assert.equal(opened.size, 7);
    assert.equal((await readAll(opened.stream)).toString(), 'merhaba');
    assert.deepEqual(await readdir(path.join(root, 'lost-items', 'hotel-1')), ['photo-1.jpg']);

    assert.deepEqual(await removeFiles([key, 'lost-items/hotel-1/yok.jpg']), []);
    assert.equal(await openFile(key), null);
  });

  it('üzerine yazar (aynı anahtar)', async () => {
    const key = 'lost-items/hotel-1/photo-2.thumb.webp';
    await saveFile(key, Buffer.from('eski'));
    await saveFile(key, Buffer.from('yeni'));
    assert.equal((await readAll((await openFile(key)).stream)).toString(), 'yeni');
  });

  it('kök dışına çıkan ya da beklenmeyen anahtarı reddeder', async () => {
    for (const key of ['../x.jpg', 'lost-items/../../x.jpg', '/etc/passwd', 'lost-items/a b.jpg', 'lost-items/x', 'Lost/x.jpg', '']) {
      await assert.rejects(() => saveFile(key, Buffer.from('x')), /Geçersiz dosya anahtarı/, key);
    }
  });
});
