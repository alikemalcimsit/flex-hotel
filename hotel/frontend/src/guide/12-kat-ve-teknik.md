# Kat hizmetleri ve teknik servis

Bu bölüm odanın fiziksel durumunu yöneten iki ekibi anlatır: **kat hizmetleri** (temizlik görevleri, kontrol, kat haritası) ve **teknik servis** (arıza biletleri, teknisyen görünümü, periyodik bakım planı, odayı kullanıma kapatma).

Her ekran aynı düzende anlatılır: **nerede bulunur**, **ne yapar**, **ekranda gördüğünüz alanlar**, **adım adım**, **arka planda ne olur** (tetikleyici → aktör → sonuç → nerede görünür → aktör kapalıysa ne olur) ve **dikkat edilecekler**. Her alt bölümde sayılarla anlatılan en az bir örnek vardır.

## Önce bilinmesi gereken kavramlar

### Oda durumu üç parçadır — kat hizmetleri yalnızca birini değiştirir

| Parça | Değerler | Kim değiştirir |
| --- | --- | --- |
| Doluluk | Boş · Dolu | Yalnızca sistem (giriş / çıkış). Kat ekranlarında değiştirilemez. |
| **Kat hizmeti** | **Kirli → Temizleniyor → Temiz → Kontrol edildi** | Kat görevlisi ("Başladım" / "Bitti"), kat şefi ("Onayla"), sistem (çıkışta ve gün kapanışında Kirli) |
| Arıza kaydı | Arızalı (satılamaz) · Hizmet dışı (atanmaz) | Yönetim ve teknik servis (bilet "odayı kapat" ile) |

Tek geçiş kuralı: **"Kontrol edildi" yalnızca "Temiz"den gelir.** Kirli bir oda doğrudan kontrol edilmiş yapılamaz.

Bu üç bilgi birbirinden bağımsızdır: dolu oda kirli olabilir (konaklama temizliği bekler), boş oda temiz ama hizmet dışı olabilir (perde değişimi), arızalı oda aynı anda kirli olabilir (teknisyen çıktı, temizlik bekler).

### Görev odayı yazmaz; aktör yazar

Kat hizmetlerinde iki ayrı kayıt vardır: **görev** (kim, hangi odayı, ne zaman temizleyecek) ve **odanın kat hizmeti durumu** (haritadaki renk). Görevli "Bitti" dediğinde görev kaydı "Bitti" olur ve bir olay yayınlanır; odayı **Temiz** yapan **Kat hizmeti aktörü**dür (housekeeping-worker). Aktör kapalıysa görev kaydı yine doğrudur ama odanın rengi değişmez — iş Görevler ekranına manuel görev olarak düşer ve personel odanın durumunu Odalar ekranından elle değiştirir. Bu "tek yazıcı" kuralı, iki ekranın birbirinden farklı şey söylemesini engeller.

### Kat hizmeti aktörü (housekeeping-worker) — tam liste

| Tetikleyici | Aktör ne yapar | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Misafir **çıkış** yaptı | Odaya **Çıkış temizliği** görevi açar (öncelik Yüksek). Oda zaten Oda aktörü tarafından Kirli yapılmıştır; aktör durumu ikinci kez yazmaz | Görev panosu, Görevlerim, kat haritası (kirli + görev) | "Kat hizmeti" modülünde manuel görev; şef görevi elle açar |
| Çıkış **geri alındı** | Açtığı çıkış temizliğini iptal eder | Pano | Manuel görev |
| **Arıza kaydı bitti** (odada süren Arızalı kaydı sonlandı) | **Detaylı temizlik** görevi açar (oda sistemce Kirli yapılmıştır) | Pano | Manuel görev |
| Misafir isteği açıldı — kategori **Temizlik** ya da **Havlu / malzeme** | **Misafir isteği** görevi açar ve isteğe bağlar | Pano (tip "Misafir isteği"), İstekler ekranı | Sessizce atlanır: istek zaten İstekler ekranında görünür, kat görevlisi oradan kapatır |
| Görevli **Başladım** dedi | Odayı **Temizleniyor** yapar (yalnız temizlik tiplerinde; misafir isteği görevi odanın rengini değiştirmez) | Harita, oda listesi | Manuel görev; oda rengi elle |
| Görevli **Bitti** dedi | Odayı **Temiz** yapar; görev "Misafir isteği" ise bağlı isteği **Tamamlandı** yapar | Harita; İstekler | Manuel görev |
| Kat şefi **Onayladı** | Odayı **Kontrol edildi** yapar | Harita | Manuel görev |
| Kat şefi **Reddetti** | Oda yeniden **Kirli**; aynı işlemde **öncelikli düzeltme görevi** açılır (ret sebebi görev notunda) | Pano, Görevlerim | Manuel görev |

