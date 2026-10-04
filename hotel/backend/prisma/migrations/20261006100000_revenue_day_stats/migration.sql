-- Modül 23: gelir raporunun kapanmış gün özeti.
--
-- Rapor geçmiş günleri bu özetten okur: canlı sorgu otelin bütün rezervasyon ve
-- folyo geçmişini taradığı için yıllar biriktikçe yavaşlardı. Özet zamanlanmış
-- işle hesaplanır ve kendini onarır (modules/reports/stats.js); işaretsiz gün
-- canlı okunur.

-- CreateTable
CREATE TABLE "RevenueDayStat" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "currency" TEXT NOT NULL,
    "sold" INTEGER NOT NULL,
    "roomRevenue" DECIMAL(14,2) NOT NULL,
    "discounts" DECIMAL(14,2) NOT NULL,
    "fees" DECIMAL(14,2) NOT NULL,
    "cancellations" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "RevenueDayStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueStatDay" (
    "hotelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueStatDay_pkey" PRIMARY KEY ("hotelId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueDayStat_hotelId_day_roomTypeId_source_currency_key" ON "RevenueDayStat"("hotelId", "day", "roomTypeId", "source", "currency");

-- CreateIndex
CREATE INDEX "RevenueStatDay_hotelId_computedAt_idx" ON "RevenueStatDay"("hotelId", "computedAt");

-- AddForeignKey
ALTER TABLE "RevenueDayStat" ADD CONSTRAINT "RevenueDayStat_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueStatDay" ADD CONSTRAINT "RevenueStatDay_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kısıtlar
ALTER TABLE "RevenueDayStat" ADD CONSTRAINT "RevenueDayStat_sold_nonnegative" CHECK ("sold" >= 0);
