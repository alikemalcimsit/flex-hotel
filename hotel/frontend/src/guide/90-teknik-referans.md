# Teknik referans (otomatik)

> Bu bölüm **koddan üretilir**; elle düzenlenmez. Her derlemede (`npm run build`) ve geliştirme sunucusu açılışında yenilenir: menüye sayfa, sisteme izin, olay, aktör, zamanlanmış iş ya da tablo eklendiğinde burada kendiliğinden görünür. Anlatım için soldaki diğer bölümlere bakın.

## Menü haritası

Sol menüdeki her sayfa, yolu ve görmek için gereken izin. Bir sayfa menüde yoksa ya izniniz yoktur ya da sayfa başka bir sayfadan (bağlantıyla) açılır.

### Genel

| Sayfa | Yol | Kim görür |
| --- | --- | --- |
| **Panel** | `/` | herkes (giriş yapmış) |
| **Görevler** | `/gorevler` | şunlardan biri: Oda işlemleri (atama, durum); Bildirim ayarlarını yönet; Rezervasyonları yönet; Onayla / reddet; Mesaj yaz / yönet; Folyoya harcama işle, aktar, böl, birleştir; Tahsilat / ödeme / virman fişi gir, çek / senet işlemleri, cari kartı aç ve düzenle; Temizlik görevini başlat / bitir, sorun bildir; Gelir raporlarını görüntüle (doluluk, ADR, RevPAR); Depo tanımları, minimum stok seviyesi, elle hareket (çıkış / fire / transfer), sayım, satış noktası → depo eşlemesi; Sadakat programı ayarları ve seviyeler, elle puan düzeltmesi; Hatalı KBS bildirimini tekrar gönder, elle bildirildi olarak işaretle; Ayarları yönet |
| **Kılavuz** | `/kilavuz` | herkes (giriş yapmış) |

### Ön büro

| Sayfa | Yol | Kim görür |
| --- | --- | --- |
| **Giriş / çıkış** | `/on-buro` | Giriş / çıkış listelerini görüntüle |
| ↳ Gelecekler | `/on-buro/gelecekler` | üst menüyle aynı |
| ↳ Gidecekler | `/on-buro/gidecekler` | üst menüyle aynı |
| ↳ Konaklayanlar | `/on-buro/konaklayanlar` | üst menüyle aynı |
| ↳ Online check-in | `/on-buro/online-check-in` | Online check-in'leri ve belge fotoğraflarını gör, misafir portalı bağlantısını gör |
| **Rezervasyonlar** | `/rezervasyonlar` | Rezervasyonları görüntüle |
| ↳ Liste | `/rezervasyonlar/liste` | üst menüyle aynı |
| ↳ Yeni rezervasyon | `/rezervasyonlar/yeni` | Rezervasyonları yönet |
| ↳ Bekleme listesi | `/rezervasyonlar/bekleme-listesi` | üst menüyle aynı |
| ↳ Gruplar | `/gruplar` | üst menüyle aynı |
| **Oda planı** | `/oda-plani` | herkes (giriş yapmış) |
| **Misafirler** | `/misafirler` | Misafir kartlarını görüntüle (CRM) |
| **Sadakat** | `/sadakat` | Sadakat üyelerini, puan bakiyesini ve hareketlerini görüntüle |
| **KBS** | `/kbs` | KBS kimlik bildirimlerini ve mutabakatı görüntüle |
| **Satış CRM** | `/satis` | Satış fırsatlarını, arama kayıtlarını ve teklifleri görüntüle |
| **Folyolar** | `/folyolar` | Folyoları görüntüle |
| **Kasa** | `/kasa` | şunlardan biri: Kasayı görüntüle; Günlük döviz kurunu gir |
| ↳ Günlük kasa | `/kasa/gun` | Kasayı görüntüle |
| ↳ Döviz kurları | `/kasa/kurlar` | üst menüyle aynı |
| **Sanal POS** | `/sanal-pos` | Sanal POS ödeme linklerini ve işlemlerini görüntüle |
| **Minibar & çamaşır** | `/ek-hizmetler` | şunlardan biri: Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle; Minibar tüketimi gir; Çamaşır siparişi al, durumunu güncelle; Minibar / çamaşır fiyat listelerini yönet |
| ↳ Minibar girişi | `/ek-hizmetler/minibar` | Minibar tüketimi gir |
| ↳ Minibar kayıtları | `/ek-hizmetler/minibar-kayitlari` | Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle |
| ↳ Çamaşırhane | `/ek-hizmetler/camasir` | Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle |
| ↳ Günlük rapor | `/ek-hizmetler/rapor` | Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle |
| ↳ Fiyat listeleri | `/ek-hizmetler/fiyatlar` | Minibar / çamaşır fiyat listelerini yönet |
| **Kat hizmetleri** | `/kat-hizmetleri` | Kat hizmeti görevlerini ve haritayı görüntüle |
| ↳ Görev panosu | `/kat-hizmetleri/gorevler` | üst menüyle aynı |
| ↳ Görevlerim | `/kat-hizmetleri/gorevlerim` | Temizlik görevini başlat / bitir, sorun bildir |
| ↳ Kontrol | `/kat-hizmetleri/kontrol` | Temizlenen odayı kontrol et (onay / ret) |
| ↳ Kat haritası | `/kat-hizmetleri/harita` | üst menüyle aynı |
| **Kayıp eşya** | `/kayip-esya` | Kayıp eşyaları görüntüle |
| **Teknik servis** | `/teknik-servis` | Arıza / bakım taleplerini görüntüle |
| ↳ Arızalar | `/teknik-servis` | üst menüyle aynı |
| ↳ Bana atananlar | `/teknik-servis/benim` | üst menüyle aynı |
| ↳ Planlama | `/teknik-servis/planlama` | Arıza atama / iptal, odayı arızaya alma, bakım planı |
| **Raporlar** | `/raporlar` | şunlardan biri: Gelir raporlarını görüntüle (doluluk, ADR, RevPAR); Rapor asistanına soru sor (AI), raporu kaydet ve paylaş |
| ↳ Gelir raporları | `/raporlar/gelir` | Gelir raporlarını görüntüle (doluluk, ADR, RevPAR) |
| ↳ Rapor asistanı | `/raporlar/asistan` | Rapor asistanına soru sor (AI), raporu kaydet ve paylaş |
| ↳ Rapor tasarımcısı | `/raporlar/tasarim` | Gelir raporlarını görüntüle (doluluk, ADR, RevPAR) |
| ↳ Kayıtlı raporlar | `/raporlar/kayitli` | Gelir raporlarını görüntüle (doluluk, ADR, RevPAR) |
| **Gün kapanış** | `/gun-kapanis` | Gün kapanışını ve günlük özeti görüntüle |
| ↳ Kapanış | `/gun-kapanis` | üst menüyle aynı |
| ↳ Geçmiş | `/gun-kapanis/gecmis` | üst menüyle aynı |
| **Bütçe** | `/butce/plan` | Bütçeyi ve sapma raporunu görüntüle |
| **Acenteler** | `/acenteler` | Acente, kontrat fiyatı ve cari özetini görüntüle |
| **Acente primleri** | `/acente-primleri` | Acente hedef / prim kurallarını, ilerlemeyi ve hak ediş raporunu görüntüle |
| **Etkinlikler** | `/etkinlikler` | Etkinlik dosyalarını, salon takvimini, belgeleri ve ödemeleri görüntüle |
| **Restoran** | `/pos` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; POS: vardiya raporlarını ve kapanmış adisyonları görüntüle; POS: satış noktası, masa, menü ve politikayı düzenle |
| ↳ Masa planı | `/pos/masalar` | POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz |
| ↳ Mutfak ekranı | `/pos/mutfak-ekrani` | POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz |
| ↳ Oda servisi | `/pos/oda-servisi` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; POS: vardiya raporlarını ve kapanmış adisyonları görüntüle |
| ↳ Paket servis | `/pos/paket` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; POS: vardiya raporlarını ve kapanmış adisyonları görüntüle |
| ↳ Adisyonlar | `/pos/adisyonlar` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; POS: vardiya raporlarını ve kapanmış adisyonları görüntüle |
| ↳ Vardiyalar | `/pos/vardiyalar` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; POS: vardiya raporlarını ve kapanmış adisyonları görüntüle |
| ↳ Satış raporu | `/pos/rapor` | POS: vardiya raporlarını ve kapanmış adisyonları görüntüle |
| ↳ Menü ve tanımlar | `/pos/tanimlar` | POS: satış noktası, masa, menü ve politikayı düzenle |
| **Promosyonlar** | `/promosyonlar` | Promosyonları, kuponları ve kullanım raporunu görüntüle |
| **Kanallar** | `/kanallar` | Kanalları, senkron logunu ve kanal rezervasyonlarını görüntüle |
| **Mesajlar** | `/mesajlar` | Mesajları görüntüle |
| **İstekler** | `/istekler` | İstekleri görüntüle |
| **Anketler** | `/anketler` | Anket cevaplarını, NPS raporunu, takipleri ve AI özetlerini gör |
| **Yorumlar** | `/yorumlar` | Misafir yorumlarını, AI etiketlerini ve trendi görüntüle |
| **Spa** | `/spa` | Spa takvimini, randevuları, dersleri ve raporu gör |
| **Mutfak** | `/mutfak` | Reçeteleri, malzeme kartlarını, maliyet ve kâr marjını görüntüle |
| ↳ Reçeteler | `/mutfak` | üst menüyle aynı |
| ↳ Malzeme kartları | `/mutfak/malzemeler` | üst menüyle aynı |
| **Satın alma** | `/satin-alma` | Satın alma taleplerini görüntüle |
| ↳ Talepler | `/satin-alma/talepler` | üst menüyle aynı |
| ↳ Teklif turları | `/satin-alma/teklif-turlari` | üst menüyle aynı |
| ↳ Siparişler | `/satin-alma/siparisler` | üst menüyle aynı |
| ↳ Mal kabul | `/satin-alma/mal-kabul` | üst menüyle aynı |
| ↳ Tedarikçiler | `/satin-alma/tedarikciler` | üst menüyle aynı |
| **Stok** | `/stok` | Stok mevcudu, hareketleri ve stok değerini görüntüle |
| ↳ Mevcut | `/stok` | üst menüyle aynı |
| ↳ Hareketler | `/stok/hareketler` | üst menüyle aynı |
| ↳ Sayım | `/stok/sayim` | üst menüyle aynı |
| ↳ Maliyet raporu | `/stok/maliyet` | üst menüyle aynı |
| ↳ Depolar | `/stok/depolar` | üst menüyle aynı |
| **Demirbaş** | `/demirbas` | şunlardan biri: Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle; Demirbaş sayımında etiket okut |
| ↳ Demirbaşlar | `/demirbas` | Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle |
| ↳ Sayım | `/demirbas/sayim` | Demirbaş sayımında etiket okut |
| ↳ Amortisman | `/demirbas/amortisman` | Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle |
| ↳ Garanti | `/demirbas/garanti` | Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle |
| ↳ Tanımlar | `/demirbas/tanimlar` | Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle |
| **Faturalar** | `/faturalar` | Faturalanacakları, faturaları, PDF'leri ve GİB durumunu görüntüle |
| ↳ Faturalanacaklar | `/faturalar/faturalanacaklar` | üst menüyle aynı |
| ↳ Taslaklar | `/faturalar/taslaklar` | üst menüyle aynı |
| ↳ Kesilenler | `/faturalar/liste` | üst menüyle aynı |
| **Personel** | `/personel` | şunlardan biri: Personel listesini ve kartlarını görüntüle (ücret hariç); Ücretleri, bordroları, pusulaları ve çıktıları görüntüle |
| **Bordro** | `/bordro` | Ücretleri, bordroları, pusulaları ve çıktıları görüntüle |
| ↳ Bordrolar | `/bordro` | üst menüyle aynı |
| ↳ Puantaj ve kalemler | `/bordro/puantaj` | üst menüyle aynı |
| ↳ Servis payı | `/bordro/servis-payi` | üst menüyle aynı |
| ↳ Ayarlar | `/bordro/ayarlar` | üst menüyle aynı |
| **İK** | `/ik` | İzinler ve bakiyeler, vardiya çizelgesi, günlük puantaj ve özlük belgelerini görüntüle |
| ↳ İzinler | `/ik/izinler` | üst menüyle aynı |
| ↳ Vardiya | `/ik/vardiya` | üst menüyle aynı |
| ↳ Puantaj | `/ik/puantaj` | üst menüyle aynı |
| ↳ Belgeler | `/ik/belgeler` | üst menüyle aynı |
| **İzinlerim** | `/ik/benim` | Kendi izin talebini gir; kendi izinlerini, bakiyesini ve vardiyalarını gör |
| **Ön muhasebe** | `/muhasebe` | Cariler ve ekstre, kasa / banka hareketleri, çek / senet portföyü ve fişleri görüntüle |
| ↳ Cariler | `/muhasebe/cariler` | üst menüyle aynı |
| ↳ Kasa / banka | `/muhasebe/kasa-banka` | üst menüyle aynı |
| ↳ Çek / senet | `/muhasebe/cek-senet` | üst menüyle aynı |
| ↳ Fişler | `/muhasebe/fisler` | üst menüyle aynı |
| **Genel muhasebe** | `/genel-muhasebe` | Hesap planı, yevmiye fişleri, mizan ve hesap ekstresini görüntüle |
| ↳ Mizan | `/genel-muhasebe/mizan` | üst menüyle aynı |
| ↳ Yevmiye | `/genel-muhasebe/yevmiye` | üst menüyle aynı |
| ↳ Hesap planı | `/genel-muhasebe/hesap-plani` | üst menüyle aynı |
| **Toplanacak tepsiler** | `/oda-servisi/tepsiler` | şunlardan biri: POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz; İstekleri yönet |
| **Odalar** | `/odalar` | herkes (giriş yapmış) |
| ↳ Oda listesi | `/odalar/liste` | üst menüyle aynı |
| ↳ Müsaitlik | `/odalar/musaitlik` | üst menüyle aynı |
| ↳ Oda atama | `/odalar/atama` | üst menüyle aynı |

### Yönetim

| Sayfa | Yol | Kim görür |
| --- | --- | --- |
| **Onaylar** | `/onaylar` | Onay kuyruğunu görüntüle |
| ↳ Bekleyen | `/onaylar/bekleyen` | üst menüyle aynı |
| ↳ Geçmiş | `/onaylar/gecmis` | üst menüyle aynı |
| **Fiyat önerileri** | `/fiyat-onerileri` | Onay kuyruğunu görüntüle |
| **Bildirimler** | `/bildirimler` | Bildirimleri görüntüle |
| ↳ Gönderim geçmişi | `/bildirimler/gecmis` | üst menüyle aynı |
| ↳ Şablonlar | `/bildirimler/sablonlar` | Bildirim ayarlarını yönet |
| ↳ Kanallar | `/bildirimler/kanallar` | Bildirim ayarlarını yönet |
| **Aktivite** | `/aktivite` | Aktivite akışını ve zincirleri görüntüle |
| ↳ Canlı akış | `/aktivite/akis` | üst menüyle aynı |
| ↳ Olaylar | `/aktivite/olaylar` | üst menüyle aynı |
| ↳ Denetim kaydı | `/aktivite/denetim` | Denetim kaydını görüntüle |
| **Excel'den yükle** | `/ice-aktar` | şunlardan biri: Misafir kartı düzenle, tercih / not / etiket; Ayarları yönet |
| **Entegrasyon** | `/entegrasyonlar` | API uygulamalarını, anahtar listesini, webhook aboneliklerini ve teslimat logunu görüntüle |
| ↳ Uygulamalar | `/entegrasyonlar/uygulamalar` | üst menüyle aynı |
| ↳ Webhook teslimatları | `/entegrasyonlar/teslimatlar` | üst menüyle aynı |
| **Aktörler** | `/aktorler` | Aktör panelini görüntüle |
| **Ayarlar** | `/ayarlar` | herkes (giriş yapmış) |
| ↳ Otel bilgileri | `/ayarlar/otel` | üst menüyle aynı |
| ↳ Oda tipleri | `/ayarlar/oda-tipleri` | üst menüyle aynı |
| ↳ Vergiler | `/ayarlar/vergiler` | üst menüyle aynı |
| ↳ Sezonlar | `/ayarlar/sezonlar` | üst menüyle aynı |
| ↳ Fiyat planları | `/ayarlar/fiyat-planlari` | üst menüyle aynı |
| ↳ Paketler | `/ayarlar/paketler` | üst menüyle aynı |
| ↳ Dinamik fiyat | `/ayarlar/dinamik-fiyat` | üst menüyle aynı |
| ↳ Genel parametreler | `/ayarlar/genel` | üst menüyle aynı |
| ↳ Kullanıcılar | `/ayarlar/kullanicilar` | Kullanıcıları görüntüle |
| ↳ Roller & İzinler | `/ayarlar/roller` | Rolleri ve izinleri yönet |
| ↳ AI asistanı | `/ayarlar/ai` | Ayarları görüntüle |
| ↳ Mesaj kanalları | `/ayarlar/mesaj-kanallari` | Ayarları görüntüle |

## İzinler ve roller

Sistemde 135 izin var; roller bu izinlerin varsayılan paketleridir. Yönetici (Ayarlar → Kullanıcılar / roller) bir kullanıcıya izin ekleyip çıkarabilir. Aşağıdaki tablo **varsayılan** dağılımdır.

### Ayarlar

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `settings.view` | Ayarları görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `settings.manage` | Ayarları yönet | ✓ |  |  |  |  |  |

### Odalar

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rooms.view` | Odaları görüntüle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `rooms.manage` | Oda envanterini yönet | ✓ | ✓ |  |  |  |  |
| `rooms.operate` | Oda işlemleri (atama, durum) | ✓ | ✓ | ✓ | ✓ |  |  |

### Rezervasyonlar

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reservations.view` | Rezervasyonları görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `reservations.manage` | Rezervasyonları yönet | ✓ | ✓ | ✓ |  |  |  |
| `reservations.price_override` | Fiyatı elle belirle | ✓ | ✓ |  |  |  |  |

### Giriş / çıkış

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stays.view` | Giriş / çıkış listelerini görüntüle | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `stays.manage` | Giriş / çıkış yap | ✓ | ✓ | ✓ |  |  |  |
| `stays.checkout_open_balance` | Bakiyesi kapanmadan çıkışa izin ver | ✓ | ✓ |  |  |  |  |

### Misafir iletişimi

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.view` | Mesajları görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `messages.reply` | Mesaj yaz / yönet | ✓ | ✓ | ✓ |  |  |  |
| `requests.view` | İstekleri görüntüle | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `requests.manage` | İstekleri yönet | ✓ | ✓ | ✓ | ✓ |  | ✓ |

### Bildirimler

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `notifications.view` | Bildirimleri görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `notifications.manage` | Bildirim ayarlarını yönet | ✓ | ✓ |  |  |  |  |

### Onaylar

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `approvals.view` | Onay kuyruğunu görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `approvals.decide` | Onayla / reddet | ✓ | ✓ |  |  |  |  |

### Yönetim

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `users.view` | Kullanıcıları görüntüle | ✓ | ✓ |  |  |  |  |
| `users.manage` | Kullanıcıları yönet | ✓ |  |  |  |  |  |
| `roles.manage` | Rolleri ve izinleri yönet | ✓ |  |  |  |  |  |

### Günlük durum

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard.view` | Günlük durumu görüntüle (doluluk, gelir) | ✓ | ✓ |  |  | ✓ |  |
| `forecast.manage` | Tahminin kritik gün eşiklerini ayarla | ✓ | ✓ |  |  |  |  |

### Folyo

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `folio.view` | Folyoları görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `folio.post` | Folyoya harcama işle, aktar, böl, birleştir | ✓ | ✓ | ✓ |  | ✓ |  |
| `folio.adjust` | İndirim uygula, kapanmış folyoyu yeniden aç | ✓ | ✓ |  |  | ✓ |  |

### Ödeme ve kasa

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `payment.receive` | Ödeme al (tahsilat, ön ödeme) | ✓ | ✓ | ✓ |  | ✓ |  |
| `payment.refund` | İade / ödeme iptali iste (onaya gider) | ✓ | ✓ | ✓ |  | ✓ |  |
| `cash.view` | Kasayı görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `exchange_rates.manage` | Günlük döviz kurunu gir | ✓ | ✓ |  |  | ✓ |  |

### Minibar ve çamaşır

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extras.view` | Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `minibar.post` | Minibar tüketimi gir | ✓ | ✓ | ✓ | ✓ |  |  |
| `laundry.post` | Çamaşır siparişi al, durumunu güncelle | ✓ | ✓ | ✓ | ✓ |  |  |
| `extras.manage` | Minibar / çamaşır fiyat listelerini yönet | ✓ | ✓ |  |  | ✓ |  |

### Kat hizmetleri

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `housekeeping.view` | Kat hizmeti görevlerini ve haritayı görüntüle | ✓ | ✓ | ✓ | ✓ |  |  |
| `housekeeping.operate` | Temizlik görevini başlat / bitir, sorun bildir | ✓ | ✓ |  | ✓ |  |  |
| `housekeeping.manage` | Temizlik görevi aç, ata, iptal et | ✓ | ✓ |  | ✓ |  |  |
| `housekeeping.inspect` | Temizlenen odayı kontrol et (onay / ret) | ✓ | ✓ |  | ✓ |  |  |

### Kayıp eşya

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lost_items.view` | Kayıp eşyaları görüntüle | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `lost_items.record` | Bulunan eşya kaydet | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `lost_items.release` | Kayıp eşyayı misafirle eşleştir, teslim et | ✓ | ✓ | ✓ |  |  |  |
| `lost_items.manage` | Sahibi çıkmayan eşyayı kapat, saklama süresini ayarla | ✓ | ✓ |  |  |  |  |

### Raporlar

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reports.view` | Gelir raporlarını görüntüle (doluluk, ADR, RevPAR) | ✓ | ✓ |  |  | ✓ |  |
| `reports.ask` | Rapor asistanına soru sor (AI), raporu kaydet ve paylaş | ✓ | ✓ |  |  | ✓ |  |

