-- Modül 7: misafir mesajları ve istek takibi.
--
-- * Konuşma: durum artık enum (eski serbest metin veriyle birlikte taşınır),
--   AI/manuel modu, atanan personel, bağlı konaklama, okunmamış sayacı,
--   son mesaj özeti ve "cevap bekliyor" zamanı. Liste ekranı her satır için
--   mesaj saymasın diye bu alanlar mesaj yazan işlemde güncellenir.
-- * Mesaj: yazar tipi (misafir/personel/AI/sistem), iç not, kanal teslim
--   durumu ve kanal mesaj kimliği (aynı webhook iki kez gelirse tek kayıt).
-- * GuestRequest: misafir istekleri (kategori, öncelik, SLA, uyandırma saati).

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('GUEST', 'STAFF', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDelivery" AS ENUM ('RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "GuestRequestCategory" AS ENUM ('HOUSEKEEPING', 'AMENITY', 'MAINTENANCE', 'ROOM_SERVICE', 'WAKE_UP', 'TRANSPORT', 'INFORMATION', 'COMPLAINT', 'OTHER');

-- CreateEnum
CREATE TYPE "GuestRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "GuestRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GuestRequestSource" AS ENUM ('CONVERSATION', 'PHONE', 'FRONT_DESK', 'STAFF', 'AI');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "awaitingReplySince" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "lastMessageAuthor" "MessageAuthor",
ADD COLUMN     "lastMessagePreview" TEXT,
ADD COLUMN     "lastReadAt" TIMESTAMP(3),
ADD COLUMN     "mode" "ConversationMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- Eski serbest metin durum ("open", "closed", ...) enum'a taşınır; tanınmayan
-- değer açık sayılır (kapalı sanılıp gözden kaçmasın).
ALTER TABLE "Conversation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "status" TYPE "ConversationStatus"
  USING (CASE WHEN lower(trim("status")) IN ('closed', 'resolved', 'done') THEN 'CLOSED' ELSE 'OPEN' END)::"ConversationStatus";
ALTER TABLE "Conversation" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "Conversation" ALTER COLUMN "status" SET NOT NULL;

-- Kapalı taşınan eski konuşmaların kapanış zamanı bilinmiyor; son mesaj zamanı en yakın tahmin.
UPDATE "Conversation" SET "closedAt" = "lastMessageAt" WHERE "status" = 'CLOSED' AND "closedAt" IS NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "author" "MessageAuthor" NOT NULL DEFAULT 'GUEST',
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "delivery" "MessageDelivery" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GuestRequest" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT,
    "guestId" TEXT,
    "roomId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "category" "GuestRequestCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "GuestRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "GuestRequestStatus" NOT NULL DEFAULT 'OPEN',
    "source" "GuestRequestSource" NOT NULL DEFAULT 'FRONT_DESK',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "resolutionNote" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuestRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestRequest_hotelId_status_dueAt_idx" ON "GuestRequest"("hotelId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "GuestRequest_hotelId_assignedToId_status_idx" ON "GuestRequest"("hotelId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "GuestRequest_hotelId_roomId_status_idx" ON "GuestRequest"("hotelId", "roomId", "status");

-- CreateIndex
CREATE INDEX "GuestRequest_reservationId_idx" ON "GuestRequest"("reservationId");

-- CreateIndex
CREATE INDEX "GuestRequest_conversationId_idx" ON "GuestRequest"("conversationId");

-- CreateIndex
CREATE INDEX "Conversation_hotelId_status_lastMessageAt_idx" ON "Conversation"("hotelId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_hotelId_assignedToId_status_idx" ON "Conversation"("hotelId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "Conversation_hotelId_guestId_idx" ON "Conversation"("hotelId", "guestId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Message_hotelId_delivery_idx" ON "Message"("hotelId", "delivery");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────── Mevcut verinin taşınması ───────────────

-- Eski mesajlarda yazar ve teslim bilgisi yoktu: yöne göre türetilir. Giden
-- eski mesajlar gönderilmiş kabul edilir (kuyruğa düşüp tekrar gitmesin).
UPDATE "Message"
SET "author" = CASE WHEN "direction" = 'OUT' THEN 'STAFF'::"MessageAuthor" ELSE 'GUEST'::"MessageAuthor" END,
    "delivery" = CASE WHEN "direction" = 'OUT' THEN 'SENT'::"MessageDelivery" ELSE 'RECEIVED'::"MessageDelivery" END;

-- Liste özeti: son mesajın ilk 160 karakteri ve yazarı.
UPDATE "Conversation" AS c
SET "lastMessagePreview" = left(m."text", 160),
    "lastMessageAuthor" = m."author"
FROM (
  SELECT DISTINCT ON ("conversationId") "conversationId", "text", "author"
  FROM "Message"
  WHERE "deletedAt" IS NULL AND "internal" = false
  ORDER BY "conversationId", "createdAt" DESC, "id" DESC
) AS m
WHERE m."conversationId" = c."id";

-- ─────────────── Kısıtlar ───────────────

-- Aynı kanal mesajı (webhook tekrarı) aynı konuşmaya iki kez yazılamaz.
CREATE UNIQUE INDEX "Message_conversation_external_unique"
  ON "Message"("conversationId", "externalId")
  WHERE "externalId" IS NOT NULL AND "deletedAt" IS NULL;

-- İç not yalnızca personelden gelir ve misafire gitmez.
ALTER TABLE "Message" ADD CONSTRAINT "Message_internal_note_valid"
  CHECK (NOT "internal" OR ("author" = 'STAFF' AND "direction" = 'OUT'));

-- Gelen mesaj "gönderim bekliyor" olamaz; giden mesaj "alındı" olamaz.
ALTER TABLE "Message" ADD CONSTRAINT "Message_delivery_matches_direction"
  CHECK (
    ("direction" = 'IN' AND "delivery" = 'RECEIVED')
    OR ("direction" = 'OUT' AND "delivery" <> 'RECEIVED')
  );

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_unread_non_negative"
  CHECK ("unreadCount" >= 0);

-- Kapalı konuşmanın kapanış zamanı olur.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_closed_has_time"
  CHECK ("status" = 'OPEN' OR "closedAt" IS NOT NULL);

ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_title_present"
  CHECK (length(trim("title")) > 0);

-- Durumla tutarlı zaman damgaları: tamamlanan isteğin bitiş zamanı, iptal
-- edilenin sebebi olur. Raporlar (ortalama çözüm süresi) buna güvenir.
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_done_has_completion"
  CHECK ("status" <> 'DONE' OR "completedAt" IS NOT NULL);
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_cancel_has_reason"
  CHECK ("status" <> 'CANCELLED' OR length(trim(coalesce("cancelledReason", ''))) > 0);

-- Uyandırma zamanlı istektir.
ALTER TABLE "GuestRequest" ADD CONSTRAINT "GuestRequest_wake_up_scheduled"
  CHECK ("category" <> 'WAKE_UP' OR "scheduledFor" IS NOT NULL);
