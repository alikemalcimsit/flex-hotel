#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Misafir web sitesindeki sohbet balonuna ya da WhatsApp'a "15–18 Ekim 2 kişilik oda" yazar; yapay zekâ asistanı müsaitliği ve fiyatı söyler, teklifi sunar ve misafir açıkça onaylayınca rezervasyonu açar. Oda atanır, onay kodu sohbete yazılır. Şikâyet, özel istek, bütçe aşımı ya da asistanın emin olmadığı her durumda konuşma personele geçer.],
  rakam: (("7/24", "web sohbet + WhatsApp"), ("Açık onay", "misafir \"evet\" demeden rezervasyon yok"), ("Bütçeli", "günlük yapay zekâ harcama sınırı")),
  adimlar: (("Mesaj", "WhatsApp · web"), ("Niyet", "rezervasyon · soru · şikâyet"), ("Asistan", "müsaitlik · fiyat · teklif"), ("Onay", "misafir evet der"), ("Rezervasyon", "oda + onay kodu")),
  ozellik: (
    ("Web sohbet balonu", "Siteye gömülen hafif balon; \"yazıyor…\", okundu bilgisi, oturum başına hız sınırı."),
    ("WhatsApp Cloud API", "Meta webhook'u imza doğrulamalı; teslim bildirimleri mesaja işlenir; 24 saat penceresi kapalıysa açıkça belirtilir."),
    ("Güvenli rezervasyon", "Teklif 30 dk geçerli; onaydan önce fiyat ve müsaitlik yeniden denetlenir; onay kodu veritabanından şablonla yazılır."),
    ("Personele devir", "Şikâyet / personel isteği modelsiz devredilir; uzun konaklama, kalabalık grup ve uzak tarih personele; 5 dk cevapsız kalan konuşma personele geçer."),
    ("Bütçe ve kullanım", "Günlük bütçe (otelin iş gününe göre) dolunca model çağrılmaz; ayarlar ekranında kullanım ve maliyet."),
    ("Kendi ayarları", "Model, fiyat, bütçe, AI rezervasyonu kesin / opsiyonlu, otel bilgisi metni."),
  ),
  neden: [Gece yarısı gelen soru da cevapsız kalmaz; ama yapay zekâ yalnız güvenli olduğu yerde karar verir, gerisini personele bırakır.],
  rol: (([Yönetici], [AI ve kanal ayarlarını yapar.]), ([Ön büro], [Devredilen konuşmaları devralır.])),
  baglantilar: ("*Mesajlar (7):* aynı gelen kutusu; AI etiketli mesajlar ve iç notlar.", "*Rezervasyon (4):* asistanın rezervasyon isteği de aynı kurallardan geçer; uygunsa açılır, değilse reddedilir.", "*Oda (3):* oda aktörü odayı atar.", "*Aktör paneli (12):* ajanlar aç / kapa ve kullanım."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Paketler: `shared/agents/llm` (OpenAI resmi SDK adaptörü, maliyet ve bütçe hesabı), `shared/actor-kit` (`BaseLlmAgent`: izin → çağrı → kullanım kaydı; arka plan yürütmesi ve kuyruk sınırı), router ajanı (küçük model, katı JSON şeması), `hotel/agents/concierge-agent` (LangGraph `StateGraph`; araçlar `check_availability`, `get_hotel_info`, `propose_reservation`, `request_reservation`, `handoff_to_staff`), WhatsApp ve web sohbet geçitleri. Akış: `guest.message.received` → niyet (`guest.intent.detected`) → concierge turu (en fazla 5 model çağrısı) → misafir yeni mesajda açıkça onaylarsa `reservation.requested` → rezervasyon aktörü → `reservation.created` → oda aktörü → onay kodu.],
  kural: (
    ("Onay olmadan talep yok", "Router onayı + teklif önceki turda sunulmuş + fiyat / müsaitlik yeniden denetlenmiş olmalı."),
    ("Sınırlar", "Konuşma başına günlük cevap sınırı, tur sınırı; 30 geceden uzun / 10 kişiden kalabalık / 540 günden ileri istek personele."),
    ("Bütçe", "Fiyat ayardan, maliyet yukarı yuvarlanır; bütçe dolunca konuşma personele, yönetime `AI_BUDGET` uyarısı."),
    ("Kanal güvenliği", "WhatsApp `X-Hub-Signature-256` ham gövde üzerinden; web sohbette imzalı oturum token'ı (30 gün kayar), izinli site adresi, IP ve oturum hız sınırı."),
  ),
  tutarlilik: ("Gönderilmeden kalan cevapları dakikada bir iş gönderir; mesaj önce sahiplenilir (çift gönderim yok).", "Onay kodu \"talebiniz alındı\" cevabından sonra gider (konuşma başına sıra).", "Kanal sırları veritabanında şifreli JSON."),
  degistir: (
    ("Yeni araç (tool)", "`concierge-agent/tools.js` + birim testi; araç sunucu servislerini çağırır, veritabanına doğrudan yazmaz."),
    ("Model / fiyat", "Ayarlar → AI asistanı; kod değişikliği gerekmez."),
  ),
  devir: ("WhatsApp bildirim şablonları (Meta onaylı, otelin başlattığı mesaj) ayrı iş; bildirimler şimdilik e-posta / SMS.", "Ajan sırası, kanal kaydı ve olay yolu süreç içi — çok örnekli kurulumda paylaşılan kuyruğa taşınmalı.", "Üretimde `OPENAI_API_KEY` gerekir; yoksa ajanlar başlamaz, konuşmalar personelde açılır."),
)