### Gün kapanış

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `night_audit.view` | Gün kapanışını ve günlük özeti görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `night_audit.close` | Günü kapat (night audit) | ✓ | ✓ | ✓ |  |  |  |

### Teknik servis

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `maintenance.view` | Arıza / bakım taleplerini görüntüle | ✓ | ✓ | ✓ | ✓ |  |  |
| `maintenance.operate` | Arıza bileti aç, başla, çöz, fotoğraf ekle | ✓ | ✓ | ✓ | ✓ |  |  |
| `maintenance.manage` | Arıza atama / iptal, odayı arızaya alma, bakım planı | ✓ | ✓ |  |  |  |  |

### Misafir CRM

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `guests.view` | Misafir kartlarını görüntüle (CRM) | ✓ | ✓ | ✓ |  |  |  |
| `guests.manage` | Misafir kartı düzenle, tercih / not / etiket | ✓ | ✓ | ✓ |  |  |  |
| `guests.merge` | Mükerrer misafir kartlarını birleştir | ✓ | ✓ | ✓ |  |  |  |

### Bütçe

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `budget.view` | Bütçeyi ve sapma raporunu görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `budget.manage` | Bütçe taslağını, gider kalemlerini ve gerçekleşen giderleri düzenle | ✓ | ✓ |  |  | ✓ |  |
| `budget.approve` | Bütçeyi onayla ve revize aç | ✓ | ✓ |  |  |  |  |

### Acente ve kontrat

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agencies.view` | Acente, kontrat fiyatı ve cari özetini görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `agencies.manage` | Acente kartı ve kontratı düzenle (fiyat, stop-sale, satışa aç) | ✓ | ✓ |  |  |  |  |

### Satış CRM

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sales.view` | Satış fırsatlarını, arama kayıtlarını ve teklifleri görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `sales.manage` | Fırsat ve arama kaydı aç, teklif hazırla / gönder / sonuçlandır | ✓ | ✓ | ✓ |  |  |  |

### Promosyon ve kupon

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `promotions.view` | Promosyonları, kuponları ve kullanım raporunu görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `promotions.manage` | Promosyon aç, düzenle, yayına al; kupon üret ve kapat | ✓ | ✓ |  |  |  |  |

### Banket ve etkinlik

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `banquet.view` | Etkinlik dosyalarını, salon takvimini, belgeleri ve ödemeleri görüntüle | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `banquet.manage` | Etkinlik aç, opsiyonla, kesinleştir, iptal et; teklif / sözleşme / proforma üret | ✓ | ✓ |  |  |  |  |
| `banquet.setup` | Salon, ekipman, fiyat ve banket politikasını düzenle | ✓ | ✓ |  |  |  |  |
| `banquet.payment` | Etkinlik depozitosu / ödemesi al, iade ve iptal iste | ✓ | ✓ | ✓ |  | ✓ |  |

### Restoran POS ve menü

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pos.operate` | POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz | ✓ | ✓ |  |  |  | ✓ |
| `pos.supervise` | POS: ikram, indirim, gönderilmiş kalemi iptal et, adisyonu devret / yeniden aç, ürünü tükendi yap | ✓ | ✓ |  |  |  |  |
| `pos.setup` | POS: satış noktası, masa, menü ve politikayı düzenle | ✓ | ✓ |  |  |  |  |
| `pos.report` | POS: vardiya raporlarını ve kapanmış adisyonları görüntüle | ✓ | ✓ |  |  | ✓ |  |

### Reçete ve maliyet

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `recipes.view` | Reçeteleri, malzeme kartlarını, maliyet ve kâr marjını görüntüle | ✓ | ✓ |  |  | ✓ | ✓ |
| `recipes.manage` | Reçete ve malzeme kartı düzenle (satır, fire, birim maliyet, alerjen) | ✓ | ✓ |  |  |  |  |

### Satın alma

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `purchasing.view` | Satın alma taleplerini görüntüle | ✓ | ✓ |  |  | ✓ | ✓ |
| `purchasing.request` | Satın alma talebi aç (banket, elle, minimum stok) ve iptal et | ✓ | ✓ |  |  |  | ✓ |
| `purchasing.manage` | Tedarikçi, teklif turu, kazanan seçimi / sipariş, sipariş iptali, satın alma politikası | ✓ | ✓ |  |  |  |  |
| `purchasing.receive` | Mal kabul / irsaliye gir (stok girer) | ✓ | ✓ |  |  |  | ✓ |

### Stok ve depo

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stock.view` | Stok mevcudu, hareketleri ve stok değerini görüntüle | ✓ | ✓ |  |  | ✓ | ✓ |
| `stock.manage` | Depo tanımları, minimum stok seviyesi, elle hareket (çıkış / fire / transfer), sayım, satış noktası → depo eşlemesi | ✓ | ✓ |  |  |  |  |

### Demirbaş

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `assets.view` | Demirbaşları, hareketlerini, amortisman tablosunu ve garanti listesini görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `assets.count` | Demirbaş sayımında etiket okut | ✓ | ✓ |  |  | ✓ |  |
| `assets.manage` | Demirbaş kartı aç / düzelt, Excel ile yükle, taşı, zimmetle, etiket bas, sayım aç / kapat, tanımlar | ✓ | ✓ |  |  | ✓ |  |
| `assets.finance` | Yıl amortismanını kaydet / geri al, demirbaşı elden çıkar | ✓ | ✓ |  |  | ✓ |  |

### Ön muhasebe

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `accounting.view` | Cariler ve ekstre, kasa / banka hareketleri, çek / senet portföyü ve fişleri görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `accounting.manage` | Tahsilat / ödeme / virman fişi gir, çek / senet işlemleri, cari kartı aç ve düzenle | ✓ | ✓ |  |  | ✓ |  |
| `accounting.setup` | Kasa / banka tanımları, yöntem eşlemesi, başlangıç günü ve onay eşiği, açılış bakiyesi, fiş iptali | ✓ | ✓ |  |  |  |  |

### Genel muhasebe

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ledger.view` | Hesap planı, yevmiye fişleri, mizan ve hesap ekstresini görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `ledger.manage` | Elle yevmiye fişi gir, fişlenmemiş hareketleri eşitle | ✓ | ✓ |  |  | ✓ |  |
| `ledger.setup` | Hesap planı ve otomatik fiş kuralları, dönem kilidi, yevmiye fişi iptali | ✓ | ✓ |  |  | ✓ |  |

### Fatura ve e-belge

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `invoices.view` | Faturalanacakları, faturaları, PDF'leri ve GİB durumunu görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `invoices.issue` | Folyo / etkinlik faturası kes (taslak, alıcı, kesim), e-belgeyi tekrar gönder | ✓ | ✓ | ✓ |  | ✓ |  |
| `invoices.manage` | Cariye serbest fatura kes, fatura iptali iste (onay kuyruğu) | ✓ | ✓ |  |  | ✓ |  |
| `invoices.setup` | Fatura ayarları: satıcı bilgileri, seriler, faturalama başlangıcı, vergi kodları, entegratör, test mükellefleri | ✓ | ✓ |  |  |  |  |

### Personel

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `employees.view` | Personel listesini ve kartlarını görüntüle (ücret hariç) | ✓ | ✓ |  |  | ✓ |  |
| `employees.manage` | Personel kartı ekle / düzenle, işten çıkış yap | ✓ |  |  |  | ✓ |  |

### Bordro

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `payroll.view` | Ücretleri, bordroları, pusulaları ve çıktıları görüntüle | ✓ |  |  |  | ✓ |  |
| `payroll.manage` | Ücret, puantaj, ek ödeme / kesinti, avans, icra, teşvik, servis payı; bordro hesapla ve onaya gönder | ✓ |  |  |  | ✓ |  |
| `payroll.pay` | Maaş ve avans öde (kasa / banka) | ✓ |  |  |  | ✓ |  |
| `payroll.setup` | Bordro ayarları: yasal parametreler ve teyidi, kalem türleri, departmanlar, işyeri bilgileri | ✓ |  |  |  |  |  |

### İK

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hr.view` | İzinler ve bakiyeler, vardiya çizelgesi, günlük puantaj ve özlük belgelerini görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `hr.manage` | İzin onayla / iptal et, çizelge ve puantaj yaz, bordroya aktar, belge yükle, İK ayarları | ✓ | ✓ |  |  | ✓ |  |
| `hr.self` | Kendi izin talebini gir; kendi izinlerini, bakiyesini ve vardiyalarını gör | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Sadakat programı

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `loyalty.view` | Sadakat üyelerini, puan bakiyesini ve hareketlerini görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `loyalty.redeem` | Folyoda puan kullan (indirim), misafiri sadakat programına üye yap | ✓ | ✓ | ✓ |  |  |  |
| `loyalty.manage` | Sadakat programı ayarları ve seviyeler, elle puan düzeltmesi | ✓ | ✓ |  |  |  |  |

### KBS kimlik bildirimi

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kbs.view` | KBS kimlik bildirimlerini ve mutabakatı görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `kbs.send` | Hatalı KBS bildirimini tekrar gönder, elle bildirildi olarak işaretle | ✓ | ✓ | ✓ |  |  |  |
| `kbs.manage` | KBS ayarları (tesis kodu, kullanıcı, parola, zorunlu alanlar) ve bağlantı denemesi | ✓ | ✓ |  |  |  |  |

### Sanal POS

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `payment_gateway.view` | Sanal POS ödeme linklerini ve işlemlerini görüntüle | ✓ | ✓ | ✓ |  | ✓ |  |
| `payment_gateway.send` | Ödeme linki oluştur, misafire gönder, iptal et | ✓ | ✓ | ✓ |  |  |  |
| `payment_gateway.setup` | Sanal POS ayarları: sağlayıcı, anahtarlar, widget ön ödemesi | ✓ | ✓ |  |  |  |  |

### Misafir yorumları

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reviews.view` | Misafir yorumlarını, AI etiketlerini ve trendi görüntüle | ✓ | ✓ | ✓ |  |  |  |
| `reviews.reply` | Yoruma cevap taslağı yaz, cevaplandı olarak işaretle | ✓ | ✓ | ✓ |  |  |  |
| `reviews.manage` | Yorum ekle / dosyadan yükle, etiketi düzelt, sil, yeniden analiz et | ✓ | ✓ |  |  |  |  |

### Misafir portalı ve online check-in

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `guest_portal.view` | Online check-in'leri ve belge fotoğraflarını gör, misafir portalı bağlantısını gör | ✓ | ✓ | ✓ |  |  |  |
| `guest_portal.manage` | Online check-in onayla / düzeltme iste; portal bağlantısı ver, iptal et, davet gönder | ✓ | ✓ | ✓ |  |  |  |
| `guest_portal.setup` | Misafir portalı ayarları: davet ve açılış günleri, belge saklama süresi, metinler | ✓ | ✓ |  |  |  |  |

### Anket ve memnuniyet

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `surveys.view` | Anket cevaplarını, NPS raporunu, takipleri ve AI özetlerini gör | ✓ | ✓ | ✓ |  |  |  |
| `surveys.follow_up` | Düşük puan takibi: üstlen, görüşme / not yaz, kapat | ✓ | ✓ | ✓ |  |  |  |
| `surveys.setup` | Anket soruları, gönderim ayarları ve yorum bağlantıları; AI dönem özeti iste | ✓ | ✓ |  |  |  |  |

### Spa ve spor salonu

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spa.view` | Spa takvimini, randevuları, dersleri ve raporu gör | ✓ | ✓ | ✓ |  | ✓ |  |
| `spa.book` | Randevu aç, değiştir, tamamla, iptal et; derse kaydet; ücreti oda hesabına yaz | ✓ | ✓ | ✓ |  |  |  |
| `spa.payment` | Spa kasasında tahsilat al; iade ve hatalı giriş iptali iste | ✓ | ✓ |  |  |  |  |
| `spa.supervise` | Randevu fiyatını elle belirle; geç iptal / gelmedi bedelini sil | ✓ | ✓ |  |  |  |  |
| `spa.setup` | Spa hizmetleri, terapistler, odalar, bloklar, ders programı ve ayarlar | ✓ | ✓ |  |  |  |  |

### Acente primi

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agency_bonus.view` | Acente hedef / prim kurallarını, ilerlemeyi ve hak ediş raporunu görüntüle | ✓ | ✓ |  |  | ✓ |  |
| `agency_bonus.manage` | Prim kuralı aç, düzenle, yürürlüğe al; hak edişi hesapla ve onaya gönder | ✓ | ✓ |  |  |  |  |
| `agency_bonus.pay` | Onaylı prim hak edişini ödendi işaretle | ✓ | ✓ |  |  | ✓ |  |

### Kanal yönetimi

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `channel_manager.view` | Kanalları, senkron logunu ve kanal rezervasyonlarını görüntüle | ✓ | ✓ |  |  |  |  |
| `channel_manager.manage` | Kanal bağla, eşleştir, stop-sale koy, elle senkronla | ✓ | ✓ |  |  |  |  |

### Entegrasyon (API ve webhook)

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `integrations.view` | API uygulamalarını, anahtar listesini, webhook aboneliklerini ve teslimat logunu görüntüle | ✓ | ✓ |  |  |  |  |
| `integrations.manage` | API uygulaması ve anahtarı oluştur / iptal et, webhook aboneliği kur, teslimatı yeniden gönder | ✓ |  |  |  |  |  |

### İzleme

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `activity.view` | Aktivite akışını ve zincirleri görüntüle | ✓ | ✓ |  |  |  |  |
| `audit.view` | Denetim kaydını görüntüle | ✓ | ✓ |  |  |  |  |

### Aktörler

| İzin | Ne yaptırır | Yönetici | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `actors.view` | Aktör panelini görüntüle | ✓ | ✓ |  |  |  |  |
| `actors.manage` | Aktörleri aç / kapat | ✓ |  |  |  |  |  |

## Aktörler (otomatik çalışan işçiler ve ajanlar)

Her aktör bir bildirgeyle tanımlıdır: hangi olayları dinler, hangilerini yayınlar, kapatılınca işi hangi modülün manuel görev listesine düşer. Aktörler **Aktörler** sayfasından otel başına açılıp kapatılır. Aşağıdaki metinler bildirgelerden alınmıştır.

### Muhasebe aktörü (`accounting-worker`)

**Tür:** worker · **Paket:** `@hotelos/accounting-worker` · **Kapalıyken iş düşer:** Ön muhasebe · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Ön büro, etkinlik, restoran ve spa tahsilatlarını yöntem eşlemesine göre kasaya / bankaya işler; "Acente / cari" ve voucher'la kapatılan folyoyu seçilen cariye borç yazar. Etkinlik tahsilatını müşteri carisinden düşer, gerçekleşen etkinliğin bedelini (iptalde iptal bedelini) müşteri carisine borç yazar. Mal kabulü tedarikçi carisine vadeli borcumuz olarak, onaylanan acente primini acente carisine alacak olarak işler. Ödeme iptalini ters kayıtla düşer. Kesilen faturanın numarasını alacağı doğuran cari harekete bağlar; serbest faturayı cariye borç yazar, iptalinde bağı çözer ve serbest faturanın borcunu ters kayıtla düşer. Onaylanan bordroyu personel (net ücret), SGK, vergi dairesi, BES ve icra / nafaka carilerine tahakkuk ettirir; maaş ödemesini kasadan / bankadan çıkış ve personel carisine borç olarak işler. Genel muhasebe (48): yazdığı her cari / kasa-banka hareketini belgenin yevmiye fişine çevirir (kasa hesabı, cari kontrol hesabı, gelir / KDV / stok / gider karşı hesapları kurallardan); gün kapanışında günün gelir fişini yazar (folyo kalemleri, adisyonlar, spa). Kapalıyken ya da işleyemediğinde iş manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `payment.received`, `payment.refunded`, `payment.voided`, `banquet.payment.changed`, `pos.payment.changed`, `spa.payment.changed`, `purchase.goods.received`, `agency.bonus.changed`, `banquet.event.changed`, `invoice.issued`, `invoice.cancelled`, `payroll.run.approved`, `payroll.run.changed`, `accounting.posted`, `night.audit.closed` | `accounting.posted`, `ledger.changed` | — |

### Folyo aktörü (`billing-worker`)

**Tür:** worker · **Paket:** `@hotelos/billing-worker` · **Kapalıyken iş düşer:** Folyo · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Misafir giriş yapınca folyoyu açar ve erken giriş ücretini, her gece oda ücretlerini, çıkışta kalan geceleri ve geç çıkış ücretini işler; bakiyesi kapanan folyoyu kapatır. İptal / gelmedi ücretini, restoran ve minibar harcamalarını, teslim edilen çamaşırı, spa randevusunu ve bedelini folyoya yazar (çıkmış misafirin açık folyosuna geç kalem). Girişte alınan nakit / havale teminatını ödeme olarak işler. Giriş, çıkış ya da iptal geri alınınca kendi işlediği ücreti ve teminatı ters kayıtla düşer. Çıkmış misafirin folyosu ödemeyle sıfırlanınca folyoyu kapatır; kapanan folyonun fatura taslağını açar (alıcı: folyo cariye aktarıldıysa cari, değilse misafir). Kapalıyken bu işler manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.checked_in`, `guest.checked_out`, `guest.check_in_reverted`, `guest.check_out_reverted`, `reservation.cancelled`, `reservation.no_show`, `reservation.reinstated`, `folio.room_charges.due`, `night.audit.started`, `fnb.order.charged`, `minibar.consumed`, `laundry.charged`, `spa.charged`, `payment.received`, `payment.refunded`, `payment.voided`, `folio.closed` | `folio.opened`, `folio.charge.posted`, `folio.room_charges.posted`, `folio.item.voided`, `folio.closed`, `folio.reopened`, `folio.routes.changed`, `payment.received`, `payment.requested`, `payment.voided`, `invoice.changed` | — |

### Kanal aktörü (`channel-sync-worker`)

**Tür:** worker · **Paket:** `@hotelos/channel-sync-worker` · **Kapalıyken iş düşer:** Kanal rezervasyonu · **Tekrar deneme:** 3 kez (1000 ms artan bekleme)

Müsaitlik ya da fiyat değişince bağlı kanalları (Channex, iCal) işaretler; zamanlanmış iş farkı birleştirip kanala gönderir. Kanaldan gelen rezervasyonu (yeni, değişiklik, iptal) açar / değiştirir / iptal eder. Kapalıyken kanala hiçbir şey gitmez (açılınca tam eşitleme yapılır); gelen rezervasyonlar manuel görev olarak resepsiyona düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `inventory.room.created`, `inventory.room.updated`, `inventory.room.deleted`, `room.assigned`, `room.unassigned`, `room.blocked`, `room.unblocked`, `reservation.created`, `reservation.updated`, `reservation.cancelled`, `reservation.no_show`, `reservation.reinstated`, `guest.checked_in`, `guest.checked_out`, `guest.check_in_reverted`, `guest.check_out_reverted`, `agency.allotment.changed`, `rate.changed`, `actor.setting.changed`, `channel.booking.received` | `reservation.created`, `reservation.updated`, `reservation.cancelled`, `channel.booking.changed` | — |

### Kat hizmeti aktörü (`housekeeping-worker`)

**Tür:** worker · **Paket:** `@hotelos/housekeeping-worker` · **Kapalıyken iş düşer:** Kat hizmeti · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Misafir çıkışında çıkış temizliği, arıza kaydı kapanınca detaylı temizlik görevi açar; misafirin kat isteğini göreve çevirir. Görevli başlayınca odayı "Temizleniyor", bitirince "Temiz", kat şefi onaylayınca "Kontrol edildi" yapar; bağlı misafir isteğini kapatır. Kapalıyken bu işler manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.checked_out`, `guest.check_out_reverted`, `room.unblocked`, `guest.request.created`, `housekeeping.task.started`, `housekeeping.task.completed`, `housekeeping.room.inspected` | `housekeeping.task.created`, `housekeeping.task.changed`, `room.status.changed`, `guest.request.updated` | — |

### Stok aktörü (`inventory-worker`)

**Tür:** worker · **Paket:** `@hotelos/inventory-worker` · **Kapalıyken iş düşer:** Stok · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Kapanan adisyonun ürünlerini (satılan, ikram, hazırlanıp iptal edilen) reçetelerinden malzemeye açar ve satış noktasının deposundan düşer; adisyon yeniden açılıp kapanırsa farkı düzeltir. Reçetesi olmayan ürünü atlar, tepsi / paket ücretini düşmez. Çıkış, fire, transfer ya da sayımla miktarı değişen malzeme minimumun altına inmişse (yoldaki ve talepteki düşüldükten sonra) satın alma talebi açar ve satın alma yetkilisine haber verir. Kapalıyken satış düşümü stok yetkilisine manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `fnb.order.paid`, `stock.changed` | `stock.changed`, `purchase.request.changed`, `staff.alert.raised` | — |

### KBS aktörü (`kbs-worker`)

