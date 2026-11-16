import { actorRegistry } from '@hotelos/actor-kit';
import { currentActor, toIsoDay } from '@hotelos/core';
import {
  MAX_PENDING_REPORT_QUESTIONS,
  REPORT_CHAT_HISTORY,
  REPORT_QUESTION_TIMEOUT_MS,
  REPORT_REQUEST_TASK_MODULE,
  reportAnswerSchema,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { isActorEnabledCached } from '../../lib/actor-settings.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { getAiSettingsCached } from '../concierge/settings.js';
import { compactForModel } from './datasets.js';
import { PRESENT_REPORT_TOOL, REPORT_AGENT_TOOLS, RUN_REPORT_TOOL, reportAgentSystemPrompt, reportAgentUserMessage } from './prompt.js';
import { runReportSpec } from './run.js';

/**
 * Rapor asistanı soruları (modül 24).
 *
 * - **Soru** kişiseldir (sohbet geçmişi soranındır). Ajan kullanılabiliyorsa soru bekler ve `report.question.asked`
 *   olayıyla rapor ajanına gider; ajan cevabı `completeQuestion` / `failQuestion` ile yazar, ekran canlı tazelenir.
 * - Ajan kullanılamıyorsa (anahtar yok, AI kapalı, model seçilmemiş, ajan kapalı) soru hemen "cevaplanamadı" olur ve
 *   **rapor talebi** manuel görevi açılır (rapor yetkilisinin önüne düşer). Ajan çalışırken kapanırsa / hata verirse
 *   aynı görevi aktör tabanı açar.
 * - Cevaptaki tablo sistemin çalıştırdığı rapordur (`runReportSpec`); model yalnız tanımı, grafiği ve yorumu seçer.
 */

export const REPORT_AGENT_NAME = 'report-agent';

/**
 * Ajan bu otelde kullanılabilir mi; değilse neden.
 * @param {string} hotelId
 * @returns {Promise<{ available: boolean, reason: string | null }>}
 */
export async function chatAvailability(hotelId) {
  if (!actorRegistry.get(REPORT_AGENT_NAME)) return { available: false, reason: 'Sunucuda AI anahtarı tanımlı değil.' };
  const settings = await getAiSettingsCached(hotelId);
  if (!settings.enabled) return { available: false, reason: 'AI bu otelde kapalı (Ayarlar › AI asistanı).' };
  if (!settings.conciergeModel) return { available: false, reason: 'AI modeli seçilmemiş (Ayarlar › AI asistanı).' };
  if (!(await isActorEnabledCached(hotelId, REPORT_AGENT_NAME))) return { available: false, reason: 'Rapor ajanı aktör panelinde kapalı.' };
  return { available: true, reason: null };
}

/** @param {any} row */
function toQuestionDto(row) {
  const timedOut = row.status === 'PENDING' && Date.now() - row.createdAt.getTime() > REPORT_QUESTION_TIMEOUT_MS;
  return {
    id: row.id,
    question: row.question,
    followUpOfId: row.followUpOfId,
    status: timedOut ? 'FAILED' : row.status,
    title: row.title,
    comment: row.comment,
    spec: row.spec,
    chart: row.chart,
    dataset: row.dataset,
    periodLabel: row.periodLabel,
    failureReason: timedOut ? 'Cevap zamanında gelmedi; tekrar sorabilirsiniz.' : row.failureReason,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Kendi sorusu (başkasınınki görünmez). @param {string} hotelId @param {string} questionId */
async function ownQuestion(hotelId, questionId) {
  const row = await prisma.reportQuestion.findFirst({ where: { id: questionId, hotelId, askedBy: currentActor() } });
  if (!row) throw new NotFoundError('Soru bulunamadı');
  return row;
}

/** @param {string} hotelId @param {string} questionId */
export async function getQuestion(hotelId, questionId) {
  return toQuestionDto(await ownQuestion(hotelId, questionId));
}

/** Soranın son soruları (eskiden yeniye) + ajanın durumu. @param {string} hotelId */
export async function listQuestions(hotelId) {
  const [rows, availability] = await Promise.all([
    prisma.reportQuestion.findMany({ where: { hotelId, askedBy: currentActor() }, orderBy: { createdAt: 'desc' }, take: REPORT_CHAT_HISTORY }),
    chatAvailability(hotelId),
  ]);
  return { items: rows.reverse().map(toQuestionDto), ...availability };
}

/**
 * Rapor talebi görevi (ajan yokken / devrettiğinde).
 * @param {string} hotelId @param {{ id: string, question: string }} row @param {string} reason @param {string} [askedBy]
 */
async function requestManually(hotelId, row, reason, askedBy = currentActor()) {
  // lib/actors.js bu modülü (ajan servisi için) içe aktarır; döngüye girmesin diye çağrı anında yüklenir.
  const { createManualTaskForActor } = await import('../../lib/actors.js');
  await createManualTaskForActor({
    hotelId,
    module: REPORT_REQUEST_TASK_MODULE,
    title: `Rapor talebi: "${row.question.slice(0, 120)}"`,
    description: `${askedBy} rapor asistanına sordu; ${reason} Raporu hazırlayıp kendisine iletin.`,
    actorName: REPORT_AGENT_NAME,
  });
}

/**
 * Soru sor.
 * @param {string} hotelId
 * @param {{ question: string, followUpOfId: string | null }} input `askReportQuestionSchema`
 */
export async function askQuestion(hotelId, { question, followUpOfId }) {
  const askedBy = currentActor();
  const pending = await prisma.reportQuestion.count({
    where: { hotelId, askedBy, status: 'PENDING', createdAt: { gt: new Date(Date.now() - REPORT_QUESTION_TIMEOUT_MS) } },
  });
  if (pending >= MAX_PENDING_REPORT_QUESTIONS) throw new ConflictError('Önceki sorularınız hâlâ hazırlanıyor; cevaplar gelince yeniden sorun', 'TOO_MANY_PENDING');
  if (followUpOfId) {
    const previous = await prisma.reportQuestion.findFirst({ where: { id: followUpOfId, hotelId, askedBy }, select: { status: true } });
    if (!previous) throw new ValidationError('Devam edilen soru bulunamadı', { field: 'followUpOfId' });
  }
  const availability = await chatAvailability(hotelId);
  const row = await writeWithEvents(async (tx, stage) => {
    const created = await tx.reportQuestion.create({
      data: availability.available
        ? { hotelId, askedBy, question, followUpOfId }
        : {
            hotelId,
            askedBy,
            question,
            followUpOfId,
            status: 'FAILED',
            failureReason: `${availability.reason} Sorunuz rapor talebi olarak personele iletildi.`,
            completedAt: new Date(),
          },
    });
    if (availability.available) await stage('report.question.asked', { hotelId, questionId: created.id, question });
    else await stage('report.question.completed', { hotelId, questionId: created.id, status: 'FAILED' });
    return created;
  });
  if (!availability.available) await requestManually(hotelId, row, availability.reason);
  return toQuestionDto(row);
}

/* ─────────────── Ajanın tarafı ─────────────── */

/**
 * Ajanın turu için hazırlık: bekleyen soru, talimat, araçlar ve model. Soru bekleyen değilse (cevaplanmış, zaman aşımı)
 * `null` — ajan bir şey yapmaz.
 * @param {string} hotelId @param {string} questionId
 */
export async function prepareQuestion(hotelId, questionId) {
  const row = await prisma.reportQuestion.findFirst({ where: { id: questionId, hotelId } });
  if (!row || row.status !== 'PENDING') return null;
  const [settings, hotel, businessDate, previous] = await Promise.all([
    getAiSettingsCached(hotelId),
    prisma.hotel.findUnique({ where: { id: hotelId }, select: { name: true, currency: true } }),
    getBusinessDate(hotelId),
    row.followUpOfId ? prisma.reportQuestion.findFirst({ where: { id: row.followUpOfId, hotelId }, select: { question: true, title: true, spec: true } }) : null,
  ]);
  return {
    model: settings.conciergeModel || null,
    messages: [
      { role: 'system', content: reportAgentSystemPrompt({ hotelName: hotel.name, today: toIsoDay(businessDate), currency: hotel.currency }) },
      { role: 'user', content: reportAgentUserMessage({ question: row.question, previous: previous?.spec ? previous : null }) },
    ],
    tools: REPORT_AGENT_TOOLS,
    dataTool: RUN_REPORT_TOOL,
    answerTool: PRESENT_REPORT_TOOL,
  };
}

/**
 * Ajanın "raporu çalıştır" aracı: tablonun model için kısa hali ya da modelin düzeltebileceği hata.
 * @param {string} hotelId @param {unknown} args
 * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string }>}
 */
export async function runToolForAgent(hotelId, args) {
  try {
    const { dataset, periodLabel } = await runReportSpec(hotelId, args);
    return { ok: true, result: { period: periodLabel, ...compactForModel(dataset) } };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Bekleyen soruyu kapatır (yalnız bir kez). @param {any} tx */
async function closePending(tx, stage, hotelId, questionId, data) {
  const updated = await tx.reportQuestion.updateMany({ where: { id: questionId, hotelId, status: 'PENDING' }, data: { ...data, completedAt: new Date() } });
  if (updated.count === 0) return false;
  await stage('report.question.completed', { hotelId, questionId, status: data.status });
  return true;
}

/**
 * Ajanın cevabı. `present_report` geçerliyse rapor sistemce çalıştırılır ve tablo yazılır; geçersizse hata modele
 * döner (düzeltsin). Metin cevap (rapor kapsam dışı) yalnız yorumla kapanır.
 *
 * @param {string} hotelId @param {string} questionId
 * @param {{ kind: 'REPORT', args: unknown, model: string, modelCalls: number } | { kind: 'TEXT', text: string, model: string, modelCalls: number }} answer
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function completeQuestion(hotelId, questionId, answer) {
  if (answer.kind === 'TEXT') {
    await writeWithEvents((tx, stage) =>
      closePending(tx, stage, hotelId, questionId, { status: 'READY', comment: answer.text.slice(0, 800), model: answer.model, modelCalls: answer.modelCalls }),
    );
    return { ok: true };
  }
  const parsed = reportAnswerSchema.safeParse(answer.args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') };
  let run;
  try {
    run = await runReportSpec(hotelId, parsed.data.spec, { chart: parsed.data.chart });
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    throw error;
  }
  await writeWithEvents((tx, stage) =>
    closePending(tx, stage, hotelId, questionId, {
      status: 'READY',
      title: parsed.data.title,
      comment: parsed.data.comment || run.periodLabel,
      spec: run.spec,
      chart: run.chart,
      dataset: run.dataset,
      periodLabel: run.periodLabel,
      model: answer.model,
      modelCalls: answer.modelCalls,
    }),
  );
  return { ok: true };
}

/**
 * Soru cevaplanamadı.
 * @param {string} hotelId @param {string} questionId @param {string} reason @param {{ model?: string | null, modelCalls?: number }} [extra]
 */
export async function failQuestion(hotelId, questionId, reason, { model = null, modelCalls = 0 } = {}) {
  await writeWithEvents((tx, stage) => closePending(tx, stage, hotelId, questionId, { status: 'FAILED', failureReason: reason.slice(0, 500), model, modelCalls }));
}


/**
 * Soruyu personele devret: cevaplanamadı olarak kapanır ve rapor talebi görevi açılır (AI bütçesi bitti, sağlayıcı
 * kalıcı hata, model seçilmemiş).
 * @param {string} hotelId @param {string} questionId @param {string} reason
 */
export async function handOffQuestion(hotelId, questionId, reason) {
  const row = await prisma.reportQuestion.findFirst({ where: { id: questionId, hotelId }, select: { id: true, question: true, askedBy: true, status: true } });
  if (!row || row.status !== 'PENDING') return;
  await failQuestion(hotelId, questionId, `${reason} Sorunuz rapor talebi olarak personele iletildi.`);
  await requestManually(hotelId, row, reason, row.askedBy);
}
