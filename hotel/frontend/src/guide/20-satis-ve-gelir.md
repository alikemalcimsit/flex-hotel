# Satış ve gelir yönetimi

Bu bölüm otelin "parayı nasıl kazandığı" tarafını anlatır: fiyatın nasıl oluştuğunu, fiyatı kimin ve nasıl değiştirebildiğini, acente ve kanal satışını, promosyonları, web sitesinden gelen rezervasyonu, telefonla gelen talebin teklife ve rezervasyona dönmesini, bütçe ve tahmini. Her ekran için aynı düzeni izler: **nerede bulunur**, **ne yapar**, **adım adım nasıl kullanılır**, **arka planda ne otomatik olur**, **dikkat edilecekler**.

Kime hitap eder: yeni başlayan resepsiyon ve satış personeli, gelir yönetiminden sorumlu müdür, muhasebe ve sistemi başkasına anlatmak isteyen ürün sahibi.

İki ilke bütün bölümü özetler:

- **Fiyat tek bir yerden hesaplanır.** Rezervasyon formu, acente satışı, web widget'ı, kanal yöneticisi ve satış teklifi hepsi aynı fiyat hesabını kullanır. Bir yerde gördüğünüz fiyat başka yerde farklı çıkmaz.
- **Hiçbir fiyat kendiliğinden değişmez.** Dinamik fiyat kuralları ve yapay zekâ ajanı yalnızca **öneri** üretir; fiyat ancak yetkili bir kişi onaylayınca değişir.

## Fiyat nasıl oluşur: büyük resim

Bir odanın bir gecesi için sistem şu sırayla bakar ve ilk tutanı kullanır:

1. **Elle girilen fiyat.** Yetkili personel rezervasyonda fiyatı kendisi yazdıysa o geçerlidir (gerekçe istenir, denetim izine yazılır).
2. **Acente kontrat fiyatı.** Rezervasyon bir acente adına açılıyorsa fiyat, o gün için satıştaki kontratın oda tipi × pansiyon fiyatıdır. Kontratta o gece için fiyat yoksa satış **reddedilir**.
3. **Paket fiyatı.** Rezervasyonda bir paket seçildiyse gece fiyatı paketin sabit gecelik fiyatıdır; pansiyon paketten gelir.
4. **Fiyat planı.** Oda tipi × pansiyon × tarih aralığı için tanımlı sabit gecelik fiyat varsa o kullanılır. Plan fiyatı belli bir kişi sayısı içindir; fazla yetişkin ve çocuk için **kişi başı ek** eklenir.
5. **Sezon × taban fiyat.** Hiçbiri yoksa oda tipinin taban fiyatı o günün sezon çarpanıyla çarpılır (sistemin ilk günden beri çalışan temel yöntemi).

Bunların üstüne iki katman daha gelir:

- **Dinamik fiyat çarpanı (onaylı).** Fiyat planı ve sezon fiyatını gece gece ölçekler (örneğin +%10). Acente kontratı, paket ve elle girilen fiyat **net** sayılır; çarpandan etkilenmez.
- **Promosyon / kupon.** Liste fiyatı (plan veya sezon, çarpan dahil) üzerine indirim uygular. Acente satışına ve paketli odaya promosyon ya da kupon uygulanmaz.

Bu sırayı akılda tutmak çoğu "fiyat neden böyle çıktı?" sorusunu cevaplar. Rezervasyon formundaki fiyat önizlemesi ve rezervasyon detayındaki gece dökümü her gecenin hangi kaynaktan fiyatlandığını (plan adı, sezon adı, kontrat adı, paket) gösterir.

### Örnek: aynı konaklama, beş fiyatlama yolu

