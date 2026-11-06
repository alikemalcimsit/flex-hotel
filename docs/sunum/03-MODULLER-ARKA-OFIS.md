# 03 — Modüller: Raporlama, Satış, F&B, Stok, Muhasebe (Modül 23–47) + AI Ajanları

> İşaretler: ✅ Tam · ⚠️ Kısmi · ❌ Yol haritası.
> **Tam (14):** 23, 25, 27, 29, 31, 33, 35, 37, 38, 39, 41, 43, 45, 47. **Kısmi (3):** 24, 26, 44. **Yok (8):** 28, 30, 32, 34, 36, 40, 42, 46.

---

## A. RAPORLAMA (23–27)

### M23 — Gelir Raporları ✅
**Ne yapar:** Tek istekte dönem toplamı + gün/hafta/ay kırılımı + oda tipi & kaynak + geçen yıl kıyası.
**Kilit kurallar (PARA):** Doluluk% = satılan/satılabilir; **ADR** = oda geliri / satılan gece; **RevPAR** = oda geliri / satılabilir oda. **Oranlar dönem toplamından hesaplanır** (günlük oranların ortalaması alınmaz). Geçmiş = folyoya işlenen gerçekleşen; bugün ve sonrası = eldeki rezervasyondan (vergi ayrılmış). Geçen yıl = 364 gün önce (aynı hafta günü). Saatte bir özet yeniden hesaplanır ama rapor canlı okunur — iş çalışmasa da doğru. (1 yıllık rapor 3,9 sn → 0,43 sn hızlanır.)
**Aktör:** İnsan (müdür/muhasebe) + AI (salt-okunur MCP).
**Demo değeri:** Yüksek — sektör metrikleri.

### M24 — Doğal Dil Raporlama ⚠️ KISMİ
**Durum:** Güvenli **MCP yüzeyi yazılmış** (`reports/mcp.js`): salt-okunur, tek otele bağlı, **serbest SQL yok** — yalnız Zod ile doğrulanmış 5 hazır rapor (doluluk, gelir, forecast, sapma açıklaması). Her çağrı denetim izinde. **Ama sohbet ajanı (`report-agent`/`insight-agent`) yazılmadı** — sadece stub.
**Demoda:** "Soru sor, cevap al" çalışan bir sohbet gibi gösterme. "AI'ya açtığımız güvenli, salt-okunur rapor yüzeyi hazır; sohbet katmanı yol haritasında" de. (Masaüstü MCP istemcisiyle bugün teknik olarak kullanılabilir.)

### M25 — Forecast ✅ (grubun yıldızı)
**Ne yapar:** 30 güne kadar doluluk + gelir tahmini + geçen yıl + kritik gün uyarıları.
**Algoritma (pickup):** Pickup oranı = (ref günü gerçekleşen gece − o gün kala eldeki gece) / satılabilir oda. Kaynak: geçen yıl ≥2 örnek → `LAST_YEAR`; yoksa son 8 hafta → `RECENT`; o da yoksa `NONE` (tahmin = eldeki, **uydurmaz**). Tahmin = eldeki + oran × satılabilir (satılabiliri aşmaz, 0 altına inmez). Kritik gün: OVERBOOKED / HIGH / LOW. **Dürüstlük:** her satırda `basis` + `samples` döner; veri yoksa not düşülür.
**Demo değeri:** Çok yüksek — "boş kalacak haftayı 2 hafta önce gör" güçlü satış hikayesi. ⚠️ Geçmiş veri yoksa öne çıkarma.

### M26 — Rapor Tasarımcısı / Excel ⚠️ KISMİ
**Durum:** Ayrı "rapor tasarımcısı" modülü yok; "Excel" yalnızca **bütçe** şablonu indir/doldur/yükle. **Serbest rapor tasarımcısı vaat etme.**

