import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Anket ve memnuniyet (modül 55) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: davetin zamanı (çıkış sonrası ertesi gün saatinde, ara anket girişin ertesi günü; kısa konaklamaya ve saatten
 * önce gitmez), aynı misafire sıklık sınırı, iletişimsiz misafirde davetin harcanmaması; misafirin formu (imza, dil,
 * açılış), zorunlu soru, tek gönderim, süresi dolan ve değişen anket; düşük puanda takip + zil + işlem kaydında yorum
 * yok; liste süzgeçleri, ayrıntı, NPS raporu (dağılım, seçenek, eğilim, cevap oranı); takibin üstlenme / görüşme /
 * kapatma / yeniden açma ve sürüm kilidi; tasarımın sürüm kilidi, tek NPS, cevaplanmış sorunun arşivi; AI sonucunun
 * listeyle sınırlanması ve özetin girdisinde kişisel veri olmaması; portalda açık anket; izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const HOUSEKEEPER = 'kat@test.local';
const BASE = 'https://otel.example.com';
const SETTINGS = {
  postStayEnabled: true,
  postStayDelayDays: 1,
  postStaySendHour: 11,
  midStayEnabled: true,
  midStaySendHour: 18,
  midStayMinNights: 2,
  minDaysBetweenSurveys: 30,
  linkValidDays: 14,
  lowNpsThreshold: 6,
  lowRatingThreshold: 2,
  googleReviewUrl: 'https://g.page/r/demo-otel/review',
  tripadvisorReviewUrl: '',
};

