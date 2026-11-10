import { toIsoDay } from '@hotelos/core';
import { SURVEY_FOLLOW_UP_DUE_HOURS, SURVEY_KIND_LABELS, SURVEY_LANGUAGES, scoreSurveyResponse, surveyAnswerProblems } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getHotelSettings } from '../settings/service.js';
import { aiAvailability } from './design.js';
import { fullGuestName, loadSurveySettings, prisma, shortGuestName, signatureMatches } from './shared.js';

/**
 * Misafirin anket uçları (modül 55), `/public/survey/:token` altında. Oturumsuzdur; kimlik bağlantının imzasıdır,
 * hız sınırı bağlantı başına (üstünde IP tavanı). Misafire en az veri gider: otelin adı, adının kısa hâli, konaklama
 * tarihleri, sorular. Hata kodla döner; misafir uygulaması kendi dilinde yazar.
 */

/** @param {any} client @param {string} token biçimi şemada denetlendi */
async function resolveInvitation(client, token) {
  const [invitationId, given] = token.split('.');
  const invitation = await client.surveyInvitation.findFirst({
    where: { id: invitationId },
    select: {
      id: true,
      hotelId: true,
      surveyId: true,
      kind: true,
      nonce: true,
      language: true,
      status: true,
      expiresAt: true,
      openedAt: true,
      respondedAt: true,
      reservationId: true,
      guestId: true,
      reservation: { select: { confirmationCode: true, checkIn: true, checkOut: true, roomId: true, status: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!invitation || !signatureMatches(invitation, given ?? '')) throw new NotFoundError('Bağlantı bulunamadı');
  return invitation;
}

/** @param {{ respondedAt: Date | null, expiresAt: Date }} invitation @param {Date} now */
const stateOf = (invitation, now) => (invitation.respondedAt ? 'ANSWERED' : invitation.expiresAt <= now ? 'EXPIRED' : 'OPEN');

/** Anketin etkin soruları (misafire: dört dilde metin). @param {any} client @param {string} surveyId */
const activeQuestions = (client, surveyId) =>
  client.surveyQuestion.findMany({ where: { surveyId, archivedAt: null }, orderBy: { position: 'asc' }, select: { id: true, type: true, text: true, topic: true, required: true, multiple: true, options: true } });

/** Yorum bağlantıları: puandan bağımsız herkese (yalnız memnunlara göstermek Google kurallarına aykırı). @param {any} settings */
const reviewLinks = (settings) =>
  [
    settings.googleReviewUrl ? { site: 'GOOGLE', url: settings.googleReviewUrl } : null,
    settings.tripadvisorReviewUrl ? { site: 'TRIPADVISOR', url: settings.tripadvisorReviewUrl } : null,
  ].filter(Boolean);

/**
 * Anket sayfasının verisi. İlk açılış işaretlenir (cevap oranı ve "açtı ama cevaplamadı" için).
 * @param {string} token
 */
export async function surveyForm(token) {
  const now = new Date();
  const invitation = await resolveInvitation(prisma, token);
  const [hotel, settings, questions] = await Promise.all([getHotelSettings(invitation.hotelId), loadSurveySettings(prisma, invitation.hotelId), activeQuestions(prisma, invitation.surveyId)]);
  const state = stateOf(invitation, now);
  if (state === 'OPEN' && !invitation.openedAt) {
    await prisma.surveyInvitation.updateMany({ where: { id: invitation.id, openedAt: null }, data: { openedAt: now, status: 'OPENED' } });
  }
  return {
    state,
    kind: invitation.kind,
    language: invitation.language,
    languages: SURVEY_LANGUAGES,
    hotel: { name: hotel.name, phone: hotel.phone ?? null },
    guestName: shortGuestName(invitation.reservation.guest),
    stay: { checkIn: toIsoDay(invitation.reservation.checkIn), checkOut: toIsoDay(invitation.reservation.checkOut) },
    questions: state === 'OPEN' ? questions : [],
    reviewLinks: state === 'ANSWERED' ? reviewLinks(settings) : [],
  };
}

/**
 * Cevabı kaydeder: her davet bir kez cevaplanır (tekil kısıt; eşzamanlı ikinci gönderim "zaten cevaplandı" alır).
 * Düşük puanda aynı işlemde takip kaydı açılır ve personelin ziline uyarı düşer; yorum varsa ve AI açıksa
 * etiket istenir. İşlem kaydına yorum metni yazılmaz (yalnız puanlar).
 *
 * @param {string} token @param {{ language: string, answers: Array<{ questionId: string, score?: number | null, choiceIds?: string[] | null, text?: string | null }> }} input
 */
export async function submitSurvey(token, input) {
  const now = new Date();
  const seed = await resolveInvitation(prisma, token);
  const [settings, ai] = await Promise.all([loadSurveySettings(prisma, seed.hotelId), aiAvailability(seed.hotelId)]);
  const hotelId = seed.hotelId;
  try {
    await writeWithEvents(async (tx, stage) => {
      const invitation = await resolveInvitation(tx, token);
      const state = stateOf(invitation, now);
      if (state === 'ANSWERED') throw new ConflictError('Bu anket zaten cevaplandı. Teşekkür ederiz!', 'SURVEY_ALREADY_ANSWERED');
      if (state === 'EXPIRED') throw new ConflictError('Bu anketin süresi doldu.', 'SURVEY_EXPIRED');
      const questions = await activeQuestions(tx, invitation.surveyId);
      const answers = input.answers.map((answer) => ({ ...answer, text: answer.text?.trim() || null, choiceIds: answer.choiceIds ?? [] }));
      const { problems, unknown } = surveyAnswerProblems(/** @type {any} */ (questions), answers);
      if (unknown.length) throw new ConflictError('Anket bu arada güncellendi; sayfayı yenileyin.', 'SURVEY_CHANGED');
      if (Object.keys(problems).length) throw new ValidationError('Bazı cevaplar eksik ya da geçersiz', { fields: problems });

      const types = new Map(questions.map((question) => [question.id, question.type]));
      const kept = answers.filter((answer) => {
        const type = types.get(answer.questionId);
        if (type === 'NPS' || type === 'RATING') return Number.isInteger(answer.score);
        if (type === 'CHOICE') return answer.choiceIds.length > 0;
        return Boolean(answer.text);
      });
      const score = scoreSurveyResponse(/** @type {any} */ (questions), kept, settings);
      const reservation = invitation.reservation;
      const analysisStatus = score.commentText && ai.available ? 'PENDING' : 'SKIPPED';
      const response = await tx.surveyResponse.create({
        data: {
          hotelId,
          invitationId: invitation.id,
          surveyId: invitation.surveyId,
          kind: invitation.kind,
          reservationId: invitation.reservationId,
          guestId: invitation.guestId,
          language: input.language,
          submittedAt: now,
          npsScore: score.npsScore,
          npsCategory: score.npsCategory,
          ratingAverage: score.ratingAverage,
          lowScore: score.lowScore,
          commentText: score.commentText,
          searchText: [reservation.confirmationCode, fullGuestName(reservation.guest), score.commentText ?? ''].join(' ').slice(0, 7000),
          analysisStatus,
        },
        select: { id: true },
      });
      if (kept.length) {
        await tx.surveyAnswer.createMany({
          data: kept.map((answer) => ({
            hotelId,
            responseId: response.id,
            questionId: answer.questionId,
            kind: invitation.kind,
            submittedAt: now,
            score: Number.isInteger(answer.score) ? answer.score : null,
            choiceIds: answer.choiceIds,
            text: answer.text,
          })),
        });
      }
      await tx.surveyInvitation.update({ where: { id: invitation.id }, data: { status: 'RESPONDED', respondedAt: now, openedAt: invitation.openedAt ?? now } });
      await recordAudit(tx, {
        hotelId,
        entity: 'SurveyResponse',
        entityId: response.id,
        action: 'CREATE',
        after: { kind: invitation.kind, reservation: reservation.confirmationCode, npsScore: score.npsScore, ratingAverage: score.ratingAverage, lowScore: score.lowScore, comment: Boolean(score.commentText) },
      });

      if (score.lowScore) {
        const inHouse = invitation.kind === 'MID_STAY';
        const followUp = await tx.surveyFollowUp.create({
          data: { hotelId, responseId: response.id, reservationId: invitation.reservationId, kind: invitation.kind, dueAt: new Date(now.getTime() + SURVEY_FOLLOW_UP_DUE_HOURS[invitation.kind] * 3_600_000) },
          select: { id: true },
        });
        const where = inHouse && reservation.room?.number ? `oda ${reservation.room.number}, içeride` : `${reservation.confirmationCode}`;
        const points = [score.npsScore !== null ? `NPS ${score.npsScore}` : null, score.ratingAverage !== null ? `puan ort. ${score.ratingAverage.toFixed(2)}` : null].filter(Boolean).join(' · ');
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'SURVEY_LOW_SCORE',
          severity: inHouse ? 'CRITICAL' : 'WARNING',
          title: `${SURVEY_KIND_LABELS[invitation.kind]}: düşük puan (${where})`,
          body: `${points || 'Düşük puan'}${score.commentText ? ' · yorum var' : ''}. ${inHouse ? 'Misafir içeride: iki saat içinde ilgilenin.' : 'Misafire 48 saat içinde dönün.'}`,
          link: `/anketler/takip/${followUp.id}`,
          permission: PERMISSIONS.SURVEYS_FOLLOW_UP,
          entityType: 'SurveyFollowUp',
          entityId: followUp.id,
          dedupeKey: `survey-low:${response.id}`,
        });
        await stage('survey.followup.changed', { hotelId, followUpId: followUp.id, change: 'OPENED' });
      }
      await stage('survey.response.submitted', { hotelId, responseId: response.id, reservationId: invitation.reservationId, kind: invitation.kind, npsScore: score.npsScore, lowScore: score.lowScore });
      if (analysisStatus === 'PENDING') await stage('survey.analysis.requested', { hotelId, responseId: response.id });
    });
  } catch (error) {
    // Aynı davetin eşzamanlı ikinci gönderimi: tekil kısıt.
    if (error?.code === 'P2002') throw new ConflictError('Bu anket zaten cevaplandı. Teşekkür ederiz!', 'SURVEY_ALREADY_ANSWERED');
    throw error;
  }
  return { state: 'ANSWERED', reviewLinks: reviewLinks(settings) };
}
