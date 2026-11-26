import { REVIEW_TOPIC_LABELS_FALLBACK } from './labels.js';
import { day, hotelContext, prisma } from './shared.js';

/**
 * Trend (modül 54): haftalık yorum sayısı, ortalama puan (%), duygu dağılımı; dönemin konu × duygu dağılımı ve departman dağılımı;
 * son anomaliler. Haftalar pazartesi başlar (PostgreSQL `date_trunc('week')`).
 */

/** @param {string} hotelId @param {{ weeks: number, source?: string }} query */
export async function reviewTrends(hotelId, query) {
  const { today } = await hotelContext(hotelId);
  const end = new Date(`${today}T00:00:00.000Z`);
  // Tam haftalar: bu haftanın pazartesisinden geriye `weeks − 1` hafta (ilk kova yarım kalmasın).
  const thisMonday = new Date(end.getTime() - ((end.getUTCDay() + 6) % 7) * 86_400_000);
  const start = new Date(thisMonday.getTime() - (query.weeks - 1) * 7 * 86_400_000);
  const source = query.source ?? null;
  const [weekly, topics, departments, anomalies] = await Promise.all([
    prisma.$queryRaw`
      SELECT date_trunc('week', "reviewedAt")::date AS "week",
             COUNT(*)::int AS "count",
             ROUND(AVG("ratingPct"))::int AS "averagePct",
             COUNT(*) FILTER (WHERE "sentiment" = 'POSITIVE')::int AS "positive",
             COUNT(*) FILTER (WHERE "sentiment" = 'NEUTRAL')::int AS "neutral",
             COUNT(*) FILTER (WHERE "sentiment" = 'NEGATIVE')::int AS "negative",
             COUNT(*) FILTER (WHERE "sentiment" = 'MIXED')::int AS "mixed",
             ROUND(AVG("sentimentScore"))::int AS "averageScore"
      FROM "Review"
      WHERE "hotelId" = ${hotelId} AND "deletedAt" IS NULL AND "reviewedAt" BETWEEN ${start} AND ${end}
        AND (${source}::text IS NULL OR "source"::text = ${source})
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT t."topic", COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE r."sentiment" IN ('NEGATIVE', 'MIXED'))::int AS "negative",
             COUNT(*) FILTER (WHERE r."sentiment" = 'POSITIVE')::int AS "positive"
      FROM "Review" r, unnest(r."topics") AS t("topic")
      WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL AND r."reviewedAt" BETWEEN ${start} AND ${end}
        AND (${source}::text IS NULL OR r."source"::text = ${source})
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
    prisma.$queryRaw`
      SELECT d."department", COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE r."sentiment" IN ('NEGATIVE', 'MIXED'))::int AS "negative"
      FROM "Review" r, unnest(r."departments") AS d("department")
      WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL AND r."reviewedAt" BETWEEN ${start} AND ${end}
        AND (${source}::text IS NULL OR r."source"::text = ${source})
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
    prisma.reviewAnomaly.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  // Boş haftalar da görünsün (grafik kesintisiz).
  const byWeek = new Map(/** @type {any[]} */ (weekly).map((row) => [day(row.week), row]));
  const weeks = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 7 * 86_400_000)) {
    const key = day(cursor);
    const row = byWeek.get(key);
    weeks.push({ week: key, count: row?.count ?? 0, averagePct: row?.averagePct ?? null, averageScore: row?.averageScore ?? null, positive: row?.positive ?? 0, neutral: row?.neutral ?? 0, negative: row?.negative ?? 0, mixed: row?.mixed ?? 0 });
  }
  return {
    from: day(start),
    to: today,
    weeks,
    topics: /** @type {any[]} */ (topics).map((row) => ({ topic: row.topic, label: REVIEW_TOPIC_LABELS_FALLBACK[row.topic] ?? row.topic, count: row.count, negative: row.negative, positive: row.positive })),
    departments: /** @type {any[]} */ (departments),
    anomalies: anomalies.map((row) => ({ id: row.id, topic: row.topic, weekStart: day(row.weekStart), count: row.count, baseline: Number(row.baseline), factor: Number(row.factor), createdAt: row.createdAt.toISOString() })),
  };
}
