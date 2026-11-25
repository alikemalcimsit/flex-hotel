# Kılavuza giriş

Bu kılavuz FlexHotel'i **hiç bilmeyen birinin** sistemi baştan sona öğrenebilmesi için yazıldı. İki amacı var:

1. **Nasıl kullanılır:** her ekran nerede, ne işe yarar, adım adım nasıl kullanılır.
2. **Arka planda ne oluyor:** hangi işler otomatik yapılır, kim (hangi "aktör") yapar, bir şey ters giderse ne olur.

Sol taraftaki bölümler sırayla okunacak şekilde dizildi; ama her bölüm kendi başına da anlaşılır. Üstteki arama kutusu bütün bölümlerin başlıklarında arar.

## Bölümler

| Bölüm | Kime | İçerik |
| --- | --- | --- |
| Başlarken | Herkes | Sistem nedir, giriş, roller ve yetkiler, menü düzeni, ortak ekran kalıpları, ilk kurulum sırası |
| Arka planda ne oluyor | Yönetici, meraklı personel | Olay tabanlı mimari, aktörler (otomatik çalışan işçiler), onay kuyruğu, AI ajanları, iş günü, zamanlanmış işler |
| Yönetim ekranları | Yönetici / admin | Görevler, onaylar, bildirimler, aktivite ve denetim, aktör paneli, ayarlar, Excel'den yükleme, raporlar |
| Ön büro | Resepsiyon | Rezervasyon, oda planı, giriş / çıkış, online check-in, odalar, misafir kartı |
| Folyo, kasa ve ek hizmetler | Resepsiyon, kasa | Folyo kalemleri, ödemeler, kasa, minibar ve çamaşırhane, kayıp eşya, gün kapanışı |
| Kat hizmetleri ve teknik servis | Kat, teknik | Görev panosu, kontrol, kat haritası, arıza biletleri, periyodik bakım |
| Misafir iletişimi | Resepsiyon, misafir ilişkileri | Mesajlar ve AI concierge, istekler, anketler, spa, misafir portalı |
| Satış ve gelir yönetimi | Satış, gelir yöneticisi | Fiyat planları, dinamik fiyat önerileri, acenteler, gruplar, promosyonlar, kanallar, web widget'ı, satış CRM, bütçe |
| Restoran, mutfak ve oda servisi | F&B | Menü, vardiya, masa planı ve adisyon, mutfak ekranı, oda servisi, paket servis, reçeteler, etkinlikler |
| Satın alma ve stok | Satın alma, depo, F&B | Talep → teklif → sipariş → mal kabul, depolar, hareketli ortalama maliyet, hareketler, sayım, satış düşümü, maliyet raporu |
| Arka ofis | Muhasebe, İK | Faturalar ve e-belge, ön muhasebe, **genel muhasebe** (Tek Düzen hesap planı, otomatik yevmiye fişleri, günlük gelir fişi, mizan, hesap ekstresi, kurallar, dönem kilidi), personel ve bordro, demirbaş ve amortisman |
| Uçtan uca senaryolar | Herkes | Bir misafirin yolculuğu, bir yemeğin yolculuğu, gün kapanışı, OTA rezervasyonu, arıza, fiyat önerisi, bordro, ay sonu mizan ve dönem kapanışı, yanlış fişin düzeltilmesi |
| Sık sorulan sorular | Herkes | Hata mesajları, sorun giderme, modül durumu tablosu |
| Teknik referans (otomatik) | Yönetici, teknik ekip | Koddan her derlemede üretilir: menü haritası ve izinler, rol varsayılanları, aktör bildirgeleri, olay kataloğu, zamanlanmış işler, tablolar, modül durumu |

## Kılavuz nasıl güncel kalır

- **Teknik referans** bölümü elle yazılmaz; her derlemede koddan yeniden üretilir. Yeni bir ekran, izin, olay, aktör ya da tablo eklendiğinde orada kendiliğinden görünür.
- **Anlatım bölümleri** geliştirmeyle birlikte güncellenir: menüye eklenen bir sayfa kılavuzda anlatılmamışsa otomatik test düşer ve değişiklik tamamlanmış sayılmaz. Yani bu kılavuzda olmayan bir ekran, sistemde de yok demektir.

## Nasıl okunmalı

- **Yeni personelseniz:** önce "Başlarken", sonra kendi bölümünüz (ör. resepsiyon için "Ön büro" ve "Folyo, kasa"). "Uçtan uca senaryolar" bölümündeki hikâyeler günlük işin bütününü gösterir.
- **Yöneticiyseniz:** "Arka planda ne oluyor" ve "Yönetim ekranları" bölümleri sistemin otomasyonunu ve kontrol noktalarını anlatır; ekibinize anlatırken "Senaryolar" bölümünü kullanabilirsiniz.
- **Sistemi başkasına tanıtacaksanız:** her bölümün sonundaki "Sık sorulanlar" kısımları, en çok sorulan sorulara hazır cevaplardır.

## Terimler

| Terim | Anlamı |
| --- | --- |
| **Aktör** | Arka planda kendi kendine çalışan işçi. Bir olay olunca (ör. "misafir giriş yaptı") devreye girer, işini yapar, izini bırakır. Panelden açılıp kapatılabilir. |
| **Olay** | Sistemde olan her önemli şeyin kaydı ("rezervasyon onaylandı", "adisyon kapandı"). Aktörler olayları dinler. |
| **Manuel görev** | Bir aktör kapalıysa ya da işi yapamadıysa, aynı iş personelin önüne "görev" olarak düşer. Hiçbir iş kaybolmaz. |
| **Onay kuyruğu** | Riskli işler (büyük iade, kapasite aşımı, fiyat değişikliği) yetkili bir kişinin onayını bekler. |
| **Zil / uyarı** | Sağ üstteki çan. Sizi ilgilendiren bir şey olunca (gecikmiş istek, kasa farkı, minimum altı stok) burada görünür. |
| **İş günü** | Otelin "bugün"ü. Gün kapanışı (night audit) yapılana kadar değişmez; raporlar ve oda ücretleri buna göre işler. |
| **Folyo** | Misafirin konaklama hesabı. Oda ücreti, restoran, minibar vb. kalemler buraya yazılır; çıkışta kapanır ve fatura taslağı olur. |
| **Sürüm damgası** | Bir kaydı iki kişi aynı anda düzenlerse ikincisine "başkası değiştirdi, yenileyin" denir. Veri ezilmez. |
| **Yevmiye fişi** | Genel muhasebede bir belgenin Tek Düzen hesaplarına çift taraflı kaydı (borç = alacak). Ön muhasebe hareketleri kendiliğinden fiş olur; fiş silinmez, iptali ters kayıtla olur. |
| **Mizan** | Bir dönemde her hesabın devri, borç / alacak toplamı ve kalanı; dip toplamda borç = alacak ("dengeli"). Müşavire giden özet. |
