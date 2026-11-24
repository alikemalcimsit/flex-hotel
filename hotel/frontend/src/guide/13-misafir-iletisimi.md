# Misafir iletişimi

Bu bölüm misafirle konuşulan ve misafirin beklediği işlerin izlendiği ekranları anlatır: **Mesajlar** (WhatsApp ve web sohbeti gelen kutusu, AI concierge), **İstekler** (misafir istekleri), **Anketler** (çıkış sonrası ve ara anket, NPS, düşük puan takibi), **Spa** (randevu, terapist ve oda takvimi, grup dersleri, spa kasası) ve **Misafir portalı** (temassız uygulamalar).

Her ekran aynı düzende anlatılır: **nerede bulunur**, **ne yapar**, **ekranda gördüğünüz alanlar**, **adım adım**, **arka planda ne olur** (tetikleyici → ne olur → nerede görünür → kapalıysa / hatada ne olur) ve **dikkat edilecekler**. Her alt bölümde sayılarla anlatılan en az bir örnek vardır.

## Önce bilinmesi gereken kavramlar

### Kanal, konuşma, mod

- **Kanal:** misafirin yazdığı yer — **WhatsApp** (otelin Business hattı) ya da **Web chat** (otel sitesindeki sohbet balonu; misafir portalında da aynı balon). SMS ve e-posta kanal olarak tanımlıdır ama şu an gelen kutusuna bu kanallardan konuşma düşmez (gelen e-posta geçidi henüz yazılmadı).
- **Konuşma:** bir misafirle bir kanaldaki yazışma; açık ya da kapalı.
- **Mod:** konuşmayı kim yanıtlıyor — **AI asistanı** ya da **Personel**. AI açıksa yeni konuşmalar AI modunda açılır; personel yazdığı an konuşma personele geçer.

### Üç yapay zekâ ajanı

| Ajan | Ne yapar | Ne zaman devreye girer |
| --- | --- | --- |
| **Yönlendirici (router)** | Küçük modelle gelen mesajın niyetini sınıflar: rezervasyon / soru / şikâyet / diğer; onay ("evet") tanır | Her gelen misafir mesajında (AI açıksa) |
| **Concierge** | Müsaitlik ve fiyata bakar, teklif yapar, otel bilgisi anlatır, misafir açıkça "evet" deyince rezervasyon talebi açar, gerekirse personele devreder | Konuşma AI modundaysa |
| **Geri bildirim (insight)** | Anket yorumlarına ton + konu etiketi verir, dönem özeti yazar | Anket cevabı yorum içerdiğinde; müdür dönem özeti istediğinde |

Ajanlar sunucuda model anahtarı tanımlı değilse **hiç başlamaz**; o zaman bütün konuşmalar personelde açılır ve anketler AI'sız çalışır. Ayarlar → AI asistanı ekranı anahtarın durumunu söyler.

### Hizmet süresi (SLA)

Misafir isteğinin önceliği hedef süreyi belirler: **Acil 15 dk · Yüksek 30 dk · Normal 60 dk · Düşük 240 dk**. Uyandırma gibi zamanlı isteklerde hedef istenen saattir. Süre aşılınca istek "gecikmiş" olur, yan menü rozeti kırmızıya döner, isteğin sahibine (yoksa istek yönetenlere) zil düşer (bir kez).

### Zil ve rozetler

Yan menüde **Mesajlar** rozeti cevap bekleyen konuşma sayısını, **İstekler** rozeti açık istek sayısını gösterir; süresi aşılan varsa kırmızı. Sekme başlığında da sayı yazar; yeni misafir mesajında ses çalar (kapatılabilir; birden çok sekmede bir kez).

## Mesajlar

**Nerede:** Ön büro → Mesajlar (`/mesajlar`). Geniş ekranda üç sütun: konuşma listesi · konuşma · misafir / konaklama / istekler paneli. Dar ekranda tek sütun.

**Yetki:** "mesaj görüntüleme" (ve cevaplama). Sağ paneldeki istekler "istek görüntüleme" ister.

### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Görünüm şeridi | **Açık** · **Cevap bekleyen** (son yazan misafir) · **Bana atanan** · **Atanmamış** · **Kapalı** · **Tümü**; sayılar sunucudan |
| Kanal süzgeci | Tüm kanallar / WhatsApp / Web chat |
| Konuşma satırı | Kanal ikonu, misafir adı (yoksa kanal adı / oda), son mesaj özeti ("Siz:", "AI:" önekiyle), okunmamış sayısı, "x dk bekliyor", **niyet etiketi** (Rezervasyon / Soru / Şikâyet), mod rozeti (AI / Personel), atanan |
| Konuşma başlığı | Misafir, oda / konaklama bağlantısı, atanan personel seçici, **Manuele al** / **AI'a devret**, **Kapat**, bilgi paneli düğmesi |
| Mesaj balonları | Misafir (sol), personel, **AI (etiketli)**, sistem iç notları (sarı; misafire gitmez); giden mesajda teslim durumu: Gönderim bekliyor → Gönderildi → İletildi → Okundu, ya da **Gönderilemedi** (sebebi) |
| Yazma alanı | Cevap; "İç not" anahtarı misafire gitmeyen not yazar; "İstek aç" düğmesi seçili mesajdan istek açar |
| Sağ panel | Misafir kartı özeti (etiketler, tercihler), bağlı konaklama (oda, giriş–çıkış, bakiye), bu konuşmanın istekleri (en fazla birkaçı; fazlası İstekler sayfasında), "Konaklamaya bağla" |

### Adım adım — bir konuşmayı yanıtlamak

1. "Cevap bekleyen" görünümünü açın; en uzun bekleyen üstte.
2. Konuşmaya tıklayın. Mod **AI** ise üstte sarı şerit: "Bu konuşmayı AI asistanı yanıtlıyor. Yazarsanız ya da 'Manuele al'a basarsanız konuşma size geçer."
3. Sağ panelden misafiri ve konaklamayı kontrol edin. Web chat misafiri kimlik taşımaz; "Konaklamaya bağla" → oda numarasını seçin → içerideki konaklama bulunur, misafir kartı konuşmaya işlenir, istekler o konaklamaya düşer. Konuşmada zaten bir misafir varsa başka misafirin konaklaması reddedilir (yanlış kişiye bilgi gitmesin).
4. Cevabı yazın, gönderin. Mesaj **Gönderim bekliyor** doğar; kanal geçidi gönderip durumu ileri çeker. Çift tık ikinci mesaj yazmaz.
5. Misafir bir şey istiyorsa mesajı seçip **İstek aç** (başlık mesajdan önerilir; kategori ve öncelik seçersiniz).
6. Konu bitince **Kapat**. Misafir yeniden yazarsa konuşma kendiliğinden açılır.