Aktörün yanında iki **zamanlanmış iş** vardır (aktörden bağımsız, sunucuda çalışır):

- **Sabah konaklama temizliği üretici:** her 10 dakikada koşar, içeride olan ve **bugün çıkmayacak** her oda için günde bir **Konaklama temizliği** görevi açar (tekrarlı çalışma ikinci görev açmaz). Gün kapanışı dolu odaları Kirli yaptığı için sabah pano bu görevlerle dolu gelir.
- **Oda başına tek açık temizlik görevi** kuralı: aynı odaya ikinci çıkış / konaklama / detaylı temizlik görevi açılmaz ("zaten var"). Misafir isteği görevleri bu kuraldan muaftır (havlu ve temizlik aynı anda olur). Sabahki konaklama temizliği açıkken misafir erken çıkarsa görev **çıkış temizliğine yükselir** (öncelik yükselir, denetim izine yazılır).

### Görev tipleri ve öncelikler

| Tip | Nasıl doğar | Varsayılan öncelik |
| --- | --- | --- |
| Çıkış temizliği | Misafir çıkınca (aktör) | 2 — Yüksek |
| Konaklama temizliği | Sabah zamanlayıcısı (içerideki odalar) | 3 — Normal |
| Detaylı temizlik | Arıza kaydı kapanınca (aktör) ya da şef elle | 3 — Normal |
| Misafir isteği | Temizlik / havlu kategorili istekten (aktör); elle **açılamaz** | İsteğin önceliğinden |

Öncelik ölçeği: 1 Acil · 2 Yüksek · 3 Normal · 4 Düşük · 5 Boşken.

Görev durumları: **Bekliyor → Temizleniyor → Bitti** (ya da İptal). Önceki günlerden açık kalan görev "bugün" görünümünde **devreden** rozetiyle durur; iş kaybolmaz.

## Kat hizmetleri

**Nerede:** Ön büro → Kat hizmetleri (`/kat-hizmetleri`). Sekmeler: **Görev panosu** (`/gorevler`), **Görevlerim** (`/gorevlerim`), **Kontrol** (`/kontrol`), **Kat haritası** (`/harita`).

**Yetki:** görmek "kat hizmeti görüntüleme" (resepsiyon da görür — "104 ne zaman hazır olur?" sorusunun cevabı buradadır); görevli işlemleri (başlat, bitir, sorun bildir) "kat hizmeti çalıştırma"; şef işlemleri (aç, ata, iptal) "kat hizmeti yönetimi"; kontrol (onay / ret) "kat hizmeti denetimi". Kat hizmetleri rolünde dördü de varsayılan açıktır; otel isterse rol matrisinden ayırır.

### Görev panosu (şefin masası)

**Ne yapar:** günün temizlik listesi: süzgeçler, özet kartlar, çoklu seçimle toplu atama, satır işlemleri, elle görev açma.

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Gün seçici | Hangi günün görevleri; "bugün" görünümü önceki günlerden açık kalanları **devreden** rozetiyle de gösterir |
| Özet kartlar | Açık / bekleyen / temizleniyor / biten / atanmamış sayıları (sunucudan, bütün otel) |
| Süzgeçler | Tip, durum, öncelik, atanan (ya da "atanmamış"), kat, oda araması |
| Satır | Oda (numara, tip, kat), görev tipi, öncelik rozeti, **odanın şimdiki durumu** (doluluk + kat hizmeti + arıza), atanan görevli, durum, not, devreden rozeti, bağlı misafir isteği |
| Seçim kutuları | Toplu atama için |
| Satır düğmeleri | Başlat · Bitir · Sorun var · İptal (yetkiye göre) |
| "Yeni görev" | Elle görev (detaylı / ara temizlik) |

#### Adım adım — sabah dağıtımı

