-- Modül 15: Folyo yönetimi.
--
-- Folyo: konaklamadaki pencere numarası (Folyo 1, 2...), ödeyen adı,
-- denormalize toplamlar (borç, ödenen, bakiye), açan / kapatan, birleştirme izi.
-- Kalem: doğduğu konaklama, hizmet günü, kaynak (gece, erken giriş, iptal
-- ücreti, minibar...), vergi dökümü ve net / vergi / toplam, tekrar işleme
-- anahtarı, iptal (ters kayıt) ve aktarma izi. Yeni tablolar: yönlendirme
-- (hangi tip hangi folyoya) ve gecenin oda ücreti çalışması.
--
-- Eski kayıtlar: bu modülden önce folyoya yazan bir servis yoktu; var olan
-- satırlar demo verisidir. Silinmez; yeni kolonlar önce boş eklenir, eski
-- satırlardan doldurulur (toplam = tutar × adet, vergi dökümü yok), sonra
-- zorunlu yapılır.

-- AlterEnum: folyoda personelin bakması gereken durum (çıkıştan sonra kalan bakiye).
ALTER TYPE "StaffAlertKind" ADD VALUE 'FOLIO_ATTENTION';

-- CreateEnum
CREATE TYPE "FolioItemSource" AS ENUM ('MANUAL', 'ROOM_NIGHT', 'EARLY_CHECK_IN', 'LATE_CHECK_OUT', 'CANCELLATION', 'NO_SHOW', 'FNB_ORDER', 'MINIBAR', 'REVERSAL');

-- ─────────────── Folyo ───────────────

ALTER TABLE "Folio" ADD COLUMN     "chargesTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedBy" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "openedBy" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "paymentsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "window" INTEGER NOT NULL DEFAULT 1;

-- Eski veride bir konaklamanın birden fazla folyosu varsa pencere numarası sırayla.
UPDATE "Folio" f
SET "window" = ranked."window"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "reservationId" ORDER BY "createdAt", "id")::int AS "window"
  FROM "Folio"
) ranked
WHERE ranked."id" = f."id";

UPDATE "Folio" SET "closedBy" = 'system' WHERE "status" = 'CLOSED' AND "closedBy" IS NULL;
UPDATE "Folio" SET "closedAt" = "updatedAt" WHERE "status" = 'CLOSED' AND "closedAt" IS NULL;
UPDATE "Folio" SET "closedAt" = NULL WHERE "status" <> 'CLOSED' AND "closedAt" IS NOT NULL;

-- ─────────────── Folyo kalemi ───────────────

-- DropForeignKey
ALTER TABLE "FolioItem" DROP CONSTRAINT "FolioItem_taxId_fkey";

-- DropIndex
DROP INDEX "FolioItem_folioId_idx";

-- Vergi artık kalemin kendi dökümünde (`taxLines`); tek vergiye bağ kalkar.
-- Kaynak serbest metindi ve yazan yoktu: enum'a çevrilir, eskiler MANUAL.
ALTER TABLE "FolioItem" DROP COLUMN "taxId",
DROP COLUMN "source",
ADD COLUMN     "source" "FolioItemSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "serviceDate" DATE,
ADD COLUMN     "netAmount" DECIMAL(12,2),
ADD COLUMN     "taxAmount" DECIMAL(12,2),
ADD COLUMN     "total" DECIMAL(12,2),
ADD COLUMN     "taxCategory" TEXT,
ADD COLUMN     "taxLines" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedBy" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidApprovalId" TEXT,
ADD COLUMN     "voidRequestedAt" TIMESTAMP(3),
ADD COLUMN     "voidRequestedBy" TEXT,
ADD COLUMN     "transferredFromFolioId" TEXT,
ADD COLUMN     "transferredAt" TIMESTAMP(3),
ADD COLUMN     "transferredBy" TEXT;

-- Eski satırlar: konaklama folyodan, hizmet günü işlendiği anın otel günü,
-- toplam = tutar × adet (vergi dökümü bilinmiyor: net = toplam, vergi 0).
UPDATE "FolioItem" i
SET "reservationId" = f."reservationId",
    "serviceDate" = ((i."postedAt" AT TIME ZONE 'UTC') AT TIME ZONE h."timezone")::date,
    "total" = ROUND(i."amount" * i."quantity", 2),
    "netAmount" = ROUND(i."amount" * i."quantity", 2),
    "taxAmount" = 0
FROM "Folio" f
JOIN "Hotel" h ON h."id" = f."hotelId"
WHERE f."id" = i."folioId";

ALTER TABLE "FolioItem" ALTER COLUMN "reservationId" SET NOT NULL,
ALTER COLUMN "serviceDate" SET NOT NULL,
ALTER COLUMN "netAmount" SET NOT NULL,
ALTER COLUMN "taxAmount" SET NOT NULL,
ALTER COLUMN "total" SET NOT NULL;

