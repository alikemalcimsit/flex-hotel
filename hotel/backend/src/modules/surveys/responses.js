import { currentActor, toIsoDay } from '@hotelos/core';
import {
  SURVEY_INSIGHT_COMMENT_CHARS,
  SURVEY_INSIGHT_MAX_COMMENTS,
  SURVEY_SENTIMENTS,
  SURVEY_TOPICS,
  addSurveyDays,
  npsFromCounts,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { aiAvailability } from './design.js';
import { dayStart, fullGuestName, iso, prisma, surveyClock } from './shared.js';

/**
 * Anket cevapları, NPS raporu ve AI özeti (modül 55) — personel tarafı.
 *
 * Liste ve rapor otelin yerel gününe göre (gönderim anı), `[hotelId, kind, submittedAt]` indeksli; liste sayfalı, rapor
 * en fazla bir yıl. Soru başına ortalama ve dağılım cevap satırlarından tek sorguda (soru × puan), eğilim haftalık ya
 * da aylık. AI etiketi bekleyen cevap 30 dakikada yazılmazsa "etiketlenemedi" görünür (ajan kapalı / süreç düştü).
 */

const ANALYSIS_TIMEOUT_MS = 30 * 60_000;
const INSIGHT_TIMEOUT_MS = 10 * 60_000;
/** Bu kadar günden uzun dönemde eğilim aylık. */
const WEEKLY_MAX_DAYS = 92;
const EXCERPT = 240;

/** @param {any} row */
const analysisState = (row) => (row.analysisStatus === 'PENDING' && Date.now() - row.submittedAt.getTime() > ANALYSIS_TIMEOUT_MS ? 'FAILED' : row.analysisStatus);

const LIST_SELECT = Object.freeze({
  id: true,
  kind: true,
  submittedAt: true,
  language: true,
  npsScore: true,
  npsCategory: true,
  ratingAverage: true,
  lowScore: true,
  commentText: true,
  sentiment: true,
  topics: true,
  aiSummary: true,
  analysisStatus: true,
  reservation: { select: { id: true, confirmationCode: true, checkIn: true, checkOut: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true, nationality: true } } } },
  followUp: { select: { id: true, status: true, dueAt: true, assignedTo: true } },
});

/** @param {any} row */
const responseListView = (row) => ({
  id: row.id,
  kind: row.kind,
  submittedAt: iso(row.submittedAt),
  language: row.language,
  npsScore: row.npsScore,
  npsCategory: row.npsCategory,
  ratingAverage: row.ratingAverage === null ? null : Number(row.ratingAverage),
  lowScore: row.lowScore,
  comment: row.commentText ? (row.commentText.length > EXCERPT ? `${row.commentText.slice(0, EXCERPT - 1)}…` : row.commentText) : null,
  sentiment: row.sentiment,
  topics: row.topics,
  aiSummary: row.aiSummary,
  analysisStatus: analysisState(row),
  reservation: {
    id: row.reservation.id,
    confirmationCode: row.reservation.confirmationCode,
    checkIn: toIsoDay(row.reservation.checkIn),
    checkOut: toIsoDay(row.reservation.checkOut),
    roomNumber: row.reservation.room?.number ?? null,
    guestName: fullGuestName(row.reservation.guest),
    nationality: row.reservation.guest?.nationality ?? null,
  },
  followUp: row.followUp ? { id: row.followUp.id, status: row.followUp.status, dueAt: iso(row.followUp.dueAt), assignedTo: row.followUp.assignedTo } : null,
});

/**
 * Dönemin sınırları (otelin günleri → UTC anları; bitiş günü dahil).
 * @param {string} hotelId @param {{ from?: string, to?: string }} range
 */
async function rangeOf(hotelId, { from, to }) {
  const { timezone } = await surveyClock(hotelId);
  return { timezone, gte: from ? dayStart(from, timezone) : undefined, lt: to ? dayStart(addSurveyDays(to, 1), timezone) : undefined };
}

/**
 * Cevap listesi: yeniden eskiye; tür, dönem, NPS kategorisi, düşük puan, yorumlu, duygu, konu, arama (onay kodu, ad,
 * yorum — en az üç karakter).
 * @param {string} hotelId @param {any} query `surveyResponseListQuerySchema`
 */