1. Sabah panoyu açın: gün kapanışı dolu odaları Kirli yaptı, zamanlayıcı **Konaklama temizliği** görevlerini açtı, gece çıkanlar için **Çıkış temizliği** görevleri zaten var.
2. "Atanmamış" süzgeciyle havuzu görün. Satırları işaretleyin → **"Ata"** → görevli seçin. Pencere görevlilerin **açık görev yükünü** gösterir; dengeli dağıtın. Aynı pencereden "atamayı kaldır" görevi havuza döndürür.
3. Bugün **girişi olan** odaların çıkış temizliğine öncelik verin: oda atama, bugün girecek misafir için Temiz / Kontrol edilmiş odayı öne alır — kat hizmetinin zamanında işaretlemesi doğrudan atama kalitesini etkiler.
4. Gün boyunca pano canlıdır (toplu atama ve toplu üretim tek haber gönderir; 2500 odada bile boğulmaz).

#### Elle görev açma

"Yeni görev" → oda, tip (Detaylı temizlik ya da ara temizlik), öncelik, not, isteğe bağlı görevli. Çıkış ve sabah görevleri otomatiktir; bu form plan dışı işler içindir. **Misafir isteği görevi elle açılamaz** — İstekler ekranından istek açarsanız aktör göreve çevirir.

**Örnek:** 14 Kasım sabahı 07:30. Gece 3 oda çıkış yaptı (103, 204, 311) → panoda 3 **Çıkış temizliği** (Yüksek). İçeride 34 oda, 5'i bugün çıkacak → zamanlayıcı 29 **Konaklama temizliği** (Normal) açtı (bugün çıkacak 5 oda görev almaz; onlar çıkışta çıkış temizliği alır). 204'e saat 11:00'de yeni misafir girecek → şef 204'ü Fatma'ya atar ve notuna "11:00 giriş" yazar. Toplam 32 görev, 4 görevliye 8'er dağıtılır. Panoda özet: Açık 32 · Atanmamış 0 · Temizleniyor 0.

### Görevlerim (görevlinin telefonu)

**Ne yapar:** giriş yapan görevliye atanan açık görevleri büyük düğmelerle gösterir; eldivenli elle basılacak boyutta.

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Görev kartı | Oda numarası büyük, kat, tip, öncelik, not (ör. "11:00 giriş", "ret sebebi: banyo yeniden silinecek"), bağlı misafir isteği metni |
| Başladım | Görevi "Temizleniyor" yapar → aktör odayı Temizleniyor yapar |
| Bitti | Görevi "Bitti" yapar → aktör odayı Temiz yapar; oda Kontrol kuyruğuna düşer |
| Sorun var | Arıza bildirir (aşağıda) |
| "Üzerinizde görev yok" | Havuzda atanmamış görev olabilir; şefe sorun |

#### Adım adım

1. Odaya girin, kartta **Başladım**.
2. Temizleyin; minibar sayımı yapılacaksa Minibar & çamaşır → Minibar girişi'nden fişi kesin (kat görevlisinin yetkisi vardır).
3. **Bitti**. Oda haritada Temiz (yeşil) olur; kat şefinin Kontrol ekranına düşer.
4. Kırık / arızalı bir şey gördüyseniz **Sorun var** → "Sorun nedir?" kutusuna yazın (ör. "duş başlığı kırık"). Bu, görevi kapatmaz; ayrı bir arıza bileti açar (aşağıda).

Her istek görevin **sürümüyle** gider: başka panel aynı görevi değiştirdiyse "kayıt değişti" uyarısı alır ve liste yenilenir.

**Örnek:** Fatma 204'te 09:10 **Başladım** → harita 204: Dolu değil (çıkış yapılmış), **Temizleniyor** (sarı). 09:45 **Bitti** → 204 **Temiz** (yeşil), Kontrol kuyruğunda. 09:46 şef kontrol eder, onaylar → **Kontrol edildi** (koyu yeşil). 11:00 misafir girişinde oda listesi 204'ü "hazır" gösterir ve oda atama onu öne alır.

### Sorun var → arıza bileti

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Görevli "Sorun var" + açıklama | "Kat hizmeti sorun bildirdi" olayı yayınlanır; sistem dinleyicisi **teknik servis bileti** açar (görev başına tek açık bilet; aynı bildirim ikinci bilet açmaz). Bilet: oda, başlık = açıklama, kaynak "kat hizmeti", bağlı görev | Teknik servis → Arızalar (Açık); teknik servis yetkililerinin **ziline** uyarı | Dinleyici sunucu içindedir (aktör değil); sunucu çalıştığı sürece bilet açılır |
| Bilet açıldı | Oda **kapanmaz** — "Sorun var" arıza kaydı açmaz; odayı kullanım dışı almak teknik servis / yönetim kararıdır | — | — |
| Teknisyen bileti çözdü | Bilet "Çözüldü"; odayı kapatmışsa kayıt kalkar, oda Kirli olur → detaylı temizlik görevi | Pano | — |

