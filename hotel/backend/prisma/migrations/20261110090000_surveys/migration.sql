-- CreateEnum
CREATE TYPE "SurveyKind" AS ENUM ('POST_STAY', 'MID_STAY');

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('NPS', 'RATING', 'CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "NpsCategory" AS ENUM ('PROMOTER', 'PASSIVE', 'DETRACTOR');

-- CreateEnum
CREATE TYPE "SurveyInvitationStatus" AS ENUM ('SENT', 'OPENED', 'RESPONDED');

-- CreateEnum
CREATE TYPE "SurveySentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED');

-- CreateEnum
CREATE TYPE "SurveyAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SurveyFollowUpStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SurveyFollowUpOutcome" AS ENUM ('APOLOGIZED', 'COMPENSATED', 'ISSUE_FIXED', 'EXPLAINED', 'NO_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "SurveyFollowUpNoteKind" AS ENUM ('NOTE', 'CONTACT');

-- CreateEnum
CREATE TYPE "SurveyInsightStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationSource" ADD VALUE 'SURVEY_POST_STAY';
ALTER TYPE "NotificationSource" ADD VALUE 'SURVEY_MID_STAY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationTrigger" ADD VALUE 'SURVEY_POST_STAY';
ALTER TYPE "NotificationTrigger" ADD VALUE 'SURVEY_MID_STAY';

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'SURVEY_LOW_SCORE';

-- CreateTable
CREATE TABLE "SurveySettings" (
    "hotelId" TEXT NOT NULL,
    "postStayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "postStayDelayDays" INTEGER NOT NULL DEFAULT 1,
    "postStaySendHour" INTEGER NOT NULL DEFAULT 11,
    "midStayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "midStaySendHour" INTEGER NOT NULL DEFAULT 18,
    "midStayMinNights" INTEGER NOT NULL DEFAULT 2,
    "minDaysBetweenSurveys" INTEGER NOT NULL DEFAULT 30,
    "linkValidDays" INTEGER NOT NULL DEFAULT 14,
    "lowNpsThreshold" INTEGER NOT NULL DEFAULT 6,
    "lowRatingThreshold" INTEGER NOT NULL DEFAULT 2,
    "googleReviewUrl" TEXT,
    "tripadvisorReviewUrl" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveySettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "text" JSONB NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'OVERALL',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyInvitation" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "SurveyInvitationStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "npsScore" INTEGER,
    "npsCategory" "NpsCategory",
    "ratingAverage" DECIMAL(3,2),
    "lowScore" BOOLEAN NOT NULL DEFAULT false,
    "commentText" TEXT,
    "searchText" TEXT NOT NULL,
    "sentiment" "SurveySentiment",
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiSummary" TEXT,
    "analysisStatus" "SurveyAnalysisStatus" NOT NULL DEFAULT 'SKIPPED',
    "analysisModel" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAnswer" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "score" INTEGER,
    "choiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,

    CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyFollowUp" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "status" "SurveyFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "outcome" "SurveyFollowUpOutcome",
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyFollowUpNote" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "kind" "SurveyFollowUpNoteKind" NOT NULL DEFAULT 'NOTE',
    "text" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyFollowUpNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyInsight" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "SurveyKind" NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "status" "SurveyInsightStatus" NOT NULL DEFAULT 'PENDING',
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "themes" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "failureReason" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SurveyInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Survey_hotelId_kind_key" ON "Survey"("hotelId", "kind");

-- CreateIndex
CREATE INDEX "SurveyQuestion_surveyId_archivedAt_position_idx" ON "SurveyQuestion"("surveyId", "archivedAt", "position");

-- CreateIndex
CREATE INDEX "SurveyQuestion_hotelId_idx" ON "SurveyQuestion"("hotelId");

-- CreateIndex
CREATE INDEX "SurveyInvitation_hotelId_kind_sentAt_idx" ON "SurveyInvitation"("hotelId", "kind", "sentAt");

-- CreateIndex
CREATE INDEX "SurveyInvitation_hotelId_guestId_kind_sentAt_idx" ON "SurveyInvitation"("hotelId", "guestId", "kind", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvitation_reservationId_kind_key" ON "SurveyInvitation"("reservationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_invitationId_key" ON "SurveyResponse"("invitationId");

-- CreateIndex
CREATE INDEX "SurveyResponse_hotelId_kind_submittedAt_id_idx" ON "SurveyResponse"("hotelId", "kind", "submittedAt", "id");

-- CreateIndex
CREATE INDEX "SurveyResponse_hotelId_submittedAt_id_idx" ON "SurveyResponse"("hotelId", "submittedAt", "id");

-- CreateIndex
CREATE INDEX "SurveyResponse_hotelId_lowScore_submittedAt_idx" ON "SurveyResponse"("hotelId", "lowScore", "submittedAt");

-- CreateIndex
CREATE INDEX "SurveyResponse_searchText_trgm_idx" ON "SurveyResponse" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "SurveyResponse_topics_idx" ON "SurveyResponse" USING GIN ("topics");

-- CreateIndex
CREATE INDEX "SurveyAnswer_hotelId_kind_submittedAt_questionId_idx" ON "SurveyAnswer"("hotelId", "kind", "submittedAt", "questionId");

-- CreateIndex
CREATE INDEX "SurveyAnswer_questionId_idx" ON "SurveyAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAnswer_responseId_questionId_key" ON "SurveyAnswer"("responseId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyFollowUp_responseId_key" ON "SurveyFollowUp"("responseId");

-- CreateIndex
CREATE INDEX "SurveyFollowUp_hotelId_status_dueAt_id_idx" ON "SurveyFollowUp"("hotelId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "SurveyFollowUp_hotelId_assignedTo_status_idx" ON "SurveyFollowUp"("hotelId", "assignedTo", "status");

-- CreateIndex
CREATE INDEX "SurveyFollowUp_hotelId_resolvedAt_id_idx" ON "SurveyFollowUp"("hotelId", "resolvedAt", "id");

-- CreateIndex
CREATE INDEX "SurveyFollowUpNote_followUpId_createdAt_idx" ON "SurveyFollowUpNote"("followUpId", "createdAt");

-- CreateIndex
CREATE INDEX "SurveyInsight_hotelId_kind_requestedAt_idx" ON "SurveyInsight"("hotelId", "kind", "requestedAt");

-- AddForeignKey
ALTER TABLE "SurveySettings" ADD CONSTRAINT "SurveySettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "SurveyInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyFollowUp" ADD CONSTRAINT "SurveyFollowUp_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyFollowUp" ADD CONSTRAINT "SurveyFollowUp_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyFollowUpNote" ADD CONSTRAINT "SurveyFollowUpNote_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyFollowUpNote" ADD CONSTRAINT "SurveyFollowUpNote_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "SurveyFollowUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInsight" ADD CONSTRAINT "SurveyInsight_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Aynı dönemin özeti için bekleyen tek istek (çift tık / iki kişi aynı anda → tek istek).
CREATE UNIQUE INDEX "SurveyInsight_pending_key" ON "SurveyInsight"("hotelId", "kind", "fromDay", "toDay") WHERE "status" = 'PENDING';

-- Değer kısıtları (sözleşmedeki sınırlarla aynı).
ALTER TABLE "SurveySettings" ADD CONSTRAINT "SurveySettings_limits" CHECK (
  "postStayDelayDays" BETWEEN 0 AND 7 AND "postStaySendHour" BETWEEN 6 AND 21 AND "midStaySendHour" BETWEEN 9 AND 21
  AND "midStayMinNights" BETWEEN 2 AND 14 AND "minDaysBetweenSurveys" BETWEEN 0 AND 365 AND "linkValidDays" BETWEEN 3 AND 60
  AND "lowNpsThreshold" BETWEEN 0 AND 8 AND "lowRatingThreshold" BETWEEN 1 AND 3);
ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_language" CHECK ("language" IN ('tr', 'en', 'de', 'ru'));
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_language" CHECK ("language" IN ('tr', 'en', 'de', 'ru'));
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_nps" CHECK (("npsScore" IS NULL AND "npsCategory" IS NULL) OR ("npsScore" BETWEEN 0 AND 10 AND "npsCategory" IS NOT NULL));
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_rating" CHECK ("ratingAverage" IS NULL OR "ratingAverage" BETWEEN 1 AND 5);
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_score" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 10);
ALTER TABLE "SurveyFollowUp" ADD CONSTRAINT "SurveyFollowUp_resolved" CHECK (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL AND "outcome" IS NOT NULL AND "resolution" IS NOT NULL));
ALTER TABLE "SurveyInsight" ADD CONSTRAINT "SurveyInsight_period" CHECK ("fromDay" <= "toDay");
