-- Modül 8: WhatsApp / web chat ile konuşarak rezervasyon.
--
-- AI asistanı ayarları (model, fiyat, günlük bütçe, AI rezervasyonunun
-- durumu, otel bilgisi), konuşma başına AI hafızası (özet, teklifler, onay
-- bekleyen teklif, gönderilen rezervasyon isteği), mesaj kanalı bağlantıları
-- (WhatsApp Cloud API, web chat balonu), yeni zil türleri ve kullanım index'leri.

-- AlterEnum


ALTER TYPE "StaffAlertKind" ADD VALUE 'AI_HANDOFF';
ALTER TYPE "StaffAlertKind" ADD VALUE 'AI_BUDGET';

-- AlterTable
ALTER TABLE "LlmUsage" ADD COLUMN     "conversationId" TEXT;

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "routerModel" TEXT NOT NULL DEFAULT '',
    "conciergeModel" TEXT NOT NULL DEFAULT '',
    "prices" JSONB NOT NULL DEFAULT '{}',
    "dailyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reservationStatus" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "hotelInfo" TEXT,
    "maxRepliesPerConversationDay" INTEGER NOT NULL DEFAULT 40,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationAiState" (
    "conversationId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "language" TEXT,
    "lastIntent" TEXT,
    "summary" TEXT,
    "summarizedUntil" TIMESTAMP(3),
    "offers" JSONB NOT NULL DEFAULT '[]',
    "offersAt" TIMESTAMP(3),
    "pendingOffer" JSONB,
    "pendingRequestId" TEXT,
    "requestedAt" TIMESTAMP(3),
    "repliesDay" DATE,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationAiState_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "MessagingChannel" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "externalAccountId" TEXT,
    "publicKey" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT,
    "secretUpdatedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_hotelId_key" ON "AiSettings"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAiState_pendingRequestId_key" ON "ConversationAiState"("pendingRequestId");

-- CreateIndex
CREATE INDEX "ConversationAiState_hotelId_idx" ON "ConversationAiState"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_externalAccountId_key" ON "MessagingChannel"("externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_publicKey_key" ON "MessagingChannel"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_hotelId_channel_key" ON "MessagingChannel"("hotelId", "channel");

-- CreateIndex
CREATE INDEX "LlmUsage_hotelId_date_idx" ON "LlmUsage"("hotelId", "date");

-- CreateIndex
CREATE INDEX "Message_hotelId_externalId_idx" ON "Message"("hotelId", "externalId");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAiState" ADD CONSTRAINT "ConversationAiState_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAiState" ADD CONSTRAINT "ConversationAiState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingChannel" ADD CONSTRAINT "MessagingChannel_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AiSettings"
  -- AI açıkken iki model de seçili olmalı.
  ADD CONSTRAINT "AiSettings_models_when_enabled" CHECK (NOT "enabled" OR ("routerModel" <> '' AND "conciergeModel" <> '')),
  ADD CONSTRAINT "AiSettings_budget_valid" CHECK ("dailyBudgetUsd" >= 0),
  ADD CONSTRAINT "AiSettings_reservation_status_valid" CHECK ("reservationStatus" IN ('CONFIRMED', 'PENDING')),
  ADD CONSTRAINT "AiSettings_reply_limit_valid" CHECK ("maxRepliesPerConversationDay" BETWEEN 1 AND 500);

ALTER TABLE "ConversationAiState"
  ADD CONSTRAINT "ConversationAiState_replies_valid" CHECK ("repliesCount" >= 0);

ALTER TABLE "MessagingChannel"
  ADD CONSTRAINT "MessagingChannel_channel_valid" CHECK ("channel" IN ('WHATSAPP', 'WEBCHAT')),
  -- Açık WhatsApp bağlantısının telefon numarası kimliği ve sırları olmalı.
  ADD CONSTRAINT "MessagingChannel_whatsapp_complete" CHECK (
    "channel" <> 'WHATSAPP' OR NOT "enabled" OR ("externalAccountId" IS NOT NULL AND "secret" IS NOT NULL)
  ),
  -- Web chat balonunun genel anahtarı her zaman vardır (kayıt açılırken üretilir).
  ADD CONSTRAINT "MessagingChannel_webchat_key" CHECK ("channel" <> 'WEBCHAT' OR "publicKey" IS NOT NULL);

ALTER TABLE "LlmUsage"
  ADD CONSTRAINT "LlmUsage_tokens_valid" CHECK ("tokensIn" >= 0 AND "tokensOut" >= 0 AND "cacheRead" >= 0 AND "costUsd" >= 0);

-- Gönderim bekleyen giden mesajlar (kanal geçidinin "bekleyenleri gönder" işi).
-- Kısmi: yalnızca bekleyen satırlar; teslim edilen milyonlarca mesaj index'e girmez.
CREATE INDEX "Message_pending_outgoing_idx" ON "Message" ("createdAt")
  WHERE "delivery" = 'PENDING' AND "direction" = 'OUT' AND "internal" = false AND "deletedAt" IS NULL;

-- AI'da cevap bekleyen konuşmalar (takılan AI turunu personele devreden iş).
CREATE INDEX "Conversation_ai_waiting_idx" ON "Conversation" ("awaitingReplySince")
  WHERE "mode" = 'AI' AND "status" = 'OPEN' AND "awaitingReplySince" IS NOT NULL AND "deletedAt" IS NULL;

-- İç not artık sistemin de olabilir: AI'ın konuşmayı devretme sebebi ve
-- gönderdiği rezervasyon isteği personelin göreceği iç not olarak yazılır
-- (misafire gitmez). Misafirin mesajı ve AI'ın cevabı iç not olamaz.
ALTER TABLE "Message" DROP CONSTRAINT "Message_internal_note_valid";
ALTER TABLE "Message" ADD CONSTRAINT "Message_internal_note_valid"
  CHECK (NOT "internal" OR ("author" IN ('STAFF', 'SYSTEM') AND "direction" = 'OUT'));