**Tür:** worker · **Paket:** `@hotelos/kbs-worker` · **Kapalıyken iş düşer:** KBS · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Misafir girince belgesi girilmiş her kişi (rezervasyon sahibi ve refakatçiler) için KBS giriş bildirimini sıraya alır; çıkışta çıkış, içerideyken oda değişince oda değişikliği bildirimi açar. Giriş geri alınırsa gönderilmemiş bildirimi iptal eder, gönderilmişse çıkışla kapatır; çıkış geri alınırsa yeniden giriş bildirir. Zorunlu bilgisi eksik kişide ön büroya zil çalar. Kapalıyken iş KBS yetkilisine manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.checked_in`, `guest.checked_out`, `guest.check_in_reverted`, `guest.check_out_reverted`, `room.assigned` | `kbs.notification.changed`, `staff.alert.raised` | — |

### Sadakat aktörü (`loyalty-worker`)

**Tür:** worker · **Paket:** `@hotelos/loyalty-worker` · **Kapalıyken iş düşer:** Sadakat · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Folyo kapanınca konaklamanın misafirine uygun harcamadan (vergi kalemleri hariç) seviyesinin çarpanıyla puan kazandırır; folyo yeniden açılınca kazanılanı geri alır, yeniden kapanınca farkı yazar. Spa kasasında ödenen tamamlanmış randevuya (ayarda açıksa) puan verir. Puanla yapılan folyo indirimi iptal edilince puanı iade eder. Seviye yükselince ön büroya haber verir. Kapalıyken iş sadakat yetkilisine manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `folio.closed`, `folio.reopened`, `folio.item.voided`, `spa.appointment.changed` | `loyalty.points.changed`, `loyalty.tier.changed`, `staff.alert.raised` | — |

### Rezervasyon aktörü (`reservation-worker`)

**Tür:** worker · **Paket:** `@hotelos/reservation-worker` · **Kapalıyken iş düşer:** Rezervasyon · **Tekrar deneme:** 3 kez (500 ms artan bekleme)

Kanaldan (WhatsApp, web chat, e-posta, OTA) gelen rezervasyon isteğini müsaitlik ve fiyat denetimiyle açar; yer yoksa gerekçeli ret yayınlar. Kapalıyken istekler manuel görev olarak personele düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `reservation.requested` | `reservation.created`, `reservation.rejected` | — |

### Oda aktörü (`room-worker`)

**Tür:** worker · **Paket:** `@hotelos/room-worker` · **Kapalıyken iş düşer:** Oda atama · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Yeni rezervasyona uygun odayı otomatik seçip atar; misafir giriş yapınca odayı dolu, çıkış yapınca boş ve kirli olarak işaretler; yanlışlıkla yapılan giriş ya da çıkış geri alınınca doluluğu düzeltir. Kapalıyken bu işler manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `reservation.created`, `guest.checked_in`, `guest.checked_out`, `guest.check_in_reverted`, `guest.check_out_reverted` | `room.assigned`, `room.status.changed` | — |

### Bütçe yorum ajanı (`budget-agent`)

**Tür:** agent · **Paket:** `@hotelos/budget-agent` · **Kapalıyken iş düşer:** Bütçe · **Tekrar deneme:** 2 kez (1000 ms artan bekleme)

Sapma raporunda istenen dönemin bütçe sapmasını kısa bir Türkçe paragrafla yorumlar: en büyük sapmalar, oda gelirinde doluluk ve fiyat etkisi, eksik gerçekleşen. Rakamları sistem hesaplar, ajan yalnızca yorumlar.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `budget.commentary.requested` | `budget.commentary.completed` | — |

### Concierge ajanı (`concierge-agent`)

**Tür:** agent · **Paket:** `@hotelos/concierge-agent` · **Kapalıyken iş düşer:** Misafir mesajları · **Tekrar deneme:** 2 kez (1000 ms artan bekleme)

Misafirle konuşur: müsaitlik ve fiyat bakar, teklif hazırlar, misafir açıkça onaylayınca rezervasyon ister; rezervasyon açılınca onay kodunu sohbete yazar. Şikâyet ve personel isteğini personele devreder.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.intent.detected`, `reservation.created`, `reservation.rejected` | `reservation.requested` | — |

### pricing-agent (`pricing-agent`)

**Tür:** agent · **Paket:** `—` · **Kapalıyken iş düşer:** Fiyatlandırma · **Tekrar deneme:** 2 kez (2000 ms artan bekleme)

Doluluk, kalan gün ve geçen yıl verisinden gerekçeli fiyat önerileri üretir. Fiyatı kendisi değiştirmez: her önerisi onay kuyruğuna düşer, personel karar verir.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `pricing.review.requested` | — | — |

### Geri bildirim ajanı (`insight-agent`)

**Tür:** agent · **Paket:** `@hotelos/insight-agent` · **Kapalıyken iş düşer:** Anket · **Tekrar deneme:** 2 kez (1000 ms artan bekleme)

Misafir anketlerindeki ve yorum sitelerindeki (Google, Booking.com…) yorumlara duygu, konu ve departman etiketi verir, yorum siteleri için otel adına cevap önerir; seçilen dönem için ana temaları, örnek alıntıları ve önerileri yazar. Puanları sistem hesaplar; ajan yalnız metni yorumlar, kişi adı ve iletişim bilgisi görmez.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `survey.analysis.requested`, `survey.insight.requested`, `review.analysis.requested` | `survey.analysis.completed`, `survey.insight.completed`, `review.analysis.completed` | — |

### Rapor ajanı (`report-agent`)

**Tür:** agent · **Paket:** `@hotelos/report-agent` · **Kapalıyken iş düşer:** Rapor talebi · **Tekrar deneme:** 2 kez (1000 ms artan bekleme)

Rapor asistanına yazılan soruyu doluluk, gelir, kırılım, tahmin ya da bütçe sapması raporuna çevirir; grafik ve kısa Türkçe yorum seçer. Tabloyu sistem çalıştırır (MCP rapor araçları). Kapalıyken soru rapor talebi olarak personele düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `report.question.asked` | `report.question.completed` | — |

### Niyet ajanı (`router-agent`)

**Tür:** agent · **Paket:** `@hotelos/router-agent` · **Kapalıyken iş düşer:** Misafir mesajları · **Tekrar deneme:** 2 kez (800 ms artan bekleme)

Misafir mesajının niyetini (rezervasyon, soru, şikâyet, personel isteği) küçük modelle belirler. Concierge buna göre cevap verir ya da konuşmayı personele devreder. Kapalıyken AI konuşmaları personele düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.message.received` | `guest.intent.detected` | — |

### Bildirim aktörü (`notification-worker`)

**Tür:** worker · **Paket:** `@hotelos/notification-worker` · **Kapalıyken iş düşer:** Bildirim merkezi · **Tekrar deneme:** 3 kez (400 ms artan bekleme)

Rezervasyon onayı, oda bilgisi, hoş geldiniz ve teşekkür bildirimlerini şablondan hazırlayıp gönderim kuyruğuna yazar. Kapalıyken misafire bildirim gitmez; iş personele manuel görev olarak düşer.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `reservation.created`, `reservation.confirmed`, `room.assigned`, `guest.checked_in`, `guest.checked_out` | `notification.send.requested`, `notification.cancelled`, `notification.failed` | — |

### Web chat geçidi (`webchat-gateway`)

**Tür:** worker · **Paket:** `@hotelos/webchat-gateway` · **Kapalıyken iş düşer:** Misafir mesajları · **Tekrar deneme:** 3 kez (500 ms artan bekleme)

Misafire yazılan cevapları web sitesindeki sohbet balonuna iletir ve "gönderildi" olarak işaretler. Misafir çevrimdışıysa balon açılınca geçmişle birlikte alır.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.message.reply` | `guest.message.delivery` | — |

### WhatsApp geçidi (`whatsapp-gateway`)

**Tür:** worker · **Paket:** `@hotelos/whatsapp-gateway` · **Kapalıyken iş düşer:** Misafir mesajları · **Tekrar deneme:** 3 kez (2000 ms artan bekleme)

Misafire yazılan cevapları WhatsApp Cloud API ile gönderir, teslim durumunu mesaja işler. 24 saat penceresi kapalıysa göndermez, sebebini yazar. Kapalıyken mesajlar "gönderim bekliyor" kalır.

| Dinlediği olaylar | Yayınladığı olaylar | Onaya götürdüğü işler |
| --- | --- | --- |
| `guest.message.reply` | `guest.message.delivery` | — |

## Olay kataloğu

Sistem 213 tür olay yayınlar. Olay = "şu oldu" kaydı; aktörler ve ekranlar bunları dinler. Açıklamalar kataloğun kendi yorumlarından alınmıştır (boşsa olayın adı yeterince anlatıyor demektir).

### accounting.*

| Olay | Açıklama |
| --- | --- |
| `accounting.account.changed` |  |
| `accounting.treasury.changed` |  |
| `accounting.posted` | Cari ve / veya kasa-banka hareketi yazıldı (otomatik kayıt, fiş, çek / senet işlemi): ekstre ve bakiyeler tazelenir. |
| `accounting.voucher.changed` |  |
| `accounting.instrument.changed` |  |
| `accounting.settings.changed` |  |

### actor.*

