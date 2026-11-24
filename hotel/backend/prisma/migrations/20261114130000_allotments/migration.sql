-- Modül 30: Grup & allotment.
-- Acenteye dönem boyunca gecelik ayrılan oda kotası. Release tarihine
-- (giriş gecesi − releaseDays) kadar kullanılmamış kota genel satışa kapalı;
-- kota garanti, tavan değil (dolunca acente genel havuzdan devam eder).
-- Kullanım türetilir: acentenin o tip + geceyi kapsayan geçerli rezervasyonları.

-- CreateTable
CREATE TABLE "Allotment" (
  "id"          TEXT NOT NULL,
  "hotelId"     TEXT NOT NULL,
  "agencyId"    TEXT NOT NULL,
  "roomTypeId"  TEXT NOT NULL,
  "startDate"   DATE NOT NULL,
  "endDate"     DATE NOT NULL,
  "quantity"    INTEGER NOT NULL,
  "releaseDays" INTEGER NOT NULL DEFAULT 0,
  "notes"       TEXT,
  "createdBy"   TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),

  CONSTRAINT "Allotment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (müsaitlik hesabının sıcak yolu: tip + pencere)
CREATE INDEX "Allotment_hotelId_roomTypeId_startDate_endDate_idx"
  ON "Allotment"("hotelId", "roomTypeId", "startDate", "endDate");
CREATE INDEX "Allotment_hotelId_agencyId_deletedAt_idx"
  ON "Allotment"("hotelId", "agencyId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Allotment" ADD CONSTRAINT "Allotment_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allotment" ADD CONSTRAINT "Allotment_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allotment" ADD CONSTRAINT "Allotment_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Prisma kısmi index, EXCLUDE ve CHECK ifade edemez; bunlar son savunma hattıdır
-- (servis aynı kuralları yazmadan önce denetler, eşzamanlı iki istek yarışırsa
-- veritabanı reddeder). btree_gist zaten kurulu.

-- Geçerli dönem (en fazla 1100 gün — kontratla aynı emniyet), makul kota ve release.
ALTER TABLE "Allotment"
  ADD CONSTRAINT "Allotment_period_valid" CHECK ("endDate" >= "startDate" AND ("endDate" - "startDate") < 1100),
  ADD CONSTRAINT "Allotment_quantity_valid" CHECK ("quantity" BETWEEN 1 AND 500),
  ADD CONSTRAINT "Allotment_release_valid" CHECK ("releaseDays" BETWEEN 0 AND 365);

-- Aynı acente + oda tipinde yayındaki kotaların dönemleri çakışmaz: bir geceye
-- tek kota satırı düşsün, "verilen" belirsiz olmasın. Silinmişler çakışabilir.
ALTER TABLE "Allotment" ADD CONSTRAINT "Allotment_no_overlap"
  EXCLUDE USING gist (
    "agencyId" WITH =,
    "roomTypeId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);