**Örnek:** Fatma 311'de "klima soğutmuyor" bildirir. 09:52 teknik serviste bilet #148 açılır: oda 311, kategori Diğer (teknisyen Isıtma / soğutma yapar), kaynak kat hizmeti, öncelik Normal. Teknik servis ziline "Yeni bilet 311" düşer. Teknisyen 10:30 bakar, oda bugün satılacak ve klima 2 gün sürecek → bileti düzenler: "Odayı kullanıma kapat: Arızalı, bitiş 16 Kasım" → 311 envanterden düşer, müsaitlik tablosunda o tipten 1 oda azalır. Kat görevi Fatma'nın "Bitti" demesiyle normal kapanır.

### Kontrol (kat şefi)

**Ne yapar:** görevlinin "Bitti" dediği odaları (Temiz) kuyruk olarak gösterir; şef **onaylar** (Kontrol edildi) ya da **reddeder**.

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Kuyruk | Kontrol bekleyen odalar (Temiz durumunda, görevi biten); bir seferde bir kısmı, onaylandıkça sıradakiler gelir |
| Kart | Oda, görevi yapan, bitiş saati, görev tipi, not |
| Onayla | Oda **Kontrol edildi** |
| Reddet | "Neden reddedildi?" zorunlu (ör. "banyo yeniden silinecek, çarşaf lekeli") |
| "Kontrol bekleyen oda yok" | Görevli "Bitti" dedikçe odalar buraya düşer |

#### Dört göz kuralı

**Temizliği yapan kendi işini onaylayamaz.** Aynı kişi hem görevli hem şef yetkisine sahip olsa bile kendi bitirdiği odayı onaylaması sunucuda reddedilir.

#### Ret ne yapar

Ret → oda yeniden **Kirli** + aynı işlemde **öncelikli düzeltme görevi** (öncelik Yüksek, ret sebebi görev notunda, aynı görevliye). Görevli Görevlerim'de "ret sebebi: …" notunu görür; yeniden Başladım / Bitti; oda yeniden Kontrol kuyruğuna düşer.

**Örnek:** 10:05 şef 118'i reddeder: "ayna lekeli, çöp boşaltılmamış". 118 Kirli'ye döner; Görevlerim'de Ali'ye "118 — düzeltme (Yüksek): ayna lekeli, çöp boşaltılmamış" görevi düşer. 10:20 Ali bitirir → 118 Temiz → 10:22 şef onaylar → Kontrol edildi. Denetim izinde ret ve düzeltme ayrı satırlardır.

### Kat haritası

**Ne yapar:** katları kat kat, odaları renkli kutular hâlinde gösterir; renk kat hizmeti durumudur; kutuda doluluk, arıza ve açık görev işaretleri vardır.

#### Renk ve işaretler

| Görünüm | Anlamı |
| --- | --- |
| Kırmızı | Kirli |
| Sarı | Temizleniyor |
| Yeşil | Temiz |
| Koyu yeşil | Kontrol edildi |
| Dolu işareti | Odada misafir var (doluluk) |
| Arıza işareti | Bugün odayı kapsayan arıza kaydı (Arızalı / Hizmet dışı) |
| Görev işareti | Odada açık görev; hem temizlik hem misafir isteği görevi açıksa kutu **temizliği** gösterir |

Harita canlıdır: görevli "Bitti" deyince kutu saniyeler içinde yeşile döner. Kat süzgeciyle tek kat izlenir. Harita yalnızca sizin otelinizin odalarını gösterir.

**Örnek okuma:** Kat 2: 201 kırmızı + dolu (içeride misafir, konaklama temizliği bekliyor), 202 sarı (Fatma temizliyor), 203 yeşil (kontrol bekliyor), 204 koyu yeşil (hazır, 11:00 girişi alabilir), 205 kırmızı + arıza (teknisyen çıktı, detaylı temizlik bekliyor), 206 yeşil + arıza (hizmet dışı: perde değişimi; temiz ama misafir verilmez).

### Kat hizmetinin diğer ekranlara etkisi

