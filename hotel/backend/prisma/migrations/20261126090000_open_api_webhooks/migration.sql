-- Modül 61: açık API (uygulama, anahtar) + webhook (abonelik, teslimat).
-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'RETRYING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "ReservationSource" ADD VALUE 'API';

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'INTEGRATION';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "apiClientId" TEXT;

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contactEmail" TEXT,
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    "bookingStatus" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretSealed" TEXT NOT NULL,
    "previousSecretSealed" TEXT,
    "previousSecretExpiresAt" TIMESTAMP(3),
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "disabledReason" TEXT,
    "disabledAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failingSince" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "attemptLog" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiClient_hotelId_name_idx" ON "ApiClient"("hotelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_hotelId_clientId_createdAt_idx" ON "ApiKey"("hotelId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_hotelId_clientId_idx" ON "WebhookSubscription"("hotelId", "clientId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_hotelId_status_idx" ON "WebhookSubscription"("hotelId", "status");

-- CreateIndex
CREATE INDEX "WebhookDelivery_hotelId_createdAt_id_idx" ON "WebhookDelivery"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_hotelId_status_createdAt_id_idx" ON "WebhookDelivery"("hotelId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_hotelId_eventType_createdAt_id_idx" ON "WebhookDelivery"("hotelId", "eventType", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_id_idx" ON "WebhookDelivery"("subscriptionId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_eventId_key" ON "WebhookDelivery"("subscriptionId", "eventId");

-- CreateIndex
CREATE INDEX "Guest_hotelId_updatedAt_id_idx" ON "Guest"("hotelId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_updatedAt_id_idx" ON "Reservation"("hotelId", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Uygulama adı otelde tekil (silinmemişler arasında; silinen uygulamanın adı yeniden kullanılabilir).
CREATE UNIQUE INDEX "ApiClient_hotelId_name_active_key" ON "ApiClient"("hotelId", lower("name")) WHERE "deletedAt" IS NULL;

-- Göndericinin taraması: sırası gelen (bekleyen / yeniden denenecek) teslimatlar.
CREATE INDEX "WebhookDelivery_due_idx" ON "WebhookDelivery"("nextAttemptAt") WHERE "status" IN ('PENDING', 'RETRYING');

-- Süreç düştüğünde sahiplenilmiş ama bitmemiş teslimatlar (kilit süresi dolunca yeniden alınır).
CREATE INDEX "WebhookDelivery_stuck_idx" ON "WebhookDelivery"("lockedUntil") WHERE "status" = 'SENDING';
