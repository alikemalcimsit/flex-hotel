# pricing-agent

Dinamik fiyat ajanı (modül 34). Günlük `pricing.review.requested` olayını alır,
doluluk / kalan gün / geçen yıl verisinden gerekçeli fiyat önerileri üretir.
Fiyatı kendisi değiştirmez: her önerisi kural tabanlı yield ile aynı kapıdan
(M11 onay kuyruğu) geçer. Model yoksa sessizce çekilir — kural tabanlı yield
bağımsız çalışır.
