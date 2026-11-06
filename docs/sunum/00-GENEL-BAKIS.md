# 00 — Genel Bakış

## 1. FlexHotel nedir? (Tek cümle)

FlexHotel (kod adı HotelOS), bir otelin tüm işini (ön büro, kat hizmetleri, folyo/ödeme, restoran/POS, stok, satın alma, ön muhasebe, raporlama) tek sistemde toplayan; rutin işleri **otonom "dijital çalışanlar" (aktörler)** ile kendiliğinden yapan, kritik kararlarda ise **insana onay sorarak** çalışan bir otel yönetim sistemidir.

## 2. Hangi problemi çözüyor?

Otelciler bugün tipik olarak:
- **Dağınık sistemler** kullanır: PMS ayrı, kanal yöneticisi ayrı, muhasebe ayrı, restoran POS ayrı — veriler birbirini tutmaz.
- **Manuel ve hataya açık** çalışır: resepsiyonist aynı odayı iki misafire satar (overbooking), tahsilat muhasebeye düşmez, ay sonu mizan kuruş tutmaz.
- **7/24 cevap veremez:** gece gelen WhatsApp mesajı sabaha kadar cevapsız kalır.

FlexHotel'in cevabı:
- **Tek sistem, tek doğruluk kaynağı.** Rezervasyondan muhasebeye kadar her şey aynı veritabanında, birbirine bağlı.
- **Hata yapısal olarak engellenir.** Çifte satış veritabanı kısıtıyla imkânsız; para hesapları kuruş kaçırmaz; her değişiklik iz bırakır.
- **Otonom + güvenli.** Aktörler rutini (oda atama, bildirim, kanal senkronu, AI ile misafir sohbeti) kendiliğinden yapar; para/risk içeren kararlar insan onayına düşer.

## 3. En büyük farklılaştırıcı: Otonom aktör ağı + güvenli insan onayı

Bu, rakip otel yazılımlarının **olmadığı** şeydir ve sunumun kalbi olmalı:

- Otelin her otomasyonu (oda atama, folyo açma, kanal güncelleme, bildirim, AI concierge) ayrı, **kapatılabilir bir "aktör"dür.**
- Bir aktörü panelden tek tıkla kapatırsan sistem durmaz — o işin görevi personelin "yapılacaklar" listesine düşer. **Otel, tüm aktörler kapalıyken de elle çalışır.** Aktörler işi hızlandırır, kilitlemez.
- Her aktörün "**kapatırsam ne durur**" etkisi panelde koda bakmadan görünür.
- AI veya otomasyon kritik bir karara geldiğinde (büyük ödeme, iade, overbooking, folyo iptali) işi bırakıp **insana sorar**; onaylanınca **tam kaldığı yerden, çift işleme olmadan** devam eder.

Teknik derinlik `01-MIMARI.md`'de.

## 4. Modül kapsam haritası — YAPILDI / YOL HARİTASI ⚠️

> **Bu tablo sunumun en önemli dürüstlük aracıdır.** Müşteriye modülleri anlatırken "tam" olanları özgüvenle göster; "kısmi" ve "yok" olanları "mimari hazır, yol haritasında" diye konumlandır. "Bitti" deyip gösterememek güveni yıkar.

Planlanan toplam **68 modül** var (bkz. kök `MODUL-SIRASI.md`). Bugüne kadar **47. modüle** kadar gelindi. Durum:

**Özet:** 32 modül **tam ve testli**, 3 modül **kısmi/altyapılı**, geri kalanı **yol haritasında**.

### Ön büro + operasyon (Modül 1–22)

| # | Modül | Durum |
|---|---|---|
| 1 | Ayarlar / parametreler (oda tipi, vergi, sezon, politika) | ✅ Tam |
| 2 | Kullanıcı, rol, yetki (RBAC) | ✅ Tam |
| 3 | Oda tipi müsaitlik & oda atama | ✅ Tam |
| 4 | Rezervasyon (tek / grup / bekleme listesi) | ✅ Tam |
| 5 | Oda planı / takvim (sürükle-bırak) | ✅ Tam |
| 6 | Check-in / Check-out | ✅ Tam |
| 7 | Misafir mesajları / istek takibi | ✅ Tam |
| 8 | WhatsApp / web chat ile konuşarak rezervasyon (AI) | ✅ Tam |
| 9 | Bildirim merkezi | ✅ Tam |
| 10 | Aktivite akışı + audit log + işlem zinciri | ✅ Tam |
| 11 | Onay kuyruğu (human-in-the-loop) | ✅ Tam |
| 12 | Aktör yönetim paneli (aç / kapa) | ✅ Tam |
| 13 | Günlük durum ekranı (doluluk, ADR, RevPAR) | ✅ Tam |
| 14 | Housekeeping / kat hizmetleri | ✅ Tam |
| 15 | Folyo yönetimi (harcama, böl/birleştir, iptal) | ✅ Tam |
| **16** | **Fatura kesme (folyo → fatura)** | ❌ Yol haritası (altyapı hazır: `folio.closed` + vergi dökümü var) |
| 17 | Ödeme alma (nakit / kart / döviz) | ✅ Tam |
| **18** | **Vardiya / kasa kapama (night audit)** | ❌ Yol haritası (altyapı hazır: kasa özeti + gün kilidi var) |
| 19 | Çamaşırhane & minibar takibi | ✅ Tam |
| **20** | **Teknik servis / arıza-bakım** | ❌ Yol haritası (altyapı hazır: oda arıza bloğu + görev köprüsü) |
| 21 | Kayıp eşya takibi | ✅ Tam |
| **22** | **CRM & misafir kartı / tercih geçmişi** | ❌ Yol haritası (altyapı hazır: mükerrer önleme + geçmişli arama) |

