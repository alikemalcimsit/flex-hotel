#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Resepsiyonist misafirin pasaportunu ya da kimlik kartını kameraya tutar; birkaç saniye içinde ad, soyad, TC kimlik ya da pasaport numarası, uyruk ve doğum tarihi giriş formuna yazılır. Okunan, misafir kartında kayıtlı olanla yan yana gösterilir; farklı alanda hangisinin geçerli olacağına personel karar verir. Belgenin görüntüsü bilgisayardan ya da telefondan hiçbir yere gitmez ve saklanmaz: okuma tarayıcının içinde yapılır, kayda yalnızca bilgiler ve "kimlikten okundu" işareti yazılır. Online check-in'de misafirin yüklediği belge fotoğrafı da aynı yolla okunur ve misafirin yazdıklarıyla karşılaştırılır.],
  rakam: (("1–5 sn", "okuma, cihazda"), ("0 görüntü", "saklanmaz, gönderilmez"), ("Sağlama", "her alanın kontrol hanesi"), ("Pasaport + TC kimlik", "makine okunur satır")),
  adimlar: (("Kimlik tara", "kamera · dosya · online belge"), ("Okuma", "cihazda, birkaç saniye"), ("Doğrulama", "kontrol haneleri"), ("Karşılaştırma", "kayıttaki · belgedeki"), ("Forma yaz", "personel seçer"), ("Giriş", "kimlikten okundu")),
  akis-aciklama: [Pasaportun fotoğraflı sayfasındaki ve yeni TC kimlik kartının arka yüzündeki "<<<" dolgulu satırlar (makine okunur satır, MRZ) uluslararası standarttır; her önemli alanın sonunda bir kontrol hanesi bulunur. Okuyucu bu haneleri hesaplar: belge numarası, doğum tarihi ya da son kullanma tarihi yanlış okunduysa okuma kabul edilmez. Sunucu aynı denetimi bir kez daha yapar; okunan bilgi elle değiştirilmişse "kimlikten okundu" işareti verilmez.],
  ozellik: (
    ("Giriş penceresinde", "Rezervasyon sahibi ve her refakatçi için \"Kimlik tara\"; \"Tarayarak ekle\" ile refakatçi doğrudan belgeden eklenir (doğum tarihine göre çocuk önerisi). Rezervasyondaki ad yanlış yazılmışsa (OTA'dan gelen \"Aise Yilmas\" gibi) kart belgedeki ada göre düzeltilir; eski ad denetim izinde kalır."),
    ("Farkları personel seçer", "Her alan için kayıttaki ve belgedeki yan yana, aynı / farklı işaretli. Kontrol haneli alanlarda varsayılan belgedeki; adda kayıttaki (adın kontrol hanesi yoktur). Belgede Türkçe harf yoktur: \"Öztürk\" ile \"OZTURK\" aynı sayılır, kayıttaki Türkçe yazım korunur."),
    ("Online check-in kontrolü", "İnceleme penceresinde \"Belgeleri oku\": misafirin yüklediği fotoğraflar okunur ve yazdıklarıyla karşılaştırılır — \"Belgeyle uyuşuyor\", \"Uyuşmuyor: Belge numarası, Doğum tarihi\", \"Satır okunamadı\", \"Belgenin süresi dolmuş\". Değerler değil sonuç saklanır."),
    ("Misafir kartında", "Kartı düzenlerken \"Kimlik tara\"; kimlik girişteki kurallarla denetlenir (TC kimlik no sağlaması, uyruk listesi, eksiksiz belge). Kart başlığında belge türü, maskeli numara ve \"Kimlikten okundu\" rozeti."),
    ("Uyarılar", "Süresi dolmuş belge, aynı belge numarasının başka bir misafir kartında kayıtlı olması (kart birleştirme önerisi), satıra sığmadığı için kısaltılmış ad."),
    ("Kamera, tarayıcı ya da elle", "Telefon / tablette arka kamera ve belge çerçevesi; masaüstünde belge tarayıcısının çıktısı ya da fotoğraf dosyası; okunamazsa satırlar belgeye bakılarak elle yazılır — denetim yine yapılır."),
  ),
  neden: [Resepsiyonda kimlik bilgisini elle yazmak hem yavaş hem hataya açıktır: tek hane yanlış TC kimlik numarası KBS bildirimini bozar, yanlış yazılmış ad faturaya ve misafir geçmişine taşınır. Kimlik okuması girişi hızlandırır ve kontrol haneleri sayesinde yanlış okumayı kayda geçirmez. Görüntüyü saklamamak KVKK riskini neredeyse sıfıra indirir: belge fotoğrafı arşivi tutulmaz, yalnızca konaklama için gereken bilgiler kalır.],
  rol: (
    ([Resepsiyon], [Girişte belgeyi okutur, farkları seçer, adı belgedeki gibi düzeltir; online check-in belgelerini okutup uyuşmazlıkta misafirden düzeltme ister.]),
    ([Misafir ilişkileri / CRM], [Misafir kartında kimliği belgeden okutur; aynı belgeyle açılmış mükerrer kartları birleştirir.]),
  ),
  baglantilar: (
    "*Check-in / check-out (6):* kimlik alanları, refakatçiler ve kimlik politikası; okuma girişle aynı işlemde kayda geçer.",
    "*Misafir portalı ve online check-in (53):* misafirin yüklediği belge fotoğrafı okuyucunun kaynağı; karşılaştırma inceleme penceresinde.",
    "*CRM / misafir kartı (22):* kartın kimliği, \"kimlikten okundu\" işareti, birleştirmede işaret kalan kimlikle gider.",
    "*Kiosk (73):* misafirin kendisinin okutması aynı bileşenle.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Okuma tarayıcıda: `frontend/src/lib/mrzReader.js` (tesseract.js 7, WebAssembly; resmi İngilizce LSTM modeli; harf listesi A–Z 0–9 <; görüntü ön işleme: EXIF yönü, MRZ bandı kırpma, ölçekleme, gerekiyorsa kontrast; sırayla alt bant, kontrastlı alt bant, tüm görüntü, 180° ve 90 / 270°), dosyalar kendi kaynağımızdan `/ocr/…` (Vite eklentisi geliştirmede sunar, derlemede `dist/ocr`'a kopyalar). Ayrıştırma sözleşmede `contracts/mrz.js` (sunucu ve tarayıcı aynı kod). Ekran: `components/IdScanDialog.jsx` (kaynak, okuma, sonuç, karşılaştırma), saf karşılaştırma `lib/idScan.js`. Sunucu: `lib/id-read.js` (okumanın doğrulanması, işaretin yazılması / silinmesi), giriş (`front-desk/service.js`), kart (`guests/service.js`), online belge sonucu (`guest-portal/service.js`).],
  kural: (
    ("Biçimler", "ICAO 9303: TD3 pasaport (2 × 44), TD2 (2 × 36), TD1 kimlik kartı (3 × 30, yeni TC kimlik kartının arka yüzü). Kontrol hanesi 7-3-1 ağırlıklı (A = 10 … Z = 35, < = 0): belge no, doğum, son kullanma, kişisel no, birleşik."),
    ("OCR hataları", "Alan türüne göre düzeltme (rakam alanında O→0, I→1, B→8…; harf alanında tersi). Belge numarasında belirsiz karakterler en az değişiklikten başlayarak denenir; aday hem kendi hanesini hem birleşik haneyi tutturmalı. Dolgunun K / L okunması ve yutulması geri kurulur (veri satırında, ad satırında yalnız sonda); satır uzunluğu en uzun dolgu dizisinden düzeltilir."),
    ("Birleşik hane", "Yalnız isteğe bağlı alanı ek olarak korur; alan boşsa ya da sağlamalı TC kimlik no ise birleşik hanenin tutmaması okumayı geçersiz kılmaz (OCR son haneyi sık bozar)."),
    ("Kimlik", "TC kimlik no kimlik kartında isteğe bağlı alandan, Türk pasaportunda kişisel numaradan (sağlamalı). Türk vatandaşında kimlik türü \"TC no\" (girişin kuralı, KBS anahtarı); diğerlerinde pasaport / kimlik kartı ve belge numarası. ICAO 3 harfli kod → ISO alfa-2 (D<<, GBD…, RKS dahil); vatansız / BM kodu tanınmaz."),
    ("Sunucu doğrulaması", "`documentRead { mrz, via }`: MRZ sunucuda yeniden ayrıştırılır, sorunlar (kontrol hanesi, uyruk, TC no) varsa 422; gönderilen tür / numara / uyruk / doğum tarihi okunanla aynı değilse 422 (değişen alanların adı). Tutarsa `Guest.idReadAt / idReadBy / idReadVia`. Okumasız kimlik değişikliği işareti siler; kimliğe dokunmayan düzenleme korur. MRZ metni ve görüntü saklanmaz; denetim izinde belge numarası maskeli."),
    ("Online belge", "`POST …/documents/:id/ocr { mrz | null }` → MATCH / MISMATCH (alan adları) / UNREADABLE + süresi dolmuş; değerler saklanmaz; online check-in sürümü ilerlemez; misafirin sonraki gönderiminden eski okuma geçersiz; silinmiş belge okunamaz."),
    ("Eşleşme", "`POST /front-desk/identity-matches` ve `POST /guests/identity-matches`: aynı numara (uyruğu boş kart da) başka kartta mı; en fazla 5, numara maskeli; numara gövdede (adres satırına ve erişim günlüğüne düşmez)."),
  ),
  tutarlilik: (
    "*Tek kaynak:* ayrıştırıcı sözleşmede; tarayıcının okuduğu ile sunucunun doğruladığı aynı koddan.",
    "*Kimlik yazan her yer:* giriş (sahip + refakatçi), kart düzenleme, birleştirme `lib/id-read.js`'ten geçer — işaret kimlikle tutarlı kalır.",
    "*Kişisel veri:* görüntü cihazdan çıkmaz; OCR işçisi son okumadan 5 dk sonra bırakılır, tuvaller sıfırlanır.",
  ),
  olcek: (
    ("Okuma (kurgusal pasaport, kimlik kartı)", "1,5 · 2,6 sn (cihazda)"),
    ("İlk kullanımda indirilen", "≈ 7 MB (çekirdek 3,9 + dil 2,9), sonra önbellek"),
    ("Sunucu: okuma doğrulaması", "ayrıştırma + karşılaştırma, ms altı"),
    ("Eşleşme sorgusu", "(hotelId, idNumber) indeksi"),
  ),
  olcek-not: [Okuma sunucuya yük getirmez: 2500 kişilik bir otelin yoğun giriş saatinde bile her resepsiyon kendi cihazında okur. Sunucu yalnız yaklaşık 100 karakterlik metni doğrular.],
  test-notu: [Sözleşme birim testleri: ICAO örnek belgeleri (TD3, TD1, TD2), kurgusal TC kimlik kartı, Türk ve Alman pasaportu, bozuk kontrol hanesi, OCR düzeltmeleri, tarayıcıda alınmış gerçek OCR çıktıları (dolgu K / L, yutulmuş ve fazladan dolgu, bozuk birleşik hane), tarih yüzyılı ve olmayan gün, Türkçe harfsiz ad karşılaştırması, kısaltılmış ad, sunucu doğrulaması, uyruk kodlarının tamlığı. Ön yüz: alan alan karşılaştırma ve seçim, okumanın düşmesi, çocuk önerisi. Entegrasyon (gerçek PostgreSQL): okunan kimlikle giriş, değiştirilmiş / kontrol hanesi tutmayan okumanın reddi, ad düzeltmesi + refakatçi pasaportu, elle değişen kimlikte işaretin silinmesi, kart okuması ve maskeli denetim izi, eşleşme, online belge karşılaştırması, eskime, silinmiş belge, otel kapsamı.],
  degistir: (
    ("Yeni belge türü", "`DOCUMENT_TYPES` (mrz.js) ve `ID_DOCUMENT_TYPES`; Prisma enum'u migration ister."),
    ("Daha iyi OCR modeli", "`vite.config.js` `OCR_FILES` içinde dil verisinin yolu (ör. OCR-B eğitimli model); ayrıştırıcı değişmez."),
  ),
  devir: (
    "*73 (kiosk):* misafirin kendisinin okutması aynı `IdScanDialog` ile; NFC çip okuma yerel uygulama ister.",
    "*KBS bildirimi:* \"kimlikten okundu\" işareti bildirimde güven göstergesi olarak kullanılabilir.",
  ),
)
