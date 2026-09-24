import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aiSettingsSchema,
  normalizeOrigin,
  webchatChannelSchema,
  webchatMessageSchema,
  whatsappChannelSchema,
} from './concierge.js';

/**
 * Sohbetle rezervasyon sözleşmeleri (modül 8). AI açılırken maliyeti
 * sayılamayan (fiyatsız) model ya da sınırsız bütçe kabul edilmez; web chat
 * balonu yalnızca tanımlı sitelerde çalışır.
 */

const issuesOf = (result) => result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];
const PRICE = { input: '0.40', cachedInput: '0.10', output: '1.60' };

const settings = (overrides = {}) => ({
  enabled: true,
  routerModel: 'small-model',
  conciergeModel: 'large-model',
  prices: { 'small-model': PRICE, 'large-model': { input: '2', cachedInput: '0.5', output: '8' } },
  dailyBudgetUsd: '20',
  reservationStatus: 'CONFIRMED',
  hotelInfo: 'Havuz 09:00-19:00 açık.',
  maxRepliesPerConversationDay: 40,
  ...overrides,
});

describe('AI ayarları', () => {
  it('tam ayar kabul edilir', () => {
    const result = aiSettingsSchema.safeParse(settings());
    assert.equal(result.success, true, issuesOf(result).join('; '));
  });

  it('AI açıkken model, her modelin fiyatı ve pozitif bütçe zorunlu', () => {
    const issues = issuesOf(aiSettingsSchema.safeParse(settings({ routerModel: '', prices: {}, dailyBudgetUsd: '0' })));
    assert.ok(issues.some((issue) => issue.startsWith('routerModel')));
    assert.ok(issues.some((issue) => issue.startsWith('prices.large-model')));
    assert.ok(issues.some((issue) => issue.startsWith('dailyBudgetUsd')));
  });

  it('kapalıyken eksik ayar kaydedilebilir (hazırlık)', () => {
    assert.equal(aiSettingsSchema.safeParse(settings({ enabled: false, routerModel: '', conciergeModel: '', prices: {}, dailyBudgetUsd: '0' })).success, true);
  });

  it('model adı ve fiyat biçimi denetlenir', () => {
    assert.ok(issuesOf(aiSettingsSchema.safeParse(settings({ routerModel: 'bad model!' }))).some((i) => i.startsWith('routerModel')));
    assert.ok(issuesOf(aiSettingsSchema.safeParse(settings({ prices: { ...settings().prices, 'small-model': { ...PRICE, input: '-1' } } }))).length > 0);
  });
});

describe('site adresi (web chat)', () => {
  it('yalnızca köken kalır; https zorunlu, localhost için http serbest', () => {
    assert.equal(normalizeOrigin('https://otelim.com/rezervasyon?x=1'), 'https://otelim.com');
    assert.equal(normalizeOrigin('https://www.otelim.com:8443'), 'https://www.otelim.com:8443');
    assert.equal(normalizeOrigin('http://localhost:5173'), 'http://localhost:5173');
    assert.equal(normalizeOrigin('http://otelim.com'), null);
    assert.equal(normalizeOrigin('https://kullanici:parola@otelim.com'), null);
    assert.equal(normalizeOrigin('otelim.com'), null);
  });

  it('balon ayarı: adresler normalize edilir, tekrar atılır; bozuk adres alanıyla söylenir', () => {
    const ok = webchatChannelSchema.parse({
      enabled: true,
      allowedOrigins: ['https://otelim.com/', 'https://otelim.com/iletisim'],
      title: 'Deniz Otel',
      greeting: 'Merhaba!',
      accentColor: '#0f766e',
    });
    assert.deepEqual(ok.allowedOrigins, ['https://otelim.com']);
    const bad = webchatChannelSchema.safeParse({ enabled: true, allowedOrigins: ['otelim'], title: 'x', accentColor: '#000000' });
    assert.ok(issuesOf(bad).some((issue) => issue.startsWith('allowedOrigins.0')));
  });

  it('balon adressiz açılamaz (hiçbir sitede bağlanamazdı); kapalıyken adres gerekmez', () => {
    const open = webchatChannelSchema.safeParse({ enabled: true, allowedOrigins: [], title: 'Deniz Otel', accentColor: '#0f766e' });
    assert.ok(issuesOf(open).some((issue) => issue.startsWith('allowedOrigins')));
    assert.equal(webchatChannelSchema.safeParse({ enabled: false, allowedOrigins: [], title: 'Deniz Otel', accentColor: '#0f766e' }).success, true);
  });

  it('balondan gelen mesaj: kimlik uuid, metin boş olamaz ve sınırlı', () => {
    assert.equal(webchatMessageSchema.safeParse({ clientMessageId: crypto.randomUUID(), text: '  ' }).success, false);
    assert.equal(webchatMessageSchema.safeParse({ clientMessageId: 'x', text: 'merhaba' }).success, false);
    assert.equal(webchatMessageSchema.safeParse({ clientMessageId: crypto.randomUUID(), text: 'a'.repeat(2001) }).success, false);
    assert.equal(webchatMessageSchema.safeParse({ clientMessageId: crypto.randomUUID(), text: '15-18 Ekim 2 kişi' }).success, true);
  });
});

describe('WhatsApp ayarı', () => {
  it('açarken telefon numarası kimliği zorunlu ve rakamdan oluşur', () => {
    assert.ok(issuesOf(whatsappChannelSchema.safeParse({ enabled: true })).some((i) => i.startsWith('phoneNumberId')));
    assert.ok(issuesOf(whatsappChannelSchema.safeParse({ enabled: true, phoneNumberId: 'abc' })).some((i) => i.startsWith('phoneNumberId')));
    assert.equal(whatsappChannelSchema.safeParse({ enabled: true, phoneNumberId: '1234567890' }).success, true);
  });

  it('boş sır "değiştirme" demektir; kısa sır reddedilir', () => {
    const parsed = whatsappChannelSchema.parse({ enabled: false, accessToken: '', appSecret: '' });
    assert.equal(parsed.accessToken, null);
    assert.ok(issuesOf(whatsappChannelSchema.safeParse({ enabled: false, appSecret: 'kisa' })).some((i) => i.startsWith('appSecret')));
  });
});
