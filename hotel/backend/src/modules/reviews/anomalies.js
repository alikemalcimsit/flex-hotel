import { REVIEW_ANOMALY_BASELINE_WEEKS, detectReviewAnomalies, reviewWeekStart } from '@hotelos/hotel-contracts';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { REVIEW_TOPIC_LABELS_FALLBACK } from './labels.js';
import { hotelContext, prisma } from './shared.js';

/**
 * Olumsuz konu artışı (modül 54): son 7 gün (yorum tarihine göre) bir konudaki olumsuz / karışık yorum sayısı, önceki 4 haftanın
 * haftalık ortalamasıyla karşılaştırılır (`detectReviewAnomalies`). Artış otel + konu + hafta başına bir kez yazılır ve müdüre zil
 * çalar ("Temizlik şikâyeti bu hafta 3 kat arttı").
 */

const DAY_MS = 86_400_000;

/** @param {string} hotelId @returns {Promise<number>} yeni anomali */
export async function detectHotelAnomalies(hotelId) {
  const { today } = await hotelContext(hotelId);
  const end = new Date(`${today}T00:00:00.000Z`);
  const windowStart = new Date(end.getTime() - 6 * DAY_MS);
  const baselineStart = new Date(windowStart.getTime() - REVIEW_ANOMALY_BASELINE_WEEKS * 7 * DAY_MS);
  const rows = /** @type {Array<{ topic: string, bucket: number, count: number }>} */ (
    await prisma.$queryRaw`
      SELECT t."topic", FLOOR(((${windowStart}::date - r."reviewedAt") - 1) / 7.0)::int AS "bucket", COUNT(*)::int AS "count"
      FROM "Review" r, unnest(r."topics") AS t("topic")
      WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL AND r."sentiment" IN ('NEGATIVE', 'MIXED')
        AND r."reviewedAt" BETWEEN ${baselineStart} AND ${end}
      GROUP BY 1, 2`
  );
  /** @type {Record<string, number>} */
  const current = {};
  /** @type {Record<string, number[]>} */
  const previous = {};
  for (const row of rows) {
    // Gün farkı (pencere başı − yorum günü): ≤ 0 pencere içi (bucket < 0); 1–7 bir önceki hafta (0), 8–14 (1)…
    if (row.bucket < 0) current[row.topic] = (current[row.topic] ?? 0) + row.count;
    else if (row.bucket < REVIEW_ANOMALY_BASELINE_WEEKS) previous[row.topic] = [...(previous[row.topic] ?? []), row.count];
  }
  const found = detectReviewAnomalies(current, previous);
  const weekStart = reviewWeekStart(today);
  let created = 0;
  // Pencere kayan 7 gün: aynı konuda son 7 günde zil çaldıysa pazartesi yeni hafta başladı diye ikinci kez çalmaz.
  const recent = new Set((await prisma.reviewAnomaly.findMany({ where: { hotelId, createdAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }, select: { topic: true } })).map((row) => row.topic));
  for (const anomaly of found.filter((row) => !recent.has(row.topic))) {
    await writeWithEvents(async (tx, stage) => {
      const [row] = await tx.reviewAnomaly.createManyAndReturn({ data: [{ hotelId, topic: anomaly.topic, weekStart: new Date(`${weekStart}T00:00:00.000Z`), count: anomaly.count, baseline: anomaly.baseline, factor: anomaly.factor }], skipDuplicates: true });
      if (!row) return;
      created += 1;
      const label = REVIEW_TOPIC_LABELS_FALLBACK[anomaly.topic] ?? anomaly.topic;
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'REVIEW',
        severity: 'WARNING',
        title: `${label} şikâyeti bu hafta ${anomaly.factor} kat arttı`,
        body: `Son 7 günde ${anomaly.count} olumsuz / karışık yorum ${label.toLocaleLowerCase('tr-TR')} konusuna değindi; önceki 4 haftada haftalık ortalama ${anomaly.baseline}.`,
        link: `/yorumlar/liste?topic=${anomaly.topic}`,
        permission: PERMISSIONS.REVIEWS_MANAGE,
        entityType: 'ReviewAnomaly',
        entityId: row.id,
        dedupeKey: `review-anomaly:${anomaly.topic}:${weekStart}`,
      });
      await stage('reviews.changed', { hotelId, area: 'ANOMALY', reviewId: null });
    });
  }
  return created;
}

/** Bütün oteller (iş). */
export async function detectAllAnomalies() {
  const hotels = await prisma.review.findMany({ where: { deletedAt: null, reviewedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }, distinct: ['hotelId'], select: { hotelId: true } });
  let total = 0;
  for (const { hotelId } of hotels) total += await detectHotelAnomalies(hotelId);
  return total;
}