| Olay | Nerede hissedilir |
| --- | --- |
| Oda Temiz / Kontrol edildi | Giriş penceresinde oda "hazır" görünür; otomatik oda atama bu odaları öne alır |
| Oda Kirli | Giriş penceresi "oda kirli" uyarısı verir (engel değil, onayla girilir) |
| Gün kapanışı | Dolu odalar Kirli yapılır → sabah konaklama görevleri |
| Çıkış | Oda aktörü Kirli yapar, kat aktörü görev açar; Gidecekler listesi kat hizmetleri tarafından temizlik sırası için izlenir |
| Oda değişikliği (içerideki misafir taşındı) | Eski oda boş + Kirli olur; **çıkış temizliği görevi açılmaz** (çıkış değil taşınmadır) — oda kırmızı görünür, sabah zamanlayıcısı ya da şef elle görev açar |

## Teknik servis

**Nerede:** Ön büro → Teknik servis. Sekmeler: **Arızalar** (`/teknik-servis`), **Bana atananlar** (`/teknik-servis/benim`), **Planlama** (`/teknik-servis/planlama`). Yeni bilet `/teknik-servis/yeni`; bilet sayfası `/teknik-servis/<kimlik>`.

**Yetki:** görmek (liste, ayrıntı, fotoğraf, planlar) "teknik servis görüntüleme"; bilet aç / başla / çöz / güncelle / fotoğraf "teknik servis çalıştırma"; atama, iptal, **odayı kapatma**, periyodik plan "teknik servis yönetimi". Varsayılan: müdür hepsi; resepsiyon ve kat hizmetleri görüntüleme + çalıştırma.

### Bilet yaşam döngüsü

**Açık → (Ata) → Devam ediyor (Başla) → Çözüldü (Çöz)** ya da **İptal**. Her geçiş kim / ne zaman olarak kayıtlıdır (atama, başlama, çözüm izi).

| Tetikleyici | Ne olur | Nerede görünür | Not |
| --- | --- | --- | --- |
| Bilet açıldı (elle, kat hizmeti "Sorun var", misafir isteği) | Kayıt "Açık"; teknik servis yetkililerinin **ziline** uyarı (bağlantı bilete) | Arızalar (Açık görünümü) | Misafir isteğinden doğan bilet isteği **İlgileniliyor** yapar |
| "Odayı kullanıma kapat" işaretli | Önce odaya **arıza kaydı** açılır (Arızalı ya da Hizmet dışı; bitiş isteğe bağlı); kayıt kimliği bilete yazılır. Oda **doluysa** 409 → ekran "Oda dolu — misafiri taşı" der, **bilet açılmaz** | Odalar → Arıza kayıtları; müsaitlik tablosu (Arızalı sayıdan düşer); oda planında şerit | Odada o tarihlerde rezervasyon varsa reddedilir; kayıt yeni overbooking yaratacaksa reddedilir |
| Atandı | Atanan teknisyenin ziline uyarı; "Bana atananlar"a düşer | Teknisyen görünümü | — |
| Başlandı | "Devam ediyor" | Liste | — |
| Çözüldü | Bilet "Çözüldü"; odayı kapatmışsa **arıza kaydı sonlandırılır**: süren kayıt bugün biter ve oda **Kirli** olur → kat hizmeti aktörü **detaylı temizlik** görevi açar; başlamamış kayıt iptal olur. Misafir isteğine bağlıysa istek **Tamamlandı** | Odalar, kat panosu, İstekler | Oda durumunu bilet **doğrudan yazmaz**; oda servisine devreder |
| İptal edildi | Bilet kapanır; açık arıza kaydı varsa kaldırılır | Liste | — |
| Kapanmış bilet | Fotoğrafları günlük iş **60 gün** sonra siler | — | Bilet kaydı kalır |

### Arızalar listesi

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Görünüm | Açık · Bana atananlar · Tümü |
| Süzgeç | Durum (Açık / Devam ediyor / Çözüldü / İptal), kategori |
| Satır | Oda ya da konum, başlık, kategori, öncelik, durum, atanan, açılış zamanı / geçen süre, kaynak (elle / kat hizmeti / misafir isteği / plan), odayı kapattı işareti |
| "Yeni arıza" | Bilet formu ("teknik servis çalıştırma" yetkisi) |

Kategoriler: Elektrik · Su tesisatı · Isıtma / soğutma · Mobilya · Beyaz eşya / cihaz · Yapısal · Güvenlik · Diğer.