### M27 — Bütçe ✅
**Ne yapar:** Yıllık bütçe planı (taslak → onaylı kilit → gerekçeli revize); gerçekleşenle sapma; AI yorumu.
**Kilit kurallar (PARA):** Ay içi orantı (pacing): içinde bulunulan ay = plan × (kapanmış gün / ayın günü). **Oda geliri sapması ayrıştırması:** doluluk etkisi = (gerçek gece − plan gece) × hedef ADR; fiyat etkisi = (gerçek ADR − hedef ADR) × gerçek gece. Gerçekleşen tek kaynaktan (gelir raporu). GOP = gelir − gider.
**Aktör:** `budget-agent` — sapmayı Türkçe yorumlar (rakamları sistem hesaplar).
**Demo değeri:** Yüksek — "AI neden sapma olduğunu açıklıyor."

---

## B. SATIŞ / DAĞITIM (28–36)

### M28 — Paket/Pansiyon (BB/HB/AI) ❌ YOL HARİTASI
`boardType` alanı taşınıyor ama pansiyon fiyatlaması yok. Gösterme.

### M29 — Kontrat & Acente ✅
**Ne yapar:** Acente kartı + dönem×oda tipi×pansiyon fiyat tablosu + stop-sale + cari özeti.
**Kilit kurallar:** **Komisyon kopyalanır:** açılışta `agency.commissionPct` rezervasyona yazılır — sonradan oran değişse bile eski rezervasyon açılıştaki oranı korur. Gece gece fiyatlama (iki kontrata yayılan konaklama her gece kendi kontratından). Ret: pasif acente, stop-sale (elle fiyatla bile aşılamaz), para birimi uyuşmazlığı.
**Demo değeri:** Orta-yüksek (B2B otelciler için önemli).

### M30 — Grup & Allotment ❌ YOL HARİTASI
Kodda `allotment` yok. Gösterme.

### M31 — Promosyon & Kupon ✅
**Ne yapar:** 3 tür indirim: yüzde / tutar / "X kal Y öde"; hepsi kuruş hassasiyetli (decimal.js).
**Kilit kurallar:** Yüzde: her uygun gece `brüt × oran`. Tutar: toplam indirim gecelere **fiyatları oranında** bölünür, artık kuruşlar tarih sırasıyla dağıtılır; hiçbir gecede o gecenin fiyatını aşamaz. "X kal Y öde": en ucuz geceler bedava. **Tek indirim / en avantajlısı:** bir rezervasyona tek indirim, misafire en avantajlısı; eşitlikte otomatik promosyon (kupon hakkı yanmaz). Erken çıkışta otomatik yeniden değerlendirme.
**Demo değeri:** Orta.

### M32 — Online Rezervasyon Motoru ❌ YOL HARİTASI
Sadece `/quote` fiyat-sorgu altyapısı var, web widget yok. "Temeli atılmış" de.

### M33 — Kanal Yönetimi / Channel Manager ✅ ⭐ (yıldız)
**Ne yapar:** OTA'lara (Booking.com, Expedia, Airbnb, Agoda — Channex.io aracılığıyla) + iCal'a fiyat/müsaitlik/stop-sale otomatik senkron.
**GERÇEK Channex.io istemcisi — mock DEĞİL:** prod+staging API, gerçek HTTP `fetch`, API anahtarı, 20 sn timeout, 429 hız limiti, webhook kurma, revizyon feed + ack.
**Kilit kurallar:** **Fark senkronu** — sadece değişen/gönderilmemiş günler; ardışık aynı değerler tek aralığa sıkıştırılır (500 günlük takvim 2 çağrıda). Zamanlama: gönderim her 5 sn, kanal başına min 10 sn; iCal 60 sn; gece tam eşitleme 02–05. Kanal fiyatı = `liste × (1 + markup/100)` — demodaki tek gerçek "dinamik fiyat". Overbooking kanala 0 gider; gelen kayıt "önce sakla sonra teyit" → sıfır kayıp. API anahtarı + webhook sırrı **şifreli.**
**Aktör:** `channel-sync-worker`.
**Demo değeri:** Çok yüksek — "gerçekten Booking.com'a bağlanıyor" güçlü mesaj. ⚠️ Canlıya almak için otelin Channex hesabı gerekir.

### M34 — Dinamik Fiyat / Yield ❌ YOL HARİTASI
`pricing-agent` sadece stub, kayıtlı değil. Tek "dinamik" = kanal markup (M33). AI dinamik fiyat yok — gösterme.

