import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Anket ve memnuniyetin büyük veride süresi (modül 55; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-surveys.mjs
 *
 * 2500 kişilik bir otelin iki yılı: ölçüm otelinin çıkmış rezervasyonlarından 150.000'ine davet, 60.000 cevap (soru
 * başına cevap satırı, ~%15 düşük puan ve takibi, yorumların yarısında AI etiketi) her çalıştırmada baştan kurulur.
 * Ölçülen: rapor (30 gün, 1 yıl), cevap listesi (varsayılan, düşük puan, konu, arama, derin sayfa), ayrıntı, takip
 * listesi, misafirin formu ve gönderimi, AI özetinin girdisi (1 yıl) ve davet turu.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 3);
const ACTOR = 'perf-anket@hotel.local';
const INVITATIONS = 150_000;
const RESPONSES = 60_000;
const CHUNK = 2_000;
const DAY_MS = 86_400_000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const design = await import('../src/modules/surveys/design.js');
const responses = await import('../src/modules/surveys/responses.js');
const followUps = await import('../src/modules/surveys/followups.js');
const guest = await import('../src/modules/surveys/public.js');
const invites = await import('../src/modules/surveys/invites.js');
const { surveyToken } = await import('../src/modules/surveys/shared.js');

const hotelId = await resolveHotelId();
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
let seed = 55_2500;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let result;
  for (let round = 0; round < rounds; round += 1) {
    const at = performance.now();
    result = await fn();
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(58)} medyan ${String(Math.round(times[Math.floor(times.length / 2)])).padStart(6)} ms   en kötü ${String(Math.round(times.at(-1))).padStart(6)} ms`);
  return result;
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
console.log('Kurulum: önceki anket verisi siliniyor…');
await prisma.surveyFollowUpNote.deleteMany({ where: { hotelId } });
await prisma.surveyFollowUp.deleteMany({ where: { hotelId } });
await prisma.surveyAnswer.deleteMany({ where: { hotelId } });
await prisma.surveyResponse.deleteMany({ where: { hotelId } });
await prisma.surveyInvitation.deleteMany({ where: { hotelId } });
await prisma.surveyInsight.deleteMany({ where: { hotelId } });
await prisma.surveySettings.upsert({ where: { hotelId }, create: { hotelId, postStayEnabled: true, midStayEnabled: true, updatedBy: ACTOR }, update: { postStayEnabled: true, midStayEnabled: true } });
const post = await design.ensureSurvey(hotelId, 'POST_STAY');
const questions = await prisma.surveyQuestion.findMany({ where: { surveyId: post.id, archivedAt: null }, orderBy: { position: 'asc' } });
const today = core.toIsoDay(core.calendarDateInTimeZone('Europe/Istanbul'));
const now = new Date();

const stays = await prisma.reservation.findMany({
  where: { hotelId, status: 'CHECKED_OUT', checkOut: { lt: new Date(now.getTime() - 2 * DAY_MS) } },
  orderBy: [{ checkOut: 'desc' }, { id: 'asc' }],
  take: INVITATIONS,
  select: { id: true, guestId: true, checkOut: true, confirmationCode: true },
});
console.log(`  ${stays.length} çıkmış konaklama bulundu`);
const TEXTS = ['Kahvaltı çok iyiydi', 'Oda gürültülüydü, asansörün yanında', 'Personel çok ilgiliydi', 'İnternet sürekli koptu', 'Temizlik mükemmeldi', 'Girişte uzun bekledik', 'Spa harikaydı', 'Fiyatlar yüksek'];
const TOPICS = ['ROOM', 'CLEANLINESS', 'STAFF', 'FOOD_BEVERAGE', 'NOISE', 'WIFI', 'CHECK_IN_OUT', 'VALUE', 'SPA'];
let responded = 0;
let lows = 0;
for (let index = 0; index < stays.length; index += CHUNK) {
  const invitations = [];
  const rows = [];
  const answers = [];
  const follow = [];
  for (const stay of stays.slice(index, index + CHUNK)) {
    // Gönderimler son iki yıla eşit dağılır (ölçüm otelinin çıkışları eski tarihli olabilir; 30 günlük ölçüm boş kalmasın).
    const sentAt = new Date(now.getTime() - (2 + rand() * 728) * DAY_MS);
    const id = randomUUID();
    const answer = responded < RESPONSES && rand() < RESPONSES / stays.length;
    invitations.push({ id, hotelId, surveyId: post.id, kind: 'POST_STAY', reservationId: stay.id, guestId: stay.guestId, nonce: randomBytes(18).toString('base64url'), language: pick(['tr', 'en', 'de', 'ru']), status: answer ? 'RESPONDED' : 'SENT', sentAt, expiresAt: new Date(sentAt.getTime() + 14 * DAY_MS), respondedAt: answer ? new Date(sentAt.getTime() + 6 * 3_600_000) : null, openedAt: answer ? sentAt : null });
    if (!answer) continue;
    responded += 1;
    const responseId = randomUUID();
    const nps = rand() < 0.58 ? 9 + Math.round(rand()) : rand() < 0.7 ? 7 + Math.round(rand()) : Math.floor(rand() * 7);
    const rating = Math.max(1, Math.min(5, Math.round(nps / 2)));
    const comment = rand() < 0.45 ? pick(TEXTS) : null;
    const low = nps <= 6;
    const submittedAt = new Date(sentAt.getTime() + 6 * 3_600_000);
    rows.push({ id: responseId, hotelId, invitationId: id, surveyId: post.id, kind: 'POST_STAY', reservationId: stay.id, guestId: stay.guestId, language: 'tr', submittedAt, npsScore: nps, npsCategory: contracts.npsCategory(nps), ratingAverage: rating, lowScore: low, commentText: comment, searchText: `${stay.confirmationCode} Perf Misafir ${comment ?? ''}`, sentiment: comment ? (low ? 'NEGATIVE' : 'POSITIVE') : null, topics: comment ? [pick(TOPICS)] : [], analysisStatus: comment ? 'DONE' : 'SKIPPED', analysisModel: comment ? 'perf' : null });
    for (const question of questions) {
      if (question.type === 'NPS') answers.push({ id: randomUUID(), hotelId, responseId, questionId: question.id, kind: 'POST_STAY', submittedAt, score: nps });
      else if (question.type === 'RATING') answers.push({ id: randomUUID(), hotelId, responseId, questionId: question.id, kind: 'POST_STAY', submittedAt, score: rating });
      else if (question.type === 'CHOICE') answers.push({ id: randomUUID(), hotelId, responseId, questionId: question.id, kind: 'POST_STAY', submittedAt, choiceIds: [pick(['business', 'leisure', 'event'])] });
      else if (comment) answers.push({ id: randomUUID(), hotelId, responseId, questionId: question.id, kind: 'POST_STAY', submittedAt, text: comment });
    }
    if (low) {
      lows += 1;
      const resolved = submittedAt.getTime() < now.getTime() - 5 * DAY_MS;
      follow.push({ id: randomUUID(), hotelId, responseId, reservationId: stay.id, kind: 'POST_STAY', status: resolved ? 'RESOLVED' : 'OPEN', dueAt: new Date(submittedAt.getTime() + 48 * 3_600_000), outcome: resolved ? 'APOLOGIZED' : null, resolution: resolved ? 'Arandı, özür dilendi' : null, resolvedAt: resolved ? new Date(submittedAt.getTime() + DAY_MS) : null, resolvedBy: resolved ? ACTOR : null, createdAt: submittedAt });
    }
  }
  await prisma.surveyInvitation.createMany({ data: invitations });
  if (rows.length) await prisma.surveyResponse.createMany({ data: rows });
  if (answers.length) await prisma.surveyAnswer.createMany({ data: answers });
  if (follow.length) await prisma.surveyFollowUp.createMany({ data: follow });
}
await prisma.$executeRawUnsafe('VACUUM ANALYZE "SurveyInvitation", "SurveyResponse", "SurveyAnswer", "SurveyFollowUp"');
console.log(`Kurulum ${Math.round((performance.now() - started) / 1000)} sn: ${stays.length} davet, ${responded} cevap, ${await prisma.surveyAnswer.count({ where: { hotelId } })} cevap satırı, ${lows} düşük puan`);

/* ══════════════════ Ölçüm ══════════════════ */

const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00Z`), offset));
const list = (query) => contracts.surveyResponseListQuerySchema.parse(query);
await measure('Rapor: son 30 gün', () => responses.surveyReport(hotelId, { kind: 'POST_STAY', from: day(-29), to: today }));
await measure('Rapor: son 1 yıl (aylık eğilim)', () => responses.surveyReport(hotelId, { kind: 'POST_STAY', from: day(-364), to: today }));
const page = await measure('Cevaplar: son 30 gün, ilk sayfa', () => responses.listResponses(hotelId, list({ from: day(-29), to: today })));
await measure('Cevaplar: 1 yıl, yalnız düşük puan', () => responses.listResponses(hotelId, list({ from: day(-364), to: today, lowOnly: 'true' })));
await measure('Cevaplar: 1 yıl, konu (gürültü)', () => responses.listResponses(hotelId, list({ from: day(-364), to: today, topic: 'NOISE' })));
await measure('Cevaplar: 1 yıl, arama ("asansör")', () => responses.listResponses(hotelId, list({ from: day(-364), to: today, search: 'asansör' })));
await measure('Cevaplar: 1 yıl, derin sayfa (200.)', () => responses.listResponses(hotelId, list({ from: day(-364), to: today, page: 200 })));
if (page.items[0]) await measure('Cevap ayrıntısı', () => responses.getResponse(hotelId, page.items[0].id));
await measure('Soru tasarımı (cevap sayısı 1.000 sınırlı)', () => design.getSurveyDesign(hotelId, 'POST_STAY'));
await measure('Takip: açıklar', () => followUps.listFollowUps(hotelId, contracts.surveyFollowUpListQuerySchema.parse({})));
await measure('Takip: kapananlar, derin sayfa (100.)', () => followUps.listFollowUps(hotelId, contracts.surveyFollowUpListQuerySchema.parse({ view: 'RESOLVED', page: 100 })));

