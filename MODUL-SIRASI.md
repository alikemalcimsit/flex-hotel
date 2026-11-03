# HotelOS — Modül Geliştirme Sırası

Tarih: 5 Eylül 2026
Sadece ürün modülleri (Elektraweb kapsamı). Altyapı işleri bu listede yok.
Numara = geliştirme sırası. Sağdaki etiket: hangi aktör destekliyor (yoksa manuel ekran).

---

## 1. ÖN BÜRO (temel)

| Sıra | Modül | Aktör |
|---|---|---|
| 1 | Ayarlar / parametreler (oda tipleri, vergiler, sezonlar) | manuel |
| 2 | Kullanıcı, rol, yetki (RBAC) | manuel |
| 3 | Oda tipi müsaitlik & oda atama | room-worker |
| 4 | Rezervasyon yönetimi (bireysel / grup / bekleyen liste) | reservation-worker |
| 5 | Oda planı / takvim | room-worker |
| 6 | Check-in / Check-out | reservation-worker + room-worker |
| 7 | Misafir mesajları / istek takibi | concierge-agent |
| 8 | WhatsApp / web chat ile konuşarak rezervasyon | concierge-agent |
| 9 | Bildirim merkezi | notification-worker |
| 10 | Aktör Activity Feed + audit log | sistem |
| 11 | Onay kuyruğu (human-in-the-loop) | sistem |
| 12 | Aktör yönetim paneli (aç / kapa) | sistem |
| 13 | Günlük durum ekranı (doluluk, gelir) | manuel |

## 2. ÖN BÜRO (operasyon + para)

| Sıra | Modül | Aktör |
|---|---|---|
| 14 | Housekeeping / kat hizmetleri | housekeeping-worker |
| 15 | Folyo yönetimi (harcama, bölme / birleştirme) | billing-worker |
| 16 | Fatura kesme (folyo → fatura) | billing-worker |
| 17 | Ödeme alma (nakit / kart / döviz) | billing-worker (onaylı) |
| 18 | Vardiya / kasa kapama (night audit) | billing-worker |
| 19 | Çamaşırhane & minibar takibi | manuel |
| 20 | Teknik servis / arıza-bakım | manuel |
| 21 | Kayıp eşya takibi | manuel |
| 22 | CRM & misafir kartı / tercih geçmişi | manuel |

## 3. RAPORLAMA

| Sıra | Modül | Aktör |
|---|---|---|
| 23 | Gelir raporları (RevPAR, ADR, doluluk) | report-agent |
| 24 | Doğal dil raporlama ("geçen ayın doluluğu") | report-agent |
| 25 | Günlük durum ekranı — forecast | report-agent |
| 26 | Rapor tasarımcısı + Excel import / export | manuel |
| 27 | Bütçe yönetimi (sapma raporları) | report-agent |

## 4. SATIŞ & DAĞITIM

| Sıra | Modül | Aktör |
|---|---|---|
| 28 | Paket / pansiyon tipleri (BB, HB, AI) | manuel |
| 29 | Kontrat & acente yönetimi | manuel |
| 30 | Grup & allotment yönetimi | manuel |
| 31 | Promosyon & kupon | manuel |
| 32 | Online rezervasyon motoru (web widget) | concierge-agent + reservation-worker |
| 33 | Kanal yönetimi / Channel Manager (OTA senkron) | channel-sync-worker |
| 34 | Dinamik fiyat / yield management | pricing-agent (onaylı) |
| 35 | Acente bonus / sadakat | manuel |
| 36 | Call center & satış CRM | manuel |
| 37 | Satış projeleri & banket / etkinlik | manuel |

## 5. F&B / POS

| Sıra | Modül | Aktör |
|---|---|---|
| 38 | Menü & reçete yönetimi | manuel |
| 39 | Restoran POS (masa, adisyon) | fnb-worker |
| 40 | Mutfak ekranı (KDS) | fnb-worker |
| 41 | Oda servisi (folyoya yansıtma) | fnb-worker + billing-worker |
| 42 | Online paket sipariş | fnb-worker |
| 43 | Banket F&B planlaması | manuel |

## 6. STOK & SATIN ALMA

| Sıra | Modül | Aktör |
|---|---|---|
| 44 | Stok & maliyet analizi (hareketli ortalama) | inventory-worker |
| 45 | Satın alma (talep → teklif → sipariş → irsaliye) | inventory-worker |
| 46 | Demirbaş & amortisman | manuel |

## 7. MUHASEBE / ERP