### M35 — Acente Prim / Sadakat ✅ ⭐
**Ne yapar:** Dönemlik hedef (gece/ciro) + 10 kademeye kadar prim; dönem kapanınca otomatik hesap, **dört göz onayı.**
**Kilit kurallar (PARA):** WHOLE (geriye dönük): en yüksek ulaşılan kademe oranı **tüm ciroya.** EXCESS (dilimli): her kademe kendi dilimine; gece ölçütünde dilim tutarı = dilim gecesi × dönemin **ortalama gece geliri** (sezon sonu pahalı geceler primi şişirmesin). Tavan/eksi koruması. Matrah = vergisiz oda geliri (gelir raporuyla aynı). Gönderen onaylayamaz, 7 gün süre.
**Demo değeri:** Orta-yüksek (acente çalışan oteller için).

### M36 — Call Center / Satış CRM ❌ YOL HARİTASI
Yok. Gösterme.

---

## C. F&B / POS (37–43)

### M37 — Banket / Etkinlik ✅
**Ne yapar:** Salon takvimi; talep → opsiyon → teklif → kesin; sıralı opsiyon; sürümlü PDF.
**Kilit kurallar:** Salon çakışması DB `EXCLUDE` kısıtıyla imkânsız (aynı etkinliğin kurulum/oturum dilimleri çakışabilir ama iki farklı kesin etkinlik çakışamaz). Faturalanacak kişi: gerçekleşmeden `garanti ?? tahmin`, gerçekleşince `max(garanti, gerçekleşen)`. İptal bedeli kademeli; iade borcun üstündeki fazlayla sınırlı.
**Demo değeri:** Orta-yüksek (banket salonu olan oteller).

### M38 — Menü & Reçete ✅
**Ne yapar:** 4 seviyeye kadar ara-ürünlü, fireli reçete; canlı maliyet; gıda-maliyeti %; 14 alerjen.
**Kilit kurallar (PARA):** Fire→brüt: `brüt = net × 100 / (100 − fire%)`. Reçete maliyeti recursive (ara reçeteler); önbellekli. **Maliyet gizleme:** maliyet alanları yalnız `recipes.view` olana döner, **sunucuda süzülür** — ön büro menüyü görür, maliyeti göremez.
**Demo değeri:** Orta — "maliyet yetkiye göre gizleniyor" güzel detay.

