-- Modül 14: kat hizmetleri. Görev tablosu genişletilir: atanan görevli (User ilişkisi),
-- başlangıç / bitiş damgaları, kat şefi kontrolü (dört göz), sorun bildirimi ve misafir
-- isteği bağı. Tablolar Prisma'nın ürettiği; altta veritabanı kuralları (kısmi tekil
-- index) elle: bir odanın aynı anda tek açık TEMİZLİK görevi olur — misafir isteği
-- görevleri (havlu) muaftır.

-- AlterEnum: misafir isteğinden doğan görev tipi (modül 7 → 14).
ALTER TYPE "HousekeepingType" ADD VALUE 'GUEST_REQUEST';

-- AlterTable: `assignedTo` serbest metindi (modül iskeletinden); kimse yazmadı,
-- veri kaybı yok. User ilişkili `assignedToId` ile değiştirilir.
ALTER TABLE "HousekeepingTask" DROP COLUMN "assignedTo",
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completionNote" TEXT,
ADD COLUMN     "inspectionPassed" BOOLEAN,
ADD COLUMN     "inspectedById" TEXT,
ADD COLUMN     "inspectedAt" TIMESTAMP(3),
ADD COLUMN     "inspectionNote" TEXT,
ADD COLUMN     "issueNote" TEXT,
ADD COLUMN     "issueReportedAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "guestRequestId" TEXT;

-- CreateIndex
CREATE INDEX "HousekeepingTask_hotelId_scheduledFor_idx" ON "HousekeepingTask"("hotelId", "scheduledFor");
CREATE INDEX "HousekeepingTask_hotelId_status_priority_idx" ON "HousekeepingTask"("hotelId", "status", "priority");
CREATE INDEX "HousekeepingTask_hotelId_roomId_status_idx" ON "HousekeepingTask"("hotelId", "roomId", "status");
CREATE INDEX "HousekeepingTask_hotelId_assignedToId_status_idx" ON "HousekeepingTask"("hotelId", "assignedToId", "status");

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_guestRequestId_fkey" FOREIGN KEY ("guestRequestId") REFERENCES "GuestRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Veritabanı kuralı (elle): bir odanın aynı anda tek açık temizlik görevi.
-- Aktör (çıkış olayı) ile zamanlayıcı (sabah STAYOVER üretimi) yarışırsa ikinci
-- yazım burada durur; servis bunu "zaten var" diye okur, hata değil.
CREATE UNIQUE INDEX "HousekeepingTask_open_cleaning_per_room_key"
  ON "HousekeepingTask"("hotelId", "roomId")
  WHERE "status" IN ('PENDING', 'IN_PROGRESS')
    AND "type" IN ('CHECKOUT_CLEAN', 'STAYOVER', 'DEEP_CLEAN')
    AND "deletedAt" IS NULL;

-- Veritabanı kuralı (elle): aynı misafir isteğinin aynı anda tek açık görevi.
CREATE UNIQUE INDEX "HousekeepingTask_open_request_key"
  ON "HousekeepingTask"("hotelId", "guestRequestId")
  WHERE "status" IN ('PENDING', 'IN_PROGRESS')
    AND "guestRequestId" IS NOT NULL
    AND "deletedAt" IS NULL;

-- Veritabanı kuralı (elle): öncelik 1-5 aralığında.
ALTER TABLE "HousekeepingTask"
  ADD CONSTRAINT "HousekeepingTask_priority_range" CHECK ("priority" BETWEEN 1 AND 5);
