import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNetgsmProvider, interpretReportJob, interpretSendResponse, netgsmNumber } from './netgsm.js';
import { ProviderError } from './provider-error.js';
import { classifySmtpError, createSmtpProvider, textToHtml, transportOptions } from './smtp.js';

/**
 * Sağlayıcı adaptörleri — ağa çıkmadan. Yanlış sınıflandırma ya kalıcı
 * hatayı sonsuza dek denetir (Netgsm hız sınırına takılır) ya da geçici
 * hatada misafiri bildirimsiz bırakır.
 */

const settings = { username: '8503000000', sender: 'DEMOOTEL' };

/** İstekleri kaydeden sahte fetch. */
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { status: next.status, json: async () => next.body };
  };
  return { fetchImpl, calls };
}

describe('Netgsm numara biçimi', () => {
  it('Türkiye numarası ulusal biçime, yurt dışı 00 ile gider', () => {
    assert.equal(netgsmNumber('905321110001'), '5321110001');
    assert.equal(netgsmNumber('447911123456'), '00447911123456');
    assert.equal(netgsmNumber('4915123456789'), '004915123456789');
  });

  it('90 ile başlayan ama Türkiye uzunluğunda olmayan numara yurt dışı sayılır', () => {
    assert.equal(netgsmNumber('9012345678'), '009012345678');
  });
});

describe('Netgsm cevabı', () => {
  it('00 ve iş kimliği başarıdır', () => {
    assert.deepEqual(interpretSendResponse(200, { code: '00', jobid: '17377215342605050417149344' }), {
      jobId: '17377215342605050417149344',
    });
  });

  it('kimlik ve başlık hataları kalıcı ve ayar sorunudur', () => {
    for (const code of ['30', '40']) {
      assert.throws(
        () => interpretSendResponse(406, { code }),
        (error) => error instanceof ProviderError && !error.retryable && error.configIssue && error.code === `NETGSM_${code}`,
      );
    }
  });

  it('metin ve parametre hataları kalıcıdır ama ayar sorunu değildir', () => {
    assert.throws(() => interpretSendResponse(406, { code: '20' }), (error) => !error.retryable && !error.configIssue);
    assert.throws(() => interpretSendResponse(406, { code: 70 }), (error) => !error.retryable);
  });

  it('hız sınırı ve sistem hataları geçicidir', () => {
    for (const code of ['80', '85', '100', '101']) {
      assert.throws(() => interpretSendResponse(406, { code }), (error) => error.retryable, code);
    }
  });

  it('başarı kodu var ama iş kimliği yoksa geçici sayılır, tanımsız kod da', () => {
    assert.throws(() => interpretSendResponse(200, { code: '00' }), (error) => error.retryable);
    assert.throws(() => interpretSendResponse(200, { code: '999' }), (error) => error.retryable);
  });

  it('HTTP 5xx ve 429 geçici, 401 kalıcıdır', () => {
    assert.throws(() => interpretSendResponse(503, null), (error) => error.retryable);
    assert.throws(() => interpretSendResponse(429, null), (error) => error.retryable);
    assert.throws(() => interpretSendResponse(401, null), (error) => !error.retryable && error.configIssue);
  });

  it('rapor durumları: 0 bekliyor, 1 iletildi, diğerleri iletilemedi', () => {
    assert.equal(interpretReportJob({ status: 0 }).state, 'PENDING');
    assert.equal(interpretReportJob({ status: '1' }).state, 'DELIVERED');
    const failed = interpretReportJob({ status: 3 });
    assert.deepEqual([failed.state, failed.code], ['FAILED', 'NETGSM_REPORT_3']);
    assert.equal(interpretReportJob({ status: 99 }).state, 'PENDING', 'bilinmeyen durum beklemede kalır');
  });
});

describe('Netgsm gönderimi', () => {
  it('Türkçe harfli metni TR kodlamasıyla, doğru numara ve başlıkla gönderir', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { code: '00', jobid: '123' } }]);
    const provider = createNetgsmProvider({ fetchImpl });
    const result = await provider.send({ settings, secret: 'gizli', to: '905321110001', text: 'Odanız 101' });

    assert.equal(result.providerMessageId, '123');
    assert.equal(calls[0].url, 'https://api.netgsm.com.tr/sms/rest/v2/send');
    assert.deepEqual(calls[0].body.messages, [{ msg: 'Odanız 101', no: '5321110001' }]);
    assert.equal(calls[0].body.msgheader, 'DEMOOTEL');
    assert.equal(calls[0].body.encoding, 'TR');
    assert.equal(calls[0].body.iysfilter, undefined, 'bilgilendirme iletisi');
    assert.equal(
      calls[0].init.headers.Authorization,
      `Basic ${Buffer.from('8503000000:gizli').toString('base64')}`,
    );
  });

  it('Türkçe harf yoksa kodlama gönderilmez', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { code: '00', jobid: '1' } }]);
    await createNetgsmProvider({ fetchImpl }).send({ settings, secret: 'x', to: '905321110001', text: 'Room 101' });
    assert.equal(calls[0].body.encoding, undefined);
  });

  it('ağ hatası geçici hatadır', async () => {
    const { fetchImpl } = fakeFetch([new TypeError('fetch failed')]);
    await assert.rejects(
      () => createNetgsmProvider({ fetchImpl }).send({ settings, secret: 'x', to: '905321110001', text: 'a' }),
      (error) => error.code === 'NETGSM_NETWORK' && error.retryable,
    );
  });

  it('rapor iş kimliklerini eşler; 60 "henüz yok" boş döner', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { code: '00', jobs: [{ jobid: 'a', status: 1 }, { jobid: 'b', status: 3 }] } },
      { status: 406, body: { code: '60' } },
    ]);
    const provider = createNetgsmProvider({ fetchImpl });
    const report = await provider.report({ settings, secret: 'x', jobIds: ['a', 'b'] });
    assert.equal(report.get('a').state, 'DELIVERED');
    assert.equal(report.get('b').state, 'FAILED');
    assert.deepEqual(calls[0].body.jobids, ['a', 'b']);
    assert.equal((await provider.report({ settings, secret: 'x', jobIds: ['c'] })).size, 0);
  });
});

