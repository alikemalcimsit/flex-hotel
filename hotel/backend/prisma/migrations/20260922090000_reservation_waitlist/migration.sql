-- Bekleyen liste (modül 4): yer yokken kaydedilen rezervasyon talebi için yeni
-- durum. Envanter tüketmez — çifte-rezervasyon EXCLUDE kısıtı ve müsaitlik
-- hesabı yalnızca PENDING/CONFIRMED/CHECKED_IN sayar, WAITLISTED'i saymaz.

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'WAITLISTED';
