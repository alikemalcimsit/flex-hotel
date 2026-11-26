import { currentActor } from "@hotelos/core";
import {
  REVIEW_SOURCE_SCALES,
  parseReviewImportRow,
  reviewRatingPct,
} from "@hotelos/hotel-contracts";
import { recordAudit } from "../../lib/audit.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  rethrowPrismaError,
} from "../../lib/errors.js";
import { buildPage, toSkipTake } from "../../lib/pagination.js";
import { writeWithEvents } from "../../lib/write.js";
import { kickReviewAnalysis } from "./analysis.js";
import { dedupeKey, prisma, reviewDayLimit, reviewView } from "./shared.js";

/**
 * Misafir yorumları (modül 54): liste + özet, ayrıntı, elle ekleme, dosyadan yükleme (önizleme / yazma, ya hep ya hiç), personel
 * etiketi, cevap, silme, yeniden analiz. Yeni yorum "analiz bekliyor" açılır; analiz kuyruğu (`analysis.js`) AI'a gönderir.
 */

/** @param {{ text?: string | null }} review */
const initialAnalysis = (review) => (review.text ? "PENDING" : "SKIPPED");

/** @param {string} hotelId @param {any} query `reviewListQuerySchema` çıktısı */
export async function listReviews(hotelId, query) {
  const reviewedAt = {
    ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
  };
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.source ? { source: query.source } : {}),
    ...(query.sentiment ? { sentiment: query.sentiment } : {}),
    ...(query.topic ? { topics: { has: query.topic } } : {}),
    ...(query.department ? { departments: { has: query.department } } : {}),
    ...(query.replyStatus ? { replyStatus: query.replyStatus } : {}),
    ...(query.analysisStatus ? { analysisStatus: query.analysisStatus } : {}),
    ...(Object.keys(reviewedAt).length ? { reviewedAt } : {}),
    ...(query.search
      ? {
          OR: [
            { text: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
            { authorName: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === "lowest"
      ? [{ ratingPct: { sort: "asc", nulls: "last" } }, { reviewedAt: "desc" }]
      : query.sort === "highest"
        ? [
            { ratingPct: { sort: "desc", nulls: "last" } },
            { reviewedAt: "desc" },
          ]
        : [{ reviewedAt: "desc" }, { createdAt: "desc" }];
  const { skip, take } = toSkipTake(query);
  const base = { hotelId, deletedAt: null };
  const [rows, total, counts, average, unanswered, pending] = await Promise.all(
    [
      prisma.review.findMany({
        where,
        orderBy: /** @type {any} */ (orderBy),
        skip,
        take,
      }),
      prisma.review.count({ where }),
      prisma.review.groupBy({
        by: ["sentiment"],
        where,
        _count: { _all: true },
      }),
      prisma.review.aggregate({ where, _avg: { ratingPct: true } }),
      prisma.review.count({
        where: {
          ...base,
          sentiment: { in: ["NEGATIVE", "MIXED"] },
          replyStatus: { in: ["NONE", "DRAFT"] },
        },
      }),
      prisma.review.count({ where: { ...base, analysisStatus: "PENDING" } }),
    ],
  );
  return {
    ...buildPage(rows.map(reviewView), total, query),
    summary: {
      total,
      averagePct:
        average._avg.ratingPct === null
          ? null
          : Math.round(average._avg.ratingPct),
      sentiments: Object.fromEntries(
        counts.map((row) => [row.sentiment ?? "NONE", row._count._all]),
      ),
      unansweredNegative: unanswered,
      pendingAnalysis: pending,
    },
  };
}

/** @param {string} hotelId @param {string} reviewId */
export async function getReview(hotelId, reviewId) {
  const row = await prisma.review.findFirst({
    where: { id: reviewId, hotelId, deletedAt: null },
  });
  if (!row) throw new NotFoundError("Yorum bulunamadı");
  return reviewView(row);
}

/** @param {string} hotelId @param {any} input `reviewCreateSchema` çıktısı */
export async function createReview(hotelId, input) {
  const { latest } = await reviewDayLimit(hotelId);
  if (input.reviewedAt > latest)
    throw new ValidationError("Yorum tarihi gelecekte olamaz", {
      field: "reviewedAt",
    });
  const scale = REVIEW_SOURCE_SCALES[input.source];
  const key = dedupeKey({ ...input });
  const actor = currentActor();
  let created;
  try {
    created = await writeWithEvents(async (tx, stage) => {
      if (
        await tx.review.findFirst({
          where: { hotelId, dedupeKey: key },
          select: { id: true },
        })
      )
        throw new ConflictError("Bu yorum zaten kayıtlı", "REVIEW_DUPLICATE");
      const row = await tx.review.create({
        data: {
          hotelId,
          source: input.source,
          externalId: input.externalId ?? null,
          dedupeKey: key,
          authorName: input.authorName ?? null,
          title: input.title ?? null,
          text: input.text ?? null,
          rating: input.rating ?? null,
          ratingScale: scale,
          ratingPct: reviewRatingPct(input.rating ?? null, scale),
          reviewedAt: new Date(`${input.reviewedAt}T00:00:00.000Z`),
          language: input.language ?? null,
          url: input.url ?? null,
          existingReply: input.existingReply ?? null,
          replyStatus: input.existingReply ? "REPLIED" : "NONE",
          replyText: input.existingReply ?? null,
          repliedAt: input.existingReply ? new Date() : null,
          repliedBy: input.existingReply ? "platform" : null,
          analysisStatus: initialAnalysis(input),
          createdBy: actor,
        },
      });
      await stage("reviews.changed", {
        hotelId,
        area: "REVIEW",
        reviewId: row.id,
      });
      return row;
    });
  } catch (error) {
    // Aynı yorum aynı anda iki kez: tekil anahtar.
    rethrowPrismaError(error, { uniqueMessage: "Bu yorum zaten kayıtlı" });
    throw error;
  }
  kickReviewAnalysis();
  return reviewView(created);
}

/**
 * Dosyadan yükleme. `dryRun` önizler (satır başına Hazır / Zaten var / Hatalı); yazmada hatalı satır varsa hiçbiri yazılmaz.
 * Aynı istek kimliği ikinci kez gelirse önceki sonuç döner.
 * @param {string} hotelId @param {any} input `reviewImportSchema` çıktısı
 */
export async function importReviews(hotelId, input) {
  const previous = await prisma.reviewImport.findFirst({
    where: { id: input.requestId, hotelId },
  });
  if (previous)
    return {
      dryRun: false,
      replayed: true,
      importId: previous.id,
      summary: {
        total: previous.rows,
        ok: previous.created,
        skipped: previous.skipped,
        errors: 0,
      },
      rows: [],
    };
  const { latest, timezone } = await reviewDayLimit(hotelId);
  const scale = input.ratingScale ?? REVIEW_SOURCE_SCALES[input.source];
  const parsed = input.rows.map((raw, index) => ({
    index,
    ...parseReviewImportRow(raw, {
      source: input.source,
      scale,
      today: latest,
      timeZone: timezone,
    }),
  }));
  const keys = parsed.map((row) => (row.ok ? dedupeKey(row.value) : null));
  const existing = new Set(
    (
      await prisma.review.findMany({
        where: { hotelId, dedupeKey: { in: keys.filter(Boolean) } },
        select: { dedupeKey: true },
      })
    ).map((row) => row.dedupeKey),
  );
  const seen = new Set();
  const rows = parsed.map((row, index) => {
    if (!row.ok) return { row: index + 1, status: "ERROR", errors: row.errors };
    const key = keys[index];
    if (existing.has(key) || seen.has(key))
      return {
        row: index + 1,
        status: "SKIP",
        errors: [
          existing.has(key)
            ? "Bu yorum zaten kayıtlı"
            : "Dosyada tekrar ediyor",
        ],
      };
    seen.add(key);
    return { row: index + 1, status: "OK", errors: [], key, value: row.value };
  });
  const summary = {
    total: rows.length,
    ok: rows.filter((row) => row.status === "OK").length,
    skipped: rows.filter((row) => row.status === "SKIP").length,
    errors: rows.filter((row) => row.status === "ERROR").length,
  };
  const report = rows.map(({ row, status, errors, value }) => ({
    row,
    status,
    errors,
    preview: value
      ? {
          reviewedAt: value.reviewedAt,
          rating: value.rating,
          text: value.text?.slice(0, 120) ?? null,
          authorName: value.authorName,
        }
      : null,
  }));
  if (input.dryRun) return { dryRun: true, summary, rows: report };
  if (summary.errors)
    throw new ValidationError(
      `${summary.errors} satır hatalı; düzeltip yeniden yükleyin`,
      { rows: report.filter((row) => row.status === "ERROR").slice(0, 50) },
    );
  const actor = currentActor();
  /** Aynı anda başka bir yükleme aynı yorumları yazdıysa bu yüklemede atlanır; rapor gerçek sayıyı söyler. */
  let written = new Set();
  try {
    await writeWithEvents(async (tx, stage) => {
      await tx.reviewImport.create({
        data: {
          id: input.requestId,
          hotelId,
          source: input.source,
          fileName: input.fileName ?? null,
          rows: summary.total,
          created: 0,
          skipped: summary.skipped,
          createdBy: actor,
        },
      });
      const data = rows
        .filter((row) => row.status === "OK")
        .map(({ key, value }) => ({
          hotelId,
          source: value.source,
          externalId: value.externalId,
          dedupeKey: key,
          authorName: value.authorName,
          title: value.title,
          text: value.text,
          rating: value.rating,
          ratingScale: value.ratingScale,
          ratingPct: reviewRatingPct(value.rating, value.ratingScale),
          reviewedAt: new Date(`${value.reviewedAt}T00:00:00.000Z`),
          language: value.language,
          url: value.url,
          existingReply: value.existingReply,
          replyStatus: value.existingReply ? "REPLIED" : "NONE",
          replyText: value.existingReply,
          repliedAt: value.existingReply ? new Date() : null,
          repliedBy: value.existingReply ? "platform" : null,
          analysisStatus: initialAnalysis(value),
          importId: input.requestId,
          createdBy: actor,
        }));
      const inserted = data.length
        ? await tx.review.createManyAndReturn({
            data: /** @type {any} */ (data),
            skipDuplicates: true,
            select: { dedupeKey: true },
          })
        : [];
      written = new Set(inserted.map((row) => row.dedupeKey));
      const raced = summary.ok - inserted.length;
      summary.ok = inserted.length;
      summary.skipped += raced;
      await tx.reviewImport.update({
        where: { id: input.requestId },
        data: { created: summary.ok, skipped: summary.skipped },
      });
      await recordAudit(tx, {
        hotelId,
        entity: "ReviewImport",
        entityId: input.requestId,
        action: "CREATE",
        after: {
          source: input.source,
          fileName: input.fileName ?? null,
          ...summary,
        },
      });
      await stage("reviews.changed", {
        hotelId,
        area: "IMPORT",
        reviewId: null,
      });
    });
  } catch (error) {
    // Aynı yükleme aynı anda iki kez gönderildi: diğeri yazdı, onun sonucu döner.
    if (/** @type {any} */ (error)?.code === "P2002") {
      const done = await prisma.reviewImport.findFirst({
        where: { id: input.requestId, hotelId },
      });
      if (done)
        return {
          dryRun: false,
          replayed: true,
          importId: done.id,
          summary: {
            total: done.rows,
            ok: done.created,
            skipped: done.skipped,
            errors: 0,
          },
          rows: [],
        };
    }
    rethrowPrismaError(error);
    throw error;
  }
  const finalRows = report.map((row, index) =>
    rows[index].status === "OK" && !written.has(rows[index].key)
      ? {
          ...row,
          status: "SKIP",
          errors: ["Bu yorum aynı anda başka bir yüklemeyle kaydedildi"],
        }
      : row,
  );
  kickReviewAnalysis();
  return {
    dryRun: false,
    replayed: false,
    importId: input.requestId,
    summary,
    rows: finalRows,
  };
}

/** Personel etiketi (AI'ın yerine geçer; yeniden analiz üzerine yazmaz). @param {string} hotelId @param {string} reviewId @param {any} input */
export async function tagReview(hotelId, reviewId, input) {
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.review.updateMany({
      where: { id: reviewId, hotelId, deletedAt: null },
      data: {
        sentiment: input.sentiment,
        topics: [...new Set(input.topics)],
        departments: [...new Set(input.departments)],
        manuallyTagged: true,
        analysisStatus: "DONE",
        analyzedAt: new Date(),
        analysisModel: `elle: ${currentActor()}`,
      },
    });
    if (!count) throw new NotFoundError("Yorum bulunamadı");
    await stage("reviews.changed", { hotelId, area: "REVIEW", reviewId });
  });
  return getReview(hotelId, reviewId);
}

/** Cevap: taslak, cevaplandı (platformda yayınlandı), gerekmiyor. @param {string} hotelId @param {string} reviewId @param {{ status: string, replyText?: string | null }} input */
export async function replyReview(hotelId, reviewId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.review.updateMany({
      where: { id: reviewId, hotelId, deletedAt: null },
      data: {
        replyStatus: input.status,
        replyText: input.replyText ?? null,
        repliedAt: input.status === "REPLIED" ? new Date() : null,
        repliedBy: input.status === "DRAFT" ? null : actor,
      },
    });
    if (!count) throw new NotFoundError("Yorum bulunamadı");
    await stage("reviews.changed", { hotelId, area: "REVIEW", reviewId });
  });
  return getReview(hotelId, reviewId);
}

