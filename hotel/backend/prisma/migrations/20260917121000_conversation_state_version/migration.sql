-- Konuşma yönetim sürümü (modül 7).
--
-- Konuşmaya her yeni mesaj `updatedAt`'i değiştirir. Yönetim işlemleri
-- (atama, kapatma, manuele alma) `updatedAt` ile korunsaydı, yoğun gelen
-- kutusunda personel "ata" derken misafirin yazması "kayıt değişti" hatası
-- verirdi. Sürüm yalnızca yönetim alanları değişince artar.

ALTER TABLE "Conversation" ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_state_version_non_negative"
  CHECK ("stateVersion" >= 0);
