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
