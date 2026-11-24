import { randomBytes } from 'node:crypto';
import { actorRegistry } from '@hotelos/actor-kit';
import { currentActor } from '@hotelos/core';
import { SURVEY_DEFAULT_QUESTIONS, SURVEY_KINDS, SURVEY_MAX_QUESTIONS, surveyMissingLanguages } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { isActorEnabledCached } from '../../lib/actor-settings.js';
import { getAiSettingsCached } from '../concierge/settings.js';
import { iso, loadSurveySettings, prisma, publicBaseUrl } from './shared.js';

/**
 * Anket tasarımı ve ayarlar (modül 55).
 *
 * Otelde tür başına bir anket; ilk okunuşta varsayılan sorularla kurulur. Soru değişiklikleri anketin `version`'ıyla
 * iyimser kilitlidir (iki yönetici aynı anda düzenlerse ikincisi "yenileyin" alır). Cevaplanmış soru silinmez,
 * arşive kalkar (geçmiş cevaplar raporda durur), tipi değişmez, cevaplanmış seçeneği kaldırılamaz.
 */

export const INSIGHT_AGENT_NAME = 'insight-agent';
/** Tasarım ekranında soru başına sayılan en fazla cevap. */
export const ANSWER_COUNT_CAP = 1000;

/** Seçeneğe kimlik (verilmediyse): kısa, rastgele, rapor için kalıcı. */
const optionId = () => `o-${randomBytes(4).toString('hex')}`;

/** @param {any} question şema çıktısı */
const questionData = (question) => ({
  type: question.type,
  text: question.text,
  topic: question.topic,
  required: question.required,
  multiple: question.type === 'CHOICE' ? question.multiple : false,
  options: question.type === 'CHOICE' ? question.options.map((option) => ({ id: option.id ?? optionId(), label: option.label })) : [],
});

/**
 * Otelin anketi; yoksa varsayılan sorularla kurulur (eşzamanlı ilk okumada tekil kısıt ikincisini durdurur).
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind
 */
export async function ensureSurvey(hotelId, kind) {
  const existing = await prisma.survey.findUnique({ where: { hotelId_kind: { hotelId, kind } }, select: { id: true, version: true } });
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      const survey = await tx.survey.create({ data: { hotelId, kind, updatedBy: 'kurulum' }, select: { id: true, version: true } });
      await tx.surveyQuestion.createMany({
        data: SURVEY_DEFAULT_QUESTIONS[kind].map((question, index) => ({ hotelId, surveyId: survey.id, position: index + 1, ...questionData({ multiple: false, options: [], ...question }) })),
      });
      return survey;
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return /** @type {{ id: string, version: number }} */ (await prisma.survey.findUnique({ where: { hotelId_kind: { hotelId, kind } }, select: { id: true, version: true } }));
  }
}

/** @param {any} row @param {number} answerCount */
const questionView = (row, answerCount) => ({
  id: row.id,
  type: row.type,
  text: row.text,
  topic: row.topic,
  required: row.required,
  multiple: row.multiple,
  options: row.options ?? [],
  position: row.position,
  archivedAt: iso(row.archivedAt),
  answerCount,
});

/**
 * Anketin tasarımı: etkin sorular (sırasıyla), arşivdekiler, soru başına cevap sayısı, eksik diller.
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind
 */
export async function getSurveyDesign(hotelId, kind) {
  const { id } = await ensureSurvey(hotelId, kind);
  const [survey, questions] = await Promise.all([
    prisma.survey.findUnique({ where: { id }, select: { version: true, updatedBy: true, updatedAt: true } }),
    prisma.surveyQuestion.findMany({ where: { surveyId: id, hotelId }, orderBy: [{ archivedAt: 'asc' }, { position: 'asc' }] }),
  ]);
  // Soru başına cevap sayısı `ANSWER_COUNT_CAP`'te kesilir ("1.000+"): yıllarca biriken cevap satırları sayılmaz,
  // karar için (silinir mi, tipi değişir mi) "cevabı var mı" yeter. Her soru en fazla bu kadar indeks girdisi okur.
  const ids = questions.map((row) => row.id);
  const counts = ids.length
    ? /** @type {Array<{ id: string, count: number }>} */ (
        await prisma.$queryRaw`
          SELECT q."id", (SELECT count(*)::int FROM (SELECT 1 FROM "SurveyAnswer" a WHERE a."questionId" = q."id" LIMIT ${ANSWER_COUNT_CAP}) s) AS "count"
          FROM unnest(${ids}::text[]) AS q("id")`
      )
    : [];
  const answered = new Map(counts.map((row) => [row.id, row.count]));
  const active = questions.filter((row) => !row.archivedAt).map((row) => questionView(row, answered.get(row.id) ?? 0));
  return {
    kind,
    version: /** @type {any} */ (survey).version,
    updatedBy: /** @type {any} */ (survey).updatedBy,
    updatedAt: iso(/** @type {any} */ (survey).updatedAt),
    questions: active,
    archived: questions.filter((row) => row.archivedAt).map((row) => questionView(row, answered.get(row.id) ?? 0)),
    missingLanguages: surveyMissingLanguages(active),
    maxQuestions: SURVEY_MAX_QUESTIONS,
  };
}

