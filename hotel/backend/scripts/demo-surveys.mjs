import { randomBytes, randomUUID } from 'node:crypto';
import { ensureSurvey } from '../src/modules/surveys/design.js';

/**
 * Demo anket ve memnuniyet (modül 55; `demo-data.mjs` çağırır).
 *
 * Ayar (iki anket açık, yorum bağlantıları), son 60 günde çıkan demo konaklamalara çıkış sonrası anket daveti; yaklaşık
 * üçte biri cevaplar (lüks otel dağılımı: çoğu destekçi, bir kısmı pasif, az eleştiren). Yorumlar misafirin dilinde,
 * konuya ve tona göre; AI etiketi `demo` modeliyle (ajanın üreteceği biçimde). Son iki günde girenlere ara anket.
 * Düşük puanlara takip: kapanmış (sonucuyla), ilgilenilen (görüşme notuyla), açık ve gecikmiş. Son 30 günün dönem
 * özeti. Gerçek kişiye ait veri yok.
 */

const CODE_PREFIX = 'DMO-';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const STAFF = Object.freeze(['onburo@hotel.local', 'admin@hotel.local']);

let seed = 55_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Yorum havuzu: konu, ton, dört dil, Türkçe özet (ajanın yazacağı gibi). */
const COMMENTS = Object.freeze([
  { topics: ['STAFF', 'CHECK_IN_OUT'], sentiment: 'POSITIVE', tr: 'Resepsiyondaki ekip çok ilgiliydi, girişimiz iki dakika sürdü.', en: 'The front desk team was very attentive, check-in took two minutes.', de: 'Das Team an der Rezeption war sehr aufmerksam, der Check-in dauerte zwei Minuten.', ru: 'Сотрудники ресепшн были очень внимательны, заселение заняло две минуты.', summary: 'Resepsiyon ekibi ve hızlı giriş övülmüş.' },
  { topics: ['FOOD_BEVERAGE'], sentiment: 'POSITIVE', tr: 'Kahvaltı çeşitliliği harikaydı, özellikle yöresel ürünler.', en: 'The breakfast selection was excellent, especially the local products.', de: 'Das Frühstücksbuffet war hervorragend, besonders die regionalen Produkte.', ru: 'Завтрак был великолепным, особенно местные продукты.', summary: 'Kahvaltı çeşitliliği ve yöresel ürünler övülmüş.' },
  { topics: ['ROOM', 'CLEANLINESS'], sentiment: 'POSITIVE', tr: 'Oda tertemiz ve çok konforluydu, yataklar mükemmel.', en: 'The room was spotless and very comfortable, the beds were perfect.', de: 'Das Zimmer war makellos sauber und sehr bequem, die Betten perfekt.', ru: 'Номер был безупречно чистым и очень удобным, кровати отличные.', summary: 'Odanın temizliği ve yatak konforu övülmüş.' },
  { topics: ['SPA', 'FACILITIES'], sentiment: 'POSITIVE', tr: 'Spa ve havuz alanı çok huzurluydu, masaj terapisti profesyoneldi.', en: 'The spa and pool were very relaxing, the massage therapist was professional.', de: 'Spa und Pool waren sehr entspannend, die Masseurin war professionell.', ru: 'Спа и бассейн очень расслабляют, массажист был профессионалом.', summary: 'Spa, havuz ve masaj hizmeti övülmüş.' },
  { topics: ['LOCATION'], sentiment: 'POSITIVE', tr: 'Konum toplantılarım için çok uygundu.', en: 'The location was very convenient for my meetings.', de: 'Die Lage war für meine Termine sehr praktisch.', ru: 'Расположение было очень удобным для моих встреч.', summary: 'Konumun iş toplantıları için uygunluğu övülmüş.' },
  { topics: ['NOISE', 'ROOM'], sentiment: 'NEGATIVE', tr: 'Oda asansörün yanındaydı, gece çok gürültü vardı.', en: 'The room was next to the lift and it was very noisy at night.', de: 'Das Zimmer lag neben dem Aufzug, nachts war es sehr laut.', ru: 'Номер был рядом с лифтом, ночью было очень шумно.', summary: 'Asansör yanındaki odada gece gürültüsünden şikâyet.' },
  { topics: ['WIFI'], sentiment: 'NEGATIVE', tr: 'İnternet odada sürekli kopuyordu, çalışmak zor oldu.', en: 'The Wi-Fi kept dropping in the room, which made working difficult.', de: 'Das WLAN im Zimmer brach ständig ab, Arbeiten war schwierig.', ru: 'Wi-Fi в номере постоянно пропадал, работать было трудно.', summary: 'Odada internetin sık kopmasından şikâyet.' },
  { topics: ['CHECK_IN_OUT', 'STAFF'], sentiment: 'NEGATIVE', tr: 'Girişte odamız hazır değildi, bir saat lobide bekledik.', en: 'Our room was not ready at check-in, we waited an hour in the lobby.', de: 'Unser Zimmer war beim Check-in nicht fertig, wir haben eine Stunde gewartet.', ru: 'При заселении номер не был готов, мы ждали в лобби час.', summary: 'Girişte odanın hazır olmamasından ve bekleme süresinden şikâyet.' },
  { topics: ['VALUE', 'FOOD_BEVERAGE'], sentiment: 'NEGATIVE', tr: 'Minibar ve oda servisi fiyatları çok yüksek.', en: 'Minibar and room service prices are far too high.', de: 'Minibar- und Zimmerservicepreise sind viel zu hoch.', ru: 'Цены в минибаре и на обслуживание номеров слишком высокие.', summary: 'Minibar ve oda servisi fiyatlarının yüksekliğinden şikâyet.' },
  { topics: ['CLEANLINESS'], sentiment: 'NEGATIVE', tr: 'Banyoda önceki misafirden kalan saç vardı.', en: 'There was hair from the previous guest in the bathroom.', de: 'Im Bad lagen Haare vom vorherigen Gast.', ru: 'В ванной были волосы предыдущего гостя.', summary: 'Banyonun temizliğinden şikâyet.' },
  { topics: ['FOOD_BEVERAGE', 'STAFF'], sentiment: 'MIXED', tr: 'Restoran yemekleri lezzetliydi ama servis çok yavaştı.', en: 'The restaurant food was delicious but the service was very slow.', de: 'Das Essen im Restaurant war lecker, aber der Service sehr langsam.', ru: 'Еда в ресторане вкусная, но обслуживание очень медленное.', summary: 'Restoran yemekleri övülmüş, servis hızından şikâyet.' },
  { topics: ['ROOM', 'FACILITIES'], sentiment: 'MIXED', tr: 'Manzara muhteşemdi ancak klima düzgün çalışmadı.', en: 'The view was stunning but the air conditioning did not work properly.', de: 'Die Aussicht war atemberaubend, aber die Klimaanlage funktionierte nicht richtig.', ru: 'Вид потрясающий, но кондиционер работал плохо.', summary: 'Manzara övülmüş, klimanın arızasından şikâyet.' },
]);
const POSITIVE = COMMENTS.filter((row) => row.sentiment === 'POSITIVE');
const CRITICAL = COMMENTS.filter((row) => row.sentiment !== 'POSITIVE');
const OUTCOME_TEXT = Object.freeze({
  APOLOGIZED: 'Misafir arandı, yaşanan aksaklık için özür dilendi; teşekkür etti.',
  COMPENSATED: 'Bir sonraki konaklamada oda yükseltmesi ve spa kuponu teklif edildi; kabul etti.',
  ISSUE_FIXED: 'Teknik servise iş emri açıldı, arıza giderildi; misafire bilgi verildi.',
  EXPLAINED: 'Fiyat politikası ve alternatif paketler anlatıldı.',
});

