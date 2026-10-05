# budget-agent

Bütçe sapmasını yorumlayan otel ajanı (modül 27).

- Dinler: `budget.commentary.requested` (sapma raporunda "Yorumla").
- Yazar: `budget.commentary.completed` (servis üzerinden; yorum ya da "yazılamadı" sebebi).
- Girdi: sistemin hesapladığı açıklama (`explainVariance`: dönem, toplamlar, en büyük
  sapmalar, oda gelirinin doluluk / fiyat etkisi, hedefler, eksik veri notları). Rakam
  hesaplamaz, kişisel veri görmez.
- Model: otelin ana modeli (AI ayarlarındaki concierge modeli); günlük AI bütçesi ve
  kullanım kaydı ortak (`BaseLlmAgent`).
- Kapalıysa ya da AI kullanılamıyorsa istek "yazılamadı" ile kapanır; sapma raporu
  yorumsuz da eksiksizdir. Aynı veri MCP'de `explain_variance` aracıyla (modül 24).

Paket Prisma bilmez; servis `hotel/backend/src/lib/actors.js` içinde verilir.
