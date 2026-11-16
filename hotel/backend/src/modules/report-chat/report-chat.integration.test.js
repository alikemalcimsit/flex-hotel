import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Rapor asistanı (modül 24) entegrasyon testleri: ajan yokken soru rapor talebi görevine düşer; sahte modelle soru →
 * rapor ajanı → MCP rapor aracı → tablo; kaydet / paylaş / AI'sız çalıştır (sahibi dışındaki değiştiremez); devam
 * sorusu önceki tanımı bağlam alır; metin cevap; bekleyen soru sınırı; izinler.
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';
const MODEL = 'ana-model';
const PRICES = { [MODEL]: { input: '2.5000', cachedInput: '1.2500', output: '10.0000' } };
const SPEC = { report: 'OCCUPANCY', period: 'LAST_MONTH', from: null, to: null, groupBy: 'WEEK', forecastDays: null, budgetScope: null };

/** Sahte model: sıradaki hazır cevabı döner; istekler kaydedilir; `gate` açılana kadar bekletir. */
const fakeModel = {
  calls: [],
  script: [],
  /** @type {Promise<void> | null} */
  gate: null,
  async chat(request) {
    this.calls.push(request);
    if (this.gate) await this.gate;
    const reply = this.script.shift() ?? { text: 'Bu soruyu mevcut raporlarla cevaplayamıyorum.' };
    return { text: reply.text ?? null, toolCalls: reply.toolCalls ?? [], usage: { inputTokens: 700, cachedInputTokens: 0, outputTokens: 90 } };
  },
};
const tool = (name, args) => ({ toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }] });

