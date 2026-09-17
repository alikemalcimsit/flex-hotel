-- Bildirim merkezi (modül 9): misafir bildirimi kuyruğu ve geçmişi, şablonlar,
-- kanal ayarları (şifreli sır), personel uyarıları (zil) ve gecikme taraması.

-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('RESERVATION_CONFIRMED', 'ROOM_ASSIGNED', 'CHECKED_IN', 'CHECKED_OUT', 'CHANNEL_TEST');

-- CreateEnum
CREATE TYPE "NotificationTrigger" AS ENUM ('RESERVATION_CONFIRMED', 'ROOM_ASSIGNED', 'CHECKED_IN', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "StaffAlertKind" AS ENUM ('GUEST_MESSAGE', 'URGENT_REQUEST', 'OVERDUE_REQUEST', 'MANUAL_TASK', 'NOTIFICATION_FAILED');

-- CreateEnum
CREATE TYPE "StaffAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "GuestRequest" ADD COLUMN     "overdueAlertedAt" TIMESTAMP(3);

-- AlterTable
-- Modül 9'a kadar hiçbir kod bu tabloya yazmadı; kolonlar yeniden
-- tanımlanıyor. Tabloda satır varsa sessizce veri kaybetmek yerine dur.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Notification") THEN
    RAISE EXCEPTION 'Notification tablosu boş değil; modül 9 migration''ı eski satırları taşımaz. Önce kayıtları inceleyin.';
  END IF;
END $$;

ALTER TABLE "Notification" RENAME COLUMN "to" TO "recipient";
ALTER TABLE "Notification" RENAME COLUMN "providerId" TO "providerMessageId";
ALTER TABLE "Notification" DROP COLUMN "template",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "body" TEXT NOT NULL,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "guestId" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr',
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "resendOfId" TEXT,
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "source" "NotificationSource" NOT NULL,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "key" "NotificationTrigger" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannelConfig" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT,
    "secretUpdatedAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureError" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAlert" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "StaffAlertKind" NOT NULL,
    "severity" "StaffAlertSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "userId" TEXT,
    "permission" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAlertRead" (
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAlertRead_pkey" PRIMARY KEY ("alertId","userId")
);

-- CreateTable
CREATE TABLE "StaffAlertState" (
    "userId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "mutedKinds" "StaffAlertKind"[] DEFAULT ARRAY[]::"StaffAlertKind"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAlertState_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "NotificationTemplate_hotelId_key_idx" ON "NotificationTemplate"("hotelId", "key");

-- CreateIndex
CREATE INDEX "StaffAlert_hotelId_occurredAt_id_idx" ON "StaffAlert"("hotelId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "StaffAlert_hotelId_userId_occurredAt_idx" ON "StaffAlert"("hotelId", "userId", "occurredAt");

-- CreateIndex
CREATE INDEX "StaffAlert_hotelId_permission_occurredAt_idx" ON "StaffAlert"("hotelId", "permission", "occurredAt");

-- CreateIndex
CREATE INDEX "StaffAlert_occurredAt_idx" ON "StaffAlert"("occurredAt");

-- CreateIndex
CREATE INDEX "StaffAlertRead_userId_idx" ON "StaffAlertRead"("userId");

-- CreateIndex
CREATE INDEX "Notification_hotelId_createdAt_id_idx" ON "Notification"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_hotelId_status_createdAt_idx" ON "Notification"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_hotelId_channel_createdAt_idx" ON "Notification"("hotelId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_provider_providerMessageId_idx" ON "Notification"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "Notification_reservationId_idx" ON "Notification"("reservationId");

-- CreateIndex
CREATE INDEX "Notification_guestId_idx" ON "Notification"("guestId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_resendOfId_fkey" FOREIGN KEY ("resendOfId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannelConfig" ADD CONSTRAINT "NotificationChannelConfig_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlert" ADD CONSTRAINT "StaffAlert_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlert" ADD CONSTRAINT "StaffAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlertRead" ADD CONSTRAINT "StaffAlertRead_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "StaffAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlertRead" ADD CONSTRAINT "StaffAlertRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlertState" ADD CONSTRAINT "StaffAlertState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü (modül 9) ───────────────
-- Yeni enum değerleri aynı işlemde kullanılamadığı için durum kontrolleri
-- metin karşılaştırmasıyla yazıldı.

-- Aynı olay için ikinci bildirim açılmaz.
CREATE UNIQUE INDEX "Notification_dedupe_unique"
  ON "Notification" ("hotelId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

-- Gönderici: zamanı gelmiş bekleyenler.
CREATE INDEX "Notification_pending_due_idx"
  ON "Notification" ("nextAttemptAt")
  WHERE "status" = 'PENDING' AND "deletedAt" IS NULL;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipient_present" CHECK (length(btrim("recipient")) > 0),
  ADD CONSTRAINT "Notification_body_present" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "Notification_attempts_non_negative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "Notification_language_valid" CHECK ("language" ~ '^[a-z]{2}$'),
  ADD CONSTRAINT "Notification_sending_locked" CHECK ("status"::text <> 'SENDING' OR "lockedAt" IS NOT NULL),
  ADD CONSTRAINT "Notification_sent_has_time" CHECK ("status"::text NOT IN ('SENT', 'DELIVERED') OR "sentAt" IS NOT NULL),
  ADD CONSTRAINT "Notification_delivered_has_time" CHECK ("status"::text <> 'DELIVERED' OR "deliveredAt" IS NOT NULL),
  ADD CONSTRAINT "Notification_failed_has_time" CHECK ("status"::text <> 'FAILED' OR "failedAt" IS NOT NULL),
  ADD CONSTRAINT "Notification_cancelled_has_reason" CHECK (
    "status"::text <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
  );

-- Olay × kanal × dil başına tek şablon.
CREATE UNIQUE INDEX "NotificationTemplate_active_unique"
  ON "NotificationTemplate" ("hotelId", "key", "channel", "language")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "NotificationTemplate"
  ADD CONSTRAINT "NotificationTemplate_body_present" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "NotificationTemplate_language_valid" CHECK ("language" ~ '^[a-z]{2}$');

-- Otel × kanal başına tek ayar.
CREATE UNIQUE INDEX "NotificationChannelConfig_active_unique"
  ON "NotificationChannelConfig" ("hotelId", "channel")
  WHERE "deletedAt" IS NULL;

-- Aynı konu için tek uyarı.
CREATE UNIQUE INDEX "StaffAlert_dedupe_unique"
  ON "StaffAlert" ("hotelId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

ALTER TABLE "StaffAlert"
  ADD CONSTRAINT "StaffAlert_has_audience" CHECK ("userId" IS NOT NULL OR "permission" IS NOT NULL),
  ADD CONSTRAINT "StaffAlert_title_present" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "StaffAlert_count_positive" CHECK ("count" >= 1);

-- Gecikme taraması: süresi geçmiş, henüz uyarılmamış açık istekler.
CREATE INDEX "GuestRequest_overdue_scan_idx"
  ON "GuestRequest" ("dueAt")
  WHERE "overdueAlertedAt" IS NULL AND "deletedAt" IS NULL AND "status" IN ('OPEN', 'IN_PROGRESS');