/** Dil: misafirin uyruğu (portalın kuralı). @param {any} contracts @param {string | null} nationality */
const languageOf = (contracts, nationality) => contracts.guestPortalLanguageFor(nationality);

/** NPS'ye göre puan (1–5): yüksek NPS yüksek puan, biraz oynama. @param {number} nps */
const ratingFor = (nps) => clamp(Math.round(nps / 2 + 0.2 + (rand() - 0.5) * 1.2), 1, 5);

/** Lüks otel NPS dağılımı: ~%58 destekçi, ~%29 pasif, ~%13 eleştiren. */
function npsDraw() {
  const roll = rand();
  if (roll < 0.58) return rand() < 0.6 ? 10 : 9;
  if (roll < 0.87) return rand() < 0.5 ? 8 : 7;
  return Math.floor(rand() * 7);
}

/** Demo anket verisini siler (rezervasyondan önce). @param {any} tx @param {string} hotelId @param {string} actor */
export async function resetSurveyDemo(tx, hotelId, actor) {
  const demo = { hotelId, reservation: { confirmationCode: { startsWith: CODE_PREFIX } } };
  const responses = await tx.surveyResponse.findMany({ where: demo, select: { id: true } });
  const ids = responses.map((row) => row.id);
  const followUps = await tx.surveyFollowUp.findMany({ where: { hotelId, responseId: { in: ids } }, select: { id: true } });
  await tx.surveyFollowUpNote.deleteMany({ where: { hotelId, followUpId: { in: followUps.map((row) => row.id) } } });
  await tx.surveyFollowUp.deleteMany({ where: { hotelId, responseId: { in: ids } } });
  await tx.staffAlert.deleteMany({ where: { hotelId, kind: 'SURVEY_LOW_SCORE' } });
  await tx.surveyAnswer.deleteMany({ where: { hotelId, responseId: { in: ids } } });
  await tx.surveyResponse.deleteMany({ where: { hotelId, id: { in: ids } } });
  await tx.surveyInvitation.deleteMany({ where: demo });
  await tx.surveyInsight.deleteMany({ where: { hotelId, requestedBy: actor } });
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} context
 */