// Misafir: açık bir davet (yeni) — form ve gönderim.
const fresh = await prisma.reservation.findFirst({ where: { hotelId, status: 'CHECKED_OUT', surveyInvitations: { none: {} } }, select: { id: true, guestId: true } });
if (fresh) {
  const invitation = await prisma.surveyInvitation.create({ data: { hotelId, surveyId: post.id, kind: 'POST_STAY', reservationId: fresh.id, guestId: fresh.guestId, nonce: randomBytes(18).toString('base64url'), language: 'tr', expiresAt: new Date(now.getTime() + 14 * DAY_MS) } });
  const token = surveyToken(invitation);
  const form = await measure('Misafir: anket formu', () => guest.surveyForm(token));
  const body = contracts.surveySubmitSchema.parse({ language: 'tr', answers: form.questions.map((question) => (question.type === 'NPS' ? { questionId: question.id, score: 3 } : question.type === 'RATING' ? { questionId: question.id, score: 2 } : question.type === 'CHOICE' ? { questionId: question.id, choiceIds: ['business'] } : { questionId: question.id, text: 'Ölçüm yorumu' })) });
  await measure('Misafir: gönderim (cevap + takip + zil)', () => guest.submitSurvey(token, body), 1);
}

const insight = await prisma.surveyInsight.create({ data: { hotelId, kind: 'POST_STAY', fromDay: new Date(`${day(-364)}T00:00:00Z`), toDay: new Date(`${today}T00:00:00Z`), requestedBy: ACTOR } });
const input = await measure('AI özetinin girdisi: 1 yıl (en yeni 150 yorum)', () => responses.insightInput(hotelId, insight.id));
console.log(`  girdi: ${input.comments.length} yorum, ${JSON.stringify(input).length} karakter`);