describe('Rapor asistanı (modül 24)', { skip }, () => {
  let app;
  let db;
  let core;
  let actors;
  let questions;
  let saved;
  let resetDatabase;
  let hotelId;
  let tokens;

  const MANAGER = 'mudur@hotel.local';
  const ACCOUNTANT = 'muhasebe@hotel.local';
  const HOUSEKEEPER = 'kat@hotel.local';
  const PASSWORD = 'Rapor-Test-1';

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    actors = await import('../../lib/actors.js');
    questions = await import('./questions.js');
    saved = await import('./saved.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await actors.actorRegistry?.idle();
    await app?.close();
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`${error.code}: ${error.message}`));

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    fakeModel.calls = [];
    fakeModel.script = [];
    tokens = new Map();
    const hotel = await db.hotel.create({ data: { name: 'Rapor Otel', code: `R${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' } });
    hotelId = hotel.id;
    const type = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'STD', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 } });
    await db.room.create({ data: { hotelId, number: '101', roomTypeId: type.id } });
    await db.room.create({ data: { hotelId, number: '102', roomTypeId: type.id } });
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
  });

  const enableAi = async () => {
    actors.registerAiAgents({ client: fakeModel });
    await db.aiSettings.create({ data: { hotelId, enabled: true, conciergeModel: MODEL, routerModel: MODEL, prices: PRICES, dailyBudgetUsd: '5' } });
    (await import('../../lib/cache.js')).cache.clear();
  };
  const ask = (actor, question, followUpOfId = null) => as(actor, () => questions.askQuestion(hotelId, { question, followUpOfId }));
  const answered = async (actor, id) => {
    await actors.actorRegistry.idle();
    return as(actor, () => questions.getQuestion(hotelId, id));
  };

  it('ajan yokken soru "cevaplanamadı" olur ve rapor talebi görevi açılır', async () => {
    const result = await ask(MANAGER, 'Geçen ayın haftalık doluluğu');
    assert.equal(result.status, 'FAILED');
    assert.match(result.failureReason, /AI anahtarı.*rapor talebi olarak personele iletildi/);
    const task = await db.manualTask.findFirst({ where: { hotelId } });
    assert.deepEqual([task.module, task.title], ['Rapor talebi', 'Rapor talebi: "Geçen ayın haftalık doluluğu"']);
    assert.match(task.description, new RegExp(MANAGER));
    const list = await as(MANAGER, () => questions.listQuestions(hotelId));
    assert.equal(list.available, false);
  });

  it('soru → ajan → MCP aracı → haftalık tablo; kullanım kaydı; kaydet, paylaş, AI\'sız çalıştır', async () => {
    await enableAi();
    fakeModel.script = [
      tool('run_report', SPEC),
      tool('present_report', { title: 'Geçen ayın haftalık doluluğu', comment: 'Doluluk geçen ay düşük seyretti.', spec: SPEC, chart: { type: 'LINE', series: ['occupancyPct', 'yok'] } }),
    ];
    const asked = await ask(MANAGER, 'Geçen ayın haftalık doluluğunu göster');
    assert.equal(asked.status, 'PENDING');
    const done = await answered(MANAGER, asked.id);
    assert.equal(done.status, 'READY', done.failureReason ?? '');
    assert.equal(done.title, 'Geçen ayın haftalık doluluğu');
    assert.match(done.periodLabel, /^Geçen ay \(1 /);
    assert.deepEqual(done.chart, { type: 'LINE', series: ['occupancyPct'] }, 'geçersiz seri ayıklandı');
    assert.equal(done.dataset.columns[0].key, 'period');
    assert.ok(done.dataset.rows.length >= 4 && done.dataset.rows.length <= 6, 'bir ayın haftaları');
    assert.equal(done.dataset.rows[0].sellable > 0, true);
    // Model aracın sonucunu gördü; talimat otelin bugününü taşıdı.
    assert.match(fakeModel.calls[1].messages.find((message) => message.role === 'tool').content, /occupancyPct/);
    assert.match(fakeModel.calls[0].messages[0].content, /Rapor Otel/);
    assert.equal(await db.llmUsage.count({ where: { hotelId, actorName: 'report-agent' } }), 2);

    // Başkasının sorusu görünmez.
    await rejects(as(ACCOUNTANT, () => questions.getQuestion(hotelId, asked.id)), 'NOT_FOUND');

    const report = await as(MANAGER, () => saved.saveReport(hotelId, { questionId: asked.id, title: 'Aylık doluluk (haftalık)', shared: false }));
    assert.deepEqual((await as(MANAGER, () => saved.listSavedReports(hotelId, { scope: 'MINE' }))).items.map((item) => item.title), ['Aylık doluluk (haftalık)']);
    assert.equal((await as(ACCOUNTANT, () => saved.listSavedReports(hotelId, { scope: 'SHARED' }))).items.length, 0);
    await rejects(as(ACCOUNTANT, () => saved.runSavedReport(hotelId, report.id)), 'NOT_FOUND');

    const shared = await as(MANAGER, () => saved.updateSavedReport(hotelId, report.id, { expectedUpdatedAt: new Date(report.updatedAt), shared: true }));
    assert.equal(shared.shared, true);
    const theirs = await as(ACCOUNTANT, () => saved.listSavedReports(hotelId, { scope: 'SHARED' }));
    assert.deepEqual(theirs.items.map((item) => [item.title, item.isMine]), [['Aylık doluluk (haftalık)', false]]);
    const callsBefore = fakeModel.calls.length;
    const run = await as(ACCOUNTANT, () => saved.runSavedReport(hotelId, report.id));
    assert.equal(fakeModel.calls.length, callsBefore, 'kayıtlı rapor AI çağırmaz');
    assert.equal(run.dataset.rows.length, done.dataset.rows.length);
    assert.match(run.periodLabel, /^Geçen ay/);
    await rejects(as(ACCOUNTANT, () => saved.updateSavedReport(hotelId, report.id, { expectedUpdatedAt: new Date(shared.updatedAt), title: 'Benim' })), 'FORBIDDEN');
    await rejects(as(ACCOUNTANT, () => saved.deleteSavedReport(hotelId, report.id)), 'FORBIDDEN');
    await as(MANAGER, () => saved.deleteSavedReport(hotelId, report.id));
    assert.equal(await db.savedReport.count({ where: { hotelId } }), 0);
  });

  it('devam sorusu önceki raporun tanımını bağlam alır; kapsam dışı soru metinle cevaplanır (kaydedilemez)', async () => {
    await enableAi();
    fakeModel.script = [tool('present_report', { title: 'Geçen ay doluluk', comment: 'Özet.', spec: SPEC, chart: { type: 'BAR', series: [] } })];
    const first = await answered(MANAGER, (await ask(MANAGER, 'Geçen ayın doluluğu')).id);
    assert.equal(first.status, 'READY');

    fakeModel.script = [{ text: 'Restoran satışları için rapor yok; doluluk, gelir, tahmin ve bütçe raporlarını hazırlayabilirim.' }];
    const follow = await answered(MANAGER, (await ask(MANAGER, 'Bunu restoran satışlarıyla karşılaştır', first.id)).id);
    const userMessage = fakeModel.calls.at(-1).messages[1].content;
    assert.match(userMessage, /Önceki rapor \(Geçen ay doluluk\) tanımı: \{.*"report":"OCCUPANCY".*"groupBy":"WEEK"/);
    assert.equal(follow.status, 'READY');
    assert.equal(follow.dataset, null);
    assert.match(follow.comment, /Restoran satışları/);
    await rejects(as(MANAGER, () => saved.saveReport(hotelId, { questionId: follow.id, title: 'X', shared: false })), 'VALIDATION');
  });

  it(`aynı anda en fazla 3 bekleyen soru; izinler (kat görevlisi soramaz)`, async () => {
    await enableAi();
    let open;
    fakeModel.gate = new Promise((resolve) => {
      open = resolve;
    });
    for (let index = 0; index < 3; index += 1) await ask(MANAGER, `Soru numarası ${index + 1}`);
    await rejects(ask(MANAGER, 'Dördüncü soru'), 'TOO_MANY_PENDING');
    open();
    fakeModel.gate = null;
    await actors.actorRegistry.idle();

    const login = async (email) => {
      if (!tokens.has(email)) tokens.set(email, (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } })).json().data.accessToken);
      return { authorization: `Bearer ${tokens.get(email)}` };
    };
    const denied = await app.inject({ method: 'POST', url: '/report-chat/questions', payload: { question: 'Bu ayın doluluğu' }, headers: await login(HOUSEKEEPER) });
    assert.equal(denied.statusCode, 403);
    const accepted = await app.inject({ method: 'POST', url: '/report-chat/questions', payload: { question: 'Bu ayın doluluğu' }, headers: await login(ACCOUNTANT) });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const history = await app.inject({ method: 'GET', url: '/report-chat/questions', headers: await login(ACCOUNTANT) });
    assert.deepEqual(history.json().data.items.map((item) => item.question), ['Bu ayın doluluğu']);
    assert.equal(history.json().data.available, true);
    await actors.actorRegistry.idle();
  });
});
