import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  channelConfigSchema,
  channelTestSchema,
  DEFAULT_NOTIFICATION_TEMPLATES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LANGUAGES,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_TRIGGERS,
  notificationLanguageFor,
  notificationRetryAt,
  notificationTemplateSchema,
  quietHoursRelease,
  renderTemplate,
  sanitizeSmsValue,
  smsInfo,
  staffAlertPreferencesSchema,
  templateVariables,
} from './notifications.js';

/**
 * Bildirim kuralları. Buradaki bir hata misafire yanlış bilgi gönderir
 * (başkasının odası, boş değişken), gece yarısı SMS attırır ya da faturayı
 * şişirir (yanlış parça sayısı).
 */

const issueFor = (result, field) => result.error?.issues.find((issue) => issue.path[0] === field)?.message;

describe('şablon doldurma', () => {
  it('değişkenler değeriyle, değeri olmayan boşla doldurulur', () => {
    assert.equal(
      renderTemplate('Sayın {misafirAdi}, odanız {odaNo}.', { misafirAdi: 'Ayşe Yılmaz', odaNo: null }),
      'Sayın Ayşe Yılmaz, odanız .',
    );
  });

  it('bilinmeyen değişken ve değişken olmayan süslü parantez olduğu gibi kalır', () => {
    assert.equal(renderTemplate('{kupon} { misafirAdi } {misafirAdi}', { misafirAdi: 'A' }), '{kupon} { misafirAdi } A');
  });

  it('değişken adları tekrarsız ve sırayla bulunur', () => {
    assert.deepEqual(templateVariables('{odaNo} {misafirAdi} {odaNo}'), ['odaNo', 'misafirAdi']);
  });

  it('değer içindeki süslü parantez yeniden yorumlanmaz', () => {
    assert.equal(renderTemplate('{misafirAdi} / {odaNo}', { misafirAdi: '{odaNo}', odaNo: '101' }), '{odaNo} / 101');
  });
});

describe('şablon doğrulama', () => {
  const base = { key: 'ROOM_ASSIGNED', channel: 'EMAIL', language: 'tr', subject: 'Odanız', body: 'Oda {odaNo}', isActive: true };

  it('rezervasyon onayında oda numarası kullanılamaz', () => {
    const result = notificationTemplateSchema.safeParse({ ...base, key: 'RESERVATION_CONFIRMED' });
    assert.match(issueFor(result, 'body'), /\{odaNo\}/);
  });

  it('konudaki bilinmeyen değişken de reddedilir', () => {
    const result = notificationTemplateSchema.safeParse({ ...base, subject: 'Merhaba {ad}' });
    assert.match(issueFor(result, 'subject'), /\{ad\}/);
  });

  it('e-posta konusuz olamaz; SMS konusuz olabilir', () => {
    assert.equal(issueFor(notificationTemplateSchema.safeParse({ ...base, subject: '' }), 'subject'), 'E-posta konusu zorunlu');
    assert.equal(notificationTemplateSchema.safeParse({ ...base, channel: 'SMS', subject: null }).success, true);
  });

  it('SMS şablonunda gönderilemeyen karakter reddedilir', () => {
    const result = notificationTemplateSchema.safeParse({ ...base, channel: 'SMS', body: 'Oda {odaNo} 🎉' });
    assert.match(issueFor(result, 'body'), /🎉/);
  });

  it('SMS şablonu örnek değerlerle 6 parçayı aşamaz', () => {
    const result = notificationTemplateSchema.safeParse({ ...base, channel: 'SMS', body: `{odaNo} ${'ş'.repeat(460)}` });
    assert.match(issueFor(result, 'body'), /en fazla 883/);
  });

  it('bütün varsayılan şablonlar geçerli ve her tetikleyici/dil için e-posta ile SMS var', () => {
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      const result = notificationTemplateSchema.safeParse({ ...template, isActive: true });
      assert.equal(result.success, true, `${template.key}/${template.channel}/${template.language}`);
    }
    for (const key of NOTIFICATION_TRIGGERS) {
      for (const language of NOTIFICATION_LANGUAGES) {
        for (const channel of ['EMAIL', 'SMS']) {
          assert.ok(
            DEFAULT_NOTIFICATION_TEMPLATES.some((t) => t.key === key && t.language === language && t.channel === channel),
            `${key}/${channel}/${language}`,
          );
        }
      }
    }
  });

  it('varsayılan SMS metinleri örnek değerlerle tek parça', () => {
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES.filter((t) => t.channel === 'SMS')) {
      assert.equal(smsInfo(renderTemplate(template.body, {})).segments <= 1, true);
    }
  });
});

