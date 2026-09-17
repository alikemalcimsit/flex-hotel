-- 2500 personel ölçeği: büyük tablolarda sıralı liste, arama ve arka plan
-- taramalarının index'leri. Ölçüm: 550 bin rezervasyon, 800 bin mesaj,
-- 1 milyon istek, 1,5 milyon bildirim, 150 bin personel uyarısı.
--
-- Veriler küçükken (bugünkü canlı) index'ler anında oluşur. Büyük bir
-- veritabanına uygulanacaksa yazma trafiği düşükken çalıştırın.

-- Serbest metin araması (ILIKE '%...%') için trigram. PostgreSQL 13'ten beri
-- "trusted" eklenti; veritabanı sahibi kurabilir (btree_gist gibi contrib).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────── Rezervasyon ───────────────

-- Pencere sorguları (oda planı, müsaitlik, atama): "çıkışı pencere başından
-- sonra olanlar". Otel filtresi olmayan (checkIn, checkOut) index'i bütün
-- geçmişi tarıyordu; durum index'i de düşük seçicilikle yanlış plana itiyordu.
DROP INDEX IF EXISTS "Reservation_checkIn_checkOut_idx";
DROP INDEX IF EXISTS "Reservation_status_idx";
CREATE INDEX "Reservation_hotelId_checkOut_checkIn_idx" ON "Reservation" ("hotelId", "checkOut", "checkIn");

-- Misafirin konaklamaları (gelen mesajı konaklamaya bağlamak, CRM).
CREATE INDEX "Reservation_hotelId_guestId_checkIn_idx" ON "Reservation" ("hotelId", "guestId", "checkIn");

-- Onay koduyla arama.
CREATE INDEX "Reservation_confirmationCode_trgm_idx" ON "Reservation" USING gin ("confirmationCode" gin_trgm_ops);

-- ─────────────── Misafir ───────────────

-- Gelen e-postayı misafir kartıyla eşleştirme (büyük/küçük harf duyarsız).
CREATE INDEX "Guest_hotelId_email_lower_idx" ON "Guest" ("hotelId", lower("email"))
  WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;

-- Ada göre arama (gelen kutusu, istekler, oda planı).
CREATE INDEX "Guest_firstName_trgm_idx" ON "Guest" USING gin ("firstName" gin_trgm_ops);
CREATE INDEX "Guest_lastName_trgm_idx" ON "Guest" USING gin ("lastName" gin_trgm_ops);

-- ─────────────── Konuşma ───────────────

-- "Tümü" görünümü (durum filtresiz, en son mesaj önce).
CREATE INDEX "Conversation_hotelId_lastMessageAt_id_idx" ON "Conversation" ("hotelId", "lastMessageAt", "id");
-- Konaklamaya bağlı konuşmalar (oda numarası / onay koduyla arama).
CREATE INDEX "Conversation_hotelId_reservationId_idx" ON "Conversation" ("hotelId", "reservationId");

CREATE INDEX "Conversation_displayName_trgm_idx" ON "Conversation" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX "Conversation_externalId_trgm_idx" ON "Conversation" USING gin ("externalId" gin_trgm_ops);
CREATE INDEX "Conversation_lastMessagePreview_trgm_idx" ON "Conversation" USING gin ("lastMessagePreview" gin_trgm_ops);

-- ─────────────── Misafir isteği ───────────────

-- Bitmiş işlerin listeleri: tamamlanan (yeni biten önce), iptal (yeni önce), tümü.
CREATE INDEX "GuestRequest_hotelId_status_completedAt_id_idx" ON "GuestRequest" ("hotelId", "status", "completedAt", "id");
CREATE INDEX "GuestRequest_hotelId_status_updatedAt_id_idx" ON "GuestRequest" ("hotelId", "status", "updatedAt", "id");
CREATE INDEX "GuestRequest_hotelId_createdAt_id_idx" ON "GuestRequest" ("hotelId", "createdAt", "id");
-- Misafirin istekleri (ada göre arama).
CREATE INDEX "GuestRequest_hotelId_guestId_idx" ON "GuestRequest" ("hotelId", "guestId");

CREATE INDEX "GuestRequest_title_trgm_idx" ON "GuestRequest" USING gin ("title" gin_trgm_ops);
CREATE INDEX "GuestRequest_description_trgm_idx" ON "GuestRequest" USING gin ("description" gin_trgm_ops);

-- ─────────────── Bildirim ───────────────

-- Bildirim detayındaki tekrar gönderimler.
CREATE INDEX "Notification_resendOfId_idx" ON "Notification" ("resendOfId");

-- Teslim raporu bekleyen SMS'ler (yalnızca onlar; e-postalar sonsuza dek
-- "gönderildi" kalır ve genel index'te taranırsa her turda geçmişin tamamı okunur).
CREATE INDEX "Notification_sms_report_idx" ON "Notification" ("sentAt", "hotelId")
  WHERE "status" = 'SENT' AND "channel" = 'SMS' AND "providerMessageId" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX "Notification_recipient_trgm_idx" ON "Notification" USING gin ("recipient" gin_trgm_ops);
CREATE INDEX "Notification_recipientName_trgm_idx" ON "Notification" USING gin ("recipientName" gin_trgm_ops);
CREATE INDEX "Notification_subject_trgm_idx" ON "Notification" USING gin ("subject" gin_trgm_ops);

-- ─────────────── Personel uyarısı ───────────────

-- Zil: her kitle (kişi / izin) kendi dalında en yeniden okunur.
DROP INDEX IF EXISTS "StaffAlert_hotelId_userId_occurredAt_idx";
DROP INDEX IF EXISTS "StaffAlert_hotelId_permission_occurredAt_idx";
CREATE INDEX "StaffAlert_hotelId_userId_occurredAt_id_idx" ON "StaffAlert" ("hotelId", "userId", "occurredAt", "id");
CREATE INDEX "StaffAlert_permission_feed_idx" ON "StaffAlert" ("hotelId", "permission", "occurredAt", "id")
  WHERE "userId" IS NULL;

-- ─────────────── Olay altyapısı ───────────────

-- Dağıtılmamış kalmış olaylar (outbox tarayıcısı).
CREATE INDEX "EventLog_unpublished_idx" ON "EventLog" ("occurredAt")
  WHERE "publishedAt" IS NULL AND "deletedAt" IS NULL;

-- Aktörlerin "işledim" kayıtlarının saklama süresi temizliği.
CREATE INDEX "ProcessedEvent_createdAt_idx" ON "ProcessedEvent" ("createdAt");
