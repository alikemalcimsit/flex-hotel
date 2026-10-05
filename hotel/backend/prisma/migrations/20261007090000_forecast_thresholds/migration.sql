-- Modül 25: tahminin kritik gün eşikleri (otel ayarı, yüzde).
ALTER TABLE "Hotel" ADD COLUMN     "forecastLowOccupancyPct" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "forecastHighOccupancyPct" INTEGER NOT NULL DEFAULT 95;

-- Servisin kontrolüne ek, son savunma hattı: 0–100 arası, yüksek eşik düşükten en az 5 puan büyük
-- (contracts/forecast.js → FORECAST_THRESHOLD_MIN_GAP_PCT).
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_forecast_threshold_range"
  CHECK ("forecastLowOccupancyPct" BETWEEN 0 AND 100
     AND "forecastHighOccupancyPct" BETWEEN 0 AND 100
     AND "forecastHighOccupancyPct" - "forecastLowOccupancyPct" >= 5);