describe('SMS uzunluğu', () => {
  it('Türkçe harf içermeyen metin standart kodlamayla 155 karaktere kadar tek parça', () => {
    const info = smsInfo('a'.repeat(155));
    assert.deepEqual([info.encoding, info.length, info.segments], ['GSM', 155, 1]);
    assert.equal(smsInfo('a'.repeat(156)).segments, 2);
  });

  it('ç ğ ı ş Ğ İ Ş Türkçe kodlamaya geçirir ve 2 karakter sayılır', () => {
    const info = smsInfo('ış');
    assert.deepEqual([info.encoding, info.length], ['TR', 4]);
  });

  it('ö ü Ö Ü Ç temel alfabededir, kodlamayı değiştirmez', () => {
    assert.deepEqual([smsInfo('öüÖÜÇ').encoding, smsInfo('öüÖÜÇ').length], ['GSM', 5]);
  });

  it('Türkçe metinde tek parça sınırı 150', () => {
    assert.equal(smsInfo(`ş${'a'.repeat(148)}`).segments, 1);
    assert.equal(smsInfo(`ş${'a'.repeat(149)}`).segments, 2);
  });

  it('genişletme karakterleri (€, [ ]) 2 sayılır', () => {
    assert.equal(smsInfo('€[]').length, 6);
  });

  it('uzun SMS sınırları: standart 912, Türkçe 883', () => {
    assert.equal(smsInfo('a'.repeat(912)).tooLong, false);
    assert.equal(smsInfo('a'.repeat(913)).tooLong, true);
    assert.equal(smsInfo('a'.repeat(912)).segments, 6);
    assert.equal(smsInfo(`ş${'a'.repeat(881)}`).tooLong, false);
    assert.equal(smsInfo(`ş${'a'.repeat(882)}`).tooLong, true);
  });

  it('desteklenmeyen karakterler raporlanır', () => {
    assert.deepEqual(smsInfo('merhaba 😀 Ł').invalidChars, ['😀', 'Ł']);
  });

  it('misafir adındaki desteklenmeyen harf en yakın karşılığına çevrilir', () => {
    assert.equal(sanitizeSmsValue('Łukasz Dvořák'), 'Lukasz Dvorak');
    assert.equal(sanitizeSmsValue('José Müller Şahin'), 'José Müller Şahin');
    assert.equal(sanitizeSmsValue('Ali 😀 Veli'), 'Ali ? Veli');
    assert.equal(sanitizeSmsValue('Иван'), '????');
    assert.equal(sanitizeSmsValue(null), '');
  });
});

describe('sessiz saatler', () => {
  const zone = 'Europe/Istanbul';
  const at = (iso) => new Date(iso);

  it('gece yarısını aşan aralıkta gece gönderim sabaha kalır', () => {
    // 23:30 İstanbul → ertesi gün 08:00 İstanbul (05:00Z)
    assert.equal(
      quietHoursRelease(at('2026-09-17T20:30:00Z'), zone, { start: '22:00', end: '08:00' }).toISOString(),
      '2026-09-18T05:00:00.000Z',
    );
    // 03:00 İstanbul → aynı gün 08:00
    assert.equal(
      quietHoursRelease(at('2026-09-18T00:00:00Z'), zone, { start: '22:00', end: '08:00' }).toISOString(),
      '2026-09-18T05:00:00.000Z',
    );
  });

  it('aralık dışında bekletilmez', () => {
    assert.equal(quietHoursRelease(at('2026-09-17T09:00:00Z'), zone, { start: '22:00', end: '08:00' }), null);
    assert.equal(quietHoursRelease(at('2026-09-17T05:00:00Z'), zone, { start: '22:00', end: '08:00' }), null, 'tam 08:00 serbest');
  });

  it('gün içi aralık (13:00–14:00) desteklenir', () => {
    assert.equal(
      quietHoursRelease(at('2026-09-17T10:15:00Z'), zone, { start: '13:00', end: '14:00' }).toISOString(),
      '2026-09-17T11:00:00.000Z',
    );
  });

  it('tanımsız ya da eşit aralık kısıt değildir', () => {
    assert.equal(quietHoursRelease(at('2026-09-17T20:30:00Z'), zone, { start: null, end: null }), null);
    assert.equal(quietHoursRelease(at('2026-09-17T20:30:00Z'), zone, { start: '22:00', end: '22:00' }), null);
  });

  it('otelin saat dilimine göre okunur', () => {
    // 23:30 UTC: Londra'da (BST) 00:30 → sessiz; İstanbul'da 02:30 → sessiz; Tokyo'da 08:30 → serbest
    const now = at('2026-09-17T23:30:00Z');
    assert.ok(quietHoursRelease(now, 'Europe/London', { start: '22:00', end: '08:00' }));
    assert.equal(quietHoursRelease(now, 'Asia/Tokyo', { start: '22:00', end: '08:00' }), null);
  });
});