Veri: Standart oda, 10–12 Temmuz (2 gece), 3 yetişkin. Taban fiyat 2.500 TL; Temmuz sezon çarpanı 1,4. Fiyat planı "Yaz BB": 4.000 TL / gece, 2 kişi için, fazla yetişkin 800. Paket "Aile": 5.200 TL / gece, BB. Acente "Mavi Tur" kontratı Standart BB 3.200 TL / gece. Onaylı dinamik çarpan 10 Temmuz için 1,10 (11 Temmuz'da yok). Promosyon "Erken rezervasyon %10" yayında ve koşullar tutuyor.

| Yol | Gece 10 Tem | Gece 11 Tem | Toplam | Nasıl hesaplandı |
|-----|-------------|-------------|--------|------------------|
| 1. Yalnız sezon × taban (plan silinmiş olsa) | 2.500 × 1,4 × 1,10 = 3.850 | 2.500 × 1,4 = 3.500 | 7.350 | Çarpan yalnız 10 Temmuz'a; promosyon üstüne %10 düşerse 6.615 |
| 2. Fiyat planı (resepsiyon, promosyon uygun) | (4.000 + 800) × 1,10 = 5.280 | 4.000 + 800 = 4.800 | 10.080 → promosyon −1.008 = **9.072** | Plan + kişi başı ek; çarpan; promosyon liste üzerinden |
| 3. Paket "Aile" | 5.200 | 5.200 | **10.400** | Sabit paket fiyatı; kişi farkı, çarpan, promosyon yok |
| 4. Acente Mavi Tur | 3.200 | 3.200 | **6.400** | Kontrat fiyatı; çarpan ve promosyon yok; komisyon %12 rezervasyona kopyalanır |
| 5. Elle fiyat (yetkili, gerekçeli) | 4.500 | 4.500 | **9.000** | Yazılan tutar; hiçbir katman uygulanmaz |

Aynı iki gece için beş farklı toplam çıkması hata değil, kuralın kendisidir: her yolun kendi sözleşmesi vardır. Gece dökümünde her gecenin yanında kaynağı ("Yaz BB planı", "Mavi Tur — Yaz 2027 kontratı", "Aile paketi", "elle: Teklif TKF-…") yazar.

## Fiyat planları ve paketler

### Fiyat planları

**Nerede:** Yönetim → Ayarlar → **Fiyat planları** (`/ayarlar/fiyat-planlari`). Görmek ve düzenlemek ayar yetkisi ister (müdür / yönetici).

**Ne yapar:** Bir oda tipi için, bir pansiyon tipinde, bir tarih aralığında sabit gecelik fiyat tanımlar. O geceye düşen plan varsa sezon çarpanı **uygulanmaz**; plan fiyatı geçer. Plan yoksa eski sezon davranışı birebir devam eder — yani planları yavaş yavaş, oda tipi oda tipi tanıtabilirsiniz.

Pansiyon tipleri sabittir ve kullanıcı tanımlı değildir: **RO** (sadece oda), **BB** (oda + kahvaltı), **HB** (yarım pansiyon), **FB** (tam pansiyon), **AI** (her şey dahil), **UAI** (ultra her şey dahil). Aynı kodlar acente kontratlarında ve kanal eşleştirmesinde kullanılır.

**Adım adım:**

1. "Yeni fiyat planı" düğmesine basın.
2. Plan adı yazın (örneğin "Yaz 2027 Standart BB"). Bu ad rezervasyon gece dökümünde "sezon adı" yerine görünür.
3. Oda tipi ve pansiyon tipini seçin.
4. Başlangıç ve bitiş tarihini girin.
5. Gecelik fiyatı girin. Fiyatın kaç kişi için olduğunu ("taban kişi sayısı") ve fazla yetişkin / çocuk başına ekleri yazın. Ekler sıfır olabilir.
6. Kaydedin.

**Form alanları:**

| Alan | Ne anlama gelir | Örnek |
|------|-----------------|-------|
| Ad | Gece dökümünde "sezon adı" yerine görünür | Yaz 2027 Standart BB |
| Oda tipi | Plan yalnızca bu tipe | Standart |
| Pansiyon | RO / BB / HB / FB / AI / UAI — yalnızca bu pansiyona | BB |
| Başlangıç – bitiş | İki uç dahil | 15.06.2027 – 15.09.2027 |
| Gecelik fiyat | Vergi dahil, taban kişi sayısı için | 4.000 |
| Taban kişi sayısı | Fiyatın kapsadığı kişi | 2 |
| Fazla yetişkin eki | Taban üstü her yetişkin için gece başına | 800 |
| Çocuk eki | Her çocuk için gece başına | 400 |
| Aktif | Pasif plan fiyat hesabına girmez | Evet |

**Kişi başı ek örneği:** 2 yetişkin + 1 çocuk, 3 gece: (4.000 + 400) × 3 = **13.200 TL**. 3 yetişkin: (4.000 + 800) × 3 = 14.400 TL. 1 yetişkin: 4.000 × 3 = 12.000 TL (taban altı kişi indirimi yoktur).

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür | Hatada |
|-------------|---------|----------------|--------|
| Plan kaydedildi / değişti / silindi | Fiyat hesabının önbelleği tazelenir; "fiyat değişti" olayı yayınlanır | Rezervasyon önizlemesi anında yeni fiyat | Çakışan dönem varsa kayıt reddedilir, hangi planla çakıştığı yazılır |
| "Fiyat değişti" olayı | Kanal aktörü senkrondaki kanalları planın dönemi için "gönderilecek var" işaretler | Kanallar → Senkron logu (5–10 sn içinde) | Kanal aktörü kapalıysa atlanır; açılınca tam eşitleme |
| Rezervasyon açılıyor | O gece için uygun plan aranır; varsa plan fiyatı + kişi başı ek, sezon çarpanı uygulanmaz | Gece dökümünde plan adı | Plan yoksa sezon × taban |

Aynı oda tipi + pansiyonda **dönemleri çakışan iki yayındaki plan olamaz**; ekran hangi planla çakıştığını söyler, veritabanı da son savunma olarak reddeder.

**Dikkat:**

- Plan fiyatı değişince yalnızca **sonradan açılan** rezervasyonlar etkilenir. Açılmış rezervasyonun geceleri açıldığı günkü fiyatla kalır.
- Kişi başı ek, teklif ve widget önizlemesinde de yansır (kayıt ile önizleme aynı tutarı verir).
- Bir oda tipi silinemez; fiyat planı ona bağlıdır. Önce planı kaldırmanız gerekir.
- Toplu satır-sütun düzenleme (bir tabloda bütün tipler × pansiyonlar) henüz yoktur; her plan tek tek açılır.

### Paketler

**Nerede:** Yönetim → Ayarlar → **Paketler** (`/ayarlar/paketler`).

**Ne yapar:** Oda + ek hizmet demeti (örneğin "Balayı paketi: Deluxe oda, BB, SPA masajı, transfer") için **sabit gecelik fiyat** tanımlar. Rezervasyonda paket seçilince pansiyon paketten gelir, oda gecesi paketin gecelik fiyatıyla yazılır; sezon, plan ve kişi farkı uygulanmaz.

**Adım adım:**

1. "Yeni paket" → kod (otel içinde tekil), ad, pansiyon tipi, gecelik fiyat.
2. Bileşenleri yazın (SPA, transfer, akşam yemeği…). Bileşenler **bilgi amaçlıdır**: folyoya ayrı kalem olarak düşmez; misafire ve personele "pakete ne dahil" demek için vardır.
3. Aktif işaretleyip kaydedin. Pasif paket rezervasyonda seçilemez.

**Form alanları:**

| Alan | Ne anlama gelir |
|------|-----------------|
| Kod | Otel içinde tekil; silinen paketin kodu yeniden kullanılabilir |
| Ad | Rezervasyon formunda ve detayda görünür |
| Pansiyon | Paket seçilince rezervasyonun pansiyonu bu olur, değiştirilemez |
| Gecelik fiyat | Vergi dahil, sabit; kişi sayısına göre değişmez |
| Bileşenler | Serbest liste (SPA 50 dk, transfer, oda süslemesi); bilgi amaçlı |
| Aktif | Pasif paket seçilemez; eski rezervasyonlar bozulmaz |

**Rezervasyon formunda:** Kaynak resepsiyon ise "Paket" seçicisi görünür. Paket seçilince pansiyon alanı kilitlenir ve fiyat notunda "paket fiyatı" yazar. Rezervasyon detayında paket adı görünür.

**Örnek:** "Balayı" paketi Deluxe, BB, 7.500 TL / gece. 3 gece, 2 yetişkin: **22.500 TL**. Aynı 3 gece için Deluxe fiyat planı 6.000 olsa da misafir pakette SPA ve transferi alır, resepsiyon tek fiyatla konuşur. Aynı rezervasyona kupon girilirse önizleme "paketli oda kupon almaz" der; kaydetmeye çalışılsa sunucu reddeder.

**Dikkat:**

- Paket **acente kontratıyla, elle fiyatla ve kuponla birleşmez**; sistem bunu reddeder. Paket "net demet fiyatı"dır.
- Paketli odaya promosyon uygulanmaz.
- Web widget'ında paket satışı şu an **yoktur** (oda + pansiyon satılır); yol haritasında.
- Paket bileşenlerinin folyoya ayrı kalem olarak yansıması ileriki sürüm.

## Dinamik fiyat ve fiyat önerileri

Bu modülün bir cümlelik özeti: **sistem fiyat önerir, insan karar verir.** İki üretici vardır (kural işi ve yapay zekâ ajanı), tek karar yolu vardır (onay kuyruğu), tek uygulama biçimi vardır (gece çarpanı).

### Yield kuralları ayarı

**Nerede:** Yönetim → Ayarlar → **Dinamik fiyat** (`/ayarlar/dinamik-fiyat`).

**Ne yapar:** Günlük değerlendirmenin eşiklerini belirler. Varsayılan değerler:

- Değerlendirme ufku: **30 gün** ileri.
- Yüksek doluluk kuralı: doluluk **≥ %80** ise **+%10** öner.
- Son dakika indirimi: doluluk **≤ %30** ve giriş **≤ 7 gün** sonra ise **−%15** öner.
- Dinamik fiyat **kapalı** başlar; açmak için "etkin" kutusunu işaretleyin.

Kural tetiklenince fiyat **değişmez**; öneri üretilir ve onay kuyruğuna düşer. Ayar kaydedilince hesap önbelleği anında tazelenir.

### Önerilerin üretilmesi (arka plan)

- **Kural işi** her **6 saatte** bir koşar (günde bir değerlendirme yeter; iş tekrar koşsa da aynı dönem için ikinci öneri açmaz, bekleyen öneri ya da zaten uygulanmış aynı çarpan varsa atlar). Her oda tipi için gün gün doluluğa bakar; **ardışık aynı-çarpanlı günleri tek öneride birleştirir** — büyük otelde onay kuyruğu gün × oda tipi kadar kalemle dolmaz.
- Doluluk hesabı: satılabilir oda = toplam − arızalı; satılan = satılabilir − boş. Geçen yıl karşılaştırması "364 gün önce" (haftanın aynı günü) ile yapılır.
- **Fiyat ajanı** (pricing-agent) günlük "fiyat değerlendirmesi" olayıyla uyanır. Yalnızca eşiklere yakın günleri alır (en fazla 120 satır — istem maliyeti sınırlı), bekleyen dönemleri bilir (mükerrer önermez). Çıktısı satır satır doğrulanır: bilinmeyen oda tipi, pencere dışı tarih, emniyet aralığı dışı yüzde ya da bekleyen dönemle çakışma **yalnız o satırı** düşürür. Ajanın önerileri kural işiyle **aynı kapıdan** girer; ajanın fiyat değiştirme yetkisi hiçbir yerde yoktur.
- Ajan kayıtlı değilse (model anahtarı yoksa) ya da Aktörler ekranında kapalıysa kural tabanlı yield **bağımsız çalışmaya devam eder**; kimse fiyatsız kalmaz.
- **Emniyet aralığı:** çarpan 0,5–3 arasıdır. Hiçbir onay fiyatı yarının altına ya da üç katının üstüne taşıyamaz (veritabanı kısıtı + sözleşme + ajan doğrulaması).

### Fiyat önerileri ekranı

**Nerede:** Yönetim → **Fiyat önerileri** (`/fiyat-onerileri`). Onay görme yetkisi olan görür; onaylamak için onay karar yetkisi gerekir.

**Ne gösterir:** Süzgeçli liste — dönem, oda tipi, mevcut fiyat, önerilen fiyat, çarpan (örneğin "+%10"), kaynak (kural / ajan), durum (bekliyor / onaylandı / reddedildi / süresi doldu). Her kartta **gerekçe** (serbest metin) ve **yapılandırılmış girdi tablosu** (gün gün doluluk, satılabilir, satılan, kalan gün, geçen yıl) bulunur. Altta **fiyat geçmişi grafiği**: uygulanmış gece çarpanları, artış sağa (amber), indirim sola (mavi); geçmişe ve 30 gün ileriye bakar.

**Adım adım (karar):**

1. Öneriyi açın, gerekçeyi ve girdi tablosunu okuyun.
2. İsterseniz **"Düzenle"** ile çarpanı değiştirin (örneğin +%10 yerine +%7). Düzenleme karar vermez; yalnızca uygulanacak çarpanı günceller.
3. **Onayla** ya da **Reddet**. Karar, Onaylar ekranından da verilebilir (öneri aynı zamanda bir onay kaydıdır; "toplu fiyat değişikliği" tipinde).

**Onaylanınca arka planda:** Dönemin her gecesine oda tipi için **gece çarpanı** yazılır (bir geceye tek ayar; yenisi eskisinin üstüne). Fiyat hesabı önbelleği tazelenir; **yeni rezervasyonlar** onaylı fiyattan açılır; kanal aktörüne "fiyat değişti" gider, OTA'lara giden fiyat da aynı çarpanla çıkar (misafir sitede ne görüyorsa kanal onu satar). Reddedilince hiçbir şey yazılmaz. Süresi dolan öneri de uygulanmaz.

**Örnek — bir önerinin ömrü:**

| Adım | Ne olur | Sayılar |
|------|---------|---------|
| 1. Kural işi koşar (06:00) | 18–20 Temmuz Standart doluluğu okunur | 40 oda, 2 arızalı → satılabilir 38; boş 6 → satılan 32 → doluluk **%84** (≥ %80) |
| 2. Öneri üretilir | Üç gün aynı çarpan → tek öneri | Çarpan **1,10** (+%10), kaynak: kural "Yüksek doluluk"; mevcut fiyat 4.000 → önerilen 4.400 |
| 3. Onay kaydı açılır | "Toplu fiyat değişikliği" tipinde onay | Onaylar → Bekleyen'de ve Fiyat önerileri'nde görünür |
| 4. Ajan da aynı günü değerlendirir | Bekleyen dönemi bilir, çakışan satır üretmez; 21 Temmuz için ayrı öneri yapabilir | Örneğin 21 Tem +%15 → çarpan 1,15, gerekçe "geçen yıl aynı hafta %92 dolmuştu" |
| 5. Müdür düzenler | 1,10 yerine 1,15 yazar (emniyet 0,5–3 içinde) | Önerilen 4.600 |
| 6. Onaylar | Karar olayı → 18, 19, 20 Temmuz Standart gecelerine çarpan 1,15 yazılır; "fiyat değişti" yayınlanır | Fiyat geçmişi grafiğinde üç amber çubuk; Senkron logunda OTA'ya 4.600 gider |
| 7. Yeni rezervasyon | 19 Temmuz Standart BB, 2 kişi: plan 4.000 × 1,15 = **4.600**; 3 kişi: (4.000 + 800) × 1,15 = 5.520 | Gece dökümü "Yaz BB planı · dinamik +%15" |
| 8. Mavi Tur aynı gece | Kontrat 3.200 — **değişmez** | Çarpan kontratı etkilemez |
| 9. Ertesi gün iş yeniden koşar | Aynı dönem için "zaten aynı çarpan uygulanmış" → atlar | Kuyruk şişmez |

Reddedilseydi 6. adımda hiçbir şey yazılmazdı; onay kuyruğundaki bekleme süresi dolarsa öneri "süresi doldu" olur ve yine hiçbir şey yazılmaz.

**Arka planda — özet tablo:**

| Ne tetikler | Ne olur | Nerede görünür | Kapalıysa / hatada |
|-------------|---------|----------------|--------------------|
| 6 saatlik kural işi | Doluluk okunur, eşik kuralları → öneri + onay kaydı | Fiyat önerileri, Onaylar | Dinamik fiyat ayarı kapalıysa sessiz; hata bir oteli etkiler, diğerleri devam eder |
| Günlük "fiyat değerlendirmesi" olayı | Fiyat ajanı eşiklere yakın günleri alır, öneri üretir | Fiyat önerileri (kaynak: ajan) | Ajan kayıtsız / kapalı → yalnız kural işi; bozuk satır düşer, kuyruğa taşmaz |
| Onay verildi | Gece çarpanları yazılır; "fiyat değişti" | Fiyat geçmişi, yeni rezervasyon fiyatı, OTA | Uygulama hatası loglanır; onay kaydı durur, karar yeniden verilebilir |
| Onay reddedildi / süresi doldu | Öneri kapanır, yazım yok | Fiyat önerileri durumu | — |
| Yield ayarı kaydedildi | Önbellek tazelenir | Sonraki iş yeni eşiklerle | — |

**Neden fiyat planı değil, çarpan?** Yield gün bazlıdır. Fiyat planlarının dönemlerini bölmek kırılgan olur ve pansiyon başına ayrı satır isterdi. Çarpan bütün pansiyonlara oransal uygulanır, planlarınız bozulmaz.

**Dikkat:**

- Çarpan **acente kontratı, paket ve elle fiyatı etkilemez**.
- Teklif (Satış CRM) ve rezervasyon önizlemesi aynı çarpanı gösterir; sürpriz yok.
- Grafik uygulanan çarpanları gösterir; "etkin satış fiyatı" (plan + sezon + çarpan bileşke) eğrisi ileriki sürüm.
- Etkinlik takvimi, gelmeme riski ve rakip fiyatı ileride ajana girdi olarak eklenecek; yapı hazır, şu an bu girdiler kullanılmaz.

## Acenteler ve kontratlar

**Nerede:** Ön büro → **Acenteler** (`/acenteler`). Görmek müdür ve muhasebe; düzenlemek müdür.

**Ne yapar:** Acenteleri (tur operatörü, seyahat acentesi, kurumsal müşteri) ve onların **kontratlarını** tutar. Acente adına açılan rezervasyon kontrat fiyatını otomatik alır; kontratta olmayan gece **satılamaz**.

### Acente kartı

Liste ekranında ad / kod / yetkili araması, durum süzgeci; satırda komisyon yüzdesi, vade (gün) ve bugün satıştaki kontrat görünür. **Kontratı olmayan aktif acente uyarılır** — adına rezervasyon açılamaz.

Acente kartı (`/acenteler/:id`) sekmeleri: **Genel** (firma, yetkili, iletişim, vergi bilgisi, komisyon, vade; pasife alma), **Kontratlar**, **Rezervasyonlar ve cari**, **Kota** (allotment), **Prim ve hedef** (prim izni olana).

Acente silinmez, **pasife alınır**. Pasif acente adına yeni rezervasyon açılmaz; iptal geri alma da engellenir.

### Kontrat

**Nerede:** Acente kartı → Kontratlar → "Yeni kontrat" → kontrat sayfası (`/acenteler/kontrat/:id`).

**Adım adım:**

1. Kontrat taslak açılır: ad, dönem (başlangıç–bitiş).
2. **Fiyat tablosu:** dönem blokları × oda tipi × pansiyon. Her hücre **oda başı gecelik** fiyattır; boş hücre "bu kombinasyon satılmaz" demektir. Birden çok dönemde bloklar kapalı başlar; "dönemi kopyala" ile hızlı doldurulur. Aynı oda tipi + pansiyon için dönemler çakışamaz — hata hücreye yazılır.
3. **Stop-sale:** acentenin satamayacağı günler (oda tipi boşsa bütün tipler). Stop-sale elle fiyatla da aşılmaz.
4. "**Satışa aç**". Taslak satışa kapalıdır; satışa açıldığında acente adına açılan rezervasyonlar bu fiyatları alır.
5. Dönem bitince ya da anlaşma biterse "Sonlandır". Sonlandırılmış kontrat salt okunurdur.

**Kurallar:**

- Aynı acentenin aynı günü kapsayan **en fazla bir satıştaki kontratı** olabilir.
- Satıştaki kontratın fiyatı değiştirilebilir; **denetim izi** eklenen / kaldırılan / değişen satırı yazar; yalnızca **sonradan açılan** rezervasyonlar etkilenir.
- Kontrat para birimi otelin para birimidir.
- Kişi başı ek, tek kişi farkı, çocuk indirimi kontratta yoktur; kontrat fiyatı oda başınadır.

**Acente kartı alanları:**

| Alan | Ne anlama gelir |
|------|-----------------|
| Kod, ad | Otel içinde tekil; rezervasyon formunda aranır |
| Yetkili, telefon, e-posta | İletişim |
| Vergi no / dairesi | Fatura ve cari için |
| Komisyon % | Rezervasyon açılırken rezervasyona **kopyalanır**; prim ve cari hesabında kullanılır |
| Vade (gün) | "Cariye aktarılan" tutarın vadesi: çıkış + vade |
| Aktif / pasif | Pasif acente adına satış yapılmaz |

**Kontrat fiyat tablosu örneği (Yaz 2027, 1 Haziran – 30 Eylül):**

| Dönem | Standart BB | Standart HB | Deluxe BB | Deluxe HB |
|-------|-------------|-------------|-----------|-----------|
| 1 Haz – 30 Haz | 2.800 | 3.300 | 3.900 | 4.400 |
| 1 Tem – 31 Ağu | 3.200 | 3.700 | 4.500 | 5.000 |
| 1 Eyl – 30 Eyl | 2.600 | — | 3.600 | — |

Eylül'de HB hücreleri boş: Mavi Tur Eylül'de HB satamaz; HB istenirse satış reddedilir ("kontratta fiyat yok: 12.09, 13.09"). Stop-sale 14–15 Temmuz (bütün tipler): o geceleri kapsayan acente rezervasyonu açılmaz; elle fiyatla da aşılmaz.

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Kontrat satışa açıldı | Acente adına açılan rezervasyonlar bu tabloyu kullanır | Rezervasyon formunda canlı kontrat fiyatı |
| Satıştaki kontratın fiyatı değişti | Denetim izine eklenen / kaldırılan / değişen satır yazılır; yalnız sonradan açılan rezervasyonlar etkilenir | Aktivite → Denetim kaydı |
| Stop-sale eklendi | Acente özel kilitlenir; aynı anda gelen rezervasyon ya eski ya yeni durumu görür | Kontrat ekranı Stop-sale bölümü |
| Acente pasife alındı | Yeni satış ve iptal geri alma engellenir; mevcut rezervasyonlar durur | Acente listesi |

### Acente adına rezervasyon

Rezervasyon formunda kaynak "**Acente**" seçilince aramalı acente seçici açılır; kontrat fiyatı canlı gösterilir, satılamayan oda tipi sebebiyle işaretlenir ("kontratta fiyat yok", "stop-sale", "kontrat yok", "acente pasif"). Hata mesajı hangi gecelerin sorunlu olduğunu söyler.

Rezervasyon açılırken **acentenin komisyon oranı rezervasyona kopyalanır**; kart sonradan değişse geçmiş rezervasyon etkilenmez. Düzenleme penceresinden acente sonradan atanır / değiştirilir / kaldırılır — yalnızca yeniden satılan geceler denetlenir; içerideki misafirde acente değişmez.

### Cari özeti

Acente kartının "Rezervasyonlar ve cari" sekmesinde: dönemde satış, komisyon (açılıştaki oranla), net, iptal / gelmeme ücretleri; "cariye aktarılan" = folyoda "Acente / cari" yöntemiyle kapatılan tutar ve vadesi gelen kısmı (çıkış + vade günü). Acentenin yaptığı ödemelerin düşümü **Ön muhasebe** modülündedir.

**Dikkat:**

- Stop-sale yazılırken aynı anda gelen rezervasyon ya eski durumu tam görür ya da yeni durumu — arada kalmaz (kilit düzeni).
- Grup rezervasyonunda satırlardan biri satılamıyorsa **hiçbiri** açılmaz.
- Acente satışına **promosyon da kupon da uygulanmaz**; dinamik çarpan da etkilemez.

## Allotment / kota

**Nerede:** Acente kartı → **Kota** sekmesi.

**Ne yapar:** Acenteye bir dönem boyunca oda tipinde gecelik **garanti kota** ayırır. Kota bir **garantidir, tavan değil**: acentenin kotası dolunca satış genel havuzdan devam eder (fiziksel yer varsa açılır). Genel satış ise release tarihine kadar başka acentelerin **kullanılmamış** kotasını göremez.

**Adım adım:**

1. Kota sekmesinde "Yeni kota": oda tipi, dönem (iki uç dahil), adet (1–500), **release günü** (0–365).
2. Kaydedin. Aynı acente + oda tipinde yayındaki dönemler çakışamaz.
3. **Kullanım tablosu** gün gün verilen / kullanılan / kalan / release durumunu gösterir.

**Release nasıl çalışır:** Release tarihi = giriş gecesi − release günü. **O günden itibaren (dahil)** kullanılmamış kota genel havuza döner. Release günü 0 ise gelecek geceler girişe kadar tutulur, günün gecesi serbesttir (same-day satış herkese açık).

**Örnek — 10 oda garanti, release 3 gün:** Mavi Tur, Standart, 1–31 Temmuz, 10 oda, release 3 gün. Otelde 40 Standart oda. 20 Temmuz gecesine bakalım:

| Tarih (bugün) | Mavi Tur'un 20 Tem rezervasyonu | Tutulu kota | Genel satışın görebildiği Standart | Açıklama |
|---------------|---------------------------------|-------------|------------------------------------|----------|
| 1 Temmuz | 0 | 10 | 40 − dolu − 10 | Release tarihi 17 Temmuz; kota tamamen tutulu |
| 10 Temmuz | 4 | 6 | 40 − dolu − 6 | Kullanılan 4 düşüldü; 6 hâlâ tutulu |
| 16 Temmuz | 7 | 3 | 40 − dolu − 3 | Release'e bir gün var |
| **17 Temmuz** | 7 | **0** | 40 − dolu | Release tarihi (20 − 3) geldi: kalan 3 oda genel havuza ve OTA'ya açılır |
| 18 Temmuz | Mavi Tur 2 oda daha ister | 0 | — | Yer varsa genel havuzdan açılır (kota garanti, tavan değil) |

Mavi Tur 10 Temmuz'da 11. odayı isterse de reddedilmez: 10 oda kotadan, 11. genel havuzdan (fiziksel yer varsa). Kullanım tablosu 20 Temmuz satırında "verilen 10 / kullanılan 7 / kalan 3 / release 17.07" gösterir.

**Arka planda:** Kullanım ayrı bir sayaçta tutulmaz, **türetilir**: acentenin aynı oda tipinde o geceyi kapsayan geçerli (bekleyen / onaylı / içeride) rezervasyonları kotaya mahsup edilir. İptal kota hakkını kendiliğinden geri açar. Kota değişince: rezervasyon açma denetimi ("N oda acente kotasında tutulu" mesajı), fiyat teklifi, bekleme listesi (kotalı odaya zil çalmaz), misafir kanalı müsaitliği ve **kanal yöneticisine giden müsaitlik** (OTA kotalı odayı satamaz; release olunca kanala açılır) hepsi güncellenir. Kota azalınca bekleme listesi taranır.

**Dikkat:**

- **Oda planı ekranı kota düşümünü göstermez.** Planda "boş" görünen oda satışta kotaya takılabilir; kota görünürlüğü kullanım tablosundadır.
- Kota yazımları acenteyi özel kilitler; satış devam ederken kota değiştirmek güvenlidir.

## Gruplar

**Nerede:** Ön büro → Rezervasyonlar → **Gruplar** (`/gruplar`, dosya `/gruplar/:id`).

**Ne yapar:** Grup dosyasını tek yerden yönetir: gruptaki rezervasyonlar, folyo bakiyeleri, durum dağılımı, toplamlar; **toplu oda atama**, **toplu giriş** (en fazla 50), **toplu çıkış**; grup iptali.

**Rooming list:** Grup formunda satır başına misafir adı girilebilir; Excel'den yüklenir. Şablon sütunları: Ad, Soyad, Oda tipi kodu, Pansiyon, Yetişkin, Çocuk. Excel tarayıcıda okunur; hatalı satırlar numarasıyla listelenir, geçerliler grup satırlarına dolar. Rooming list şu an **ortak tarihlidir** (grubun giriş / çıkışı); satır başına farklı tarih ileriki sürüm.

**Toplu giriş kuralları:** Kimlik ve refakatçi bilgisi karttan okunup geri verilir (kayıtlı kimlik silinmez). Odası olmayan, kimlik politikasına takılan, erken giriş ücreti isteyen gibi ayrıntı gerektiren kayıt **sebebiyle atlanır**; tek tek alınır. Sonuç ekranı kimin neden atlandığını söyler.

**Grup master folyo** (tek folyoya toplama) folyo birleştirmesiyle yapılır; grup dosyası bakiyeleri okur.

## Acente primleri

**Nerede:** Ön büro → **Acente primleri** (`/acente-primleri`); acente kartında **Prim ve hedef** sekmesi. Görmek müdür ve muhasebe; kural açmak müdür; ödendi işaretlemek muhasebe ve müdür.

**Ne yapar:** Acentelere satış hedefi ve prim kuralı tanımlar, dönem içinde hedefe ulaşmayı izler, dönem sonunda hak edişi hesaplar, onaydan geçirir, ödemeyi kaydeder.

### Tanımlar (ne sayılır?)

- **Üretim** = dönemin içine düşen, misafirin **gerçekten kaldığı** geceler. İptal ve gelmeyen sayılmaz; dönem sınırını aşan konaklama gece gece bölünür. Henüz gelmemiş rezervasyon yalnızca **tahmin** olarak görünür.
- **Matrah** = folyoya işlenen **vergisiz oda geliri** (gelir raporuyla aynı tanım; komisyon düşülmez). Ciro hedefi de bununla ölçülür.
- Ters kayıt (iptal edilen gece) **asıl gecenin gününe** yazılır: dönemden sonra iptal edilen gece o dönemden düşer.
- **Acente puanı** = hedefe ulaşma yüzdesi + ulaşılan kademe + zamana göre durum (önünde / yakın / gerisinde — doğrusal beklentiye göre, %10 tolerans).

### Kural formu

1. Acente, dönem (en fazla 731 gün), ölçüt (**gece** ya da **ciro**).
2. Uygulama biçimi: **tüm üretime** (ulaşılan en yüksek kademenin oranı dönemin bütün cirosuna, geriye dönük) ya da **yalnız aşan kısma** (dilimli; her kademenin oranı yalnızca kendi dilimine).
3. Kademeler (1–10): eşik + prim yüzdesi. Eşiğe **eşit** üretim kademeye ulaşır.
4. İsteğe bağlı oda tipi süzgeci ve prim tavanı.
5. **Kaydetmeden önizleme** düğmesi kuralı okunur cümlelerle ve örnek hesapla gösterir.
6. Kaydet → "Yürürlüğe al". Aynı acentenin aynı ölçütte çakışan iki yürürlükteki kuralı olamaz.

Dilimli hesapta gece ölçütünün dilimi "dilimdeki gece × dönemin ortalama gece geliri" ile tutara çevrilir; sezon sonundaki pahalı geceler primi şişirmez. Prim yuvarlanmış dilimlerin toplamıdır; raporda dilimler toplamı primi her zaman tutar.

**Örnek — iki uygulama biçimi, aynı üretim:** Kural: ciro ölçütü, kademeler 1.000.000 → %2, 1.500.000 → %3, 2.000.000 → %4. Dönem üretimi (vergisiz oda geliri) 1.750.000 TL.

| Biçim | Hesap | Prim |
|-------|-------|------|
| Tüm üretime | Ulaşılan en yüksek kademe %3 (1.500.000 ≤ 1.750.000 < 2.000.000) → 1.750.000 × %3 | **52.500** |
| Yalnız aşan kısma (dilimli) | 1.000.000–1.500.000 dilimi: 500.000 × %2 = 10.000; 1.500.000–1.750.000 dilimi: 250.000 × %3 = 7.500 | **17.500** |

Tavan 15.000 olsaydı dilimli hesapta 15.000 ödenirdi. Gece ölçütünde (örneğin 1.000 gece eşiği) dilimdeki gece sayısı dönemin ortalama gece geliriyle tutara çevrilir: 1.200 gece, ortalama 3.500 TL → 200 aşan gece × 3.500 = 700.000 matrah × %2 = 14.000.

### Akış (arka plan)

- Zamanlanmış iş **30 dakikada bir** yürürlükteki kuralların ilerlemesini (gerçekleşen gece / ciro / puan / kademe) yazar; **kademe yükselince** yetkiliye bir kez zil çalar.
- Dönemin son gecesi kapanınca aynı iş hak edişi **kendisi hesaplar** ve yöneticiye "onaya gönderin" zili düşer. Prim doğmayan dönem kuyruğa gitmeden kapanır.
- Yetkili **onaya gönderir**. Gönderirken **bayatlık** denetlenir: kural hesaptan sonra değişmişse ya da bugünkü üretim hesaptakinden farklıysa önce yeniden hesap ister.
- Onay kuyruğunda **dört göz**: gönderen onaylayamaz. Ret ya da 7 günde karar verilmemesi hak edişi "hesaplandı"ya döndürür (gerekçe görünür).
- Onaylı hak edişi muhasebe **ödendi** işaretler (gün + belge no; ileri tarih ve onaydan önce olamaz); gerekçeyle geri alınabilir. Onaylı ama ödenmemiş hak ediş gerekçeyle yeniden açılabilir.
- Hak edişin dayandığı rezervasyonlar **dondurulur** (rezervasyon başına dönemdeki gece ve ciro); rapor ve Excel buradan çıkar.

**Dikkat:**

- Hak edişi onaya gitmiş kural **değiştirilemez / iptal edilemez**; önce hak ediş yeniden açılır.
- Dönemi uzatılan kuralın taslak hak edişi silinir (yeniden hesaplanır).
- Acente carisinden prim düşümü / ödeme kaydı **Ön muhasebe** modülündedir.
- Misafir sadakat puanı ayrı bir modüldür; burada yalnızca acente hedefi vardır.

## Promosyonlar ve kuponlar

**Nerede:** Ön büro → **Promosyonlar** (`/promosyonlar`; yeni promosyon `/promosyonlar/yeni`). Görmek müdür ve muhasebe; düzenlemek müdür. Kupon alanı rezervasyon formunda herkese açıktır.

**Ne yapar:** "Erken rezervasyon %15", "3 gece kal 2 gece öde", "kurumsal kupon 500 TL" gibi kampanyalar tanımlar; rezervasyon fiyatına kendiliğinden ya da kupon koduyla uygular; kullanım raporu çıkarır.

### Temel kural: bir rezervasyona tek indirim

Uygun **kendiliğinden** promosyonlar ve girilen **kuponun** promosyonu arasından misafire **en avantajlısı** seçilir. Kupon daha avantajlı değilse kullanılmaz ve **hakkı düşmez**. Eşitlikte kendiliğinden promosyon kazanır (kupon hakkı harcanmaz).

**Örnek — kupon %10'a karşı kendiliğinden promosyon:** Yayında iki kampanya: "Erken rezervasyon %15" (kendiliğinden; girişten ≥ 45 gün önce, ≥ 3 gece) ve "Kurumsal kupon %10" (kuponla; KURUM-7X2K kodu, 20 kullanım). Misafir 50 gün önceden 3 gece Standart BB (liste 3 × 4.000 = 12.000) açtırıyor ve kupon kodunu veriyor.

| Teklif | Koşul tutuyor mu | İndirim | Sonuç |
|--------|------------------|---------|-------|
| Erken rezervasyon %15 | Evet (50 ≥ 45 gün, 3 ≥ 3 gece) | 1.800 | **Seçilir** |
| Kupon %10 | Evet | 1.200 | Daha az avantajlı → kullanılmaz, **hak düşmez** (20 kullanım kalır) |

Önizleme: "Kupon KURUM-7X2K geçerli ama daha avantajlı promosyon uygulanıyor." Misafir 2 gece isteseydi erken rezervasyon şartı (≥ 3 gece) bozulur, kupon %10 seçilir, hak 19'a düşer. Aynı misafir sonradan 2 geceyi 1'e kısaltırsa kupon koşulu yine tutuyorsa indirim yeni toplama göre (400) yeniden hesaplanır; kupon "en az 2 gece" isteseydi indirim **kalkar** ve fark folyoya düzeltme olur — önizleme bunu önceden söyler.

### Promosyon tanımı

1. Ad (otel içinde tekil). Promosyon **taslak** açılır.
2. **İndirim türü:** yüzde / konaklama başına tutar / "X gece kal Y gece öde".
3. **Koşullar** (hepsi tutmalı): satış dönemi (rezervasyonun açıldığı tarih), konaklama dönemi, en az / en fazla gece, erken rezervasyon günü (girişten en az N gün önce) ya da son dakika günü, oda tipleri, pansiyonlar, satış kanalları (resepsiyon, web, WhatsApp…). **Acente kanalı asla seçilemez.**
4. Kuponla mı uygulanacak? Evetse "Kuponlar" sekmesinden kupon üretin: toplu rastgele kod (karışmayan harfler, isteğe bağlı önek) ya da tek elle kod; kullanım: tek / sınırlı / sınırsız. Excel'e aktarılır, tek tek kapatılır / açılır.
5. "Kurallar" sekmesi yazarken kuralın cümlesini canlı gösterir ("Girişten en az 30 gün önce açılan, 1 Haziran–30 Eylül arası en az 3 gecelik Standart oda rezervasyonuna %15").
6. Kartta "yayına almayı engelleyen eksikler" listesi boşsa **Yayına al**. Yayında ⇄ durduruldu geçişi serbest. Hiç kullanılmamış promosyon silinebilir; kullanılmış olan durdurulur.

### İndirim nasıl dağılır

- İndirim yalnızca **konaklama dönemine düşen** gecelere; dönem dışı gece liste fiyatıdır.
- Yüzde her uygun geceye (kuruşa yuvarlı).
- Tutar gecelere fiyatları oranında dağıtılır; gecelerin toplamını aşmaz.
- "X kal Y öde": her X uygun gecede en ucuz (X − Y) gece bedava (eşit fiyatta sondaki).
- Gece kaydında indirim ayrı tutulur: liste fiyatı = tutar + indirim. Rezervasyon açılırken promosyonun koşulları **kopyalanır**; promosyon sonradan değişse de misafire verilen söz değişmez.

### Nerede uygulanır

Rezervasyon açma, grup, misafir kanalı istekleri (WhatsApp / web chat / widget — kupon kodu olayla gelir), kapasite onayından açılan rezervasyon ve **fiyat önizlemesi**. Önizlemede oda tipi kartında liste fiyatı + indirim ve kuponun durumu görünür: uygulanıyor / daha avantajlısı var / uymuyor / geçersiz / hak yetmez.

**Düzenlemede:** fiyat, konaklama ya da pansiyon değişince kopyadaki koşullar (kopyadaki satış günüyle) yeniden denetlenir — tutuyorsa indirim yeni gecelere göre, tutmuyorsa **kalkar** ve fark folyoya düzeltme olur. Önizleme ("yeni toplamla indirimin akıbeti") bunu yazmadan önce söyler. Acente atanınca ya da elle fiyat girilince indirim kalkar. **Erken çıkışta** kalan gecelerle şart yeniden denetlenir; çıkış penceresi uyarır. **Gelmedi ücreti** tek geceye iner ve şart o gece için denetlenir.

### Kupon hakkı

Kullanım sayaçla tutulmaz: kuponla açılmış **geçerli** rezervasyonlar sayılır. İptal / gelmeyen hakkı kendiliğinden geri açar. Tek kullanımlık kuponu aynı anda iki rezervasyon alamaz (kilit altında sayım). İptal geri alınırken kupon yeniden sayılır; başkası kullandıysa geri alma reddedilir. Grupta her oda bir kullanımdır; hak yetmezse grubun hiçbiri açılmaz.

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Rezervasyon açılıyor | Yayındaki kendiliğinden promosyonlar + kupon değerlendirilir; en avantajlısı seçilir; koşullar rezervasyona kopyalanır | Önizlemede liste fiyatı / indirim; detayda promosyon, kupon, gece indirimi |
| Kuponlu rezervasyon iptal / gelmedi | Hak kendiliğinden geri açılır (sayaç yok, geçerli rezervasyonlar sayılır) | Kuponlar sekmesinde "kullanılmamış" |
| Konaklama düzenlendi (tarih, pansiyon, fiyat) | Kopyadaki koşullar yeniden denetlenir; tutmuyorsa indirim kalkar, fark folyoya | Düzenleme penceresi "indirimin akıbeti" |
| Erken çıkış | Kalan gecelerle şart denetlenir | Çıkış penceresi uyarısı |
| Promosyon durduruldu | Yeni rezervasyon almaz; açılmış rezervasyonların sözü değişmez | Liste durumu |

### Kullanım raporu

Promosyonlar → "Kullanım raporu" sekmesi: dönemde (satış ya da giriş gününe göre) promosyon başına geçerli rezervasyon, iptal / gelmedi, gece, liste tutarı, verilen indirim, net, kullanılan kupon; toplamlar üstte. En fazla rapor sınırı kadar gün.

**Dikkat:**

- Tutar indirimli promosyon yayındayken otelin para birimi değiştirilemez.
- Promosyon **kanala (OTA) gitmez**; OTA'daki kampanya OTA'nın kendi işidir.
- Yayındaki promosyon silinemez; önce durdurun.

## Kanallar / OTA (kanal yöneticisi)

**Nerede:** Ön büro → **Kanallar** (`/kanallar`; kanal kartı sekmeleri: Ayarlar, Eşleştirme, Stop-sale, Senkron logu, Rezervasyonlar). Müdür yetkisi.

**Ne yapar:** Müsaitlik ve fiyat değişince OTA'ya gider; OTA'dan gelen rezervasyon sisteme düşer. İki kanal türü:

- **Channex:** Booking.com, Expedia, Airbnb, Agoda gibi OTA'lar Channex.io üzerinden bağlanır (biz Channex'e bağlanırız; Booking'e doğrudan bağlantı ayrı sertifika ister).
- **iCal:** Airbnb / Booking takvim adresi. Adres tabanlı, basit, fiyat taşımaz.

### Kanal kurma (Channex)

1. "Yeni kanal" → tür Channex; ad, ortam (test / canlı), mülk kimliği, API anahtarı, kaç gün ileriye gönderileceği, fiyat farkı yüzdesi (OTA'ya giden fiyata eklenen / düşülen pay).
2. **Eşleştirme sekmesi:** bizim oda tipi ↔ Channex oda tipi (müsaitlik buna gider) ve Channex **fiyat planları ↔ pansiyon** (fiyat ve stop-sale plana gider; gelen rezervasyonun pansiyonu buradan). Eşleşmeyen tip kanalda satılmaz.
3. **Webhook kurulumu** (rezervasyon geldiğinde anında haber).
4. Kartta "senkrona almayı engelleyen eksikler" boşsa (bağlantı doğrulanmış, para birimi aynı, eşleşme var) → **Senkrona al**. İlk tam eşitleme kendiliğinden yapılır.

API anahtarı ve webhook sırrı **şifreli saklanır**, hiçbir ekranda görünmez (yalnızca "var" bilgisi).

### Gönderim: ARI (müsaitlik, fiyat, stop-sale) — arka plan

- Müsaitliği etkileyen her olay (rezervasyon, iptal, giriş / çıkış, oda atama, arıza, oda envanteri, **kota değişimi**) ve fiyatı etkileyen her olay (taban fiyat, sezon, fiyat planı, onaylı dinamik çarpan) **kanal aktörü** tarafından yakalanır ve senkrondaki kanalı "gönderilecek değişiklik var" diye işaretler (gün penceresi birikir).
- Zamanlanmış iş **5 saniyede bir** penceredeki değerleri hesaplar — müsaitlik oda planının takviminden (tutulu kota düşülerek), fiyat liste hesabı + kanal farkı, stop-sale kanalın kendi kapatmaları — ve **kanala en son gönderilenle karşılaştırıp yalnızca farkı**, ardışık aynı değerleri tek aralıkta, **en fazla iki çağrıda** gönderir. Kanal başına en sık 10 saniyede bir (Channex sınırı).
- **Tam eşitleme** (500 gün): senkrona alınınca, eşleştirme / fiyat farkı değişince, "Şimdi eşitle" düğmesiyle ve her gece (otel saatiyle 02–05) bir kez.
- **Hata yönetimi:** pencere geri işaretlenir, hiçbir değişiklik kaybolmaz. 429'da 1 dakika, anahtar hatasında 30 dakika, geçici hatada artan bekleme (en çok 15 dk). **3 art arda hatada ya da anahtar hatasında müdüre zil** çalar ("kanal senkron" uyarısı). Kanalın reddettiği satırlar loga "kısmen" düşer.
- Kanal aktörü kapalıyken gönderim tetikleyicileri atlanır (personele görev düşmez); aktör açılınca tam eşitleme yapılır.

**Dürüst sınır — kanala giden fiyat:** OTA'ya giden fiyat **taban × sezon (+ onaylı dinamik çarpan) + kanal farkı**dır. Pansiyon başına **fiyat planı farkı** kanala henüz gitmez: bir oda tipinin eşlenmiş bütün Channex planları aynı fiyatı alır. Promosyon kanala gitmez.

### Gelen rezervasyon — arka plan

- Channex revizyon akışı **dakikada bir** okunur (webhook gelince hemen). Her revizyon **önce saklanır, sonra teyit edilir** (kart bilgisi saklanmaz).
- Kanal aktörü işler: **yeni** → oda başına **onaylı** rezervasyon; tutar **OTA'nın tutarı** elle fiyat olarak (gerekçe: kanal), pansiyon fiyat planı eşleşmesinden, misafir kartı açılır, nota kanal / kod / "ödeme kimde" yazılır. **Değişiklik** → bekleyen / onaylı rezervasyon güncellenir (azalan oda iptal). **İptal** → cezasız iptal (iptal eden "kanal:…").
- **Yer yoksa reddedilmez**: kapasite aşılarak açılır ve resepsiyona kritik **"overbooking"** uyarısı düşer (misafir OTA'da ödedi; sorun otelin çözeceği iştir).
- Yapılamayan adım (eşleşmeyen plan, içerideki / çıkmış misafirde değişiklik, geçmiş giriş, elle fiyatlı rezervasyonun tarih değişikliği) **"elle işlenmeli"** olur ve resepsiyona **manuel görev** düşer (Görevler menüsü, "Kanal rezervasyonu" modülü). Para birimi farkı ve iCal tutarı "**doğrulanmalı**" işaretlenir. Müdür gereğini yapınca kaydı notla kapatır.
- Aktör kapalıyken gelen rezervasyonlar da manuel göreve düşer; hiçbir rezervasyon kaybolmaz.

**Örnek — Booking.com'dan rezervasyon geldiğinde adım adım:**

1. Misafir Booking'de 2 Deluxe oda, 5–7 Ağustos, 2 gece, toplam 2 × 2 × 4.800 = 19.200 TL (Booking'in tutarı) rezervasyon yapar.
2. Channex webhook'u sunucuya "yeni revizyon var" der; akış hemen okunur (webhook gelmese de en geç 60 sn içinde).
3. Revizyon ortak biçime çevrilir, **saklanır**, Channex'e teyit edilir; "kanal rezervasyonu alındı" olayı yayınlanır. Kanal kartı → Rezervasyonlar sekmesinde "işleniyor" satırı.
4. Kanal aktörü oda tipi eşleşmesine bakar: Channex "Deluxe Double" ↔ bizim Deluxe; fiyat planı "Deluxe BB" ↔ BB.
5. **Oda başına bir rezervasyon** açılır: 2 onaylı rezervasyon, her biri 2 gece 4.800 (elle fiyat, gerekçe "kanal: Booking.com"), pansiyon BB, misafir kartı (ad, e-posta, telefon) açılır / bulunur, nota "Booking.com · 1234567890 · ödeme otelde" yazılır. Rezervasyon listesinde kaynak "Kanal", detayda kanal adı ve kodu.
6. Rezervasyon açılması müsaitliği değiştirir → aynı aktör kanalı yeniden "gönderilecek var" işaretler; 5–10 sn içinde Deluxe müsaitliği Channex'e (ve oradan diğer OTA'lara) düşürülmüş olarak gider.
7. **Yer yoksa:** 5 Ağustos'ta Deluxe tamamen doluysa rezervasyon yine açılır ve resepsiyona kritik "overbooking: Deluxe, 5 Ağustos, 1 oda" uyarısı düşer; resepsiyon üst tipe taşır ya da misafirle görüşür.
8. **Değişiklik gelirse** (misafir 6–8 Ağustos'a kaydırır): bekleyen / onaylı rezervasyon güncellenir, geceler yeniden yazılır; misafir içerideyse yapılamaz → "elle işlenmeli" + manuel görev.
9. **İptal gelirse:** cezasız iptal, iptal eden "kanal: Booking.com"; müsaitlik geri açılır ve kanala gider.
10. Para birimi farklıysa (OTA EUR gönderdi, otel TRY) rezervasyon "doğrulanmalı" işaretlenir; müdür tutarı kontrol edip kaydı notla kapatır.

**Arka planda — kanal yöneticisi özet tablosu:**

| Ne tetikler | Ne olur | Nerede görünür | Kapalıysa / hatada |
|-------------|---------|----------------|--------------------|
| Müsaitlik olayı (rezervasyon, iptal, giriş / çıkış, arıza, kota) | Kanal "kirli" işaretlenir; 5 sn'lik iş farkı gönderir | Senkron logu | Aktör kapalı → atlanır, açılınca tam eşitleme; kanal hatası → bekleme + 3 hatada zil |
| "Fiyat değişti" (taban, sezon, plan, onaylı çarpan) | Fiyat penceresi kirli | Senkron logu | Aynı |
| Gece 02–05 | Tam eşitleme (500 gün, 2 çağrı) | Senkron logu "tam eşitleme" | — |
| Channex revizyonu | Saklanır, teyit edilir, aktör işler | Kanal rezervasyonları, rezervasyon listesi | Aktör kapalı → manuel görev; işlenemeyen → "elle işlenmeli" görevi |
| iCal okuma (15 dk) | Yeni / değişen / kalkan kayıt revizyon olur | Kanal rezervasyonları | Takvim birden boşsa toplu iptal yok, uyarı |
| 6 saatte bir | 90 günden eski log silinir | — | — |

### iCal

- **Dışa aktarma:** Eşleştirme sekmesinde oda tipi başına kopyalanabilir takvim adresi (`…/channel-ical/<gizli belirteç>.ics`). Satılamayan günler (boş odası olmayan ya da stop-sale) "dolu" görünür. Kanal yaklaşık 1–3 saatte bir okur.
- **İçe aktarma:** kanalın takvim adresi girilir; **15 dakikada bir** okunur. Takvimdeki dolu günler **onaylı rezervasyon** olarak açılır: misafir adı "Airbnb misafiri HM…", fiyat **geçici olarak sistem fiyatı** ve kayıt "doğrulanmalı". Tarihi değişen güncellenir; takvimden kalkan ve henüz gelinmemiş olan iptal edilir. Airbnb'nin "Not available" kapatması rezervasyon açmaz. Takvim birden boş gelirse toplu iptal **yapılmaz**, uyarı düşer.
- Güvenlik: yalnızca https, iç ağa çözülen adres ve yönlendirme reddedilir; boyut ve süre sınırlı.

### Stop-sale sekmesi

Kanala özel kapatma: seçilen günlerde (iki uç dahil) kanal satış yapmaz — Channex'te fiyat planlarına "satışa kapalı" gider, iCal'de günler dolu görünür. **Otelin kendi satışını (resepsiyon, web) etkilemez.** Oda tipi seçilmezse bütün tipler. Acente kontratındaki stop-sale ile karıştırmayın; o acenteye özeldir.

### Senkron logu

Ne gönderildi / ne alındı, sonuç, süre, hata; satıra basınca gönderilen aralıklar ve kanalın cevabı. **90 gün** saklanır. Channex sertifikasyonu için kanıtlar (görev kimlikleri) buradadır.

**Dikkat:**

- Senkrona almadan önce test ortamında deneyin.
- Mülk kimliği değişirse eşleştirme silinir; yeniden eşleştirin.
- Kanal silinmesi için önce durdurulmalıdır.
- Rezervasyon detayında kanal adı, kodu ve durumu görünür.

## Online rezervasyon widget'ı

**Nerede (ayar):** Yönetim → Ayarlar → **Mesaj kanalları** → Web chat kanalı → "**Online rezervasyon motoru açık**" kutusu ve altındaki **gömme kodu**.

**Ne yapar:** Otelin web sitesine tek satır betikle gömülen rezervasyon motoru. Misafir tarih ve kişi seçer, oda tipi ve fiyat listesini görür, bilgilerini girer, **onay kodunu ekranda** alır. Aynı widget chat balonunu da içine alır.

### Kurulum

1. Web chat kanalı yoksa önce açın (genel anahtar ve **izinli site listesi** burada; widget bu anahtarla ve yalnızca bu sitelerden çalışır).
2. "Online rezervasyon motoru açık" kutusunu işaretleyin, kaydedin.
3. Gömme kodunu kopyalayıp sitenin HTML'ine yapıştırın. **Rezervasyon motoru chat balonunu da içerir; ikisi için yalnızca bunu ekleyin.** Balon istenmiyorsa `data-chat="off"` eklenir.
4. Renk ve başlık kanal ayarından gelir.

### Misafir akışı

Tarih + kişi + pansiyon + kupon → oda tipi kartları (fiyat, indirim etiketi, "Son N" / "5+", sığmayan tip soluk) → seçimle kesin toplam (kişi başı ek dahil) → misafir formu (ad, soyad, e-posta zorunlu; telefon / not isteğe bağlı) → özet → **onay kodu ekranda**.

### Arka planda

- Fiyat, personelin gördüğü aynı teklif hesabıdır; public yanıt **kırpılır**: promosyon / kupon / acente kimlikleri ve gece dökümü dönmez; indirim yalnızca tutar + etiket; müsaitlik 0–5'e kırpılır (gerçek envanter sızmaz).
- Rezervasyon **bekleyen (PENDING)** açılır — ödeme yok; **resepsiyon onaylar**. Yer yoksa sebepli reddedilir, onaya gitmez. Aynı istek ağ hatasında tekrar gönderilse ikinci rezervasyon açılmaz.
- Koruma: anahtar → kanal, Origin ∈ izinli siteler, IP hız sınırı (okuma 30/dk, yazma 5/dk), yanıtlar önbelleksiz.
- Rezervasyon kaynağı **WIDGET** olarak düşer; rezervasyon listesinde görünür.

**Örnek — misafirin gördüğü:** 3 yetişkin, 10–12 Temmuz, BB, kupon yok. Standart kartı: "4.800 TL / gece" (plan 4.000 + 800 ek; 10 Temmuz'da onaylı çarpan varsa 5.280), "Son 3" (gerçek müsaitlik 3), Ekonomik oda kartı soluk ("2 kişilik"). Erken rezervasyon promosyonu uygunsa kartta "−%10" etiketi ve indirimli fiyat; promosyonun adı ve kimliği dönmez. Seçimde toplam: 5.280 + 4.800 = 10.080 → −1.008 = **9.072 TL**. Formu doldurur, onay kodu "**RZV-7KQ2MA**" ekranda; rezervasyon listesinde bekleyen, kaynak WIDGET; resepsiyon onaylar.

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür | Hatada |
|-------------|---------|----------------|--------|
| Widget fiyat sorar | Personel teklif hesabı çalışır, public yanıt kırpılır | — | İzinsiz site → 403; motor kapalı / bilinmeyen anahtar → 404; dakikada 30'dan çok → 429 |
| Misafir "Rezervasyon yap" | Bekleyen rezervasyon açılır (kaynak WIDGET), "rezervasyon açıldı" olayı | Rezervasyonlar → Liste; bildirim kuyruğu | Yer yoksa 422 sebepli red; aynı istek tekrarı ikinci kayıt açmaz |
| Rezervasyon açıldı | Müsaitlik değişti → kanal aktörü OTA'ya gönderir | Kanallar → Senkron logu | — |

**Dürüstlük notu — onay e-postası:** Rezervasyon olayı yayınlanır ve bildirim kuyruğuna düşer, ancak e-posta geçidi henüz **stub** (gerçek gönderici yok). Misafire e-posta fiilen gitmez. Bu yüzden widget onay kodunu ekranda gösterir ve "otel onaylayınca bilgi verilecek" der. E-posta geçidi canlandığında zincir hazırdır.

**Dikkat:**

- Widget doğrudan satıştır, kanal değildir; kanal yöneticisi ekranında görünmez.
- Paket satışı widget'ta yok; oda + pansiyon satılır.
- Metinler tr/en hazır; dil seçici ileriki sürüm.
- Online ödeme gelince rezervasyon doğrudan onaylı açılabilir; şimdilik resepsiyon onayı şart.

## Satış CRM (call center)

**Nerede:** Ön büro → **Satış CRM** (`/satis`; fırsat dosyası `/satis/:leadId`). Varsayılan olarak müdür ve resepsiyon görür ve kayıt girer (telefonu açan resepsiyon kaydı girer).

**Ne yapar:** Telefonla / e-postayla gelen her talebi **fırsat** olarak kaydeder, aramaları günlüğe yazar, **teklif** hazırlar (PDF), kabul edilince **rezervasyona çevirir**, takip tarihlerini hatırlatır.

### Fırsat panosu

Sütunlar: **Yeni → Teklif verildi → Bekliyor → Kazanıldı / Kaybedildi**. Sürükle-bırak bilinçli olarak yoktur; durum kartın menüsünden değiştirilir. Özet şeridi ve "**bugün aranacak**" süzgeci üstte.

Kurallar: **Kazanıldı elle verilemez** — yalnızca teklif kabulüyle (rezervasyon bağı zorunlu). **Kaybedildi sebep ister.** Kapanmış fırsat panoda taşınmaz. Raporlar sonuçların elle oynanmamasına güvenir.

### Yeni fırsat ve arama kaydı

1. "Yeni fırsat": ad, telefon ya da e-posta (biri zorunlu), kaynak, istenen konaklama (tarih, oda tipi, kişi — teklifi önceden doldurur), takip tarihi, isteğe bağlı misafir kartı bağı.
2. Fırsat dosyasında "**Arama ekle**": kanal (personel / sesli AI), özet (zorunlu), sonuç. Arama günlüğü **ekle-yalnız**dır; düzeltme yeni kayıtla yapılır. "Tekrar aranacak" sonucu fırsatın takip tarihini aynı işlemde günceller.

### Teklif

1. "Teklif hazırla": tarih, oda tipi, pansiyon, kişi, geçerlilik (en fazla 60 gün; varsayılan 7 gün), not.
2. Kaydedince **fiyat kilitlenir**: gece gece anlık görüntü o anki sistem fiyatıyla (fiyat planı + onaylı dinamik çarpan dahil) yazılır. Sonradan zam ya da indirim müşteriye verilen sözü **bozmaz**.
3. **Taslak** düzenlenebilir (fiyat yeniden kilitlenir) → "**Gönderildi**" işaretle (fırsat Yeni → Teklif verildi) → **PDF indir** (otel başlığı, "Konaklama teklifi", gece gece tablo, toplam, geçerlilik; Türkçe font gömülü).
4. Müşteri kabul ederse "**Kabul**": rezervasyon **onaylı** açılır, toplam teklif toplamıdır (elle fiyat, gerekçe "Teklif TKF-XXXXXX"), fırsat **Kazanıldı** olur, onay kodu ve rezervasyon bağlantısı görünür. Yer yoksa sebepli red; teklif gönderilmiş kalır.
5. "Reddet" sebep ister. Geçerliliği geçen gönderilmiş teklif **30 dakikalık** süpürme işiyle "süresi doldu" olur; kabul edilemez.

**Örnek — fiyat kilidi:**

| Tarih | Olay | Sistem fiyatı (Standart BB, 2 kişi, 20 Tem) | Teklif |
|-------|------|----------------------------------------------|--------|
| 10 Haziran | Teklif hazırlanır: 19–22 Temmuz, 10 Standart, 3 gece | Plan 4.000, çarpan yok → 4.000 | Gece gece 4.000; toplam 10 × 3 × 4.000 = **120.000** kilitlenir |
| 12 Haziran | "Gönderildi"; PDF e-postayla elden gönderilir | — | Fırsat "Teklif verildi" |
| 25 Haziran | Dinamik öneri onaylanır: 18–21 Tem +%15 | 4.600 | Teklif **120.000 kalır** |
| 1 Temmuz | Yeni fiyat planı: 4.200 | 4.830 | Teklif 120.000 kalır |
| 3 Temmuz | Müşteri kabul eder | — | 10 onaylı rezervasyon, toplam 120.000, her gece 4.000 **elle fiyat**, gerekçe "Teklif TKF-K7QXNA"; fırsat **Kazanıldı** |
| 3 Temmuz | Aynı anda walk-in misafir 20 Tem Standart ister | 4.830 | Walk-in 4.830 öder; teklif misafiri 4.000 |

Teklif taslakken "Düzenle" denirse fiyat **yeniden** kilitlenir (o günkü fiyattan). Gönderilmiş teklif düzenlenemez; yeni teklif hazırlanır. Geçerlilik 10 Temmuz olsaydı ve müşteri 11 Temmuz'da kabul etmek isteseydi teklif "süresi doldu" olurdu; yeni teklif gerekir.

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Teklif kaydedildi | Gece gece fiyat anlık görüntüsü yazılır (plan + çarpan dahil) | Teklif kartı gece dökümü, PDF |
| "Gönderildi" | Gönderim anı kaydedilir; fırsat Yeni → Teklif verildi | Pano sütunu |
| Kabul | Rezervasyonlar onaylı açılır (teklif kimliği tekrar işleme anahtarı); fırsat Kazanıldı; misafir kartı bulunur / açılır | Rezervasyon listesi, pano |
| 30 dk'lık süpürme | Geçerliliği geçen gönderilmiş teklifler "süresi doldu"; takip tarihi gelen fırsatlar için günde tek zil | Teklif durumu; zil → pano "bugün aranacak" |

Kabul **idempotenttir**: aynı istek tekrarlansa ikinci rezervasyon açılmaz. Misafir kartı fırsata bağlıysa o kullanılır; değilse ad bölünüp (son kelime soyad) iletişimle yeni kart açılır; sonradan CRM birleştirmesiyle düzenlenir.

### Hatırlatma

"Bugün aranacaklar" = açık fırsatların takip tarihi ≤ iş günü olanları. Süpürme işi **günde tek birleşik zil** çalar (30 dakikalık turlar mükerrer çalmaz); zil panoya "bugün aranacak" süzgeciyle götürür.

**Dürüstlük notu — teklif e-postası:** "Gönderildi" düğmesi yalnızca kaydı tutar; e-posta otomatik gitmez (geçit stub). PDF indirilip elle gönderilir. Geçit canlanınca kuyruğa bağlama tek iştir.

**Dikkat:**

- Teklif kabulü elle fiyat yetkisi istemez; iz teklif kodundadır.
- Sesli santral çağrılarının günlüğe otomatik yazılması ve grup değerlendirme önerileri yol haritasındadır; alanlar hazır.

## Bütçe

**Nerede:** Ön büro → **Bütçe** (`/butce/plan`, `/butce/gerceklesen`, `/butce/sapma`; yıl adres çubuğunda `?yil=`). Müdür ve muhasebe görür / düzenler; onaylamak müdür.

**Ne yapar:** Yıllık bütçeyi ay ay tutar (gelir, doluluk / ADR hedefleri, nakit, gider), gerçekleşenle **sapma** raporu çıkarır, yapay zekâ **sapma yorumu** yazar.

### Plan

- Izgara: satır kalem, sütun ay, en sağda yıl toplamı. Gruplar: gelirler, hedefler (doluluk %, ADR), nakit, giderler; gelir ve gider ara toplamı; **brüt faaliyet kârı** = gelir − gider. Türkçe sayı biçimi (1.234,50).
- Bütçe **taslak** açılır → düzenlenir → **onaylanır** (kilitlenir). Değişiklik için **revize** açılır; önceki onaylı "eski sürüm" olarak saklanır. Yıl başına tek taslak ve tek onaylı.
- **Excel:** otele göre şablon indir → doldur → yükle. Yüklenen değerler ızgaraya **kaydedilmemiş değişiklik** olarak gelir; gözden geçirip kaydedersiniz (1 MB sınırı).
- Gider kalemleri otele göre tanımlanır (ilk bütçede USALI'ye göre 7 öneri). Kaldırılan kalem arşivlenir: açık taslaklardan düşer, onaylılarda kalır.
- Canlı tazeleme kaydedilmemiş girişi silmez; başkası kaydettiyse uyarır.

### Gerçekleşen

- **Gelir, doluluk, ADR, tahsilat sistemden** (yalnızca kapanmış günler): oda geliri ve satılan / satılabilir oda **gelir raporunun hesabıyla** (rapor ile bütçe aynı ayın oda gelirini asla farklı göstermez); restoran / minibar / çamaşır / diğer gelir folyo kaleminin türünden; tahsilat kasa tanımıyla.
- **Gider gerçekleşeni elle** girilir (`/butce/gerceklesen`): gelecek ay girilmez; hücre sürümlüdür (iki kişi aynı hücreyi ezmez). Satın alma ve ön muhasebe kalem eşlemesi yapılınca buradan otomatik gelecektir; şu an elle.

### Sapma

- Ay ya da yılbaşından seçilen aya. İçinde bulunulan ayın planı **kapanmış gün oranında** alınır (ekranda işaretli).
- Gelirde fazlası / giderde azı **olumlu** (renk + işaret). Planı olup gerçekleşeni girilmemiş gider "eksik" işaretlenir.
- **Oda geliri sapması doluluk etkisi ve fiyat etkisine ayrılır** (ayrıştırma kartı).
- Plan yılın onaylı bütçesinden, yoksa taslaktan (işaretli).

**Örnek — Temmuz sapması:**

| Kalem | Plan | Gerçekleşen | Fark | Fark % | Yorum |
|-------|------|-------------|------|--------|-------|
| Oda geliri | 4.200.000 | 4.536.000 | +336.000 | +%8,0 | Olumlu (yeşil) |
| Doluluk % | 82 | 86 | +4 puan | — | Hedef aşıldı |
| ADR | 4.100 | 4.220 | +120 | +%2,9 | Hedef aşıldı |
| Restoran geliri | 900.000 | 845.000 | −55.000 | −%6,1 | Olumsuz (kırmızı) |
| Gıda gideri | 420.000 | 455.000 | +35.000 | +%8,3 | Giderde fazlası olumsuz |
| Enerji gideri | 180.000 | (girilmemiş) | — | — | "Eksik" işareti |

Oda geliri ayrıştırma kartı: doluluk etkisi ≈ (86 − 82) × satılabilir oda-gece × plan ADR; fiyat etkisi ≈ (4.220 − 4.100) × gerçekleşen oda-gece; ikisinin toplamı +336.000'e yakın çıkar (kalan "karışık etki"). Ay ortasında bakılırsa plan kapanmış gün oranında (örneğin 15/31) alınır ve ekran bunu işaretler.

**Arka planda:**

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Gece kapanışı | O günün oda geliri / satılan oda gerçekleşene girer (yalnız kapanmış günler) | Sapma raporu ertesi gün |
| Bütçe onaylandı | Taslak kilitlenir; sapma onaylıyı referans alır | Plan ekranı kilit, sapma "onaylı" etiketi |
| Revize açıldı | Önceki onaylı "eski sürüm" olur, yeni taslak düzenlenir | Plan ekranı |
| "Yorum iste" | Bütçe ajanına olay; yorum gelince karta düşer | Sapma → AI yorum kartı |

### Yapay zekâ yorumu (bütçe ajanı)

"Yorum iste" düğmesi bütçe ajanına olay gönderir; ajan sapma tablosunu okuyup yorum paragrafı yazar ve karta düşer. Model otelin ana modelidir; günlük AI bütçesi ortak. Ajan kapalı / anahtar yok / bütçe doldu → istek "yazılamadı" ile kapanır (askıda kalmaz; 5 dk zaman aşımı). Rapor yorumsuz da eksiksizdir. Modele **kişisel veri gitmez**.

## Tahmin (forecast)

**Nerede:** **Panel** (ana sayfa) → "Önümüzdeki 30 gün" kartı, gelir tahmini kartı, kritik günler listesi. Eşikler müdür tarafından kartın penceresinden değiştirilir.

**Ne yapar:** Önümüzdeki 30 günün doluluk ve gelir tahminini çıkarır; riskli günleri işaretler.

**Yöntem (pickup):** tahmin = eldeki + karşılaştırma günlerinin **aynı gün kala** gerçekleşen net satışı (yeni satış − iptal − gelmeyen − erken çıkış). Karşılaştırma önce **geçen yılın aynı dönemi** (haftanın aynı günü, 364 gün önce ± 1 hafta), yoksa **son 8 haftanın aynı günleri**, o da yoksa tahmin = eldeki. Pickup satılabilir odaya oranlanır; en az 2 örnek gerekir; satılabilir odayı aşmaz, sıfırın altına inmez.

**Gelir tahmini** = eldeki gece fiyatları (vergi ayrılmış) + beklenen gece × o günün eldeki ADR'si.

**Kritik günler:** fazla satış (eldeki > satılabilir), tahmin > yüksek eşik (varsayılan %95), tahmin < düşük eşik (varsayılan %30). Düşük doluluk için tahmin verisi gerekir (karşılaştırma yokken uzak günün az eldekisi "riskli" sayılmaz). Kritik günler listesi "ne yapılabilir" önerisi ve oda planına bağlantı verir.

Grafik: eldeki dolu çubuk, tahmin kesikli çizgi, eşikler yatay çizgi, kritik günler eksen üstünde (▼ düşük, ▲ yüksek, ! fazla satış). Tablo görünümü ve "tahminin kaynağı" notu vardır. Cevap bir dakika önbelleklidir; rezervasyon ya da ayar değişince anında tazelenir.

**Örnek — 20 Temmuz tahmini (bugün 5 Temmuz, 15 gün kala):** Satılabilir 120 oda; eldeki 78 (%65). Geçen yıl aynı haftanın aynı günü (364 gün önce ± 1 hafta, 15 gün kala) eldeki ortalama %60'tı ve son 15 günde net %28 daha satılmıştı → pickup %28 × 120 ≈ 34 oda. **Tahmin = 78 + 34 = 112 oda (%93)**. Yüksek eşik %95 → kritik değil; %97'ye çıkarsa ▲ işareti ve "fiyat artışı düşünün" notu. Gelir tahmini: eldeki 78 gecenin fiyatları (vergi ayrılmış) + 34 × o günün eldeki ADR'si. Aynı gün dinamik fiyat kuralı doluluğa (eldeki %65) bakar, %80 eşiğini geçmediği için öneri üretmez — tahmin ve kural farklı girdilere bakar; bu bilinçlidir.

**Bilinen sınır:** sonradan uzatılan konaklamanın eklenen gecesi açılış anından beri eldeymiş sayılır (pickup bir miktar az görünür).

Tahmin ile dinamik fiyat birbirini tamamlar: tahmin "neler olacak" der, dinamik fiyat "ne yapmalı" önerir; ikisi de karar vermez.

## Uçtan uca örnek: bir yaz haftası

Otel sahibi "Temmuz'un ilk haftası için her şeyi doğru kurmak istiyorum" diyor. Zincir şöyle işler:

1. **Fiyat planı.** Ayarlar → Fiyat planları: "Yaz 2027 Standart BB", 15 Haziran–15 Eylül, 2 kişi için 4.000 TL, fazla yetişkin 800, çocuk 400. Deluxe için ayrı plan. Kaydedilince kanal aktörü OTA'ya yeni fiyatı gönderir (sezon-bazlı hesapla; pansiyon farkı kanala gitmez).
2. **Paket.** Ayarlar → Paketler: "Balayı", Deluxe, BB, 7.500 TL/gece, bileşenler: SPA masajı, oda süslemesi, transfer. Resepsiyon telefonla gelen çifte bu paketi seçer; pansiyon kilitlenir, fiyat 7.500 yazılır, kupon kabul edilmez.
3. **Acente.** Acenteler → "Mavi Tur": komisyon %12, vade 30 gün. Kontrat "Yaz 2027": Standart BB 3.200, Deluxe BB 4.500; 14–15 Temmuz stop-sale. Satışa aç. Kota sekmesi: Standart, 1 Temmuz–31 Ağustos, 10 oda, release 14 gün. 1 Temmuz gecesi için 17 Haziran'a kadar 10 Standart oda genel satışa kapalıdır; o günden sonra kullanılmayan kota genel havuza (ve OTA'ya) açılır.
4. **Promosyon.** Promosyonlar → "Erken rezervasyon %10": satış dönemi 1 Mart–31 Mayıs, konaklama Haziran–Eylül, girişten en az 45 gün önce, kanallar resepsiyon + web. Yayına al. Nisan'da web widget'ından 5 Temmuz girişi için gelen misafir plan fiyatı 4.000 yerine 3.600 görür; acente rezervasyonu görmez.
5. **Dinamik fiyat.** Ayarlar → Dinamik fiyat: etkin. Haziran sonunda 4–6 Temmuz Standart doluluğu %84'e çıkar; kural işi tek öneri üretir: 3 gece, +%10, gerekçe ve gün gün doluluk tablosu. Müdür Fiyat önerileri ekranında +%7'ye düzeltir ve onaylar. 4–6 Temmuz Standart geceleri için çarpan 1,07 yazılır; yeni rezervasyonlar 4.280 TL'den açılır; Mavi Tur kontratı 3.200'de kalır; OTA fiyatı güncellenir.
6. **Satış CRM.** 20 Haziran'da bir şirket 10 oda için arar. Resepsiyon fırsat açar, arama kaydı yazar, teklif hazırlar (5–7 Temmuz, 10 Standart, 3 gece): fiyat **o anki** sistem fiyatıyla kilitlenir. PDF indirilip e-postayla gönderilir, "Gönderildi" işaretlenir. 25 Haziran'da kabul: rezervasyon onaylı açılır, fırsat Kazanıldı. 26 Haziran'da yeni bir dinamik zam onaylansa bile bu rezervasyonun fiyatı değişmez.
7. **Kanal.** 1 Temmuz'da Booking'den 2 gecelik rezervasyon gelir: Channex revizyonu saklanır, kanal aktörü onaylı rezervasyonu OTA tutarıyla açar, misafir kartı oluşur. Aynı akşam oda planında Standart dolduğu halde bir rezervasyon daha gelir: kapasite aşılarak açılır, resepsiyona "overbooking" zili çalar; resepsiyon üst oda tipine taşır.
8. **Tahmin ve bütçe.** Panel'de 10–12 Temmuz tahmini %28 görünür (▼). Dinamik fiyat kuralı son 7 günde −%15 önerir; müdür onaylar. Ay sonunda bütçe sapma ekranı Temmuz oda gelirini plan ile karşılaştırır, doluluk ve fiyat etkisine ayırır; bütçe ajanı yorumunu yazar.
9. **Prim.** Mavi Tur için yürürlükteki prim kuralı (yaz dönemi, 1.000 gece → %2, 1.500 gece → %3) ilerleme çubuğunda %71'de görünür; Eylül sonunda dönem kapanınca hak ediş hesaplanır, yöneticiye zil düşer, onaya gönderilir, başka bir yönetici onaylar, muhasebe ödendi işaretler.

## Sık sorulanlar

**Fiyat planı girdim ama rezervasyon sezon fiyatını aldı.** Planın oda tipi, pansiyon ve tarihinin rezervasyonla birebir uyuştuğundan emin olun. Plan oda tipi × pansiyon başınadır; BB için plan varken HB rezervasyonu sezona düşer.

**Dinamik fiyat önerisi geldi, onayladım, ama acente rezervasyonu eski fiyattan açıldı.** Doğru davranış: çarpan acente kontratını, paketi ve elle fiyatı etkilemez. Kontrat fiyatı kontrat ekranından değiştirilir.

**Öneri neden kendiliğinden uygulanmıyor?** Tasarım kararı: hiçbir fiyat onaysız değişmez. Onaylar ekranından ya da Fiyat önerileri ekranından karar verin.

**Fiyat ajanı çalışmıyor.** Model anahtarı yoksa ajan kayıt olmaz; kural tabanlı yield yine çalışır. Ayarlar → AI asistanı'nda anahtarı ve Aktörler ekranında ajanın açık olduğunu kontrol edin.

**Kupon girildi ama indirim uygulanmadı.** Önizleme kuponun durumunu söyler: "daha avantajlısı var" (kendiliğinden promosyon daha iyi — kupon hakkı harcanmaz), "uymuyor" (koşul tutmuyor), "hak yetmez" (tek kullanımlık, kullanılmış), "geçersiz" (kapatılmış ya da yok). Acente satışında ve paketli odada kupon hiç uygulanmaz.

**Acentenin kotası doldu, satış durdu mu?** Hayır. Kota garantidir, tavan değil: acente genel havuzdan satmaya devam eder (yer varsa).

**Oda planında boş oda görünüyor ama satış "kotada tutulu" diyor.** Oda planı kota düşümünü göstermez. Acente kartı → Kota → kullanım tablosuna bakın; release tarihini bekleyin ya da kotayı azaltın.

**OTA'da fiyat farklı görünüyor.** Kanala giden fiyat taban × sezon (+ onaylı çarpan) + kanal fiyat farkı yüzdesidir; fiyat planı pansiyon farkı ve promosyon kanala gitmez. Senkron logunda son gönderilen değeri görebilirsiniz.

**Kanal rezervasyonu geldi ama rezervasyon listesinde yok.** Görevler menüsüne bakın: eşleşmeyen oda tipi / plan ya da içerideki misafir değişikliği "elle işlenmeli" göreve düşer. Kanal kartı → Rezervasyonlar sekmesinde durum görünür.

**Widget'tan rezervasyon yapan misafire e-posta gitti mi?** Hayır; e-posta geçidi henüz stub. Onay kodu ekranda gösterilir. Resepsiyon bekleyen rezervasyonu onaylar ve isterse misafiri arar.

**Teklif gönderdikten sonra fiyat değişti; misafire hangi fiyat geçerli?** Teklifteki. Fiyat teklif hazırlanırken kilitlenir; kabul teklif toplamıyla rezervasyon açar.

**Prim hak edişini onaya gönderemiyorum, "bayat" diyor.** Kural hesaptan sonra değişmiş ya da üretim farklı. "Yeniden hesapla" deyip tekrar gönderin.

**Bütçe gider gerçekleşeni neden otomatik gelmiyor?** Şu an elle girilir; satın alma / ön muhasebe kalem eşlemesi yapılınca otomatik olacak.

## Sık yapılan hatalar

- **Taslak kontratla rezervasyon açmaya çalışmak.** Kontrat "satışa açılmadan" acente adına satış yapılamaz; acente listesi "kontratı yok" diye uyarır.
- **Kontratta boş hücre bırakıp satılacağını sanmak.** Boş hücre "satılmaz" demektir; o gece için satış reddedilir. Her satılacak oda tipi × pansiyon hücresine fiyat yazın.
- **Acente stop-sale ile kanal stop-sale'i karıştırmak.** Kontrat stop-sale yalnız o acenteyi, kanal stop-sale yalnız o OTA'yı kapatır; ikisi de otelin kendi resepsiyon satışını etkilemez.
- **Fiyat planı dönemlerini üst üste bindirmek.** Aynı oda tipi + pansiyonda çakışan plan reddedilir; önce eskisinin bitişini kısaltın.
- **Dinamik fiyat ayarını açıp onay kuyruğuna bakmamak.** Öneriler Onaylar'da birikir ve süresi dolar; günlük kontrol alışkanlığı gerekir.
- **Pakete kupon ya da acente bağlamayı denemek.** Paket net demet fiyatıdır; sistem reddeder.
- **Promosyonu yayına almadan kupon dağıtmak.** Taslak promosyonun kuponu "uymuyor" döner. Önce kartta eksikleri giderip yayına alın.
- **Promosyonu silmeye çalışmak.** Yayındaki ya da kullanılmış promosyon silinmez; durdurun.
- **Kanalı test etmeden senkrona almak.** Yanlış eşleştirme OTA'daki bütün müsaitliği etkiler. Önce test ortamında eşleştirmeyi ve senkron logunu kontrol edin.
- **iCal adresi olarak http ya da iç ağ adresi girmek.** Yalnızca https ve dış adres kabul edilir.
- **Widget gömme kodunu izinli site listesine eklenmemiş bir alan adında kullanmak.** İstekler 403 ile reddedilir; önce alan adını web chat kanalının izinli sitelerine ekleyin.
- **Fırsatı panoda elle "Kazanıldı"ya taşımayı beklemek.** Kazanma yalnızca teklif kabulüyle olur; önce teklif hazırlayın ve kabul edin.
- **Teklifin geçerliliğini çok uzun bırakmak.** En fazla 60 gün; uzun geçerlilik fiyat kilidini aylarca taşır. Gerçekçi süre verin.
- **Bütçeyi onaylamadan sapma raporuna güvenmek.** Rapor taslaktan hesaplar ve işaretler; onaylı bütçe kilitli ve karşılaştırılabilir referanstır.
- **Excel yükledikten sonra kaydetmeden sayfadan çıkmak.** Yüklenen değerler kaydedilmemiş değişikliktir; "Kaydet"e basmadan kaybolur.
