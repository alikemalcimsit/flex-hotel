-- Modül 24: Doğal dil raporlama (rapor asistanı).

-- CreateEnum
CREATE TYPE "ReportQuestionStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ReportQuestion" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "askedBy" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "followUpOfId" TEXT,
    "status" "ReportQuestionStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "comment" TEXT,
    "spec" JSONB,
    "chart" JSONB,
    "dataset" JSONB,
    "periodLabel" TEXT,
    "failureReason" TEXT,
    "model" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "chart" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportQuestion_hotelId_askedBy_createdAt_idx" ON "ReportQuestion"("hotelId", "askedBy", "createdAt");

-- CreateIndex
CREATE INDEX "ReportQuestion_hotelId_status_createdAt_idx" ON "ReportQuestion"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SavedReport_hotelId_owner_createdAt_idx" ON "SavedReport"("hotelId", "owner", "createdAt");

-- CreateIndex
CREATE INDEX "SavedReport_hotelId_shared_createdAt_idx" ON "SavedReport"("hotelId", "shared", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportQuestion" ADD CONSTRAINT "ReportQuestion_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ReportQuestion" ADD CONSTRAINT "ReportQuestion_valid"
  CHECK (
    length(btrim("question")) BETWEEN 5 AND 500
    AND "modelCalls" >= 0
    AND (
      ("status" = 'PENDING' AND "completedAt" IS NULL AND "failureReason" IS NULL)
      OR ("status" = 'READY' AND "completedAt" IS NOT NULL AND "comment" IS NOT NULL)
      OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureReason" IS NOT NULL)
    )
  );
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_valid" CHECK (length(btrim("title")) BETWEEN 1 AND 80);