**Atama:** başlıktaki seçiciden konuşmayı bir personele atayın; "Bana atanan" görünümü ve kişiye özel zil buna göre çalışır. Atama / kapatma / mod değişikliği sürüm damgasıyla korunur: iki personel aynı anda farklı karar verirse ikincisi "kayıt değişti" uyarısı alır; misafirin bu arada yazması çakışma sayılmaz.

### Arka planda — mesajın yolculuğu

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Misafir WhatsApp'a yazdı | Meta webhook'u imzayla doğrulanır; aynı mesaj iki kez gelse tek kayıt; misafir **telefonundan** bulunur (ülke kodsuz kart otelin koduyla okunur), içerideki (yoksa yaklaşan) konaklamaya bağlanır; konuşma yoksa açılır | Gelen kutusu, ses, rozet | Geçit kapalıysa webhook ulaşmaz; Meta yeniden dener |
| Misafir web balonuna yazdı | Oturum anahtarıyla gelir; misafir kimliği yok; "yazıyor…" ve "gördüm" bilgileri akar | Gelen kutusu (kanal: Web chat) | Balon kapalıysa sitede "Sohbet şu anda kullanılamıyor" |
| Konuşma AI modunda ve mesaj geldi | Yönlendirici niyeti yazar → concierge turu (en fazla 5 model çağrısı) → cevap AI etiketiyle yazılır | Balon "AI" etiketli, niyet etiketi | Bütçe dolu / ajan kapalı / hata → konuşma **personele** geçer, iç not sebebi yazar, zile "AI devretti" uyarısı |
| Personel yazdı | Konuşma AI'daysa **personele** geçer; mesaj "Gönderim bekliyor" | Balon + teslim durumu | Kanal kapalıyken yazılan cevaplar bekler; kanal açılınca dakikada bir iş gönderir; **gönderilmiş gibi gösterilmez** |
| Geçit gönderdi / iletti / okundu | Durum ileri gider (geri gelmez) | Balonun altında | WhatsApp 24 saat penceresi kapalıysa "Gönderilemedi" + sebep |
| Misafir 5 dakikadan uzun süre AI'dan cevap alamadı | Süpürücü iş konuşmayı personele geçirir (süreç çökse de sıradaki iş kaybolmasın) | Cevap bekleyen görünümü | — |
| Kapalı konuşmaya misafir yazdı | Konuşma açılır, bekleme sayacı başlar | Rozet | — |
| Cevapsız misafir mesajı (personel modunda) | Konuşmanın sahibine, yoksa mesaj görenlere zil | Zil | — |

### AI concierge ne zaman cevap verir, ne zaman vermez

**Cevap verir:** Ayarlar → AI asistanı'nda "AI asistanı yeni mesajlara cevap versin" açık, sunucuda model anahtarı tanımlı, ajanlar aktör panelinde açık ve konuşma AI modunda ise. Yalnızca **WhatsApp ve web chat**te.

**Yapabildikleri:** otel bilgisini anlatır (yalnızca Ayarlar → AI asistanı → "Misafire anlatılacak otel bilgisi" ve otel ayarlarındaki bilgi; orada olmayanı "bilmiyorum, personel yardımcı olacak" der), tarih ve kişi sayısına göre **müsaitlik ve fiyat** söyler (otelin varsayılan pansiyonuyla; promosyon / kupon kanala göre uygulanır), **teklif** yapar (30 dakika geçerli), misafir **yeni bir mesajda açıkça "evet"** deyince (yönlendirici onayı tanır, teklif önceki turda sunulmuş, fiyat ve müsaitlik yeniden denetlenmiş) **rezervasyon talebi** açar.

**Personele devreder (modelsiz, hemen):** şikâyet, "personelle görüşmek istiyorum", 30 geceden uzun / 10 kişiden kalabalık / 540 günden ileri istek, başka pansiyon / grup / özel anlaşma. Devirde misafire kısa bilgi gider (dili bilinmiyorsa tahmin), konuşmaya iç not düşer (sebep), zile "AI devretti" uyarısı.

**Hiç çağrılmaz:** günlük **bütçe** dolunca (o günün maliyeti ayardaki USD bütçeyi aştı; otelin iş gününe göre) — konuşmalar personele geçer, yönetime "AI bütçesi" uyarısı; konuşma başına günlük cevap sınırı aşılınca; tur sınırı aşılınca.

**Rezervasyon zinciri:**

| Sıra | Ne olur | Nerede görünür |
| --- | --- | --- |
| 1 | Concierge "rezervasyon istendi" olayı yayınlar (istek kimliğiyle; tekrar gönderim ikinci rezervasyon açmaz) | Aktivite akışı |
| 2 | **Rezervasyon aktörü** müsaitlik ve fiyatı denetleyip rezervasyonu açar (durum: ayarda "AI'ın açtığı rezervasyon" Kesin ya da Opsiyonlu) — yer yoksa gerekçeli ret | Rezervasyon listesi, kaynak "WhatsApp" / "Web chat" |
| 3 | **Oda aktörü** uygun odayı atar | Oda planı |
| 4 | Concierge onay kodunu **veritabanından, şablonla** sohbete yazar ("talebiniz alındı" cevabından sonra), konuşmayı rezervasyona bağlar | Balon (AI etiketli, otomatik mesaj teslim durumu) |
| 5 | Bildirim merkezi onay bildirimini kuyruğa alır (opsiyonlu ise onaylanınca) | Bildirimler → Gönderim geçmişi |
| Ret | Concierge gerekçeyi misafire söyler ("o tarihte yer yok, alternatif…") | Balon |

Kanaldan gelen istek **onaya gitmez** (overbooking politikası "onaya gönder" olsa bile); yer yoksa reddedilir. Rezervasyon aktörü kapalıysa istek Görevler ekranına "Rezervasyon" görevi olarak düşer; personel elle açar.