| Sıra | Modül | Aktör |
|---|---|---|
| 47 | Ön muhasebe (cari, kasa, banka, çek / senet) | accounting-worker |
| 48 | Genel muhasebe (hesap planı, fişler, mizan) | accounting-worker |
| 49 | e-Fatura / e-Arşiv / e-Defter | entegrasyon |
| 50 | Sanal POS / ödeme geçidi | entegrasyon |
| 51 | Personel & bordro | manuel |
| 52 | İK (izin, mesai, özlük) | manuel |

## 8. MİSAFİR DENEYİMİ

| Sıra | Modül | Aktör |
|---|---|---|
| 53 | Temassız: online check-in, QR menü, dijital anahtar | concierge-agent |
| 54 | Misafir yorum entegrasyonu + duygu analizi | insight-agent |
| 55 | Anket & memnuniyet | notification-worker + insight-agent |
| 56 | Sadakat programı | manuel |
| 57 | SPA & spor salonu randevu | manuel |

## 9. YASAL & ENTEGRASYON

| Sıra | Modül | Aktör |
|---|---|---|
| 58 | Emniyet kimlik bildirimi (KBS) | entegrasyon |
| 59 | Kimlik / pasaport okuma (OCR) | entegrasyon |
| 60 | Çoklu dil & çoklu para birimi | sistem |
| 61 | Webhook & açık API | sistem |
| 62 | Donanım entegrasyonları (kapı kilidi, santral, POS cihazı) | entegrasyon |
| 63 | Multi-tenant çoklu otel / zincir konsolu | sistem |

## 10. DİKEY PAKETLER

| Sıra | Modül |
|---|---|
| 64 | Apart / rezidans yönetimi |
| 65 | Yurt yönetimi |
| 66 | Devremülk |
| 67 | Marina |
| 68 | Klinik |

---

## Neden bu sıra
- **1-13:** Otelin çalışması için asgari şey: oda, rezervasyon, giriş-çıkış. Concierge burada çünkü projenin farkı bu, erken görünmeli.
- **14-22:** Para ve operasyon. Folyo olmadan fatura, fatura olmadan muhasebe olmaz.
- **23-27:** Veri birikince rapor anlamlı olur.
- **28-37:** Satış tarafı. Fiyat planı olmadan kanal senkronu ve dinamik fiyat olmaz.
- **38-46:** Restoran ve stok. Oda servisi folyoya, reçete stoğa bağlı.
- **47-52:** Muhasebe en sonda çünkü tüm para hareketleri (folyo, POS, satın alma) oturmuş olmalı.
- **53-57:** Misafir deneyimi, mevcut modüllerin üstüne katman.
- **58-63:** Yasal zorunluluklar ve entegrasyonlar; pilot otele girmeden önce.
- **64-68:** Aynı çekirdeğe takılan sektör paketleri. Apart en yakın olduğu için ilk.

---

# FLEXAI 2.0 (1–68 bittikten sonra)

Tarih: 3 Kasım 2026
Mimari ve yol haritası: `FLEXAI-2.0.md`. Görev maddeleri: `GOREVLER.md` → "FLEXAI 2.0".
1.0'dan farkı: ürünü kusursuz yapan altyapı işleri de (69–73) numaralı modüldür.

## 11. SAĞLAM ZEMİN