-- Folyo toplamları kalem ve ödemelerden.
UPDATE "Folio" f
SET "chargesTotal" = totals."charges",
    "paymentsTotal" = totals."paid",
    "balance" = totals."charges" - totals."paid"
FROM (
  SELECT fo."id",
         COALESCE((SELECT SUM(i."total") FROM "FolioItem" i WHERE i."folioId" = fo."id" AND i."deletedAt" IS NULL), 0) AS "charges",
         COALESCE((SELECT ROUND(SUM(p."amount" * COALESCE(p."exchangeRate", 1)), 2)
                   FROM "Payment" p WHERE p."folioId" = fo."id" AND p."deletedAt" IS NULL), 0) AS "paid"
  FROM "Folio" fo
) totals
WHERE totals."id" = f."id";

-- ─────────────── Yönlendirme ve gece çalışması ───────────────

-- CreateTable
CREATE TABLE "FolioRoute" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "FolioItemType" NOT NULL,
    "folioId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolioRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomChargeRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "night" DATE NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "stays" INTEGER,
    "items" INTEGER,
    "total" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomChargeRun_pkey" PRIMARY KEY ("id")
);

-- ─────────────── Index'ler ───────────────

-- CreateIndex
CREATE INDEX "FolioRoute_folioId_idx" ON "FolioRoute"("folioId");

-- CreateIndex
CREATE UNIQUE INDEX "FolioRoute_reservationId_type_key" ON "FolioRoute"("reservationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RoomChargeRun_hotelId_night_key" ON "RoomChargeRun"("hotelId", "night");

-- CreateIndex
CREATE INDEX "Folio_hotelId_status_updatedAt_id_idx" ON "Folio"("hotelId", "status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Folio_hotelId_status_closedAt_id_idx" ON "Folio"("hotelId", "status", "closedAt", "id");

-- CreateIndex
CREATE INDEX "Folio_mergedIntoId_idx" ON "Folio"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Folio_reservationId_window_key" ON "Folio"("reservationId", "window");

-- CreateIndex
CREATE UNIQUE INDEX "FolioItem_reversalOfId_key" ON "FolioItem"("reversalOfId");

-- CreateIndex (folyo dökümü: hizmet günü, işlenme sırası)
CREATE INDEX "FolioItem_folioId_serviceDate_postedAt_id_idx" ON "FolioItem"("folioId", "serviceDate", "postedAt", "id");

-- CreateIndex
CREATE INDEX "FolioItem_reservationId_source_serviceDate_idx" ON "FolioItem"("reservationId", "source", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "FolioItem_hotelId_sourceKey_key" ON "FolioItem"("hotelId", "sourceKey");

-- ─────────────── Yabancı anahtarlar ───────────────

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "FolioItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_transferredFromFolioId_fkey" FOREIGN KEY ("transferredFromFolioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoute" ADD CONSTRAINT "FolioRoute_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoute" ADD CONSTRAINT "FolioRoute_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoute" ADD CONSTRAINT "FolioRoute_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomChargeRun" ADD CONSTRAINT "RoomChargeRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Kısıtlar (servisin kontrolüne ek, son savunma hattı) ───────────────

-- Folyo: bakiye = borç − ödenen; kapalıysa kapanış anı var; birleştirildiyse hedefi var ve kendisi değil.
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_window_positive" CHECK ("window" >= 1);
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_balance_consistent" CHECK ("balance" = "chargesTotal" - "paymentsTotal");
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_closed_has_time" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_merged_has_target"
  CHECK (("status" = 'TRANSFERRED') = ("mergedIntoId" IS NOT NULL) AND ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id"));

-- Kalem: adet sınırlı, tutar sıfır olamaz, satır tutarlı (net + vergi = toplam).
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 999);
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_total_consistent" CHECK ("total" = "netAmount" + "taxAmount");
-- Ters kayıt yalnızca bir asıl kaleme bağlıdır; eksi tutar yalnızca indirim ve ters kayıtta.
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_reversal_link" CHECK (("source" = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_amount_sign"
  CHECK ("source" = 'REVERSAL' OR ("amount" < 0) = ("type" = 'DISCOUNT'));
-- İptal ve iptal isteği izleri eksiksiz.
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_void_trail" CHECK (("voidedAt" IS NULL) = ("voidedBy" IS NULL));
ALTER TABLE "FolioItem" ADD CONSTRAINT "FolioItem_void_request_trail"
  CHECK (("voidRequestedAt" IS NULL) = ("voidRequestedBy" IS NULL) AND ("voidRequestedAt" IS NULL OR "voidApprovalId" IS NOT NULL));