| Olay | Açıklama |
| --- | --- |
| `actor.setting.changed` | Bir iş personelin onayına düştü. Gövde yalnızca kimlik ve tür taşır; özet ve veri ekranda HTTP ile okunur (socket'e içerik çıkmaz). / 'approval.requested': approvalEvent.extend({ /** Süreli onayın son anı; süresiz ise `null`. */ expiresAt: isoDate.nullable(), }), /** Onaylandı: `PendingAction` varsa isteyen aktör kaldığı yerden devam eder. */ 'approval.granted': approvalEvent.extend({ decidedBy: z.string().min(1) }), 'approval.denied': approvalEvent.extend({ decidedBy: z.string().min(1) }), /** Süresi kimse karar vermeden doldu; iş yapılmadı. */ 'approval.expired': approvalEvent, /* ── Aktör paneli (modül 12) ── */ /** Aktör bu otelde açıldı ya da kapatıldı. Kapalı aktörün işi manuel göreve düşer; AI ajanları kapanınca yeni konuşmalar personelde açılır. |

### agency.*

| Olay | Açıklama |
| --- | --- |
| `agency.changed` | Acente kartı açıldı, düzenlendi, pasife alındı ya da yeniden aktif oldu. |
| `agency.contract.changed` | Kontrat açıldı, başlığı / fiyatları değişti, satışa açıldı, sonlandı ya da taslak silindi. |
| `agency.stop_sale.changed` | Kontrata stop-sale eklendi ya da kaldırıldı (satışı hemen etkiler). |
| `agency.allotment.changed` | Allotment / kota açıldı, düzenlendi ya da silindi (modül 30; müsaitliği hemen etkiler). |
| `agency.bonus.rule.changed` | Kapandığı iş günü "YYYY-AA-GG". */ businessDate: isoDay, closedAt: z.string().datetime(), grandTotal: moneyText, items: z .array( z.object({ menuItemId: z.string().uuid(), name: z.string().min(1), sold: z.number().int().min(0), comped: z.number().int().min(0), wasted: z.number().int().min(0), }), ) .max(400), }), /* ── Acente bonusu (modül 35) ── Prim kuralları, ilerleme paneli ve hak ediş raporu bunlarla canlı tazelenir (`AGENCY_BONUS_EVENTS`); yükte yalnızca kimlik. */ /** Prim kuralı açıldı, düzenlendi, yürürlüğe alındı, iptal edildi ya da (taslak) silindi. |
| `agency.bonus.changed` | Hak ediş hesaplandı / onaya gitti / karar verildi / ödendi / yeniden açıldı. |
| `agency.bonus.tier_reached` | Acente dönem içinde bir prim kademesine ulaştı (gerçekleşen üretimle; kademe başına bir kez). |
| `agency.bonus.progress.refreshed` | Zamanlanmış iş kuralların ilerleme özetini tazeledi (değişen kural sayısı). |

### approval.*

| Olay | Açıklama |
| --- | --- |
| `approval.requested` |  |
| `approval.granted` |  |
| `approval.denied` |  |
| `approval.expired` |  |

### asset.*

| Olay | Açıklama |
| --- | --- |
| `asset.changed` | Kart(lar) açıldı / düzeltildi / taşındı / zimmetlendi / iade alındı / elden çıkarıldı; Excel yüklemesi ve sayım kapanışındaki taşımalar tek olayda. |
| `asset.count.changed` | Sayım açıldı / etiket okutuldu / kapandı / iptal edildi. |
| `asset.depreciation.changed` | Bir yılın amortismanı kaydedildi ya da (son yıl) geri alındı. |
| `asset.settings.changed` | Kategori ya da alan tanımı değişti. |

### banquet.*

| Olay | Açıklama |
| --- | --- |
| `banquet.venue.changed` |  |
| `banquet.equipment.changed` |  |
| `banquet.client.changed` |  |
| `banquet.settings.changed` |  |
| `banquet.event.changed` | Etkinlik dosyası: başlık, oturum, kalem, ödeme planı, durum (opsiyon, kesin, gerçekleşti, iptal, kayıp, opsiyon düştü). |
| `banquet.menu.changed` | Set menü kataloğu (modül 43). |
| `banquet.document.changed` |  |
| `banquet.payment.changed` | Etkinlik ödemesi: alındı, onaya gitti, onaylandı / reddedildi, iptal edildi. Kasa ekranı da tazelenir. |

### budget.*

| Olay | Açıklama |
| --- | --- |
| `budget.changed` | Bütçe sürümü değişti: açıldı (ilk / revize), satırları kaydedildi, onaylandı. |
| `budget.expense_items.changed` | Gider kalemi eklendi, adı değişti ya da arşivlendi. |
| `budget.actuals.changed` | Gerçekleşen giderler girildi. |
| `budget.commentary.requested` | Dönem için AI sapma yorumu istendi (budget-agent dinler). |
| `budget.commentary.completed` | Yorum yazıldı ya da yazılamadı. |

### channel.*

| Olay | Açıklama |
| --- | --- |
| `channel.changed` | Değişikliğin kaynağı ("Sezon: Yaz", "Taban fiyat: Standart") — iz için. */ reason: z.string().min(1).max(200), }), /** Kanal açıldı, ayarı / eşleştirmesi değişti, senkrona alındı, durduruldu ya da silindi. |
| `channel.stop_sale.changed` | Kanala stop-sale eklendi ya da kaldırıldı. |
| `channel.synced` | Senkron işi bitti (log satırı yazıldı): gönderim, tam eşitleme, rezervasyon alımı, takvim okuma. |
| `channel.booking.received` | Kanaldan rezervasyon revizyonu geldi (yeni, değişiklik ya da iptal) ve kalıcı olarak saklandı. Kanal aktörü rezervasyonu açar / değiştirir / iptal eder; yapamazsa personele görev düşer. |
| `channel.booking.changed` | Kanal rezervasyonunun bizdeki durumu değişti (işlendi, doğrulanmalı, elle işlenmeli, kapatıldı). |

### conversation.*

| Olay | Açıklama |
| --- | --- |
| `conversation.updated` | Konuşmanın durumu, modu, ataması ya da bağlı konaklaması değişti. |
| `conversation.read` | Konuşma okundu: diğer paneller okunmamış rozetini düşürsün. |

### data.*

| Olay | Açıklama |
| --- | --- |
| `data.import.completed` | Excel'den toplu yükleme yazıldı (misafir listesi / fiyat planı); fiyat planlarının kendi olayları ayrıca yayınlanır. |

### employee.*

| Olay | Açıklama |
| --- | --- |
| `employee.changed` | Ekran olayı: personel kartı açıldı / değişti / çıkış yaptı / çıkışı geri alındı / silindi. Muhasebe personel carisinin adını eşitler. |

### exchange_rate.*

| Olay | Açıklama |
| --- | --- |
| `exchange_rate.updated` | Ödeme ya da iade onaya gitti (eşik üstü ödeme, her iade): bakiyeye henüz girmedi. */ 'payment.requested': paymentEvent.extend({ kind: z.enum(['PAYMENT', 'REFUND']), approvalId: z.string().uuid() }), /** Ödeme işlendi (doğrudan ya da onaylanınca): bakiye düştü. */ 'payment.received': paymentEvent.extend({ ...balanceChange, method: z.string().min(1), source: z.string().min(1), amount: moneyText, currency: z.string().length(3), approvalId: z.string().uuid().nullable().default(null), }), /** İade işlendi (onaylandı): bakiye arttı, para misafire döndü. */ 'payment.refunded': paymentEvent.extend({ ...balanceChange, method: z.string().min(1), amount: moneyText, currency: z.string().length(3), approvalId: z.string().uuid(), }), /** Onay bekleyen ödeme / iade işlenmedi: reddedildi, süresi doldu ya da onaylandığında folyo kapanmıştı (yalnızca yarışla). / 'payment.declined': paymentEvent.extend({ kind: z.enum(['PAYMENT', 'REFUND']), approvalId: z.string().uuid(), outcome: z.enum(['DENIED', 'EXPIRED', 'FOLIO_CLOSED']), }), /** Hatalı ödeme girişi için iptal istendi (onaya gitti). */ 'payment.void_requested': paymentEvent.extend({ approvalId: z.string().uuid() }), /** Ödeme iptal edildi: iptal kaydı (ters tutar) işlendi. Onaylı iptalde `approvalId` dolu; sistemin geri alması (giriş geri alındı → teminat) boş. / 'payment.voided': paymentEvent.extend({ ...balanceChange, reversalId: z.string().uuid(), amount: moneyText, currency: z.string().length(3), approvalId: z.string().uuid().nullable().default(null), }), /** Ödeme iptali reddedildi ya da süresi doldu: ödeme olduğu gibi kalır. */ 'payment.void_declined': paymentEvent.extend({ approvalId: z.string().uuid(), outcome: z.enum(['DENIED', 'EXPIRED', 'FOLIO_CLOSED']), }), /** Günün döviz kurları girildi / düzeltildi. |

### extras.*

| Olay | Açıklama |
| --- | --- |
| `extras.catalog.changed` | Minibar / çamaşır fiyat listesi ya da ekspres farkı değişti. |

### fnb.*

| Olay | Açıklama |
| --- | --- |
| `fnb.order.charged` |  |
| `fnb.order.status_changed` | Mutfak turunun durumu ilerledi (modül 40 KDS): garson ekranı "hazır"ı bununla görür. |
| `fnb.order.placed` | Sipariş turu mutfağa gönderildi ("Gönder"). Kalemler gönderildiği anki ad, adet, istasyon ve notla; mutfağa gitmeyen (istasyonu NONE) kalemler de listede (tüketici süzer). Tur bir kez yayınlanır (istek kimliğiyle tekrar gönderim yeni tur açmaz). |
| `fnb.order.paid` | Adisyon no ("ADS-2026-000123"). */ number: z.string().min(1).max(40), /** Turun sırası (adisyon içinde 1, 2, …). */ seq: z.number().int().min(1), tableName: z.string().nullable(), /** Oda servisi turu (modül 41): teslim edilecek oda ve istenen teslim anı (hemen ise boş). Salonda yok. */ roomNumber: z.string().min(1).max(20).nullable().default(null), deliverAt: z.string().datetime().nullable().default(null), covers: z.number().int().min(1), waiterEmail: z.string().min(1), lines: z .array( z.object({ lineId: z.string().uuid(), menuItemId: z.string().uuid(), name: z.string().min(1), quantity: z.number().int().min(1), station: z.enum(['HOT', 'COLD', 'BAR', 'PASTRY', 'NONE']), note: z.string().nullable(), }), ) .min(1) .max(60), }), /** Adisyon kapandı (ödendi / odaya yazıldı): ürün başına satılan, ikram edilen ve zayi (hazırlanıp iptal edilen) adet — stok düşümü bunlardan (hazırlanmadan iptal edilen düşülmez). Adisyon yeniden açılıp tekrar kapanırsa yeniden yayınlanır: tüketici adisyon kimliğine göre **son yayını** esas alır (`closedAt` sırası; fark kadar düzeltir). |

### folio.*

| Olay | Açıklama |
| --- | --- |
| `folio.opened` |  |
| `folio.updated` |  |
| `folio.charge.posted` |  |
| `folio.room_charges.due` | Konaklamaya folyo açıldı (girişte aktör, bölmede ya da elle personel). */ 'folio.opened': folioEvent.extend({ window: z.number().int().min(1) }), /** Ödeyen adı değişti. */ 'folio.updated': folioEvent, /** Folyoya kalem işlendi (elle harcama, indirim, giriş/çıkış ücreti, restoran, minibar). */ 'folio.charge.posted': folioEvent.extend({ itemIds: z.array(z.string().uuid()).min(1).max(100), source: z.string().min(1), total: moneyText, }), /** Bu gecenin oda ücretleri işlenmeli (zamanlayıcı, gün dönünce bir kez). Folyo aktörü dinler; kapalıysa iş "oda ücretleri işlenecek" görevine düşer. |
| `folio.room_charges.posted` | Oda ücretleri işlendi (gece ya da çıkışta): kaç konaklama, kaç kalem, toplam. |
| `folio.item.void_requested` |  |
| `folio.item.voided` |  |
| `folio.item.void_declined` |  |
| `folio.items.transferred` | Kalem iptali onaya gitti. */ 'folio.item.void_requested': folioEvent.extend({ itemId: z.string().uuid(), approvalId: z.string().uuid() }), /** Kalem iptal edildi (ters kayıt işlendi). Onaylı iptalde `approvalId` dolu; sistemin geri alması boş. */ 'folio.item.voided': folioEvent.extend({ itemId: z.string().uuid(), reversalId: z.string().uuid(), approvalId: z.string().uuid().nullable().default(null), }), /** İptal isteği reddedildi ya da süresi doldu: kalem olduğu gibi kalır. */ 'folio.item.void_declined': folioEvent.extend({ itemId: z.string().uuid(), approvalId: z.string().uuid(), outcome: z.enum(['DENIED', 'EXPIRED']), }), /** Kalemler bir folyodan diğerine aktarıldı (başka konaklamanın folyosuna da olabilir). |
| `folio.split` |  |
| `folio.merged` |  |
| `folio.routes.changed` | Etkilenen konaklamalar (kaynak ve hedef). */ reservationIds: z.array(z.string().uuid()).min(1).max(2), itemIds: z.array(z.string().uuid()).min(1).max(200), }), /** Folyo bölündü: aynı konaklamada yeni folyo açıldı, seçilen kalemler taşındı. */ 'folio.split': folioEvent.extend({ newFolioId: z.string().uuid(), itemIds: z.array(z.string().uuid()).max(200), }), /** Folyolar bu folyoda birleşti (grup hesabı): kaynaklar "birleştirildi" oldu. */ 'folio.merged': folioEvent.extend({ sourceFolioIds: z.array(z.string().uuid()).min(1).max(20), /** Kaynak folyoların konaklamaları (sonraki kalemleri buraya yönlendi). */ reservationIds: z.array(z.string().uuid()).min(1).max(21), }), /** Konaklamanın yönlendirmesi değişti (hangi tip hangi folyoya düşer). |
| `folio.closed` |  |
| `folio.reopened` |  |

### forecast.*

| Olay | Açıklama |
| --- | --- |
| `forecast.settings.changed` | Kritik gün eşikleri değişti (tahmin ekranı yeniden işaretler). |

### guest.*

| Olay | Açıklama |
| --- | --- |
| `guest.checked_in` |  |
| `guest.checked_out` |  |
| `guest.check_in_reverted` |  |
| `guest.check_out_reverted` |  |
| `guest.message.received` | Erken giriş ücreti (politikadan; personel uygulamadıysa null). */ earlyCheckInFee: z.string().nullable().default(null), /** Girişte alınan teminat (tahsilat değil; kasaya girişi ödeme modülünde). */ deposit: z .object({ method: z.enum(['CASH', 'CARD_PREAUTH', 'TRANSFER']), amount: z.string(), reference: z.string().nullable().default(null), }) .nullable() .default(null), }), 'guest.checked_out': reservationStay.extend({ roomId: z.string().uuid(), guestId: z.string().uuid(), lateCheckOutFee: z.string().nullable().default(null), /** Çıkış tarihinden önce ayrıldı: `checkOut` kısaltılmış tarihtir, kalan geceler bırakıldı. */ earlyDeparture: z.boolean().default(false), /** Bakiyesi kapanmadan çıkış yapıldıysa o anki açık tutar (yetkili onayıyla). */ openBalance: z.string().nullable().default(null), }), /** Yanlışlıkla yapılan giriş geri alındı (aynı gün): oda yeniden boş. */ 'guest.check_in_reverted': reservationStay.extend({ roomId: z.string().uuid(), reason: z.string().min(1), }), /** Yanlışlıkla yapılan çıkış geri alındı (aynı gün): misafir yine içeride, oda dolu. */ 'guest.check_out_reverted': reservationStay.extend({ roomId: z.string().uuid(), reason: z.string().min(1), }), /* ── Misafir mesajları ve istekleri (modül 7) ── Kanallar (WhatsApp, web chat) modül 8'de. Sözleşme: - Kanal gelen mesajı `messaging/service.js → receiveInboundMessage` ile teslim eder; servis kaydeder ve `guest.message.received` yayınlar (router/concierge ajanları bunu dinler). - Personelin ya da AI'ın cevabı `guest.message.reply` yayınlar; kanal bunu dinleyip gönderir ve `markMessageDelivery` ile sonucu bildirir. |
| `guest.message.reply` |  |
| `guest.intent.detected` | Konuşma "manuele alınmış"sa AI asistanı cevap vermemeli. */ mode: z.enum(['AI', 'MANUAL']), }), 'guest.message.reply': hotelScoped.extend({ conversationId: z.string().uuid(), messageId: z.string().uuid(), channel: z.string(), /** Kanaldaki alıcı: telefon numarası, web chat oturumu. */ recipient: z.string(), author: z.enum(['STAFF', 'AI', 'SYSTEM']), }), /** Router ajanı gelen misafir mesajının niyetini belirledi (modül 8). Concierge ajanı bunu dinler; şikâyet ve "personelle görüşmek istiyorum" konuşmayı personele devreder. `affirmative`: mesaj, misafire sunulmuş bir teklife açık bir "evet" mi (rezervasyon isteği ancak bununla gönderilir). |
| `guest.message.delivery` |  |
| `guest.request.created` |  |
| `guest.request.updated` |  |
| `guest.card.updated` | Misafir kartı güncellendi (iletişim, kimlik, etiket) — modül 22. |
| `guest.card.merged` | İki misafir kartı birleştirildi (kaynak silindi, kayıtları hedefe taşındı). |
| `guest.preference.updated` | Misafir tercihi eklendi / değişti / silindi. |
| `guest.note.added` | Misafir kartına not eklendi. |

### guest_portal.*

| Olay | Açıklama |
| --- | --- |
| `guest_portal.link.changed` | Portal bağlantısı verildi / iptal edildi ya da davet gönderildi. |
| `guest_portal.settings.changed` |  |

### housekeeping.*

| Olay | Açıklama |
| --- | --- |
| `housekeeping.task.created` |  |
| `housekeeping.task.changed` | 1 en acil, 5 en düşük. */ priority: z.number().int().min(1).max(5), /** Görevi kim açtı: zamanlayıcı/aktör mü, personel mi. */ source: z.enum(['system', 'staff']).default('staff'), }), /** Atama, iptal ya da not değişikliği — liste ekranları tazelensin. |
| `housekeeping.tasks.assigned` | Toplu atama tek haberle duyurulur; 2500 odalı otelde görev başına event listeyi boğar. |
| `housekeeping.tasks.generated` | Sabah üretimi (STAYOVER): gün ve sayı — görev başına event 2500 odada defteri boğar. |
| `housekeeping.task.started` | Görevli "Başladım" dedi; temizlik görevlerinde oda `CLEANING` olur. |
| `housekeeping.task.completed` | Görevli "Bitti" dedi; temizlik görevlerinde oda `CLEAN` olur, bağlı misafir isteği kapanır. |
| `housekeeping.room.inspected` | Kat şefi kontrolü: geçtiyse oda `INSPECTED`, kaldıysa yeniden `DIRTY`. |
| `housekeeping.issue.reported` | Görevli "Sorun var" dedi: iş teknik servise (modül 20 gelene dek manuel görev) taşınır. |

### hr.*

| Olay | Açıklama |
| --- | --- |
| `hr.leave.changed` | İş olayı: izin talebi açıldı / onaylandı / reddedildi / iptal edildi (88 işgücü planlama ve 76 mobil dinler). |
| `hr.changed` | Ekran olayı: vardiya çizelgesi, günlük puantaj, bordroya aktarım, özlük belgesi ya da İK ayarı değişti. |

### inventory.*

| Olay | Açıklama |
| --- | --- |
| `inventory.room.created` |  |
| `inventory.room.updated` |  |
| `inventory.room.deleted` |  |

### invoice.*

| Olay | Açıklama |
| --- | --- |
| `invoice.issued` | İş olayı (modül 16 / 49): fatura kesildi. Ön muhasebe folyo ve etkinlik faturasını **ikinci alacak olarak yazmaz** — alacak operasyondan doğmuştur (folyo cariye aktarıldığında, etkinlik gerçekleştiğinde); fatura numarası o cari harekete bağlanır. Serbest fatura (kaynağı yok) cariye alacak yazar. |
| `invoice.cancelled` | İş olayı: fatura iptal edildi (onaydan sonra). Ön muhasebe bağı çözer, serbest faturanın alacağını ters kayıtla düşer. |
| `invoice.changed` | Ekran olayı: fatura listesi / ekranı tazelenir (taslak, kesim, iptal isteği, e-belge durumu). |
| `invoice.settings.changed` |  |

### kbs.*

| Olay | Açıklama |
| --- | --- |
| `kbs.notification.changed` |  |
| `kbs.settings.changed` |  |

### laundry.*

| Olay | Açıklama |
| --- | --- |
| `laundry.charged` |  |
| `laundry.order.changed` | Çamaşır siparişi açıldı, sayımı düzeldi ya da durumu değişti. |

### ledger.*

| Olay | Açıklama |
| --- | --- |
| `ledger.changed` | Genel muhasebe (modül 48): yevmiye fişi yazıldı / iptal edildi, hesap planı, kural ya da dönem kilidi değişti. Ekranlar (mizan, fiş listesi, hesap planı) bununla tazelenir. |

### lost_item.*

| Olay | Açıklama |
| --- | --- |
| `lost_item.recorded` | Bulunan eşya kaydedildi. |
| `lost_item.changed` | Eşya değişti: bilgi, fotoğraf, eşleşme, iletişim notu, teslim ya da kapatma. |

### lost_items.*

| Olay | Açıklama |
| --- | --- |
| `lost_items.settings.changed` | Saklama süreleri değişti ("süresi dolan" listesi yeniden hesaplanır). |

### loyalty.*

| Olay | Açıklama |
| --- | --- |
| `loyalty.points.changed` | İş olayı: puan hareketi yazıldı (kazanma, harcama, iade, süre dolumu, düzeltme); 80 / 82 / 102 dinler. |
| `loyalty.tier.changed` | İş olayı: misafirin seviyesi değişti (80 misafir tanıma, 75 patron uygulaması). |
| `loyalty.changed` | Ekran olayı: üyelik açıldı / kapandı ya da program ayarı değişti. |

### maintenance.*

| Olay | Açıklama |
| --- | --- |
| `maintenance.ticket.created` | Arıza bileti açıldı (modül 20). Oda kapatıldıysa `roomBlockId` dolu. |
| `maintenance.ticket.assigned` | Bilete teknisyen atandı (ya da atama kaldırıldı). |
| `maintenance.ticket.resolved` | Bilet çözüldü; oda kapatılmışsa açıldı. |
| `maintenance.ticket.cancelled` | Bilet iptal edildi. |

### manual_task.*

| Olay | Açıklama |
| --- | --- |
| `manual_task.created` | Aktörün yapamadığı iş personelin önüne düştü (görev ekranı ve rozet tazelenir). |
| `manual_task.updated` | Görev üstlenildi, bırakıldı, tamamlandı ya da "gerek kalmadı" dendi. |

### minibar.*

| Olay | Açıklama |
| --- | --- |
| `minibar.consumed` |  |
| `minibar.recorded` | Folyo kapandı (bakiye sıfır). Fatura modülü taslak faturayı buradan üretir. */ 'folio.closed': folioEvent.extend({ chargesTotal: moneyText, currency: z.string().length(3) }), /** Kapanmış folyo yeniden açıldı (yetkiliyle, gerekçeli; ya da çıkış geri alındı). */ 'folio.reopened': folioEvent.extend({ reason: z.string().min(1) }), /* ── Folyoya dış kaynaklı harcama (yayıncıları: modül 19 minibar, 39 / 41 restoran) ── */ /** Restoran / oda servisi siparişi odaya yazıldı. */ 'fnb.order.charged': externalCharge, /** Kat görevlisi odada minibar tüketimi girdi. */ 'minibar.consumed': externalCharge, /** Çamaşır siparişi misafire teslim edildi: ücreti folyoya (modül 19). */ 'laundry.charged': externalCharge, /** Spa randevusu tamamlandı ya da iptal / gelmedi bedeli doğdu: tutar oda hesabına (modül 57). */ 'spa.charged': externalCharge, /* ── Minibar ve çamaşırhane ekranları (modül 19) ── Kayıt ve pano ekranları bunlarla canlı tazelenir (`EXTRAS_EVENTS`). Folyoya giden ücret yukarıdaki `minibar.consumed` / `laundry.charged`. */ /** Odanın minibar sayımı girildi (folyoya giden ya da kayıp). |

### night.*

| Olay | Açıklama |
| --- | --- |
| `night.audit.started` | Gün kapanışı (modül 18) başladı: görevli günü kapatmaya başladı (iş günü henüz ilerlemedi). |
| `night.audit.closed` | Gün kapandı: iş günü ilerledi. FlexAI 2.0'da gece müdürü (87), kârlılık (92) ve dış muhasebe (96) bunu dinler. Kapanışın yaptığı iş özeti payload'da. |

### notification.*

| Olay | Açıklama |
| --- | --- |
| `notification.send.requested` |  |
| `notification.sent` |  |
| `notification.delivered` | Sağlayıcı teslim raporu (SMS): alıcıya ulaştı. |
| `notification.failed` | Gönderim başarısız. `final: false` ise yeniden denenecek; `true` ise hakkı bitti ya da hata kalıcı (yanlış parola, tanımsız başlık). |
| `notification.cancelled` | Bekleyen gönderim iptal edildi ya da gönderilmedi (kanal kapalı, alıcı istemiyor). |
| `notification.template.saved` | Şablon eklendi / değişti / varsayılana döndü. |
| `notification.channel.updated` | Kanal ayarı değişti (parola değişikliği yalnızca alan adıyla görünür). |

### online_checkin.*

| Olay | Açıklama |
| --- | --- |
| `online_checkin.changed` | Online check-in gönderildi / onaylandı / düzeltme istendi / giriş yapıldı / belgeleri silindi. Kişisel veri taşımaz. |

### payment.*

| Olay | Açıklama |
| --- | --- |
| `payment.requested` |  |
| `payment.received` |  |
| `payment.refunded` |  |
| `payment.declined` |  |
| `payment.void_requested` |  |
| `payment.voided` |  |
| `payment.void_declined` |  |

### payment_gateway.*

| Olay | Açıklama |
| --- | --- |
| `payment_gateway.link.changed` |  |
| `payment_gateway.settings.changed` |  |

### payroll.*

| Olay | Açıklama |
| --- | --- |
| `payroll.run.changed` | Ekran olayı: bordro açıldı / hesaplandı / onaya gitti / onaylandı / reddedildi / silindi / ödendi. |
| `payroll.run.approved` | İş olayı: bordro dört gözle onaylandı. Muhasebe aktörü net ücret, SGK, vergi, BES ve icra / nafaka borçlarını carilere yazar. |
| `payroll.settings.changed` | Ekran olayı: bordro ayarı, parametre seti, kalem, departman, servis payı, avans, icra / nafaka, teşvik ya da puantaj değişti. |

### pos.*

| Olay | Açıklama |
| --- | --- |
| `pos.setup.changed` | Satış noktası, masa, menü grubu / ürünü (tükendi dahil) ya da politika değişti. |
| `pos.check.changed` | Adisyon açıldı / değişti / kapandı (masa planı bu olayla tazelenir). |
| `pos.order.sent` | Sipariş turu mutfağa gönderildi: mutfak ekranı (modül 40) kalemleri istasyonlara dağıtır. |
| `pos.payment.changed` | Restoran ödemesi alındı, onaya gitti, onaylandı / reddedildi, iptal edildi. Kasa ekranı da tazelenir. |
| `pos.shift.changed` | Garson vardiyası açıldı / kapandı. |
| `pos.room_service.changed` | Oda servisi siparişi (modül 41) açıldı / kabul edildi / reddedildi / mutfağa düştü / adım ilerledi / teslim edildi / iptal edildi / tepsisi toplandı. Teslim panosu, hazırlık listesi ve misafir sayfası (modül 53) tazelenir. |
| `pos.delivery.changed` | Paket sipariş (modül 42) alındı / adım ilerledi / kurye atandı / teslim edildi / iptal edildi / tur eklendi. Paket panosu ve sipariş ekranı tazelenir. |

### pricing.*

| Olay | Açıklama |
| --- | --- |
| `pricing.review.requested` | Modül 34: günlük fiyat değerlendirmesi — pricing-agent bu olayla çalışır. |

### promotion.*

| Olay | Açıklama |
| --- | --- |
| `promotion.changed` | Promosyon açıldı, düzenlendi, yayına alındı, durduruldu ya da (kullanılmamış taslak) silindi. |
| `promotion.coupons.changed` | Promosyona kupon üretildi ya da bir kupon kapatıldı / yeniden açıldı. |

### purchase.*

| Olay | Açıklama |
| --- | --- |
| `purchase.request.changed` |  |
| `purchase.supplier.changed` |  |
| `purchase.round.changed` |  |
| `purchase.order.changed` |  |
| `purchase.goods.received` | İş olayı: mal kabul edildi — tedarikçi borcu doğdu (ön muhasebe / cari, modül 47 dinler). Tutarlar kabul edilen miktarın sipariş fiyatıyla (KDV hariç / KDV / dahil); vade = kabul günü + tedarikçinin vadesi. |

### rate.*

| Olay | Açıklama |
| --- | --- |
| `rate.changed` | Satış fiyatı değişti. `roomTypeIds` boşsa bütün oda tipleri; `from` / `to` boşsa bütün tarihler (iki uç dahil, otelin günü). |

### recipe.*

| Olay | Açıklama |
| --- | --- |
| `recipe.stock_item.changed` |  |
| `recipe.changed` |  |

### report.*

| Olay | Açıklama |
| --- | --- |
| `report.question.asked` |  |
| `report.question.completed` |  |
| `report.saved.changed` |  |
| `report.definition.changed` | Tasarım raporu kaydedildi / değişti / silindi (kayıtlı raporlar ekranı `report-chat.changed` kanalından tazelenir). |

### reservation.*

| Olay | Açıklama |
| --- | --- |
| `reservation.created` |  |
| `reservation.updated` |  |
| `reservation.confirmed` | Rezervasyon oluşturulurken oda zaten atandıysa aktör tekrar atamaz. */ roomId: z.string().uuid().nullable().default(null), /** Grup rezervasyonunun parçasıysa grup kimliği. */ groupId: z.string().uuid().nullable().default(null), /** Rezervasyonun kaynağı ve isteğin kimliği (modül 8): concierge yalnızca kanal isteğinden (WhatsApp / web chat) açılanlarla ilgilenir; sohbete yazacağı onay kodunu isteğe bu kimlikle bağlar. / source: z.string().min(1).max(30).nullable().default(null), requestId: z.string().min(1).max(100).nullable().default(null), /** Acente adına açıldıysa acente (modül 29). */ agencyId: z.string().uuid().nullable().default(null), }), /** Tarih, oda tipi, kişi, pansiyon, fiyat, acente ya da not değişti. */ 'reservation.updated': reservationStay.extend({ changedFields: z.array(z.string()).default([]), }), /** Opsiyonlu (bekleyen) rezervasyon kesinleşti. |
| `reservation.cancelled` |  |
| `reservation.no_show` |  |
| `reservation.reinstated` |  |
| `reservation.requested` | İptal: envanter serbest kalır (bekleme listesi taranır). */ 'reservation.cancelled': reservationStay, /** Misafir gelmedi: envanter serbest kalır. */ 'reservation.no_show': reservationStay, /** İptal / gelmedi geri alındı: envanter yeniden tüketilir. */ 'reservation.reinstated': reservationStay, /** Kanaldan (WhatsApp, web chat, e-posta, OTA) gelen rezervasyon isteği. reservation-worker işler: `reservation.created` ya da `reservation.rejected`. `requestId` isteği yapanın kimliğidir; aynı kimlikle ikinci rezervasyon açılmaz. |
| `reservation.rejected` | Kanal isteği varsayılan olarak opsiyonludur: personel onaylar. */ status: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'), /** Kanal misafiri zaten tanıyorsa (konuşma bir misafir kartına bağlı) o kart kullanılır; yoksa yeni kart açılır. Modül 8. / guestId: z.string().uuid().nullable().default(null), /** Misafirin girdiği kupon kodu (modül 31; web widget'ı — modül 32 — gönderir). Kupon uymuyorsa ya da dolmuşsa istek reddedilir (`reservation.rejected`). / couponCode: z.string().min(1).max(40).nullable().default(null), }), /** Kanal isteği karşılanamadı (yer yok, kapasite, geçersiz tarih). |

### review.*

| Olay | Açıklama |
| --- | --- |
| `review.analysis.requested` |  |
| `review.analysis.completed` |  |

### reviews.*

| Olay | Açıklama |
| --- | --- |
| `reviews.changed` |  |

### room.*

| Olay | Açıklama |
| --- | --- |
| `room.assigned` |  |
| `room.unassigned` |  |
| `room.status.changed` | Aktör mü yoksa personel mi attı — Activity Feed'de ayırt edilsin. */ assignedBy: z.enum(['manual', 'auto']).default('manual'), }), 'room.unassigned': hotelScoped.extend({ reservationId: z.string().uuid(), roomId: z.string().uuid(), roomNumber: z.string(), }), /** Odanın iki bağımsız durumundan biri değişti. `field` hangisi olduğunu söyler: `occupancy` (Boş/Dolu — yalnızca giriş ve çıkış değiştirir) ya da `housekeeping` (Kirli/Temizleniyor/Temiz/Kontrol edildi). Çıkışta ikisi birden değiştiği için iki ayrı event yayınlanır. |
| `room.blocked` | Oda tarih aralığıyla arızalı ya da hizmet dışı işaretlendi. `OUT_OF_ORDER` envanterden düşer; `OUT_OF_SERVICE` satışta kalır ama atanmaz. |
| `room.unblocked` | Blok kaldırıldı. `CANCELLED`: henüz başlamamıştı, kayıt silindi. `ENDED`: sürüyordu, bitişi bugüne çekildi (geçmiş günler değişmez). |

### sales.*

| Olay | Açıklama |
| --- | --- |
| `sales.lead.changed` | Fırsat açıldı, düzenlendi, durumu değişti (pano sütunu) ya da kazanıldı/kaybedildi. |
| `sales.quote.changed` | Teklif taslağı açıldı, gönderildi, kabul/red edildi ya da süresi doldu. |

### settings.*

| Olay | Açıklama |
| --- | --- |
| `settings.hotel.updated` |  |
| `settings.roomType.created` |  |
| `settings.roomType.updated` |  |
| `settings.roomType.deleted` |  |
| `settings.tax.created` |  |
| `settings.tax.updated` |  |
| `settings.tax.deleted` |  |
| `settings.season.created` |  |
| `settings.season.updated` |  |
| `settings.season.deleted` |  |
| `settings.rate_plan.created` |  |
| `settings.rate_plan.updated` |  |
| `settings.rate_plan.deleted` |  |
| `settings.package.created` |  |
| `settings.package.updated` |  |
| `settings.package.deleted` |  |
| `settings.yield.updated` | Event kataloğu. Bir event'in adı ve gövdesi burada tanımlanmadan yayınlanamaz. Sebep: event'ler modüller arası sözleşmedir — yayınlayan ile dinleyen farklı zamanlarda, farklı kişiler tarafından yazılıyor. Şemasız event, iki hafta sonra "bu alan neden yok" tartışmasıdır. `version` alanı ileriye dönük: gövde değişince eski sürüm bir süre desteklenebilsin diye zarf sürümü taşıyor. / const hotelScoped = z.object({ hotelId: z.string().uuid() }); /** Ayar kayıtlarının ortak kimlik gövdesi. */ const settingsEntity = hotelScoped.extend({ id: z.string().uuid(), label: z.string().min(1), }); /** Event gövdeleri JSON olarak saklandığı için tarihler ISO metne indirgenir. Date da kabul edilir; yayıncı her seferinde elle çevirmek zorunda kalmasın. / const isoDate = z .union([z.string(), z.date()]) .transform((value) => (value instanceof Date ? value.toISOString() : value)) .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'geçersiz tarih' }); /** Rezervasyon olaylarının ortak gövdesi (modül 4): kimlik ve envanter etkisi. */ const reservationStay = hotelScoped.extend({ reservationId: z.string().uuid(), roomTypeId: z.string().uuid(), checkIn: isoDate, checkOut: isoDate, }); /** "1234.50" / "-45.00" biçiminde tutar metni. */ const moneyText = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'tutar "1234.50" biçiminde olmalı'); /** "YYYY-MM-DD" takvim günü (otelin günü). */ const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'gün "YYYY-MM-DD" biçiminde olmalı'); /** Folyo olaylarının ortak gövdesi (modül 15): hangi folyo, hangi konaklamanın. */ const folioEvent = hotelScoped.extend({ folioId: z.string().uuid(), reservationId: z.string().uuid(), }); /** Ödeme olaylarının ortak gövdesi (modül 17): hangi ödeme, hangi folyoda, hangi konaklamanın. */ const paymentEvent = folioEvent.extend({ paymentId: z.string().uuid() }); /** Bakiyeyi değiştiren ödeme olayları: folyonun konaklaması bitmiş mi (çıkmış, iptal, gelmedi). Folyo aktörü yalnızca bunlarda "bakiye sıfırlandıysa kapat" işine bakar; içerideki misafirin her ödemesi için iş açmaz. / const balanceChange = { stayEnded: z.boolean().default(false) }; /** Dış kaynaktan (restoran siparişi, minibar tüketimi) folyoya işlenecek harcama. Konaklama biliniyorsa `reservationId`; bilinmiyorsa oda (`roomId`, o an odada konaklayan misafir bulunur). Tutarlar otelin para biriminde, vergi dahil/hariç otelin vergi ayarına göre (kalem tipi: restoran / minibar). / const externalCharge = hotelScoped .extend({ reservationId: z.string().uuid().nullable().default(null), roomId: z.string().uuid().nullable().default(null), /** Kaynaktaki kayıt no (adisyon, tüketim fişi) — folyoda ve denetimde görünür. */ reference: z.string().min(1).max(60), items: z .array( z.object({ description: z.string().min(1).max(200), unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'birim fiyat "45.50" biçiminde olmalı'), quantity: z.number().int().min(1).max(999), /** Vergi kategorisi; yoksa kaynağınki (restoran FNB, minibar MINIBAR…). Restoran adisyonu karışık kategorili olabilir (yiyecek + perakende). / taxCategory: z.string().min(1).max(20).optional(), }), ) .min(1) .max(50), }) .refine((value) => Boolean(value.reservationId \|\| value.roomId), { message: 'konaklama ya da oda gerekli' }); /** Onay olaylarının ortak gövdesi (modül 11). */ const approvalEvent = hotelScoped.extend({ approvalId: z.string().uuid(), /** Sözleşmedeki onay türü (`APPROVAL_TYPES`). */ type: z.string().min(1), /** İsteyen aktör; kişi ya da servis istediyse `null`. */ actorName: z.string().nullable(), }); export const EVENT_CATALOG = Object.freeze({ 'settings.hotel.updated': hotelScoped.extend({ /** Değişen alan adları — dinleyen taraf neyin değiştiğine göre karar verebilsin. */ changedFields: z.array(z.string()).default([]), }), 'settings.roomType.created': settingsEntity, 'settings.roomType.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }), 'settings.roomType.deleted': settingsEntity, 'settings.tax.created': settingsEntity, 'settings.tax.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }), 'settings.tax.deleted': settingsEntity, 'settings.season.created': settingsEntity, 'settings.season.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }), 'settings.season.deleted': settingsEntity, /** Modül 28: fiyat planı (oda tipi × pansiyon × dönem). */ 'settings.rate_plan.created': settingsEntity, 'settings.rate_plan.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }), 'settings.rate_plan.deleted': settingsEntity, /** Modül 28: paket (oda + ek hizmet demeti). */ 'settings.package.created': settingsEntity, 'settings.package.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }), 'settings.package.deleted': settingsEntity, /** Modül 34: yield kural parametreleri değişti. |
| `settings.price_adjustment.changed` | Modül 34: onaylanan fiyat ayarı uygulandı / geri alındı (gece hassasiyetli çarpan). |

