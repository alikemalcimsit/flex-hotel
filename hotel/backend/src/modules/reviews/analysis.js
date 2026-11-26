import { REVIEW_DEPARTMENTS, REVIEW_SENTIMENTS, REVIEW_TOPICS } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { prisma } from './shared.js';

/**
 * Yorumların AI analizi (modül 54): kuyruk + insight-agent servisi.
 *
 * Yükleme yüzlerce yorum getirebilir; ajanın sırası taşmasın diye analiz bir tur başına en çok `BATCH` yorum için istenir (1 dk'lık iş
 * + yeni yorumda kısa tetik). 30 dakikada sonuç gelmeyen istek yeniden gönderilir. AI yoksa (sunucuda anahtar yok) yorumlar "bekliyor"
 * kalır; personel elle etiketleyebilir.
 */

const BATCH = 40;
const RETRY_AFTER_MS = 30 * 60_000;

/** @type {(hotelId: string) => Promise<boolean>} */
let agentAvailable = async () => false;
/** Ajan kayıtlı ve otelde açık mı (actors.js bağlar). @param {(hotelId: string) => Promise<boolean>} fn */
export function setReviewAgentProbe(fn) {
  agentAvailable = fn;
}

/** Bir tur: bekleyenleri ajana ister. @returns {Promise<number>} */
export async function dispatchReviewAnalysis(now = new Date()) {
  const rows = await prismaUnfiltered.$queryRaw`
    UPDATE "Review" r SET "analysisRequestedAt" = ${now}
    WHERE r."id" IN (
      SELECT "id" FROM "Review"
      WHERE "analysisStatus" = 'PENDING' AND "deletedAt" IS NULL
        AND ("analysisRequestedAt" IS NULL OR "analysisRequestedAt" < ${new Date(now.getTime() - RETRY_AFTER_MS)})
      ORDER BY "analysisRequestedAt" NULLS FIRST, "createdAt"
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING r."id", r."hotelId"`;
  if (!rows.length) return 0;
  // Ajanı kapalı (ya da sunucuda model anahtarı olmayan) otelin yorumları istenmez; 30 dakika sonra yeniden bakılır.
  /** @type {Map<string, boolean>} */
  const open = new Map();
  for (const row of /** @type {any[]} */ (rows)) if (!open.has(row.hotelId)) open.set(row.hotelId, await agentAvailable(row.hotelId));
  const due = /** @type {any[]} */ (rows).filter((row) => open.get(row.hotelId));
  if (!due.length) return 0;
  await writeWithEvents(async (_tx, stage) => {
    for (const row of due) await stage('review.analysis.requested', { hotelId: row.hotelId, reviewId: row.id });
  });
  return due.length;
}

let kickTimer = null;
let autoKick = true;
/** Yeni yorum geldi: kısa bekleme sonra bir tur. */
export function kickReviewAnalysis() {
  if (!autoKick || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    dispatchReviewAnalysis().catch(() => {});
  }, 200);
  kickTimer.unref?.();
}
/** Testler: kendiliğinden göndermeyi kapat. @param {boolean} value */
export function setReviewAutoKick(value) {
  autoKick = value;
}

/** Ajanın girdisi: yazanın adı gitmez. @param {string} hotelId @param {string} reviewId */
export async function reviewInput(hotelId, reviewId) {
  const [row, hotel] = await Promise.all([
    prisma.review.findFirst({ where: { id: reviewId, hotelId, deletedAt: null }, select: { source: true, rating: true, ratingScale: true, title: true, text: true, language: true, analysisStatus: true } }),
    getHotelSettings(hotelId),
  ]);
  if (!row) return { pending: false };
  return { pending: row.analysisStatus === 'PENDING', source: row.source, hotelName: hotel.name, rating: row.rating === null ? null : Number(row.rating), ratingScale: row.ratingScale, title: row.title, text: row.text, language: row.language, topics: REVIEW_TOPICS, departments: REVIEW_DEPARTMENTS };
}

/**
 * Ajanın sonucu: yalnız bekleyen yoruma yazılır; listeyle sınırlı. Dil personelce / dosyadan verilmişse korunur.
 * @param {string} hotelId @param {string} reviewId @param {any} result
 */
export async function completeReview(hotelId, reviewId, result) {
  return writeWithEvents(async (tx, stage) => {
    const data =
      result.status === 'DONE'
        ? {
            analysisStatus: 'DONE',
            sentiment: REVIEW_SENTIMENTS.includes(result.sentiment) ? result.sentiment : null,
            sentimentScore: Number.isFinite(result.score) ? Math.max(-100, Math.min(100, result.score)) : null,
            topics: [...new Set((result.topics ?? []).filter((topic) => REVIEW_TOPICS.includes(topic)))].slice(0, 5),
            departments: [...new Set((result.departments ?? []).filter((item) => REVIEW_DEPARTMENTS.includes(item)))].slice(0, 4),
            aiSummary: result.summary?.slice(0, 300) ?? null,
            suggestedReply: result.reply?.slice(0, 3000) ?? null,
            analysisModel: result.model,
            analyzedAt: new Date(),
          }
        : { analysisStatus: 'FAILED', analysisModel: result.model ?? null, analyzedAt: new Date() };
    // Yalnız bekleyen ve personelin elle etiketlemediği yoruma (araya giren etiket ezilmesin).
    const { count } = await tx.review.updateMany({ where: { id: reviewId, hotelId, analysisStatus: 'PENDING', manuallyTagged: false }, data: /** @type {any} */ (data) });
    if (count === 0) return false;
    if (result.status === 'DONE' && result.language) await tx.review.updateMany({ where: { id: reviewId, language: null }, data: { language: result.language } });
    await stage('review.analysis.completed', { hotelId, reviewId, status: result.status });
    return true;
  });
}
