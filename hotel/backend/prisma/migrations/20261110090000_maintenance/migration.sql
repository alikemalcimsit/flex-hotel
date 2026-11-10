-- Modül 20: Teknik servis / arıza-bakım. MaintenanceTicket iskeleti genişletilir;
-- fotoğraf ve periyodik plan tabloları eklenir.

CREATE TYPE "MaintenanceCategory" AS ENUM ('ELECTRICAL', 'PLUMBING', 'HVAC', 'FURNITURE', 'APPLIANCE', 'STRUCTURAL', 'SAFETY', 'OTHER');

-- Personel uyarısına yeni tür (yeni / acil arıza).
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'MAINTENANCE';

-- MaintenanceTicket: yaşam döngüsü + kaynak + oda kapatma bağı + ilişkiler
ALTER TABLE "MaintenanceTicket"
  ADD COLUMN "locationText" TEXT,
  ADD COLUMN "category" "MaintenanceCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'staff',
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedBy" TEXT,
  ADD COLUMN "resolutionNote" TEXT,
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "roomBlockId" TEXT,
  ADD COLUMN "housekeepingTaskId" TEXT,
  ADD COLUMN "guestRequestId" TEXT,
  ADD COLUMN "planId" TEXT;

CREATE INDEX "MaintenanceTicket_hotelId_status_priority_idx" ON "MaintenanceTicket"("hotelId", "status", "priority");
CREATE INDEX "MaintenanceTicket_hotelId_roomId_status_idx" ON "MaintenanceTicket"("hotelId", "roomId", "status");
CREATE INDEX "MaintenanceTicket_hotelId_assignedTo_status_idx" ON "MaintenanceTicket"("hotelId", "assignedTo", "status");
CREATE INDEX "MaintenanceTicket_hotelId_guestRequestId_idx" ON "MaintenanceTicket"("hotelId", "guestRequestId");

-- MaintenancePhoto
CREATE TABLE "MaintenancePhoto" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MaintenancePhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenancePhoto_ticketId_createdAt_idx" ON "MaintenancePhoto"("ticketId", "createdAt");

-- MaintenancePlan
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'OTHER',
    "roomId" TEXT,
    "locationText" TEXT,
    "intervalDays" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenancePlan_hotelId_active_idx" ON "MaintenancePlan"("hotelId", "active");

-- İlişkiler
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenancePhoto" ADD CONSTRAINT "MaintenancePhoto_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenancePhoto" ADD CONSTRAINT "MaintenancePhoto_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