**Örnek:** 14 Kasım 21:40, +90 532 … numarasından WhatsApp: "15-18 mart 2 kişi deluxe var mı". Yönlendirici: niyet Rezervasyon. Concierge müsaitliğe bakar: Deluxe 15, 16, 17 Mart gecelerinde boş; fiyat planı 3.200 TL/gece, 3 gece 9.600 TL, BB. Cevap: "15–18 Mart arası Deluxe oda, 2 yetişkin, kahvaltı dahil toplam 9.600 TL. Onaylıyor musunuz?" Misafir 21:43: "evet". Yönlendirici onay tanır, concierge fiyatı yeniden denetler (değişmemiş), rezervasyon talebi açar → rezervasyon aktörü FLX-2K7P kodlu kesin rezervasyon açar (kaynak WhatsApp) → oda aktörü 305'i atar → 21:44 balon: "Rezervasyonunuz oluşturuldu. Onay kodu: FLX-2K7P…" Gelen kutusunda konuşma rezervasyona bağlı, niyet etiketi "Rezervasyon", mod hâlâ AI. Aynı misafir "odada klima var mı, bir de faturayı şirkete kesebilir misiniz" yazsa: klima otel bilgisinde varsa cevaplar; fatura isteği "personele devredildi" iç notuyla konuşma Personel moduna geçer, resepsiyonun ziline düşer. Günlük bütçe 5 USD ise ve o gün 4,98 USD harcandıysa bir sonraki mesajda model çağrılmaz, konuşma personele geçer, yönetime "AI bütçesi doldu" uyarısı gider.

### AI ve kanal ayarları (yönetici)

**Ayarlar → AI asistanı:** açık / kapalı; sınıflandırma modeli (küçük) ve konuşma modeli; model fiyatları (1 milyon token başına USD — maliyet ve bütçe bunlarla hesaplanır); **günlük bütçe (USD)**; konuşma başına günlük AI cevabı; "AI'ın açtığı rezervasyon" Kesin / Opsiyonlu; **otel bilgisi** metni; kullanım ve maliyet kartı (günlük token ve USD). Üstteki uyarılar: "Sunucuda model anahtarı tanımlı değil" / "Anahtar var ama ajanlar çalışmıyor" / "AI ajanları aktör panelinde kapatılmış".

**Ayarlar → Mesaj kanalları:** **WhatsApp Business** (hat açık / kapalı — kapalıyken cevaplar sırada bekler, gelen mesaj kaydedilir; telefon numarası kimliği, erişim token'ı, uygulama sırrı, webhook doğrulama token'ı, **Callback URL** kopyalama alanı — Meta panelinde girilir) ve **Web sitesi sohbet balonu** (balon açık / kapalı, başlık, karşılama mesajı, renk, **izinli site adresleri**, gömme kodu; "Online rezervasyon motoru açık" ve motorun gömme kodu — balonu da içerir; "Balon anahtarını yenile").

**Dürüstlük notu:** otelin kendi **başlattığı** WhatsApp bildirimi (Meta onaylı şablonlu mesaj: "rezervasyonunuz onaylandı") **yapılmadı**; bildirimler e-posta ve SMS ile gider. WhatsApp'ta yalnızca misafirin başlattığı konuşmaya (24 saat penceresi) cevap verilir. Gelen kutusunda **hazır cevap şablonları** henüz yoktur (bildirim şablonları ayrıdır).

## İstekler

**Nerede:** Ön büro → İstekler (`/istekler`). Mesajlar ekranındaki "İstek aç"tan, misafir portalından ("Misafir portalı" kaynağı) ve AI'dan da istek düşer.

**Yetki:** görmek "istek görüntüleme"; açma, atama, durum değiştirme "istek yönetimi" (kat görevlisi isteği kapatabilsin ama gelen kutusunu görmesin diye ayrı).

### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Özet kutuları (süzgeç olarak) | **Açık** · **Gecikmiş** · **Bana atanan** · **Tamamlanan** · **İptal edilen** · **Tümü** |
| Kategori çipleri | Temizlik · Havlu / malzeme · Arıza · Oda servisi · Uyandırma · Transfer / taksi · Bilgi · Şikâyet · Diğer |
| Öncelik / atanan süzgeci | Düşük / Normal / Yüksek / Acil; Herkes / Atanmamış / kişi |
| Satır | Oda (ve misafir), başlık, kategori, öncelik rozeti, **akan geri sayım** ("23 dk kaldı" / "12 dk gecikti" kırmızı), durum (Bekliyor / İlgileniliyor / Tamamlandı / İptal), atanan, kaynak (Mesaj / Telefon / Resepsiyon / Personel / AI asistanı / Misafir portalı) |
| Satır düğmeleri | Başlat · Tamamla · Ata |
| "Yeni istek" | Form |
| Detay penceresi | Kim açtı, kim üstlendi, ne zaman bitti; düzenleme (yalnız değişen alanlar, sürümle); durum düğmeleri |

### Yeni istek formu

| Alan | Anlamı |
| --- | --- |
| Oda | Oda seçilir; içerideki misafir **kendiliğinden** bulunur (resepsiyon misafiri aramaz) |
| Kategori | Yukarıdaki liste |
| Öncelik | Hizmet süresini belirler (Acil 15 · Yüksek 30 · Normal 60 · Düşük 240 dk) |
| Başlık / Açıklama | Başlık zorunlu; mesajdan açılıyorsa önerilir |
| Zamanlı iş | Uyandırma gibi: istenen saat (otelin saat diliminde); "Yarın için hızlı saat" çipleri (06:00, 06:30…) |
| Atanan personel | "Şimdilik atama yok" ya da kişi |
| Nereden geldi? | Telefon / Resepsiyon / Personel |

### Adım adım