### Yeni arıza formu

| Alan | Anlamı |
| --- | --- |
| Oda **ya da** Konum | Oda seçilir (oda arıza) veya serbest konum yazılır ("Lobi, asansör, çatı…") |
| Kategori | Yukarıdaki liste |
| Başlık | Kısa ("Klima soğutmuyor") — zorunlu |
| Açıklama | Ayrıntı — zorunlu |
| Öncelik | Acil / Yüksek / Normal / Düşük |
| Odayı kullanıma kapat (arıza kaydı aç) | Yalnızca "yönetim" yetkisiyle ve oda seçiliyse |
| Kapatma türü | **Arızalı (satılamaz)**: envanterden düşer — klima, su basması; **Hizmet dışı (atanmaz)**: envanterde kalır, misafir yerleştirilmez — kozmetik iş |
| Bitiş (opsiyonel) | Boşsa süresiz; bilet çözülünce yine kapanır |

Kaydettikten sonra bilet sayfasında **fotoğraf** eklenir (en fazla 6; telefonda kamera; tarayıcı küçültür).

#### Adım adım — acil arıza, oda dolu

1. "Yeni arıza": oda 512, Su tesisatı, "Lavabo taşıyor", Acil, "Odayı kullanıma kapat: Arızalı".
2. Kaydet → "Oda dolu" uyarısı: bilet **açılmaz**.
3. Oda planına gidin, 512'deki misafiri boş bir odaya **taşıyın** (sebep: "arıza"). Eski oda boş + Kirli olur.
4. Forma dönün, yeniden kaydedin → bilet açılır, 512 Arızalı kaydı açılır, envanterden düşer.
5. Teknisyene **Ata** → ziline düşer → Başla → tamir → fotoğraf → **Çöz**.
6. Arıza kaydı bugün biter; 512 Kirli → kat aktörü **detaylı temizlik** açar → temizlenip kontrol edilince satışa döner.

**Örnek — sayılarla:** Otelde 10 Deluxe oda var, 15 Kasım'da 9'u satılmış. 512 Deluxe Arızalı yapılınca satılabilir Deluxe 9'a düşer; müsaitlik tablosunda 15 Kasım Deluxe hücresi 1 → 0 olur (turuncu/kırmızıya yakın). Eğer o gün 10 Deluxe satılmış olsaydı kayıt **reddedilirdi** ("Bu kayıt overbooking'e yol açar"): önce bir rezervasyonu başka tipe taşımak ya da Hizmet dışı seçmek gerekir (Hizmet dışı envanterden düşmez; ama o odaya kimse atanmaz — son boş oda hizmet dışı olunca satılan misafire oda bulunamaz, müsaitlik tablosu bunu nokta ile işaretler).

### Bilet sayfası

| Alan / düğme | Anlamı |
| --- | --- |
| Bilgi kartı | Oda / konum, kategori, öncelik, durum, kaynak, bağlı kat görevi / misafir isteği / plan, açan, atanan, başlama, çözüm, zamanlar |
| Oda kapatma kartı | Kayıt türü, başlangıç, bitiş; kaydın durumu |
| Fotoğraflar | Galeri; ekle / sil (çalıştırma yetkisi) |
| Ata | Teknisyen seç (yönetim) |
| Başla / Çöz | Teknisyen (çalıştırma) |
| İptal | Gerekçe (yönetim) |
| Düzenle | Başlık, açıklama, öncelik, kategori |

### Bana atananlar (teknisyen görünümü)

Giriş yapan teknisyene atanan **açık** biletler; satır içi hızlı **Başla / Bitti** düğmeleri; satıra tıklayınca bilet sayfası (fotoğraf eklemek için). Yeni atama ziline düşer.

**Örnek günü:** Teknisyen Murat'ın listesi 08:00'de: #148 311 klima (Normal, kat hizmetinden), #151 lobi asansör (Yüksek, elle), #152 Aylık klima bakımı — kat 3 (plan, Düşük). Sırayla Başla / Bitti; #148'de odayı kapatmamış, çözümde oda etkilenmez; #152 plan bileti kapanınca planın "son çalışma" günü bugüne çekilir ve 30 gün sonra yeni bilet üretilir.

### Misafir isteğinden gelen arıza

Misafir WhatsApp'tan "klima çalışmıyor" yazdı → İstekler ekranında kategori **Arıza** istek. Resepsiyon istekten (ya da elle) bilet açıp isteğe bağlar.

