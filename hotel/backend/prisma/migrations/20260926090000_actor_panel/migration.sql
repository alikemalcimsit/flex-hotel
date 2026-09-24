-- Modül 12: aktör yönetim paneli, manuel görevler, LLM günlük özeti.
--
-- 1. Aktör ayarı "kim, neden kapattı" bilgisini taşır.
-- 2. Manuel görev üstlenilir, tamamlanır ya da "gerek kalmadı" diye kapanır;
--    açık görevler `closedAt IS NULL` ile index'ten okunur. Görev, işi düşüren
--    aktörü ve olayın zincirini taşır.
-- 3. LLM kullanımı gün × ajan × model özetinde de sayılır: bütçe denetimi ve
--    kullanım ekranları çağrı satırlarını toplamak yerine özeti okur.
--
-- ⚠️ `LlmUsage` büyükse özetin doldurulması tabloyu bir kez tarar; bakım
-- penceresinde uygulanmalı.

-- 1. Aktör ayarı
ALTER TABLE "ActorSetting" ADD COLUMN "note" TEXT,
ADD COLUMN "updatedBy" TEXT;

-- 2. Manuel görev
ALTER TABLE "ManualTask" ADD COLUMN "actorName" TEXT,
ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "resolution" TEXT,
ADD COLUMN "resolvedBy" TEXT;

-- Kapanmış eski görevler: kapanış anı tamamlanma anı (yoksa son değişiklik).
UPDATE "ManualTask"
SET "closedAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" IN ('DONE', 'CANCELLED');

-- Kimseye atanmadan "üstlenildi" kalmış görev olamaz: beklemeye döner.
UPDATE "ManualTask"
SET "status" = 'PENDING'
WHERE "status" = 'IN_PROGRESS' AND "assignedTo" IS NULL;

-- İşi düşüren aktör: taban sınıfın açıklamasından ("room-worker bu işi yapamadı: ...").
UPDATE "ManualTask"
SET "actorName" = substring("description" FROM '^([a-z0-9][a-z0-9-]*) bu işi yapamadı:')
WHERE "description" IS NOT NULL;

-- Olayın zinciri: olay kaydından (aynı olay kimliği).
UPDATE "ManualTask" m
SET "correlationId" = e."correlationId"
FROM "EventLog" e
WHERE m."originalEvent" IS NOT NULL
  AND e."id" = m."originalEvent"->>'id';

-- Durum ile kapanış anı birlikte değişir; üstlenilmiş görevin sahibi vardır.
ALTER TABLE "ManualTask" ADD CONSTRAINT "ManualTask_closed_has_time"
  CHECK (("status" IN ('DONE', 'CANCELLED')) = ("closedAt" IS NOT NULL));
ALTER TABLE "ManualTask" ADD CONSTRAINT "ManualTask_claimed_has_assignee"
  CHECK ("status" <> 'IN_PROGRESS' OR "assignedTo" IS NOT NULL);

CREATE INDEX "ManualTask_hotelId_closedAt_createdAt_id_idx" ON "ManualTask"("hotelId", "closedAt", "createdAt", "id");
CREATE INDEX "ManualTask_hotelId_module_closedAt_createdAt_id_idx" ON "ManualTask"("hotelId", "module", "closedAt", "createdAt", "id");
CREATE INDEX "ManualTask_hotelId_actorName_closedAt_createdAt_id_idx" ON "ManualTask"("hotelId", "actorName", "closedAt", "createdAt", "id");

-- 3. LLM günlük özeti
CREATE TABLE "LlmUsageDaily" (
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "actorName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" BIGINT NOT NULL DEFAULT 0,
    "tokensOut" BIGINT NOT NULL DEFAULT 0,
    "cacheRead" BIGINT NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmUsageDaily_pkey" PRIMARY KEY ("hotelId","date","actorName","model")
);

CREATE INDEX "LlmUsageDaily_hotelId_actorName_date_idx" ON "LlmUsageDaily"("hotelId", "actorName", "date");

ALTER TABLE "LlmUsageDaily" ADD CONSTRAINT "LlmUsageDaily_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şimdiye kadarki çağrılar özete.
INSERT INTO "LlmUsageDaily" ("hotelId", "date", "actorName", "model", "calls", "tokensIn", "tokensOut", "cacheRead", "costUsd", "updatedAt")
SELECT "hotelId", "date", "actorName", "model", COUNT(*), SUM("tokensIn"), SUM("tokensOut"), SUM("cacheRead"), SUM("costUsd"), CURRENT_TIMESTAMP
FROM "LlmUsage"
WHERE "deletedAt" IS NULL
GROUP BY "hotelId", "date", "actorName", "model";