/**
 * Anketin sürümünü ilerletir (iyimser kilit): beklenen sürüm değilse başkası değiştirmiştir.
 * @param {any} tx @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {number} expectedVersion
 */
async function bumpSurvey(tx, hotelId, kind, expectedVersion) {
  const updated = await tx.survey.updateMany({ where: { hotelId, kind, version: expectedVersion }, data: { version: { increment: 1 }, updatedBy: currentActor() } });
  if (updated.count === 0) throw new StaleWriteError('Anket bu arada başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.');
  return /** @type {{ id: string }} */ (await tx.survey.findUnique({ where: { hotelId_kind: { hotelId, kind } }, select: { id: true } }));
}

/** @param {any} tx @param {string} surveyId @param {string | null} exceptId */
async function assertSingleNps(tx, surveyId, exceptId) {
  const nps = await tx.surveyQuestion.count({ where: { surveyId, type: 'NPS', archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (nps > 0) throw new ConflictError('Ankette tek tavsiye (NPS) sorusu olur.', 'SURVEY_NPS_EXISTS');
}

/**
 * Soru ekler (sona).
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {{ expectedVersion: number, question: any }} input
 */
export async function addQuestion(hotelId, kind, { expectedVersion, question }) {
  await ensureSurvey(hotelId, kind);
  await writeWithEvents(async (tx, stage) => {
    const survey = await bumpSurvey(tx, hotelId, kind, expectedVersion);
    const active = await tx.surveyQuestion.findMany({ where: { surveyId: survey.id, archivedAt: null }, select: { position: true } });
    if (active.length >= SURVEY_MAX_QUESTIONS) throw new ConflictError(`Ankette en fazla ${SURVEY_MAX_QUESTIONS} soru olur.`, 'SURVEY_TOO_MANY_QUESTIONS');
    if (question.type === 'NPS') await assertSingleNps(tx, survey.id, null);
    const created = await tx.surveyQuestion.create({
      data: { hotelId, surveyId: survey.id, position: Math.max(0, ...active.map((row) => row.position)) + 1, ...questionData(question) },
      select: { id: true },
    });
    await recordAudit(tx, { hotelId, entity: 'SurveyQuestion', entityId: created.id, action: 'CREATE', after: { kind, type: question.type, text: question.text.tr } });
    await stage('survey.settings.changed', { hotelId, area: 'QUESTIONS' });
  });
  return getSurveyDesign(hotelId, kind);
}

/**
 * Soruyu düzenler. Cevaplanmış soruda tip değişmez, cevaplanmış seçenek kaldırılamaz (yeniden adlandırılabilir).
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {string} questionId @param {{ expectedVersion: number, question: any }} input
 */
export async function updateQuestion(hotelId, kind, questionId, { expectedVersion, question }) {
  await writeWithEvents(async (tx, stage) => {
    const survey = await bumpSurvey(tx, hotelId, kind, expectedVersion);
    const current = await tx.surveyQuestion.findFirst({ where: { id: questionId, surveyId: survey.id, hotelId, archivedAt: null } });
    if (!current) throw new NotFoundError('Soru bulunamadı');
    const answered = await tx.surveyAnswer.count({ where: { questionId } });
    if (answered && current.type !== question.type) throw new ConflictError('Cevaplanmış sorunun tipi değişmez; yeni soru ekleyip bunu kaldırın.', 'SURVEY_QUESTION_ANSWERED');
    if (question.type === 'NPS') await assertSingleNps(tx, survey.id, questionId);
    const data = questionData(question);
    if (answered && current.type === 'CHOICE') {
      const kept = new Set(data.options.map((option) => option.id));
      const removed = /** @type {any[]} */ (current.options ?? []).map((option) => option.id).filter((id) => !kept.has(id));
      if (removed.length && (await tx.surveyAnswer.count({ where: { questionId, choiceIds: { hasSome: removed } } }))) {
        throw new ValidationError('Cevaplanmış seçenek kaldırılamaz; adını değiştirebilirsiniz.', { field: 'options' });
      }
    }
    await tx.surveyQuestion.update({ where: { id: questionId }, data });
    await recordAudit(tx, { hotelId, entity: 'SurveyQuestion', entityId: questionId, action: 'UPDATE', before: { type: current.type, text: /** @type {any} */ (current.text).tr }, after: { type: data.type, text: data.text.tr } });
    await stage('survey.settings.changed', { hotelId, area: 'QUESTIONS' });
  });
  return getSurveyDesign(hotelId, kind);
}

/**
 * Soruların sırası: etkin soruların tamamı yeni sırayla verilmeli.
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {{ expectedVersion: number, questionIds: string[] }} input
 */
export async function reorderQuestions(hotelId, kind, { expectedVersion, questionIds }) {
  await writeWithEvents(async (tx, stage) => {
    const survey = await bumpSurvey(tx, hotelId, kind, expectedVersion);
    const active = await tx.surveyQuestion.findMany({ where: { surveyId: survey.id, archivedAt: null }, select: { id: true } });
    const ids = new Set(active.map((row) => row.id));
    if (questionIds.length !== ids.size || new Set(questionIds).size !== questionIds.length || questionIds.some((id) => !ids.has(id))) {
      throw new ValidationError('Sıralama anketin bütün sorularını bir kez içermeli; sayfayı yenileyin.', { field: 'questionIds' });
    }
    for (const [index, id] of questionIds.entries()) await tx.surveyQuestion.update({ where: { id }, data: { position: index + 1 } });
    await recordAudit(tx, { hotelId, entity: 'Survey', entityId: survey.id, action: 'UPDATE', after: { kind, order: questionIds.length } });
    await stage('survey.settings.changed', { hotelId, area: 'QUESTIONS' });
  });
  return getSurveyDesign(hotelId, kind);
}

/**
 * Soruyu kaldırır: cevabı yoksa silinir, varsa arşive kalkar (raporda geçmiş cevaplarıyla durur). Ankette en az bir
 * soru kalır.
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {string} questionId @param {{ expectedVersion: number }} input
 */
export async function removeQuestion(hotelId, kind, questionId, { expectedVersion }) {
  try {
    await removeInTx(hotelId, kind, questionId, expectedVersion);
  } catch (error) {
    // Cevapsız soru silinirken aynı anda biri cevapladı (yabancı anahtar): silinmez; yeniden denenince arşive kalkar.
    if (error?.code === 'P2003') throw new ConflictError('Soru az önce cevaplandı; sayfayı yenileyip yeniden deneyin (arşive kalkacak).', 'SURVEY_QUESTION_ANSWERED');
    throw error;
  }
  return getSurveyDesign(hotelId, kind);
}

/** @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {string} questionId @param {number} expectedVersion */
async function removeInTx(hotelId, kind, questionId, expectedVersion) {
  await writeWithEvents(async (tx, stage) => {
    const survey = await bumpSurvey(tx, hotelId, kind, expectedVersion);
    const current = await tx.surveyQuestion.findFirst({ where: { id: questionId, surveyId: survey.id, hotelId, archivedAt: null }, select: { id: true, text: true } });
    if (!current) throw new NotFoundError('Soru bulunamadı');
    if ((await tx.surveyQuestion.count({ where: { surveyId: survey.id, archivedAt: null } })) <= 1) throw new ConflictError('Ankette en az bir soru kalmalı.', 'SURVEY_LAST_QUESTION');
    const answered = await tx.surveyAnswer.count({ where: { questionId } });
    if (answered) await tx.surveyQuestion.update({ where: { id: questionId }, data: { archivedAt: new Date() } });
    else await tx.surveyQuestion.delete({ where: { id: questionId } });
    await recordAudit(tx, { hotelId, entity: 'SurveyQuestion', entityId: questionId, action: answered ? 'UPDATE' : 'DELETE', before: { text: /** @type {any} */ (current.text).tr }, after: answered ? { archived: true } : null });
    await stage('survey.settings.changed', { hotelId, area: 'QUESTIONS' });
  });
}

/**
 * Arşivdeki soruyu geri alır (sona).
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {string} questionId @param {{ expectedVersion: number }} input
 */
export async function restoreQuestion(hotelId, kind, questionId, { expectedVersion }) {
  await writeWithEvents(async (tx, stage) => {
    const survey = await bumpSurvey(tx, hotelId, kind, expectedVersion);
    const current = await tx.surveyQuestion.findFirst({ where: { id: questionId, surveyId: survey.id, hotelId, archivedAt: { not: null } }, select: { id: true, type: true } });
    if (!current) throw new NotFoundError('Arşivde böyle bir soru yok');
    const active = await tx.surveyQuestion.findMany({ where: { surveyId: survey.id, archivedAt: null }, select: { position: true } });
    if (active.length >= SURVEY_MAX_QUESTIONS) throw new ConflictError(`Ankette en fazla ${SURVEY_MAX_QUESTIONS} soru olur.`, 'SURVEY_TOO_MANY_QUESTIONS');
    if (current.type === 'NPS') await assertSingleNps(tx, survey.id, questionId);
    await tx.surveyQuestion.update({ where: { id: questionId }, data: { archivedAt: null, position: Math.max(0, ...active.map((row) => row.position)) + 1 } });
    await recordAudit(tx, { hotelId, entity: 'SurveyQuestion', entityId: questionId, action: 'UPDATE', after: { archived: false } });
    await stage('survey.settings.changed', { hotelId, area: 'QUESTIONS' });
  });
  return getSurveyDesign(hotelId, kind);
}

/* ══════════════════ Ayarlar ══════════════════ */

/**
 * AI etiketi / özeti bu otelde yapılabilir mi; değilse neden.
 * @param {string} hotelId
 * @returns {Promise<{ available: boolean, reason: string | null }>}
 */
export async function aiAvailability(hotelId) {
  if (!actorRegistry.get(INSIGHT_AGENT_NAME)) return { available: false, reason: 'Sunucuda AI anahtarı tanımlı değil.' };
  const settings = await getAiSettingsCached(hotelId);
  if (!settings.enabled) return { available: false, reason: 'AI bu otelde kapalı (Ayarlar › AI asistanı).' };
  if (!settings.conciergeModel) return { available: false, reason: 'AI modeli seçilmemiş (Ayarlar › AI asistanı).' };
  if (!(await isActorEnabledCached(hotelId, INSIGHT_AGENT_NAME))) return { available: false, reason: 'Geri bildirim ajanı aktör panelinde kapalı.' };
  return { available: true, reason: null };
}

/** @param {string} hotelId */
export async function getSurveySettings(hotelId) {
  const [row, baseUrl, ai, channels] = await Promise.all([
    loadSurveySettings(prisma, hotelId),
    publicBaseUrl(hotelId),
    aiAvailability(hotelId),
    prisma.notificationChannelConfig.count({ where: { hotelId, enabled: true } }),
  ]);
  const { hotelId: _hotel, createdAt: _created, ...settings } = /** @type {any} */ (row);
  return { ...settings, updatedAt: iso(row.updatedAt), publicBaseUrl: baseUrl, ai, channelsEnabled: channels > 0 };
}

/**
 * Ayarı kaydeder (ilk kayıt danışma kilidiyle; sonrası `updatedAt` ile iyimser kilit).
 * @param {string} hotelId @param {any} input `surveySettingsSchema`
 */
export async function saveSurveySettings(hotelId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`survey-settings:${hotelId}`}))`;
    const current = await tx.surveySettings.findUnique({ where: { hotelId } });
    if (current && (!input.expectedUpdatedAt || current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())) throw new StaleWriteError();
    const { expectedUpdatedAt: _version, ...values } = input;
    const data = { ...values, googleReviewUrl: values.googleReviewUrl ?? null, tripadvisorReviewUrl: values.tripadvisorReviewUrl ?? null, updatedBy: actor };
    await tx.surveySettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    const summary = (row) => (row ? { postStayEnabled: row.postStayEnabled, midStayEnabled: row.midStayEnabled, postStayDelayDays: row.postStayDelayDays, lowNpsThreshold: row.lowNpsThreshold, lowRatingThreshold: row.lowRatingThreshold } : null);
    await recordAudit(tx, { hotelId, entity: 'SurveySettings', entityId: hotelId, action: current ? 'UPDATE' : 'CREATE', before: summary(current), after: summary(data) });
    await stage('survey.settings.changed', { hotelId, area: 'SETTINGS' });
  });
  // Anketler kapalıyken de tasarım hazır olsun (ilk açılışta varsayılan sorular).
  for (const kind of SURVEY_KINDS) await ensureSurvey(hotelId, kind);
  return getSurveySettings(hotelId);
}