describe('SMTP', () => {
  it('güvenlik seçimi nodemailer ayarına doğru çevrilir', () => {
    const base = { host: 'smtp.otel.com', port: 465, username: 'bildirim@otel.com' };
    assert.deepEqual(
      pick(transportOptions({ ...base, security: 'TLS' }, 'p')),
      { secure: true, requireTLS: false, ignoreTLS: false, auth: { user: 'bildirim@otel.com', pass: 'p' } },
    );
    assert.equal(transportOptions({ ...base, security: 'STARTTLS' }, 'p').requireTLS, true);
    assert.equal(transportOptions({ ...base, security: 'NONE', username: '' }, null).auth, undefined);
  });

  it('kimlik hatası kalıcı ayar sorunu, bağlantı hatası geçicidir', () => {
    assert.deepEqual(flags(classifySmtpError({ code: 'EAUTH' })), [false, true]);
    assert.deepEqual(flags(classifySmtpError({ code: 'ETIMEDOUT' })), [true, false]);
    assert.deepEqual(flags(classifySmtpError({ code: 'ECONNECTION' })), [true, false]);
  });

  it('5xx alıcı reddi kalıcı, 4xx geçicidir', () => {
    assert.deepEqual(flags(classifySmtpError({ code: 'EENVELOPE', responseCode: 550 })), [false, false]);
    assert.deepEqual(flags(classifySmtpError({ code: 'EENVELOPE', responseCode: 452 })), [true, false]);
    assert.equal(classifySmtpError({ responseCode: 421 }).code, 'SMTP_421');
  });

  it('sertifika hatası kalıcı ayar sorunudur', () => {
    assert.deepEqual(flags(classifySmtpError({ code: 'ESOCKET', message: 'self-signed certificate' })), [false, true]);
  });

  it('HTML gövde kaçışlanır, paragraflar korunur', () => {
    const html = textToHtml('Sayın <b>Ali</b>\nOda 101\n\nİyi günler & sevgiler');
    assert.ok(html.includes('Sayın &lt;b&gt;Ali&lt;/b&gt;<br>Oda 101</p>'));
    assert.ok(html.includes('İyi günler &amp; sevgiler'));
  });

  it('havuz aynı ayarda yeniden kullanılır, ayar değişince yenilenir', async () => {
    const created = [];
    const createTransport = (options) => {
      const transport = {
        options,
        closed: false,
        close() {
          this.closed = true;
        },
        async sendMail(mail) {
          return { messageId: `<${created.length}@test>`, rejected: [], mail };
        },
      };
      created.push(transport);
      return transport;
    };
    const provider = createSmtpProvider({ createTransport });
    const smtpSettings = { host: 'h', port: 587, security: 'STARTTLS', username: 'u', fromAddress: 'a@b.co', fromName: 'Otel' };
    const message = { hotelId: 'o1', settings: smtpSettings, secret: 'p', to: 'x@y.co', subject: 's', text: 't' };

    await provider.send(message);
    await provider.send(message);
    assert.equal(created.length, 1);
    assert.equal(created[0].options.pool, true);

    await provider.send({ ...message, secret: 'yeni' });
    assert.equal(created.length, 2);
    assert.equal(created[0].closed, true);
  });

  it('kullanıcı adı var ama parola yoksa gönderilmez', async () => {
    const provider = createSmtpProvider({ createTransport: () => assert.fail('bağlanmamalı') });
    await assert.rejects(
      () =>
        provider.send({
          hotelId: 'o',
          settings: { host: 'h', port: 587, security: 'STARTTLS', username: 'u', fromAddress: 'a@b.co' },
          secret: null,
          to: 'x@y.co',
          subject: 's',
          text: 't',
        }),
      (error) => error.code === 'SMTP_NO_PASSWORD' && error.configIssue,
    );
  });
});

function pick(options) {
  return { secure: options.secure, requireTLS: options.requireTLS, ignoreTLS: options.ignoreTLS, auth: options.auth };
}

function flags(error) {
  return [error.retryable, error.configIssue];
}
