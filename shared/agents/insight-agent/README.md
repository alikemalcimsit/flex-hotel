# insight-agent

Misafir geri bildirimi ajanı (modül 55'te kuruldu; 54 ve FlexAI 2.0 kullanır).

- `survey.analysis.requested` → yorumun duygusu, en fazla beş konusu (sabit liste), tek cümlelik Türkçe özeti.
- `survey.insight.requested` → dönemin ana temaları (pay, örnek alıntı), özet paragraf, en fazla üç öneri.

Model yalnız puanları ve yorum metnini görür (ad, onay kodu, iletişim gitmez); çıktı şemalı JSON, ayrıştırırken
listeyle sınırlanır. Servis (`model`, `analysisInput` / `completeAnalysis`, `insightInput` / `completeInsight`)
backend'den verilir; paket Prisma bilmez. Yorum siteleri (54) için aynı istemler yeni olay adıyla bağlanabilir.