### Raporlama / satış / F&B / stok / muhasebe (Modül 23–47)

| # | Modül | Durum |
|---|---|---|
| 23 | Gelir raporları (RevPAR, ADR, doluluk) | ✅ Tam |
| **24** | **Doğal dil raporlama** | ⚠️ Kısmi — güvenli MCP yüzeyi var, sohbet ajanı yok |
| 25 | Forecast (30 günlük tahmin, pickup) | ✅ Tam |
| **26** | **Rapor tasarımcısı / Excel** | ⚠️ Kısmi — serbest tasarımcı yok, Excel yalnız bütçede |
| 27 | Bütçe yönetimi (sapma + AI yorum) | ✅ Tam |
| **28** | **Paket / pansiyon tipleri (BB, HB, AI)** | ❌ Yol haritası |
| 29 | Kontrat & acente yönetimi | ✅ Tam |
| **30** | **Grup & allotment yönetimi** | ❌ Yol haritası |
| 31 | Promosyon & kupon | ✅ Tam |
| **32** | **Online rezervasyon motoru (web widget)** | ❌ Yol haritası (`/quote` altyapısı var) |
| 33 | Kanal yönetimi / Channel Manager (OTA senkron) | ✅ Tam — **gerçek Channex.io** |
| **34** | **Dinamik fiyat / yield management** | ❌ Yol haritası (pricing-agent stub) |
| 35 | Acente bonus / sadakat | ✅ Tam |
| **36** | **Call center & satış CRM** | ❌ Yol haritası |
| 37 | Satış projeleri & banket / etkinlik | ✅ Tam |
| 38 | Menü & reçete yönetimi | ✅ Tam |
| 39 | Restoran POS (masa, adisyon) | ✅ Tam (en büyük modül) |
| **40** | **Mutfak ekranı (KDS)** | ❌ Yol haritası (POS olayları hazır) |
| 41 | Oda servisi (folyoya yansıtma, QR) | ✅ Tam |
| **42** | **Online paket sipariş** | ❌ Yol haritası |
| 43 | Banket F&B planlaması | ✅ Tam |
| **44** | **Stok & maliyet analizi (hareketli ortalama)** | ⚠️ Kısmi — giriş + ortalama maliyet var; çıkış/fire/sayım/transfer yok |
| 45 | Satın alma (talep → teklif → sipariş → mal kabul) | ✅ Tam |
| **46** | **Demirbaş & amortisman** | ❌ Yol haritası |
| 47 | Ön muhasebe (cari, kasa, banka, çek/senet, fiş) | ✅ Tam — grubun en zengini |

### Otonom aktörler — yazılmış vs placeholder

**Tam yazılmış ve gerçek (12 aktör):**
- Worker'lar (kural tabanlı): `reservation-worker`, `room-worker`, `housekeeping-worker`, `billing-worker`, `accounting-worker`, `channel-sync-worker`, `notification-worker`
- AI ajanları (LLM'li): `router-agent` (niyet), `concierge-agent` (misafir sohbeti + rezervasyon), `budget-agent` (bütçe yorumu)
- Kanal geçitleri (gerçek entegrasyon): `whatsapp-gateway` (Meta Cloud API), `webchat-gateway` (Socket.IO)

**Placeholder / stub (yol haritası — iskelet hazır, iş mantığı eklenecek):**
`fnb-worker`, `inventory-worker`, `pricing-agent` (dinamik fiyat AI), `report-agent` / `insight-agent` (sohbetle raporlama), `email-gateway`.

## 5. Mimari resmi (tek paragraf)

Kullanıcı (resepsiyon, misafir, OTA, restoran) bir işlem yapar → backend servisi işi veritabanına **tek transaction'da** yazar ve aynı anda bir **olay** üretir (`reservation.created`, `guest.checked_out`…) → olay, o olayı dinleyen **aktörlere** dağıtılır → her aktör kendi işini yapar (oda atama, folyo açma, bildirim, muhasebe kaydı, kanal güncelleme) ve yeni olaylar üretebilir → bir aktör kritik bir karara gelirse **onay kuyruğuna** yazar, insan onaylayınca kaldığı yerden devam eder → tüm bu zincir aynı `correlationId` ile **Aktivite ekranında tek ağaç** olarak izlenebilir.

## 6. Sunumda tekrarlanacak 5 mesaj

1. **"Tek sistem."** Rezervasyondan ön muhasebeye kadar her şey bağlı; tahsilat kendiliğinden muhasebeye düşer.
2. **"Hata yapısal olarak engellenir."** Çifte satış veritabanıyla imkânsız, para kuruş kaçırmaz, her şey iz bırakır.
3. **"Otonom ama kontrollü."** Dijital çalışanlar rutini yapar; para/risk kararında insan onayı devreye girer.
4. **"7/24 AI concierge."** WhatsApp/web chat'ten misafirle konuşup — sadece açık onayda — rezervasyon açar.
5. **"Gerçek entegrasyon."** Channel manager (Channex.io) ve AI (OpenAI) gerçek, mock değil.
