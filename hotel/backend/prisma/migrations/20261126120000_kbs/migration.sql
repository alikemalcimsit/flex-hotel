-- CreateEnum
CREATE TYPE "PersonGender" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "KbsProvider" AS ENUM ('TEST', 'EGM', 'JANDARMA');

-- CreateEnum
CREATE TYPE "KbsKind" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'ROOM_CHANGE');

-- CreateEnum
CREATE TYPE "KbsState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'MANUAL');

-- CreateEnum
CREATE TYPE "KbsTestBehavior" AS ENUM ('ACCEPT', 'REJECT', 'UNAVAILABLE');

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'KBS';

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "birthPlace" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "gender" "PersonGender",
ADD COLUMN     "motherName" TEXT;

-- CreateTable
CREATE TABLE "KbsSettings" (
    "hotelId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "KbsProvider" NOT NULL DEFAULT 'TEST',
    "facilityCode" TEXT,
    "username" TEXT,
    "passwordSealed" TEXT,
    "sendCheckOut" BOOLEAN NOT NULL DEFAULT true,
    "sendRoomChange" BOOLEAN NOT NULL DEFAULT true,
    "requireGender" BOOLEAN NOT NULL DEFAULT true,
    "requireBirthDate" BOOLEAN NOT NULL DEFAULT true,
    "requireParentNames" BOOLEAN NOT NULL DEFAULT false,
    "requireBirthPlace" BOOLEAN NOT NULL DEFAULT false,
    "citizenIdOnly" BOOLEAN NOT NULL DEFAULT true,
    "testBehavior" "KbsTestBehavior" NOT NULL DEFAULT 'ACCEPT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KbsSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "KbsNotification" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "kind" "KbsKind" NOT NULL,
    "state" "KbsState" NOT NULL DEFAULT 'PENDING',
    "sourceKey" TEXT NOT NULL,
    "dependsOnId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "previousRoomNumber" TEXT,
    "guestName" TEXT NOT NULL,
    "documentMasked" TEXT,
    "nationality" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "lastCode" TEXT,
    "lastMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedNote" TEXT,
    "lateAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "KbsNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbsLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbsNotification_hotelId_reservationId_idx" ON "KbsNotification"("hotelId", "reservationId");

-- CreateIndex
CREATE INDEX "KbsNotification_hotelId_state_createdAt_idx" ON "KbsNotification"("hotelId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "KbsNotification_state_nextAttemptAt_idx" ON "KbsNotification"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "KbsNotification_hotelId_sourceKey_key" ON "KbsNotification"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "KbsLog_notificationId_createdAt_idx" ON "KbsLog"("notificationId", "createdAt");

-- AddForeignKey
ALTER TABLE "KbsSettings" ADD CONSTRAINT "KbsSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "KbsNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbsLog" ADD CONSTRAINT "KbsLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbsLog" ADD CONSTRAINT "KbsLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "KbsNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kurallar
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_attempts" CHECK ("attempts" >= 0);
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_manual_note" CHECK ("state" <> 'MANUAL' OR "resolvedNote" IS NOT NULL);
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_sent_at" CHECK ("state" <> 'SENT' OR "sentAt" IS NOT NULL);
-- Gönderici kuyruğu: sırası gelen bekleyenler.
CREATE INDEX "KbsNotification_queue_idx" ON "KbsNotification" ("nextAttemptAt") WHERE "state" = 'PENDING';