1. Misafir aradı: "Yeni istek" → oda 207 → "Havlu / malzeme", Normal, "2 ekstra havlu" → Kaydet. Hedef: 60 dk.
2. Kat görevlisi listede görür (ya da kat aktörü görevi Görevlerim'e düşürür), **Başlat** → İlgileniliyor; **Tamamla** → not isteğe bağlı ("2 havlu bırakıldı") → Tamamlandı.
3. İptal gerekirse **sebep zorunlu** ("misafir vazgeçti") — şikâyet incelemesinde "neden yapılmadı" ilk sorudur.

**Durum kuralları:** Bekliyor → İlgileniliyor → Tamamlandı; Bekliyor / İlgileniliyor → İptal. Başlatılmış işi "Bekliyor"a geri almak süreyi **sıfırlamaz** (gecikme gizlenemez); tamamlanmış / iptal işi yeniden açmak süreyi sıfırlar (misafir yeniden bekliyor). Öncelik ya da saat düzenlenirse süre isteğin **açıldığı andan** yeniden hesaplanır.

### Arka planda — istek nereye dönüşür

| Kategori | Ne olur | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- |
| Temizlik, Havlu / malzeme | **Kat hizmeti aktörü** "Misafir isteği" tipinde kat görevi açar ve isteğe bağlar; görevli "Bitti" deyince istek **Tamamlandı** olur (oda rengi değişmez) | Kat hizmetleri → Görev panosu / Görevlerim; İstekler | Görev açılmaz; istek yine listededir, görevli İstekler'den kapatır |
| Arıza | Teknik servis bileti açılır (resepsiyon istekten / elle) ve isteğe bağlanır; bilet açılınca istek **İlgileniliyor**, çözülünce **Tamamlandı** | Teknik servis → Arızalar; İstekler | — |
| Oda servisi | Restoran → Oda servisi ekranına sipariş olarak girilir (misafir portalından gelen sipariş doğrudan oraya düşer); istek takip için kalır | POS → Oda servisi | — |
| Uyandırma | Zamanlı istek; hedef = istenen saat; saat yaklaşınca liste en üste alır, geçince gecikmiş | İstekler | — |
| Şikâyet | AI'dan gelen şikâyet konuşması personele devredilir; istek elle açılır, çözümü not edilir | İstekler, anket takibiyle birlikte | — |
| Her kategori | Yeni istek → ilgili yetkililerin ziline (Acil hemen); süre aşılınca sahibine zil (bir kez) | Zil, kırmızı rozet | — |

**Örnek:** 08:05 misafir WhatsApp'tan "sabah 7'de uyandırın lütfen, bir de 2 havlu" yazdı (konuşma personelde). Resepsiyon iki istek açar: (1) oda 207 **Uyandırma**, saat yarın 07:00 → listede hedef 07:00; (2) oda 207 **Havlu / malzeme**, Normal → hedef 09:05; kat aktörü 207'ye "Misafir isteği: 2 havlu" görevi açar, Fatma'nın Görevlerim'ine düşer. 08:40 Fatma "Bitti" → istek (2) Tamamlandı, Mesajlar sağ panelinde "Tamamlandı" görünür. Ertesi sabah 07:00 geçti, uyandırma Tamamla basılmadıysa 07:01'de "1 dk gecikti" kırmızı, isteğin sahibine zil.

## Anketler

**Nerede:** Ön büro → Anketler (`/anketler`). Sekmeler: **Rapor**, **Cevaplar** (`/cevaplar`), **Takip** (`/takip`), **Tasarım**, **Ayarlar** (`/ayarlar`). Misafir tarafı: `/misafir/a/<bağlantı>` (dört dil).

**Yetki:** cevaplar, rapor, takipler, AI özeti "anket görüntüleme" (müdür, ön büro); takibi üstlen / not / kapat / yeniden aç "anket takibi"; tasarım, ayarlar, AI dönem özeti isteme "anket kurulumu" (müdür).

### İki anket türü

| Tür | Kime, ne zaman | Varsayılan | Amaç |
| --- | --- | --- | --- |
| **Çıkış sonrası anket** | Çıkış yapan misafire, çıkış gününden **N gün sonra** ayardaki saatte (en fazla 2 gün geç gönderilir) | Açık; N = 1 | NPS, bölüm puanları, yorum |
| **Ara anket** | İçerideki misafire **girişin ertesi günü** ayardaki saatte; en az M gece kalan misafire; ayrılış gününe gönderilmez | 1–2 soru | Sorun konaklama bitmeden çözülsün; düşük puan **kritik** zil |

Aynı misafire aynı tür anket "en az X gün arayla" (ayar); aynı turda aynı misafirin iki odası tek anket. Gönderim gerçek saate göre (gece kapanışına bağlı değil).

### Gönderim — arka planda

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Zamanlanmış iş (15 dk'da bir) | Uygun çıkışları / girişleri bulur, imzalı anket bağlantısı üretir, bildirim kuyruğuna "Çıkış sonrası anket" / "Ara anket" şablonuyla (e-posta + SMS) davet yazar | Rapor → cevap oranı (davet sayısı); Bildirimler → Gönderim geçmişi | Portal adresi yok ya da açık kanal + etkin şablon yoksa **tur hiç başlamaz** (Ayarlar sekmesinde "Bağlantı adresi yok" uyarısı) |
| Misafirde iletişim yok / kanal kapalı | Davet silinir, sonraki turda yeniden değerlendirilir (hak harcanmaz) | — | — |
| Misafir bağlantıyı açtı | Davet "Açıldı" | Rapor | Bağlantı ayardaki gün kadar geçerli |
| Misafir cevapladı | Davet başına **tek cevap**; zorunlu / aralık denetimi; bitince puandan bağımsız **Google / TripAdvisor** bağlantıları gösterilir (yalnız memnunlara göstermek Google kurallarına aykırıdır) | Cevaplar | — |
| Cevapta yorum var ve AI açık | Geri bildirim ajanı **ton** (Olumlu / Nötr / Olumsuz / Karışık) + en fazla 5 **konu** + tek cümle özet yazar; 30 dk'da yazılmazsa "etiketlenemedi" | Cevaplar satırı, Rapor → "Yorumlarda geçen konular" | AI kapalıysa yorum etiketsiz durur; her şey AI'sız çalışır |
| **Düşük puan**: NPS ≤ 6 ya da bir puan ≤ 2 (eşikler ayardan) | Cevapla aynı işlemde **takip kaydı** + zil ("Düşük puan"; ara ankette **kritik**). Hedef: içerideki misafirde 2 saat, çıkmışta 48 saat | Takip sekmesi; zil | — |

Model misafirin adını, onay kodunu, iletişim bilgisini görmez; işlem kaydına yorum metni yazılmaz.

### Ayarlar

| Alan | Anlamı |
| --- | --- |
| Çıkış sonrası anket açık; gecikme (gün); gönderim saati | Çıkıştan kaç gün sonra, saat kaçta |
| Ara anket açık; en az gece; gönderim saati | Girişin ertesi günü; kısa konaklamaya gitmez |
| Aynı misafire en az X günde bir | Aynı tür anket sıklığı |
| Bağlantı geçerlilik (gün) | Anket bağlantısı kaç gün açık |
| Düşük NPS eşiği (6) / düşük puan eşiği (2) | Takip ve zil eşikleri |
| Google yorum bağlantısı / TripAdvisor bağlantısı | Anket sonunda herkese gösterilir |
| "Bağlantı adresi yok" uyarısı | Misafir portalı ayarındaki portal adresi gerekir; yoksa davet gitmez |

### Tasarım

Anket başına soru listesi: tip (**Tavsiye 0–10** tek NPS sorusu, **Puan 1–5**, **Seçenekli** tekli / çoklu, **Açık uçlu**), **konu** (rapordaki bölüm: Genel, Oda, Temizlik, Personel, Giriş / çıkış, Yiyecek-içecek, Tesis, Spa, İnternet, Gürültü…), zorunlu, dört dilde metin (eksik dil Türkçeye düşer; ekranda uyarı), sıralama (yukarı / aşağı). Cevaplanmış soru **silinmez, arşivlenir**; tipi değişmez; cevaplanmış seçenek kaldırılamaz. İlk açılışta dört dilde varsayılan sorular yüklüdür. Tasarım sürümle kilitlidir: iki yönetici aynı anda değiştirirse ikincisi uyarı alır.

### Cevaplar

Dönem, tür, dil süzgeçleri; satırda misafir (kart bağlantısı), oda, tarih, NPS ve puan ortalaması rozetleri, AI ton / konu etiketleri, yorum, takip rozeti. Satır ayrıntıda bütün cevaplar.

### Rapor

| Gösterge | Anlamı |
| --- | --- |
| **NPS** | Destekçi % (9–10) − Eleştiren % (0–6); −100…+100 |
| Dağılım | Destekçi / Pasif (7–8) / Eleştiren |
| Cevap oranı | Davet → açılan → cevaplanan |
| Genel puan / puan ortalaması | 1–5 soruların ortalaması |
| Düşük puan | Dönemde takip açan cevap sayısı |
| Eğilim | Haftalık / aylık NPS (cevap sayısıyla) |
| Sorular | Soru başına cevap, ortalama, dağılım; seçenek sayıları (arşiv soruları dönemde cevabı varsa görünür) |
| Bölüm puanları | Konu başına 1–5 ortalaması (cevap sayısıyla ağırlıklı) |
| Yorumlarda geçen konular | AI etiketleri: konu × ton |
| **AI özeti** | Dönemin en yeni 150 yorumundan tema, pay, alıntı, en fazla 3 öneri; "Özet iste" (kurulum yetkisi; birkaç saniye; aynı dönem için tek bekleyen istek) |

**Örnek:** Son 30 gün: 410 çıkış, 380 davet (30 misafirde iletişim yok), 190 açıldı, 131 cevap (cevap oranı %34). NPS dağılımı: 71 destekçi (%54), 38 pasif (%29), 22 eleştiren (%17) → NPS **+37**. Bölüm puanları: Temizlik 4,6 · Personel 4,7 · Yiyecek-içecek 3,9 · İnternet 3,2. AI konuları: "İnternet — Olumsuz" 18 yorum, "Kahvaltı — Karışık" 11. AI özeti: "Wi-Fi hızı 3. ve 4. katlarda şikâyet konusu; kahvaltı çeşidi övülüyor, sıcak büfe sıcaklığı eleştiriliyor; öneri: kat 3–4 erişim noktası, büfe ısıtıcı kontrolü." 22 eleştiren cevabın 9'u düşük puan takibi açtı.

### Takip (düşük puan)

| Alan / işlem | Anlamı |
| --- | --- |
| Liste | Açıklar hedef süreye göre (geciken önce, işaretli); kapananlar son kapanan önce; "benimkiler" |
| Takip sayfası | Cevap (puanlar, yorum), misafir ve konaklama, durum (Açık / İlgileniliyor / Kapandı), hedef süre |
| Üstlen / Devret / Bırak | Sahiplik |
| Not / Misafirle görüşme | Tarihli, **değişmez** notlar |
| Kapat | **Sonuç** (Özür dilendi / Telafi edildi / Sorun giderildi / Açıklama yapıldı / Ulaşılamadı / Diğer) + açıklama zorunlu |
| Yeniden aç | Kapanmış takibi açar |

**Örnek:** Ara anket, oda 318, giriş ertesi 10:00: "Odanız nasıl?" → 2/5, yorum "klima gürültülü". 10:01 takip açılır, hedef 12:01 (2 saat), resepsiyon ziline **kritik**. Resepsiyon üstlenir, 10:10 teknik servis bileti açar (oda 318, Isıtma / soğutma), 10:15 misafirle görüşme notu "aradım, 11:00'de teknisyen gelecek". 11:20 bilet çözüldü; takip "Sorun giderildi — fan değişti, misafir teşekkür etti" ile kapanır. Çıkış sonrası ankette aynı misafir NPS 9 verir.

## Spa

**Nerede:** Ön büro → Spa (`/spa`). Sekmeler: **Takvim**, **Randevular** (`/randevular`), **Dersler** (`/dersler`), **Rapor** (`/rapor`), **Tanımlar** (`/tanimlar`), **Ayarlar** (`/ayarlar`). Randevu sayfası `/spa/randevular/<kimlik>`, seans sayfası `/spa/dersler/<kimlik>`.

**Yetki:** hepsi "spa görüntüleme" ile görünür; randevu aç / düzenle / tamamla / iptal / gelmedi / geri al, derse kayıt, ücreti odaya yaz "spa randevu"; spa kasasında tahsilat / iade / iptal isteği "spa kasa"; fiyatı elle belirleme ve bedel silme "spa denetim"; hizmet, terapist, oda, blok, ders programı, ayarlar "spa kurulum".

### Önce Tanımlar

| Tanım | Alanlar |
| --- | --- |
| **Odalar** | Ad, tür (Bakım odası, Hamam, Stüdyo, Spor salonu, Diğer) |
| **Ekip** (terapist / eğitmen) | Ad, unvan, cinsiyet, **haftalık çalışma saatleri** (günde 3 dilime kadar), verebildiği hizmetler |
| **Hizmetler** | Kategori (Masaj, Hamam, Cilt bakımı, Vücut bakımı, Fitness / PT, Yoga / pilates, Diğer), tür (**Birebir randevu** / **Grup dersi**), **süre + temizlik arası**, **kişi başı fiyat** × kişi, terapist sayısı (çift masajı 2), kontenjan (grup), oda gerekir mi, uygun terapistler ve odalar, **portaldan alınabilir**, TR / EN / DE / RU ad ve açıklama |
| **İzin / bakım blokları** | Terapist izni ya da oda bakımı; en fazla 60 gün |

İleri tarihli işi olan terapist / oda / hizmet silinmez; kullanımdan kaldırılır (geçmiş okunur). Adlar tekildir; kayıtlar sürüm kilitlidir.

### Ayarlar

| Alan | Varsayılan | Anlamı |
| --- | --- | --- |
| Açılış / Kapanış | — | Randevu bu saatler içinde; hizmet kapanıştan önce bitmeli |
| Randevu aralığı | 15 dk | Saatler ızgaraya oturur (10:07 reddedilir) |
| Bedelsiz iptal süresi | 4 saat | Başlangıçtan önce |
| Geç iptal bedeli | %50 | Fiyat üzerinden |
| Gelmedi bedeli | %100 | Yalnız saati gelmiş randevuda |
| Portaldan randevu açık | — | Hizmet bazında kapatmak için hizmette "Portaldan alınabilir" kaldırılır |
| Portal en erken (dk) | 120 | Şimdi + 120 dk'dan önce randevu alınamaz |
| Konaklama başına açık portal kaydı | 4 | — |
| Hatırlatma (saat önce) | — | "Spa randevu hatırlatması" şablonuyla, bildirim kanallarından |

### Takvim

| Alan | Anlamı |
| --- | --- |
| Gün / ok tuşları | Gün seçimi |
| Takvim sütunları | **Terapist** ya da **Oda** |
| Hücreler | Randevu blokları (süre + açık renkli **temizlik arası**); renk durumu; simgeler: portaldan, açık bakiye, notu var |
| Boş hücre | Tıklayınca randevu formu gün, saat ve terapistle dolu açılır |
| Boş durum | "Takvim için önce Tanımlar'dan terapistleri, odaları ve hizmetleri girin" |

Takvim canlıdır; bağlantı yokken kendi tazelenir.

### Yeni randevu (adım adım)

1. Takvimde boş hücre ya da "Yeni randevu".
2. **Misafir:** otel misafiri (oda / ad araması; içerideki konaklamaya bağlanır) ya da **dışarıdan** (ad, telefon).
3. **Hizmet** → gün → **boş saatler** listelenir (terapist ve oda uygunluğuna göre).
4. **Terapist:** "Uygun olan atansın" (isteğe bağlı Kadın / Erkek tercihi) ya da belirli kişi; **oda** her zaman otomatik (randevu sayfasından değiştirilebilir).
5. Not → Kaydet. Aynı istek iki kez gönderilse ikinci randevu açılmaz.

**Yerleştirme kuralları:** saat açılış–kapanış içinde ve aralığa oturur; terapist o gün o saatte çalışıyor olmalı; tutma = başlangıç → bitiş + temizlik arası. Otomatik atamada: istenen kaynak, yoksa tercih edilen cinsiyet, sonra **en az meşgul** terapist; oda hizmetin odalarından boş olan. İki randevu aynı saniyede aynı terapisti isterse veritabanı birini reddeder ve otomatik atama 3 kez yeniden yerleşir.

### Randevu sayfası — alanlar ve işlemler

| Alan / işlem | Anlamı |
| --- | --- |
| Randevu kartı | Hizmet, misafir (ve oda), terapist(ler), oda, saat, tercih, not, açan, tamamlayan |
| **Hesap** | **Fiyat** (liste: kişi başı × kişi; yetkili gerekçeyle değiştirir — ikram, paket), **borç** (tamamlanınca vergili toplam), **alınan** (kasa), **odaya yazılan**, **bakiye**, "şimdi iptal edilirse" bedeli |
| Spa kasası kartı | Bu randevu için kasada alınan ödemeler (yöntem, tutar, slip no, durum); "Ödeme al", "İade", "Hatalı girişi iptal et" |
| Yeniden planla | Gün, saat, terapist ("Uygun olan atansın"); grup dersi kaydında saat seansa bağlı, taşınamaz |
| **Tamamla** | "Ücretin gideceği yer": **Oda hesabına yaz** ya da **Spa kasasında ödenecek** |
| İptal | Gerekçe; bedel gösterilir; yetkili "Bedel alınmasın" + gerekçe |
| Gelmedi | Yalnız saati gelmiş randevuda; bedel %100 (yetkili silebilir) |
| Geri al | Para hareketi yoksa kapanmış randevu geri alınır; aksi hâlde düğme sebebiyle kapalı |

### Para akışı — arka planda

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Tamamla → **Oda hesabına yaz** | Borç folyonun vergi hesabıyla (SPA kategorisi) hesaplanır; "spa ücreti" olayı → **Folyo aktörü** konaklamanın folyosuna "Spa" kalemi yazar (yönlendirmeye uyar) | Folyo dökümü; randevuda "Odaya yazılan" | Folyo görevi; misafir çıkmış ve folyo kapalıysa görev |
| Tamamla → **Spa kasasında ödenecek** | Borç bakiyede kalır; kasada ödeme alınır (nakit / kart + slip) | Randevu "Açık bakiye"; Kasa → kaynak **Spa**; ön muhasebe "Spa" kanalı | Ön muhasebe eşlemesinde Spa kanalı bağlı değilse tahsilat muhasebe görevine düşer |
| Açık randevuda **ön ödeme** | Fiyat kadar alınır; tamamlanınca kalan hesaplanır | Kasa | — |
| **Büyük ödeme**, her **iade**, hatalı girişin **iptali** | "Spa ödeme" onayına (dört göz); onay ekranındaki "aç" bağlantısı randevuya götürür | Onaylar; randevu sayfası | — |
| Fiyat düzeltme (yetkili, gerekçe) — açıkta ya da **kasada kapanmış** randevuda (şikâyet telafisi) | Borç yeniden hesaplanır; fazlası onaylı iadeyle geri verilir. Odaya yazılmışta düzeltme **folyodan** (kalem iptali) | Hesap kartı | — |
| **Geç iptal / gelmedi bedeli** | İçerideki misafirde **odaya**; dışarıdan gelende bakiyede | Folyo / randevu | Yedek listedeki kayıt, seans iptali, konaklamanın iptali / gelmemesi **bedelsiz** |
| Konaklama iptal / gelmedi | İleri randevular bedelsiz kapanır | Randevular | — |
| Misafir çıkış yapıyor | Açık randevu ya da spa borcu varsa **spa'nın ziline**; çıkış penceresinde uyarı | Zil, check-out | — |

**Örnek — oda hesabı:** Oda 305'teki misafir, 15 Kasım 16:00, "Aromaterapi masajı" 60 dk + 15 dk temizlik, kişi başı 1.800 TL, 2 kişi (çift masajı, 2 terapist) → fiyat **3.600 TL**. Terapist seçilmez; sistem Zeynep ve Can'ı (en az meşgul) atar, oda "Bakım 2". Hatırlatma 2 saat önce, 14:00'te SMS. 17:15 **Tamamla → Oda hesabına yaz** → spa vergisi %10 dahil ise borç 3.600,00 (net 3.272,73 + 327,27) → folyo aktörü 305'in folyosuna "Spa — Aromaterapi masajı ×2 · 3.600,00" yazar; randevu "Odaya yazılan 3.600, bakiye 0". Çıkışta misafir folyoyla öder. Aynı randevu 15 Kasım 13:30'da iptal edilseydi (başlangıca 2,5 saat; bedelsiz süre 4 saat) → geç iptal %50 = 1.800 TL odaya yazılırdı; müdür "Bedel alınmasın — misafir hastalandı" ile silebilir.

**Örnek — spa kasası:** Dışarıdan gelen müşteri, hamam ritüeli 1.200 TL. Randevuda 500 TL nakit ön ödeme; tamamlanınca "Spa kasasında ödenecek" → kalan 700 kartla, slip no girilir; Kasa → kaynak Spa: Nakit 500, Kart 700. Müşteri şikâyet eder; yetkili fiyatı 900'e düşürür (gerekçe) → fazla 300 TL **iade** onaya gider → onaylanınca kasadan çıkar. Not: dışarıdan müşterinin spa satışına ait **mali belge** (ÖKC fişi / e-Arşiv) bu sürümde yoktur; yazarkasa entegrasyonu ileriki iş.

### Grup dersleri

| Alan / işlem | Anlamı |
| --- | --- |
| Dersler listesi | Gün aralığındaki seanslar (hizmet, eğitmen, salon, saat, kayıt / kontenjan / yedek) |
| Yeni seans | Hizmet (grup türü), eğitmen, salon, saat; **haftanın günlerinde tekrar** (çakışan gün atlanır) |
| Seans sayfası | Kayıtlar: asıl, **yedek**, kapananlar; kayıt ekle; düzenle / iptal; **Dersi tamamla** |
| Kontenjan | Dolunca yeni kayıt yedek listeye; yer açılınca sıradaki asıla geçer ve bildirim alır |
| Saat değişti | Kayıtların saati de değişir, bildirim gider |
| Tamamla | Asıl listedekilerin ücreti işlenir: oteldeki misafir **odasına**, diğerleri **bakiyeye**; kalabalık derste parça parça yürür, ekran kendiliğinden devam eder |

**Örnek:** Yoga, Pzt–Cmt 08:00, kontenjan 12, kişi başı 300 TL. 16 Kasım seansı: 12 asıl + 2 yedek. 15 Kasım akşamı bir asıl iptal eder (bedelsiz; grup kaydı) → 1. yedek asıla geçer, "Yoga dersine kaydınız kesinleşti" bildirimi. 16 Kasım 09:00 eğitmen **Dersi tamamla**: 9 otel misafirinin odasına 300'er TL (folyo aktörü), 3 dışarıdan katılımcı bakiyede → spa kasasından tahsil. Gelmeyen 1 asıl "Gelmedi" işaretlenir → %100 bedel.

### Rapor

Dönem (randevu gününe göre): ciro (misafirin ödediği toplam, vergi dahil), tamamlanan / iptal / gelmedi sayıları, hizmet ve kategori dökümü, **terapist performansı** (randevu, saat, ciro, doluluk — doluluk bugünkü haftalık saatlerden hesaplanır; geçmiş saat değişikliği ve izinler düşülmez, raporda yazar), eğilim. Geç iptal ve gelmedi bedelleri ayrı gösterilir.

### Portaldan randevu

Spa ayarında açıksa misafir portalında "Spa" sayfası: hizmetler (portaldan alınabilir olanlar, kendi dilinde), boş saatler, **anında onay** (terapist ve oda otomatik), spa'nın ziline bildirim; ders kaydı ve yedek liste; saati gelmemiş kaydı iptal (bedel varsa onaydan önce gösterilir). Yalnız konaklama günlerinde, en erken şimdi + 120 dk, en fazla 4 açık kayıt. Misafire personel notu, terapist ataması ve kasa satırları gösterilmez.

### Bildirimler

**Spa randevusu** (açılınca / saat değişince / yedekten asıla geçince) ve **Spa randevu hatırlatması** (ayardaki saat önce; 5 dk'da bir iş, bir kez) — yalnız konaklamaya bağlı randevuda, bildirim kanalları ve şablonlarıyla (ilk kullanımda yüklenir). Dışarıdan gelen müşteriye bildirim gitmez.

## Misafir portalı ve temassız uygulamalar

Portalın personel tarafı (online check-in incelemesi, davet, ayarlar) **Ön büro** bölümünde ayrıntılı anlatıldı. Burada misafir iletişimi açısından özet ve bağlantılar:

| Portal sayfası | Ne yapar | Personel tarafında nereye düşer |
| --- | --- | --- |
| Rezervasyonum | Tarihler, oda tipi, pansiyon, onay kodu | — |
| Online check-in | Kimlik + belge fotoğrafı + imza | Ön büro → Online check-in (inceleme); resepsiyon zili |
| Folyom | Misafirin ödediği pencereler (şirket / acente penceresi gizli) | — |
| İstek gönder | Kategori + metin | **İstekler** (kaynak: Misafir portalı), zil |
| Oda servisi | QR menü, sipariş (içerideki misafire) | Restoran → Oda servisi; folyoya "Restoran siparişi" |
| Spa | Randevu / ders kaydı, iptal | Spa takvimi, spa zili |
| Anket | Açık anket kutusu | Anketler → Cevaplar |
| Web sohbeti | Balon (kanal açık ve portal adresi izinliyse) | **Mesajlar** (Web chat) |
| Dijital anahtar | **Pasif** — donanım entegrasyonu gelince | — |

**Davet:** girişten N gün önce otomatik (e-posta / SMS) ya da rezervasyon ayrıntısından elle; QR ve bağlantı kopyalama. Portal adresi ayarda yoksa otomatik davet ve anket **gitmez**.

**Örnek — misafirin yolculuğu iletişim gözüyle:** 10 Kasım davet SMS'i → 12 Kasım misafir online check-in yapar (resepsiyon zili) → 13 Kasım 15:00 giriş (form dolu) → 13 Kasım 21:00 portaldan "2 ekstra yastık" isteği (İstekler: Havlu / malzeme, Normal; kat görevi) → 14 Kasım 10:00 ara anket: 4/5 → 14 Kasım portaldan 17:00 masaj randevusu (spa zili; tamamlanınca odaya yazılır) → 15 Kasım web sohbetinden "geç çıkış mümkün mü?" (AI otel bilgisinden geç çıkış politikasını söyler; ücret kararı için personele devreder) → 16 Kasım çıkış → 17 Kasım 11:00 çıkış sonrası anket → NPS 9, yorum "masaj harikaydı" → AI: Olumlu, konu Spa.

## Sık sorulanlar

**AI neden cevap vermiyor?**
Sırayla: Ayarlar → AI asistanı'nda "cevap versin" açık mı; "Sunucuda model anahtarı tanımlı değil" uyarısı var mı; ajanlar Yönetim → Aktörler'de kapalı mı; günlük bütçe dolmuş mu (yönetime "AI bütçesi" uyarısı gelir); konuşma Personel modunda mı (biri yazmış ya da "Manuele al" demiş — "AI'a devret" ile geri verilir); kanal WhatsApp / web chat mi (başka kanalda AI yok).

**AI yanlış bilgi verebilir mi?**
Yalnızca "Misafire anlatılacak otel bilgisi" ve otel ayarlarındaki bilgiyi söyler; fiyat ve müsaitliği sistemden okur; onay kodunu veritabanından yazar. Rezervasyonu misafir açıkça onaylamadan açmaz. Fiyat yalnızca varsayılan pansiyonla verilir; başka pansiyon / grup / uzun konaklama personele devredilir.

**Personel cevabı "Gönderim bekliyor"da kaldı.**
Kanal kapalı (Ayarlar → Mesaj kanalları → hat kapalı) ya da WhatsApp 24 saat penceresi kapanmış olabilir ("Gönderilemedi" + sebep). Kanal açılınca bekleyenler dakikada bir gönderilir. Sistem gönderilmiş gibi göstermez.

**Web chat misafiri hangi odada bilmiyorum.**
Misafire odasını sorun; "Konaklamaya bağla" ile odayı seçin. Gelecek rezervasyon araması burada yok; içerideki konaklamalar bağlanır.

**İsteği yanlışlıkla başlattım, geri aldım; süre neden sıfırlanmadı?**
Gecikme gizlenemez: Bekliyor'a geri almak süreyi sıfırlamaz. Yalnızca tamamlanmış / iptal işi yeniden açmak sıfırlar.

**Anket gitmiyor.**
Anket Ayarları'nda "Bağlantı adresi yok" uyarısı varsa misafir portalı ayarına portal adresini girin; Bildirimler → Kanallar'da e-posta ya da SMS kurulu ve "Çıkış sonrası anket" şablonu etkin olmalı. Çıkıştan N gün + saat geçmeden gitmez; 15 dakikalık iş aralığını bekleyin. Gönderim geçmişinde satırı ve hatasını görürsünüz.

**Yorumlar etiketlenmedi.**
AI kapalı ya da anahtar yok; etiket 30 dk'da yazılmazsa "etiketlenemedi" olur. Rapor puanları sistem hesaplar, AI'sız çalışır.

**Spa randevusu "uygun saat yok" diyor ama terapist boş görünüyor.**
Hizmet süresi + temizlik arası kapanıştan önce bitmeli; terapistin o gün çalışma saatleri Tanımlar → Ekip'te tanımlı olmalı; hizmetin uygun terapist / oda listesinde o kişi / oda olmalı; saat ızgaraya (15 dk) oturmalı.

**Spa ücreti folyoda görünmüyor.**
Randevu "Tamamla → Oda hesabına yaz" ile kapatılmadıysa yazılmaz (spa kasasında ödenecek seçildiyse bakiye randevuda kalır). Folyo aktörü kapalıysa Görevler'de "Folyo" görevi vardır.

**Kapanmış randevuyu geri alamıyorum.**
Para hareketi (kasa ödemesi ya da odaya yazılmış kalem) varsa geri alınmaz; düğme sebebiyle kapalıdır. Düzeltme: odaya yazılmışta folyodan kalem iptali; kasada ödenmişte yetkili fiyat düzeltmesi + onaylı iade.

**Misafir portaldan randevu alamıyor.**
Spa ayarında "Portaldan randevu açık" ve hizmette "Portaldan alınabilir" işaretli mi; en erken şimdi + 120 dk; konaklama günleri dışında alınamaz; konaklama başına 4 açık kayıt sınırı.

## Sık yapılan hatalar

- **AI modundaki konuşmaya "sadece bakmak için" yazmak.** Yazdığınız an konuşma size geçer ve AI susar. Bakmak için okuyun; iç not yazmak da konuşmayı personele alır.
- **Konuşmayı yanlış misafire bağlamak.** Sistem ikinci misafiri reddeder ama ilk bağlama yanlışsa folyo ve istekler yanlış odaya düşer. Oda numarasını misafire teyit ettirin.
- **Şikâyeti istek açmadan sohbette çözmek.** İz kalmaz; anket takibi ve şikâyet incelemesi için **Şikâyet** kategorisinde istek açın, çözümü notlayın.
- **Uyandırma isteğini saatsiz açmak.** Hedef süre Normal 60 dk olur, 08:00'de gecikmiş görünür. Zamanlı iş saatini girin.
- **İsteği kat görevi yerine elle tamamlamak (Temizlik / Havlu).** Kat aktörü görevi açmışsa görevli "Bitti" deyince istek kendiliğinden kapanır; iki yerden kapatmak gerekmez. Görev açılmadıysa (aktör kapalı) İstekler'den kapatın.
- **Anket sorularını cevaplar geldikten sonra silmeye / tipini değiştirmeye çalışmak.** Engellidir; arşivlenir. Yeni soru ekleyin.
- **Yalnız memnun misafire Google bağlantısı göstermeyi istemek.** Sistem herkese gösterir; aksi Google kurallarına aykırıdır.
- **Düşük puan takibini açık bırakmak.** Hedef 2 / 48 saat; geciken takipler listede işaretlidir ve zil düşer. Kapatırken sonuç ve açıklama zorunludur.
- **Spa'da "Spa kasasında ödenecek" seçip tahsilatı unutmak.** Randevu "Açık bakiye" görünümünde kalır; çıkışta spa ziline uyarı düşer ama misafir gitmiş olabilir. İçerideki misafirde "Oda hesabına yaz" daha güvenlidir.
- **Çift masajını tek terapistle tanımlamak.** Hizmette terapist sayısı 2 olmalı; yoksa ikinci terapist tutulmaz, oda çakışır.
- **Terapist çalışma saatlerini girmeden takvim beklemek.** Takvim boş kalır ("önce Tanımlar'dan…"); saatler günde 3 dilime kadar girilir.
- **Grup dersini tamamlamadan günü bitirmek.** Ücretler işlenmez; eğitmen "Dersi tamamla" demelidir (gelmeyenler önce işaretlenir).
- **Portal adresini girmeden anket / davet beklemek.** Her ikisi de portal adresine ve bir bildirim kanalına bağlıdır.
- **WhatsApp'tan "rezervasyon onayı" bildirimi beklemek.** Otelin başlattığı WhatsApp şablon mesajı bu sürümde yoktur; bildirimler e-posta / SMS ile gider. Onay kodunu AI sohbette yazar.