describe('anket ve memnuniyet (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let invites;
  /** @type {any} */ let design;
  /** @type {any} */ let responses;
  /** @type {any} */ let shared;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {Map<string, string>} */ let tokens;
  let hotelId;
  let otherHotelId;
  let roomType;
  let rooms;
  let roomIndex;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    invites = await import('./invites.js');
    design = await import('./design.js');
    responses = await import('./responses.js');
    shared = await import('./shared.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  /** Otel saatiyle an. */
  const wall = (day, time) => contracts.zonedWallTimeToUtc(`${day}T${time}`, ZONE);

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    roomIndex = 0;
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `S${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', phone: '+903120000000' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
        { hotelId: otherHotelId, email: 'baska@test.local', name: 'Başka Müdür', role: 'MANAGER', passwordHash },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 3, capacityChildren: 2 } });
    rooms = [];
    for (let index = 1; index <= 8; index += 1) rooms.push(await db.room.create({ data: { hotelId, number: `${100 + index}`, roomTypeId: roomType.id } }));
    await db.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'otel@example.com' } } });
    await db.guestPortalSettings.create({ data: { hotelId, publicBaseUrl: BASE } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const open = (method, url, payload) => app.inject({ method, url, payload });
  const json = (response, status = 200) => {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  };
  const saveSettings = async (extra = {}) => json(await call('PUT', '/surveys/settings', MANAGER, { ...SETTINGS, ...extra }));

  /**
   * Konaklama: çıkmış (dün çıktı) ya da içeride (dün girdi). Her biri ayrı odada.
   * @param {{ kind?: 'OUT' | 'IN', nights?: number, email?: string | null, guestId?: string, nationality?: string, lastName?: string }} [options]
   */
  async function seedStay({ kind = 'OUT', nights = 2, email = 'misafir@example.com', guestId, nationality = 'DE', lastName = 'Müller' } = {}) {
    const guest = guestId ? { id: guestId } : await db.guest.create({ data: { hotelId, firstName: 'Anna', lastName, nationality, email } });
    const room = rooms[roomIndex++];
    const out = kind === 'OUT';
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        checkIn: out ? wall(D(-1 - nights), '14:00') : wall(D(-1), '14:00'),
        checkOut: out ? wall(D(-1), '10:00') : wall(D(-1 + nights), '10:00'),
        status: out ? 'CHECKED_OUT' : 'CHECKED_IN',
        adults: 2,
        children: 0,
        totalPrice: '6000.00',
        confirmationCode: `S${randomUUID().slice(0, 7).toUpperCase()}`,
        checkedInAt: out ? wall(D(-1 - nights), '15:00') : wall(D(-1), '15:00'),
        checkedInBy: DESK,
        ...(out ? { checkedOutAt: wall(D(-1), '10:00'), checkedOutBy: DESK } : {}),
      },
    });
  }
  const send = (time = '12:00') => as('sistem', () => invites.sendDueSurveys(hotelId, { now: wall(D(0), time) }));
  const tokenFor = async (reservationId, kind = 'POST_STAY') => shared.surveyToken(await db.surveyInvitation.findFirst({ where: { reservationId, kind } }));
  /** Varsayılan çıkış sonrası anketine cevap: NPS, bütün puanlar aynı, iş seyahati, iki yorum. */
  async function answersFor(token, { nps = 9, rating = 4, liked = 'Kahvaltı harikaydı', better = null } = {}) {
    const form = json(await open('GET', `/public/survey/${token}`));
    let texts = 0;
    return form.questions.map((question) => {
      if (question.type === 'NPS') return { questionId: question.id, score: nps };
      if (question.type === 'RATING') return { questionId: question.id, score: rating };
      if (question.type === 'CHOICE') return { questionId: question.id, choiceIds: ['business'] };
      texts += 1;
      return { questionId: question.id, text: texts === 1 ? liked : better };
    });
  }

  it('davet zamanı: çıkış sonrası ertesi gün saatinde bir kez; saatten önce, sık gelen misafire ve iletişimsize gitmez', async () => {
    await saveSettings({ midStayEnabled: false });
    const stay = await seedStay();
    const repeat = await seedStay();
    await seedStay({ guestId: repeat.guestId });
    const silent = await seedStay({ email: null });
    await db.surveyInvitation.create({ data: { hotelId, surveyId: (await design.ensureSurvey(hotelId, 'POST_STAY')).id, kind: 'POST_STAY', reservationId: (await seedStay({ guestId: repeat.guestId })).id, guestId: repeat.guestId, nonce: 'x', language: 'tr', sentAt: wall(D(-10), '11:00'), expiresAt: wall(D(4), '11:00') } });

    assert.deepEqual(await send('10:30'), { postStay: 0, midStay: 0 }, 'saat 11 olmadı');
    assert.deepEqual(await send('11:15'), { postStay: 1, midStay: 0 }, 'yalnız ilk misafir: diğeri 10 gün önce anket aldı, biri iletişimsiz');
    assert.deepEqual(await send('13:00'), { postStay: 0, midStay: 0 }, 'ikinci kez gitmez');
    const notification = await db.notification.findFirst({ where: { hotelId, reservationId: stay.id, source: 'SURVEY_POST_STAY' } });
    assert.match(notification.body, new RegExp(`${BASE}/misafir/a/[0-9a-f-]{36}\\.`));
    assert.equal(await db.surveyInvitation.count({ where: { reservationId: silent.id } }), 0, 'iletişimsiz misafirde davet harcanmaz');
    const invitation = await db.surveyInvitation.findFirst({ where: { reservationId: stay.id } });
    assert.deepEqual([invitation.language, invitation.status], ['de', 'SENT']);
  });

  it('ara anket: girişin ertesi günü 18:00’den; bir gecelik konaklamaya gitmez; açık anket misafir portalında görünür', async () => {
    await saveSettings({ postStayEnabled: false });
    const stay = await seedStay({ kind: 'IN', nights: 3 });
    await seedStay({ kind: 'IN', nights: 1 });
    assert.equal((await send('17:00')).midStay, 0);
    assert.equal((await send('18:30')).midStay, 1);
    const link = json(await call('POST', `/guest-portal/links/${stay.id}`, DESK));
    const overview = json(await open('GET', `/public/portal/${link.link.path.split('/').pop()}`));
    assert.match(overview.features.survey.path, /^\/misafir\/a\//);
    assert.equal(overview.features.survey.kind, 'MID_STAY');
  });

  it('misafir: form dört dilde, açılış işaretlenir; zorunlu soru boşsa 422; düşük puan takip + zil açar, işlem kaydında yorum yok; ikinci gönderim reddedilir', async () => {
    await saveSettings({ midStayEnabled: false });
    const stay = await seedStay();
    await send();
    const token = await tokenFor(stay.id);
    assert.equal((await open('GET', `/public/survey/${token.slice(0, -2)}AA`)).statusCode, 404, 'imza bozuk');
    const form = json(await open('GET', `/public/survey/${token}`));
    assert.deepEqual([form.state, form.language, form.questions.length, form.guestName], ['OPEN', 'de', 10, 'Anna M.']);
    assert.ok(form.questions[0].text.ru);
    assert.ok((await db.surveyInvitation.findFirst({ where: { reservationId: stay.id } })).openedAt);

    const answers = await answersFor(token, { nps: 3, rating: 2, better: 'Oda çok gürültülüydü, klima bozuktu' });
    const missing = await open('POST', `/public/survey/${token}`, { language: 'de', answers: answers.filter((answer) => answer.score === undefined || answer.score !== 3) });
    assert.equal(missing.statusCode, 422);
    assert.ok(Object.values(missing.json().fields).includes('Bu soru zorunlu'));

    const done = json(await open('POST', `/public/survey/${token}`, { language: 'de', answers }));
    assert.deepEqual(done.reviewLinks, [{ site: 'GOOGLE', url: SETTINGS.googleReviewUrl }], 'puandan bağımsız yorum bağlantısı');
    assert.equal((await open('POST', `/public/survey/${token}`, { language: 'de', answers })).json().code, 'SURVEY_ALREADY_ANSWERED');
    assert.equal(json(await open('GET', `/public/survey/${token}`)).state, 'ANSWERED');

    const response = await db.surveyResponse.findFirst({ where: { reservationId: stay.id } });
    assert.deepEqual([response.npsScore, response.npsCategory, Number(response.ratingAverage), response.lowScore, response.analysisStatus], [3, 'DETRACTOR', 2, true, 'SKIPPED']);
    const followUp = await db.surveyFollowUp.findFirst({ where: { responseId: response.id } });
    assert.ok(Math.abs(followUp.dueAt.getTime() - response.submittedAt.getTime() - 48 * 3_600_000) < 1000);
    assert.equal(await db.staffAlert.count({ where: { hotelId, kind: 'SURVEY_LOW_SCORE' } }), 1);
    const audit = JSON.stringify(await db.auditLog.findMany({ where: { hotelId, entity: 'SurveyResponse' } }));
    assert.ok(!audit.includes('gürültülü'), 'yorum işlem kaydına yazılmaz');
  });

  it('süresi dolan ve bu arada değişen anket: cevap alınmaz', async () => {
    await saveSettings({ midStayEnabled: false });
    const [first, second] = [await seedStay(), await seedStay()];
    await send();
    const expired = await tokenFor(first.id);
    await db.surveyInvitation.updateMany({ where: { reservationId: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(json(await open('GET', `/public/survey/${expired}`)).state, 'EXPIRED');
    assert.equal((await open('POST', `/public/survey/${expired}`, { language: 'tr', answers: [] })).json().code, 'SURVEY_EXPIRED');

    const token = await tokenFor(second.id);
    const answers = await answersFor(token);
    const survey = json(await call('GET', '/surveys/design/POST_STAY', MANAGER));
    const choice = survey.questions.find((question) => question.type === 'CHOICE');
    await as(MANAGER, () => design.removeQuestion(hotelId, 'POST_STAY', choice.id, { expectedVersion: survey.version }));
    assert.equal((await open('POST', `/public/survey/${token}`, { language: 'tr', answers })).json().code, 'SURVEY_CHANGED');
  });

  it('personel: liste süzgeçleri, ayrıntı, NPS raporu (dağılım, seçenek, eğilim, cevap oranı); başka otel ve kat görevlisi göremez', async () => {
    await saveSettings({ midStayEnabled: false });
    const stays = [await seedStay({ lastName: 'Kaya' }), await seedStay({ lastName: 'Demir' }), await seedStay({ lastName: 'Şahin' }), await seedStay({ lastName: 'Aydın' })];
    await send();
    const plan = [
      { nps: 10, rating: 5, liked: 'Personel çok ilgiliydi' },
      { nps: 8, rating: 4, liked: null },
      { nps: 3, rating: 2, liked: null, better: 'Asansör sürekli bozuktu' },
    ];
    for (const [index, answers] of plan.entries()) {
      const token = await tokenFor(stays[index].id);
      json(await open('POST', `/public/survey/${token}`, { language: 'tr', answers: await answersFor(token, answers) }));
    }
    const list = async (query) => json(await call('GET', `/surveys/responses?${query}`, DESK)).items;
    assert.equal((await list('')).length, 3);
    assert.equal((await list('category=DETRACTOR'))[0].reservation.guestName, 'Anna Şahin');
    assert.equal((await list('lowOnly=true')).length, 1);
    assert.equal((await list('withComment=true')).length, 2);
    assert.equal((await list('search=asansör')).length, 1, 'yorumda arama');
    assert.equal((await list(`search=${stays[0].confirmationCode}`)).length, 1);
    assert.equal((await list('search=as')).length, 3, 'üç harften kısa arama süzgeç değil');

    const low = (await list('lowOnly=true'))[0];
    const detail = json(await call('GET', `/surveys/responses/${low.id}`, DESK));
    assert.equal(detail.answers.length, 9);
    assert.equal(detail.answers.find((answer) => answer.type === 'CHOICE').choices[0], 'İş');
    assert.equal(detail.followUp.status, 'OPEN');
    assert.equal((await call('GET', `/surveys/responses/${low.id}`, 'baska@test.local')).statusCode, 404);
    assert.equal((await call('GET', '/surveys/responses', HOUSEKEEPER)).statusCode, 403);

    const report = json(await call('GET', `/surveys/report?kind=POST_STAY&from=${D(-6)}&to=${D(0)}`, MANAGER));
    assert.deepEqual([report.nps, report.responses, report.counts.promoters, report.counts.detractors, report.lowScores, report.comments], [0, 3, 1, 1, 1, 2]);
    assert.deepEqual([report.invitations.sent, report.invitations.responded, report.invitations.responseRate], [4, 3, 75]);
    const nps = report.questions.find((question) => question.type === 'NPS');
    assert.deepEqual([nps.answers, nps.distribution.find((row) => row.value === 10).count, nps.distribution.length], [3, 1, 11]);
    const room = report.questions.find((question) => question.topic === 'ROOM');
    assert.equal(room.average, 3.67);
    assert.equal(report.questions.find((question) => question.type === 'CHOICE').options.find((option) => option.id === 'business').count, 3);
    assert.equal(report.topics.find((row) => row.topic === 'CLEANLINESS').average, 3.67);
    assert.equal(report.trend.reduce((sum, row) => sum + row.responses, 0), 3);
    assert.equal(report.followUps.open, 1);
  });

  it('takip: üstlen (eski sürüm reddedilir), görüşme yaz, kapat (sonuç zorunlu), kapalıya not yazılmaz, yeniden aç', async () => {
    await saveSettings({ midStayEnabled: false });
    const stay = await seedStay();
    await send();
    const token = await tokenFor(stay.id);
    json(await open('POST', `/public/survey/${token}`, { language: 'tr', answers: await answersFor(token, { nps: 2, rating: 1, better: 'Oda kirliydi' }) }));
    const [row] = json(await call('GET', '/surveys/follow-ups', DESK)).items;
    assert.deepEqual([row.status, row.overdue, row.reservation.confirmationCode], ['OPEN', false, stay.confirmationCode]);

    const assigned = json(await call('POST', `/surveys/follow-ups/${row.id}/assign`, DESK, { expectedUpdatedAt: row.updatedAt, assignedTo: DESK }));
    assert.deepEqual([assigned.status, assigned.assignedTo], ['IN_PROGRESS', DESK]);
    assert.equal((await call('POST', `/surveys/follow-ups/${row.id}/assign`, DESK, { expectedUpdatedAt: row.updatedAt, assignedTo: MANAGER })).json().code, 'STALE_WRITE');
    assert.equal((await call('POST', `/surveys/follow-ups/${row.id}/assign`, DESK, { expectedUpdatedAt: assigned.updatedAt, assignedTo: 'yok@test.local' })).statusCode, 422);
    const noted = json(await call('POST', `/surveys/follow-ups/${row.id}/notes`, DESK, { kind: 'CONTACT', text: 'Misafir arandı, özür dilendi' }), 201);
    assert.equal(noted.notes[0].kind, 'CONTACT');
    assert.equal((await call('POST', `/surveys/follow-ups/${row.id}/resolve`, DESK, { expectedUpdatedAt: noted.updatedAt, outcome: 'COMPENSATED' })).statusCode, 400);
    const resolved = json(await call('POST', `/surveys/follow-ups/${row.id}/resolve`, DESK, { expectedUpdatedAt: noted.updatedAt, outcome: 'COMPENSATED', resolution: 'Bir gece ücretsiz konaklama teklif edildi' }));
    assert.deepEqual([resolved.status, resolved.outcome, resolved.resolvedBy], ['RESOLVED', 'COMPENSATED', DESK]);
    assert.equal((await call('POST', `/surveys/follow-ups/${row.id}/notes`, DESK, { text: 'ek not' })).json().code, 'FOLLOW_UP_RESOLVED');
    assert.equal(json(await call('GET', '/surveys/follow-ups?view=ACTIVE', DESK)).items.length, 0);
    const reopened = json(await call('POST', `/surveys/follow-ups/${row.id}/reopen`, MANAGER, { expectedUpdatedAt: resolved.updatedAt }));
    assert.deepEqual([reopened.status, reopened.outcome, reopened.resolution], ['IN_PROGRESS', null, null]);
    assert.equal((await call('POST', `/surveys/follow-ups/${row.id}/notes`, HOUSEKEEPER, { text: 'deneme' })).statusCode, 403);
  });

  it('tasarım: sürüm kilidi, tek NPS, cevaplanmış soru tipi değişmez ve arşive kalkar, cevapsız silinir, sıralama ve geri alma; ön büro değiştiremez', async () => {
    const survey = json(await call('GET', '/surveys/design/MID_STAY', MANAGER));
    assert.deepEqual([survey.questions.length, survey.missingLanguages], [2, []]);
    const choice = { type: 'CHOICE', text: { tr: 'Hangi hizmeti kullandınız?', en: 'Which service did you use?' }, topic: 'FACILITIES', options: [{ label: { tr: 'Spa' } }, { label: { tr: 'Havuz' } }], multiple: true };
    const added = json(await call('POST', '/surveys/design/MID_STAY/questions', MANAGER, { expectedVersion: survey.version, question: choice }));
    assert.deepEqual([added.version, added.questions.length, added.missingLanguages], [survey.version + 1, 3, ['en', 'de', 'ru']]);
    assert.ok(added.questions[2].options.every((option) => /^o-[0-9a-f]{8}$/.test(option.id)));
    assert.equal((await call('POST', '/surveys/design/MID_STAY/questions', MANAGER, { expectedVersion: survey.version, question: choice })).json().code, 'STALE_WRITE');
    const nps = { type: 'NPS', text: { tr: 'Tavsiye eder misiniz?' } };
    const withNps = json(await call('POST', '/surveys/design/MID_STAY/questions', MANAGER, { expectedVersion: added.version, question: nps }));
    assert.equal((await call('POST', '/surveys/design/MID_STAY/questions', MANAGER, { expectedVersion: withNps.version, question: nps })).json().code, 'SURVEY_NPS_EXISTS');
    assert.equal((await call('POST', '/surveys/design/MID_STAY/questions', DESK, { expectedVersion: withNps.version, question: choice })).statusCode, 403);

    // Cevaplanmış soru: ara anket cevabı.
    await saveSettings({ postStayEnabled: false });
    const stay = await seedStay({ kind: 'IN', nights: 3 });
    await send('19:00');
    const token = await tokenFor(stay.id, 'MID_STAY');
    const form = json(await open('GET', `/public/survey/${token}`));
    const overall = form.questions[0];
    json(await open('POST', `/public/survey/${token}`, { language: 'tr', answers: [{ questionId: overall.id, score: 5 }, { questionId: form.questions[3].id, score: 9 }] }));
    let current = json(await call('GET', '/surveys/design/MID_STAY', MANAGER));
    assert.equal(current.questions[0].answerCount, 1);
    assert.equal((await call('PUT', `/surveys/design/MID_STAY/questions/${overall.id}`, MANAGER, { expectedVersion: current.version, question: { type: 'TEXT', text: { tr: 'x' } } })).json().code, 'SURVEY_QUESTION_ANSWERED');
    current = json(await call('POST', `/surveys/design/MID_STAY/questions/${overall.id}/remove`, MANAGER, { expectedVersion: current.version }));
    assert.deepEqual([current.questions.length, current.archived.length, current.archived[0].id], [3, 1, overall.id], 'cevaplanmış soru arşivde');
    const unanswered = current.questions.find((question) => question.type === 'CHOICE');
    current = json(await call('POST', `/surveys/design/MID_STAY/questions/${unanswered.id}/remove`, MANAGER, { expectedVersion: current.version }));
    assert.equal(await db.surveyQuestion.count({ where: { id: unanswered.id } }), 0, 'cevapsız soru silindi');
    assert.equal((await call('POST', '/surveys/design/MID_STAY/order', MANAGER, { expectedVersion: current.version, questionIds: [current.questions[0].id] })).statusCode, 422);
    current = json(await call('POST', '/surveys/design/MID_STAY/order', MANAGER, { expectedVersion: current.version, questionIds: current.questions.map((question) => question.id).reverse() }));
    current = json(await call('POST', `/surveys/design/MID_STAY/questions/${overall.id}/restore`, MANAGER, { expectedVersion: current.version }));
    assert.equal(current.questions.at(-1).id, overall.id);
  });

  it('AI: etiket yalnız bekleyen cevaba ve listeden konularla yazılır; özetin girdisinde ad / onay kodu yok; AI kapalıyken özet istenemez', async () => {
    await saveSettings({ midStayEnabled: false });
    const stay = await seedStay({ lastName: 'Yıldırım' });
    await send();
    const token = await tokenFor(stay.id);
    json(await open('POST', `/public/survey/${token}`, { language: 'tr', answers: await answersFor(token, { nps: 5, rating: 3, better: 'Gece çok gürültü vardı' }) }));
    const response = await db.surveyResponse.findFirst({ where: { reservationId: stay.id } });
    await db.surveyResponse.update({ where: { id: response.id }, data: { analysisStatus: 'PENDING' } });
    assert.equal(await responses.completeAnalysis(hotelId, response.id, { status: 'DONE', sentiment: 'NEGATIVE', topics: ['NOISE', 'PARKING', 'NOISE', 'ROOM'], summary: 'Gece gürültüsünden şikâyet.', model: 'm' }), true);
    assert.equal(await responses.completeAnalysis(hotelId, response.id, { status: 'FAILED', model: 'm' }), false, 'ikinci kez yazılmaz');
    const tagged = await db.surveyResponse.findUnique({ where: { id: response.id } });
    assert.deepEqual([tagged.sentiment, tagged.topics, tagged.analysisStatus], ['NEGATIVE', ['NOISE', 'ROOM'], 'DONE']);
    assert.equal(json(await call('GET', '/surveys/responses?topic=NOISE', MANAGER)).items.length, 1);

    const insight = await db.surveyInsight.create({ data: { hotelId, kind: 'POST_STAY', fromDay: new Date(`${D(-6)}T00:00:00Z`), toDay: new Date(`${D(0)}T00:00:00Z`), requestedBy: MANAGER } });
    const input = await responses.insightInput(hotelId, insight.id);
    assert.equal(input.comments.length, 1);
    const text = JSON.stringify(input);
    assert.ok(!text.includes('Yıldırım') && !text.includes(stay.confirmationCode) && !text.includes('misafir@example.com'));
    assert.equal((await call('POST', '/surveys/insights', MANAGER, { kind: 'POST_STAY', from: D(-6), to: D(0) })).json().code, 'AI_UNAVAILABLE');
    assert.equal(json(await call('GET', `/surveys/insights?kind=POST_STAY&from=${D(-6)}&to=${D(0)}`, DESK)).available, false);
  });

  it('ayarlar: sürüm kilidi, https yorum bağlantısı, ön büro değiştiremez; ilk kayıtta anketler kurulur', async () => {
    const first = await saveSettings();
    assert.equal(first.publicBaseUrl, BASE);
    assert.equal(await db.survey.count({ where: { hotelId } }), 2);
    assert.equal((await call('PUT', '/surveys/settings', MANAGER, { ...SETTINGS })).json().code, 'STALE_WRITE');
    assert.equal((await call('PUT', '/surveys/settings', MANAGER, { ...SETTINGS, expectedUpdatedAt: first.updatedAt, googleReviewUrl: 'http://x' })).statusCode, 400);
    assert.equal((await call('PUT', '/surveys/settings', DESK, { ...SETTINGS, expectedUpdatedAt: first.updatedAt })).statusCode, 403);
    assert.equal(json(await call('GET', '/surveys/settings', DESK)).postStayEnabled, true);
  });
});