export async function seedSurveyDemo({ prisma, contracts, hotelId, today, actor }) {
  await prisma.surveySettings.upsert({
    where: { hotelId },
    create: { hotelId, postStayEnabled: true, midStayEnabled: true, googleReviewUrl: 'https://g.page/r/flexhotel-demo/review', tripadvisorReviewUrl: 'https://www.tripadvisor.com/flexhotel-demo', updatedBy: actor },
    update: { postStayEnabled: true, midStayEnabled: true },
  });
  const [post, mid] = await Promise.all([ensureSurvey(hotelId, 'POST_STAY'), ensureSurvey(hotelId, 'MID_STAY')]);
  const [postQuestions, midQuestions] = await Promise.all(
    [post, mid].map((survey) => prisma.surveyQuestion.findMany({ where: { surveyId: survey.id, archivedAt: null }, orderBy: { position: 'asc' } })),
  );

  const now = new Date();
  const start = new Date(`${today}T00:00:00.000Z`);
  const guestSelect = { select: { firstName: true, lastName: true, nationality: true } };
  const [departed, inHouse] = await Promise.all([
    prisma.reservation.findMany({
      where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX }, status: 'CHECKED_OUT', checkedOutAt: { gte: new Date(start.getTime() - 60 * DAY_MS), lt: new Date(now.getTime() - 26 * HOUR_MS) } },
      select: { id: true, guestId: true, confirmationCode: true, checkedOutAt: true, guest: guestSelect },
      orderBy: [{ checkedOutAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX }, status: 'CHECKED_IN', checkedInAt: { gte: new Date(start.getTime() - 3 * DAY_MS), lt: new Date(now.getTime() - 20 * HOUR_MS) } },
      select: { id: true, guestId: true, confirmationCode: true, checkedInAt: true, guest: guestSelect },
      orderBy: [{ checkedInAt: 'asc' }, { id: 'asc' }],
      take: 40,
    }),
  ]);

  const invitations = [];
  const responses = [];
  const answers = [];
  const followUps = [];
  const notes = [];
  const seenGuests = new Set();

  /** @param {any} reservation @param {'POST_STAY' | 'MID_STAY'} kind @param {Date} sentAt */
  const invite = (reservation, kind, sentAt) => {
    const id = randomUUID();
    invitations.push({
      id,
      hotelId,
      surveyId: kind === 'POST_STAY' ? post.id : mid.id,
      kind,
      reservationId: reservation.id,
      guestId: reservation.guestId,
      nonce: randomBytes(24).toString('base64url'),
      language: languageOf(contracts, reservation.guest?.nationality),
      status: 'SENT',
      sentAt,
      expiresAt: new Date(sentAt.getTime() + 14 * DAY_MS),
    });
    return invitations.at(-1);
  };

  /** @param {any} invitation @param {any} reservation @param {Array<{ question: any, score?: number, choiceIds?: string[], text?: string }>} given @param {any} comment */
  const respond = (invitation, reservation, given, comment, submittedAt) => {
    const id = randomUUID();
    const kept = given.filter((row) => row.score !== undefined || row.choiceIds?.length || row.text);
    const score = contracts.scoreSurveyResponse(
      kept.map((row) => ({ id: row.question.id, type: row.question.type })),
      kept.map((row) => ({ questionId: row.question.id, score: row.score ?? null, choiceIds: row.choiceIds ?? [], text: row.text ?? null })),
      { lowNpsThreshold: 6, lowRatingThreshold: 2 },
    );
    invitation.status = 'RESPONDED';
    invitation.openedAt = new Date(submittedAt.getTime() - 3 * 60_000);
    invitation.respondedAt = submittedAt;
    responses.push({
      id,
      hotelId,
      invitationId: invitation.id,
      surveyId: invitation.surveyId,
      kind: invitation.kind,
      reservationId: reservation.id,
      guestId: reservation.guestId,
      language: invitation.language,
      submittedAt,
      npsScore: score.npsScore,
      npsCategory: score.npsCategory,
      ratingAverage: score.ratingAverage,
      lowScore: score.lowScore,
      commentText: score.commentText,
      searchText: [reservation.confirmationCode, reservation.guest?.firstName, reservation.guest?.lastName, score.commentText ?? ''].join(' ').slice(0, 7000),
      sentiment: comment ? comment.sentiment : null,
      topics: comment ? [...comment.topics] : [],
      aiSummary: comment ? comment.summary : null,
      analysisStatus: comment ? 'DONE' : 'SKIPPED',
      analysisModel: comment ? 'demo' : null,
      analyzedAt: comment ? new Date(submittedAt.getTime() + 20_000) : null,
    });
    for (const row of kept) {
      answers.push({ id: randomUUID(), hotelId, responseId: id, questionId: row.question.id, kind: invitation.kind, submittedAt, score: row.score ?? null, choiceIds: row.choiceIds ?? [], text: row.text ?? null });
    }
    if (score.lowScore) {
      const followUpId = randomUUID();
      const due = new Date(submittedAt.getTime() + contracts.SURVEY_FOLLOW_UP_DUE_HOURS[invitation.kind] * HOUR_MS);
      const age = now.getTime() - submittedAt.getTime();
      // Eskiler kapanmış; son iki gündekiler açık ya da ilgileniliyor; arada biri gecikmiş.
      const state = age > 3 * DAY_MS ? 'RESOLVED' : rand() < 0.5 ? 'IN_PROGRESS' : 'OPEN';
      const assignee = state === 'OPEN' ? null : pick(STAFF);
      const outcome = state === 'RESOLVED' ? pick(Object.keys(OUTCOME_TEXT)) : null;
      followUps.push({
        id: followUpId,
        hotelId,
        responseId: id,
        reservationId: reservation.id,
        kind: invitation.kind,
        status: state,
        assignedTo: assignee,
        dueAt: due,
        outcome,
        resolution: outcome ? OUTCOME_TEXT[outcome] : null,
        resolvedAt: outcome ? new Date(Math.min(due.getTime() - HOUR_MS, submittedAt.getTime() + 20 * HOUR_MS)) : null,
        resolvedBy: outcome ? assignee : null,
        createdAt: submittedAt,
      });
      if (assignee) notes.push({ id: randomUUID(), hotelId, followUpId, kind: 'NOTE', text: `Üstlenen: ${assignee}`, createdBy: assignee, createdAt: new Date(submittedAt.getTime() + HOUR_MS) });
      if (state !== 'OPEN') notes.push({ id: randomUUID(), hotelId, followUpId, kind: 'CONTACT', text: 'Misafir arandı; yaşadığı sorun dinlendi, ilgili bölüme iletildi.', createdBy: assignee, createdAt: new Date(submittedAt.getTime() + 3 * HOUR_MS) });
      if (outcome) notes.push({ id: randomUUID(), hotelId, followUpId, kind: 'NOTE', text: `Kapandı · ${contracts.SURVEY_FOLLOW_UP_OUTCOME_LABELS[outcome]}: ${OUTCOME_TEXT[outcome]}`, createdBy: assignee, createdAt: new Date(submittedAt.getTime() + 20 * HOUR_MS) });
    }
  };

  // Çıkış sonrası: aynı misafire 30 günde bir; çıkıştan ~1 gün sonra 11:00 civarı davet; yaklaşık üçte biri cevaplar.
  for (const reservation of departed) {
    if (seenGuests.has(reservation.guestId)) continue;
    seenGuests.add(reservation.guestId);
    const sentAt = new Date(reservation.checkedOutAt.getTime() + 25 * HOUR_MS);
    if (sentAt > now) continue;
    const invitation = invite(reservation, 'POST_STAY', sentAt);
    if (rand() < 0.15) invitation.openedAt = new Date(sentAt.getTime() + 2 * HOUR_MS);
    if (rand() >= 0.34) continue;
    const submittedAt = new Date(Math.min(now.getTime() - (10 + rand() * 600) * 60_000, sentAt.getTime() + (0.5 + rand() * 30) * HOUR_MS));
    const nps = npsDraw();
    const language = invitation.language;
    const praise = rand() < (nps >= 9 ? 0.55 : 0.25) ? pick(POSITIVE) : null;
    const critique = nps <= 6 || (nps <= 8 && rand() < 0.45) ? pick(CRITICAL) : null;
    const comment = critique ?? praise;
    const given = postQuestions.map((question) => {
      if (question.type === 'NPS') return { question, score: nps };
      if (question.type === 'RATING') {
        if (question.topic === 'FOOD_BEVERAGE' && rand() < 0.3) return { question };
        const hit = critique?.topics.includes(question.topic);
        return { question, score: hit ? clamp(ratingFor(nps) - (nps <= 6 ? 2 : 1), 1, 5) : ratingFor(nps) };
      }
      if (question.type === 'CHOICE') return { question, choiceIds: [pick(['business', 'business', 'leisure', 'leisure', 'leisure', 'event', 'other'])] };
      const first = postQuestions.filter((row) => row.type === 'TEXT')[0]?.id === question.id;
      return { question, text: first ? (praise ? praise[language] : undefined) : critique ? critique[language] : undefined };
    });
    respond(invitation, reservation, given, comment, submittedAt);
  }

  // Ara anket: son günlerde girenler; çoğu memnun, birkaçı sorun bildirir (düşük puan → takip).
  for (const reservation of inHouse) {
    const sentAt = new Date(reservation.checkedInAt.getTime() + 27 * HOUR_MS);
    if (sentAt > now) continue;
    const invitation = invite(reservation, 'MID_STAY', sentAt);
    if (rand() >= 0.5) continue;
    const submittedAt = new Date(Math.min(now.getTime() - (5 + rand() * 120) * 60_000, sentAt.getTime() + (0.2 + rand() * 4) * HOUR_MS));
    const unhappy = rand() < 0.2;
    const comment = unhappy ? pick(CRITICAL) : rand() < 0.3 ? pick(POSITIVE) : null;
    const given = midQuestions.map((question) => {
      if (question.type === 'RATING') return { question, score: unhappy ? 1 + Math.floor(rand() * 2) : 4 + Math.round(rand()) };
      if (question.type === 'TEXT') return { question, text: comment ? comment[invitation.language] : undefined };
      return { question };
    });
    respond(invitation, reservation, given, comment, submittedAt);
  }

  for (let index = 0; index < invitations.length; index += 500) await prisma.surveyInvitation.createMany({ data: invitations.slice(index, index + 500).map((row) => ({ ...row, status: row.respondedAt ? 'RESPONDED' : row.openedAt ? 'OPENED' : 'SENT' })) });
  for (let index = 0; index < responses.length; index += 500) await prisma.surveyResponse.createMany({ data: responses.slice(index, index + 500) });
  for (let index = 0; index < answers.length; index += 2000) await prisma.surveyAnswer.createMany({ data: answers.slice(index, index + 2000) });
  if (followUps.length) await prisma.surveyFollowUp.createMany({ data: followUps });
  if (notes.length) await prisma.surveyFollowUpNote.createMany({ data: notes });

  // Son 30 günün dönem özeti (ajanın biçiminde; `demo` modeli).
  const from = new Date(start.getTime() - 29 * DAY_MS);
  const recent = responses.filter((row) => row.kind === 'POST_STAY' && row.submittedAt >= from);
  if (recent.length) {
    await prisma.surveyInsight.create({
      data: {
        hotelId,
        kind: 'POST_STAY',
        fromDay: from,
        toDay: start,
        status: 'READY',
        responseCount: recent.length,
        commentCount: recent.filter((row) => row.commentText).length,
        summary:
          'Dönemde misafirlerin çoğu konaklamasından memnun; personelin ilgisi, kahvaltı çeşitliliği ve oda temizliği en çok övülen konular. Eleştirilerin başında asansöre yakın odalarda gece gürültüsü, odada internetin kopması ve yoğun günlerde girişte bekleme geliyor. Restoran yemekleri beğenilse de servis hızı birkaç yorumda olumsuz.',
        themes: [
          { title: 'Personel ve karşılama', sentiment: 'POSITIVE', share: 34, quote: 'Resepsiyondaki ekip çok ilgiliydi, girişimiz iki dakika sürdü.' },
          { title: 'Kahvaltı', sentiment: 'POSITIVE', share: 22, quote: 'Kahvaltı çeşitliliği harikaydı, özellikle yöresel ürünler.' },
          { title: 'Gece gürültüsü', sentiment: 'NEGATIVE', share: 12, quote: 'Oda asansörün yanındaydı, gece çok gürültü vardı.' },
          { title: 'Odada internet', sentiment: 'NEGATIVE', share: 9, quote: 'İnternet odada sürekli kopuyordu, çalışmak zor oldu.' },
          { title: 'Restoran servisi', sentiment: 'MIXED', share: 8, quote: 'Restoran yemekleri lezzetliydi ama servis çok yavaştı.' },
        ],
        actions: ['Asansöre bitişik odaları sessiz oda isteyen misafire vermeyin; kapı fitillerini kontrol edin.', 'Kat kat Wi-Fi erişim noktalarının kapsamasını ölçtürün.', 'Yoğun girişlerde erken hazırlanacak odaları kat hizmetleriyle sabah planlayın.'],
        model: 'demo',
        requestedBy: actor,
        requestedAt: new Date(now.getTime() - 2 * HOUR_MS),
        completedAt: new Date(now.getTime() - 2 * HOUR_MS + 30_000),
      },
    });
  }
  return {
    invitations: invitations.length,
    responses: responses.length,
    followUps: followUps.length,
    open: followUps.filter((row) => row.status !== 'RESOLVED').length,
  };
}
