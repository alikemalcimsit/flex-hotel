import { createHash } from 'node:crypto';
import { reviewDedupeBasis } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { addDays, calendarDateInTimeZone, toIsoDay } from '@hotelos/core';
import { hotelContext } from '../banquet/shared.js';

/** Misafir yorumlarının ortak parçaları (modül 54). */

export { prisma, hotelContext };

/**
 * Yorum tarihinin üst sınırı: otelin saat dilimindeki takvim günü + 1 (iş günü değil — gece kapanışı gecikse de bugünün yorumu girer;
 * platformlar UTC'de tarihlediği için bir gün pay).
 * @param {string} hotelId
 */
export async function reviewDayLimit(hotelId) {
  const { timezone } = await hotelContext(hotelId);
  return { latest: toIsoDay(addDays(calendarDateInTimeZone(timezone), 1)), timezone };
}

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? value.toISOString().slice(0, 10) : null);

/** Aynı yorumun anahtarı (özet). @param {Parameters<typeof reviewDedupeBasis>[0]} review */
export const dedupeKey = (review) => createHash('sha256').update(reviewDedupeBasis(review)).digest('hex').slice(0, 40);

/** @param {any} row */
export const reviewView = (row) => ({
  id: row.id,
  source: row.source,
  externalId: row.externalId,
  authorName: row.authorName,
  title: row.title,
  text: row.text,
  rating: row.rating === null ? null : Number(row.rating),
  ratingScale: row.ratingScale,
  ratingPct: row.ratingPct,
  reviewedAt: day(row.reviewedAt),
  language: row.language,
  url: row.url,
  existingReply: row.existingReply,
  analysis: {
    status: row.analysisStatus,
    sentiment: row.sentiment,
    score: row.sentimentScore,
    topics: row.topics,
    departments: row.departments,
    summary: row.aiSummary,
    suggestedReply: row.suggestedReply,
    model: row.analysisModel,
    analyzedAt: iso(row.analyzedAt),
    manuallyTagged: row.manuallyTagged,
  },
  reply: { status: row.replyStatus, text: row.replyText, repliedAt: iso(row.repliedAt), repliedBy: row.repliedBy },
  importId: row.importId,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});
