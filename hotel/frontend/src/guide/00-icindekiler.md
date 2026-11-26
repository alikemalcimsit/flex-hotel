# Kılavuza giriş

Bu kılavuz FlexHotel'i **hiç bilmeyen birinin** sistemi baştan sona öğrenebilmesi için yazıldı. İki amacı var:

1. **Nasıl kullanılır:** her ekran nerede, ne işe yarar, adım adım nasıl kullanılır.
2. **Arka planda ne oluyor:** hangi işler otomatik yapılır, kim (hangi "aktör") yapar, bir şey ters giderse ne olur.

Sol taraftaki bölümler sırayla okunacak şekilde dizildi; ama her bölüm kendi başına da anlaşılır. Üstteki arama kutusu bütün bölümlerin başlıklarında arar.

## Bölümler

| Bölüm | Kime | İçerik |
| --- | --- | --- |
| Başlarken | Herkes | Sistem nedir, giriş, **dil ve gösterim para birimi** (Türkçe / English; hangi ekranlar İngilizce; yaklaşık döviz karşılığı), roller ve yetkiler, menü düzeni, ortak ekran kalıpları, ilk kurulum sırası |
| Arka planda ne oluyor | Yönetici, meraklı personel | Olay tabanlı mimari, aktörler (otomatik çalışan işçiler), onay kuyruğu, AI ajanları, iş günü, zamanlanmış işler |
| Yönetim ekranları | Yönetici / admin | Görevler, onaylar, bildirimler, aktivite ve denetim, aktör paneli, ayarlar, Excel'den yükleme, raporlar |
| Ön büro | Resepsiyon | Rezervasyon, oda planı, giriş / çıkış, online check-in, odalar, misafir kartı, **sadakat programı** (puan kazanma ve kullanma, seviyeler, süre, elle düzeltme), **KBS kimlik bildirimi** (girişte zorunlu alanlar, kişi başına giriş / çıkış / oda değişikliği bildirimi, yeniden deneme ve zil, elle bildirildi, mutabakat; gerçek Emniyet / Jandarma bağlantısı bekliyor, bugün test ortamı) |
| Folyo, kasa ve ek hizmetler | Resepsiyon, kasa | Folyo kalemleri, ödemeler, kasa ve döviz kurları (**TCMB'den otomatik kur**: önceki son bülten, kur türü, saatlik iş, elle girilenin önceliği), **Sanal POS** (misafire ödeme linki, kartla online ödeme, folyoya kendiliğinden düşme, kurtarma ve süre dolumu, dört gözlü karta iade, portal ve widget ödemesi; iyzico bağlantısı yazıldı ama sandbox'ta uçtan uca deneme bekliyor, bugün Test ortamı çalışır), minibar ve çamaşırhane, kayıp eşya, gün kapanışı |
| Kat hizmetleri ve teknik servis | Kat, teknik | Görev panosu, kontrol, kat haritası, arıza biletleri, periyodik bakım |
| Misafir iletişimi | Resepsiyon, misafir ilişkileri | Mesajlar ve AI concierge, istekler, anketler, **misafir yorumları ve duygu analizi** (Google, Booking.com ve diğer sitelerden elle ya da Excel / CSV ile yükleme — otomatik çekme yok; AI duygu, konu, departman ve yorumun dilinde önerilen cevap; cevap kopyalanıp platformda yayınlanır; haftalık trend; olumsuz konu artışı zili), spa, misafir portalı |
| Satış ve gelir yönetimi | Satış, gelir yöneticisi | Fiyat planları, dinamik fiyat önerileri, acenteler, gruplar, promosyonlar, kanallar, web widget'ı (döviz seçici ve yaklaşık fiyat), satış CRM, bütçe |
| Restoran, mutfak ve oda servisi | F&B | Menü, vardiya, masa planı ve adisyon, mutfak ekranı, oda servisi, paket servis, reçeteler, etkinlikler |
| Satın alma ve stok | Satın alma, depo, F&B | Talep → teklif → sipariş → mal kabul, depolar, hareketli ortalama maliyet, hareketler, sayım, satış düşümü, maliyet raporu |
| Arka ofis | Muhasebe, İK | Faturalar ve e-belge (faturada **döviz karşılığı** notu; fatura TL kalır), ön muhasebe, **genel muhasebe** (Tek Düzen hesap planı, otomatik yevmiye fişleri, günlük gelir fişi, mizan, hesap ekstresi, kurallar, dönem kilidi), personel ve bordro, **İK** (izin talebi ve onayı, yıllık izin bakiyesi, vardiya çizelgesi, günlük puantaj ve bordroya aktarım, özlük belgeleri), demirbaş ve amortisman |
| Uçtan uca senaryolar | Herkes | Bir misafirin yolculuğu, bir yemeğin yolculuğu, gün kapanışı, OTA rezervasyonu, arıza, fiyat önerisi, bordro, ay sonu mizan ve dönem kapanışı, yanlış fişin düzeltilmesi, personel izin talebi, gece vardiyası ve mesai, sadık misafirin puan kullanması, KBS hatası (servis ulaşılamaz → gönderilemedi → elle bildir / tekrar gönder), misafirin ön ödemeyi linkle yapması, karta iade, Booking yorumlarını yükleyip olumsuzlara cevap vermek, temizlik şikâyeti arttı uyarısı |
| Sık sorulan sorular | Herkes | Hata mesajları, sorun giderme (KBS, Sanal POS ve misafir yorumları dahil), modül durumu tablosu |
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
| **İzin bakiyesi** | Personelin yıllık ücretli izin hakkı (işe giriş yıl dönümlerinde 14 / 20 / 26 gün) + düzeltmeler − onaylı yıllık izinler. İK → İzin bakiyeleri ve İzinlerim'de görünür. |
| **Puantaj** | Personelin gün gün geldi / gelmedi / izinli kaydı, giriş-çıkış saatleri ve fazla çalışması; ay sonunda bordroya aktarılır. |
| **Sadakat puanı** | Misafirin folyosu kapanınca harcamasından kazandığı puan (varsayılan 10 TL = 1 puan). Sonraki konaklamada açık folyoda indirim olarak kullanılır (varsayılan 1 puan = 0,50 TL). Son 12 ayda kazanılan puan misafirin **seviyesini** (Klasik / Gümüş / Altın) belirler. Sadakat → Üyeler'de görünür. |
| **KBS bildirimi** | Misafirin kimliğinin Emniyet (KBS) ya da Jandarma (JKBS) kimlik bildirim sistemine giriş, çıkış ve oda değişikliğinde bildirilmesi. FlexHotel kişi başına bildirimi sıraya alır, gönderilemeyince zil çalar, **Mutabakat**'ta içerideki herkesin bildirilip bildirilmediğini gösterir. Gerçek servis bağlantısı henüz yoktur (test ortamı); otel resmî ekrandan elle bildirip **Elle bildirildi** işaretler. KBS → Bildirimler'de görünür. |
| **Sanal POS / ödeme linki** | Misafirin kartla internetten ödeme yapmasını sağlayan hizmet. Resepsiyon rezervasyondan tutarı ve süresi belli bir **ödeme linki** gönderir; misafir kartını ödeme kuruluşunun (iyzico) sayfasında girer, kart bilgisi otele hiç gelmez. Ödeme folyoya "Sanal POS" olarak kendiliğinden düşer; karta iade dört gözle onaylanır. Sanal POS → İşlemler'de görünür. |
| **Misafir yorumu / duygu analizi** | Google, Booking.com gibi sitelerde misafirin yazdığı herkese açık yorum. FlexHotel'e otomatik gelmez; elle ya da Excel / CSV ile girilir. Geri bildirim ajanı her yoruma duygu (Olumlu / Nötr / Olumsuz / Karışık), −100…100 puan, konu ve departman verir, yorumun dilinde cevap önerir; cevap platformda elle yayınlanır. Yorumlar → Yorumlar'da görünür. |
| **Arayüz dili** | Personel panelinin dili (Türkçe / English), kullanıcı başına seçilir: kullanıcı menüsünden ya da giriş ekranından. İngilizcesi bugün ana ekranlarda (menü, giriş, ön büro, rezervasyon, oda planı, folyo, kasa ve kurlar); diğer ekranlar kademeli çevrilir, o zamana kadar Türkçe görünür. |
| **Gösterim para birimi** | Kullanıcının seçtiği döviz (ör. EUR). Tutarların yanında güncel kurla küçük bir yaklaşık karşılık gösterilir ("2.480,00 TRY ≈ 48,97 EUR"). Kayıtlar, ödemeler ve faturalar otelin para biriminde kalır. |
| **TCMB kuru** | Merkez Bankası'nın günlük kur bülteninden otomatik çekilen kur. İş günü için bir önceki bülten kullanılır (hafta sonu / tatil geriye bakılır); kur türü ayardan (varsayılan döviz alış); saatte bir denetlenir. Elle girilen kur TCMB'ninkiyle ezilmez. Kasa → Döviz kurları'nda **TCMB** rozetiyle görünür. |
| **Döviz karşılığı (fatura)** | Fatura TL kesilir; taslakta döviz seçilirse toplamın o dövizdeki karşılığı kesim günündeki kurla faturaya not olarak yazılır (ör. 12.000 TL → 236,95 EUR). Tam dövizli e-fatura değildir. |
| **Mizan** | Bir dönemde her hesabın devri, borç / alacak toplamı ve kalanı; dip toplamda borç = alacak ("dengeli"). Müşavire giden özet. |