export async function listResponses(hotelId, query) {
  const { gte, lt } = await rangeOf(hotelId, query);
  /** @type {any} */
  const where = { hotelId };
  if (query.kind) where.kind = query.kind;
  if (gte || lt) where.submittedAt = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
  if (query.category) where.npsCategory = query.category;
  if (query.lowOnly) where.lowScore = true;
  if (query.withComment) where.commentText = { not: null };
  if (query.sentiment) where.sentiment = query.sentiment;
  if (query.topic) where.topics = { has: query.topic };
  const term = query.search?.trim();
  if (term && term.length >= 3) where.searchText = { contains: term.replace(/[\\%_]/g, (char) => `\\${char}`), mode: 'insensitive' };
  const [rows, total] = await Promise.all([
    prisma.surveyResponse.findMany({ where, select: LIST_SELECT, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }),
    prisma.surveyResponse.count({ where }),
  ]);
  return buildPage(rows.map(responseListView), total, query);
}

/**
 * Cevabın ayrıntısı: bütün cevaplar sorunun metniyle (Türkçe) ve seçenek adlarıyla, konaklama, davet, takip ve notları.
 * @param {string} hotelId @param {string} responseId
 */
export async function getResponse(hotelId, responseId) {
  const row = await prisma.surveyResponse.findFirst({
    where: { id: responseId, hotelId },
    select: {
      ...LIST_SELECT,
      analysisModel: true,
      analyzedAt: true,
      invitation: { select: { sentAt: true, openedAt: true, language: true } },
      reservation: { select: { ...LIST_SELECT.reservation.select, guest: { select: { firstName: true, lastName: true, nationality: true, email: true, phone: true } } } },
      answers: { select: { questionId: true, score: true, choiceIds: true, text: true, question: { select: { type: true, text: true, topic: true, options: true, position: true, archivedAt: true } } } },
      followUp: { select: { id: true, status: true, dueAt: true, assignedTo: true, outcome: true, resolution: true, resolvedAt: true, resolvedBy: true, updatedAt: true } },
    },
  });
  if (!row) throw new NotFoundError('Cevap bulunamadı');
  const answers = [...row.answers]
    .sort((a, b) => a.question.position - b.question.position)
    .map((answer) => {
      const options = new Map(/** @type {any[]} */ (answer.question.options ?? []).map((option) => [option.id, option.label?.tr ?? option.id]));
      return {
        questionId: answer.questionId,
        type: answer.question.type,
        topic: answer.question.topic,
        question: /** @type {any} */ (answer.question.text).tr,
        archived: Boolean(answer.question.archivedAt),
        score: answer.score,
        choices: answer.choiceIds.map((id) => options.get(id) ?? id),
        text: answer.text,
      };
    });
  return {
    ...responseListView(row),
    comment: row.commentText,
    contact: { email: row.reservation.guest?.email ?? null, phone: row.reservation.guest?.phone ?? null },
    analysisModel: row.analysisModel,
    analyzedAt: iso(row.analyzedAt),
    invitation: { sentAt: iso(row.invitation.sentAt), openedAt: iso(row.invitation.openedAt), language: row.invitation.language },
    answers,
    followUp: row.followUp
      ? { ...row.followUp, dueAt: iso(row.followUp.dueAt), resolvedAt: iso(row.followUp.resolvedAt), updatedAt: iso(row.followUp.updatedAt) }
      : null,
  };
}

/* ══════════════════ Rapor ══════════════════ */

/**
 * Dönemin NPS raporu: NPS ve dağılımı, puan ortalaması, cevap oranı, soru ve konu başına ortalama (1–5) ve dağılım,
 * seçenek sayıları, eğilim (haftalık / aylık), AI konu ve duygu dökümü, takip özeti.
 * @param {string} hotelId @param {{ kind: 'POST_STAY' | 'MID_STAY', from: string, to: string }} query
 */
