-- Modül 23: Gelir raporları.
--
-- Rapor işlenen geliri (FolioItem) otelin hizmet gününe göre özetler; bir yıllık
-- aralıkta büyük otelde ~1M satır. Bu index olmadan sorgu otelin bütün folyo
-- kalemlerini tarardı.

-- CreateIndex
CREATE INDEX "FolioItem_hotelId_serviceDate_idx" ON "FolioItem"("hotelId", "serviceDate");