| Adım | İstek | Bilet |
| --- | --- | --- |
| Misafir yazdı | Bekliyor (hizmet süresi: Normal 60 dk) | — |
| Bilet açıldı ve isteğe bağlandı | **İlgileniliyor** | Açık |
| Teknisyen çözdü | **Tamamlandı** | Çözüldü |

İki kayıt ayrı amaçlıdır: istek misafirin **beklediği** işi (süre, zil) anlatır; bilet teknik işi. İstek "İlgileniliyor"dan "Bekliyor"a geri alınsa bile hizmet süresi sıfırlanmaz (gecikme gizlenemez).

### Planlama (periyodik bakım)

**Ne yapar:** aylık / periyodik kontrol listelerini tanımlar; zamanlanmış iş süresi gelen plandan **bilet üretir**.

#### Plan formu

| Alan | Anlamı |
| --- | --- |
| Başlık | "Aylık klima bakımı" |
| Oda **ya da** Konum | Oda seçimi ya da "Tüm katlar, çatı…" |
| Kategori, Öncelik | Üretilen biletin kategori ve önceliği |
| Periyot (gün) | Kaç günde bir (30 = aylık) |
| Açıklama | İsteğe bağlı |
| Kontrol listesi | Maddeler ("Filtre temizliği", "Gaz kontrolü"…); üretilen bilete yazılır |
| Plan aktif | Kapatılırsa bilet üretmez, kayıt kalır |

| Tetikleyici | Ne olur | Nerede görünür | Not |
| --- | --- | --- | --- |
| Zamanlanmış iş (6 saatte bir) | Süresi gelen (son çalışma + periyot ≤ bugün) aktif planlardan bilet üretir; **plan başına tek açık bilet** (öncekisi kapanmadan yeni üretilmez); planın son çalışma günü iş gününe çekilir | Arızalar (kaynak: plan), teknisyen zili | Sunucu kapalıyken geçen süre ilk çalışmada telafi edilir |
| Plan silindi | Onay ister; açık bilet etkilenmez | — | — |

**Örnek:** "Aylık klima bakımı — kat 3", periyot 30, Düşük, kontrol listesi 4 madde, son çalışma 15 Ekim. 14 Kasım 00:00'dan sonraki ilk iş (en geç 06:00) bileti üretir: "#152 Aylık klima bakımı — kat 3 (plan)" → teknisyen zili. Bilet 20 Kasım'da çözülürse plan 14 Kasım'ı son çalışma sayar; bir sonraki bilet 14 Aralık civarı. Bilet 1 ay açık kalırsa yeni üretilmez — plan birikmez.

### Teknik servisin diğer ekranlara etkisi

| Olay | Nerede hissedilir |
| --- | --- |
| Oda Arızalı yapıldı | Müsaitlik tablosunda sayı düşer; oda planında şerit; oda atama bu odayı listelemez; giriş penceresi "Oda arızalı / hizmet dışı" ile girişi engeller; gün kapanışı doluluk hesabında satılabilir oda azalır; bekleme listesi taraması etkilenir |
| Oda Hizmet dışı yapıldı | Sayı düşmez, ama atama engellenir; müsaitlik hücresinde nokta |
| Arıza kaydı kapandı | Oda Kirli; detaylı temizlik görevi; bekleme listesi taranır (yer açılmış olabilir) |
| Plan bileti açıldı | Teknisyen zili; Arızalar listesi |

## Sık sorulanlar

**Görevli "Bitti" dedi ama harita hâlâ kırmızı.**
Kat hizmeti aktörü kapalı ya da hata vermiştir; Görevler ekranında "Kat hizmeti" görevi görünür. Odanın rengini Odalar → Oda listesi'nden elle Temiz yapın ve görevi kapatın; Yönetim → Aktörler'den aktörü açın.

**Odayı doğrudan "Kontrol edildi" yapamıyorum.**
Tek geçiş kuralı: Kontrol edildi yalnızca Temiz'den gelir. Önce görevli "Bitti" demeli (ya da oda Temiz yapılmalı), sonra şef onaylar.

**Kendi temizlediğim odayı onaylayamıyorum.**
Dört göz kuralı; başka bir şef / yetkili onaylar.

**Sabah panoda görev yok.**
Gün kapanışı yapılmamış olabilir (dolu odalar Kirli yapılmadı, zamanlayıcı görev üretmedi) — gece görevlisiyle konuşun. Zamanlayıcı 10 dakikada bir koşar; birkaç dakika bekleyin.