/** Yeniden analiz (personel etiketi silinir). @param {string} hotelId @param {string} reviewId */
export async function reanalyzeReview(hotelId, reviewId) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.review.findFirst({
      where: { id: reviewId, hotelId, deletedAt: null },
      select: { text: true },
    });
    if (!row) throw new NotFoundError("Yorum bulunamadı");
    if (!row.text)
      throw new ConflictError(
        "Metni olmayan yorum analiz edilmez",
        "REVIEW_NO_TEXT",
      );
    await tx.review.update({
      where: { id: reviewId },
      data: {
        analysisStatus: "PENDING",
        analysisRequestedAt: null,
        manuallyTagged: false,
      },
    });
    await stage("reviews.changed", { hotelId, area: "REVIEW", reviewId });
  });
  kickReviewAnalysis();
  return getReview(hotelId, reviewId);
}

/** @param {string} hotelId @param {string} reviewId */
export async function deleteReview(hotelId, reviewId) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.review.findFirst({
      where: { id: reviewId, hotelId, deletedAt: null },
    });
    if (!row) throw new NotFoundError("Yorum bulunamadı");
    // Anahtar serbest kalsın: aynı yorum yeniden yüklenebilsin.
    await tx.review.update({
      where: { id: reviewId },
      data: {
        deletedAt: new Date(),
        dedupeKey: `${row.dedupeKey}:silindi:${Date.now()}`,
      },
    });
    await recordAudit(tx, {
      hotelId,
      entity: "Review",
      entityId: reviewId,
      action: "DELETE",
      before: {
        source: row.source,
        reviewedAt: row.reviewedAt,
        authorName: row.authorName,
      },
    });
    await stage("reviews.changed", { hotelId, area: "REVIEW", reviewId });
  });
  return { deleted: true };
}
