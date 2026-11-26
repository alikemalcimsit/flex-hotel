-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('GOOGLE', 'BOOKING', 'TRIPADVISOR', 'EXPEDIA', 'AIRBNB', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReviewReplyStatus" AS ENUM ('NONE', 'DRAFT', 'REPLIED', 'NOT_NEEDED');

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'REVIEW';

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" "ReviewSource" NOT NULL,
    "externalId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "authorName" TEXT,
    "title" TEXT,
    "text" TEXT,
    "rating" DECIMAL(4,1),
    "ratingScale" INTEGER NOT NULL,
    "ratingPct" INTEGER,
    "reviewedAt" DATE NOT NULL,
    "language" TEXT,
    "url" TEXT,
    "existingReply" TEXT,
    "importId" TEXT,
    "analysisStatus" "ReviewAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "analysisRequestedAt" TIMESTAMP(3),
    "sentiment" TEXT,
    "sentimentScore" INTEGER,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiSummary" TEXT,
    "suggestedReply" TEXT,
    "analysisModel" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "manuallyTagged" BOOLEAN NOT NULL DEFAULT false,
    "replyStatus" "ReviewReplyStatus" NOT NULL DEFAULT 'NONE',
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewImport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" "ReviewSource" NOT NULL,
    "fileName" TEXT,
    "rows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAnomaly" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "count" INTEGER NOT NULL,
    "baseline" DECIMAL(6,1) NOT NULL,
    "factor" DECIMAL(6,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Review_hotelId_reviewedAt_idx" ON "Review"("hotelId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Review_hotelId_source_reviewedAt_idx" ON "Review"("hotelId", "source", "reviewedAt");

-- CreateIndex
CREATE INDEX "Review_analysisStatus_analysisRequestedAt_idx" ON "Review"("analysisStatus", "analysisRequestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_hotelId_dedupeKey_key" ON "Review"("hotelId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ReviewImport_hotelId_createdAt_idx" ON "ReviewImport"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewAnomaly_hotelId_createdAt_idx" ON "ReviewAnomaly"("hotelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnomaly_hotelId_topic_weekStart_key" ON "ReviewAnomaly"("hotelId", "topic", "weekStart");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ReviewImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImport" ADD CONSTRAINT "ReviewImport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAnomaly" ADD CONSTRAINT "ReviewAnomaly_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kurallar
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating" CHECK ("rating" IS NULL OR ("rating" >= 0 AND "rating" <= "ratingScale"));
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_pct" CHECK ("ratingPct" IS NULL OR "ratingPct" BETWEEN 0 AND 100);
ALTER TABLE "Review" ADD CONSTRAINT "Review_sentiment_score" CHECK ("sentimentScore" IS NULL OR "sentimentScore" BETWEEN -100 AND 100);
ALTER TABLE "Review" ADD CONSTRAINT "Review_replied" CHECK ("replyStatus" <> 'REPLIED' OR ("replyText" IS NOT NULL AND "repliedAt" IS NOT NULL));
-- Analiz kuyruğu: bekleyenler.
CREATE INDEX "Review_analysis_queue_idx" ON "Review" ("analysisRequestedAt" NULLS FIRST) WHERE "analysisStatus" = 'PENDING' AND "deletedAt" IS NULL;