// Davet turu: e-posta kanalı açılır (sonra eski hâline), portal adresi gerekir.
await prisma.guestPortalSettings.upsert({ where: { hotelId }, create: { hotelId, enabled: true, publicBaseUrl: 'https://perf.example.com', updatedBy: ACTOR }, update: { publicBaseUrl: 'https://perf.example.com' } });
const previousEmail = await prisma.notificationChannelConfig.findFirst({ where: { hotelId, channel: 'EMAIL' } });
if (previousEmail) await prisma.notificationChannelConfig.update({ where: { id: previousEmail.id }, data: { enabled: true } });
else await prisma.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'olcum@example.com' } } });
// Yoğun bir gün: dün 400 çıkış (davetsiz, e-postalı misafir); tur bugün öğlen çalışır.
const busy = await prisma.reservation.findMany({ where: { hotelId, status: 'CHECKED_OUT', surveyInvitations: { none: {} } }, take: 400, select: { id: true, guestId: true } });
const outAt = contracts.zonedWallTimeToUtc(`${day(-1)}T10:00`, 'Europe/Istanbul');
await prisma.reservation.updateMany({ where: { id: { in: busy.map((row) => row.id) } }, data: { checkedOutAt: outAt } });
await prisma.guest.updateMany({ where: { id: { in: busy.map((row) => row.guestId) }, email: null }, data: { email: 'olcum@example.com' } });
const noon = contracts.zonedWallTimeToUtc(`${today}T12:00`, 'Europe/Istanbul');
const sent = await measure('Davet turu (dün 400 çıkış; 60 sn bütçe)', () => as(() => invites.sendDueSurveys(hotelId, { now: noon })), 1);
console.log(`  gönderilen: çıkış sonrası ${sent.postStay}, ara anket ${sent.midStay}`);
await prisma.notification.deleteMany({ where: { hotelId, source: { in: ['SURVEY_POST_STAY', 'SURVEY_MID_STAY'] } } });
if (previousEmail) await prisma.notificationChannelConfig.update({ where: { id: previousEmail.id }, data: { enabled: previousEmail.enabled } });
else await prisma.notificationChannelConfig.deleteMany({ where: { hotelId, channel: 'EMAIL' } });

await prisma.$disconnect();
