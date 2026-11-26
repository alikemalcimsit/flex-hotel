-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('TEST', 'IYZICO');

-- CreateEnum
CREATE TYPE "PaymentGatewayEnvironment" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "PaymentGatewayTestBehavior" AS ENUM ('APPROVE', 'DECLINE');

-- CreateEnum
CREATE TYPE "WidgetPrepayment" AS ENUM ('NONE', 'FIRST_NIGHT', 'FULL');

-- CreateEnum
CREATE TYPE "PaymentLinkPurpose" AS ENUM ('PREPAYMENT', 'BALANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentLinkOrigin" AS ENUM ('STAFF', 'PORTAL', 'WIDGET');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('OPEN', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GatewayRefundStatus" AS ENUM ('PENDING_APPROVAL', 'PROCESSING', 'DONE', 'FAILED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationSource" ADD VALUE 'PAYMENT_LINK';

-- AlterEnum
ALTER TYPE "NotificationTrigger" ADD VALUE 'PAYMENT_LINK';

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'PAYMENT_GATEWAY';

-- CreateTable
CREATE TABLE "PaymentGatewaySettings" (
    "hotelId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "PaymentGatewayProvider" NOT NULL DEFAULT 'TEST',
    "environment" "PaymentGatewayEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "credentialsSealed" TEXT,
    "apiPublicUrl" TEXT,
    "linkTtlHours" INTEGER NOT NULL DEFAULT 72,
    "maxInstallment" INTEGER NOT NULL DEFAULT 1,
    "allowPortalPayment" BOOLEAN NOT NULL DEFAULT true,
    "widgetPrepayment" "WidgetPrepayment" NOT NULL DEFAULT 'NONE',
    "testBehavior" "PaymentGatewayTestBehavior" NOT NULL DEFAULT 'APPROVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PaymentGatewaySettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "folioId" TEXT,
    "code" TEXT NOT NULL,
    "requestId" TEXT,
    "purpose" "PaymentLinkPurpose" NOT NULL DEFAULT 'BALANCE',
    "origin" "PaymentLinkOrigin" NOT NULL DEFAULT 'STAFF',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "environment" "PaymentGatewayEnvironment" NOT NULL,
    "providerToken" TEXT,
    "conversationId" TEXT,
    "startedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerPaymentId" TEXT,
    "providerItems" JSONB NOT NULL DEFAULT '[]',
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "installment" INTEGER,
    "paidAmount" DECIMAL(12,2),
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLinkEvent" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayRefund" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "GatewayRefundStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalId" TEXT,
    "providerRefundId" TEXT,
    "paymentId" TEXT,
    "failureMessage" TEXT,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_code_key" ON "PaymentLink"("code");

-- CreateIndex
CREATE INDEX "PaymentLink_hotelId_reservationId_idx" ON "PaymentLink"("hotelId", "reservationId");

-- CreateIndex
CREATE INDEX "PaymentLink_hotelId_status_createdAt_idx" ON "PaymentLink"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentLink_status_expiresAt_idx" ON "PaymentLink"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_hotelId_requestId_key" ON "PaymentLink"("hotelId", "requestId");

-- CreateIndex
CREATE INDEX "PaymentLinkEvent_linkId_createdAt_idx" ON "PaymentLinkEvent"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "GatewayRefund_linkId_idx" ON "GatewayRefund"("linkId");

-- CreateIndex
CREATE INDEX "GatewayRefund_approvalId_idx" ON "GatewayRefund"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayRefund_hotelId_requestId_key" ON "GatewayRefund"("hotelId", "requestId");

-- AddForeignKey
ALTER TABLE "PaymentGatewaySettings" ADD CONSTRAINT "PaymentGatewaySettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkEvent" ADD CONSTRAINT "PaymentLinkEvent_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkEvent" ADD CONSTRAINT "PaymentLinkEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PaymentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayRefund" ADD CONSTRAINT "GatewayRefund_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayRefund" ADD CONSTRAINT "GatewayRefund_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PaymentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kurallar
ALTER TABLE "PaymentGatewaySettings" ADD CONSTRAINT "PaymentGatewaySettings_ranges" CHECK ("linkTtlHours" BETWEEN 1 AND 720 AND "maxInstallment" BETWEEN 1 AND 12);
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_amount" CHECK ("amount" > 0 AND "refundedAmount" >= 0 AND ("paidAmount" IS NULL OR "refundedAmount" <= "paidAmount"));
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_paid" CHECK ("status" <> 'PAID' OR ("paidAt" IS NOT NULL AND "paidAmount" IS NOT NULL));
ALTER TABLE "GatewayRefund" ADD CONSTRAINT "GatewayRefund_amount" CHECK ("amount" > 0);