| Sıra | Modül | Aktör |
|---|---|---|
| 69 | Göç sihirbazı (başka PMS'ten taşıma, mutabakat) + uzun iş çerçevesi | sistem |
| 70 | Kesintisiz çalışma (sürekli yedek, felaket kurtarma, çevrimdışı ön büro) | sistem |
| 71 | Güvenlik ve kimlik (2FA, SSO, oturumlar, platform hesabı, KVKK altyapısı) | sistem |
| 72 | Gözlem, yayın ve paketleme (metrik, durum sayfası, özellik bayrakları, modül kataloğu ve lisans) | sistem |
| 73 | Mobil temel (PWA kabuk, anlık bildirim, çevrimdışı kuyruk) | notification-worker |
| 74 | Yazarkasa (ÖKC) ve e-Adisyon | fnb-worker + entegrasyon |

## 12. SAHİP VE OKUL

| Sıra | Modül | Aktör |
|---|---|---|
| 75 | Patron uygulaması | notification-worker |
| 76 | Personel mobil uygulaması | mevcut aktörler |
| 77 | FlexAI Akademi (eğitim oteli, senaryo, puanlama, sertifika) | academy-worker + ajan |
| 78 | Staj ve kariyer ağı (+ denetimli işlem) | manuel |
| 79 | Uygulama içi yardım ve destek (+ bilgi bankası) | assistant-agent |

## 13. LÜKS MİSAFİR DENEYİMİ

| Sıra | Modül | Aktör |
|---|---|---|
| 80 | Misafir tanıma ve kişiselleştirme | insight-agent + guest-experience-worker |
| 81 | Servis kurtarma (misafir ilişkileri) | guest-experience-worker + insight-agent |
| 82 | Concierge ve butler masası (+ uçuş takibi) | guest-experience-worker |
| 83 | Upsell ve oda özelliği satışı | guest-experience-worker |
| 84 | Ödeme güvencesi, hediye çeki ve üyelik | billing-worker + entegrasyon |

## 14. OTONOM OPERASYON

| Sıra | Modül | Aktör |
|---|---|---|
| 85 | Otomasyon stüdyosu (+ misafir yolculuğu) | automation-worker |
| 86 | İşlem yapan yapay zekâ asistanı + uzaktan MCP | assistant-agent |
| 87 | Yapay zekâ gece müdürü ve sabah brifingi | night-manager-agent |
| 88 | İşgücü planlama | sistem + housekeeping-worker |
| 89 | Akıllı oda ve enerji (GRMS, sayaçlar) | cihaz aktörü (62) + room-worker |

## 15. GELİR VE KÂRLILIK

| Sıra | Modül | Aktör |
|---|---|---|
| 90 | No-show tahmini ve grup değerlendirme | sistem (model) + pricing-agent |
| 91 | Rakip fiyat izleme | rate-shop-worker + pricing-agent |
| 92 | Kontrat ve pansiyon kârlılığı | accounting-worker |
| 93 | USALI kâr-zarar ve sahip raporu | accounting-worker + budget-agent |

## 16. UYUM VE FİNANS OTOMASYONU

| Sıra | Modül | Aktör |
|---|---|---|
| 94 | Uyum merkezi (vergi, KBS, KVKK, İYS, ruhsatlar) | compliance-worker |
| 95 | Gelen e-belge ve üçlü eşleştirme | entegrasyon + inventory-worker |
| 96 | Dış muhasebe aktarımı (Logo, Mikro, Netsis, Luca) | accounting-worker + entegrasyon |
| 97 | Banka mutabakatı | bank-sync-worker + accounting-worker |

## 17. RESORT VE DAĞITIM

| Sıra | Modül | Aktör |
|---|---|---|
| 98 | Tur operatörü bağlantısı (+ voucher okuma) | tour-operator-sync-worker + voucher-reader-agent |
| 99 | Tesis ve aktivite rezervasyonu (à la carte, kabana, mini kulüp) | guest-experience-worker |
| 100 | Acente B2B portalı | reservation-worker |
| 101 | Sesli yapay zekâ santral | voice-gateway + concierge-agent |

## 18. KALİTE, ÇEVRE, AĞ

| Sıra | Modül | Aktör |
|---|---|---|
| 102 | Kalite ve standart denetimi (DÖF, doküman yönetimi, HACCP) | insight-agent + notification-worker |
| 103 | Sürdürülebilirlik (karbon, belgelendirme, misafir dengelemesi) | manuel + entegrasyon |
| 104 | Anonim pazar karşılaştırması | sistem |

---

## Neden bu sıra (2.0)
- **69-74:** İlk gerçek otel taşınmadan önce: veri eksiksiz gelsin, kaybolmasın, güvende olsun, hata görünsün, yeni özellik kontrollü açılsın, restoranın mali fişi yasal olsun. Mobil kabuk iki hattın mobil modüllerinden önce tek yerde kurulur.
- **75-79:** Satın alan sahip ve kalıcı kanal okul. Akademi yardım içeriğini besler.
- **80-84:** Lüks otelin farkı: misafiri tanımak, sorunu çıkıştan önce çözmek, misafire doğru anda doğru teklifi yapmak, ödemeyi güvenceye almak.
- **85-89:** Kural motoru ve bilgi bankası hazır olunca yapay zekâ iş yapmaya ve sapmayı kendiliğinden yakalamaya başlar.
- **90-93:** Gece kapanışı özet tabloları ve maliyet verisi (88, 89) oturunca kârlılık anlamlı olur.
- **94-97:** Mutabakat ve yasal iş, çekirdeğin bütün para hareketleri 2.0'da da oturduktan sonra otomatikleşir.
- **98-101:** Resort ve B2B dağıtım. Hedef genel ve büyük ölçek; sıra sabit.
- **102-104:** Ölçme ve kıyaslama; karşılaştırma ağ büyüdükçe değer kazanır, en sona.