### spa.*

| Olay | Açıklama |
| --- | --- |
| `spa.charged` |  |
| `spa.appointment.changed` | Randevu / ders kaydı açıldı, değişti, tamamlandı, iptal edildi, gelmedi, geri alındı, odaya yazıldı, yedekten asıla geçti. |
| `spa.session.changed` | Grup dersi seansı açıldı / değişti / yapıldı / iptal edildi. |
| `spa.payment.changed` | Spa kasasında ödeme: alındı, onaya gitti, işlendi, reddedildi, iptali istendi / uygulandı / reddedildi. |
| `spa.setup.changed` | Tanım ya da ayar değişti (hizmet, terapist, oda, blok, ayar). |

### staff.*

| Olay | Açıklama |
| --- | --- |
| `staff.alert.raised` | Personel uyarısı açıldı ya da birleşerek öne çıktı. Kime gittiği (`userId` ya da `permission`) gövdede: paneller yalnızca kendilerini ilgilendiren uyarıda rozeti artırır, herkes sunucuya sormaz. |

### stock.*

| Olay | Açıklama |
| --- | --- |
| `stock.changed` | Stok değişti: mal kabul girişi, depo tanımı, minimum seviye (modül 45); elle hareket (çıkış / fire / transfer), sayım onayı, satış düşümü (adisyon kapanışında reçeteden) ve satış noktası → depo ayarı (modül 44). `stockItemIds` miktarı değişen malzemeler: inventory-worker minimum altına düşeni buradan izler. |

### survey.*

| Olay | Açıklama |
| --- | --- |
| `survey.response.submitted` | Misafir anketi cevapladı (kişisel veri taşımaz). Düşük puan takibi açıldıysa `lowScore`. |
| `survey.analysis.requested` | Açık uçlu cevabın AI etiketi istendi (insight-agent) / yazıldı. |
| `survey.analysis.completed` |  |
| `survey.insight.requested` | Dönemin tema özeti istendi (insight-agent) / yazıldı. |
| `survey.insight.completed` |  |
| `survey.followup.changed` | Takip açıldı / üstlenildi / not eklendi / kapandı / yeniden açıldı. |
| `survey.settings.changed` | Ekran olayı: anket tasarımı, ayar ya da davetler değişti. |

### waitlist.*

| Olay | Açıklama |
| --- | --- |
| `waitlist.changed` | Bekleme listesi kaydı açıldı, yer açıldı / doldu, çevrildi ya da kapandı. |

## Zamanlanmış işler

Olay beklemeden belirli aralıklarla kendiliğinden koşan işler (sunucu açıkken). Aralıklar koddaki sabitlerden okunur (ms: milisaniye; 60_000 = 1 dakika). Açıklamalar iş dosyalarının başındaki yorumlardır.

### agency-bonus

Aralık sabitleri: `PROGRESS_INTERVAL_MS` = 30 * 60_000

Acente bonusunun zamanlanmış işi (modül 35, yalnızca sunucu sürecinde).

| İş                  | Sıklık | Ne yapar |
|---------------------|--------|----------|
| Hedef ilerlemesi    | 30 dk  | Yürürlükteki kuralların gerçekleşen üretim / puan / kademe özeti; kademe yükselince uyarı |
| Dönem sonu hak edişi| aynı tur | Dönemi biten kuralın hak edişini hesaplar, yetkiliye "onaya gönderin" uyarısı |

Yürürlükte kuralı olan oteller sırayla işlenir; bir otelin hatası diğerlerini
durdurmaz.

### approvals

Aralık sabitleri: `EXPIRE_INTERVAL_MS` = 60_000

Onay kuyruğunun zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                    | Sıklık | Neden |
|-----------------------|--------|-------|
| Süresi dolan onaylar  | 1 dk   | Kimse karar vermeden süresi dolan onay düşer; aktör işi kapatılır, zile uyarı gider |

### assets

Aralık sabitleri: `WARRANTY_SWEEP_INTERVAL_MS` = 6 * 60 * 60_000

Demirbaş modülünün zamanlanmış işi (modül 46; yalnızca sunucu sürecinde).

| İş            | Sıklık | Neden |
|---------------|--------|-------|
| Garanti zili  | 6 saat | Garantisi uyarı penceresine giren kartlar için zil (kart ve bitiş tarihi başına bir kez; aynı günün kartları tek zilde) |

### banquet

Aralık sabitleri: `SWEEP_INTERVAL_MS` = 15 * 60_000 · `HOUR_MS` = 3_600_000

Banketin zamanlanmış işi (modül 37, yalnızca sunucu sürecinde). Her tur, açık
etkinliği olan oteller sırayla; bir otelin hatası diğerlerini durdurmaz.

| Ne                         | Ne yapar |
|----------------------------|----------|
| Opsiyon süresi doldu       | Son günü (otelin iş günüyle) geçen opsiyon düşer: salon bırakılır, dosya talebe döner; sorumluya ve sırası yükselenlere haber |
| Opsiyonun son günü         | Sorumluya "bugün kesinleştirin ya da uzatın" (günde bir) |
| Gecikmiş taksit            | Vadesi geçip ödenmemiş tutar: sorumluya (günde bir) |
| Kapatılmamış etkinlik      | Son oturumu bitmiş kesin etkinlik: "gerçekleşen kişiyi girip kapatın" (bir kez) |
| Menü kesinleşmedi (43)     | İlk gününe politikadaki gün kadar kalan kesin etkinliğin mutfağa kesinleşmemiş menüsü: sorumluya (bir kez) |

Hatırlatmalar `dedupeKey` ile **bir kez** yazılır (her tur yeniden "okunmadı"
yapmasın diye var olan anahtar atlanır).

### channel-manager

Aralık sabitleri: `SYNC_INTERVAL_MS` = 5_000 · `BOOKING_POLL_INTERVAL_MS` = 60_000 · `ICAL_INTERVAL_MS` = 60_000 · `PURGE_INTERVAL_MS` = 6 * 60 * 60_000

Kanal yönetiminin zamanlanmış işleri (modül 33, yalnızca sunucu sürecinde).

| İş                     | Sıklık | Ne yapar |
|------------------------|--------|----------|
| Gönderim turu          | 5 sn   | Kirli kanallara farkı, zamanı gelene tam eşitlemeyi gönderir (kanal başına en sık 10 sn) |
| Rezervasyon akışı      | 60 sn  | Senkrondaki Channex kanallarının teyit edilmemiş revizyonları (webhook gelince hemen) |
| Takvim okuma           | 60 sn  | Zamanı gelen iCal kanalları (kanal başına 15 dk'da bir) |
| Log temizliği          | 6 sa   | 90 günden eski senkron logu |

### channels

Aralık sabitleri: `PENDING_INTERVAL_MS` = 60_000 · `PENDING_MIN_AGE_MS` = 60_000

Mesaj kanallarının zamanlanmış işi (modül 8, yalnızca sunucu sürecinde).

Cevap normalde yazıldığı anda gönderilir (`guest.message.reply` → geçit).
Bu iş geride kalanları toplar:
- kanal kapalıyken yazılmış ve kanal açılınca bekleyen cevaplar,
- geçici hatadan (Meta 5xx, hız sınırı) sonra yeniden denenecekler,
- geçidin sırası dolduğu için atlanmış olanlar,
- süreç gönderirken kapandıysa sahipliği süresi dolmuş olanlar.

Mesaj önce sahiplenildiği için olay yolu ile bu iş aynı mesajı iki kez
göndermez. Geçit yönetim panelinden kapatıldıysa o otelin mesajı gönderilmez.

### concierge

Aralık sabitleri: `STALL_AFTER_MS` = 5 * 60_000 · `SWEEP_INTERVAL_MS` = 60_000

AI asistanının zamanlanmış işi (modül 8, yalnızca sunucu sürecinde).

AI modundaki konuşmada misafir `STALL_AFTER_MS`'den uzun süredir cevap
bekliyorsa konuşma personele devredilir. Normalde AI saniyeler içinde
cevap verir ya da kendisi devreder; bu iş geri kalan her durumun sigortası:
- AI ajanları arka planda çalışır; süreç tur ortasında kapanırsa sıradaki
  işler kaybolur,
- yoğunlukta sıra birikmiş olabilir,
- sağlayıcı cevap vermeden takılmış olabilir.
Misafir her durumda "ekibimiz dönecek" bilgisini alır; personelin ziline uyarı düşer.

Kısmi index'li (`Conversation_ai_waiting_idx`): yalnızca AI'da bekleyen
konuşmalar taranır.

### exchange-rates

Kur işi (modül 60): saatte bir, otomatik çekme açık otellerin iş günü kurları TCMB'den yazılır (gün değişince ve gün kapanınca yeni
iş gününün kuru da gelir; aynı kur yeniden yazılmaz).
@param {{ info: Function, error: Function }} logger

### folios

Aralık sabitleri: `ROOM_CHARGE_CHECK_INTERVAL_MS` = 5 * 60_000

Folyo modülünün zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                      | Sıklık | Neden |
|-------------------------|--------|-------|
| Gecenin oda ücretleri   | 5 dk   | Otelin iş günü dönünce dün gecenin çalışması bir kez açılır, folyo aktörüne haber gider |

İşin kendisi (2500 konaklamaya kalem) aktörde; zamanlayıcı yalnızca "gece
bitti" haberini verir. Sunucu kapalıyken geçen geceler sonraki açılışta
tek çalışmayla telafi edilir (uzlaştırma eksik bütün geceleri işler).

### guest-portal

Aralık sabitleri: `INVITE_INTERVAL_MS` = 30 * 60_000 · `PURGE_INTERVAL_MS` = 60 * 60_000

Misafir portalının zamanlanmış işleri (yalnızca sunucu sürecinde) ve olay abonelikleri (modül 53).

| İş                          | Sıklık | Neden |
|-----------------------------|--------|-------|
| Online check-in davetleri   | 30 dk  | Girişten N gün önce; gün dönünce yeni günün varışları sıraya girer |
| Belge fotoğraflarının silinmesi | 1 sa | KVKK: saklama süresi dolan kimlik fotoğrafı ve gönderime bağlanmamış yükleme |

### housekeeping

Aralık sabitleri: `STAYOVER_CHECK_INTERVAL_MS` = 10 * 60_000

Kat hizmetlerinin zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                  | Sıklık | Neden |
|---------------------|--------|-------|
| STAYOVER üretimi    | 10 dk  | Otelin iş günü dönünce konaklayan odaların günlük temizlik görevleri bir kez açılır |

Üretim idempotent: o güne görevi olan oda atlanır, ikinci koşu hiçbir şey
üretmez. Sunucu kapalıyken geçen sabah sonraki açılışta telafi edilir —
iş "saat 06:00'da üret" değil "bugünün görevleri eksikse tamamla"dır.

### hr

Aralık sabitleri: `DOCUMENT_REMINDER_INTERVAL_MS` = 12 * 60 * 60_000

İK'nın zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                          | Sıklık  | Neden |
|-----------------------------|---------|-------|
| Özlük belgesi hatırlatması  | 12 saat | Süresi ayardaki gün içinde dolacak / dolmuş belgeler İK'ya zil (belge başına 7 günde bir) |

### integrations

Aralık sabitleri: `SEND_INTERVAL_MS` = 15_000 · `PURGE_INTERVAL_MS` = 60 * 60_000

Entegrasyonun zamanlanmış işleri (yalnızca sunucu sürecinde, modül 61).

| İş                 | Sıklık | Neden |
|--------------------|--------|-------|
| Webhook gönderimi  | 15 sn  | Yeniden denemelerin vakti gelenler; olay anında da uyandırılır (`kickWebhookSender`) |
| Teslimat temizliği | 1 sa   | 30 günden eski teslimatlar silinir, süresi geçen eski imza sırları atılır |

### lost-items

Aralık sabitleri: `PHOTO_PURGE_INTERVAL_MS` = 60 * 60_000

Kayıp eşya modülünün zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                              | Sıklık | Neden |
|---------------------------------|--------|-------|
| Kapanan eşyaların fotoğrafları  | 1 sa   | Teslim edilen / kapatılan eşyanın fotoğrafı bir ay sonra gereksiz kişisel veri; disk de dolmasın |

### loyalty

Aralık sabitleri: `INTERVAL_MS` = 12 * 60 * 60_000

Sadakatin zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                              | Sıklık  | Neden |
|---------------------------------|---------|-------|
| Puan süresi ve seviye tazeleme  | 12 saat | Süresi dolan kullanılmamış puan düşer; 12 aylık seviye penceresi kayar |

### maintenance

Aralık sabitleri: `PLAN_CHECK_INTERVAL_MS` = 6 * 60 * 60_000 · `PHOTO_PURGE_INTERVAL_MS` = 24 * 60 * 60_000

Teknik servisin zamanlanmış işleri (yalnızca sunucu sürecinde).

| İş                        | Sıklık | Neden |
|---------------------------|--------|-------|
| Periyodik bakım biletleri | 6 saat | Süresi gelen planlardan bilet üretir (plan başına tek açık bilet) |
| Kapanmış bilet fotoğrafı  | 24 saat| Çözülen biletlerin fotoğrafları süre dolunca silinir |

### notifications

Aralık sabitleri: `DISPATCH_INTERVAL_MS` = 15_000 · `STALE_RECOVERY_INTERVAL_MS` = 60_000 · `OVERDUE_SCAN_INTERVAL_MS` = 60_000 · `DELIVERY_REPORT_INTERVAL_MS` = 120_000 · `ALERT_PURGE_INTERVAL_MS` = 60 * 60_000

Bildirim merkezinin zamanlanmış işleri (yalnızca sunucu sürecinde çalışır;
testler ve betikler başlatmaz; çalıştırıcı: `lib/recurring.js`).

| İş                        | Sıklık  | Neden |
|---------------------------|---------|-------|
| Sıradaki bildirimler      | 15 sn   | Yeniden deneme ve sessiz saat sonrası gönderim (yeni bildirim zaten anında tetikler) |
| Takılı gönderim kurtarma  | 1 dk    | Süreç gönderim sırasında kapandıysa |
| Geciken istek taraması    | 1 dk    | "Hedef süresi geçti" uyarısı (olay yok, zamanla olur) |
| SMS teslim raporu         | 2 dk    | Netgsm: dakikada en fazla 10 sorgu |
| Eski uyarıları silme      | 1 sa    | Zil bir iş listesi değil; 30 gün saklanır |

Her iş kendi turunu bitirmeden yeniden başlamaz; hatası log'a düşer, diğer
işleri durdurmaz.

### payment-gateway

Sanal POS'un zamanlanmış işleri (modül 50).

| İş                         | Sıklık | Neden |
|----------------------------|--------|-------|
| Takılan ödemeyi sonuçlandır | 5 dk   | Geri dönüşü gelmeyen "ödeme sürüyor" link sağlayıcıya sorulur |
| Süresi dolan link          | 15 dk  | Ödenmemiş, süresi geçmiş link "süresi doldu" olur |
| Folyoya yazılamayan ödeme   | 5 dk   | Alınmış ama yazılamamış ödeme (ör. açık folyo yoktu) yeniden yazılır |
| Takılan iade               | 15 dk  | 15 dakikadır "iade ediliyor"da kalan iade için zil (sağlayıcıda kontrol) |

### pos

Aralık sabitleri: `SWEEP_INTERVAL_MS` = 15 * 60_000 · `HOUR_MS` = 3_600_000

Restoran POS'un zamanlanmış işi (modül 39, yalnızca sunucu sürecinde). Her tur, açık
vardiyası olan oteller sırayla; bir otelin hatası diğerlerini durdurmaz.

| Ne                        | Ne yapar |
|---------------------------|----------|
| Uzun açık vardiya         | 16 saati geçen vardiya: şef garsona "kasayı sayıp kapatın" (bir kez) |
| Unutulmuş adisyon         | 8 saati geçen açık adisyon: şef garsona (bir kez) — gün sonunda masada adisyon kalmasın |

Uyarılar `dedupeKey` ile **bir kez** yazılır (var olan anahtar atlanır).

### pricing

Aralık sabitleri: `GENERATE_INTERVAL_MS` = 6 * 60 * 60_000

Dinamik fiyatın zamanlanmış işi (modül 34; yalnızca sunucu sürecinde).

| İş                 | Sıklık | Neden |
|--------------------|--------|-------|
| Öneri üretimi      | 6 saat | Günde bir değerlendirme yeter; iş idempotent olduğu için (çakışan bekleyen öneri atlanır) sık koşmak kuyruğu şişirmez, sunucu yeniden başlasa da gün kaçmaz |

2500 oda ölçeği: otel başına tek envanter anlık görüntüsü + tek geçen-yıl
sorgusu; oteller sırayla işlenir, birinin hatası diğerini durdurmaz.

### reports

Aralık sabitleri: `STATS_INTERVAL_MS` = 60 * 60_000

Rapor modülünün zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                      | Sıklık | Neden |
|-------------------------|--------|-------|
| Gelir özeti (kapanmış gün) | 1 sa | Son günlerin geç düzeltmeleri, eski günlerin doldurulması ve onarımı (bkz. `stats.js`) |

Özet yalnızca raporu hızlandırır: iş hiç çalışmasa da rapor doğrudur
(özeti olmayan gün canlı okunur).

### reservations

Aralık sabitleri: `WAITLIST_SCAN_INTERVAL_MS` = 5 * 60_000

Rezervasyon modülünün zamanlanmış işi (yalnızca sunucu sürecinde).

| İş                        | Sıklık | Neden |
|---------------------------|--------|-------|
| Bekleme listesi taraması  | 5 dk   | Olay kaçarsa (süreç kapandı) açılan yer yine fark edilsin; girişi geçen kayıtlar kapansın |

Asıl tetik olaylardır (`subscribers.js`); bu tarama güvenlik ağıdır.

### reviews

Misafir yorumlarının işleri (modül 54).