**Çıkış yapan odaya görev düşmedi.**
Odaya zaten açık bir temizlik görevi vardı (oda başına tek görev kuralı); sabah konaklama görevi varsa çıkış temizliğine yükselmiş olmalıdır — panoda tipi kontrol edin. Hâlâ yoksa Görevler ekranında manuel görev vardır.

**"Sorun var" dedim; oda neden kapanmadı?**
"Sorun var" yalnızca bilet açar; odayı satıştan almak teknik servis / yönetim kararıdır (bilette "Odayı kullanıma kapat"). Acilse teknisyene / müdüre haber verin.

**Bilet açarken "Oda dolu" diyor.**
Dolu odaya arıza kaydı açılamaz; oda planından misafiri taşıyın, sonra bileti kaydedin. Odayı kapatmadan bilet açmak isterseniz kutuyu kaldırın.

**Arızalı kayıt açarken "overbooking'e yol açar" hatası.**
O tarihlerde o tipin bütün odaları satılmış; bir odayı envanterden çekerseniz birine oda kalmaz. Seçenekler: Hizmet dışı (envanterde kalır), bir rezervasyonu başka tipe taşımak, bitiş tarihini kısaltmak.

**Misafirin "klima bozuk" isteği ve bilet ikisi ayrı mı?**
Evet. İstek misafirin beklediğini ve süreyi izler; bilet teknik işi. Bilet açılınca istek İlgileniliyor, çözülünce Tamamlandı olur — iki kez iş yapmanız gerekmez.

**Periyodik plan iki bilet açtı mı?**
Hayır; plan başına tek açık bilet. Önceki bilet kapanmadan yeni üretilmez. İki bilet görüyorsanız biri elle açılmıştır.

**Teknisyen fotoğrafları neden kayboldu?**
Kapanmış biletin fotoğrafları 60 gün sonra silinir (depolama). Bilet kaydı ve çözüm notu kalır.

## Sık yapılan hatalar

- **Oda rengini elle değiştirerek görevi "kapatmak".** Görev açık kalır, raporlar bozulur. Görevli "Bitti" demeli; aktör rengi yazar. Elle değiştirme yalnızca aktör kapalıyken manuel görev için.
- **Misafir isteği görevini elle açmaya çalışmak.** Açılamaz; İstekler ekranından Temizlik / Havlu isteği açın, aktör göreve çevirir ve bitince isteği kapatır.
- **Bugün çıkacak odaya konaklama temizliği beklemek.** Zamanlayıcı bugün çıkacak odaya sabah görevi açmaz; çıkışta çıkış temizliği açılır.
- **Reddedilen odanın düzeltme görevini fark etmemek.** Ret aynı görevliye Yüksek öncelikli görev düşürür; Görevlerim'de notuyla görünür.
- **Kontrol kuyruğunu boş sanıp sayfayı yenilemeden beklemek.** Kuyruk canlıdır ama "bir seferde bir kısım" gösterir; onayladıkça sıradakiler gelir.
- **"Sorun var"ı arıza kaydı sanmak.** Odayı satıştan almaz; acil durumda teknik servisi arayın ve bilette "Odayı kullanıma kapat" işaretlensin.
- **Dolu odaya arıza kaydı açmaya çalışmak.** Reddedilir; önce misafiri taşıyın.
- **Kozmetik iş için Arızalı seçmek.** Envanteri gereksiz düşürür, overbooking hatası alabilirsiniz; Hizmet dışı seçin.
- **Bitiş tarihini unutup kaydı süresiz bırakmak.** Bilet çözülünce kayıt yine kapanır; ama bilet unutulursa oda aylarca satış dışı kalır. Planlı tadilatta bitiş girin.
- **Çözülen bileti kapatmayı unutmak.** Oda Arızalı kalır, satılamaz; plan bileti kapanmazsa yeni dönem bileti üretilmez.
- **İçerideki misafiri taşıdıktan sonra eski odanın görevini beklemek.** Taşınma çıkış değildir; aktör çıkış temizliği açmaz. Oda Kirli görünür; şef elle görev açar ya da sabah zamanlayıcısı açar.
- **Fotoğrafı eklemeden bileti çözmek.** Çözüm geçerlidir ama şikâyet incelemesinde kanıt kalmaz; en fazla 6 fotoğraf eklenebilir.
