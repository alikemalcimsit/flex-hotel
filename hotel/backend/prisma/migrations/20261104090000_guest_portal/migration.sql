-- CreateEnum
CREATE TYPE "OnlineCheckinStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED');

-- AlterEnum
ALTER TYPE "GuestRequestSource" ADD VALUE 'PORTAL';

-- AlterEnum
ALTER TYPE "NotificationSource" ADD VALUE 'CHECKIN_INVITE';

-- AlterEnum
ALTER TYPE "NotificationTrigger" ADD VALUE 'CHECKIN_INVITE';

-- CreateTable
CREATE TABLE "GuestPortalSettings" (
    "hotelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inviteDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "checkinOpenDays" INTEGER NOT NULL DEFAULT 7,
    "documentRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "publicBaseUrl" TEXT,
    "texts" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestPortalSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "GuestPortalLink" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),

    CONSTRAINT "GuestPortalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineCheckin" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" "OnlineCheckinStatus" NOT NULL,
    "guest" JSONB NOT NULL,
    "companions" JSONB NOT NULL DEFAULT '[]',
    "vehiclePlate" TEXT,
    "arrivalTime" TEXT,
    "paymentPreference" TEXT NOT NULL,
    "note" TEXT,
    "language" TEXT NOT NULL,
    "consents" JSONB NOT NULL,
    "signatureKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "submitCount" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "documentsPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineCheckinDocument" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "onlineCheckinId" TEXT,
    "person" INTEGER,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "OnlineCheckinDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestPortalLink_hotelId_reservationId_idx" ON "GuestPortalLink"("hotelId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineCheckin_reservationId_key" ON "OnlineCheckin"("reservationId");

-- CreateIndex
CREATE INDEX "OnlineCheckin_hotelId_status_submittedAt_idx" ON "OnlineCheckin"("hotelId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "OnlineCheckinDocument_hotelId_reservationId_idx" ON "OnlineCheckinDocument"("hotelId", "reservationId");

-- CreateIndex
CREATE INDEX "OnlineCheckinDocument_onlineCheckinId_idx" ON "OnlineCheckinDocument"("onlineCheckinId");

-- CreateIndex
CREATE INDEX "OnlineCheckinDocument_createdAt_idx" ON "OnlineCheckinDocument"("createdAt");

-- AddForeignKey
ALTER TABLE "GuestPortalSettings" ADD CONSTRAINT "GuestPortalSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPortalLink" ADD CONSTRAINT "GuestPortalLink_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPortalLink" ADD CONSTRAINT "GuestPortalLink_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineCheckin" ADD CONSTRAINT "OnlineCheckin_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineCheckin" ADD CONSTRAINT "OnlineCheckin_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineCheckinDocument" ADD CONSTRAINT "OnlineCheckinDocument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineCheckinDocument" ADD CONSTRAINT "OnlineCheckinDocument_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineCheckinDocument" ADD CONSTRAINT "OnlineCheckinDocument_onlineCheckinId_fkey" FOREIGN KEY ("onlineCheckinId") REFERENCES "OnlineCheckin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rezervasyonda tek geçerli portal bağlantısı (yenileme eskisini iptal eder; eşzamanlı ikinci bağlantı yazılamaz).
CREATE UNIQUE INDEX "GuestPortalLink_active_key" ON "GuestPortalLink"("reservationId") WHERE "revokedAt" IS NULL;

-- Değer kısıtları (sözleşmedeki sınırlarla aynı).
ALTER TABLE "GuestPortalSettings" ADD CONSTRAINT "GuestPortalSettings_limits" CHECK ("inviteDaysBefore" BETWEEN 0 AND 14 AND "checkinOpenDays" BETWEEN 1 AND 30 AND "documentRetentionDays" BETWEEN 0 AND 90);
ALTER TABLE "OnlineCheckin" ADD CONSTRAINT "OnlineCheckin_payment" CHECK ("paymentPreference" IN ('CARD_AT_DESK', 'CASH_AT_DESK', 'PREPAID', 'COMPANY'));
ALTER TABLE "OnlineCheckin" ADD CONSTRAINT "OnlineCheckin_language" CHECK ("language" IN ('tr', 'en', 'de', 'ru'));
ALTER TABLE "OnlineCheckin" ADD CONSTRAINT "OnlineCheckin_submitCount" CHECK ("submitCount" >= 1);
ALTER TABLE "OnlineCheckinDocument" ADD CONSTRAINT "OnlineCheckinDocument_person" CHECK ("person" IS NULL OR "person" >= 0);
ALTER TABLE "OnlineCheckinDocument" ADD CONSTRAINT "OnlineCheckinDocument_type" CHECK ("contentType" IN ('image/jpeg', 'image/webp'));