| İş                     | Sıklık | Neden |
|------------------------|--------|-------|
| Yorum analiz kuyruğu   | 1 dk   | Bekleyen yorumlardan en çok 40'ı AI'a gönderilir |
| Olumsuz konu artışı    | 6 sa   | Son 7 gün ↔ önceki 4 hafta; artışta müdüre zil |

### sales

Aralık sabitleri: `SWEEP_INTERVAL_MS` = 30 * 60_000

Satış CRM'in zamanlanmış işi (modül 36; yalnızca sunucu sürecinde).

| İş              | Sıklık | Neden |
|-----------------|--------|-------|
| Satış süpürmesi | 30 dk  | Geçerliliği geçen gönderilmiş teklifler süresi doldu olur; takip tarihi gelen fırsatlar için günde tek birleşik zil (dedupeKey) çalar — 30 dakikalık tur sunucu yeniden başlasa da günü kaçırmaz, zil mükerrer çalmaz |

### spa

Aralık sabitleri: `REMINDER_INTERVAL_MS` = 5 * 60_000 · `BUDGET_MS` = 30_000 · `HOUR_MS` = 3_600_000

Spa'nın zamanlanmış işi (yalnızca sunucu sürecinde, modül 57).

| İş                     | Sıklık | Neden |
|------------------------|--------|-------|
| Randevu hatırlatması   | 5 dk   | Randevudan ayardaki saat kadar önce (varsayılan 2 saat) misafire hatırlatma |

Hatırlatma yalnız konaklamaya bağlı açık randevuya gider. Randevu hatırlatma süresinden daha kısa süre önce
alındıysa (onay bildirimi az önce gitti) hatırlatma gönderilmez. Her randevu önce **sahiplenilir**
(`reminderSentAt` koşullu yazılır): iki süreç aynı anda çalışsa da tek hatırlatma gider. Sahiplenme randevunun
sürümünü (`updatedAt`) ilerletmez — ekranı açık personelin işlemi "bayat" sayılmasın.

### surveys

Aralık sabitleri: `SURVEY_INTERVAL_MS` = 15 * 60_000

Anketin zamanlanmış işi (yalnızca sunucu sürecinde, modül 55).

| İş              | Sıklık | Neden |
|-----------------|--------|-------|
| Anket davetleri | 15 dk  | Gönderim saati otelin ayarı (ör. 11:00, ara ankette 18:00): saatin ilk çeyreğinde gider |

## Veri modeli

Veritabanında 257 tablo var. Açıklamalar şemadaki `///` yorumlarından; alan sayısı ilişkiler hariç yaklaşık değerdir.

