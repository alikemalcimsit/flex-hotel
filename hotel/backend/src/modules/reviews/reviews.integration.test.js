import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Misafir yorumları (modül 54) — gerçek PostgreSQL; AI sahte model (ağ yok).
 *
 * Sınanan: Booking dosyası önizleme / yazma (olumlu + olumsuz birleşir, hatalı satır varken yazılmaz, aynı yorum ve dosya içi
 * tekrar atlanır, aynı yükleme ikinci kez yazılmaz); elle ekleme ve mükerrer; analiz kuyruğu → insight-agent → duygu, puan, konu,
 * departman, dil, cevap önerisi (kişi adı modele gitmez); personel etiketi ve cevap; trend; olumsuz konu artışı zili (bir kez);
 * silme; izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const HK = 'kat@test.local';
const MODEL = 'buyuk-model';

/** Sahte model: yorumun metnine göre etiket. */
const fakeModel = {
  calls: [],
  async chat(request) {
    this.calls.push(request);
    const usage = { inputTokens: 400, cachedInputTokens: 0, outputTokens: 120 };
    const body = JSON.parse(request.messages.at(-1).content);
    const dirty = /kirli|dirty|toz/i.test(body.review ?? '');
    return {
      text: JSON.stringify({
        sentiment: dirty ? 'NEGATIVE' : 'POSITIVE',
        score: dirty ? -70 : 80,
        topics: dirty ? ['CLEANLINESS', 'ROOM'] : ['STAFF', 'FOOD_BEVERAGE'],
        departments: dirty ? ['HOUSEKEEPING'] : ['FRONT_OFFICE'],
        language: /dirty/i.test(body.review ?? '') ? 'en' : 'tr',
        summary: dirty ? 'Oda kirliydi.' : 'Personel ve kahvaltı övüldü.',
        reply: `${dirty ? 'Yaşadığınız sorun için özür dileriz.' : 'Güzel yorumunuz için teşekkür ederiz.'} ${body.hotel}`,
      }),
      toolCalls: [],
      usage,
    };
  },
};