### M39 — Restoran POS ✅ (en büyük modül)
**Ne yapar:** Garson vardiya → masa → tur tur sipariş (her tur mutfak fişi) → adisyon böl/taşı/birleştir → nakit/kart/kişi-başı/**odaya yaz** → vardiya nakit sayımı.
**Kilit kurallar (PARA):** **"Odaya yaz" kuruş garantisi:** kalemler vergi kategorisi başına brüt folyoya gider, folyo kendi motoruyla **birebir** toplar; servis ücreti kuruş yuvarlaması tutarı erişilemez kılarsa tutar **reddedilir** ve en yakın iki tutar önerilir. İndirim kategorilere en-büyük-kalan kuruş yöntemiyle dağıtılır. Dört göz: eşik üstü ikram/iptal/indirim onaya; bekleyen iş varken adisyon/vardiya kapanmaz. Vardiya kasası: beklenen = avans + nakit − iptal; fark eşik aşarsa uyarı. Adisyon kapanınca `fnb.order.paid` → stok.
**Aktör:** `billing-worker` (odaya yazım), onay servisi.
**Demo değeri:** Çok yüksek — dokunmatik masa planı.

### M40 — Mutfak Ekranı (KDS) ❌ YOL HARİTASI
POS olayları (`fnb.order.placed`) hazır ama ayrı KDS ekranı yazılmadı. (**Not:** Oda servisi panosu M41'de var ve KDS benzeri görünür — onu göster; ama restoran KDS'i ayrı ve yok.)

### M41 — Oda Servisi ✅ (POS çekirdeğini paylaşır)
**Ne yapar:** 3 kaynak — personel / odadaki **QR** / misafir isteği. Pano: onay→mutfak→hazır→yolda→teslim.
**Kilit kurallar:** **Teslim tek transaction:** kapı ödemeleri + kalanın odaya yazılması + adisyon kapanışı birlikte. QR güvenliği: HMAC imza, IP hız limiti, konaklamada max 3 açık sipariş, 30 dk kabul edilmeyen otomatik reddedilir.
**Demo değeri:** Çok yüksek — **4 kolonlu KDS benzeri pano en etkileyici ekranlardan.**

### M42 — Online Paket Sipariş ❌ YOL HARİTASI
Yok. Gösterme.

### M43 — Banket F&B ✅
**Ne yapar:** Etkinlik menüsü → reçetelerden kişi sayısına göre malzeme ihtiyacı + maliyet → tek tıkla satın alma talebi.
**Kilit kurallar:** `demandCalculator` (önbellekli); talep ihtiyaç günü erken olana önce dağıtılır.
**Demo değeri:** Orta.

---

## D. STOK / SATIN ALMA / MUHASEBE (44–47)

### M44 — Stok & Maliyet ⚠️ KISMİ (çekirdek var)
**Yazılı:** depo + mevcut + min seviye + değişmez hareket + **hareketli ortalama maliyet.**
**Yazılmayan:** çıkış / transfer / fire / sayım / maliyet raporu.
**Kilit formül — HAREKETLİ ORTALAMA:** `yeni maliyet = (eldeki × eski maliyet + gelen × alış) / (eldeki + gelen)` (4 basamak, yarım yukarı). Elde ≤ 0 ise doğrudan alış fiyatı. Aynı belgede aynı malzeme sırayla işlenir. Maliyet otel geneli tek değer.
**Demoda:** "Stok çekirdeği (giriş + ağırlıklı ortalama maliyet) hazır; çıkış/fire/sayım yol haritasında" de.

### M45 — Satın Alma ✅
**Ne yapar:** Dört adım: talep → teklif turu → teklif karşılaştırma → sipariş+onay → mal kabul.
**Kilit kurallar:** Min stok önerisi = `minLevel − onHand − onOrder − requested`. Kazanan teklif: ihtiyaca yetişen → en düşük fiyat → kısa termin; en-uygun-dışı seçim **gerekçe ister.** Onay eşiği (dört göz): KDV-dahil ≥ eşik (varsayılan 50.000) → `PENDING_APPROVAL`, açan onaylayamaz. Mal kabul: adette tam kalan, tartılanda %5 fazla kabul; aynı irsaliye iki kez girilemez. **Tedarikçi borcu** olayı `purchase.goods.received` (vadeli).
**Aktör:** Onay servisi + `accounting-worker` (tedarikçi carisi).
**Demo değeri:** Yüksek — ERP düzeyi kapsam.

### M46 — Demirbaş / Amortisman ❌ YOL HARİTASI
Kodda hiç yok. **Demoda gösterme.**

### M47 — Ön Muhasebe ✅ ⭐ (grubun en zengini)
**Ne yapar:** Cari hesaplar (acente/tedarikçi/müşteri), kasa/banka, çek/senet, fişler — ve **tüm bunlara otomatik kayıt.**
**Cari bakiye:** hareket borç XOR alacak; `bakiye = bakiye + borç − alacak` (ham SQL). **FIFO yaşlandırma:** en eski borç önce kapanır; vadesi gelmemiş/1-30/31-60/61-90/90+ dilimleri.
**⭐ OTOMATİK MUHASEBE KAYDI** (idempotent, tekil `sourceKey` — iki kez yazılmaz):

| Olay (hangi modül) | Muhasebe etkisi |
|---|---|
| Mal kabul (45) | Tedarikçi carisine KDV-dahil **alacak** (bizim borcumuz), vadeli |
| Folyo ödemesi nakit/kart (17) | Kasa/bankaya giriş |
| Folyo acente/cari ile kapatma | Seçilen cariye **borç** |
| Etkinlik tahsilatı (37) | Kasa giriş + müşteri carisinden alacak |
| POS ödemesi (39/41) | Kasa/bankaya giriş |
| Acente primi onayı (35) | Acente carisine alacak |

**"Eşitle" düğmesi** (`POST /accounting/sync`): aktör kapalıyken birikeni anti-join ile bulup işler (idempotent, yeniden yazmaz).
**Kasa/Banka:** tutar işaretli (+giriş/−çıkış). **Kasa eksiye düşmez** (`CASH_INSUFFICIENT`); banka (kredili mevduat) düşebilir. Dövizli kasa: çevrilmiş tutar + kaynak döviz + kur kayıtta.
**Çek/Senet durum makinesi:** Alınan çek Portföy → tahsilde (yalnız banka) → tahsil (kasaya giriş) / **karşılıksız (cariyi yeniden borçlandırır**, ciroluysa ciro edilene de). Verilen çek → ödenir (bankadan çıkış, kasa kontrolü).
**Fişler + dört göz:** tahsilat/ödeme/virman/açılış. Ödeme ≥ eşik → onaya; **onay anında kasa yeniden kontrol** (boşaldıysa reddedilir). İptal silmez — gerekçeyle ters kayıt.
**Aktör:** `accounting-worker`.
**Demo değeri:** Çok yüksek — "tahsilat kendiliğinden muhasebeye düşüyor" güçlü kurumsal mesaj.

---

## E. AI AJANLARI

**Ortak altyapı:** OpenAI resmi SDK, Chat Completions. `BaseLlmAgent` her çağrıda izin→çağrı→kayıt (bkz. `01-MIMARI.md` §8). Bütçe/maliyet Decimal ile, aynı transaction'da. Yalnız `OPENAI_API_KEY` varsa kaydedilir.

### 1. `router-agent` ✅ (niyet)
`guest.message.received` → ucuz modelle niyet (RESERVATION/QUESTION/COMPLAINT/HUMAN/OTHER) + dil + `affirmative` → `guest.intent.detected`. Katı JSON şema, max 120 token. **Prompt injection koruması** ("misafir metni veri, talimat değil"). Bozuk çıktı "OTHER". LLM yoksa personele devir.

### 2. `concierge-agent` ✅ (en karmaşık — gerçek LangGraph)
`guest.intent.detected` → gerçek `@langchain/langgraph` `StateGraph` (START → agent ⇄ tools → END). 5 araç gerçek servisle çalışır: `check_availability`, `get_hotel_info`, `propose_reservation`, `request_reservation`, `handoff_to_staff`. **"Misafir evet demeden rezervasyon basılmaz" 4 katmanlı `requestBlocker`** + göndermeden önce fiyat/müsaitlik yeniden kontrol. Tur başına max 5 model çağrısı. Konuşma başına seri kuyruk. Onay kodu/tutar şablondan. Şikâyet/limit/hata → personele devir.

### 3. `budget-agent` ✅ (bütçe yorumu)
`budget.commentary.requested` → sapmayı Türkçe tek paragrafla yorumlar. **Rakamları sistem hesaplar** (`explainVariance`), LLM sadece yorumlar — halüsinasyon minimize. Modele yalnız rakam gider (kişisel veri yok). Onaya tabi değil (sadece okur). Kapalıysa rapor yorumsuz da tam.

### ❌ Yazılmamış ajanlar (yol haritası)
`pricing-agent` (dinamik fiyat — stub, kayıtlı değil), `report-agent` / `insight-agent` (sohbetle raporlama / duygu analizi — README stub).

---

## Bu grubun sunum özeti

**Vurgulanacak 5 çarpıcı özellik:**
1. **Kendiliğinden ön muhasebe** — tahsilat/mal kabul/prim otomatik, idempotent, FIFO yaşlandırmalı cari.
2. **Gerçek Channel Manager (Channex.io)** — fark-bazlı senkron, Booking/Expedia/Airbnb/Agoda.
3. **AI concierge** — "evet demeden rezervasyon basmaz" 4 katmanlı güvenlik.
4. **Hareketli ortalama maliyet + reçete→menü zinciri** — maliyet yetkiye göre gizli.
5. **"Odaya yaz" kuruş garantisi + pickup forecast** — kuruşu kuruşuna folyoya; 30 günlük tahmin (veri yoksa uydurmaz).