| Tablo | Alan | Açıklama |
| --- | --- | --- |
| `Hotel` | 32 |  |
| `User` | 12 |  |
| `RefreshToken` | 8 |  |
| `RolePermission` | 6 | Rol → izin matrisi (modül 2 — RBAC). Bir otelin hiç satırı yoksa çözüm koddaki varsayılanlara düşer; matris kaydedilince tüm roller için satır yazılır ve DB kaynak olur. ADMIN satır tutmaz — kod her zaman ADMIN'e tüm izinleri verir. |
| `EventLog` | 14 |  |
| `ProcessedEvent` | 7 |  |
| `ActorSetting` | 11 | Aktörün otel bazındaki ayarı (modül 12). Satır yoksa aktör açıktır. |
| `AuditLog` | 13 | Kullanıcı denetim izi: hangi kaydı kim, ne zaman, neyi neye çevirerek değiştirdi. ActivityLog aktör/event odaklıdır; bu tablo insan odaklıdır (modül 10'un "kullanıcı audit listesi" ekranı bunu okuyacak). |
| `ActivityLog` | 16 |  |
| `Approval` | 21 | Onay kuyruğu (modül 11): personelin karar vermesi gereken iş. `data` isteyenin verdiği serbest yapı (ekranda gösterilir, yorumlanmaz); `amount`/`currency` listede "tutar" sütunu için ayrı tutulur. |
| `PendingAction` | 10 | Onay verilince kaldığı yerden devam edecek aktör işi: olayın zarfı olduğu gibi saklanır. Aynı olay için ikinci istek açılmaz (`actorName`, `eventId` tekil); devam bir kez yapılır (`resumedAt`). |
| `ManualTask` | 18 | Aktörün yapamadığı iş (modül 3, 12): aktör kapalıydı, hata verdi ya da iş sırası doluydu. İşin modülüne yetkili personel üstlenir, tamamlar ya da "gerek kalmadı" der. |
| `LlmUsage` | 13 |  |
| `LlmUsageDaily` | 10 | LLM kullanımının günlük özeti (modül 12): otel × iş günü × ajan × model. Her model çağrısı `LlmUsage`'a bir satır yazar; büyük otelde günde on binlerce satır demek. Bütçe denetimi ve kullanım ekranları o satırları toplamak yerine buradan okur: çağrı kaydedilirken aynı transaction'da sayaçlar artırılır (`ON CONFLICT DO UPDATE`). |
| `Notification` | 32 | Misafire giden bildirim (modül 9) — aynı zamanda gönderim kuyruğu (outbox). Metin kuyruğa yazılırken şablondan üretilip dondurulur: şablon sonradan değişse de geçmiş, misafire gerçekte ne gittiğini gösterir. |
| `NotificationTemplate` | 12 | Bildirim şablonu: olay × kanal × dil başına bir tane (modül 9). |
| `NotificationChannelConfig` | 16 | Kanal ayarı (SMTP, SMS sağlayıcısı, WhatsApp) — otel × kanal başına bir tane. Parola ve API anahtarı `secret` alanında **şifreli** durur (AES-256-GCM, anahtar sunucu ortamında); API hiçbir zaman geri döndürmez. |
| `StaffAlert` | 16 | Personel uyarısı (üst bardaki zil). Soft-delete yok: uyarı bir iş kaydı değil, `STAFF_ALERT_RETENTION_DAYS` sonra kalıcı silinir. Kime gideceği ya bir kişi (`userId`) ya da bir izin (`permission`, o izne sahip herkes) — 2500 kişiye satır çoğaltılmaz. |
| `StaffAlertRead` | 3 | Kişinin okuduğu uyarı. |
| `StaffAlertState` | 5 | Kişinin zil durumu: son bakış (rozet bundan sonrasını sayar) ve susturduğu türler. |
| `RoomType` | 12 |  |
| `Room` | 11 | Oda durumu üç bağımsız bilgidir: `occupancy` (boş/dolu), `housekeepingStatus` (kirli/temiz...) ve tarihli arıza kaydı (`RoomBlock`). "Arızalı" bir kolon değildir; o günü kapsayan bloktan okunur — böylece ileri tarihli arıza kaydı günü gelince zamanlayıcı gerekmeden etkin olur ve bitince kendiliğinden kalkar. |
| `RoomBlock` | 11 | Tarihli arıza kaydı: odanın belirli günlerde arızalı ya da hizmet dışı olması. Tarihler UTC gün başıdır (veritabanı kısıtıyla zorunlu). `endDate` boşsa blok süresizdir. Geçmiş kayıt değiştirilmez: süren blok "bitirilir" (bitişi bugüne çekilir), başlamamış blok iptal edilir (soft-delete). Rezervasyonla çakışması veritabanı tetikleyicisiyle engellenir (`Reservation_room_blocked`, `RoomBlock_has_reservations`). |
| `Guest` | 23 |  |
| `GuestPreference` | 12 | Misafir tercihi (modül 22): kategori + değer + kaynak + güven + son teyit. Serbest metin değil yapılandırılmış; birleştirmede (`mergeGuests`) hedef misafire taşınır. VIP / sorunlu gibi işaretler `Guest.tags` üzerinde. |
| `GuestNote` | 9 | Misafir notu (modül 22): tarihli, yazarlı; sabitlenen not kartın üstünde. |
| `Reservation` | 54 |  |
| `ReservationGroup` | 9 | Grup rezervasyonu (modül 4): tek formda açılan birden fazla oda. Odalar ayrı `Reservation` kayıtlarıdır; grup yalnızca onları bağlar. |
| `ReservationNight` | 12 | Konaklamanın gece gece fiyatı (modül 4). Toplam fiyat bunların toplamıdır; gelir raporları (modül 13, 23) ve folyo (modül 15) geceyi buradan okur. `baseRate`/`multiplier` hesaplanan fiyatta dolu, elle fiyatta ve eski kayıtlardan aktarılan gecelerde boştur. |
| `WaitlistEntry` | 24 | Bekleme listesi (modül 4): yer yokken "listeye al"; yer açılınca personele uyarı gider (`AVAILABLE`), rezervasyona çevrilince kapanır. |
| `RoomStaySegment` | 11 | Bir konaklamanın **kapanmış** oda dilimi: misafir içerideyken oda değiştirdiğinde eski odada geçirdiği geceler `[startDate, endDate)`. Rezervasyonun tek bir `roomId`'si var; bu tablo olmadan oda değişikliği geçmişi yeniden yazıyordu (misafir geçmiş gecelerde de yeni odada görünüyordu). Açık dilim rezervasyonun kendisidir: `[coalesce(roomSince, checkIn), checkOut)` → `roomId`. Yalnızca eklenir; düzeltme soft-delete ile yapılır. Gece kapanışı (modül 18), faturalama (modül 16) ve kat hizmeti "o gece hangi odadaydı" sorusunu buradan cevaplar. |
| `ReservationGuest` | 8 |  |
| `RatePlan` | 16 |  |
| `Lead` | 22 | Satış fırsatı (modül 36): telefonla/e-postayla gelen her talep kayıtlı. Pano akışı NEW → QUOTED → WAITING → WON/LOST; WON yalnız teklif kabulüyle (`wonReservationId` dolu), LOST sebep ister. Misafir kartına bağ isteğe bağlı (M22); istenen konaklama alanları teklif formunu önceden doldurur. |
| `CallLog` | 12 | Arama kaydı (modül 36): ekle-yalnız günlük (düzenlenmez/silinmez; düzeltme yeni kayıtla). FlexAI 2.0'a hazır: `channel` SESLİ AI olabilir, `recordingRef` santral kaydını, `summary` özetini taşır (101 buraya yazar). |
| `Quote` | 24 | Teklif (modül 36): fiyat hazırlandığı anda kilitlenir — `nightsSnapshot` gece gece tutarları (M28 plan + M34 çarpan dahil o anki sistem fiyatı) taşır; sonradan fiyat değişse de teklif sözü değişmez. Kabul edilince rezervasyon bu toplamla (elle fiyat, gerekçe teklif kodu) açılır. |
| `PriceSuggestion` | 17 | Modül 34: dinamik fiyat önerisi. Günlük iş (kural tabanlı) ya da pricing-agent (LLM) üretir; **hiçbir fiyat kendiliğinden değişmez** — her öneri M11 onay kuyruğuna düşer, onaylanınca dönemin her gecesine `PriceAdjustment` yazılır. Gerekçe serbest metin + yapılandırılmış girdiler (`inputs`: doluluk, kalan gün, geçen yıl... — FlexAI 2.0: 90/91 modülleri buraya alan ekleyecek). |
| `PriceAdjustment` | 9 | Modül 34: onaylanmış gece hassasiyetli fiyat çarpanı. Standart satış fiyatının (plan ya da sezon) üstüne uygulanır; acente kontratı, paket ve elle fiyat nettir, etkilenmez. Bir geceye tek ayar: yeni onay eskisini günceller (upsert), geçmiş denetim izinde. |
| `Package` | 12 |  |
| `Season` | 9 |  |
| `Tax` | 9 |  |
| `Conversation` | 23 | Misafirle bir kanal üzerindeki konuşma (WhatsApp numarası, web chat oturumu). Liste ekranı her satır için mesaj saymasın diye son mesaj özeti ve okunmamış sayacı burada tutulur; mesaj yazan her işlem aynı transaction'da günceller. |
| `Message` | 17 |  |
| `GuestRequest` | 26 | Misafir isteği: havlu, oda servisi, uyandırma, arıza bildirimi, şikâyet. Konuşmadan, telefondan ya da resepsiyondan doğabilir. `dueAt` hizmet süresi hedefidir (SLA): önceliğe göre sunucuda hesaplanır, geçerse istek "gecikmiş" sayılır. Uyandırma gibi zamanlı isteklerde `scheduledFor` asıl zamandır. |
| `Folio` | 20 | Konaklamanın hesabı (modül 15). Bir konaklamanın birden fazla folyosu (penceresi) olabilir: 1 ana folyo, bölmeyle 2, 3... Kalem silinmez; iptal eksi tutarlı ters kayıttır. Bakiye = Σ kalem toplamı − Σ ödeme × kur. |
| `FolioItem` | 31 | Folyo kalemi (modül 15). Satır: net + vergi = toplam; toplam = tutar × adet + hariç vergiler. Vergi dökümü işlendiği andaki ayardan (`taxLines`). |
| `FolioRoute` | 8 | Konaklamanın yönlendirmesi (modül 15): bu tipteki sistem kalemleri (oda ücreti, restoran, minibar) bu folyoya düşer. Yoksa konaklamanın ilk açık folyosu. |
| `RoomChargeRun` | 11 | Gecenin oda ücretlerinin işlenmesi (modül 15). Zamanlayıcı gün dönünce otel başına bir kez açar (tekil) ve folyo aktörüne haber verir; işlenince tamamlanır. |
| `Payment` | 32 | Ödeme satırı (modül 17). Silinmez: hatalı giriş iptal kaydıyla (`REVERSAL`, ters tutar), misafire geri verilen para iadeyle (`REFUND`, eksi tutar) düzeltilir. Bakiyeye yalnızca işlenmiş (`POSTED`) satırlar girer. |
| `ExchangeRate` | 10 | Günlük döviz kuru (modül 17): 1 birim döviz = `rate` × otel para birimi. Otel × döviz × gün tekil; yalnızca iş günü için girilir (aynı gün yeniden girilirse güncellenir, denetim izi eski değeri tutar). Ödeme kendi kurunu saklar: kur sonradan değişse de geçmiş ödeme değişmez. |
| `MinibarItem` | 12 | Minibar ürünü (modül 19). Fiyat vergi ayarına göre (kalem tipi minibar) dahil / hariç yorumlanır. Kod otel içinde tekil (silinmemişler arasında: kısmi index `MinibarItem_hotelId_code_active_key`). |
| `MinibarConsumption` | 18 | Odanın minibar sayımı: bir fiş (modül 19). Konaklamaya yazılan fiş `minibar.consumed` olayıyla folyoya gider (`eventId`: folyo kalemlerinin tekrar işleme anahtarı `evt:<eventId>:<sıra>`); kayıp fiş folyoya gitmez. Fiş silinmez, değiştirilmez: düzeltme folyodaki kalem iptaliyle. |
| `MinibarConsumptionLine` | 8 | Minibar fişinin satırı: ürünün o anki adı ve fiyatı (fiyat sonradan değişse de fiş değişmez). |
| `LaundryItem` | 11 | Çamaşırhane fiyat listesi satırı: parça × hizmet (ör. gömlek — yıkama + ütü). Kod otel içinde tekil (kısmi index `LaundryItem_hotelId_code_active_key`). |
| `LaundryOrder` | 30 | Çamaşır siparişi (modül 19): içerideki misafir adına alınır, teslimde ücreti `laundry.charged` olayıyla folyoya gider (`chargeEventId`). Ekspres farkı sipariş anındaki ayardan (`expressPct`). |
| `LaundryOrderLine` | 9 | Çamaşır siparişinin satırı: parçanın o anki adı, hizmeti ve fiyatı. |
| `NightAudit` | 15 |  |
| `ShiftReport` | 11 | Vardiya devri / kasa sayımı (modül 18). Kapanışta yöntem bazında beklenen (sistem) ve sayılan tutar, fark, devralan. `counts`: `[{ method, expected, counted, variance }]`. Devir raporu (PDF) bundan üretilir. |
| `DailyStats` | 12 | Günlük özet (modül 18 → 23 / 75 / 87): kapanan günün doluluğu, oda geliri, ADR, RevPAR ve tahsilatı. Göstergeler modül 23 tanımlarıyla (satılan gece, satılabilir = oda − arıza). Kaynak veri değişmez; kapanış anındaki özettir. FlexAI 2.0'da gece müdürü (87) ve patron uygulaması (75) bunu okur. |
| `HousekeepingTask` | 25 | Kat hizmeti görevi (modül 14). Odanın kat hizmeti durumundan ayrı kayıt: durum "oda şu an nasıl", görev "kim ne zaman ne yapacak" sorusuna cevap. Açık **temizlik** görevi oda başına tektir (kısmi tekil index, elle); misafir isteği görevleri (havlu) bundan muaftır. |
| `MaintenanceTicket` | 25 | Teknik servis / arıza-bakım bileti (modül 20). İskeletten genişletildi: yaşam döngüsü (PENDING→IN_PROGRESS→DONE/CANCELLED, `TaskStatus`), kaynak (personel, kat görevlisi bildirimi, misafir isteği, periyodik plan), oda kapatıldıysa `roomBlockId` (çözülünce kaldırılır) ve fotoğraflar. |
| `MaintenancePhoto` | 9 | Arıza fotoğrafı (modül 20; LostItemPhoto ile aynı desen). İçerik dosya deposunda; burada yalnızca üstveri. İstemci yüklemeden önce küçültür. |
| `MaintenancePlan` | 15 | Periyodik bakım planı (modül 20): aylık kontrol listeleri. Zamanlanmış iş her periyotta (`intervalDays`) plandan bir MaintenanceTicket üretir. |
| `LostItem` | 36 | Bulunan eşya (modül 21). Etiket no (`LF-XXXXXX`) poşetin üstüne yazılır; otel içinde tekil. Eşleşen misafir `guestId` (adaydan seçildiyse konaklaması da). Teslim (`RETURNED`) ve kapatma (`DISPOSED`) izleri eksiksizdir (kısıt). Saklama süresi kolon olarak tutulmaz: otel ayarından ve `businessDate`'ten hesaplanır, ayar değişince bütün açık eşyalara uygulanır. |
| `LostItemPhoto` | 8 | Kayıp eşyanın fotoğrafı (modül 21). Dosya sunucu diskinde (`lost-items/<otel>/<id>.jpg` ve önizlemesi); yalnızca yetkili personel okur. |
| `LostItemNote` | 7 | Misafirle iletişim notu (modül 21): "aradım, açmadı", "kargo adresini yolladı". Silinmez, değişmez. |
| `RevenueDayStat` | 11 | Gelir raporunun kapanmış gün özeti (modül 23): gün × oda tipi × kaynak × para birimi. Rapor bu tablodan okur; canlı sorgu yalnızca son günleri ve eldeki rezervasyonu tarar (geçmiş büyüdükçe rapor yavaşlamasın). Satırlar zamanlanmış işle yeniden hesaplanır (`modules/reports/stats.js`); kaynak veri (gece, folyo kalemi) değişmez — bu tablo yalnızca özetidir. |
| `RevenueStatDay` | 3 | Özeti hesaplanmış gün (satışı olmayan gün de işaretlenir). Rapor işaretli günü özetten, işaretsiz günü canlı okur. |
| `AiSettings` | 13 | Otelin AI asistanı ayarları (modül 8). Satır yoksa AI kapalıdır. Fiyatlar sağlayıcının 1M token başına USD fiyatıdır; model başına `{ "model": { "input": "0.40", "cachedInput": "0.10", "output": "1.60" } }`. Fiyatı tanımlı olmayan modelle çağrı yapılmaz (maliyet sayılamazsa bütçe denetlenemez). Bütçe 0 ise AI kapalı sayılır. |
| `ConversationAiState` | 15 | AI asistanının konuşma başına hafızası (modül 8): özet, son müsaitlik teklifleri, misafire sunulup onay bekleyen teklif, gönderilmiş rezervasyon isteği. |
| `MessagingChannel` | 15 | Mesaj kanalı bağlantısı (modül 8): WhatsApp Cloud API ya da web chat balonu. - WhatsApp: `externalAccountId` = Meta telefon numarası kimliği; sırlar (erişim token'ı, uygulama sırrı, webhook doğrulama token'ı) `secret` içinde şifreli JSON. Webhook adresi kayda özel: `/webhooks/whatsapp/{id}`. - Web chat: `publicKey` sitedeki balonun genel anahtarı (gizli değil); `settings.allowedOrigins` balonun gömülebileceği site adresleri. |
| `Budget` | 12 | Yılın bütçe sürümü (modül 27). Yıl başına en fazla bir taslak ve bir onaylı (kısmi tekil index'ler, migration). Onaylı sürüm kilitlidir; değişiklik için revize taslağı açılır (satırları kopyalanır), revize onaylanınca önceki onaylı "eski sürüm" olur. Silinmez: sapma raporu geçmişte neye göre çıktığını gösterebilmeli. |
| `BudgetLine` | 8 | Bütçe satırı: kalem × ay plan değeri. Kalem sistem kalemi kodu (ROOM_REVENUE, OCCUPANCY...) ya da gider kaleminin kimliği. Doluluk yüzde (0–100), diğerleri otelin para biriminde, vergiler hariç. |
| `BudgetExpenseItem` | 8 | Otelin gider kalemleri (bütçe sürümlerinden bağımsız: gerçekleşen de bunlara bağlı). Kaldırılan kalem arşivlenir; eski bütçelerde görünmeye devam eder. |
| `BudgetExpenseActual` | 9 | Giderin gerçekleşeni (ay ay elle; satın alma ve ön muhasebe — modül 45 / 47 — gelince oradan hesaplanır). Bütçe sürümünden bağımsızdır. |
| `BudgetCommentary` | 15 | AI sapma yorumu (modül 27): bir dönem için istenir, ajan (budget-agent) yazar. Aynı dönem için aynı anda tek bekleyen istek (kısmi tekil index). |
| `Agency` | 17 | Acente kartı (modül 29): firma, yetkili, iletişim, komisyon, vade. Rezervasyonu olan acente silinmez, pasife alınır. Kod ve ad otel içinde tekil (büyük / küçük harf duyarsız: migration'daki index'ler). |
| `Contract` | 17 | Acente kontratı (modül 29): dönem + fiyat satırları + stop-sale. Taslak satışa kapalıdır; aktif kontrat acentenin o günkü satış fiyatını belirler. Acentenin aynı günü kapsayan en fazla bir aktif kontratı olur (EXCLUDE kısıtı, migration). Rezervasyonu olan kontrat silinmez, sonlandırılır (rezervasyonlar fiyatını açıldığı günkü haliyle taşır). |
| `ContractRate` | 9 | Kontrat fiyat satırı (modül 29): oda tipi × pansiyon × dönem için oda başı gecelik fiyat. Aynı kontratta aynı oda tipi + pansiyon için dönemler çakışmaz (EXCLUDE, migration). |
| `ContractStopSale` | 9 | Kontrat stop-sale'i (modül 29): bu günlerde acente satamaz. Oda tipi boşsa kontratın bütün oda tipleri. Aynı kapsamda çakışan kayıt olmaz (EXCLUDE, migration). |
| `Allotment` | 13 | Allotment (modül 30): acenteye dönem boyunca gecelik ayrılan oda kotası. Release tarihine (giriş gecesi − `releaseDays`) kadar kullanılmamış kota genel satışa kapalıdır; o günden itibaren genel havuza döner. Kota bir **garantidir, tavan değil**: dolunca acente genel havuzdan satmaya devam eder. Kullanım ayrı bağla tutulmaz — acentenin o oda tipi + geceyi kapsayan geçerli rezervasyonları kotaya mahsup edilir (türetilir). |
| `Promotion` | 26 | Promosyon (modül 31): koşulu tutan doğrudan satışa kendiliğinden (`requiresCoupon = false`) ya da kuponla uygulanan indirim. Bir rezervasyona tek indirim düşer (en avantajlısı); acente satışına uygulanmaz. Rezervasyon açılırken koşullarıyla kopyalanır. Kullanılmış promosyon silinmez, durdurulur. Tutarlılık kısıtları ve ad tekilliği migration'da. |
| `Coupon` | 10 | Kupon (modül 31): bir promosyonu kodla açar. Kod otel içinde tekil. Kullanım = kuponla açılmış geçerli (iptal / gelmedi olmayan) rezervasyon sayısı — sayaç tutulmaz, kupon satırı kilitlenip sayılır (iptalde hak kendiliğinden geri açılır). Her oda bir kullanım. |
| `Channel` | 21 | Satış kanalı (modül 33). Channex: OTA'lara (Booking, Expedia, Airbnb…) aracı; müsaitlik oda tipine, fiyat ve stop-sale fiyat planına gider, rezervasyonlar revizyon akışından alınır. iCal: kanal takvimimizi okur (dışa aktarma), biz kanalınkini okuruz (içe aktarma). Gönderim "fark" ile yapılır: değişiklikler kanalı kirli işaretler (`dirtyFrom` / `dirtyTo`), zamanlanmış iş penceredeki değerleri hesaplayıp kanala en son gönderilenle (`ChannelAriState`) karşılaştırır, yalnızca farkı gönderir. Silme yumuşaktır (log ve rezervasyon bağları kalır). Ad tekilliği (büyük / küçük harf duyarsız) ve Channex mülkünün tek kanala bağlanması: kısmi index'ler (migration). |
| `ChannelState` | 18 | Kanalın gönderim / alım durumu (modül 33). Ayardan ayrı tutulur: kanal ayarının sürümü (`Channel.updatedAt`, optimistic lock) her gönderimde ilerlemesin — ayar formu açık duran yönetici, arka planda giden bir gönderim yüzünden "kayıt değişti" görmesin. |
| `ChannelRoomMapping` | 13 | Bizim oda tipi ↔ kanalın oda tipi (Channex) ya da iCal takvimi (bir ilan / tip). Eşleştirme kaydı oda tipiyle tekildir ve yeniden kaydedilince korunur: iCal dışa aktarma adresinin belirteci (`exportToken`) kanala verildiği için değişmemeli. |
| `ChannelRateMapping` | 9 | Kanalın fiyat planı ↔ bizim oda tipi + pansiyon (Channex). Gelen rezervasyonun pansiyonu buradan. |
| `ChannelAriState` | 6 | Kanala en son başarıyla gönderilen değerler (gün → değer): fark bununla hesaplanır. Kanalın kimliğiyle tutulur (eşleştirme yeniden kaydedilse de geçerli kalır). |
| `ChannelStopSale` | 9 | Kanala özel satış kapatma (iki uç dahil). Oda tipleri boşsa kanaldaki bütün tipler. |
| `ChannelSyncLog` | 14 | Senkron logu: ne gönderildi / alındı, sonuç, kanalın uyarıları ve hata. 90 gün saklanır. |
| `ChannelBooking` | 21 | Kanaldaki rezervasyon (OTA rezervasyonu ya da iCal kaydı) ve bizdeki karşılığı. Her oda ayrı bir `Reservation`dır (`channelRoomIndex`). Revizyonlar sırayla uygulanır; eski revizyon yenisinin üstüne yazılmaz (`appliedRevisionAt`). |
| `ChannelBookingRevision` | 12 | Kanaldan gelen revizyon (yeni / değişiklik / iptal): kalıcı olarak saklanır, kanala teyit edilir, sonra aktör işler. Kart bilgisi saklanmaz (normalleştirilmiş gövde). |
| `AgencyBonusRule` | 28 | Acente hedef / prim kuralı (modül 35): acentenin bir dönemdeki gece ya da ciro hedefi ve kademeli prim oranları. Üretim = dönemde gerçekleşen geceler; ciro = bu gecelerin folyoya işlenen vergisiz oda geliri. İlerleme özeti (`progress*`) zamanlanmış işte ham SQL ile yazılır: `updatedAt`'e dokunmaz (formdaki sürüm kontrolünü bozmaz). |
| `AgencyBonus` | 45 | Dönem sonu hak edişi (modül 35): kuralın hesap anındaki kopyası ve sonucu. Kural başına bir tane; yeniden hesaplama aynı satırı günceller (`revision` artar), onaylanınca kilitlenir. |
| `AgencyBonusLine` | 6 | Hak edişin dayandığı rezervasyonlar (hesap anında dondurulur): dönemdeki gerçekleşen gece ve vergisiz oda geliri. Denetim ve itiraz için "hangi rezervasyonlar sayıldı" sorusunun cevabı. |
| `Venue` | 16 | Salon (modül 37). Bölünebilir salon: bütün (`parentId` boş, parçaları var) ve parçaları (`parentId` = bütün). Bütün satılınca parçaları da dolar; parça satılınca bütün dolar — salon tutma satırları "atomik parça" başına yazıldığı için veritabanı kısıtı bunu da korur. |
| `VenueCapacity` | 4 | Salonun düzene göre kapasitesi. |
| `EventEquipment` | 10 | Banket ekipmanı (projeksiyon, ses sistemi, sahne…): stoklu; aynı saatte stoktan fazlası ayrılamaz. |
| `EventClient` | 14 | Etkinlik müşterisi (firma ya da kişi): tekrar eden müşteri için kart. |
| `EventSettings` | 11 | Otelin banket politikası (tek satır): opsiyon süresi, teklif geçerliliği, depozito, iptal kademeleri. |
| `EventSequence` | 4 | Numara serisi (otel × tür × yıl): etkinlik, teklif, sözleşme, proforma. |
| `Event` | 37 | Etkinlik dosyası (modül 37). Tutarlar kalemlerden ve ödemelerden yeniden hesaplanan denormalize toplamlardır (kalem / kişi / ödeme yazan işlem aynı transaction'da yazar). |
| `EventSession` | 14 | Etkinliğin oturumu (program satırı): salon × saat × düzen × kişi. Saatler gerçek an (UTC). |
| `EventVenueHold` | 10 | Salon tutma: oturumun kapladığı her atomik salon parçası için bir satır (kurulum ve söküm dahil aralık). Kesin tutmalar çakışamaz (EXCLUDE); opsiyonlar çakışır, sırası `heldAt`. |
| `EventItem` | 22 | Etkinlik kalemi. Tutarlar folyonun vergi motoruyla hesaplanıp yazılır (kişi başı kalemde miktar faturalanacak kişi sayısıdır: `billedQuantity`). |
| `EventInstallment` | 8 | Ödeme planı taksiti (depozito, ara ödeme, kalan). Ödenen tutar vadesi eskiden yeniye dağıtılır. |
| `EventPayment` | 26 | Etkinlik ödemesi (depozito, ödeme, iade, iptal kaydı). Kasa ekranına (modül 17) "Etkinlik" kaynağıyla girer. Kurallar konaklama tahsilatıyla aynı: büyük ödeme ve iade onaya gider, iptal ters kayıtla yapılır (dört göz). |
| `EventDocument` | 19 | Etkinlik belgesi (teklif, sözleşme, proforma): üretildiği andaki veriyle dondurulmuş ve PDF'i sunucu diskinde saklanan sürüm. |
| `PosOutlet` | 11 | Satış noktası (restoran, lobi bar, havuz bar). |
| `PosTable` | 10 |  |
| `MenuCategory` | 10 | Menü grubu (modül 38'in menü kısmı). `outletIds` boşsa bütün satış noktalarında satılır. |
| `MenuItem` | 16 | Menü ürünü: vergi dahil fiyat, vergi kategorisi (otelin vergi ayarı), mutfak istasyonu. |
| `PosSettings` | 13 | POS politikası (otel başına tek satır). |
| `PosSequence` | 4 | Adisyon numara serisi (otel × tür × yıl). |
| `PosShift` | 16 | Garson vardiyası: kasa avansıyla açılır; kapanışta nakit sayılır, beklenenle fark kaydedilir. |
| `PosCheck` | 35 | Adisyon: masada (ya da masasız) açılır, sipariş turlarıyla dolar, ödemeyle kapanır. |
| `PosOrder` | 11 | Sipariş turu ("Gönder"): mutfağa giden kalemler; durumunu mutfak ekranı (modül 40) ilerletir. |
| `PosOrderLine` | 17 | Sipariş kalemi: ürünün adı, fiyatı, vergi kategorisi ve istasyonu gönderildiği anki kopyadır. |
| `PosAdjustment` | 20 | İkram / iptal / indirim: kim, neden, ne kadar; eşik üstüyse onay kaydıyla. |
| `PosPayment` | 26 | Restoran ödemesi (nakit / kart): adisyonun kendi hesabı; kasada "Restoran" kaynağı. |
| `PosRoomCharge` | 13 | Odaya yazılan adisyon tutarı: içerideki misafirin folyosuna `fnb.order.charged` ile işlenir. |
| `RoomServiceOrder` | 46 | Oda servisi siparişi (modül 41): odaya teslim kaydı. Mutfağa düşünce (hemen, kabulde ya da zamanı gelince) bir adisyon ve sipariş turu açılır; teslimde kapıda alınan ödeme ve kalanın odaya yazılmasıyla adisyon kapanır. Misafirden gelen (kabul bekleyen) ve ileri saatli sipariş mutfağa düşene kadar adisyonsuzdur; kalemleri `items`'tadır. |
| `RoomServiceLink` | 10 | Misafirin QR ile sipariş bağlantısı (modül 41; misafir sayfası modül 53): konaklamaya ve odaya bağlı, imzalı. Oda değişince, çıkışta ya da personel yenileyince geçersizdir; konaklamada aynı anda tek geçerli bağlantı olur. |
| `StockItem` | 15 | Malzeme kartı (44'ün stok kartının yalın hâli): stok birimi, güncel birim maliyet (KDV hariç), alerjenler. Depo / hareket / hareketli ortalama maliyet 44'te bu tabloya eklenir. Silinmez, pasife alınır. |
| `Recipe` | 15 | Reçete: verim (porsiyon ya da kg / L / adet), istasyon, servisten önce hazırlık süresi; satırları malzeme ya da ara reçete. Maliyet saklanmaz, malzemenin güncel birim maliyetinden hesaplanır. |
| `RecipeLine` | 10 | Reçete satırı: malzeme ya da ara reçete (tam biri); net miktar satırın biriminde, fire yüzdesiyle brüte çıkar. |
| `BanquetMenu` | 12 | Set menü kataloğu: kurslar ve yemekler, kişi başı fiyat (vergi dahil). Etkinliğe kopyası alınır. |
| `BanquetMenuCourse` | 6 |  |
| `BanquetMenuDish` | 7 |  |
| `EventMenu` | 18 | Etkinlik menüsü: bir oturumun öğünü (servis anı oturumun içinde). Dosyanın kişi başı fiyat kalemini üretir (`EventItem.eventMenuId`). Mutfağa kesinleşince değişmez; gerekçeyle yeniden açılır. |
| `EventMenuCourse` | 6 |  |
| `EventMenuDish` | 9 | Etkinlik menüsünün yemeği. Seçmeli kursta `guestCount` sabit kişi; boşsa "kalan". |
| `PurchaseRequest` | 13 | Satın alma talebi: STR-yıl-sıra. Satırları malzeme × etkinlik (banket ihtiyacının eksiği). |
| `PurchaseRequestLine` | 11 |  |
| `PurchaseSequence` | 4 | Satın alma numara serisi (otel × tür × yıl): talep (STR); 45 sipariş serisini ekler. |
| `Supplier` | 18 | Tedarikçi kartı: vergi bilgisi, ödeme vadesi (mal kabulden itibaren), olağan termin, tedarik ettiği gruplar. |
| `PurchaseSettings` | 5 | Satın alma politikası (otel başına tek satır). |
| `PurchaseRound` | 13 | Teklif turu (TKT-yıl-sıra): açık talep satırları malzeme başına birleşir; tedarikçiler teklif verir. |
| `PurchaseRoundLine` | 12 | Tur satırı (malzeme): toplam miktar, en erken ihtiyaç; seçilen teklif satırı ve oluşan sipariş satırı. |
| `PurchaseQuote` | 10 | Tedarikçinin teklifi (turda tedarikçi başına tek): termin ve geçerlilik. |
| `PurchaseQuoteLine` | 6 | Teklif satırı: KDV hariç birim fiyat (stok biriminde; boş = vermiyor) ve KDV oranı. |
| `PurchaseOrder` | 27 | Satın alma siparişi (SAS-yıl-sıra): tedarikçi başına; eşik üstü onay kuyruğundan; mal kabulle kapanır. |
| `PurchaseOrderLine` | 13 |  |
| `GoodsReceipt` | 15 | Mal kabul / irsaliye (MKB-yıl-sıra): siparişten gelen miktar depoya girer; tedarikçinin aynı irsaliyesi iki kez girilmez. |
| `GoodsReceiptLine` | 11 |  |
| `Warehouse` | 9 | Depo (ana depo, soğuk oda, bar deposu…). Otelde tek varsayılan depo (mal kabulde önce seçili). |
| `StockLevel` | 6 | Depo × malzeme mevcudu (stok biriminde). |
| `StockMovement` | 17 | Stok hareketi (değişmez kayıt): işaretli miktar, birim maliyet, hareket sonrası kartın mevcudu ve ortalama maliyeti, kaynağı. |
| `StockCount` | 17 | Stok sayımı (modül 44): depo başına; açılışta deponun mevcutları "beklenen" olarak dondurulur, sayılan miktarlar girilir, onayda fark (sayılan − o anki mevcut) `COUNT_ADJUST` hareketi olur. Depoda aynı anda tek açık sayım (kısmi tekil indeks, migration'da). |
| `StockCountLine` | 10 | Sayım satırı: beklenen (açılıştaki mevcut), sayılan (boş = sayılmadı), onayda yazılan fark ve o anki birim maliyet. |
| `AccountingSettings` | 8 | Ön muhasebe ayarı: otomatik kayıtların başlangıç günü (öncesi açılış bakiyesiyle) ve ödeme fişi onay eşiği. |
| `AccountingSequence` | 4 | Belge numarası ve cari / kasa kodu sırası (otel × önek × yıl; kodlarda yıl 0). |
| `LedgerAccount` | 25 | Cari hesap: acente, tedarikçi, etkinlik müşterisi (bire bir bağlı) ya da elle açılan şirket / şahıs. Bakiye = borç − alacak. |
| `LedgerEntry` | 19 | Cari hareket (ekstre satırı): borç ya da alacak; kaynağı tekil — aynı belge iki kez yazılmaz. Düzeltme ters kayıtla. |
| `TreasuryAccount` | 17 | Kasa ya da banka hesabı (kendi para biriminde). Bakiye hareketlerle aynı işlemde güncellenir. |
| `TreasuryMovement` | 20 | Kasa / banka hareketi: + giriş, − çıkış (hesabın para biriminde). Kaynağı tekil; düzeltme ters kayıtla. |
| `TreasuryMapping` | 9 | Yöntem → kasa / banka eşlemesi: ön büro, etkinlik ve restoran tahsilatı hangi hesaba girer (para birimi boş = hepsi). |
| `AccountingVoucher` | 26 | Fiş: tahsilat, ödeme (eşik üstü dört göz), virman, kasa / banka giriş-çıkış, açılış bakiyesi. İptal ters kayıtla. |
| `AccountingVoucherLine` | 14 | Fişin para satırı: kasa / banka, alınan ya da verilen çek-senet (bilgisi satırda, işlenince kartı açılır), portföyden ciro. |
| `Instrument` | 20 | Çek / senet: alınan (müşteriden, portföy) ya da verilen (bizim). Durum makinesi ve geçmişi; tutar otelin para biriminde. |
| `InstrumentMovement` | 13 | Çek / senet durum geçmişi: kim, ne zaman, hangi işlemle, hangi hesaba. |
| `GlAccount` | 14 | Hesap planı (Tek Düzen): ağaç. Yalnız yaprak (`isPostable`) hesaba satır yazılır; satırı olan hesaba alt hesap açılamaz. Seed hesapları (`isSystem`) silinmez, kodu değişmez; adı ve departmanı düzenlenebilir. |
| `JournalEntry` | 21 | Yevmiye fişi: borç toplamı = alacak toplamı. Otomatik fiş kaynak belgeden (kaynak anahtarı tekil: ikinci kez yazılmaz); elle fiş `requestId` ile çift gönderime kapalı. Düzeltme ters kayıtla (iptal edilen fiş VOIDED, ters fiş `reversalOfId`). |
| `JournalLine` | 11 | Fiş satırı: tek taraf dolu (borç ya da alacak). `date` fişin günüdür (mizan / ekstre taraması fişe dönmeden). |
| `JournalRule` | 8 | Otomatik fiş kuralı: (kaynak, anahtar) → hesap. Anahtar boş = kaynağın varsayılanı (ör. bütün KDV oranları 391). |
| `Invoice` | 58 | Fatura (modül 16 çekirdeği + 49). Taslak düzenlenir; kesimde numara (seri + yıl + 9 hane), belge türü (e-Fatura / e-Arşiv), alıcı ve UBL belgesi donar — kesilmiş fatura değişmez, iptal onay kuyruğundan. Folyo ve etkinlik başına en fazla bir geçerli (iptal edilmemiş) fatura: kısmi tekil index'ler migration'da. Alıcının bütün bilgisi `buyer`da (JSON); liste ve arama için ad ve vergi no ayrıca. |
| `InvoiceLine` | 18 | Fatura satırı: folyo faturasında gelir grubu, etkinlikte kalem, serbest faturada girilen satır. Eksi satır yoktur (ters kayıt grubun içinde, indirim satır iskontosu). |
| `InvoiceDocument` | 5 | Kesimde donan UBL-TR belgesi (gönderim ve tekrar gönderim bunu kullanır). |
| `InvoiceLog` | 9 | Faturanın zaman çizelgesi: kesim, sıraya girme, gönderim, GİB cevabı, yeniden deneme, iptal. |
| `InvoiceSettings` | 26 | Fatura ayarları: satıcı (otelin işletmesi), seriler, entegratör ve ortam. |
| `InvoiceTaxCode` | 4 | Otelin vergi satırı → GİB vergi kodu (KDV 0015, konaklama vergisi 0059). |
| `InvoiceSequence` | 4 | Seri × yıl sırası (kesimde satır kilidi altında artar; boşluk bırakmaz). |
| `TestTaxpayer` | 9 | Test ortamının "kayıtlı kullanıcı listesi": burada olan vergi no e-Fatura mükellefi sayılır. |
| `TaxpayerLookup` | 7 | Mükellef sorgusunun önbelleği (entegratör başına; süresi `TAXPAYER_CHECK_TTL_MS`). |
| `Department` | 7 |  |
| `Employee` | 31 | Personel kartı. Kullanıcı hesabından ayrı; isteyen bir hesaba bağlanır. Aynı kişinin aynı otelde tek aktif kaydı olur (kısmi tekil indeks migration'da); yeniden işe giriş yeni kayıttır (kıdem yeniden başlar). |
| `EmployeeIncentive` | 13 | Çalışan bazında teşvik (SGK işveren payından düşüm). Teşvikli ayda Hazine indirimi ayrıca uygulanmaz. |
| `EmployeeAdvance` | 16 | Maaş avansı: ödendiği gün (kasadan / bankadan) personel carisine borç; bordrolarda taksitle mahsup edilir. |
| `Garnishment` | 18 | İcra ya da nafaka kesintisi. İcra dosyaları bildirim sırasıyla kesilir (aynı anda yalnız ilki); nafaka önce gelir. |
| `PayrollSettings` | 13 | İşyeri ve muhasebe bağları (otel başına bir satır). |
| `PayrollParameterSet` | 12 | Yürürlük tarihli yasal parametre seti. Ay, ayın son günü yürürlükte olan setle hesaplanır. |
| `PayElement` | 13 | Ödeme / kesinti kalemi. Sistem kalemleri kanunun davranışıyla gelir ve değişmez; otel kendi kalemini ekler. |
| `PayrollAttendance` | 16 | Aylık puantaj: eksik gün (SGK nedeni), fazla çalışma, bayram ve hafta tatili çalışması. Modül 52 gelince puantajdan dolar (source TIMESHEET). |
| `Leave` | 20 | İzin: talep → onay (LEAVE onay türü, dört göz) → onaylı; iptal edilebilir. `days` iş günü (hafta tatili ve resmî tatil sayılmaz). |
| `LeaveAdjustment` | 8 | Elle izin bakiyesi düzeltmesi: devir izin, ek izin, kesinti (artı / eksi gün). |
| `Shift` | 13 | Vardiya: personel × gün × saat aralığı (gece vardiyası ertesi güne taşar: bitiş < başlangıç). |
| `Timesheet` | 16 | Günlük puantaj: giriş / çıkış, mola, çalışılan ve norm üstü dakika; izinli / tatil günleri durumla. |
| `EmployeeDocument` | 17 | Özlük belgesi: dosya diskte (`fileKey`), kayıt burada; süresi dolacak belgeler İK'ya hatırlatılır. Yumuşak silme. |
| `HrSettings` | 10 | İK ayarları: hafta tatili günü, günlük / haftalık çalışma normu, resmî tatiller, izin onayı, belge hatırlatma süresi. |
| `LoyaltySettings` | 15 | Otelin sadakat programı: kazanma ve harcama oranları, sınırlar, süre, seviyeler (JSON). |
| `LoyaltyAccount` | 15 | Misafirin sadakat hesabı (misafir kartı başına bir tane). Bakiye hareketlerle aynı işlemde güncellenir. |
| `LoyaltyTransaction` | 18 | Puan hareketi (işaretli). Artı lotlar (`remaining`) FIFO harcanır; `consumed` harcamanın hangi lotlardan düştüğünü tutar (iade için). |
| `PayrollItem` | 15 | Bir aya girilen ek ödeme / kesinti. `runId` boşsa ayın aylık bordrosuna, doluysa o fark bordrosuna aittir. |
| `EmployeeTermination` | 21 | İşten çıkış ve hesaplanan hakları (kıdem, ihbar, kullanılmayan izin). Tutarlar çıkış ayının kalemlerine yazılır. |
| `PayrollRun` | 35 | Bordro (ay × tür). Aylık bordro ayda bir tanedir (sequence 1); fark bordroları sırayla numaralanır. |
| `PayrollEntry` | 42 | Bir çalışanın bir bordrodaki sonucu (fark bordrosunda tutarlar fark, eksi olabilir) ve hesap izi. |
| `PayrollLine` | 11 |  |
| `PayrollPayment` | 10 | Maaş ödemesi (bir bordronun seçili satırları, tek hesaptan tek günde). |
| `ServiceChargePool` | 14 | Servis payı havuzu (ay başına bir): puan ya da eşit payla dağıtılıp ayın kalemlerine yazılır. |
| `PayrollOpening` | 10 | Yıl içinde bu işverende birikmiş matrahlar (sisteme yıl ortasında geçişte devir). |
| `PayrollSequence` | 3 |  |
| `GuestPortalSettings` | 10 | Misafir portalı ayarı (otel başına bir satır; yoksa varsayılanlar). |
| `GuestPortalLink` | 10 | Misafir portalı bağlantısı: rezervasyona bağlı, imzalı (`/misafir/p/<kimlik>.<imza>`). Rezervasyonda tek geçerli bağlantı (kısmi tekil index); yenilemek eskisini öldürür. |
| `OnlineCheckin` | 24 | Online check-in (rezervasyon başına bir kayıt; misafir düzeltip yeniden gönderir). Kimlik bilgileri girişte personelin penceresini doldurur; belge fotoğrafları ayrı tabloda ve diskte, saklama süresi sonunda silinir. |
| `OnlineCheckinDocument` | 15 | Belge fotoğrafı (disk: `online-checkin/<otel>/<kimlik>.jpg` + önizleme). Yüklenince gönderime bağlanmamış (`onlineCheckinId` boş) bekler; bağlanmayan 48 saat sonra, bağlanan saklama süresi sonunda silinir. |
| `SurveySettings` | 16 | Otelin anket ayarı. Satır yoksa varsayılanlar (anketler kapalı). Bağlantı tabanı misafir portalı ayarındaki adres. |
| `Survey` | 7 | Otelin anketi (tür başına bir tane). `version`: soru ekleme / düzenleme / sıralama / arşivin iyimser kilidi. |
| `SurveyQuestion` | 13 | Soru. Cevaplanmış soru silinmez, arşive kalkar (geçmiş cevaplar raporda durur); tipi değişmez. |
| `SurveyInvitation` | 15 | Anket daveti: rezervasyon × tür başına bir tane. Bağlantı `/misafir/a/<id>.<imza>` (imza = HMAC(id.nonce)). |
| `SurveyResponse` | 23 | Misafirin cevabı (davet başına bir tane). Özet alanları (NPS, ortalama, düşük, yorum) cevapta donar; rapor bunları okur. |
| `SurveyAnswer` | 9 | Tek sorunun cevabı. Rapor soru başına ortalama ve dağılımı bunlardan alır (tür + gün + soru indeksli). |
| `SurveyFollowUp` | 14 | Düşük puanın takibi (cevap başına bir tane): kim ilgileniyor, görüşmeler, nasıl kapandı. |
| `SurveyFollowUpNote` | 7 | Takibin notu ya da misafirle görüşme kaydı (değişmez). |
| `SurveyInsight` | 16 | Dönemin AI tema özeti (insight-agent). Aynı dönem için bekleyen tek istek (kısmi tekil index). |
| `SpaSettings` | 14 | Spa politikası (otel başına tek satır; yoksa sözleşmedeki varsayılanlar). |
| `SpaRoom` | 10 | Bakım odası, hamam, stüdyo, salon. |
| `SpaTherapist` | 12 | Terapist, antrenör, eğitmen. |
| `SpaTherapistHour` | 6 | Terapistin haftalık çalışma saati (gün başına birden fazla dilim olabilir: bölünmüş vardiya). |
| `SpaService` | 21 | Hizmet: birebir (randevu) ya da grup dersi (seans). |
| `SpaServiceTherapist` | 3 | Hizmeti verebilen terapist. |
| `SpaServiceRoom` | 3 | Hizmetin verilebildiği oda. |
| `SpaBlock` | 9 | Terapistin izni / molası ya da odanın bakımı: o aralıkta randevu verilmez. |
| `SpaHold` | 11 | Kaynağın (terapist ya da oda) dolu aralığı: randevu, grup seansı ya da blok. İptalde `active` kapanır (kimin atanmış olduğu kayıtta kalır). Aynı kaynağa çakışan iki etkin tutma olamaz (EXCLUDE). |
| `SpaSession` | 19 | Grup dersinin bir seansı. Eğitmen ve salon `SpaHold` ile tutulur; katılımcılar `SpaAppointment` (sessionId). |
| `SpaSequence` | 3 | Randevu numarası serisi (otel × yıl). |
| `SpaAppointment` | 43 | Randevu (birebir) ya da grup dersi kaydı (`sessionId` dolu). Tutarlar: `price` anlaşılan fiyat (vergi ayarına göre matrah ya da dahil), `amountDue` borcun aynı esastaki tutarı (tamamlanınca fiyat, geç iptal / gelmedide bedel), `totalDue` vergiyle misafirin ödeyeceği. Bakiye = totalDue − paidTotal − roomChargeTotal. |
| `SpaPayment` | 26 | Spa kasasında alınan ödeme (modül 17 kuralları; kasada "Spa" kaynağı). |
| `SpaRoomCharge` | 13 | Randevunun (ya da iptal bedelinin) oda hesabına yazılması: folyoya giden olayın kaydı. |
| `DeliveryOrder` | 29 | Paket (eve teslim) sipariş (modül 42): adisyonla bire bir (sipariş alınınca mutfağa düşer); müşteri, adres, kapı ödemesi, kurye ve teslim izi. Hesap teslimde kapanır (kapı ödemesi kuryenin vardiya kasasına). |
| `AssetCategory` | 7 | Demirbaş kategorisi: varsayılan faydalı ömür (yıl; VUK oranı = 1 / ömür) yeni karta kopyalanır. |
| `AssetArea` | 6 | Demirbaşın durduğu oda dışı yer: lobi, restoran, mutfak, depo… |
| `Asset` | 33 | Demirbaş kartı. Konum bir oda ya da bir alan (tam olarak biri, kısıt); zimmet yalnız kullanımdaki kartta. Finansal alanlar (alış, tutar, ömür, açılış) kaydedilmiş amortisman varken değişmez (servis). |
| `AssetMovement` | 10 | Kartın ekle-yalnız geçmişi. Yer ve zimmet o anki adlarıyla yazılır: sonradan ad değişse de geçmiş okunur kalır. |
| `AssetDepreciationRun` | 7 | Bir yılın amortisman kaydı (yıl sonu). Otel başına yıl tekil, yıllar ardışık (servis); yalnız son yıl geri alınır. |
| `AssetDepreciation` | 7 | Kartın bir yıllık amortismanı (kaydedilmiş; kilitli). |
| `AssetCount` | 18 | Demirbaş sayımı. Açılışta kapsamdaki kullanımdaki kartlar "beklenen" olarak dondurulur; okutulan kart bulunduğu yerle işaretlenir. Kapanışta başka yerde bulunanlar istenirse oraya taşınır; eksikler listede kalır (elden çıkarma ayrı ve yetkili işlemdir). |
| `AssetCountItem` | 11 | Sayımın satırı: beklenen (açılıştaki yeriyle) ya da kapsam dışından okutulan (fazla); bulunduğu yer okutulunca. |
| `AssetSequence` | 4 | Demirbaş kodu (yıl 0, kesintisiz) ve sayım numarası (yıllık) sıraları. |
| `ReportQuestion` | 18 | Rapor asistanına sorulan soru ve cevabı (sohbet geçmişi kişiseldir). |
| `SavedReport` | 11 | Kayıtlı rapor: tanım + grafik. Sahibi düzenler / siler; paylaşılan rapor rapor yetkisi olan herkese görünür. |
| `ReportDefinition` | 10 | Tasarımcıda kurulan rapor: kaynak + sütunlar + filtreler + gruplama + sıralama (`reportDesignSchema`). Sahibi düzenler / siler; paylaşılan rapor rapor yetkisi olan herkese görünür (kaynağın yetkisi de gerekir). |
| `DataImport` | 10 | Excel'den toplu yükleme (misafir listesi / fiyat planı). Kimlik sihirbazın ürettiği yükleme kimliğidir: aynı yükleme ikinci kez gönderilirse yazılmaz, bu kayıt döner. |
| `KbsSettings` | 17 | Otelin KBS ayarı. Parola secret-box ile mühürlü saklanır, hiçbir cevapta dönmez. |
| `KbsNotification` | 26 | Bir kişinin bir bildirimi (giriş / çıkış / oda değişikliği). Kimlik gönderim anında kartın güncel halinden kurulur; burada yalnız ekran için maskeli özet tutulur. |
| `KbsLog` | 8 | Her deneme ve personel işlemi (iz). |
| `ApiClient` | 12 | Açık API uygulaması (modül 61): otele bağlanan dış sistem (CRM, kurumsal seyahat aracı, acente yazılımı). Anahtarlar ve webhook abonelikleri uygulamaya bağlıdır; uygulama kapatılınca hepsi durur. Silme yumuşaktır (geçmiş teslimat ve rezervasyon bağı kalsın). Ad otelde tekildir (silinmemişler arasında; kısmi tekil indeks migration'da). |
| `ApiKey` | 14 | API anahtarı: `fhk_<önek>_<sır>`. Yalnız SHA-256 özeti saklanır; anahtar bir kez, oluşturulunca gösterilir. Önek tekildir ve anahtarı bulmak içindir (ekranda da görünür). İptal geri alınmaz; yerine yeni anahtar açılır. |
| `WebhookSubscription` | 19 | Webhook aboneliği: seçilen olaylar uygulamanın adresine imzalı gider. İmza sırrı şifreli saklanır (imzalamak için açılması gerekir; `SETTINGS_SECRET_KEY`). Sır yenilenince eskisi kısa süre ikinci imza olarak gönderilir (geçiş). Art arda başarısız teslimatlar sınırı aşarsa abonelik kendiliğinden kapanır (`DISABLED`, sebebiyle). |
| `WebhookDelivery` | 18 | Bir olayın bir aboneliğe teslimatı. Aynı olay aynı aboneliğe bir kez yazılır (tekil: outbox olayı yeniden dağıtsa da). Gönderici due kayıtları sahiplenir (`SENDING` + `lockedUntil`; süreç düşerse süre dolunca yeniden alınır), başarısızda artan bekleme ile yeniden dener, deneme hakkı bitince `FAILED`. Gövde incedir (kişisel veri yok). 30 gün saklanır. |
| `PaymentGatewaySettings` | 14 | Otelin sanal POS ayarı. Anahtarlar secret-box ile mühürlü (JSON {apiKey, secretKey}); hiçbir cevapta dönmez. |
| `PaymentLink` | 35 | Misafirin kartla ödeyeceği bağlantı. Tek kez ödenir; başarısız denemeden sonra yeniden denenir. Kart numarası tutulmaz (yalnız sağlayıcının verdiği kart markası ve son dört hane). |
| `PaymentLinkEvent` | 9 | Linkin izi: oluşturma, gönderim, deneme, sonuç, iade. |
| `GatewayRefund` | 15 | Karta iade: dört gözle onaylanır, sonra sağlayıcıdan iade edilir ve folyoya eksi ödeme yazılır. |
| `Review` | 35 | Yorum sitesindeki misafir yorumu ve AI analizi (1:1, aynı satırda). Yazanın adı modele gitmez. |
| `ReviewImport` | 9 | Dosyadan yükleme (idempotent: kimlik isteğin kimliği). |
| `ReviewAnomaly` | 8 | Olumsuz konu artışı (haftalık; otel + konu + hafta tekil). |
| `ExchangeRateSettings` | 10 | Otelin kur ayarı: TCMB'den günlük çekme, hangi kur türü, hangi dövizler. |

## Modül durumu

Geliştirme listesinden (GOREVLER.md) türetilir: işaretli maddeler ve "tamamlandı" notu. "Planlı" modüller için ekranlar henüz yoktur.

| No | Modül | Sorumlu | Durum |
| --- | --- | --- | --- |
| 1 | Ayarlar / parametreler | arkadaşın | tamamlandı |
| 2 | Kullanıcı, rol, yetki (RBAC) | Ali Kemal | tamamlandı |
| 3 | Oda tipi müsaitlik & oda atama | arkadaşın | tamamlandı |
| 4 | Rezervasyon yönetimi | Ali Kemal | tamamlandı |
| 5 | Oda planı / takvim | arkadaşın | kısmi (8/9) |
| 6 | Check-in / Check-out | Ali Kemal | kısmi (6/7) |
| 7 | Misafir mesajları / istek takibi | arkadaşın | tamamlandı |
| 8 | WhatsApp / web chat ile konuşarak rezervasyon | Ali Kemal | tamamlandı |
| 9 | Bildirim merkezi | arkadaşın | tamamlandı |
| 10 | Aktör Activity Feed + audit log | Ali Kemal | tamamlandı |
| 11 | Onay kuyruğu | arkadaşın | tamamlandı |
| 12 | Aktör yönetim paneli | Ali Kemal | tamamlandı |
| 13 | Günlük durum ekranı | arkadaşın | tamamlandı |
| 14 | Housekeeping / kat hizmetleri | Ali Kemal | tamamlandı |
| 15 | Folyo yönetimi | arkadaşın | tamamlandı |
| 16 | Fatura kesme | Ali Kemal | tamamlandı |
| 17 | Ödeme alma | arkadaşın | tamamlandı |
| 18 | Vardiya / kasa kapama (night audit) | Ali Kemal | tamamlandı |
| 19 | Çamaşırhane & minibar | arkadaşın | tamamlandı |
| 20 | Teknik servis / arıza-bakım | Ali Kemal | tamamlandı |
| 21 | Kayıp eşya | arkadaşın | tamamlandı |
| 22 | CRM & misafir kartı | Ali Kemal | tamamlandı |
| 23 | Gelir raporları | arkadaşın | tamamlandı |
| 24 | Doğal dil raporlama | Ali Kemal | tamamlandı |
| 25 | Günlük durum | forecast — arkadaşın | tamamlandı |
| 26 | Rapor tasarımcısı + Excel | Ali Kemal | tamamlandı |
| 27 | Bütçe yönetimi | arkadaşın | tamamlandı |
| 28 | Paket / pansiyon tipleri | Ali Kemal | tamamlandı |
| 29 | Kontrat & acente yönetimi | arkadaşın | tamamlandı |
| 30 | Grup & allotment | Ali Kemal | tamamlandı |
| 31 | Promosyon & kupon | arkadaşın | tamamlandı |
| 32 | Online rezervasyon motoru | Ali Kemal | tamamlandı |
| 33 | Kanal yönetimi / Channel Manager | arkadaşın | tamamlandı |
| 34 | Dinamik fiyat / yield | Ali Kemal | tamamlandı |
| 35 | Acente bonus / sadakat | arkadaşın | tamamlandı |
| 36 | Call center & satış CRM | Ali Kemal | tamamlandı |
| 37 | Satış projeleri & banket / etkinlik | arkadaşın | tamamlandı |
| 38 | Menü & reçete | Ali Kemal | planlı |
| 39 | Restoran POS | arkadaşın | kısmi (7/8) |
| 40 | Mutfak ekranı (KDS) | Ali Kemal | tamamlandı |
| 41 | Oda servisi | arkadaşın | tamamlandı |
| 42 | Online paket sipariş | Ali Kemal | kısmi (4/5) |
| 43 | Banket F&B planlaması | arkadaşın | tamamlandı |
| 44 | Stok & maliyet analizi | Ali Kemal | tamamlandı |
| 45 | Satın alma | arkadaşın | tamamlandı |
| 46 | Demirbaş & amortisman | Ali Kemal | tamamlandı |
| 47 | Ön muhasebe | arkadaşın | tamamlandı |
| 48 | Genel muhasebe | Ali Kemal | tamamlandı |
| 49 | e-Fatura / e-Arşiv / e-Defter | arkadaşın | kısmi (4/6) |
| 50 | Sanal POS / ödeme geçidi | Ali Kemal | tamamlandı |
| 51 | Personel & bordro | arkadaşın | tamamlandı |
| 52 | İK | Ali Kemal | tamamlandı |
| 53 | Temassız uygulamalar | arkadaşın | tamamlandı |
| 54 | Misafir yorum entegrasyonu + duygu analizi | Ali Kemal | tamamlandı |
| 55 | Anket & memnuniyet | arkadaşın | tamamlandı |
| 56 | Sadakat programı | Ali Kemal | tamamlandı |
| 57 | SPA & spor salonu randevu | arkadaşın | tamamlandı |
| 58 | Emniyet kimlik bildirimi (KBS) | Ali Kemal | tamamlandı |
| 59 | Kimlik / pasaport okuma (OCR) | arkadaşın | tamamlandı |
| 60 | Çoklu dil & çoklu para birimi | Ali Kemal | kısmi (4/5) |
| 61 | Webhook & açık API | arkadaşın | tamamlandı |
| 62 | Donanım entegrasyonları | Ali Kemal | planlı |
| 63 | Multi-tenant zincir konsolu | arkadaşın | planlı |
| 64 | Apart / rezidans | Ali Kemal | planlı |
| 65 | Yurt yönetimi | arkadaşın | planlı |
| 66 | Devremülk | Ali Kemal | planlı |
| 67 | Marina | arkadaşın | planlı |
| 68 | Klinik | Ali Kemal | planlı |
| 69 | Göç sihirbazı | arkadaşın | planlı |
| 70 | Kesintisiz çalışma | Ali Kemal | planlı |
| 71 | Güvenlik ve kimlik | arkadaşın | planlı |
| 72 | Gözlem, yayın ve paketleme | Ali Kemal | planlı |
| 73 | Mobil temel | arkadaşın | planlı |
| 74 | Yazarkasa (ÖKC) ve e-Adisyon | Ali Kemal | planlı |
| 75 | Patron uygulaması | arkadaşın | planlı |
| 76 | Personel mobil uygulaması | Ali Kemal | planlı |
| 77 | FlexAI Akademi | arkadaşın | planlı |
| 78 | Staj ve kariyer ağı | Ali Kemal | planlı |
| 79 | Uygulama içi yardım ve destek | arkadaşın | planlı |
| 80 | Misafir tanıma ve kişiselleştirme | Ali Kemal | planlı |
| 81 | Servis kurtarma (misafir ilişkileri) | arkadaşın | planlı |
| 82 | Concierge ve butler masası | Ali Kemal | planlı |
| 83 | Upsell ve oda özelliği satışı | arkadaşın | planlı |
| 84 | Ödeme güvencesi, hediye çeki ve üyelik | Ali Kemal | planlı |
| 85 | Otomasyon stüdyosu | arkadaşın | planlı |
| 86 | İşlem yapan yapay zekâ asistanı ve uzaktan MCP | Ali Kemal | planlı |
| 87 | Yapay zekâ gece müdürü ve sabah brifingi | arkadaşın | planlı |
| 88 | İşgücü planlama | Ali Kemal | planlı |
| 89 | Akıllı oda ve enerji | arkadaşın | planlı |
| 90 | No-show tahmini ve grup değerlendirme | Ali Kemal | planlı |
| 91 | Rakip fiyat izleme | arkadaşın | planlı |
| 92 | Kontrat ve pansiyon kârlılığı | Ali Kemal | planlı |
| 93 | USALI kâr-zarar ve sahip raporu | arkadaşın | planlı |
| 94 | Uyum merkezi | Ali Kemal | planlı |
| 95 | Gelen e-belge ve üçlü eşleştirme | arkadaşın | planlı |
| 96 | Dış muhasebe aktarımı | Ali Kemal | planlı |
| 97 | Banka mutabakatı | arkadaşın | planlı |
| 98 | Tur operatörü bağlantısı | Ali Kemal | planlı |
| 99 | Tesis ve aktivite rezervasyonu | arkadaşın | planlı |
| 100 | Acente B2B portalı | Ali Kemal | planlı |
| 101 | Sesli yapay zekâ santral | arkadaşın | planlı |
| 102 | Kalite ve standart denetimi | Ali Kemal | planlı |
| 103 | Sürdürülebilirlik | arkadaşın | planlı |
| 104 | Anonim pazar karşılaştırması | Ali Kemal | planlı |