describe('misafir yorumları (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let actors;
  /** @type {any} */ let analysis;
  /** @type {any} */ let anomalies;
  /** @type {any} */ let aiSettings;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    actors = await import('../../lib/actors.js');
    analysis = await import('./analysis.js');
    anomalies = await import('./anomalies.js');
    aiSettings = await import('../concierge/settings.js');
    cache = await import('../../lib/cache.js');
    analysis.setReviewAutoKick(false);
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
    actors.registerAiAgents({ client: fakeModel });
  });

  after(async () => {
    await actors.actorRegistry?.idle();
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    fakeModel.calls = [];
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Deniz Otel', code: `R${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HK, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    await as(MANAGER, () =>
      aiSettings.saveAiSettings(hotelId, { enabled: true, routerModel: MODEL, conciergeModel: MODEL, prices: { [MODEL]: { input: '1.0000', cachedInput: '0.5000', output: '2.0000' } }, dailyBudgetUsd: '5.00', reservationStatus: 'CONFIRMED', hotelInfo: null, maxRepliesPerConversationDay: 40, expectedUpdatedAt: null }),
    );
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const analyze = async () => {
    const sent = await analysis.dispatchReviewAnalysis();
    await actors.actorRegistry.idle();
    return sent;
  };

  const bookingRows = () => [
    { reviewedAt: '20.11.2026', authorName: 'Hans M.', title: 'Gut', positive: 'Personel çok ilgiliydi, kahvaltı harika', negative: '', rating: '9,2' },
    { reviewedAt: day(-1), authorName: 'Ayşe K.', positive: '', negative: 'Oda kirliydi, banyoda toz vardı', rating: '4' },
    { reviewedAt: day(-2), authorName: 'John D.', text: 'The room was dirty', rating: '5' },
  ];

  it('Booking dosyası: önizleme, hatalıyken yazılmaz, yazma, mükerrer ve tekrar; AI etiketi ve cevap önerisi (ad modele gitmez)', async () => {
    const requestId = randomUUID();
    const bad = await call('POST', '/reviews/import', MANAGER, { requestId, dryRun: false, source: 'BOOKING', fileName: 'booking.xlsx', rows: [...bookingRows(), { reviewedAt: 'dün', rating: '12' }] });
    assert.equal(bad.statusCode, 422);
    assert.equal(await db.review.count({ where: { hotelId } }), 0, 'hatalı satır varken hiçbiri yazılmaz');
    const preview = await call('POST', '/reviews/import', MANAGER, { requestId, dryRun: true, source: 'BOOKING', rows: [...bookingRows(), bookingRows()[0]] });
    assert.deepEqual(preview.json().data.summary, { total: 4, ok: 3, skipped: 1, errors: 0 });
    const written = await call('POST', '/reviews/import', MANAGER, { requestId, dryRun: false, source: 'BOOKING', fileName: 'booking.xlsx', rows: bookingRows() });
    assert.equal(written.statusCode, 200, written.body);
    assert.equal(written.json().data.summary.ok, 3);
    const replay = await call('POST', '/reviews/import', MANAGER, { requestId, dryRun: false, source: 'BOOKING', rows: bookingRows() });
    assert.equal(replay.json().data.replayed, true);
    const again = await call('POST', '/reviews/import', MANAGER, { requestId: randomUUID(), dryRun: true, source: 'BOOKING', rows: bookingRows() });
    assert.equal(again.json().data.summary.skipped, 3, 'aynı yorumlar ikinci dosyada atlanır');
    const hans = await db.review.findFirst({ where: { hotelId, authorName: 'Hans M.' } });
    assert.deepEqual([String(hans.rating), hans.ratingPct, hans.text, hans.analysisStatus], ['9.2', 92, 'Olumlu: Personel çok ilgiliydi, kahvaltı harika', 'PENDING']);

    assert.equal(await analyze(), 3);
    assert.ok(fakeModel.calls.every((request) => !JSON.stringify(request.messages).includes('Ayşe') && !JSON.stringify(request.messages).includes('Hans')), 'yazanın adı modele gitmez');
    const ayse = await db.review.findFirst({ where: { hotelId, authorName: 'Ayşe K.' } });
    assert.deepEqual([ayse.analysisStatus, ayse.sentiment, ayse.sentimentScore, ayse.topics, ayse.departments, ayse.language], ['DONE', 'NEGATIVE', -70, ['CLEANLINESS', 'ROOM'], ['HOUSEKEEPING'], 'tr']);
    assert.equal(ayse.suggestedReply, 'Yaşadığınız sorun için özür dileriz. Deniz Otel');
    assert.equal((await db.review.findFirst({ where: { hotelId, authorName: 'John D.' } })).language, 'en');
    assert.equal(await analyze(), 0, 'analiz edilen yeniden istenmez');

    const list = (await call('GET', '/reviews?sentiment=NEGATIVE&sort=lowest', DESK)).json().data;
    assert.equal(list.items.length, 2);
    assert.deepEqual([list.summary.unansweredNegative, list.summary.pendingAnalysis], [2, 0]);
  });

  it('elle ekleme ve mükerrer; personel etiketi; cevap; trend; olumsuz konu artışı zili bir kez; silme; izinler', async () => {
    const created = await call('POST', '/reviews', MANAGER, { source: 'GOOGLE', reviewedAt: day(0), rating: 5, text: 'Personel harika', authorName: 'Mehmet' });
    assert.equal(created.statusCode, 201, created.body);
    const duplicate = await call('POST', '/reviews', MANAGER, { source: 'GOOGLE', reviewedAt: day(0), rating: 5, text: 'personel   HARİKA', authorName: 'mehmet' });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((await call('POST', '/reviews', MANAGER, { source: 'GOOGLE', reviewedAt: day(0), rating: 7 })).statusCode, 400, 'Google en çok 5');
    const id = created.json().data.id;
    await analyze();
    const tagged = await call('PUT', `/reviews/${id}/tags`, MANAGER, { sentiment: 'MIXED', topics: ['STAFF'], departments: ['FRONT_OFFICE'] });
    assert.equal(tagged.json().data.analysis.manuallyTagged, true);
    const replied = await call('PUT', `/reviews/${id}/reply`, DESK, { status: 'REPLIED', replyText: 'Teşekkür ederiz!' });
    assert.deepEqual([replied.json().data.reply.status, replied.json().data.reply.repliedBy], ['REPLIED', DESK]);
    assert.equal((await call('PUT', `/reviews/${id}/reply`, DESK, { status: 'REPLIED', replyText: '' })).statusCode, 400);

    // Önceki 4 haftada haftada 1 temizlik şikâyeti, son 7 günde 3 → 3 kat.
    const rows = [
      ...[8, 15, 22, 29].map((offset, index) => ({ reviewedAt: day(-offset), text: `Oda kirliydi ${index}`, rating: '3' })),
      ...[0, 1, 2].map((offset, index) => ({ reviewedAt: day(-offset), text: `Banyo kirli, toz ${index}`, rating: '2' })),
    ];
    await call('POST', '/reviews/import', MANAGER, { requestId: randomUUID(), dryRun: false, source: 'TRIPADVISOR', rows });
    await analyze();
    assert.equal(await anomalies.detectHotelAnomalies(hotelId), 2, 'kirli oda yorumları temizlik ve oda konusunda');
    assert.equal(await anomalies.detectHotelAnomalies(hotelId), 0, 'aynı hafta ikinci zil yok');
    const titles = (await db.staffAlert.findMany({ where: { hotelId, kind: 'REVIEW' } })).map((row) => row.title).sort();
    assert.deepEqual(titles, ['Oda şikâyeti bu hafta 3 kat arttı', 'Temizlik şikâyeti bu hafta 3 kat arttı']);
    const trends = (await call('GET', '/reviews/trends?weeks=8', DESK)).json().data;
    assert.ok(trends.weeks.length >= 8);
    assert.equal(trends.weeks.reduce((sum, week) => sum + week.count, 0), 8);
    assert.equal(trends.topics.find((row) => row.topic === 'CLEANLINESS').negative, 7);
    assert.equal(trends.anomalies[0].factor, 3);

    assert.equal((await call('DELETE', `/reviews/${id}`, DESK)).statusCode, 403);
    assert.equal((await call('DELETE', `/reviews/${id}`, MANAGER)).statusCode, 200);
    assert.equal((await call('POST', '/reviews', MANAGER, { source: 'GOOGLE', reviewedAt: day(0), rating: 5, text: 'Personel harika', authorName: 'Mehmet' })).statusCode, 201, 'silinen yeniden eklenebilir');
    assert.equal((await call('GET', '/reviews', HK)).statusCode, 403);
    assert.equal((await call('POST', '/reviews/import', DESK, { requestId: randomUUID(), source: 'GOOGLE', rows: [{ reviewedAt: day(0), rating: 4 }] })).statusCode, 403);
  });
});
