# Arka ofis: fatura, muhasebe, bordro, demirbaş

Bu bölüm otelin **para ve kayıt tarafını** anlatır: kesilen faturalar ve e-belge takibi, ön muhasebe (cariler, kasa / banka, çek / senet, fişler), genel muhasebe (Tek Düzen hesap planı, yevmiye fişleri, mizan), personel ve bordro, demirbaş sicili ve amortisman. Hedef okuyucu muhasebe ve insan kaynakları personeli ile sistemi tanımak isteyen yöneticidir.

Beş modül birbirine bağlıdır ve çoğu kayıt **kendiliğinden** oluşur:

- Misafir çıkış yapıp folyosu kapanınca **fatura taslağı** açılır (folyo aktörü).
- Alınan her ödeme, mal kabul, acente primi, etkinlik bedeli ve bordro **ön muhasebeye** işlenir (muhasebe aktörü).
- Ön muhasebeye yazılan her cari ve kasa / banka hareketi **yevmiye fişi** olur; gün kapanışında günün geliri **günlük gelir fişi** olur (aynı aktör, genel muhasebe).
- Onaylanan bordro personel, SGK, vergi dairesi carilerine tahakkuk eder; maaş ödemesi kasadan / bankadan çıkar.
- Demirbaş personele zimmetlenir; işten çıkışta zimmet uyarısı bordro ekranında görünür.

Önce her ekranın nerede olduğunu, sonra adım adım nasıl kullanılacağını, en sonda da arka planda hangi aktörün neyi otomatik yaptığını okuyacaksınız. Bölümün sonunda sık yapılan hatalar ve bilinçli olarak henüz yapılmamış işler listelenir.

## Genel bakış: ekranlar ve yetkiler

| Alan | Menü yolu | Adres | Görmek için izin | Yazmak için izin |
| --- | --- | --- | --- | --- |
| Faturalar | Ön büro → Faturalar | `/faturalar` (Faturalanacaklar, Taslaklar, Kesilenler, Ayarlar) | `invoices.view` | `invoices.issue` (folyo / etkinlik faturası kesme, tekrar gönderme), `invoices.manage` (serbest fatura, satır düzenleme, iptal isteği), `invoices.setup` (ayarlar) |
| Ön muhasebe | Ön büro → Ön muhasebe | `/muhasebe` (Cariler, Yaşlandırma, Kasa / banka, Çek / senet, Fişler, Ayarlar) | `accounting.view` | `accounting.manage` (fiş, çek / senet işlemi, cari kartı, eşitleme), `accounting.setup` (tanımlar, eşleme, başlangıç günü, açılış bakiyesi, fiş iptali) |
| Genel muhasebe | Ön büro → Genel muhasebe | `/genel-muhasebe` (Mizan, Yevmiye, Hesap planı, Kurallar, Ayarlar), fiş `/genel-muhasebe/yevmiye/:journalId`, ekstre `/genel-muhasebe/hesaplar/:accountId` | `ledger.view` | `ledger.manage` (elle fiş, eşitleme), `ledger.setup` (hesap planı, kurallar, dönem kilidi, fiş iptali) |
| Personel | Ön büro → Personel | `/personel`, `/personel/:id` | `employees.view` ya da `payroll.view` | `employees.manage` (kart), `payroll.manage` (ücret alanları, avans, icra, çıkış) |
| Bordro | Ön büro → Bordro | `/bordro` (Bordrolar, Puantaj ve kalemler, Servis payı, Ayarlar), `/bordro/:id` | `payroll.view` | `payroll.manage` (puantaj, kalemler, hesapla, onaya gönder), `payroll.pay` (maaş / avans ödemesi), `payroll.setup` (parametreler, işyeri, kalemler, departmanlar) |
| Demirbaş | Ön büro → Demirbaş | `/demirbas` (Demirbaşlar, Sayım, Amortisman, Garanti, Tanımlar) | `assets.view` (sayım için `assets.count`) | `assets.manage` (kart, Excel, taşıma, zimmet, etiket, sayım aç / kapat, tanımlar), `assets.finance` (yıl amortismanı kaydet / geri al, elden çıkarma) |
| Bütçe | Ön büro → Bütçe | `/butce/plan`, `/butce/gerceklesen`, `/butce/sapma` | `budget.view` | `budget.manage`, `budget.approve` |

Varsayılan rol dağılımı: **Müdür** ve **Muhasebe** rolleri bu alanların tamamını görür ve çoğunu yazar; ön büro yalnızca folyo faturası kesebilir; ayar türü işler (seri, entegratör, başlangıç günü, eşleme, parametre teyidi) müdüre ayrılmıştır. Otel, Ayarlar → Roller & İzinler matrisinden bu dağılımı değiştirebilir. Bir düğmeyi görmüyorsanız sebebi büyük olasılıkla izindir; gerçek denetim sunucudadır, menüde gizlemek yalnızca kolaylıktır.

## Faturalar (fatura kesme ve e-belge)

### Ne işe yarar

Fatura modülü kapanan folyoları, gerçekleşen etkinlikleri ve folyo dışı satışları (cariye serbest fatura) resmî faturaya çevirir, faturayı **e-Fatura** ya da **e-Arşiv** olarak entegratör üzerinden GİB'e gönderir ve durumunu izler. Fatura kesme (yol haritasındaki 16. modül) ile e-belge (49. modül) tek yerde kurulmuştur; ikisini ayrı düşünmeyin.

### Nerede bulunur

Yan menüde **Faturalar**. Dört sekme:

- **Faturalanacaklar** (`/faturalar/faturalanacaklar`): faturası kesilmemiş kapanmış folyolar ve faturaya hazır etkinlikler.
- **Taslaklar** (`/faturalar/taslaklar`): açılmış ama kesilmemiş faturalar.
- **Kesilenler** (`/faturalar/liste`): numarası verilmiş faturalar, GİB durumu, tekrar gönderme, iptal.
- **Ayarlar** (`/faturalar/ayarlar`): satıcı bilgileri, seriler, faturalama başlangıcı, entegratör, vergi kodu eşlemesi (yalnız `invoices.setup`).

Ayrıca folyo ekranında ve etkinlik dosyasında bir **Fatura kutusu** vardır: geçerli faturası (taslak ya da kesilmiş) varsa bağlantı ve durum; yoksa yetkiliye "Fatura taslağı aç" düğmesi. Fatura ekranının kendisi `/faturalar/:id` adresindedir.

### Temel kavramlar

| Kavram | Anlamı |
| --- | --- |
| **Kaynak** | Faturanın neye dayandığı: **folyo** (konaklama hesabı), **etkinlik** (banket / toplantı dosyası) ya da **serbest** (bir cariye folyo dışı satış: salon kirası, hizmet bedeli). |
| **Taslak** | Numarası henüz verilmemiş fatura. Alıcı bilgisi düzenlenir, satırlar (yalnız serbest fatura ve iptal bedeli faturasında) girilir. Silinebilir. |
| **Kesim** | Taslağa resmî numara verilmesi ve e-belgenin üretilmesi. Geri alınamaz; yanlışsa **iptal** edilir, yenisi kesilir. |
| **e-Fatura / e-Arşiv** | Alıcı GİB'e kayıtlı e-Fatura mükellefiyse belge **e-Fatura** olarak posta kutusuna gider; değilse **e-Arşiv** kesilir. Karar kesim anında mükellef sorgusuyla verilir; yabancı kişi ve yurt dışındaki şirket her zaman e-Arşiv'dir. |
| **Fatura numarası** | 3 karakterlik seri + yıl + 9 hane (örn. `DMF2026000000123`). Seri × yıl başına boşluksuz, sıralı ilerler. ETTN (belgenin evrensel kimliği) ayrıca üretilir. |
| **GİB durumu** | Kesilen faturanın e-belge yolculuğu: sırada → gönderiliyor → entegratörde → **tamamlandı** / **reddedildi** / **gönderilemedi**. |
| **Yasal süre** | Hizmetten sonra 7 gün (VUK 231/5). Faturalanacaklar listesi süresi yaklaşan ve geçen kayıtları rozetle gösterir. |
| **Faturalama başlangıcı** | Ayarlardaki tarih. Bu tarihten önce kapanan folyo / etkinlik "önceki sistemde faturalandı" sayılır, kuyruğa girmez. Ayar yokken kuyruk boştur ve ekran "Faturalama başlamadı" der. |
| **Fatura günü** | Otelin takvim günüdür, iş günü değil. Gün kapanışı gecikse de fatura gerçekten düzenlendiği günü taşır; numaralar tarih sırasını bozmaz. |

### Faturalanacaklar sekmesi

**Ne gösterir:** faturası olmayan kapanmış folyolar ve faturaya hazır (gerçekleşmiş ya da iptal bedeli kesinleşmiş) etkinlikler. Süzgeçler: kaynak türü, kapanış penceresi (7 gün – 1 yıl), **süresi geçenler**, arama (misafir / cari adı, oda, onay kodu).

**Adım adım tek fatura:**

1. Satırda **Taslak aç** deyin (ya da folyo ekranındaki fatura kutusundan).
2. Sistem satırları folyo kalemlerinden kurar: gelir grubu başına tek satır (geceler "Konaklama" satırında, hizmet dönemi açıklamada), iptaller düşülmüş, indirimler satır iskontosu olarak, vergiler kalemin işlendiği andaki dökümünden.
3. Alıcı varsayılanı: folyo bir cariye aktarıldıysa (acente / şirket ödemesi) o cari; değilse misafir. Adres ve kimlik bilgisi aynı alıcının **son faturasından** doldurulur.
4. Taslak ekranına geçersiniz (aşağıda).

**Dikkat:** klasik kullanımda bu sekmeyi elle açmanız bile gerekmez — folyo kapanınca folyo aktörü taslağı kendiliğinden açar (ayarlarda "otomatik taslak" açıksa). Bu sekme daha çok **gözden kaçanı** yakalamak için kullanılır: aktör kapalıyken kapanan folyolar, otomatik taslağı silinmiş kayıtlar, süresi geçmekte olanlar.

### Taslak ekranı ve kesim

Taslakta görülenler:

- **Alıcı formu:** tür seçimi — kişi (TC kimlik), şirket (vergi no + vergi dairesi), yabancı kişi (uyruk + pasaport; kimlik alanına GİB kuralıyla 11111111111 yazılır), yurt dışındaki şirket (kendi vergi numarası notta, kimliğe 2222222222). Ad / ünvan, adres, e-posta.
- **"Kesmeden önce" listesi:** eksikler (alıcı adı yok, vergi no sağlamasız, adres eksik, vergi kodu eşlenmemiş, faturalama başlangıcından önce…) tek tek yazılır. Liste boşalmadan **Kes** düğmesi çalışmaz.
- **Yasal süre** ve varsa başlangıç uyarısı.
- **Satırlar ve vergi dökümü:** folyo faturasında satırlar kaynaktan gelir, düzenlenmez; serbest fatura ve iptal bedeli faturasında satır eklenir / çıkarılır (birim tutar otelin vergi ayarıyla folyodaki formülle hesaplanır).

**Kes** dediğinizde arka planda tek işlemde şunlar olur:

1. Kaynak (folyo / etkinlik) **yeniden okunur**. Taslak açıldıktan sonra folyo değişmişse (yeniden açılıp kalem eklenmiş) taslak yenilenir ve kesim durur; ekran "kaynak değişti, kontrol edin" der.
2. Şirket alıcı için **mükellef sorgusu** yapılır (sonuç 24 saat önbellekte): kayıtlı + posta kutusu varsa e-Fatura, değilse e-Arşiv. Sorgu yapılamıyorsa kesim durur — belge türü bilinmeden numara verilmez.
3. Seri × yıl için **sıradaki numara** alınır (satır kilidiyle; aynı anda sekiz kesim bile boşluk bırakmaz).
4. **UBL-TR belgesi** üretilir ve içeriği özetle (SHA-256) dondurulur; GİB kuralları uygulanır: KDV (0015) ve konaklama vergisi (0059) KDV hariç bedel üzerinden, vergisiz satır %0 + 351 muafiyet kodu, karekod GİB kılavuzuna göre.
5. Fatura **gönderim sırasına** girer; `invoice.issued` olayı yayınlanır (muhasebe aktörü dinler).

Kesimden sonra ekranda **e-belge kutusu** (belge türü, ETTN, posta kutusu, son cevap), **zaman çizelgesi** (kim ne zaman ne yaptı), **PDF** ve **İptal iste** düğmesi görünür.

### Örnek: folyo kapanışından e-belgeye, sayılarla

Ayşe Demir, oda 204, 14–16 Mart (2 gece), Deluxe 3.000 TL / gece. Folyoda şu kalemler var (tutarlar vergi **dahil**; vergi dökümü her kalemin işlendiği anda kaleme yazılmıştır):

| Kalem | Tutar | Vergi kategorisi | Dahil vergiler | Net | Vergi |
| --- | --- | --- | --- | --- | --- |
| Konaklama 14.03 | 3.000,00 | Oda | KDV %10 + konaklama vergisi %2 | 2.678,57 | KDV 267,86 · KV 53,57 |
| Konaklama 15.03 | 3.000,00 | Oda | KDV %10 + konaklama vergisi %2 | 2.678,57 | KDV 267,86 · KV 53,57 |
| Restoran · ADS-2026-000412 | 960,00 | Yiyecek-içecek | KDV %10 | 872,73 | KDV 87,27 |
| Minibar · MB-000287 | 210,00 | Minibar | KDV %20 | 175,00 | KDV 35,00 |
| **Toplam borç** | **7.170,00** | | | | |
| Ödemeler: giriş teminatı nakit 1.000 + çıkışta kart 6.170 | **7.170,00** | | | | |
| **Bakiye** | **0,00** | | | | |

Net = brüt ÷ (1 + dahil oranların toplamı): 3.000 ÷ 1,12 = 2.678,57; KDV = 2.678,57 × 0,10; konaklama vergisi = 2.678,57 × 0,02. Yuvarlama **satır bazında** yapılır; bu yüzden toplamda kuruş farkı görülebilir, bu bir hata değildir.

Adım adım:

