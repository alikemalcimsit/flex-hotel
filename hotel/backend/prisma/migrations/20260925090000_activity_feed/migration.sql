-- Modül 10: aktör aktivite akışı, olay listesi, işlem zinciri, denetim listesi.
--
-- Aktivite satırı artık işlediği olayın adını ve zincir kimliğini taşır: akış
-- süzgeci ve zincir görünümü JSON alanından ya da EventLog'a katılarak değil,
-- index'li sütundan okur. Listeler otel başına ve en yeni önce imleçle
-- sayfalanır; eski (otel kapsamsız) index'ler bu ihtiyaca yaramıyordu.
--
-- ⚠️ Büyük tabloda: index'ler kilitle oluşturulur (Prisma migration'ı
-- transaction içinde çalışır, CONCURRENTLY kullanılamaz). Yoğun saatte değil,
-- bakım penceresinde uygulanmalı.

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN "correlationId" TEXT,
ADD COLUMN "eventName" TEXT;

-- Eski satırlar: olayın adı ve zinciri EventLog'dan (aynı olay kimliği).
UPDATE "ActivityLog" a
SET "eventName" = e."name", "correlationId" = e."correlationId"
FROM "EventLog" e
WHERE e."id" = a."eventId";

-- Olayı EventLog'da bulunamayanlar (eski, silinmiş): ad meta'dan.
UPDATE "ActivityLog"
SET "eventName" = "meta"->>'event'
WHERE "eventName" IS NULL AND "meta" ? 'event';

-- DropIndex
DROP INDEX "ActivityLog_actorName_idx";
DROP INDEX "ActivityLog_createdAt_idx";
DROP INDEX "EventLog_name_idx";
DROP INDEX "AuditLog_hotelId_entity_entityId_idx";
DROP INDEX "AuditLog_hotelId_createdAt_idx";

-- CreateIndex
CREATE INDEX "ActivityLog_hotelId_createdAt_id_idx" ON "ActivityLog"("hotelId", "createdAt", "id");
CREATE INDEX "ActivityLog_hotelId_actorName_createdAt_id_idx" ON "ActivityLog"("hotelId", "actorName", "createdAt", "id");
CREATE INDEX "ActivityLog_hotelId_eventName_createdAt_id_idx" ON "ActivityLog"("hotelId", "eventName", "createdAt", "id");
CREATE INDEX "ActivityLog_correlationId_idx" ON "ActivityLog"("correlationId");

CREATE INDEX "EventLog_hotelId_occurredAt_id_idx" ON "EventLog"("hotelId", "occurredAt", "id");
CREATE INDEX "EventLog_hotelId_name_occurredAt_id_idx" ON "EventLog"("hotelId", "name", "occurredAt", "id");

CREATE INDEX "AuditLog_hotelId_entity_entityId_createdAt_id_idx" ON "AuditLog"("hotelId", "entity", "entityId", "createdAt", "id");
CREATE INDEX "AuditLog_hotelId_createdAt_id_idx" ON "AuditLog"("hotelId", "createdAt", "id");
CREATE INDEX "AuditLog_hotelId_actor_createdAt_id_idx" ON "AuditLog"("hotelId", "actor", "createdAt", "id");
CREATE INDEX "AuditLog_hotelId_entity_createdAt_id_idx" ON "AuditLog"("hotelId", "entity", "createdAt", "id");

-- Seviye süzgeci. "Sorunlar" (uyarı + hata) iki ayrı taramayla okunur: kısmi
-- index parametreli sorguda (Prisma) genel plana geçince kullanılamıyordu.
CREATE INDEX "ActivityLog_hotelId_level_createdAt_id_idx" ON "ActivityLog"("hotelId", "level", "createdAt", "id");
