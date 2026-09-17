-- Onay kuyruğu (modül 11): aktörün ya da personelin onaya götürdüğü işler,
-- onay verilince kaldığı yerden devam eden aktör işi, zile "onay bekliyor" uyarısı.

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'APPROVAL_REQUESTED';

-- AlterTable: Approval
-- Modül 11'e kadar hiçbir kod bu tabloya yazmadı; satır varsa dur.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Approval") THEN
    RAISE EXCEPTION 'Approval tablosu boş değil; modül 11 migration''ı eski satırları taşımaz. Önce kayıtları inceleyin.';
  END IF;
  IF EXISTS (SELECT 1 FROM "PendingAction") THEN
    RAISE EXCEPTION 'PendingAction tablosu boş değil; modül 11 migration''ı eski satırları taşımaz. Önce kayıtları inceleyin.';
  END IF;
END $$;

ALTER TABLE "Approval"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "amount" DECIMAL(12,2),
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "actorName" TEXT,
  ADD COLUMN "action" TEXT,
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "entityId" TEXT;

-- Bekleyenler eskiden yeniye, geçmiş yeni karar önce (imleçli sayfalama).
CREATE INDEX "Approval_hotelId_status_createdAt_id_idx" ON "Approval" ("hotelId", "status", "createdAt", "id");
CREATE INDEX "Approval_hotelId_status_decidedAt_id_idx" ON "Approval" ("hotelId", "status", "decidedAt", "id");

-- Süre dolumu taraması: yalnızca süreli bekleyenler (küçük, sıcak küme).
CREATE INDEX "Approval_pending_expiry_idx" ON "Approval" ("expiresAt")
  WHERE "status" = 'PENDING' AND "expiresAt" IS NOT NULL AND "deletedAt" IS NULL;

-- Özet araması (pg_trgm, 20260919090000_scale_indexes ile kuruldu).
CREATE INDEX "Approval_summary_trgm_idx" ON "Approval" USING gin ("summary" gin_trgm_ops);

-- AlterTable: PendingAction
ALTER TABLE "PendingAction"
  ADD COLUMN "eventId" TEXT NOT NULL,
  ADD COLUMN "resumedAt" TIMESTAMP(3);

-- Aynı olay için ikinci onay isteği açılmaz (olay yeniden dağıtılsa da).
CREATE UNIQUE INDEX "PendingAction_actorName_eventId_key" ON "PendingAction" ("actorName", "eventId");
CREATE INDEX "PendingAction_approvalId_idx" ON "PendingAction" ("approvalId");