1. **Çıkış, 16 Mart 11:00.** Resepsiyon 6.170 TL kart ödemesini alır; bakiye sıfır; çıkış tamamlanır. Folyo aktörü bakiyesi sıfır folyoyu **kapatır** (`folio.closed`).
2. **Taslak açılır (otomatik).** Folyo aktörü `folio.closed`'u dinler: faturalama başlangıcı 1 Mart ise 16 Mart'ta kapanan folyo kuyruğa girer; "otomatik taslak" açık → taslak. Satırlar **gelir grubuna göre** kurulur: "Konaklama 14.03.2026–16.03.2026 (2 gece)" 6.000,00; "Restoran" 960,00; "Minibar" 210,00. Vergi dökümü kalemlerden toplanır: KDV %10 matrahı 2.678,57 × 2 + 872,73 = 6.229,87 → KDV 622,99; KDV %20 matrahı 175,00 → 35,00; konaklama vergisi %2 matrahı 5.357,14 → 107,14. Alıcı **misafir** (folyo cariye aktarılmadı), türü kişi.
3. **Taslak incelenir.** Faturalar → Taslaklar → Ayşe Demir. "Kesmeden önce" listesi: "TC kimlik no eksik" ve "adres eksik". Resepsiyon kimlik numarasını (check-in'de alınmıştı; sistem önceki faturasından da doldurur) ve adresi girer. Liste boşalır; yasal süre rozeti "6 gün kaldı".
4. **Kes.** Tek işlemde: kaynak yeniden okunur (folyo değişmemiş) → alıcı kişi → mükellef sorgusu gerekmez, belge **e-Arşiv** → seri DMA, yıl 2026, sıradaki numara → `DMA2026000000731` → UBL-TR belgesi (KDV 0015 satırları ve konaklama vergisi 0059 satırı **KDV hariç bedel** üzerinden; karekod) → özet (SHA-256) dondurulur → gönderim sırasına girer → `invoice.issued`.
5. **Gönderim.** Gönderici belgeyi üstlenir, entegratöre yollar; 30 sn sonra durum sorar. Test entegratöründe "entegratörde → tamamlandı". Gerçek entegratörde aynı yol izlenecek; şu an gerçek adaptör yok.
6. **Muhasebe.** Muhasebe aktörü `invoice.issued`'u alır: folyo faturasında numara **alacağı doğuran cari harekete** yazılır. Ayşe kartla ödedi, cari hareket yok → bağlanacak satır yok, iş "bağlanacak hareket yok" diye biter (kasa / banka girişleri ödeme anında zaten yazılmıştı). Aynı folyo acenteye "Acente / cari" ile kapanmış olsaydı acente carisindeki 7.170 TL borç satırına `DMA2026000000731` yazılırdı ve cari ekstresinde görünürdü.
7. **PDF ve zaman çizelgesi.** Fatura ekranında: taslak açıldı (folyo aktörü, 11:02), alıcı düzenlendi (resepsiyon, 11:05), kesildi (resepsiyon, 11:06), gönderildi (gönderici, 11:06), tamamlandı (11:07).

**Varyant — şirket alıcı:** aynı folyo "Yılmaz Holding" adına istenirse resepsiyon folyoyu kapanıştan önce "ödeyen" alanıyla şirkete yönlendirir ya da taslakta alıcı türünü **şirket** yapıp vergi numarasını girer. Kesimde mükellef sorgusu yapılır: Yılmaz Holding GİB'de e-Fatura kullanıcısıysa belge **e-Fatura** (seri DMF, posta kutusu etiketi), değilse e-Arşiv.

**Varyant — iptal:** fatura kesildikten sonra misafir "minibarı ben tüketmedim" derse: önce **İptal iste** (gerekçe) → onay kuyruğu → başka yetkili onaylar → e-Arşiv entegratörden iptal → folyo artık yeniden açılabilir → minibar kalemi iptal isteği (dört göz) → ters kayıt −210 → 210 TL iade (onaylı) → folyo yeniden kapanır → **yeni taslak** 6.960 TL → kes.

### Kesilenler sekmesi ve GİB durumu

Liste üstünde dört uyarı kutusu vardır ve her biri süzgeç olarak çalışır: **gönderilemedi**, **reddedildi**, **sonuç bekleniyor**, **iptal onayı bekliyor**. Süzgeçler: tarih, seri, belge türü, durum, alıcı araması.

Durumlar ve ne yapılacağı:

| Durum | Anlamı | Ne yapılır |
| --- | --- | --- |
| Sırada / gönderiliyor | Gönderici henüz göndermedi ya da gönderiyor | Bekleyin. 5 dakikadan uzun "gönderiliyor"da kalan kayıt kendiliğinden sıraya döner. |
| Entegratörde | Entegratör aldı, GİB sonucu bekleniyor | Bekleyin; durum gönderimden 30 sn sonra sorulmaya başlar, 7 güne kadar sorulur. |
| Tamamlandı | GİB kabul etti | İş bitti. |
| Reddedildi | Entegratör ya da GİB belgeyi reddetti (kalıcı hata; örn. alıcının posta kutusu yok) | Alıcıyı düzeltip **Tekrar gönder** (numarayı korur) ya da iptal edip yeni taslak açın. Yetkiliye zil düşer. |
| Gönderilemedi | Geçici hatalar (ağ, hız sınırı) tekrar denemeyle de aşılamadı | Entegratör bağlantısını kontrol edip **Tekrar gönder**. Yetkiliye zil düşer. |
| İptal onayı bekliyor | İptal isteği onay kuyruğunda | Gönderim durur; onay çıkınca iptal işlenir ya da gönderim sürer. |
| İptal edildi | Fatura iptal | Gerekirse **Yeni taslak** düğmesiyle aynı kaynaktan yeniden taslak açın. |

Geçici hata yeniden deneme aralıkları: 1 dk, 5 dk, 15 dk, 1 saat, 4 saat; sonra "gönderilemedi".

**PDF** otelin kendi kopyasıdır: kesilmiş faturada GİB karekodu, ETTN, senaryo ve tip; taslakta "TASLAK", iptalde "İPTAL", test ortamında "mali değeri yoktur" damgası. Resmî görüntü entegratörün ürettiğidir.

### Toplu fatura (iki adım)

Ay sonu yoğunluğu için faturalanacaklar ve taslaklar listeleri **iş kuyruğu** gibi çalışır:

1. **Faturalanacaklar** sekmesinde satırları işaretleyip **Seçilenlere taslak aç**. Alıcısı eksik taslaklar işaretlenir (çözülmesi gerekir).
2. **Taslaklar** sekmesinde alıcısı tamam olanları işaretleyip **Seçilenleri kes**. Her taslak tek kesimin bütün kurallarından geçer; numaralar taslakların açılış sırasıyla verilir.

Bir turda en fazla 100 kayıt alınır; istek 20 saniyelik bütçeyle durur, ekran ilerleme göstererek kalanla kendiliğinden devam eder. Bu yüzden yüzlerce faturayı tek tıkla başlatıp beklemek yeterlidir. Alıcısı eksik taslak kesilmez, listede "alıcı eksik" olarak kalır.

### Serbest fatura (cariye)

Folyo ya da etkinlikle ilgisi olmayan satışlar için (toplantı salonu kirası, komisyon dışı hizmet) **Kesilenler** sekmesindeki **Serbest fatura** düğmesi. Cari seçilir; alıcı carinin kartından gelir, taslakta düzenlenir; satırlar elle girilir. Kesilince **cariye vadeli alacak** yazılır (ön muhasebe); iptal edilince fatura tarihli ters kayıt düşer. Yetki `invoices.manage`.

### Fatura iptali

Fatura silinmez; **iptal edilir** ve iptal **dört göz** kuralına bağlıdır: isteyen `İptal iste` der (gerekçe zorunlu), onay kuyruğuna `Fatura iptali` türünde iş düşer, başka bir yetkili onaylar. Onay beklerken e-belge gönderimi durur. Onaylanınca:

- GİB'e ulaşmamış belge **yerelde** iptal edilir.
- e-Arşiv belgesi entegratör üzerinden iptal edilir.
- e-Fatura GİB portal referansıyla iptal edilir (referans ekranda istenir).

Muhasebe tarafında faturanın cari hareketteki bağı çözülür; serbest faturanın alacağı ters kayıtla düşer. İptal edilen faturanın kaynağından **Yeni taslak** açılabilir.

Önemli kural: **faturası kesilmiş folyo yeniden açılamaz.** Çıkışı geri almak, folyoya kalem eklemek için önce fatura iptal edilir. Taslağı olan folyo yeniden açılırsa taslak silinir; folyo yeniden kapanınca taslak yeniden açılır.

### e-Fatura / e-Arşiv entegrasyonunun gerçek durumu (dürüst not)

Bu konuda beklenti yönetimi önemlidir:

- Fatura, numara, UBL-TR belgesi, karekod, mükellef ayrımı, gönderim sırası, durum sorgusu, yeniden deneme, iptal akışları ve ekranlar **tamamdır ve testlidir**.
- Entegratör tarafında bir **adaptör sözleşmesi** ve **test entegratörü** vardır. Test ortamında "test mükellefleri" listesi (Ayarlar sekmesinde) ile e-Fatura / e-Arşiv ayrımı ve ret senaryoları denenir.
- **Gerçek bir özel entegratör adaptörü henüz yoktur.** Firma seçimi yapılmamıştır; canlı ortam gerçek adaptör yazılıp bağlanınca açılır. Yani bugün kesilen fatura GİB'e **fiilen gitmez**; test ortamında PDF'de "mali değeri yoktur" yazar. Ayarlar canlı ortam + test entegratörü birleşimine izin vermez.
- **e-Defter** (aylık yevmiye / kebir XML dosyası) yoktur; yevmiye ve kebir genel muhasebe (48) ekranlarında vardır, GİB biçiminde dosya üretimi planlıdır.
- **Döviz faturası** yoktur: otelin para birimi TRY değilse kesim durur.
- e-Arşiv faturanın alıcıya **e-posta ile gönderimi** entegratör adaptörüyle gelecektir.

### Ayarlar sekmesi

`/faturalar/ayarlar`, yalnız `invoices.setup`:

- **Satıcı:** otelin işletme ünvanı, VKN, vergi dairesi, adres. Girilmeden kesim yapılamaz.
- **Faturalama başlangıcı:** bugünden ileri olamaz; ileri alınırsa ekran aradaki kayıtların kuyruktan çıkacağını söyler.
- **Seriler:** e-Fatura ve e-Arşiv için ayrı 3 karakter seri.
- **Otomatik taslak:** folyo kapanınca taslak açılsın mı.
- **Entegratör ve ortam:** test / canlı (canlı yalnız gerçek adaptörle).
- **Vergi kodu eşlemesi:** otelin vergi satırları → GİB kodu (KDV 0015, konaklama vergisi 0059). Ad üzerinden öneri gelir, personel onaylar. Eşlenmemiş vergiyle kesim durur.
- **Test mükellefleri:** test ortamında hangi vergi numaraları e-Fatura kullanıcısı sayılacak.

### Arka planda otomatik olanlar

| Olay | Kim | Ne yapar |
| --- | --- | --- |
| Folyo kapandı | Folyo aktörü (billing-worker) | Faturalama başlangıcından sonraysa ve otomatik taslak açıksa taslak açar; alıcı folyo cariye aktarıldıysa cari, değilse misafir. |
| Fatura kesildi | e-belge göndericisi (sunucu içi zamanlanmış iş) | Sıradaki belgeleri üstlenir (4 eşzamanlı, tur başına 200), entegratöre gönderir, 30 sn sonra durum sormaya başlar. |
| Fatura kesildi | Muhasebe aktörü (accounting-worker) | Folyo / etkinlik faturasının **numarasını** alacağı doğuran cari harekete yazar (ikinci alacak açmaz); serbest faturayı cariye vadeli alacak olarak işler. |
| Fatura iptal edildi | Muhasebe aktörü | Bağı çözer; serbest faturanın alacağını ters kayıtla düşer. |
| Gönderilemedi / reddedildi | Gönderici | Fatura yetkilisine zil (uyarı türü "Fatura"). |

Folyo aktörü ya da muhasebe aktörü kapalıysa işleri **Görevler** ekranına düşer ("Folyo" ve "Ön muhasebe" modüllerinde); personel aynı işi fatura ekranından ya da Muhasebe → Eşitle ile yapar. Gönderici bir aktör değil sunucu işidir; kapatılmaz.

Aynı akış "aktör kapalıysa ne olur" sütunuyla:

| Olay | Açıkken | Kapalıysa / yapamazsa | Personel ne yapar |
| --- | --- | --- | --- |
| `folio.closed` | Folyo aktörü taslak açar | "Folyo" modülünde görev: "Kapanan folyonun fatura taslağı açılacak" | Faturalanacaklar → Taslak aç; görevi tamamla |
| `invoice.issued` | Muhasebe aktörü numarayı cari harekete bağlar / serbest faturayı cariye yazar | "Ön muhasebe" görevi: "Fatura DMA… cariye bağlanacak" | Ön muhasebe → Ayarlar → Eşitle (dönem) → görevi tamamla |
| `invoice.cancelled` | Bağ çözülür, serbest fatura ters kayıt | "Ön muhasebe" görevi: "Fatura … iptali cariye işlenecek" | Eşitle → görevi tamamla |
| Gönderim sırası | Gönderici yollar, durum sorar | (Kapatılamaz) Sunucu kapalıysa açılışta takılı kalanı sıraya geri koyar | Beklemek yeterli |
| İptal kararı | Onay kuyruğu dinleyicisi iptali işler | (Süreç içi dinleyici, aktör değil) | Onaylar → Bekleyen |

### Ekran alanları: fatura ekranı

Taslak ve kesilmiş fatura aynı ekranda, farklı kutularla görünür (`/faturalar/:id`):

| Alan | Ne gösterir / ne yapar |
| --- | --- |
| Başlık | Kaynak (folyo · oda · misafir / etkinlik · dosya no / serbest · cari), durum rozeti (taslak, kesildi, gönderiliyor, entegratörde, tamamlandı, reddedildi, gönderilemedi, iptal onayı bekliyor, iptal), belge türü (e-Fatura / e-Arşiv) |
| Alıcı formu (taslakta) | Tür: kişi / şirket / yabancı kişi / yurt dışındaki şirket. Kişide ad soyad + TC kimlik; şirkette ünvan + VKN + vergi dairesi; yabancı kişide uyruk + pasaport; yurt dışındaki şirkette ülke + kendi vergi no. Adres (il, ilçe, posta kodu, ülke), e-posta. Tür bir kez seçilip hatırlanır (aynı alıcının sonraki faturası aynı türle açılır). |
| "Kesmeden önce" | Eksiklerin madde listesi; her madde ilgili alana götürür. Boş değilse Kes kapalı. |
| Yasal süre | Hizmet bitiminden 7 gün; kalan gün yeşil / sarı / kırmızı; süre geçtiyse "süresi geçti" (kesim engellenmez, raporlanır). |
| Başlangıç uyarısı | Kaynak faturalama başlangıcından önce kapanmışsa "önceki sistemde faturalanmış sayılır" |
| Satırlar | Açıklama, miktar, birim fiyat (KDV hariç), iskonto, KDV oranı / kodu, konaklama vergisi, satır toplamı. Folyo faturasında salt okunur; serbest faturada düzenlenir. |
| Vergi dökümü | Vergi kodu başına matrah ve tutar (0015 KDV %10, 0015 KDV %20, 0059 konaklama vergisi %2); muafiyet satırı (%0 + 351) |
| e-belge kutusu (kesilmişte) | Numara, ETTN, belge türü, alıcı posta kutusu (e-Fatura), ortam (test / canlı), son cevap metni, sonraki deneme zamanı |
| Zaman çizelgesi | Kim ne zaman ne yaptı: taslak açıldı, alıcı değişti, kesildi, gönderildi, durum sorgusu, iptal istendi / onaylandı, tekrar gönderildi |
| Düğmeler | Taslakta: Kaydet, Kes, Sil. Kesilmişte: PDF, Tekrar gönder (gönderilemedi / reddedildi), İptal iste (`invoices.manage`). İptal edilmişte: Yeni taslak. |

### Dikkat edilecekler ve sık hatalar

- **"Faturalama başlamadı"** görüyorsanız Ayarlar'da satıcı ve başlangıç günü girilmemiştir.
- **Kesim durdu: kaynak değişti.** Folyo taslaktan sonra yeniden açılmış. Taslak yenilenmiştir; satırları kontrol edip tekrar kesin.
- **Mükellef sorgusu yapılamadı.** Entegratör bağlantısı yok; test ortamında test mükellefleri listesini kontrol edin.
- **Vergi kodu eşlenmemiş.** Otele yeni vergi eklendiyse Ayarlar → vergi kodu eşlemesine kodunu girin.
- **Fatura kesildikten sonra folyo açılmıyor.** Doğru davranış; önce iptal.
- Folyo kalemleri vergi dökümü olmadan işlenmişse (eski veriler) kesim "vergi dökümü eksik" hatasıyla durur; kalem düzeltilmelidir.
- Faturanın tarihi takvim günüdür; **gece kapanışını geciktirmek fatura tarihini değiştirmez**.
- Yasal süre rozeti kırmızıya dönmüşse öncelik verin; sistem süreyi kendisi uzatamaz.

## Ön muhasebe (cariler, kasa / banka, çek / senet, fişler)

### Ne işe yarar

Ön muhasebe otelin **kimden alacağı, kime borcu olduğunu** (cariler), **parasının nerede durduğunu** (kasa ve banka hesapları), **çek ve senetlerin yolculuğunu** ve bunları değiştiren **fişleri** tutar. Genel muhasebe (hesap planı, yevmiye, mizan) **ayrı modüldür** (bir sonraki bölüm): buradaki her cari ve kasa / banka hareketi oraya kendiliğinden yevmiye fişi olur. Burada "borç / alacak" cari ve kasa dilidir, Tek Düzen hesap kodu yoktur.

Modülün ayırt edici özelliği: para hareketlerinin büyük kısmı **operasyondan kendiliğinden gelir**. Resepsiyonun aldığı ödeme, restoranın kapattığı adisyon, depoya giren mal, onaylanan acente primi, kesilen fatura, onaylanan bordro — hepsini **muhasebe aktörü** işler. Muhasebecinin elle girdiği fişler tahsilat / ödeme / virman / masraf gibi dış dünya hareketleridir.

### Nerede bulunur

Yan menüde **Ön muhasebe**. Sekmeler:

- **Cariler** (`/muhasebe/cariler`), cari kartı `/muhasebe/cariler/:id`
- **Yaşlandırma** (`/muhasebe/yaslandirma`)
- **Kasa / banka** (`/muhasebe/kasa-banka`)
- **Çek / senet** (`/muhasebe/cek-senet`)
- **Fişler** (`/muhasebe/fisler`), fiş ekranı `/muhasebe/fisler/:id`
- **Ayarlar** (`/muhasebe/ayarlar`)

### Temel kavramlar

| Kavram | Anlamı |
| --- | --- |
| **Cari** | Para alışverişi yaptığımız taraf: acente, tedarikçi, etkinlik müşterisi, şirket, şahıs, personel, SGK / vergi dairesi gibi kurumlar. Her carinin kodu, türü, vadesi ve bakiyesi vardır. |
| **Bakiye (B / A)** | Bakiye = borç − alacak. **(B)** cari bize borçlu (alacağımız var), **(A)** biz cariye borçluyuz. Cariler listesinin üstünde iki kutu: toplam alacağımız / toplam borcumuz. |
| **Kasa / banka hesabı** | Paranın durduğu yer. Kasa (nakit; döviz kasası olabilir) ya da banka (IBAN'lı). Her hesabın para birimi vardır ve hareket gördükten sonra değişmez. |
| **Yöntem eşlemesi** | Ön büro / etkinlik / restoran / spa tahsilatının ödeme yöntemi × para birimine göre hangi kasa / bankaya gireceği. Eşleme yoksa otomatik kayıt yazılamaz ve iş personele düşer. |
| **Fiş** | Tahsilat, ödeme, virman, kasa / banka giriş-çıkış ve açılış belgeleri. Her fişin numarası, tarihi, satırları vardır; iptali ters kayıtla olur. |
| **Başlangıç günü** | Muhasebenin "sistemde tutulmaya başladığı" gün. O günden (dahil) sonraki belgeler otomatik işlenir; öncesi **açılış bakiyesiyle** gelir. |
| **Açılış bakiyesi** | Başlangıç gününden bir gün önce tarihli, hesap başına tek kayıt: carinin devreden borcu / alacağı (vadesiyle), kasanın / bankanın devreden parası. |
| **Kaynak anahtarı** | Her otomatik kaydın dayandığı belgenin kimliği. Aynı belge iki kez işlense de ikinci kayıt açılmaz. |

### Cariler sekmesi ve cari kartı

**Cariler nereden gelir:**

- **Acente** ve **tedarikçi** carileri kartları açıldığında kendiliğinden açılır; ünvan, vergi ve iletişim bilgisi o karttan gelir ve kart değişince eşitlenir. Muhasebe yalnız vade, not ve kullanım alanını değiştirir.
- **Etkinlik müşterisi** carisi ilk etkinlik kaydında açılır.
- **Personel** carileri ilk bordro tahakkukunda açılır (ad / iletişim personel kartıyla eşitlenir). SGK, vergi dairesi, BES şirketi, icra / nafaka dosyası carileri de bordro tahakkukunda açılır.
- **Şirket / şahıs / diğer** cariler elle açılır (**Yeni cari**): ünvan, vergi no / TC kimlik, vergi dairesi, iletişim, vade, not.

**Liste:** tür, bakiye yönü ve durum süzgeci; sıralama; arama. Satıra tıklayınca kart.

**Cari kartı** (`/muhasebe/cariler/:id`):

- Bakiye ve **yaşlandırma** (bakiyenin vadeye göre dilimleri).
- **Açık çek / senetler** (bu cariden alınan / bu cariye verilen, henüz sonuçlanmamış).
- **Açılış** düğmesi (yoksa) ya da açılış bilgisi.
- **Ekstre:** dönem başı devir, belge günü sırasıyla hareketler, yürüyen bakiye, dönem toplamı; "daha fazla" ile sayfa sayfa. Her satırda kaynak (folyo ödemesi, mal kabul, fatura no, fiş no…) ve bağlantı.
- **Tahsilat fişi / Ödeme fişi** düğmeleri: fiş penceresi cari seçili açılır.

**Adım adım: acenteden havale geldi**

1. Cariler → acenteyi bulun → kart → **Tahsilat fişi**.
2. Tarih (iş günü), açıklama; satır: hesap = banka hesabı, tutar.
3. Kaydet. Cari alacaklanır (borcu düşer), banka hesabına giriş yazılır; ekstrede iki satır görünür.

### Yaşlandırma raporu

`/muhasebe/yaslandirma`: açık bakiyeler vadesine göre dilimlere ayrılır — **vadesi gelmemiş / 1–30 / 31–60 / 61–90 / 90+ gün**. Hesap **FIFO** mantığıyladır: en eski borç önce kapanmış sayılır, bakiye en yeni hareketlerde kalır. Yön süzgeci: alacaklarımız (bize borçlu cariler) ya da borçlarımız; tür süzgeci (acente, tedarikçi…). Gecikmesi en büyük cari üstte; dip satır süzgece göre toplam. Tahsilat takibinde haftalık bakılması gereken ekrandır.

### Kasa / banka sekmesi

`/muhasebe/kasa-banka`: üstte hesap kutuları (ad, tür, para birimi, bakiye), seçilen hesabın hareketleri altta (dönem başı devir, yürüyen bakiye, kaynak süzgeci: ön büro, etkinlik, restoran, spa, fiş, bordro…).

**Hesap tanımlama** (`accounting.setup`): **Yeni hesap** → kasa ya da banka, ad, para birimi, bankada IBAN (otel içinde tekil). Bakiyesi olan ya da eşlemede kullanılan hesap kullanımdan kaldırılamaz.

**Düğmeler:** **Giriş** (carisiz para girişi: banka faizi, bulunan para), **Çıkış** (masraf: kırtasiye, bahşiş avansı…), **Virman** (kasa → banka, banka → banka; aynı para biriminde). Hepsi fiştir, Fişler sekmesinde de görünür.

**Kural:** kasa **eksiye düşmez** — elle çıkış ve iptal kasada yeterli para yoksa reddedilir; banka eksiye düşebilir (kredili mevduat).

### Yöntem eşlemesi (ayarlar)

Ayarlar → **Tahsilat eşlemesi**: her kanal (ön büro, etkinlik, restoran, spa) × yöntem (nakit, kart, havale, döviz nakit…) × para birimi için hedef kasa / banka seçilir. Örnekler:

- Ön büro × nakit × TRY → "Resepsiyon kasası"
- Ön büro × kart × TRY → "POS bankası"
- Ön büro × nakit × EUR → "Euro kasası" (yoksa tutar otel parasına çevrilir ve kaynak döviz + kur hareket notunda saklanır)
- Restoran × nakit × TRY → "Restoran kasası"

Eşleme eksikse o yöntemle gelen tahsilat **otomatik işlenemez**: muhasebe aktörü işi "Ön muhasebe" manuel görevine düşürür. Eşlemeyi tamamlayıp **Eşitle** çalıştırınca birikenler işlenir.

### Çek / senet sekmesi

`/muhasebe/cek-senet`: alınan (portföy) ve verilen çek / senetler; durum, yön ve vade süzgeci; "vadesi geçmiş" ve "bu hafta vadesi gelen" özetleri. Çek **fişle doğar**: tahsilat fişinde "alınan çek" satırı, ödeme fişinde "verilen çek" satırı ya da **ciro** (portföydeki çeki tedarikçiye vermek).

Portföydeki çekin yolculuğu (satırdaki işlemler, her biri tarihlidir ve geçmişe yazılır):

- **Portföyde** → **Tahsile ver** (bankaya) → **Tahsil edildi** (banka hesabına giriş) ya da **Karşılıksız** (carinin borcu geri doğar) ya da **İade** (carinin borcu geri doğar).
- **Ciro edildi**: ciro edilen tedarikçiye borcumuz düşer; çek karşılıksız dönerse hem asıl carinin borcu geri doğar hem ciro edilene borcumuz geri doğar.
- Verilen çek: **Ödenecek** → **Ödendi** (bankadan çıkış) ya da **Karşılıksız**.

Kısıtlar: aynı çek iki fişte ciro edilemez; çek numarası (yön × tür × banka) iptal edilmemişlerde tekildir; tahsil edilmiş çekin fişi iptal edilemez.

### Fişler sekmesi

`/muhasebe/fisler`: tür, tarih, durum (işlendi / onay bekliyor / iptal), cari ve hesap süzgeci; fiş ekranı `/muhasebe/fisler/:id` (satırlar, karşı taraf, çekler, iz, iptal düğmesi).

Fiş türleri ve etkileri:

| Fiş | Cari etkisi | Para etkisi |
| --- | --- | --- |
| **Tahsilat** | Cari alacaklanır (bize borcu düşer) | Kasa / banka satırları giriş; alınan çek / senet portföye |
| **Ödeme** | Cari borçlanır (bizim borcumuz düşer) | Kasa / banka çıkış; verilen çek "ödenecek"; portföydeki çek **ciro** |
| **Virman** | — | Kaynak hesaptan çıkış, hedefe giriş (aynı para birimi) |
| **Giriş / Çıkış** | — | Carisiz hareket (masraf, faiz) |
| **Açılış** | Devir borcu / alacağı (vadesiyle) | Devir parası; başlangıç gününden bir gün önce tarihli, hesap başına tek |

**Fiş penceresi:** canlı toplam, birden fazla kasa / banka satırı, çek satırları (çek no, banka, vade, keşideci), ciro seçimi (portföyden). Satır toplamı karşı tarafla eşit olmalıdır.

**Dört göz:** ödeme fişinin toplamı ayarlardaki **eşiğe** eşit ya da üstündeyse fiş "onay bekliyor" yazılır, onay kuyruğuna `Ödeme fişi` türünde iş düşer; başka bir yetkili onaylar; onay anında kasanın yeterliliği **yeniden** denetlenir (bu arada kasa boşaldıysa onay reddedilir). Reddedilir / süresi dolarsa fiş hiç işlenmez.

**İptal** (`accounting.setup`): yalnız işlenmiş fişte, gerekçeyle, **fiş tarihli ters kayıt** ile. Fişin açtığı çek ilk durumunda olmalı (tahsile verilmiş / ciro edilmiş çekin fişi iptal edilemez). Kasa iptalle eksiye düşecekse iptal reddedilir.

### Ekran alanları: cari kartı ve fiş penceresi

**Cari kartı** (`/muhasebe/cariler/:id`):

| Alan | Ne gösterir |
| --- | --- |
| Başlık | Kod (ör. `CAR-000214`), ad / ünvan, tür rozeti (acente, tedarikçi, etkinlik müşterisi, şirket, şahıs, personel, kurum), durum, bağlı kart bağlantısı (acente kartı, tedarikçi kartı, personel kartı) |
| Bilgiler | Vergi no / TC kimlik, vergi dairesi, iletişim, **vade (gün)**, not, kullanım alanı. Bağlı caride ünvan / vergi / iletişim salt okunur (kaynağı kart). |
| Bakiye kutusu | Bakiye ve yönü: **(B)** cari bize borçlu, **(A)** biz borçluyuz; tutar otel para biriminde |
| Yaşlandırma şeridi | Vadesi gelmemiş · 1–30 · 31–60 · 61–90 · 90+ gün dilimleri (FIFO) |
| Açık çek / senetler | Bu cariden alınan portföydeki / tahsildeki çekler, bu cariye verilen ödenecek çekler; satırdan çek kartına |
| Açılış | "Açılış bakiyesi gir" (yoksa) ya da açılış fişi bağlantısı |
| Ekstre | Dönem seçimi; **devir** satırı; hareketler belge günü sırasıyla: tarih, belge (fiş no / folyo / mal kabul no / fatura no / bordro), açıklama, borç, alacak, **yürüyen bakiye**, vade; dönem toplamı; "daha fazla" |
| Düğmeler | Tahsilat fişi, Ödeme fişi (cari seçili açılır), Düzenle |

**Fiş penceresi** (Fişler → Yeni fiş ya da cari kartından):

| Alan | Ne gösterir / ne yapar |
| --- | --- |
| Tür | Tahsilat / Ödeme / Virman / Giriş / Çıkış (açılış ayrı pencerede) |
| Karşı hesap (masraf / gelir, isteğe bağlı) | Yalnız Giriş / Çıkış türünde: yevmiye fişinde kasa / bankanın karşısına yazılacak Tek Düzen hesabı (ör. `770.01 Elektrik`, `649`). Boşsa genel muhasebe kuralı (çıkış 770, giriş 649). |
| Tarih | İş günü varsayılan; geriye yazılabilir (başlangıç gününden önce olamaz) |
| Cari | Tahsilat ve ödemede zorunlu; seçici kod / ad ile arar, bakiyeyi gösterir |
| Satırlar | Her satır bir kasa / banka hesabı + tutar (+ açıklama). Hesabın para birimi fişle aynı olmalı. |
| Çek / senet satırları | Tahsilatta **alınan çek**: çek no, banka, şube, keşideci, vade, tutar. Ödemede **verilen çek** (firma çeki) ya da **ciro**: portföyden çek seçimi (süresi geçmiş / tahsile verilmiş çek listelenmez). |
| Canlı toplam | Satırların toplamı; cari tarafıyla eşit olmalı |
| Onay uyarısı | Ödeme fişi toplamı eşiğe eşit / üstüyse "bu fiş onaya gider" şeridi |
| Kaydet | 201 işlendi ya da 202 onaya gitti; aynı istek kimliğiyle ikinci gönderim tek fiş |

### Örnek: mal kabulden ödemeye (11.800 TL)

Deniz Balıkçılık'tan 10 kg levrek: mal bedeli 10.727,27 TL + KDV %10 1.072,73 TL = **11.800,00 TL** KDV dahil. Tedarikçi kartında vade 30 gün. Mal kabul 2 Nisan.

| Adım | Ekranda | Arka planda | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Satın alma → sipariş → **Mal kabul**: depo, irsaliye no, gelen 10 kg | Stok girer; hareketli ortalama güncellenir; `purchase.goods.received` (tutarlar, vade, tedarikçi) | Stok → Hareketler |
| 2 | — | **Muhasebe aktörü:** Deniz Balıkçılık carisine **11.800,00 alacak** (bizim borcumuz), belge günü 2 Nisan, **vade 2 Mayıs** (kabul günü + 30), kaynak "Mal kabul MKB-2026-0098". Cari bakiyesi **(A) 11.800,00** | Ön muhasebe → Cariler (borcumuz kutusu +11.800); cari ekstresi; Yaşlandırma → "vadesi gelmemiş" |
| 3 | 20 Nisan: muhasebeci kısmi ödeme — cari kartı → **Ödeme fişi**: banka "İş Bankası TRY" 5.000,00 | Fiş `ODM-2026-0087`; cari **borç 5.000** (bakiye (A) 6.800); banka hesabından **çıkış 5.000**. Eşik (ör. 75.000) altında → onay yok | Fişler; Kasa / banka → İş Bankası hareketleri; cari ekstresi yürüyen bakiye 6.800 |
| 4 | 2 Mayıs: kalan 6.800 TL **firma çekiyle** — Ödeme fişi: satır "verilen çek" (çek no, banka, vade 2 Haziran, 6.800) | Cari borç 6.800 → bakiye **0**; çek portföyde **"ödenecek"** durumunda; banka henüz etkilenmez | Çek / senet → verilenler; cari kapandı |
| 5 | 2 Haziran: çek bankadan ödenir → Çek / senet → satır → **Ödendi** | Banka hesabından **6.800 çıkış**, çek durumu "ödendi"; işlem tarihli | Kasa / banka hareketleri; çek geçmişi |
| 6 | Varyant: çek karşılıksız dönerse → **Karşılıksız** | Cariye borcumuz **geri doğar** (A 6.800); çek "karşılıksız" | Cari ekstresi; yaşlandırmada 31–60 gün dilimi |

Mal kabul **başlangıç gününden önce** olsaydı (ör. başlangıç 1 Mayıs) aktör hiçbir şey yazmazdı; o borç açılış bakiyesiyle girilirdi (cari kartı → Açılış: alacak 11.800, vade 2 Mayıs). Muhasebe aktörü kapalı olsaydı 2. adım "Ön muhasebe" görevi olur, Eşitle ile tamamlanırdı; eşleme gerekmez (mal kabul kasa / banka kullanmaz, doğrudan cariye yazılır).

### Otomatik kayıtlar: muhasebe aktörü neyi nasıl işler

Muhasebe aktörü (panelde "Muhasebe aktörü") şu olayları dinler ve **kaynak belgeyi okuyarak** kayıt yazar. Her kayıt kaynak anahtarıyla tekildir: aynı olay iki kez gelse, aktör sonradan açılıp olayı yeniden alsa da ikinci kayıt açılmaz.

| Ne oldu | Muhasebeye ne yazılır |
| --- | --- |
| Folyoya **ödeme** alındı (nakit / kart / havale / döviz) | Eşlemedeki kasaya / bankaya giriş. Döviz nakit: döviz kasası varsa oraya; yoksa otel parasına çevrilir, kaynak döviz ve kur notta. |
| Folyo **"Acente / cari"** ya da **voucher** ile kapatıldı | Para girmez; ödeme penceresinde seçilen cariye (varsayılan rezervasyonun acentesi) **borç** yazılır, vade = gün + carinin vadesi. Fatura kesilince numarası bu harekete bağlanır. |
| Folyo ödemesi **iade** edildi / **iptal** edildi | Kasadan / bankadan çıkış; iptal asıl satırın tersi. İade cariye yapılmışsa carinin alacağı. |
| **Etkinlik** tahsilatı | Eşlemedeki kasa / banka + etkinlik müşterisinin carisinden düşer. |
| Etkinlik **gerçekleşti** / **iptal bedeli** kesinleşti | Müşteri carisine bedel borç; **fark kaydıyla** eşitlenir (daha önce yazılmış toplam hedeften farklıysa yalnız fark yazılır). |
| **Restoran / oda servisi / spa** ödemesi | Restoran / spa eşlemesine göre kasa / banka. Onay bekleyen ya da reddedilen ödemenin muhasebe etkisi yoktur. |
| **Mal kabul** (satın alma) | Tedarikçi carisine **KDV dahil** borcumuz; vade = kabul günü + tedarikçi vadesi. |
| **Acente primi** onaylandı / ödendi / geri alındı | Acente carisine alacak; fark kaydıyla eşitlenir, geri alınan primde ters fark. |
| **Fatura kesildi** | Folyo / etkinlik faturası: numara mevcut cari harekete yazılır (ikinci alacak yok). Serbest fatura: cariye vadeli alacak. |
| **Fatura iptal** | Bağ çözülür; serbest faturanın alacağı fatura tarihli ters kayıt. |
| **Bordro onaylandı** | Ay sonu tarihli tahakkuk: personel carisine net ücret (avans mahsubu dahil), SGK carisine işçi + işveren payı − indirimler, vergi dairesine gelir + damga vergisi, BES şirketine katkılar, icra / nafaka dosyasına kesinti. |
| **Maaş ödendi** | Kasadan / bankadan tek çıkış; her personelin carisine borç (cari kapanır). |

Kurallar:

- **Başlangıç gününden önceki** belge işlenmez (açılış bakiyesiyle gelir). İptal kaydı, asıl satır işlenmişse işlenir.
- Eşleme yoksa ya da hesabın para birimi tutmuyorsa iş **anlamlı hatayla durur** ve "Ön muhasebe" manuel görevine düşer (bekleyip yeniden denemez; iş kuralı hatası beklemekle düzelmez).
- Her kayıt kaynak belgeden okunur, olayın gövdesinden değil — belge sonradan düzeltildiyse düzeltilmiş hâl yazılır.

### Olay → kayıt → ekran → aktör kapalıysa (tek tablo)

| Olay (kaynak modül) | Muhasebe aktörü ne yazar | Nerede görünür | Kapalıysa / yapamazsa görev başlığı | Tamamlama yolu |
| --- | --- | --- | --- | --- |
| Folyo ödemesi alındı (17) | Eşlemedeki kasa / bankaya giriş; "Acente / cari" ve voucher'da cariye borç (vade = gün + cari vadesi) | Kasa / banka hareketleri (kaynak "Ön büro"); cari ekstresi | "Folyo tahsilatı muhasebeye işlenecek (kasa / banka ya da cari)" | Eşlemeyi tamamla → Ayarlar → Eşitle |
| Folyo iadesi (17) | Kasa / bankadan çıkış ya da carinin alacağı | Aynı | "Folyo iadesi muhasebeye işlenecek" | Eşitle |
| Ödeme iptali (17) | Asıl satırın tersi | Aynı (iptal kaydı üstü çizili) | "Ödeme iptali muhasebeye ters kayıtla işlenecek" | Eşitle |
| Etkinlik tahsilatı (37) | Kasa / bankaya giriş + müşteri carisinden düşer | Kasa / banka (kaynak "Etkinlik"); cari ekstresi | "Etkinlik tahsilatı kasaya / bankaya ve müşteri carisine işlenecek" | Eşitle |
| Etkinlik gerçekleşti / iptal / kaybedildi (37) | Müşteri carisine bedel (fark kaydıyla); iptalde iptal bedeline düzeltme; kaybedilende geri alınır | Cari ekstresi | "Etkinlik bedeli müşteri carisine işlenecek" | Eşitle |
| Restoran / oda servisi ödemesi (39 / 41) | Restoran eşlemesine göre kasa / banka | Kasa / banka (kaynak "Restoran") | "Restoran tahsilatı kasaya / bankaya işlenecek" | Eşleme → Eşitle |
| Spa ödemesi (57) | Spa eşlemesine göre kasa / banka | Kasa / banka (kaynak "Spa") | "Spa tahsilatı kasaya / bankaya işlenecek" | Eşleme → Eşitle |
| Mal kabul (45) | Tedarikçi carisine KDV dahil borcumuz, vade = kabul + tedarikçi vadesi | Cari ekstresi; Yaşlandırma (borçlarımız) | "Mal kabul tedarikçi carisine işlenecek" | Eşitle |
| Acente primi onaylandı / ödendi / geri alındı (35) | Acente carisine alacak (fark kaydıyla) | Cari ekstresi | "Acente prim hak edişi acente carisine işlenecek" | Eşitle |
| Fatura kesildi (49) | Numara cari harekete; serbest fatura vadeli alacak | Cari ekstresi (satırda fatura no) | "Fatura … cariye bağlanacak" | Eşitle |
| Fatura iptal (49) | Bağ çözülür; serbest faturanın ters kaydı | Cari ekstresi | "Fatura … iptali cariye işlenecek" | Eşitle |
| Bordro onaylandı (51) | Ay sonu tarihli tahakkuk: personel, SGK, vergi dairesi, BES, icra / nafaka carileri | Cariler (tür personel / kurum); ekstreler | "Onaylanan bordro carilere tahakkuk ettirilecek" | Eşitle |
| Maaş ödendi (51) | Kasa / bankadan tek çıkış; personel carilerine borç (kapanır) | Kasa / banka (kaynak "Bordro"); personel ekstreleri | "Maaş ödemesi kasaya / bankaya ve personel carilerine işlenecek" | Eşitle |

Her satır için ortak: başlangıç gününden önceki belge işlenmez; kaynak anahtarı tekildir; onay bekleyen / reddedilen ödemenin etkisi yoktur; iş kuralı hatası (eşleme yok, cari yok, para birimi uyumsuz) beklemeden göreve düşer, geçici hata 3 kez denenir.

### "Eşitle" ile tamamlama

Ayarlar → **Eksik kayıtları eşitle**: bir dönem seçilir, sistem o dönemdeki bütün belgeleri (ödemeler, mal kabuller, primler, etkinlik bedelleri, faturalar, bordrolar) tarar ve **henüz işlenmemiş** olanları aynı fonksiyonlarla işler. Kullanım yerleri:

- Aktör kapalıyken biriken işler.
- Eşleme eksikken düşen görevler: eşlemeyi tamamlayın, Eşitle'yi çalıştırın, görevleri "tamamlandı" işaretleyin.
- Canlıya alış: başlangıç gününden bugüne kadarki belgeler.

Eşitleme **20 saniye** çalışır, kalan belge sayısını kesin olarak söyler; yeniden çalıştırınca kaldığı yerden sürer. Aynı hata türü tek satırda sayılır. İşlenmiş belgeye bir şey yapmaz (kaynak anahtarı).

### Aktör kapalıyken

Aktör panelinden Muhasebe aktörü kapatılırsa hiçbir şey kaybolmaz: her olay **Görevler** ekranında "Ön muhasebe" modüllü bir görev olur ("Folyo tahsilatı muhasebeye işlenecek (kasa / banka ya da cari)", "Mal kabul tedarikçi carisine işlenecek", "Onaylanan bordro carilere tahakkuk ettirilecek"…). Muhasebeci sorunu (eşleme, cari) düzeltir, **Eşitle** ile dönemi işler ve görevleri kapatır. Aktör yeniden açılıp aynı olay gelse de kayıt ikinci kez yazılmaz.

### Ayarlar sekmesi

`/muhasebe/ayarlar`:

- **Başlangıç günü** (ilk muhasebe ekranı açıldığında otelin bugünü olarak kurulur; değiştirilebilir).
- **Ödeme fişi onay eşiği** (dört göz sınırı).
- **Tahsilat eşlemesi** (yukarıda).
- **Eksik kayıtları eşitle**.

Kasa / banka tanımları Kasa / banka sekmesindedir; cari seçici folyo ödeme penceresinde ön büroya da açıktır ("Acente / cari" ve voucher yönteminde cari seçmek için).

### Dikkat edilecekler ve sık hatalar

- **Kasa eksiye düşemez** uyarısı: elle çıkış ya da iptal kasadaki paradan büyük. Önce virmanla kasaya para aktarın ya da doğru kasayı seçin.
- **Eşleme yok** görevi: Ayarlar → Tahsilat eşlemesinde o kanal × yöntem × para birimi satırını doldurun, Eşitle çalıştırın.
- **Cari seçilmemiş**: resepsiyon "Acente / cari" yöntemiyle ödeme alırken cari seçmemiş. Ödeme penceresinde cari seçimi zorunludur; eski kayıt için muhasebeci görevi görür.
- **Açılış bakiyesi yanlış girildi**: açılış fişini iptal edip yenisini açın (hesap başına tek açılış).
- **Hesap türü / para birimi değişmiyor**: hareket görmüş hesabın türü ve para birimi değişmez; yeni hesap açın.
- **Yevmiye fişi eksik / "Fişlenmemiş hareket var"**: ön muhasebe kaydı yazılmış ama genel muhasebe kuralı / hesabı sorunlu (Görevler'de "… yevmiye fişine çevrilecek"). Genel muhasebe → Kurallar'ı düzeltip Genel muhasebe → Ayarlar → Eşitle çalıştırın. Ayrıntı bir sonraki bölümde.
- **Dış muhasebe programına aktarım** (96) ve **e-Defter** dosyası henüz yoktur; müşavire veri için yevmiye listesi, mizan, ekstreler, Excel çıktıları ve bordro müşavir tablosu kullanılır.
- Bütçede **gider gerçekleşeni** elle girilir (Bütçe → Gerçekleşen); satın alma ve ön muhasebeden otomatik beslenmesi yol haritasındadır. Gelir, doluluk ve tahsilat gerçekleşeni sistemden gelir.

## Genel muhasebe (hesap planı, yevmiye, mizan)

### Ne işe yarar ve ön muhasebeden farkı

Ön muhasebe "kimden alacağım var, kime borcum var, param nerede duruyor" sorusuna cevap verir: cari ekstresi, kasa / banka hareketi, çek / senet. Bu, **muavin** düzeyidir — tek bir tarafın (bir carinin, bir kasanın) hareket defteri. Genel muhasebe aynı hareketleri **Tek Düzen Hesap Planı**'nın hesaplarına çift taraflı yazar: her belge bir **yevmiye fişi** olur, fişin **borç toplamı alacak toplamına eşittir**, bütün fişlerin toplamı **mizan**ı verir, bir hesabın fiş satırları **hesap ekstresini (kebir)** verir. Muhasebe müşavirinin, mali tablonun ve e-Defter'in dili budur.

İki modülün ilişkisi tek yönlüdür ve kendiliğindendir:

| Ön muhasebe (muavin) | Genel muhasebe (yevmiye) |
| --- | --- |
| "Acente X carisi 4.000,00 TL alacaklandı" | "120.02 Acenteler hesabı 4.000,00 borç / 120.01 Misafir ve adisyon hesapları 4.000,00 alacak" |
| "Ön büro kasasına 1.000,00 TL girdi" | "100.01 Ön büro kasası (TRY) 1.000,00 borç / 120.01 1.000,00 alacak" |
| "Tedarikçi carisine 11.300,00 TL borcumuz doğdu" | "150 İlk Madde ve Malzeme 10.000,00 borç, 191 İndirilecek KDV 1.300,00 borç / 320 Satıcılar 11.300,00 alacak" |
| Gelir burada görünmez (folyo ve adisyon başka modüldedir) | Gün kapanışında **günlük gelir fişi**: 120.01 borç / 600.xx gelir ve 391 Hesaplanan KDV alacak |

Muhasebeci ön muhasebede fiş kesmeye devam eder; genel muhasebe o fişleri kural tablosuna göre **Tek Düzen hesaplarına çevirir**. Elle yevmiye fişi yalnız ön muhasebede karşılığı olmayan işler için gerekir: amortisman, tahakkuk, reeskont, kapanış ve düzeltme fişleri.

> **Otel sahibi için kısa özet:** Ön muhasebe "kasada ne var, kim borçlu"yu; genel muhasebe "bu ay ne kazandık, ne harcadık, bilanço ne"yi söyler. Genel muhasebe ekranları bir muhasebe bilgisi ister; ama sayıların nereden geldiğini merak ettiğinizde her fiş satırından kaynak belgeye (folyo ödemesi, mal kabul, fiş) tıklayıp inebilirsiniz.

### Nerede bulunur

Yan menüde **Genel muhasebe** (`/genel-muhasebe`), Ön muhasebe maddesinin hemen altında. Sekmeler:

- **Mizan** (`/genel-muhasebe/mizan`) — varsayılan sekme
- **Yevmiye** (`/genel-muhasebe/yevmiye`), fiş sayfası `/genel-muhasebe/yevmiye/:journalId`
- **Hesap planı** (`/genel-muhasebe/hesap-plani`), hesap ekstresi `/genel-muhasebe/hesaplar/:accountId`
- **Kurallar** (`/genel-muhasebe/kurallar`)
- **Ayarlar** (`/genel-muhasebe/ayarlar`)

İzinler: `ledger.view` (bütün sekmeleri ve ekstreyi görür), `ledger.manage` (elle fiş girer, Eşitle çalıştırır), `ledger.setup` (hesap açar / düzenler, kuralları ve dönem kilidini değiştirir, fiş iptal eder). Varsayılanda **Müdür** ve **Muhasebe** rolleri üçüne de sahiptir; ön büro ve diğer roller menüde Genel muhasebe'yi görmez.

### Temel kavramlar

| Kavram | Anlamı |
| --- | --- |
| **Tek Düzen Hesap Planı** | Türkiye'de zorunlu hesap çerçevesi. Kod hesabın yerini söyler: **1** dönen varlıklar, **2** duran varlıklar, **3** kısa vadeli yabancı kaynaklar, **4** uzun vadeli yabancı kaynaklar, **5** öz kaynaklar, **6** gelir tablosu hesapları, **7** maliyet hesapları (7/A), **9** nazım. "100" Kasa, "102" Bankalar, "120" Alıcılar, "320" Satıcılar, "391" Hesaplanan KDV, "600" Yurtiçi Satışlar, "770" Genel Yönetim Giderleri. |
| **Alt hesap** | Ana hesabın noktayla açılan kırılımı: `100.01`, `600.02`, hatta `600.02.1`. Kod en çok 3 haneli ana koddan ve noktayla en çok 4 alt seviyeden oluşur. |
| **Yaprak hesap / ana hesap** | Fiş satırı **yalnız yaprak hesaba** (alt hesabı olmayan) yazılır. Alt hesabı olan hesap "satır almaz"; mizanda alt hesaplarının toplamını gösterir. |
| **Sınıf** | Kodun ilk hanesinden türetilir: Varlık, Yabancı kaynak, Öz kaynak, Gelir, Maliyet, Gider, Nazım. 6 ile başlayan kodlarda 61, 62, 63, 65, 66, 68 grupları indirim / gider sınıfıdır (eksi çalışır); 60, 64, 67, 69 gelirdir. |
| **Departman (USALI)** | Hesabın otelcilik raporlamasındaki yeri: **Odalar**, **Yiyecek ve içecek**, **Diğer işletme bölümleri**, **Dağıtılmamış**. Mizan departmana süzülebilir; USALI gelir tablosu (93) ve dış aktarım (96) bu alanı kullanır. Boş bırakılabilir. |
| **Yevmiye fişi** | Bir belgenin çift taraflı kaydı: numara (`YEV-2026-00001`), gün, açıklama, belge no, satırlar (hesap + borç ya da alacak), toplam. **Otomatik** (aktör yazdı) ya da **Elle**. Durumu **İşlendi** ya da **İptal edildi**. |
| **Borç / alacak** | Her satır tek taraflıdır. Varlık ve gider hesapları borçla artar, alacakla azalır; kaynak ve gelir hesapları alacakla artar. Fişte borç toplamı = alacak toplamı. |
| **Kaynak** | Fişin dayandığı belge türü: Ön büro tahsilatı, Folyo cari aktarımı, Etkinlik tahsilatı / bedeli, Restoran tahsilatı, Spa tahsilatı, Mal kabul, Acente primi, Serbest fatura, Ön muhasebe fişi, Açılış bakiyesi, Çek / senet işlemi, Bordro tahakkuku, Maaş ödemesi, Personel avansı, Günlük gelir, Elle fiş, Ters kayıt (iptal). |
| **Kural** | "Şu kaynaktan gelen şu tür hareket hangi hesaba yazılır" tablosu. Varsayılanları Tek Düzen kodlarıyla gelir, otel değiştirebilir. |
| **Mizan** | Dönem için her hesabın devri, dönem borç ve alacak toplamı ve kalanı. Dip toplamda borç = alacak ise "dengeli". |
| **Hesap ekstresi (kebir)** | Tek hesabın fiş satırları, gün sırasıyla, yürüyen bakiyeyle. |
| **Dönem kilidi** | Bu güne (dahil) kadar elle fiş girilmez ve fiş iptal edilmez. Kapanan ayın rakamı değişmesin diye. |
| **Fişlenmemiş hareket** | Ön muhasebede yazılmış ama henüz yevmiye fişine çevrilmemiş cari / kasa hareketi. Mizan onu **içermez**; Ayarlar → Eşitle çevirir. |

### İlk açılış: hesap planı kendiliğinden yüklenir

Genel muhasebe ekranlarından biri **ilk kez** açıldığında (ya da ilk otomatik fiş yazılmak istendiğinde) sistem otele Tek Düzen Hesap Planı'nı bir kez yükler:

1. **Sınıflar, gruplar ve ana hesaplar** (1 → 10 → 100 … 9'a kadar; Muhasebe Sistemi Uygulama Genel Tebliği hesap çerçevesi, 7/A seçeneği). Bunlar **sistem hesabı**dır: kodu değişmez, silinmez; adı ve departmanı düzenlenebilir.
2. **Otelin alt hesapları** (seed):

   | Kod | Ad | Departman | Ne için |
   | --- | --- | --- | --- |
   | `120.01` | Misafir ve adisyon hesapları (folyo / POS / spa) | — | Günlük gelir fişinin borç tarafı; tahsilatlar bu hesabı alacaklandırır. Kalan = açık folyo ve adisyon alacağı. |
   | `120.02` | Acenteler | — | Acente carilerinin kontrol hesabı |
   | `120.03` | Şirket carileri | — | Şirket türündeki carilerin kontrol hesabı |
   | `120.04` | Şahıs carileri | — | Şahıs türündeki carilerin kontrol hesabı |
   | `600.01` | Oda gelirleri | Odalar | Folyodaki oda ücreti kalemleri |
   | `600.02` | Yiyecek ve içecek gelirleri | Yiyecek ve içecek | Folyoya yazılan F&B kalemleri **ve** odaya yazılmayan restoran adisyonları |
   | `600.03` | Minibar gelirleri | Yiyecek ve içecek | Minibar kalemleri |
   | `600.04` | Çamaşırhane gelirleri | Diğer | Çamaşırhane kalemleri |
   | `600.05` | Spa ve spor salonu gelirleri | Diğer | Folyodaki spa kalemleri ve spa kasasında ödenen randevular |
   | `600.06` | Organizasyon ve banket gelirleri | Yiyecek ve içecek | Etkinlik bedeli |
   | `600.09` | Diğer gelirler | Diğer | Diğer folyo kalemleri ve serbest fatura |

   Ayrıca ana hesaplardan `150`'ye Yiyecek ve içecek, `611`'e Odalar, `740`'a Diğer, `760` ve `770`'e Dağıtılmamış departmanı yazılır.
3. **Kasa / banka alt hesapları:** ön muhasebedeki her kasa `100` altında, her banka `102` altında ilk boş kodla açılır (`100.01`, `100.02`, `102.01`…). Ad = ön muhasebedeki hesap adı + para birimi: "Ön büro kasası (TRY)", "Döviz kasası (EUR)", "Ziraat TL (TRY)". Kasa / banka hesabı **sonradan** açılırsa alt hesabı da o anda açılır (süreç içi dinleyici) ve "Kasa / banka hesabı" kuralı kendiliğinden yazılır.
4. **Varsayılan kurallar** (aşağıda "Kurallar" bölümündeki tablo).

Yükleme **idempotent**tir: var olan kod atlanır, otelin değiştirdiği kural ezilmez. Ayarlar → **Tek Düzen'i tamamla** aynı işi yeniden çalıştırır ve yalnız eksikleri (ör. sonradan eklenen standart hesap, silinmiş bir varsayılan kural) tamamlar.

> Alt hesabı açılan ana hesap artık **satır almaz**: `100` Kasa'nın altında `100.01` açıldığı için fişte "100" seçilemez; "100.01" seçilir. Mizanda `100` satırı alt hesapların toplamını gösterir. Aynı şey `120` ve `600` için de geçerlidir. `770` gibi alt hesabı olmayan ana hesaplar doğrudan satır alır — otel `770.01 Elektrik` açarsa `770` satır almaz olur ve eski `770` satırları yerinde kalır (taşınmaz).

### Hesap planı sekmesi

`/genel-muhasebe/hesap-plani`: hesap ağacı. Sütunlar **Kod**, **Hesap**, **Sınıf**, **Departman** ve (yetkiliye) **İşlem**. Satırlar derinliğe göre girintili; alt hesabı olan satır daraltılıp genişletilebilir. **Ara** kutusu kod öneki ya da ad ile süzer ("77" → bütün 77'liler, "kdv" → KDV hesapları); **Yalnız etkin hesaplar** kutusu pasifleri gizler. Satırda:

- **kilit simgesi** = sistem hesabı (seed; kodu değişmez, silinmez),
- **Pasif** rozeti = etkin değil (seçicide görünmez; eski satırları ve ekstresi durur),
- **hareketli** yazısı = bu hesapta fiş satırı var (alt hesap açılamaz).
- Hesap adına tıklayınca **hesap ekstresi** açılır.

**Hesap ekle** (`ledger.setup`) → "Hesap aç" penceresi:

| Alan | Kural |
| --- | --- |
| **Hesap kodu** | Tek Düzen biçimi: `"100.01"`, `"600.02"`, `"770.01"`. Kod yazılırken altında **üst hesap** görünür: "Üst hesap: 770 Genel Yönetim Giderleri". Üst hesap yoksa "Üst hesap (770) yok — önce onu açın." uyarısı. Üst hesabın fiş satırı varsa "Üst hesabın hareketi var; alt hesap açılamaz." uyarısı. Kod otel içinde tekildir. |
| **Hesap adı** | 2–160 karakter |
| **Departman (USALI)** | Departmansız / Odalar / Yiyecek ve içecek / Diğer işletme bölümleri / Dağıtılmamış |

Kod **üst hesabı belirler**: `100.01`'in üstü `100`, `100`'ün üstü `10`, `10`'un üstü `1`. Sınıf koddan türetilir (770 → Gider; 600.09 → Gelir; 611 → Gider çünkü 61 grubu indirimdir). Üst hesap yoksa açılamaz (önce onu açın); en çok 5 seviye.

**Satırda düzenle** (`ledger.setup`): ad, departman ve **Etkin** kutusu değişir; **kod ve üst hesap değişmez** (hareket izi bozulmasın). Sistem hesabının da adı ve departmanı değiştirilebilir. Pasif hesap seçicide çıkmaz; kuralda pasif hesap duruyorsa o kaynağın fişi yazılamaz ve iş göreve düşer (aşağıda).

**Tek Düzen'i tamamla** düğmesi Ayarlar'daki ile aynı işi yapar (eksikleri tamamlar).

> **Departman neden var?** Tek Düzen gider hesapları (770 Genel Yönetim) otelin "oda bölümü mü, restoran mı kazandı" sorusuna cevap vermez. USALI (Uniform System of Accounts for the Lodging Industry) gelir ve giderleri **bölüm** bazında ister. Hesabın departmanı bu yüzden tutulur: mizan departmana süzülür; USALI gelir tablosu (modül 93) ve dış muhasebe aktarımı (96) bu alandan beslenecektir. Gelir alt hesapları hazır departmanla gelir; gider hesabı açarken departmanı siz seçersiniz (ör. `770.02 Mutfak gazı` → Yiyecek ve içecek).

**Örnek: KDV oranına göre ayrı indirilecek KDV hesabı.** Muhasebeci `192.10 İndirilecek KDV %10` ve `192.20 İndirilecek KDV %20` hesaplarını açar (üst hesap `192 Diğer KDV` seed'de vardır; alt hesap açıldığı için `192` satır almaz olur). Sonra Kurallar → "İndirilecek KDV" kartında oran `20` → `192.20`, boş anahtar ("Bütün oranlar") → `192.10` seçer. Bir sonraki mal kabulde 10.000,00 TL mal, 700,00 TL %10 KDV, 600,00 TL %20 KDV için fiş: `150` 10.000,00 borç, `192.10` 700,00 borç, `192.20` 600,00 borç / `320` 11.300,00 alacak. Kural değişmeden önce yazılmış fişler değişmez.

### Yevmiye sekmesi

`/genel-muhasebe/yevmiye`: fiş listesi, en yeni üstte, sayfalı (50 satır). Süzgeçler: **Ara** (fiş no, açıklama, belge no), **Başlangıç / Bitiş**, **Tür** (Otomatik / Elle), **Durum** (İşlendi / İptal edildi), **Kaynak** (yukarıdaki kaynak listesi), **Hesap** (hesap seçici: o hesapta satırı olan fişler — asıl ve ters kayıt birlikte). Sütunlar: fiş no, gün, kaynak, açıklama, tutar (borç toplamı), durum. Satıra tıklayınca fiş sayfası.

Liste boşsa ekran söyler: "Ön muhasebe hareketleri ve gün kapanışı kendiliğinden fiş olur; elle fiş 'Fiş gir' ile açılır. Fişlenmemiş hareket için Ayarlar → Eşitle."

#### Fiş sayfası

`/genel-muhasebe/yevmiye/:journalId`:

| Alan | Ne gösterir |
| --- | --- |
| Başlık | Fiş no ve türü ("YEV-2026-00042 · Otomatik"), durum rozeti, gün, kaynak etiketi (ör. "Mal kabul"), belge no |
| Kaynak bağlantısı | Otomatik fişte kaynağın ekranı: ön muhasebe fişi (`/muhasebe/fisler/:id`), cari kartı, mal kabul ekranı… Bilinen yolu olmayan kaynakta yalnız etiket. Günlük gelir fişinde kaynak = gün. |
| İptal edildi kutusu | İptal edilmiş fişte: kim, ne zaman, sebep ve **ters fişe** bağlantı |
| Ters kayıt kutusu | Ters fişte: hangi fişi iptal ettiği, **asıl fişe** bağlantı |
| Satırlar | **Hesap** (kod + ad; ekstreye bağlantı), **Açıklama**, **Cari / kasa** (satırın izi: hangi cari, hangi kasa / banka — tek cari ise), **Borç**, **Alacak**; altta toplam |
| İptal et | `ledger.setup`; yalnız "İşlendi" durumundaki fişte |

#### Elle fiş girişi — adım adım

1. Yevmiye → **Fiş gir** (`ledger.manage`). "Yevmiye fişi gir" penceresi açılır; pencere açılırken bir **istek kimliği** üretilir (çift gönderim koruması).
2. **Fiş günü:** varsayılan bugün; bugünden ileri olamaz, muhasebe başlangıç gününden önce olamaz, **dönem kilidi** içindeki güne yazılamaz, en fazla 400 gün geriye.
3. **Açıklama** (zorunlu, en az 3 karakter) ve **Belge no** (isteğe bağlı; fiş listesinde aranır).
4. **Satırlar:** en az iki satır (silme düğmesi ikiden aşağı inmez), en çok 200. Her satırda **hesap** (seçici yalnız **yaprak ve etkin** hesapları listeler; kod öneki ya da ad ile arar; boş aramada en çok kullanılan hesaplar önce gelir, en çok 30 sonuç), **Borç** ya da **Alacak** (biri dolunca öteki temizlenir — satır tek taraflıdır), **Satır açıklaması**.
5. Üstte canlı **Borç / Alacak / Fark**: fark sıfır ve toplam sıfırdan büyükse "Dengeli" yeşil görünür; değilse fark kırmızı ve **Kaydet kapalıdır**. Borç = alacak kuralı pencerede, sözleşmede ve sunucuda üç kez denetlenir.
6. **Kaydet.** Fiş `YEV-YYYY-NNNNN` numarasını alır, "işlendi" olur, Yevmiye listesine ve mizana düşer. Aynı pencere ağ hatasından sonra ikinci kez gönderilirse sunucu aynı istek kimliğini tanır: "Bu fiş zaten kaydedilmişti; ikinci kez yazılmadı" — iki fiş oluşmaz.

Sunucu ayrıca satırdaki hesabın yaprak ve etkin olduğunu denetler: ana hesap (ör. `100`) seçilirse 409 ile reddedilir.

**Örnek: kırtasiye alımı, kasadan 250,00 TL.**

| Hesap | Açıklama | Borç | Alacak |
| --- | --- | --- | --- |
| `770` Genel Yönetim Giderleri | Kalem, kağıt | 250,00 | |
| `100.01` Ön büro kasası (TRY) | | | 250,00 |

Bu fişten sonra `100.01` ekstresinde −250,00 (alacak bakiyesi yönünde) bir satır görünür. Aynı gün elle "Kasa fazlası" fişiyle `100.01` borç 1.000,00 / `679 Diğer Olağandışı Gelir ve Kârlar` alacak 1.000,00 yazılırsa hesabın dönem kapanışı 750,00 borç olur.

> Kasa hareketini normalde **ön muhasebeden** girmelisiniz (Kasa / banka → Çıkış, "Karşı hesap" alanında 770). Böylece hem kasa bakiyesi hem yevmiye tek işlemde doğru olur. Elle yevmiye fişi kasayı ön muhasebede **değiştirmez**; yalnız genel muhasebeyi etkiler. Elle fişi ön muhasebede karşılığı olmayan işler için saklayın.

#### İptal = ters kayıt; fiş silinmez

**İptal et** (`ledger.setup`) → "YEV-… iptali" penceresi: **Ters kaydın günü** (varsayılan bugün; fişin gününden önce ve bugünden sonra olamaz, kilitli dönemde olamaz) ve **İptal sebebi** (zorunlu). Kaydedince:

- Asıl fişin durumu **İptal edildi** olur; satırları, numarası, günü **değişmez** (silinmez).
- Seçilen günde yeni bir fiş yazılır: kaynak **Ters kayıt (iptal)**, bütün satırlar **borç ↔ alacak** çevrilmiş, açıklaması "İptal: YEV-… <asıl açıklama> — <sebep>", belge no aynı, cari / kasa izi aynı. İki fiş birbirine bağlıdır.
- Mizanda ikisi de sayılır: dönem borç ve alacak toplamı artar, kalan sıfırlanır. Böylece iz kalır, geçmiş rapor değişmez.

Kısıtlar: iptal edilmiş fiş ikinci kez iptal edilemez; **ters kayıt fişi iptal edilemez** (gerekirse yeni bir elle fiş); dönem kilidi içindeki fiş kilidi açmadan iptal edilemez; fişi başkası bu arada değiştirdiyse "yenileyip tekrar deneyin".

> **Otomatik fişi iptal ettiğinizde kaynak kayıtlar fişli kalır:** ön muhasebedeki o hareket yeniden fişlenmez (Eşitle onu "fişlenmemiş" saymaz). Yanlış hesaba giden otomatik fişi düzeltmenin yolu: **kuralı düzeltin** (bundan sonrakiler doğru gider), yanlış fişi **iptal edin**, doğru satırlarla **elle fiş** girin. Ön muhasebe fişini iptal ederseniz muhasebe aktörü zaten ayrı bir ters fiş yazar; yevmiye fişini ayrıca iptal etmeyin.

### Mizan sekmesi

`/genel-muhasebe/mizan`: dönem için hesap ağacı. Varsayılan dönem ay başından bugüne. Süzgeçler: **Başlangıç / Bitiş**, **Departman** (Bütün departmanlar / Odalar / Yiyecek ve içecek / Diğer / Dağıtılmamış — eşleşen hesaplar ve üstleri kalır), **Yalnız hareketliler** (varsayılan açık: devri ya da dönem hareketi olmayan hesap gizlenir).

Sütunlar:

| Sütun | Anlamı |
| --- | --- |
| **Kod**, **Hesap** | Ağaç; üst hesap kalın, daraltılabilir |
| **Devir** | Dönem başından **önceki** bütün fişlerin borç − alacak farkı; (B) borç, (A) alacak bakiyesi olarak gösterilir |
| **Borç**, **Alacak** | Dönem içindeki fiş satırlarının toplamı |
| **Borç kalanı** / **Alacak kalanı** | Devir + borç − alacak; artıysa borç kalanı, eksiyse alacak kalanı sütununda |
| Dip toplam | Bütün yaprak hesapların toplamı |

Üst hesap satırı **alt hesaplarının toplamıdır**: `600` satırı 600.01–600.09'un toplamını, `6` satırı bütün gelir tablosu hesaplarını gösterir. Hesap satırına tıklayınca o hesabın **ekstresi** aynı dönemle açılır.

Üstte iki gösterge:

- **"Mizan dengeli" / "Mizan dengesiz"** rozeti: dip toplamda borç = alacak ise dengeli. Her fiş dengeli yazıldığı için mizan dengesiz çıkması bir veri sorununa işaret eder; normal işletimde görülmez.
- **"Fişlenmemiş hareket var"** uyarısı: ön muhasebede yevmiyeye çevrilmemiş cari / kasa hareketi sayısı ve Ayarlar → Eşitle bağlantısı. Bu kayıtlar mizanda **yoktur**; Eşitle çalıştırılınca eklenir. Ay sonu mizanı almadan önce bu uyarının kapanmış olması gerekir.

İptal edilen fiş ve ters kaydı ikisi de sayılır (iz kalır, net sıfır).

**Örnek (testteki rakamlar):** Gün kapanışında 2.200,00 TL'lik folyo kalemi (KDV %10 dahil) ve sonra 1.100,00 TL minibar kalemi için iki gelir fişi yazıldı, tahsilat yok. Mizan: `120.01` borç kalanı **3.300,00**; `600.09` alacak 2.000,00, `600.03` alacak 1.000,00, `600` satırı alacak kalanı **3.000,00**, `6` satırı 3.000,00; `391` alacak kalanı **300,00**. Dip toplam borç 3.300,00 = alacak 3.300,00 → dengeli.

### Hesap ekstresi (kebir)

`/genel-muhasebe/hesaplar/:accountId` (mizandan ya da hesap planından hesap adına tıklayınca). Başlıkta kod, ad, sınıf ve departman. Dönem seçimi; ilk satır **devir** (dönem başı bakiyesi). Sütunlar: **Gün**, **Fiş** (fiş sayfasına bağlantı), **Hesap** (yalnız üst hesapta: satır hangi alt hesabın), **Açıklama**, **Cari / kasa** (iz), **Borç**, **Alacak**, **Bakiye** (yürüyen: devir + borç − alacak; (B) / (A)). İptal edilmiş fişin satırı gri ve "İptal edildi" rozetli. Altta dönem toplamı ve kapanış; uzun ekstrede **Daha fazla göster** (50'şer).

Üst hesabın ekstresi alt hesaplarının satırlarını birlikte listeler (`100` ekstresi 100.01 ve 100.02 hareketlerini gün sırasıyla gösterir).

**Örnek:** `100.01` ekstresi, dönem son 7 gün, devir 0,00: 1. satır "Kırtasiye alımı" alacak 250,00 → bakiye −250,00 (A); 2. satır "Kasa fazlası" borç 1.000,00 → bakiye 750,00 (B); dönem kapanışı 750,00.

### Kurallar sekmesi

`/genel-muhasebe/kurallar` (`ledger.view` görür, `ledger.setup` yazar). Kaynak gruplarına göre **kartlar**; her kartın başlığı kaynağın adı, açıklaması ne zaman kullanıldığı. Her satır: **anahtar** (hangi durum), **hesap** seçici, "varsayılan: 600.01" ipucu ve **varsayılan** rozeti (otel kural yazmamış, seed geçerli), **sil** (otel kuralı silinir → varsayılana döner). Hesabı olmayan ve varsayılanı da olmayan satırda uyarı: "Hesap yok: bu kaynağın işi 'Ön muhasebe' görevine düşer." Tek **Kaydet** bütün satırları gönderir; hesap yaprak ve etkin olmalıdır. Kural değişince **yalnız yeni fişler** etkilenir; yazılmış fiş değişmez.

Anahtar türleri:

| Tür | Kart | Anahtar nasıl girilir |
| --- | --- | --- |
| Sabit liste | Cari türünün kontrol hesabı, Gelir hesabı, Bordro yükümlülükleri, Çek / senet hesabı | Satırlar hazır gelir (Acente, Tedarikçi…; Oda geliri, Minibar…), yalnız hesap seçilir |
| Kasa / banka | Kasa / banka hesabı | Ön muhasebedeki her kasa / banka bir satır; hesap kendiliğinden açılmıştır, istenirse değiştirilir |
| Oran | Hesaplanan KDV, İndirilecek KDV | "Bütün oranlar" satırı + **Oran ekle** ("10", "20", "1" gibi); oran satırı yoksa bütün oranlar satırı kullanılır |
| Departman | Personel gideri (departman) | Bordro departmanları satır satır + "Diğer" (departmansız / belirsiz) |
| Belirli cari | Belirli carinin hesabı | **Cari ekle** ile cari seçilir, sonra hesabı (türün hesabının üstüne yazar; ör. SGK carisi → 361) |
| Anahtar yok | Misafir ve adisyon alacakları, Stok, Acente prim gideri, Carisiz giriş / çıkış karşı hesabı, Açılış, Kur farkı | Tek satır |

**Varsayılan kurallar** (seed; kaynak → ne zaman → hesap):

| Kaynak | Anahtar / ne zaman | Varsayılan hesap |
| --- | --- | --- |
| Kasa / banka hesabı | Her kasa / banka hareketi (giriş borç, çıkış alacak) | `100.xx` kasa, `102.xx` banka (hesap açılışında kendiliğinden) |
| Cari türünün kontrol hesabı | Acente | `120.02` |
| | Şirket | `120.03` |
| | Şahıs | `120.04` |
| | Diğer | `136` Diğer Çeşitli Alacaklar |
| | Tedarikçi | `320` Satıcılar |
| | Personel | `335` Personele Borçlar |
| Belirli carinin hesabı | Yalnız otel yazarsa (ör. SGK carisi → `361`) | — |
| Misafir ve adisyon alacakları | Günlük gelir fişinin borcu; ön büro / restoran / spa tahsilatı ve folyonun cariye aktarımı alacaklandırır | `120.01` |
| Gelir hesabı | Oda geliri | `600.01` |
| | Yiyecek içecek (folyoya yazılan) ve Restoran adisyonları (odaya yazılmayan) | `600.02` |
| | Minibar | `600.03` |
| | Çamaşırhane | `600.04` |
| | Spa ve spor salonu | `600.05` |
| | Etkinlik / banket bedeli | `600.06` |
| | Diğer folyo kalemleri ve Serbest fatura | `600.09` |
| | İndirim kalemleri | `611` Satış İskontoları (−) |
| | Folyodaki vergi kalemleri (konaklama vergisi vb.) | `360` Ödenecek Vergi ve Fonlar |
| Hesaplanan KDV | Bütün oranlar (oran satırı eklenebilir) | `391` |
| İndirilecek KDV | Bütün oranlar (oran satırı eklenebilir) | `191` |
| Satın alınan malzeme (stok) | Mal kabulün KDV hariç tutarı | `150` İlk Madde ve Malzeme |
| Acente prim gideri | Onaylanan prim hak edişi | `760` Pazarlama Satış ve Dağıtım Giderleri |
| Personel gideri (departman) | Bordro tahakkukunda işveren maliyeti; departman satırı yoksa "Diğer" | `770` |
| Bordro yükümlülükleri | SGK primleri | `361` Ödenecek Sosyal Güvenlik Kesintileri |
| | Gelir ve damga vergisi | `360` |
| | BES katkı payı | `369` Ödenecek Diğer Yükümlülükler |
| | İcra / nafaka kesintisi | `336` Diğer Çeşitli Borçlar |
| Çek / senet hesabı | Alınan çekler | `101` |
| | Verilen çekler | `103` |
| | Alınan senetler | `121` |
| | Verilen senetler | `321` |
| Carisiz kasa / banka girişinin karşı hesabı | Giriş fişinde hesap seçilmemişse | `649` Diğer Olağan Gelir ve Kârlar |
| Carisiz kasa / banka çıkışının karşı hesabı | Çıkış fişinde hesap seçilmemişse | `770` |
| Açılış bakiyesi karşı hesabı | Cari / kasa / banka açılış fişleri | `500` Sermaye |
| Kur / yuvarlama farkı (kâr) | Fiş fazla alacaklı kalırsa | `646` Kambiyo Kârları |
| Kur / yuvarlama farkı (zarar) | Fiş fazla borçlu kalırsa | `656` Kambiyo Zararları |

**Varsayılana dön:** satırdaki sil düğmesi otelin kuralını siler; satır "varsayılan" rozetiyle seed hesabına döner. Varsayılanı olmayan satır (ör. eklenen bir oran) silinince tamamen kalkar ve o oran "Bütün oranlar" satırına düşer.

### Ayarlar sekmesi

`/genel-muhasebe/ayarlar`. Üstte iki sayaç: **Fişlenmemiş cari hareketi** ve **Fişlenmemiş kasa / banka hareketi** (sıfır değilse sarı). Üç kart:

**Dönem kilidi** (`ledger.setup`): **Kilit günü (dahil)**; boş = kilit yok. En geç dünü kapsar (bugün kilitlenemez: kilitli güne düşen otomatik fiş kilit sonrasındaki ilk güne, en geç bugüne yazılır). Etkileri:

- Kilit gününe kadar (dahil) **elle fiş girilemez** ("Dönem … gününe kadar kilitli").
- Kilitli dönemdeki fiş **iptal edilemez**; ters kayıt da kilitli güne yazılamaz.
- Otomatik fiş kilitli güne ait bir belge için gelirse **kilit sonrasındaki ilk güne** yazılır ve açıklamasına not düşer: "(kilitli dönem 03.11.2026, 01.12.2026 gününe yazıldı)". Hiçbir belge fişsiz kalmaz; yalnız günü kayar.
- Kilit geri alınabilir (gün boşaltılır ya da geri çekilir); sürüm damgalıdır.

**Eşitle** (`ledger.manage`): **Başlangıç / Bitiş** (en fazla 400 gün; muhasebe başlangıcından önce başlayamaz, bugünü geçemez) → dönemdeki **fişlenmemiş** cari ve kasa / banka hareketlerinin belgelerini fişler ve dönemdeki **kapanmış günlerin** gelir fişini (yeniden) hesaplar. Sonuç kutusu: **İşlendi**, **Atlandı** (zaten güncel: gelir fişi değişmemiş, fişlenecek hareket yok), **Hata**, **Kalan**; altında **İşlenemeyen belgeler** listesi (aynı hata tek satırda sayılır, en çok 25 ayrı mesaj). Eşitleme en çok **20 saniye** çalışır ve kalan sayısını söyler; yeniden çalıştırınca kaldığı yerden sürer. Fişlenmiş kayıt **ikinci kez yazılmaz**.

**Hesap planı**: yükleme günü (`glChartSeededAt`) ve **Tek Düzen'i tamamla** düğmesi. Hesap planı hiç yüklenmemişse sarı uyarı: otomatik fiş yazılamaz.

### Otomatik fiş nasıl oluşur — adım adım

Muhasebe aktörü (panelde "Muhasebe aktörü", 47 ile aynı aktör) iki olayı daha dinler:

1. **Ön muhasebe kaydı yazıldı** (`accounting.posted`, kaynak belge kimliği `sourceId` ile). Aktör 47'de kendi yazdığı kayıtlar için de bu olayı yayınlar ve kendisi dinler. Akış:
   - Belgenin (ödeme, fiş, mal kabul, bordro, çek işlemi…) **henüz fişlenmemiş** cari ve kasa / banka kayıtları kilitlenir (aynı anda iki çağrı sıralanır; ikincisi fişlenecek kayıt bulmaz).
   - Kayıtlar **belgeye göre gruplanır**: bir ön muhasebe fişinin bütün satırları tek yevmiye fişi; ters kayıtlar asıl belgeden **ayrı** fiş; çek / senet hareketleri işlem bazında ayrı fiş.
   - **Kasa / banka hareketi** → hesabın `100.xx` / `102.xx` hesabına: giriş borç, çıkış alacak. Hesabın para birimi otelinkinden farklıysa tutar çevrilir: ön büro ödemesinde ödeme kaydındaki **folyo karşılığı** (kesin kur), diğerlerinde hareket gününün (ya da öncesindeki son) **günün kuru**; kur yoksa iş hatası ("… için … kuru yok: Kasa → Kurlar ekranından girin").
   - **Cari hareketi** → carinin kontrol hesabına: bordro yükümlülüğü ise "Bordro yükümlülükleri" kuralı (SGK → 361…), cariye özel kural varsa o, yoksa **cari türünün** hesabı (acente 120.02, tedarikçi 320…). Borç borç, alacak alacak olarak aynen.
   - Bu kadarıyla fiş genelde **dengesiz** kalır (ör. mal kabulde yalnız tedarikçi alacağı var). Kalan fark kaynağa göre **karşı tarafa** bölünür ("tamamlayıcı"): folyo ödemesi / cari aktarımı / restoran / spa tahsilatı → `120.01`; mal kabul → stok (KDV hariç) + indirilecek KDV (oran bazında); etkinlik bedeli → etkinlik geliri + hesaplanan KDV (etkinlik vergi dökümüyle); acente primi → prim gideri; serbest fatura → gelir + KDV (fatura vergileri); carisiz giriş / çıkış fişi → fişte seçilen "Karşı hesap" ya da kural; açılış → 500; bordro → personel gideri departman ağırlıklarıyla (işveren maliyeti). Etkinlik tahsilatı, maaş ödemesi, virman gibi belgelerde kayıtlar kendi aralarında dengelidir, karşı taraf yoktur.
   - Kuruş yuvarlaması ya da kur farkından **kalan** varsa `646` / `656`'ya.
   - Satırlar hesap bazında toplanır (aynı hesapta tek cari varsa izi kalır); fiş günü = belge günü (kilitliyse kilit + 1); açıklama = kaynak etiketi + belgenin açıklaması; numara `YEV-…`; fiş **işlendi**.
   - Kaynak kayıtların `journalEntryId` alanı dolar: **aynı kayıt ikinci kez fişlenmez**. Olay yeniden gelse, aktör kapanıp açılsa, Eşitle çalıştırılsa bile.
   - `ledger.changed` yayınlanır → açık Yevmiye / Mizan ekranları tazelenir.
2. **Gün kapandı** (`night.audit.closed`, iş günü `businessDay` ile) → **günlük gelir fişi** (aşağıda).

**Kural ya da hesap sorunu varsa:** kuralın hesabı yok, hesap pasif ya da ana hesap, kur yok, fiş tek satıra iniyor (kaynak kayıtlar birbirini götürüyor) → bu **iş kuralı hatası**dır, beklemekle düzelmez: aktör yeniden denemez, iş **"Ön muhasebe"** modüllü manuel göreve düşer: "Ön muhasebe kaydı (FOLIO_PAYMENT) yevmiye fişine çevrilecek: kuralı / hesabı düzeltip Genel muhasebe → Ayarlar → Eşitle". Görevin açıklamasında sebep yazar (ör. "120.01 … satır alamaz (pasif …)"). Muhasebeci kuralı / hesabı düzeltir, **Eşitle** çalıştırır, görevi kapatır. Geçici hata (veritabanı) 3 kez 400 ms arayla denenir. Aktör kapalıysa aynı görev düşer; ön muhasebe kaydı yine yazılmıştır (47), yalnız yevmiye fişi beklemektedir.

> Ön muhasebe aktörü kapalıyken 47'nin kayıtları da yazılmaz; Ön muhasebe → Eşitle onları yazar ve her yazılan belge için `accounting.posted` yayınlar → yevmiye fişleri de o anda oluşur (aktör açıksa). Aktör hâlâ kapalıysa Genel muhasebe → Ayarlar → Eşitle gerekir.

### Günlük gelir fişi

Tahsilat fişleri `120.01`'i alacaklandırır; gelirin kendisi (oda ücreti, restoran satışı) ön muhasebede yoktur. Gelir, **gün kapanışında** tek fişle yazılır (kaynak "Günlük gelir", belge = gün):

| Ne | Nasıl bulunur | Nereye |
| --- | --- | --- |
| **Folyo kalemleri** | Hizmet günü = kapanan gün olan kalemler, türüne göre **KDV hariç** net toplamı | Türün gelir hesabına alacak (oda → 600.01, F&B → 600.02, minibar → 600.03, çamaşır → 600.04, spa → 600.05, diğer → 600.09; indirim → 611; folyodaki vergi kalemi → 360) |
| Folyo kalemlerinin **vergi dökümü** | Kalemlerin vergi satırları **oran bazında** toplanır | Hesaplanan KDV'ye alacak (oran satırı varsa `391.xx`, yoksa 391) |
| **Kapanan adisyonlar** | İş günü = kapanan gün olan kapalı adisyonların genel toplamı **− odaya yazılan pay** (o pay folyo kaleminde zaten var); net / vergi oranıyla bölünür | Restoran geliri (600.02) + hesaplanan KDV |
| **Spa randevuları** | Günde tamamlanan (ya da bedeli kesinleşen iptal / gelmedi) randevuların bedeli **− odaya yazılan pay** | Spa geliri (600.05) + hesaplanan KDV |
| Toplam (KDV dahil) | Yukarıdakilerin brüt toplamı | **`120.01` Misafir ve adisyon hesapları — borç** |

Böylece `120.01` iki yönden beslenir: günlük gelir fişi **borç** (misafir borçlandı), tahsilatlar **alacak** (misafir ödedi). Gün sonunda bu hesabın kalanı = **tahsil edilmemiş folyo ve adisyon alacağı**. Folyo cariye aktarıldığında (acente ödeyecek) 120.01 alacak / 120.02 borç olur: alacak misafirden acenteye geçer.

**Yeniden çalıştırma yalnız farkı yazar.** Her gün için "hedef" (bugün hesaplanan hesap toplamları) ile "yazılmış" (o güne ait gelir fişleri, iptal ve ters kayıtları dahil) karşılaştırılır; fark yoksa fiş yazılmaz ("gelir fişi güncel"), fark varsa yalnız fark **"(düzeltme)"** notlu ikinci fişle yazılır. Kapanmış güne sonradan geç kalem işlendiğinde (çıkmış misafire minibar) ya da adisyon yeniden açılıp kapandığında Eşitle dönemi tarar ve farkı yazar. Muhasebe başlangıcından önceki gün atlanır; kilitli güne ait fiş kilit sonrası ilk güne düşer.

**Örnek (testteki rakamlar):** 25 Kasım günü bir folyoda 2.200,00 TL'lik kalem var (KDV %10 dahil: net 2.000,00 + KDV 200,00; tür "Diğer"). Gün kapanır:

| Hesap | Borç | Alacak |
| --- | --- | --- |
| `120.01` Misafir ve adisyon hesapları | 2.200,00 | |
| `600.09` Diğer gelirler | | 2.000,00 |
| `391` Hesaplanan KDV | | 200,00 |

Ertesi gün aynı güne 1.100,00 TL minibar kalemi (hizmet günü 25 Kasım) işlenir; Eşitle (ya da gün yeniden hesaplanır) → yalnız fark: "Günlük gelir fişi 25.11.2026 (düzeltme)": `120.01` 1.100,00 borç / `600.03` 1.000,00 alacak / `391` 100,00 alacak. Üçüncü çalıştırma hiçbir şey yazmaz.

### Örnek fişler

Aşağıdaki fişler entegrasyon testlerinden alınmıştır; varsayılan kurallarla, otel parası TRY. "Ön büro kasası" = `100.01`, "Döviz kasası (EUR)" = `100.02`, "Ziraat TL" = `102.01`.

| # | Belge | Borç | Alacak |
| --- | --- | --- | --- |
| 1 | Folyoya **1.000,00 TL nakit** tahsilat (Ön büro tahsilatı) | `100.01` 1.000,00 | `120.01` 1.000,00 |
| 2 | Folyo **"Acente / cari"** ile kapatıldı, 4.000,00 TL acenteye aktarıldı (Folyo cari aktarımı) | `120.02` 4.000,00 | `120.01` 4.000,00 |
| 3 | Folyoya **50 EUR nakit**, folyo karşılığı 1.825,00 TL (kur 36,50) → döviz kasası | `100.02` 1.825,00 | `120.01` 1.825,00 |
| 4 | Ön muhasebe **tahsilat fişi**: şirket carisinden 3.000,00 nakit + 5.000,00 **alınan çek** (Ön muhasebe fişi) | `100.01` 3.000,00; `101` 5.000,00 | `120.03` 8.000,00 |
| 5 | Çek **tahsil edildi** (bankaya) (Çek / senet işlemi) | `102.01` 5.000,00 | `101` 5.000,00 |
| 6 | **Carisiz kasa çıkışı** 750,00 TL "Elektrik faturası", fişte karşı hesap `770.01 Elektrik` seçildi | `770.01` 750,00 | `100.01` 750,00 |
| 7 | **Carisiz kasa girişi** 120,00 TL "Banka faizi", karşı hesap seçilmedi → kural 649 | `100.01` 120,00 | `649` 120,00 |
| 8 | 7 numaralı ön muhasebe fişi **iptal edildi** → ters kayıt fişi (asıl yevmiye fişi "işlendi" kalır) | `649` 120,00 | `100.01` 120,00 |
| 9 | **Mal kabul** 10.000,00 TL mal + 1.300,00 TL KDV (700,00 %10, 600,00 %20), oran kuralı yok | `150` 10.000,00; `191` 1.300,00 | `320` 11.300,00 |
| 10 | Aynı mal kabul, `192.10` / `192.20` oran kuralları yazılmış | `150` 10.000,00; `192.10` 700,00; `192.20` 600,00 | `320` 11.300,00 |
| 11 | **Günlük gelir fişi**: folyo kalemleri 2.200,00 (KDV %10 dahil, tür diğer) | `120.01` 2.200,00 | `600.09` 2.000,00; `391` 200,00 |
| 12 | Günlük gelir **düzeltme** fişi: sonradan eklenen 1.100,00 minibar | `120.01` 1.100,00 | `600.03` 1.000,00; `391` 100,00 |
| 13 | **Elle fiş** "Kırtasiye alımı", belge no FİŞ-1 | `770` 250,00 | `100.01` 250,00 |
| 14 | 13 numaralı fişin **iptali** (ters kayıt, sebep "Yanlış hesap") | `100.01` 250,00 | `770` 250,00 |
| 15 | **Bordro tahakkuku** (yapı; rakamlar örnek): işveren maliyeti 100.000,00; net ücret 60.000,00; SGK 28.000,00; GV + DV 9.000,00; BES 2.000,00; icra 1.000,00 | `770` 100.000,00 (departman kuralı varsa departman hesaplarına bölünür) | `335` 60.000,00; `361` 28.000,00; `360` 9.000,00; `369` 2.000,00; `336` 1.000,00 |
| 16 | **Maaş ödemesi** bankadan (yapı): personel carileri kapanır | `335` 60.000,00 | `102.01` 60.000,00 |
| 17 | **Açılış bakiyesi**: kasa devri 15.000,00 | `100.01` 15.000,00 | `500` 15.000,00 |

Okuma kuralı: varlık hesapları (100, 102, 120, 150, 191) borçla **artar**; borç hesapları (320, 335, 360, 361, 391) ve gelirler (600, 649) alacakla **artar**; giderler (770, 760) borçla artar. 2 numaralı fişte para yok, alacak misafirden acenteye taşınmıştır. 8 ve 14 numaralı fişler aynı iş olsa da farklı yoldan doğar: 8'i ön muhasebe iptali üretti (kaynak "Ön muhasebe fişi — ters kayıt"), 14'ü yevmiye iptali (kaynak "Ters kayıt (iptal)").

### Dikkat edilecekler ve sık hatalar

- **"Üst hesap (…) yok — önce onu açın."** Kod yazdığınız yerin üstü hesap planında yok. Üst hesap seed'de yoksa (ör. `600.02.1` için `600.02` var ama `650.01` için `650` yok) önce üst hesabı açın ya da Ayarlar → Tek Düzen'i tamamla.
- **"Üst hesabın hareketi var; alt hesap açılamaz."** Satır almış hesabın altı açılmaz; satırlar alt hesaba taşınmaz. Yeni kırılımı başka bir ana hesapta ya da bir sonraki dönemde yeni hesapla kurun. Örnek: `770`'e aylarca satır yazıldıysa `770.01` açılamaz; `771`-benzeri boş bir ana hesap kullanın ya da gider kırılımını departman alanıyla izleyin.
- **"… satır alamaz (pasif ya da ana hesap)"**: fişte ya da kuralda ana hesap / pasif hesap seçilmiş. Yaprak ve etkin hesap seçin.
- **"Borç ve alacak toplamı eşit olmalı (fark …)"**: Kaydet zaten kapalıdır; satırları denetleyin. Aynı satırda iki taraf doldurulamaz.
- **"Dönem … gününe kadar kilitli"**: Ayarlar → Dönem kilidi'ni ileri almadan o güne fiş girilemez / iptal edilemez. Kapanmış aya düzeltme gerekiyorsa muhasebe uygulaması "cari ayda düzeltme fişi"dir: fişi bugünün tarihiyle girin.
- **Mizan dengesiz görünüyor**: mizan her zaman dengeli yazılır; "Fişlenmemiş hareket var" uyarısı denge sorunu değil, eksiklik uyarısıdır (o kayıtlar mizanda yok). Eşitle çalıştırın. Rozet gerçekten "dengesiz" diyorsa Yevmiye'de aynı günün fişlerini inceleyin ve teknik ekibe bildirin.
- **"Fişlenecek hareket yok" / "gelir fişi güncel"** (Eşitle "Atlandı" sayar): sorun değil; belge zaten fişli ya da günün geliri değişmemiş.
- **Kur yok**: döviz kasasındaki hareketin günü için kur girilmemiş (ön büro ödemesi dışında). Kasa → Döviz kurları'ndan o günün kurunu girip Eşitle.
- **Kasa / banka hesabı açtım, hesap planında nerede?** `100` (kasa) ya da `102` (banka) altında ilk boş alt kodla, adı ön muhasebedeki adı + para birimi. Kurallar → "Kasa / banka hesabı" kartında hangi hesaba bağlı olduğunu görür, değiştirirsiniz.
- **Açılış bakiyeleri 500 Sermaye'ye gidiyor**: ön muhasebe açılış fişlerinin karşı hesabı varsayılan kuralla `500`'dür (devir rakamları bilançodan gelir). Gerçek açılış bilançosu için Kurallar → "Açılış bakiyesi karşı hesabı"nı değiştirin (ör. `570 Geçmiş Yıllar Kârları` ya da geçiş için bir `9xx` nazım hesabı) ya da açılış sonrası elle düzeltme fişiyle sermaye / geçmiş yıl kârı dağılımını yazın.
- **Otomatik fişi iptal ettim ama Eşitle yeniden yazmadı**: beklenen davranış; kaynak kayıt fişli kalır. Doğru fişi elle girin.
- **Ön muhasebe fişini iptal ettim, yevmiyede iki fiş var**: doğru; asıl fiş "işlendi" kalır, ters kayıt ayrı fiştir. Net sıfır.
- **Amortisman, tahakkuk, reeskont, dönem kapanış fişleri** otomatik yazılmaz; elle fiş girilir (Demirbaş → Amortisman tablosundaki yıllık payı `770` / `257` ile).
- **e-Defter** (yevmiye / kebir XML) henüz üretilmez; yevmiye listesi ve ekstreler müşavire veri kaynağıdır.

## Personel ve bordro

### Ne işe yarar

Personel kartları, aylık puantaj, ek ödeme / kesinti kalemleri, servis payı dağıtımı, bordro hesabı (brüt → net; SGK, gelir ve damga vergisi, istisnalar, teşvikler), dört gözlü onay, maaş ödemesi ve çıktılar (bordro listesi, pusula, departman icmali, banka dosyası, müşavir tablosu). Onaylanan bordro ön muhasebeye kendiliğinden düşer. İK tarafı (izin, vardiya, özlük belgesi) bu modülde **yoktur**; 52. modül yol haritasındadır.

### Nerede bulunur

- **Personel** (`/personel`): liste ve kart (`/personel/:id`).
- **Bordro** (`/bordro`): Bordrolar, Puantaj ve kalemler (`/bordro/puantaj`), Servis payı (`/bordro/servis-payi`), Ayarlar (`/bordro/ayarlar`); bordro ekranı `/bordro/:id`.

### Personel kartı

**Liste:** ad, sicil ya da T.C. kimlik no ile arama; departman ve durum (çalışan / çıkmış) süzgeci. **Ücret sütunu yalnız bordro görüntüleme izniyle gelir** (sunucu göndermez); kimlik numarası izne göre maskelidir.

**Yeni personel / düzenle** (`employees.manage`): kimlik (ad, T.C. kimlik, doğum), iş (sicil, departman, pozisyon, işe giriş, sektör / teşvik durumu, engellilik), **ücret** (`payroll.manage` ister): ücret türü **brüt ya da net anlaşmalı** (net anlaşmada sistem en küçük brütü ikili aramayla bulur), tutar, ödeme yöntemi (banka → IBAN / elden), BES.

Kart ekranındaki kutular (hepsi sözleşme şemasıyla doğrulanır, alan hataları alanın altında görünür):

- **Teşvikler:** çalışan bazında teşvik türü ve dönemi.
- **Avanslar:** tutar, taksit; avans ödendiği gün personel carisine borç yazılır, bordro onayında mahsup edilir.
- **İcra / nafaka:** dosya, tutar / oran, sıra; kesinti sırası BES → nafaka → icra (ilk dosya, netin dörtte biri) → avans → diğer.
- **Matrah devri:** yıl içinde başka işyerinden gelen personelin birikmiş gelir vergisi matrahı ve asgari ücret istisnası.
- **İşten çıkış:** tarih ve sebep seçilir, **önizleme** kıdem, ihbar (ya da ihbar kesintisi), kullanılmayan izin ücreti kalemlerini gösterir; kaydedince kalemler o ayın bordrosuna düşer. Geri alınabilir. Pencerede personelin **zimmetindeki demirbaşlar** uyarı olarak listelenir (engellemez; önce iade alınması hatırlatılır).

Kart değişikliği o aydan itibaren hesaplanmış açık bordroları **"yeniden hesaplanmalı"** işaretler.

### Puantaj ve kalemler

`/bordro/puantaj`: ay seçilir; personel başına **eksik gün** (SGK nedeniyle), **fiilen çalışılan gün** (yemek / yol istisnası için), **fazla çalışma saati**, **bayram** ve **hafta tatili** çalışması. Değişen satırlar birlikte kaydedilir (200 satıra kadar tek kayıt). Ay onaydaysa ya da onaylıysa sunucu reddeder ("ay kilitli").

Altında ayın **ek ödeme / kesinti kalemleri**: kalem (prim, ikramiye, yol, yemek, kesinti…), personel, tutar. Sistem kalemleri (ücret, fazla mesai, kıdem, servis payı…) elle girilmez; hesaptan, puantajdan, çıkıştan ve servis payından gelir.

### Servis payı

`/bordro/servis-payi`: ayın **havuzu** girilir; dağıtım **puan** ya da **eşit pay**, istenirse **çalışılan güne göre** ağırlıklı. Paylar ayın "Servis payı" kalemine yazılır; kuruş artığı en büyük paydan başlanarak dağıtılır, toplam havuza eşittir. Ay onaydaysa dağıtım değişmez.

### Bordro hesaplama, onay ve ödeme

**Bordrolar** (`/bordro`): ay ay aylık ve fark bordroları, durum (taslak / hesaplandı / onayda / onaylı / ödendi), toplamlar. **Bordro aç** ayın aylık bordrosunu (ya da onaylı ayın **fark bordrosunu**) açar.

**Bordro ekranı** (`/bordro/:id`) akışı:

1. **Hesapla.** Puantaj, kalemler, ücret, teşvik, matrah devri toplanır; saf hesap motoru 30 gün esasıyla hesaplar: prime esas kazanç taban–tavan arası, işçi SGK + işsizlik, gelir vergisi birikmiş matrah üzerinden dilimli, asgari ücret GV / DV istisnası, engellilik indirimi, yemek / yol istisnası, damga vergisi, işveren payları, 5510 Hazine indirimi ya da teşvik. Her personel satırında **hesap izi** açılır. Eşzamanlı ikinci hesap sırayı bekler.
2. Uyarıları okuyun: **yeniden hesaplanmalı** (girdi değişti), **parametre seti teyitsiz** (onaya gidemez), **önceki ay onaylanmamış** (yıl içi birikmiş matrah onaylı bordrolardan gelir; önceki aylar onaylanmadan bu ay hesaplanamaz / onaya gidemez).
3. **Onaya gönder.** Onay kuyruğuna `Bordro` türünde iş düşer; **hazırlayan onaylayamaz** (dört göz). Onayda **avans taksitleri ve icra / nafaka kesintileri kesinleşir** (hesap tekrarlanabilir, kesinti bir kez düşer). Reddedilirse bordro "hesaplandı"ya döner.
4. **Onaylı ay kilitlidir.** Puantaj, kalem, servis payı değişmez. Düzeltme **fark bordrosuyla**: ay onaylı girdi + yeni kalemlerle baştan hesaplanır, önceki onaylı tutarlar çıkarılır; fark eksi olabilir. Fark bordrosunda BES / avans / icra kesintisi yapılmaz.
5. **Öde** (`payroll.pay`): **banka** → banka hesabından çıkış + IBAN dosyası (Excel); **elden** → yalnız kasadan (kasa eksiye düşmez). Ödeme tarihi bugünü geçemez.

**Çıktılar:** bordro listesi PDF (bütün personel, toplamlı), personel pusulaları PDF (kişi başı bir sayfa; büyük otelde departman ya da sayfa sayfa), departman icmali, banka dosyası ve müşavir tablosu (Excel). Onaylanmamış bordronun her sayfasında **"TASLAK"** yazar.

### Ekran alanları: bordro ekranı

`/bordro/:id`:

| Alan | Ne gösterir / ne yapar |
| --- | --- |
| Başlık | Ay, tür (aylık / fark), durum rozeti (taslak, hesaplandı, onayda, onaylı, ödendi), kullanılan parametre seti ve teyit durumu |
| Uyarı şeridi | "Yeniden hesaplanmalı" (girdi değişti), "parametre seti teyitsiz", "önceki ay onaylı değil", "onay bekliyor", "reddedildi (not)" |
| Toplamlar | Brüt, SGK işçi / işveren, gelir vergisi, damga vergisi, kesintiler, **net ödenecek**, işveren maliyeti; personel sayısı |
| Departman icmali | Departman başına brüt / net / maliyet |
| Personel satırları | Ad, departman, gün, brüt, SGK, GV, DV, kesintiler, net; satıra tıklayınca **hesap izi** (her adımın ara değeri) ve **pusula** penceresi |
| Çıktılar | Bordro listesi PDF, pusulalar PDF (departman / sayfa seçimi), departman icmali, banka dosyası (Excel; banka ödemesi için), müşavir tablosu (Excel) |
| Ödemeler | Ödeme satırları (tarih, yöntem, hesap, tutar, ödeyen); **Öde** düğmesi (`payroll.pay`): banka hesabı seç ya da elden → kasa seç |
| Düğmeler | Hesapla, Onaya gönder, (fark bordrosunda) Fark bordrosu aç; onaylı ayda düzenleme kapalı |

### Örnek: brüt 30.000 TL'lik bir bordro

Aşçı Selin Kaya, Mutfak departmanı, brüt anlaşmalı 30.000 TL, Nisan 2026, tam ay (30 gün), teşvik yok, BES yok, 2.000 TL avans almış. **Aşağıdaki oranlar yalnızca örnektir**; gerçek oranlar ve istisna tutarları otelin **teyit edilmiş parametre setinden** gelir ve hesap izi ekranında satır satır görünür. Asgari ücret gelir / damga vergisi istisnası basitlik için gösterilmemiştir (gerçek hesapta düşülür ve net daha yüksek çıkar).

| Adım | Hesap | Tutar |
| --- | --- | --- |
| Brüt ücret | 30 gün × günlük | 30.000,00 |
| SGK işçi payı | 30.000 × %14 | −4.200,00 |
| İşsizlik işçi payı | 30.000 × %1 | −300,00 |
| Gelir vergisi matrahı | 30.000 − 4.500 | 25.500,00 |
| Gelir vergisi (ilk dilim %15, birikmiş matraha göre) | 25.500 × %15 | −3.825,00 |
| Damga vergisi | 30.000 × %0,759 | −227,70 |
| **Net ücret** | | **21.447,30** |
| Avans mahsubu | (onayda kesinleşir) | −2.000,00 |
| **Ödenecek** | | **19.447,30** |
| SGK işveren payı | 30.000 × %20,75 | 6.225,00 |
| İşsizlik işveren payı | 30.000 × %2 | 600,00 |
| Hazine 5 puan indirimi | 30.000 × %5 (koşulları sağlıyorsa) | −1.500,00 |
| **İşveren maliyeti** | 30.000 + 6.225 + 600 − 1.500 | **35.325,00** |

Netten anlaşmalı olsaydı (ör. "net 25.000"): sistem **en küçük brütü** ikili aramayla bulur; hesap izi "hedef net 25.000 → brüt X" satırını gösterir.

Bordro onaylanınca **ön muhasebeye** düşen tahakkuk (ay sonu, 30 Nisan tarihli; muhasebe aktörü):

| Cari | Hareket | Tutar | Açıklama |
| --- | --- | --- | --- |
| Selin Kaya (personel) | Alacak (borcumuz) | 21.447,30 | Net ücret. Avans ödendiği gün aynı cariye **borç 2.000** yazılmıştı; tahakkukla cari bakiyesi (A) 19.447,30 olur |
| SGK | Alacak | 4.200 + 300 + 6.225 + 600 − 1.500 = 9.825,00 | İşçi + işveren payları − indirim |
| Vergi dairesi | Alacak | 3.825,00 + 227,70 = 4.052,70 | Gelir + damga vergisi |
| BES şirketi | — | 0 | (BES yok) |
| İcra / nafaka dosyası | — | 0 | (yok) |

Maaş ödemesi (Bordro ekranı → Öde → banka "İş Bankası TRY", 5 Mayıs): banka hesabından **tek çıkış** (bütün personelin ödeneceklerinin toplamı), Selin Kaya carisine **borç 19.447,30** → cari bakiyesi **0**; banka dosyasında IBAN satırı. SGK ve vergi dairesi carileri muhasebecinin ay sonunda **Ödeme fişi** ile kapatacağı borçlar olarak kalır (bu ödeme bordro ekranından değil, Ön muhasebe → cari kartından yapılır). Fark bordrosunda tutar eksi çıkarsa (ör. yanlış girilen primin geri alınması) ters taraf yazılır.

Arka plan ve kapalıysa:

| Olay | Açıkken | Kapalıysa | Tamamlama |
| --- | --- | --- | --- |
| Bordro onaylandı | Muhasebe aktörü 250'lik parçalarla tahakkuk yazar; eksik personel carilerini toplu açar | "Ön muhasebe" görevi: "Onaylanan bordro carilere tahakkuk ettirilecek" | Ön muhasebe → Ayarlar → Eşitle (ay) |
| Maaş ödendi | Kasa / banka çıkışı + personel carileri | "Maaş ödemesi kasaya / bankaya ve personel carilerine işlenecek" | Eşitle |
| Bordro onaya gitti / reddedildi / hesaplandı | Muhasebe etkisi yok | — | — |

### Ayarlar

`/bordro/ayarlar` (görmek `payroll.view`, değiştirmek `payroll.setup`):

- **İşyeri:** ünvan, SGK işyeri sicil, vergi dairesi, sektör (imalatta Hazine indirimi 5 puan). Canlıya alırken girilmesi şarttır.
- **Yasal parametre setleri:** FlexAI kataloğundan **hazır setleri yükle** (2026'nın üç seti: 1 Ocak; 17 Nisan yemek SGK istisnası; 1 Temmuz kıdem tavanı). Yüklenen set **"teyit edilmedi"** başlar; bir yetkili resmî kaynakla karşılaştırıp **Teyit ettim** demeden o setle hesaplanan bordro onaya gidemez. Onaylı ya da onaydaki bordronun seti değiştirilemez, teyidi kaldırılamaz. Mevzuat değişince ekranda "yeni hazır set var" görünür. Bir ay, **ayın son günü** yürürlükte olan setle hesaplanır.
- **Kalemler:** ödeme / kesinti kalemleri (sistem kalemleri silinmez).
- **Departmanlar.**

### Arka planda otomatik olanlar

| Olay | Kim | Ne yapar |
| --- | --- | --- |
| Bordro onaylandı | Muhasebe aktörü | Ay sonu tarihli tahakkuk: personel carisine net ücret (alacak), SGK, vergi dairesi, BES, icra / nafaka carilerine tutarlar. 250 kişilik parçalarla; büyük otelde kesilirse yeniden çağrıda kalan yazılır. |
| Maaş ödendi | Muhasebe aktörü | Kasadan / bankadan tek çıkış, her personelin carisine borç (cari kapanır). |
| Personel kartı değişti | Bordro dinleyicisi | Personel carisinin adı / iletişimi eşitlenir. |
| Avans ödendi | Bordro servisi | Personel carisine borç; onayda mahsup. |
| İşten çıkış kaydedildi | Bordro servisi | Kıdem / ihbar / izin kalemleri; demirbaş zimmet uyarısı (46). |

Bordronun **gider tarafı** genel muhasebede yazılır: tahakkuk fişinde işveren maliyeti "Personel gideri (departman)" kuralına göre `770` (ya da departman hesaplarına) borç; net ücret `335`, SGK `361`, vergi `360`, BES `369`, icra `336` alacak. Ön muhasebede yalnız cari tarafı görünür.

### Dikkat edilecekler ve sık hatalar

- **"Parametre seti teyit edilmedi"**: Ayarlar → parametre setinde Teyit ettim. Setler 2 Kasım 2026'da derlendi; Resmî Gazete / SGK / GİB metniyle karşılaştırmadan teyit etmeyin.
- **"Önceki ay onaylı değil"**: yılın önceki aylık bordrolarını sırayla onaylayın; yıl ortasında geçiş yapan otel matrah devri girer.
- **"Ay kilitli"**: onaylı ayı düzeltmek için fark bordrosu açın.
- **Elden ödeme kasadan düşmüyor**: elden ödeme yalnız kasadan yapılır, kasa yetersizse önce virman.
- Ücret, IBAN, avans, kesinti alanları yalnız `payroll.view` olana görünür; ön büro personel listesini görebilir ama ücreti göremez.
- İzin bakiyesi, vardiya çizelgesi, özlük belgesi bu sürümde yok (52). Puantaj elle girilir.

## Demirbaş ve amortisman

### Ne işe yarar

Otelin sabit kıymetleri (televizyon, klima, mobilya, mutfak ekipmanı…) **kodlu kart** olarak tutulur: nerede (oda ya da alan), kimde (zimmet), ne zaman kaça alındı, garantisi ne zaman bitiyor, yıl yıl amortismanı ve net değeri. QR etiket yazdırılır; sayımda etiket okutulur; VUK usulü yıllık doğrusal amortisman tablosu alınır; garantisi bitecekler için zil çalar.

### Nerede bulunur

**Demirbaş** menüsü: Demirbaşlar (`/demirbas`), Sayım (`/demirbas/sayim`, sayım ekranı `/demirbas/sayim/:id`), Amortisman (`/demirbas/amortisman`), Garanti (`/demirbas/garanti`), Tanımlar (`/demirbas/tanimlar`). Kart `/demirbas/:id`; etiketteki QR `/demirbas/k/DM-000123` adresine gider ve karta yönlendirir. Yalnız sayım yetkisi olan personel (etiket okutan) sadece Sayım sekmesini görür.

### Tanımlar (önce bunlar)

- **Kategoriler:** ad + varsayılan faydalı ömür (yıl). Ömür VUK oranına karşılık gelir; yeni karta kopyalanır, mevcut kartlar değişmez.
- **Alanlar:** oda dışı yerler (lobi, restoran, depo, çatı…). Adlar büyük / küçük harf duyarsız tekildir. Kullanımdaki demirbaşın durduğu alan kaldırılamaz (önce taşınır); kullanılan tanım silinmez, pasifleştirilir.

### Demirbaş kartı

**Liste:** kod / ad / seri no / marka / model araması (**QR bağlantısı da yapıştırılabilir**), durum, kategori, konum ve zimmet süzgeci; süzgeçteki kart sayısı ve toplam maliyet; seçilenlerin etiketi yazdırılır. **Net değer = maliyet − birikmiş amortisman.**

**Yeni kart** (`assets.manage`): kod otomatik `DM-000001` (kesintisiz sıra), ad, kategori (faydalı ömür kategoriden gelir, değiştirilebilir), marka / model / seri no, **yer tam olarak bir oda ya da bir alan**, zimmet (bordro personel kartından), alış tarihi ve tutarı, garanti bitişi. Alış yılı bu yıldan önceyse **açılış amortismanı** (sistemden önce ayrılmış tutar ve hangi yıla kadar) yazılır. Gelecek tarihli alış olamaz.

**Kart ekranı:** bilgiler, finansal özet, **yıl yıl amortisman tablosu** (açılış, kaydedilmiş, plan), hareket geçmişi (ekle-yalnız; yer ve zimmet o anki adlarıyla), işlemler:

- **Düzelt:** kaydedilmiş amortismanı olan kartın alış tarihi / tutarı / ömrü / açılışı **kilitlidir** (önce son yılın kaydı geri alınır).
- **Taşı:** yeni oda ya da alan, not.
- **Zimmetle / İade al:** personel seçimi.
- **Elden çıkar** (`assets.finance`): tarih, tür (satış / hurda / kayıp), satış bedeli. Çıkarıldığı yıl amortisman ayrılmaz; tarih kartın amortismanla kapanmış son yılından sonra olmalı. Net değer o anda dondurulur; satışta kâr / zarar ondan hesaplanır.
- **Etiket yazdır.**

### Excel ile toplu yükleme

Liste → **Excel'den yükle**: şablon indir → doldur (kategori adı, konum: oda no — "Oda 101" de olur — ya da alan adı, zimmet: sicil no, önceki yıllarda ayrılmış amortisman) → dosya seç → **önizleme** (sunucu her satırı doğrular, adları kayda çevirir, satır satır hata) → hatasızsa **yükle**. **Ya hep ya hiç:** tek hatalı satırda hiçbir kart açılmaz. Aynı yükleme ikinci kez gönderilirse yeni kart açılmaz. Sınır 1000 satır.

### QR etiket yazdırma

Etiket **QR + kod yazısı** içerir. İki biçim: **50 × 30 mm etiket yazıcısı** ya da **A4 3 × 8** (başlangıç konumu seçilir; yarı kullanılmış sayfa israf olmaz). Telefon kamerasıyla okutan personel giriş yapmışsa doğrudan kartı görür. 2D el okuyucusu sayımda okutur; **1D lazer okuyucu QR okuyamaz**.

### Sayım

`/demirbas/sayim`: açık sayımlar üstte. **Yeni sayım** kapsamı: tüm otel, bir alan ya da bir oda. Açılışta kapsamdaki kullanımdaki kartlar o anki yerleriyle **"beklenen"** olarak dondurulur — sayım sürerken taşınan kart listeyi kaydırmaz.

**Sayım ekranı** (`/demirbas/sayim/:id`, `assets.count`):

1. Sayımcı **"şu an buradayım"** diye oda / alan seçer.
2. Etiketleri okutur: el okuyucusu klavye gibi yazar; kamera düğmesi tarayıcı destekliyorsa (Chrome / Android) arka kamerayı açar; kod elle de yazılabilir. QR bağlantısı da kod da kabul edilir.
3. Her okutma sonuç verir: **yerinde**, **başka yerde** (beklenen yer farklı), **fazla** (kapsam dışı kart), **tekrar** (zaten okutuldu), **elden çıkarılmış**, **bilinmeyen kod**. Son üçü hata değil sonuçtur.
4. Birden çok sayımcı aynı anda okutur; aynı etiketi ilk okutan kazanır.
5. **Kapat** (`assets.manage`): başka yerde ya da kapsam dışında bulunanlar istenirse **bulunduğu yere taşınır** (hareket geçmişine sayım numarasıyla). **Eksikler kendiliğinden düşmez** — elden çıkarma ayrı ve yetkili işlemdir. **İptal** hiçbir şeye dokunmaz.

### Amortisman (VUK, yıllık doğrusal)

`/demirbas/amortisman`: yıl seçilir; yıl içinde defterde olan her kart için yıl başı birikmiş, **yılın payı**, yıl sonu birikmiş ve net değer; kategori özeti ve genel toplam; **aylık pay** (yıllık / 12 — aylık raporlar için); Excel'e aktar.

Kurallar (kullanıcı kararı):

- **Alındığı yıl tam yıl** amortisman ayrılır; **elden çıkarıldığı yıl ayrılmaz**.
- Yılın payı = kalan net değer / ömrün kalan yılı (son yıl kalanın tamamı). Yolunda giden kartta maliyet / ömür; açılışla gelen kartta kalan değer kalan yıllara yayılır.
- **Yıl kaydı** (`assets.finance`, "Kaydet"): yıllar **ardışık** kaydedilir (ilk kayıt geçmiş ya da bu yıl; gelecek yıl kaydedilemez). Kaydedilen yıl **kilitlidir**: kartların finansal alanları değişmez, o yıla ya da öncesine elden çıkarma yazılamaz.
- **Geri al:** yalnız **son yıl**; o kayıttan sonra elden çıkarılan kart varsa alınamaz (dondurulan net değer o kaydı içerir).

**Otomatik muhasebe fişi yoktur**: amortisman ve elden çıkarma kâr / zararı tabloda görülür; yevmiyeye yazılması için Genel muhasebe → Yevmiye → Fiş gir ile elle fiş girilir (ör. `770` borç / `257 Birikmiş Amortismanlar` alacak). Azalan bakiyeler usulü yoktur.

### Ekran alanları: demirbaş kartı

`/demirbas/:id`:

| Alan | Ne gösterir |
| --- | --- |
| Başlık | Kod (`DM-000123`), ad, durum (kullanımda / elden çıkarıldı), kategori, QR önizlemesi |
| Bilgiler | Marka, model, seri no, **yer** (oda no ya da alan adı), **zimmet** (sicil + ad), alış tarihi, alış tutarı, faydalı ömür (yıl), garanti bitişi (kalan gün), not |
| Finansal özet | Maliyet, açılış amortismanı (varsa; hangi yıla kadar), kaydedilmiş birikmiş amortisman, planlanan, **net değer**; elden çıkarılmışsa çıkarma tarihi, türü, satış bedeli, dondurulmuş net değer ve **kâr / zarar** |
| Yıl yıl tablo | Yıl · yıl başı birikmiş · yılın payı · kaynağı (açılış / kaydedildi / plan) · yıl sonu birikmiş · net değer |
| Hareket geçmişi | Ekle-yalnız satırlar: açıldı, düzeltildi (hangi alan), taşındı (nereden nereye), zimmetlendi / iade alındı (kime), sayımda bulundu (sayım no), elden çıkarıldı; kim, ne zaman |
| Düğmeler | Düzelt, Taşı, Zimmetle / İade al, Etiket yazdır (`assets.manage`); Elden çıkar (`assets.finance`) |

### Örnek: 60.000 TL, 5 yıl — amortisman tablosu

Endüstriyel fırın, kategori "Mutfak ekipmanı" (varsayılan ömür 5 yıl), alış **15 Mart 2026**, 60.000 TL, garanti 15 Mart 2028, yer "Mutfak" alanı, zimmet Selin Kaya.

VUK yıllık doğrusal: yılın payı = kalan net değer / ömrün kalan yılı; alındığı yıl **tam yıl** (Mart'ta alınsa da 2026 için tam pay).

| Yıl | Yıl başı birikmiş | Yılın payı | Yıl sonu birikmiş | Net değer | Aylık pay (raporlar için) |
| --- | --- | --- | --- | --- | --- |
| 2026 | 0,00 | 12.000,00 | 12.000,00 | 48.000,00 | 1.000,00 |
| 2027 | 12.000,00 | 12.000,00 | 24.000,00 | 36.000,00 | 1.000,00 |
| 2028 | 24.000,00 | 12.000,00 | 36.000,00 | 24.000,00 | 1.000,00 |
| 2029 | 36.000,00 | 12.000,00 | 48.000,00 | 12.000,00 | 1.000,00 |
| 2030 | 48.000,00 | 12.000,00 (kalanın tamamı) | 60.000,00 | 0,00 | 1.000,00 |

Adımlar:

1. **2026 sonu:** Demirbaş → Amortisman → yıl 2026 → tabloda fırın 12.000 "plan" → **Kaydet** (`assets.finance`). Artık 2026 kilitli: fırının alış tarihi / tutarı / ömrü değişmez; 2026 ya da öncesine elden çıkarma yazılamaz. Kayıt kartları kilitleyerek yazılır (aynı anda gelen düzeltme bekler).
2. **Hata fark edildi:** tutar aslında 66.000 olmalıydı. 2026 kaydını **Geri al** (yalnız son yıl) → kart → Düzelt → 66.000 → yeniden Kaydet: 2026 payı 13.200.
3. **Açılışla gelen kart (karşılaştırma):** aynı fırın 2024'te alınmış, sistem 2026'da başlamış olsaydı kartta "açılış amortismanı 24.000, 2025 yılına kadar" girilir; kalan 36.000 kalan 3 yıla yayılır → 2026–2028 yılda 12.000. Açılışın kapsadığı yıllarda pay yoktur.
4. **Elden çıkarma:** 2028 Haziran'da fırın 20.000 TL'ye satılır. 2027 kaydı yapılmış, 2028 kaydı yapılmamış → tarih geçerli. **Çıkarıldığı yıl amortisman ayrılmaz**: net değer 2027 sonundaki **36.000** (60.000 − 24.000) olarak dondurulur; satış 20.000 → **zarar 16.000** tabloda görünür. 2028 tablosunda fırın "elden çıkarıldı, pay yok" satırıyla yer alır. Bu noktadan sonra 2027 kaydı geri alınamaz (dondurulan değer onu içerir).
5. **Garanti:** 13 Şubat 2028'de (bitişe 30 gün) 6 saatlik iş fırını yakalar → `assets.manage` iznine tek zil ("1 demirbaşın garantisi 30 gün içinde bitiyor", bağlantı garanti listesine). Garanti uzatılırsa yeni tarih için yeniden çalar.
6. **Sayım:** Nisan 2027 "Mutfak" alanı sayımında fırın okutulur → "yerinde". Depoya taşınmış olsaydı → "başka yerde"; kapanışta "bulunduğu yere taşı" işaretlenirse kart Depo'ya taşınır, geçmişe "sayım SYM-… ile taşındı" yazılır.

**Otomatik muhasebe fişi yoktur:** 12.000 TL'lik yıllık pay ve 16.000 TL'lik zarar bu tabloda ve Excel çıktısındadır; muhasebeci yıl sonunda Genel muhasebe → Yevmiye → Fiş gir ile `770` 12.000,00 borç / `257` 12.000,00 alacak elle fişini girer.

### Garanti

`/demirbas/garanti`: seçilen pencerede garantisi bitecek kullanımdaki demirbaşlar (en yakın önce) ya da son bir yılda bitmişler. **Garanti zili:** 6 saatte bir çalışan iş, garantisi 30 gün içinde bitecek kartı yakalar ve `assets.manage` iznine zil düşürür (bağlantı garanti listesine). Kart ve bitiş tarihi başına **bir kez**; garanti uzatılırsa yeniden; aynı günün kartları tek zilde.

### Arka planda otomatik olanlar

| Ne | Kim | Nasıl |
| --- | --- | --- |
| Garanti uyarısı | Sunucu zamanlanmış işi (6 saat) | Pencereye giren kartlar için tek zil |
| Zimmet uyarısı | Bordro işten çıkış penceresi | Personelin zimmetindeki kullanımdaki demirbaşlar listelenir, engellemez |
| Kart / sayım / amortisman değişti | Canlı yayın kanalı | Açık ekranlar tazelenir; sürüm hatasında kayıt yeniden okunur |

Demirbaş modülünde aktör yoktur; satın almadan otomatik kart açılması (satın alma yalnız stok kalemi taşır) ve zimmet tutanağı PDF'i bilinçli olarak sonraya bırakılmıştır.

### Dikkat edilecekler ve sık hatalar

- **"Finansal alanlar kilitli"**: kartın kaydedilmiş amortismanı var. Amortisman sekmesinden son yılı geri alın, düzeltin, yeniden kaydedin.
- **"Elden çıkarma tarihi kapanmış yıla düşüyor"**: tarih kaydedilmiş son yıldan sonra olmalı.
- **"Gelecek yıl kaydedilemez" / "Yıllar ardışık"**: 2025'i kaydetmeden 2026 kaydedilmez.
- **Sayımda eksik görünen kart** yerinde değilse önce aranır; gerçekten yoksa yetkili **elden çıkar (kayıp)** yapar. Sayım kapanışı bunu yapmaz.
- **Kamera düğmesi yok**: tarayıcı QR okumayı desteklemiyor (Safari / iOS'ta yok). El okuyucusu ya da elle yazma kullanılır.
- **Excel yüklemesi geçmedi**: tek satır hatası bütün dosyayı durdurur; önizlemedeki satır hatalarını düzeltip yeniden yükleyin. Kategori / alan / sicil adları tanımlarla birebir eşleşmelidir.
- Lazer barkod okuyucu QR okumaz; 2D okuyucu ya da telefon gerekir.

## Bütçe (kısa)

Bütçe arka ofisin planlama ayağıdır (`/butce/plan`, `/butce/gerceklesen`, `/butce/sapma`; `budget.view` müdür ve muhasebe, `budget.approve` müdür).

- **Plan:** yıl × sürüm; satırlar gelir kalemleri, doluluk / ADR hedefleri, nakit (tahsilat) ve gider kalemleri (ilk bütçede USALI'ye göre 7 öneri); sütunlar aylar. Excel şablonu indir → doldur → yükle (kod sütunuyla eşleşir; yüklenen değer "kaydedilmemiş değişiklik" olarak gelir). Taslak → **Onayla** (kilit); değişiklik **revize** ile (önceki onaylı "eski sürüm").
- **Gerçekleşen:** gelir, doluluk, ADR, tahsilat **sistemden** (yalnız kapanmış günler; gelir raporuyla aynı tanım); **gider gerçekleşeni elle** girilir (hücre sürümlü; gelecek ay girilmez). Satın alma ve ön muhasebeden otomatik beslenme yol haritasındadır.
- **Sapma:** ay ya da yılbaşından seçilen aya; plan / gerçek / fark / fark %; gelirde fazlası, giderde azı olumlu; oda geliri sapması **doluluk etkisi** ve **fiyat etkisi**ne ayrılır; brüt faaliyet kârı; planı olup gerçekleşeni girilmemiş gider "eksik". **AI yorumu** (bütçe ajanı; anahtar yoksa "yazılamadı", rapor yorumsuz da eksiksizdir).

Örnek: Mart planı oda geliri 2.400.000, gerçekleşen 2.580.000 → +180.000 (+%7,5, olumlu). Ayrıştırma: doluluk hedefi %72, gerçek %76 → doluluk etkisi +133.000; ADR hedefi 2.750, gerçek 2.800 → fiyat etkisi +47.000. Yiyecek maliyeti planı 420.000, girilen gerçekleşen 455.000 → −35.000 (olumsuz, kırmızı).

## Bölüm sonu: sık sorulanlar

**Fatura GİB'e gerçekten gidiyor mu?** Hayır, henüz değil. Akış ve belge hazır; gerçek entegratör adaptörü bağlanınca canlı ortam açılır. Şimdilik test ortamı.

**Misafir çıkış yaptı, taslak açılmadı.** Üç sebep: faturalama başlangıcından önce kapanmış folyo (kuyruğa girmez), "otomatik taslak" kapalı, folyo aktörü kapalı (Görevler'de "Folyo" görevi vardır). Faturalanacaklar sekmesinden elle açın.

**Ödeme alındı ama cari / kasaya düşmedi.** Muhasebe aktörü kapalı ya da eşleme eksik; Görevler'de "Ön muhasebe" görevine bakın, eşlemeyi tamamlayın, Eşitle çalıştırın.

**Resepsiyon muhasebe ekranını görüyor mu?** Varsayılanda hayır; yalnız folyo ödemesinde cari seçicisini kullanır.

**Bordroyu kim onaylar?** Onay kuyruğunda `approvals.decide` yetkisi olan ve bordroyu **hazırlamamış** biri.

**Amortisman fişi nereye gidiyor?** Kendiliğinden hiçbir yere; tablodaki yıllık payı Genel muhasebe → Yevmiye → Fiş gir ile elle fiş olarak (`770` / `257`) yazarsınız. Tabloyu Excel'e alıp müşavire de verebilirsiniz.

**Ön muhasebe fişi kestim, yevmiyede görünmedi.** Muhasebe aktörü hareketi yazar yazmaz yevmiye fişine çevirir; görünmüyorsa Genel muhasebe → Ayarlar'da "Fişlenmemiş hareket" sayısına ve Görevler'de "… yevmiye fişine çevrilecek" görevine bakın (kural / hesap sorunu). Düzeltip Eşitle çalıştırın.

**Mizanı müşavire nasıl veririm?** Genel muhasebe → Mizan'da dönemi seçin; "Fişlenmemiş hareket var" uyarısı yoksa ve rozet "Mizan dengeli" ise rakamlar tamdır. Kapanan ayı Ayarlar → Dönem kilidi ile kilitleyin ki sonradan değişmesin.

**Demirbaş etiketini hangi cihaz okur?** Telefon kamerası (Chrome / Android), 2D el okuyucu. 1D lazer okuyucu okumaz.
