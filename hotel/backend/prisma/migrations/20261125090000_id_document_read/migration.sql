-- Modül 59: kimlik / pasaport okuma (MRZ). Görüntü ve MRZ metni saklanmaz; yalnız "kimlikten okundu"
-- işareti (kim, ne zaman, nereden) ve online check-in belgesinin karşılaştırma sonucu.

-- CreateEnum
CREATE TYPE "IdReadVia" AS ENUM ('STAFF_SCAN', 'ONLINE_PHOTO');

-- CreateEnum
CREATE TYPE "DocumentOcrStatus" AS ENUM ('MATCH', 'MISMATCH', 'UNREADABLE');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "idReadAt" TIMESTAMP(3),
ADD COLUMN     "idReadBy" TEXT,
ADD COLUMN     "idReadVia" "IdReadVia";

-- AlterTable
ALTER TABLE "OnlineCheckinDocument" ADD COLUMN     "ocrCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ocrCheckedBy" TEXT,
ADD COLUMN     "ocrExpired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ocrMismatch" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ocrStatus" "DocumentOcrStatus";