describe('yeniden deneme', () => {
  const now = new Date('2026-09-17T10:00:00Z');

  it('aralıklar giderek uzar, hak bitince null', () => {
    assert.equal(notificationRetryAt(1, now).toISOString(), '2026-09-17T10:00:30.000Z');
    assert.equal(notificationRetryAt(2, now).toISOString(), '2026-09-17T10:02:00.000Z');
    assert.equal(notificationRetryAt(NOTIFICATION_MAX_ATTEMPTS, now), null);
  });
});

describe('dil seçimi', () => {
  it('Türk ya da uyruğu bilinmeyen misafire Türkçe, diğerlerine İngilizce', () => {
    assert.equal(notificationLanguageFor('TR'), 'tr');
    assert.equal(notificationLanguageFor(null), 'tr');
    assert.equal(notificationLanguageFor(' de '), 'en');
  });
});

describe('kanal ayarları', () => {
  it('açık e-posta kanalı sunucu ve gönderen ister; kapalıyken istemez', () => {
    const enabled = channelConfigSchema.safeParse({ channel: 'EMAIL', enabled: true, port: 587, security: 'STARTTLS' });
    assert.equal(issueFor(enabled, 'host'), 'SMTP sunucusu zorunlu');
    assert.equal(issueFor(enabled, 'fromAddress'), 'Gönderen adresi zorunlu');
    assert.equal(
      channelConfigSchema.safeParse({ channel: 'EMAIL', enabled: false, port: 587, security: 'STARTTLS' }).success,
      true,
    );
  });

  it('SMS başlığı 11 karakteri aşamaz; sessiz saatler birlikte girilir', () => {
    const result = channelConfigSchema.safeParse({
      channel: 'SMS',
      enabled: true,
      provider: 'NETGSM',
      username: '8503000000',
      sender: 'COKUZUNBASLIK',
      quietHoursStart: '22:00',
    });
    assert.match(issueFor(result, 'sender'), /11/);
    assert.match(issueFor(result, 'quietHoursEnd'), /birlikte/);
  });

  it('formdan boş gelen sessiz saatler "yok" sayılır; bozuk saat reddedilir', () => {
    const base = { channel: 'SMS', enabled: false, provider: 'NETGSM', username: '', sender: '' };
    const empty = channelConfigSchema.safeParse({ ...base, quietHoursStart: '', quietHoursEnd: '' });
    assert.equal(empty.success, true);
    assert.equal(empty.data.quietHoursStart, null);
    assert.equal(empty.data.quietHoursEnd, null);
    const broken = channelConfigSchema.safeParse({ ...base, quietHoursStart: '25:00', quietHoursEnd: '08:00' });
    assert.match(issueFor(broken, 'quietHoursStart'), /SS:DD/);
  });

  it('kanal ayar şeması her kanalı tanır', () => {
    for (const channel of NOTIFICATION_CHANNELS) {
      assert.notEqual(
        issueFor(channelConfigSchema.safeParse({ channel, enabled: false }), 'channel'),
        'Geçersiz kanal',
        channel,
      );
    }
  });

  it('parola gönderilmezse şemada yer almaz (kayıtlı parola korunur)', () => {
    const parsed = channelConfigSchema.parse({ channel: 'SMS', enabled: false, provider: 'NETGSM' });
    assert.equal(parsed.password, undefined);
  });

  it('test gönderiminde alıcı kanala uygun olmalı', () => {
    assert.equal(channelTestSchema.safeParse({ channel: 'EMAIL', to: 'yanlis' }).success, false);
    assert.equal(channelTestSchema.safeParse({ channel: 'SMS', to: '0532 111 00 01' }).success, true);
    assert.equal(channelTestSchema.safeParse({ channel: 'WHATSAPP', to: '905321110001' }).success, false);
  });
});

describe('uyarı tercihleri', () => {
  it('tekrarlanan tür tekilleştirilir, bilinmeyen tür reddedilir', () => {
    assert.deepEqual(
      staffAlertPreferencesSchema.parse({ mutedKinds: ['GUEST_MESSAGE', 'GUEST_MESSAGE'] }).mutedKinds,
      ['GUEST_MESSAGE'],
    );
    assert.equal(staffAlertPreferencesSchema.safeParse({ mutedKinds: ['HEPSI'] }).success, false);
  });
});
