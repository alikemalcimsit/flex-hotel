import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { openSecret, sealSecret, secretKeyConfigured } from './secret-box.js';

/**
 * Sır kutusu: yanlış çalışırsa ya otelin SMTP parolası veritabanında açık
 * durur ya da kaydedilen parola bir daha açılamaz.
 */

const env = { SETTINGS_SECRET_KEY: randomBytes(32).toString('base64') };
const otherEnv = { SETTINGS_SECRET_KEY: randomBytes(32).toString('base64') };

describe('secret-box', () => {
  it('şifreler ve aynı anahtarla açar; Türkçe karakter korunur', () => {
    const sealed = sealSecret('şifre-Çok-Gizli!', env);
    assert.equal(openSecret(sealed, env), 'şifre-Çok-Gizli!');
  });

  it('şifreli metin düz metni içermez ve her seferinde farklıdır', () => {
    const first = sealSecret('parola123', env);
    const second = sealSecret('parola123', env);
    assert.ok(!first.includes('parola123'));
    assert.notEqual(first, second);
    assert.ok(first.startsWith('v1:'));
  });

  it('başka anahtarla açılamaz', () => {
    const sealed = sealSecret('parola', env);
    assert.throws(() => openSecret(sealed, otherEnv), (error) => error.code === 'SECRET_UNREADABLE');
  });

  it('kurcalanmış kayıt açılmaz (bütünlük etiketi)', () => {
    const [version, iv, tag, data] = sealSecret('parola', env).split(':');
    const flipped = `${data.slice(0, -1)}${data.endsWith('A') ? 'B' : 'A'}`;
    assert.throws(() => openSecret([version, iv, tag, flipped].join(':'), env), (error) => error.code === 'SECRET_UNREADABLE');
    assert.throws(() => openSecret('bozuk', env), (error) => error.code === 'SECRET_UNREADABLE');
  });

  it('anahtar yoksa ya da boyu yanlışsa açıkça reddeder', () => {
    assert.equal(secretKeyConfigured({}), false);
    assert.equal(secretKeyConfigured({ SETTINGS_SECRET_KEY: randomBytes(16).toString('base64') }), false);
    assert.equal(secretKeyConfigured(env), true);
    assert.throws(() => sealSecret('x', {}), (error) => error.code === 'SECRET_KEY_MISSING');
  });
});