export async function surveyReport(hotelId, { kind, from, to }) {
  const { timezone } = await surveyClock(hotelId);
  const gte = dayStart(from, timezone);
  const lt = dayStart(addSurveyDays(to, 1), timezone);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const unit = days > WEEKLY_MAX_DAYS ? 'month' : 'week';
  // Ham SQL'de zaman UTC duvar saati (oturumun saat dilimi kaymasın).
  const since = sqlTimestamp(gte);
  const until = sqlTimestamp(lt);

  // Anketin soruları önce (arşivdekiler dahil): seçenek dökümü yalnız seçenekli soruların satırlarını okur.
  const survey = await prisma.survey.findUnique({ where: { hotelId_kind: { hotelId, kind } }, select: { id: true } });
  const questions = survey ? await prisma.surveyQuestion.findMany({ where: { surveyId: survey.id }, select: { id: true, type: true, text: true, topic: true, options: true, position: true, archivedAt: true } }) : [];
  const choiceIds = questions.filter((question) => question.type === 'CHOICE').map((question) => question.id);
  const [totals, invitations, questionStats, choiceStats, trend, topics, followUps] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS "responses",
             count(*) FILTER (WHERE "npsCategory" = 'PROMOTER')::int AS "promoters",
             count(*) FILTER (WHERE "npsCategory" = 'PASSIVE')::int AS "passives",
             count(*) FILTER (WHERE "npsCategory" = 'DETRACTOR')::int AS "detractors",
             avg("ratingAverage")::float AS "ratingAverage",
             count(*) FILTER (WHERE "lowScore")::int AS "lowScores",
             count(*) FILTER (WHERE "commentText" IS NOT NULL)::int AS "comments"
      FROM "SurveyResponse"
      WHERE "hotelId" = ${hotelId} AND "kind" = ${kind}::"SurveyKind" AND "submittedAt" >= ${since} AND "submittedAt" < ${until}`,
    prisma.$queryRaw`
      SELECT count(*)::int AS "sent", count(*) FILTER (WHERE "openedAt" IS NOT NULL)::int AS "opened", count(*) FILTER (WHERE "respondedAt" IS NOT NULL)::int AS "responded"
      FROM "SurveyInvitation"
      WHERE "hotelId" = ${hotelId} AND "kind" = ${kind}::"SurveyKind" AND "sentAt" >= ${since} AND "sentAt" < ${until}`,
    prisma.$queryRaw`
      SELECT "questionId", count(*)::int AS "answers", avg("score")::float AS "average",
             count(*) FILTER (WHERE "score" = 0)::int AS "s0", count(*) FILTER (WHERE "score" = 1)::int AS "s1", count(*) FILTER (WHERE "score" = 2)::int AS "s2",
             count(*) FILTER (WHERE "score" = 3)::int AS "s3", count(*) FILTER (WHERE "score" = 4)::int AS "s4", count(*) FILTER (WHERE "score" = 5)::int AS "s5",
             count(*) FILTER (WHERE "score" = 6)::int AS "s6", count(*) FILTER (WHERE "score" = 7)::int AS "s7", count(*) FILTER (WHERE "score" = 8)::int AS "s8",
             count(*) FILTER (WHERE "score" = 9)::int AS "s9", count(*) FILTER (WHERE "score" = 10)::int AS "s10"
      FROM "SurveyAnswer"
      WHERE "hotelId" = ${hotelId} AND "kind" = ${kind}::"SurveyKind" AND "submittedAt" >= ${since} AND "submittedAt" < ${until} AND "score" IS NOT NULL
      GROUP BY "questionId"`,
    choiceIds.length
      ? prisma.$queryRaw`
          SELECT a."questionId", c."choice", count(*)::int AS "count"
          FROM "SurveyAnswer" a CROSS JOIN LATERAL unnest(a."choiceIds") AS c("choice")
          WHERE a."questionId" = ANY(${choiceIds}::text[]) AND a."hotelId" = ${hotelId} AND a."submittedAt" >= ${since} AND a."submittedAt" < ${until}
          GROUP BY a."questionId", c."choice"`
      : [],
    prisma.$queryRaw`
      SELECT to_char(date_trunc(${unit}, ("submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS "bucket",
             count(*)::int AS "responses",
             count(*) FILTER (WHERE "npsCategory" = 'PROMOTER')::int AS "promoters",
             count(*) FILTER (WHERE "npsCategory" = 'PASSIVE')::int AS "passives",
             count(*) FILTER (WHERE "npsCategory" = 'DETRACTOR')::int AS "detractors",
             avg("ratingAverage")::float AS "ratingAverage"
      FROM "SurveyResponse"
      WHERE "hotelId" = ${hotelId} AND "kind" = ${kind}::"SurveyKind" AND "submittedAt" >= ${since} AND "submittedAt" < ${until}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT t."topic", count(*)::int AS "mentions",
             count(*) FILTER (WHERE r."sentiment" = 'POSITIVE')::int AS "positive",
             count(*) FILTER (WHERE r."sentiment" = 'NEGATIVE')::int AS "negative",
             count(*) FILTER (WHERE r."sentiment" IN ('NEUTRAL', 'MIXED'))::int AS "neutral"
      FROM "SurveyResponse" r CROSS JOIN LATERAL unnest(r."topics") AS t("topic")
      WHERE r."hotelId" = ${hotelId} AND r."kind" = ${kind}::"SurveyKind" AND r."submittedAt" >= ${since} AND r."submittedAt" < ${until}
      GROUP BY t."topic" ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE f."status" <> 'RESOLVED')::int AS "open",
             count(*) FILTER (WHERE f."status" <> 'RESOLVED' AND f."dueAt" < ${SQL_NOW})::int AS "overdue",
             count(*) FILTER (WHERE f."status" = 'RESOLVED')::int AS "resolved"
      FROM "SurveyFollowUp" f
      WHERE f."hotelId" = ${hotelId} AND f."kind" = ${kind}::"SurveyKind" AND f."createdAt" >= ${since} AND f."createdAt" < ${until}`,
  ]);

  const total = /** @type {any[]} */ (totals)[0];
  const sentRow = /** @type {any[]} */ (invitations)[0];
  const stats = new Map(/** @type {any[]} */ (questionStats).map((row) => [row.questionId, row]));
  const choices = /** @type {any[]} */ (choiceStats);
  const byQuestion = questions
    .filter((question) => !question.archivedAt || stats.has(question.id) || choices.some((row) => row.questionId === question.id))
    .sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.position - b.position)
    .map((question) => {
      const row = stats.get(question.id);
      const scale = question.type === 'NPS' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5];
      const optionCounts = new Map(choices.filter((entry) => entry.questionId === question.id).map((entry) => [entry.choice, entry.count]));
      return {
        id: question.id,
        type: question.type,
        topic: question.topic,
        text: /** @type {any} */ (question.text).tr,
        archived: Boolean(question.archivedAt),
        answers: question.type === 'CHOICE' ? [...optionCounts.values()].reduce((sum, value) => sum + value, 0) : (row?.answers ?? 0),
        average: row?.average === null || row?.average === undefined ? null : Math.round(row.average * 100) / 100,
        distribution: question.type === 'NPS' || question.type === 'RATING' ? scale.map((value) => ({ value, count: row?.[`s${value}`] ?? 0 })) : [],
        options: question.type === 'CHOICE' ? /** @type {any[]} */ (question.options ?? []).map((option) => ({ id: option.id, label: option.label?.tr ?? option.id, count: optionCounts.get(option.id) ?? 0 })) : [],
      };
    });
  // Konu başına 1–5 ortalaması (cevap sayısıyla ağırlıklı).
  const topicAverages = SURVEY_TOPICS.map((topic) => {
    const rows = byQuestion.filter((question) => question.type === 'RATING' && question.topic === topic && question.average !== null);
    const answers = rows.reduce((sum, row) => sum + row.answers, 0);
    return answers ? { topic, answers, average: Math.round((rows.reduce((sum, row) => sum + /** @type {number} */ (row.average) * row.answers, 0) / answers) * 100) / 100 } : null;
  }).filter(Boolean);

  return {
    kind,
    from,
    to,
    granularity: unit === 'week' ? 'WEEK' : 'MONTH',
    nps: npsFromCounts(total),
    counts: { promoters: total.promoters, passives: total.passives, detractors: total.detractors },
    responses: total.responses,
    ratingAverage: total.ratingAverage === null ? null : Math.round(total.ratingAverage * 100) / 100,
    lowScores: total.lowScores,
    comments: total.comments,
    invitations: { sent: sentRow.sent, opened: sentRow.opened, responded: sentRow.responded, responseRate: sentRow.sent ? Math.round((sentRow.responded / sentRow.sent) * 1000) / 10 : null },
    questions: byQuestion,
    topics: topicAverages,
    trend: /** @type {any[]} */ (trend).map((row) => ({ bucket: row.bucket, responses: row.responses, nps: npsFromCounts(row), ratingAverage: row.ratingAverage === null ? null : Math.round(row.ratingAverage * 100) / 100 })),
    aiTopics: /** @type {any[]} */ (topics).filter((row) => SURVEY_TOPICS.includes(row.topic)),
    followUps: /** @type {any[]} */ (followUps)[0],
  };
}

/* ══════════════════ AI: cevap etiketi ══════════════════ */

/**
 * Ajanın girdisi: yalnız puanlar ve yorum (ad, onay kodu, iletişim gitmez).
 * @param {string} hotelId @param {string} responseId
 */
export async function analysisInput(hotelId, responseId) {
  const row = await prisma.surveyResponse.findFirst({ where: { id: responseId, hotelId }, select: { kind: true, language: true, npsScore: true, ratingAverage: true, commentText: true, analysisStatus: true } });
  if (!row) throw new NotFoundError('Cevap bulunamadı');
  return { kind: row.kind, language: row.language, npsScore: row.npsScore, ratingAverage: row.ratingAverage === null ? null : Number(row.ratingAverage), comment: row.commentText, pending: row.analysisStatus === 'PENDING', topics: SURVEY_TOPICS, sentiments: SURVEY_SENTIMENTS };
}

/**
 * Ajanın sonucu: yalnız bekleyen cevaba yazılır (iki kez gelen olay ikinci kez yazmaz). Konu ve duygu listeyle sınırlı.
 * @param {string} hotelId @param {string} responseId
 * @param {{ status: 'DONE', sentiment: string, topics: string[], summary: string | null, model: string } | { status: 'FAILED', model?: string | null }} result
 */
export async function completeAnalysis(hotelId, responseId, result) {
  return writeWithEvents(async (tx, stage) => {
    const data =
      result.status === 'DONE'
        ? {
            analysisStatus: 'DONE',
            sentiment: SURVEY_SENTIMENTS.includes(result.sentiment) ? result.sentiment : null,
            topics: [...new Set(result.topics.filter((topic) => SURVEY_TOPICS.includes(topic)))].slice(0, 5),
            aiSummary: result.summary?.slice(0, 300) ?? null,
            analysisModel: result.model,
            analyzedAt: new Date(),
          }
        : { analysisStatus: 'FAILED', analysisModel: result.model ?? null, analyzedAt: new Date() };
    const updated = await tx.surveyResponse.updateMany({ where: { id: responseId, hotelId, analysisStatus: 'PENDING' }, data: /** @type {any} */ (data) });
    if (updated.count === 0) return false;
    await stage('survey.analysis.completed', { hotelId, responseId, status: result.status });
    return true;
  });
}

/* ══════════════════ AI: dönem özeti ══════════════════ */

/** @param {any} row */
const insightView = (row) =>
  row
    ? {
        id: row.id,
        kind: row.kind,
        from: toIsoDay(row.fromDay),
        to: toIsoDay(row.toDay),
        status: row.status === 'PENDING' && Date.now() - row.requestedAt.getTime() > INSIGHT_TIMEOUT_MS ? 'FAILED' : row.status,
        failureReason: row.status === 'PENDING' && Date.now() - row.requestedAt.getTime() > INSIGHT_TIMEOUT_MS ? 'Özet zamanında tamamlanmadı; tekrar isteyebilirsiniz.' : row.failureReason,
        responseCount: row.responseCount,
        commentCount: row.commentCount,
        summary: row.summary,
        themes: row.themes ?? [],
        actions: row.actions ?? [],
        model: row.model,
        requestedBy: row.requestedBy,
        requestedAt: iso(row.requestedAt),
        completedAt: iso(row.completedAt),
      }
    : null;

/**
 * Dönemin son özeti ve özet istenebilir mi.
 * @param {string} hotelId @param {{ kind: string, from: string, to: string }} query
 */
export async function getInsight(hotelId, { kind, from, to }) {
  const [row, availability] = await Promise.all([
    prisma.surveyInsight.findFirst({ where: { hotelId, kind: /** @type {any} */ (kind), fromDay: new Date(`${from}T00:00:00Z`), toDay: new Date(`${to}T00:00:00Z`) }, orderBy: { requestedAt: 'desc' } }),
    aiAvailability(hotelId),
  ]);
  return { insight: insightView(row), ...availability };
}

/**
 * Dönem özeti ister. Bekleyen (zamanı geçmemiş) istek varsa o döner (çift tık / iki kişi → tek istek; kısmi tekil index).
 * Yorumsuz dönemde istenmez.
 * @param {string} hotelId @param {{ kind: 'POST_STAY' | 'MID_STAY', from: string, to: string }} query
 */
export async function requestInsight(hotelId, { kind, from, to }) {
  const availability = await aiAvailability(hotelId);
  if (!availability.available) throw new ConflictError(/** @type {string} */ (availability.reason), 'AI_UNAVAILABLE');
  const { timezone } = await surveyClock(hotelId);
  const where = { hotelId, kind, commentText: { not: null }, submittedAt: { gte: dayStart(from, timezone), lt: dayStart(addSurveyDays(to, 1), timezone) } };
  const comments = await prisma.surveyResponse.count({ where });
  if (!comments) throw new ConflictError('Bu dönemde yorumlu cevap yok; özetlenecek bir şey yok.', 'SURVEY_NO_COMMENTS');
  const fromDay = new Date(`${from}T00:00:00Z`);
  const toDay = new Date(`${to}T00:00:00Z`);
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const pending = await tx.surveyInsight.findFirst({ where: { hotelId, kind, fromDay, toDay, status: 'PENDING' } });
      if (pending) {
        if (Date.now() - pending.requestedAt.getTime() <= INSIGHT_TIMEOUT_MS) return;
        await tx.surveyInsight.update({ where: { id: pending.id }, data: { status: 'FAILED', failureReason: 'Özet zamanında tamamlanmadı.', completedAt: new Date() } });
      }
      const row = await tx.surveyInsight.create({ data: { hotelId, kind, fromDay, toDay, commentCount: comments, requestedBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'SurveyInsight', entityId: row.id, action: 'CREATE', after: { kind, from, to, comments } });
      await stage('survey.insight.requested', { hotelId, insightId: row.id });
    });
  } catch (error) {
    if (error?.code !== 'P2002') rethrowPrismaError(error);
  }
  return getInsight(hotelId, { kind, from, to });
}

/**
 * Ajanın girdisi: dönemin sayıları ve en yeni yorumlar (kısaltılmış; ad, onay kodu, iletişim yok).
 * @param {string} hotelId @param {string} insightId
 */
export async function insightInput(hotelId, insightId) {
  const insight = await prisma.surveyInsight.findFirst({ where: { id: insightId, hotelId } });
  if (!insight) throw new NotFoundError('Özet isteği bulunamadı');
  const from = /** @type {string} */ (toIsoDay(insight.fromDay));
  const to = /** @type {string} */ (toIsoDay(insight.toDay));
  const report = await surveyReport(hotelId, { kind: insight.kind, from, to });
  const { timezone } = await surveyClock(hotelId);
  const rows = await prisma.surveyResponse.findMany({
    where: { hotelId, kind: insight.kind, commentText: { not: null }, submittedAt: { gte: dayStart(from, timezone), lt: dayStart(addSurveyDays(to, 1), timezone) } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: SURVEY_INSIGHT_MAX_COMMENTS,
    select: { npsScore: true, ratingAverage: true, commentText: true, language: true, sentiment: true, topics: true },
  });
  return {
    pending: insight.status === 'PENDING',
    kind: insight.kind,
    period: { from, to },
    stats: { responses: report.responses, nps: report.nps, ratingAverage: report.ratingAverage, lowScores: report.lowScores, topicAverages: report.topics, aiTopics: report.aiTopics },
    comments: rows.map((row) => ({
      nps: row.npsScore,
      rating: row.ratingAverage === null ? null : Number(row.ratingAverage),
      language: row.language,
      sentiment: row.sentiment,
      topics: row.topics,
      text: /** @type {string} */ (row.commentText).slice(0, SURVEY_INSIGHT_COMMENT_CHARS),
    })),
    responseCount: report.responses,
  };
}

/**
 * Ajanın sonucu (yalnız bekleyen istek kapanır).
 * @param {string} hotelId @param {string} insightId
 * @param {{ status: 'READY', summary: string, themes: any[], actions: string[], model: string, responseCount: number } | { status: 'FAILED', failureReason: string, model?: string | null }} result
 */
export async function completeInsight(hotelId, insightId, result) {
  return writeWithEvents(async (tx, stage) => {
    const data =
      result.status === 'READY'
        ? { status: 'READY', summary: result.summary, themes: result.themes, actions: result.actions, model: result.model, responseCount: result.responseCount, completedAt: new Date() }
        : { status: 'FAILED', failureReason: result.failureReason, model: result.model ?? null, completedAt: new Date() };
    const updated = await tx.surveyInsight.updateMany({ where: { id: insightId, hotelId, status: 'PENDING' }, data: /** @type {any} */ (data) });
    if (updated.count === 0) return false;
    await stage('survey.insight.completed', { hotelId, insightId, status: result.status });
    return true;
  });
}

