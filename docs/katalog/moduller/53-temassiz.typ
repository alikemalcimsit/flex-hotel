#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Misafir rezervasyonuna özel bir bağlantıyla portala girer; uygulama indirmesi, şifre ya da üyelik gerekmez. Girişten önce online check-in'i telefonundan tamamlar: her yetişkinin kimlik bilgisi ve belge fotoğrafı, tahmini varış saati, ödeme tercihi, konaklama kuralları ve KVKK onayı, parmakla imza. Resepsiyon belgeyi girişten önce görür, onaylar ya da misafire gidecek sebeple düzeltme ister; misafir gelince giriş penceresi bu bilgilerle dolu açılır, belge yine görülür ve giriş tek tıkla yapılır. Konaklamada aynı bağlantı hesabı, istekleri ve oda servisi menüsünü açar. Portal Türkçe, İngilizce, Almanca ve Rusça.],
  rakam: (("Dört dil", "uyruğa göre açılır"), ("Bağlantı", "rezervasyona özel, imzalı"), ("Davet", "girişten 3 gün önce"), ("KVKK", "belge fotoğrafı süre dolunca silinir")),
  adimlar: (("Davet", "e-posta · SMS · QR"), ("Kişiler", "kimlik · belge fotoğrafı"), ("Varış", "saat · plaka · ödeme"), ("Onay ve imza", "kurallar · KVKK"), ("İnceleme", "onay · düzeltme"), ("Giriş", "dolu pencere · tek tık")),
  akis-aciklama: [Davet girişten ayarlanan gün kadar önce (varsayılan 3) otelin açık bildirim kanallarından kendiliğinden gider; resepsiyon rezervasyondan bağlantıyı kopyalayabilir, QR'ını gösterebilir ya da daveti yeniden gönderebilir. Online check-in girişten ayarlanan gün kadar önce (varsayılan 7) açılır; misafir onaydan sonra da değiştirebilir, kayıt yeniden incelemeye düşer. Bağlantı iptal / gelmedi rezervasyonda ve çıkıştan iki hafta sonra kendiliğinden kapanır.],
  ozellik: (
    ("Misafir portalı", "Rezervasyon özeti (tarihler, gece, kişi, oda tipi; içerideyken oda numarası), online check-in durumu, otelin telefonu ve e-postası. Konaklamaya göre açılan kutular: hesabım, istek, oda servisi, sohbet. Dijital anahtar ve kartla ödeme kutuları yerinde, ilgili modüller gelince açılır."),
    ("Online check-in", "Rezervasyondaki kişi sayısı kadar satır; her yetişkine belge türü, numara (Türk vatandaşının kimlik kartında T.C. kimlik no denetim hanesiyle), uyruk, doğum tarihi ve en az bir belge fotoğrafı (ön / arka yüz); çocukta belge isteğe bağlı. Tahmini varış saati, araç plakası, ödeme tercihi, otele not; kurallar ve KVKK metni, belge fotoğrafı için açık rıza, ticari ileti tercihi, parmakla imza."),
    ("Belge fotoğrafı", "Telefonun kamerasıyla çekilir; telefonda küçültülür, konum ve cihaz bilgisi (EXIF) bu sırada düşer. Misafire geri gösterilmez (bağlantı ele geçse de kimlik fotoğrafı sızmasın); misafir yalnız kaç fotoğraf yüklediğini, numarasını maskeli görür."),
    ("Resepsiyonun incelemesi", "Online check-in listesi: giriş gününe göre, durum (inceleme bekliyor, onaylandı, düzeltme istendi, giriş yapıldı), arama. İnceleme penceresinde kişiler, belge fotoğrafları (büyütülerek), imza, onaylar; onay ya da misafirin dilini gösteren sebep alanıyla düzeltme isteği. Gönderim resepsiyonun ziline düşer."),
    ("Dolu giriş", "Giriş penceresi (6) rezervasyonun online check-in'iyle dolu açılır: kimlik, refakatçiler, plaka; onaylanmamışsa uyarır. Giriş yapılınca kayıt \"giriş yapıldı\"ya geçer."),
    ("Hesap, istek, oda servisi", "Konaklamada misafir hesabındaki harcamaları, ödemeleri (dövizli ödeme hem hesabın para biriminde hem kendi tutarıyla) ve bakiyeyi görür; şirket ya da acente hesabına yazılan pencere (kontrat fiyatı) misafire gösterilmez, yalnız varlığı söylenir; istek gönderir (resepsiyonun istek listesine \"Misafir portalı\" kaynağıyla düşer, durumu izlenir); oda servisi menüsünden odasına sipariş verir (oda servisinin kuralları ve onayıyla)."),
    ("Dört dil ve otelin metinleri", "Türkçe, İngilizce, Almanca, Rusça; ilk açılış misafirin uyruğuna göre, misafir değiştirebilir. Karşılama, konaklama kuralları ve KVKK metni otelin ayarından (dil başına); boş bırakılan dil otelin giriş / çıkış saatiyle varsayılan metne düşer."),
  ),
  neden: [Resepsiyonda en çok zaman alan iş girişteki kimlik ve form işlemidir; yoğun saatte kuyruk misafirin otelle ilk temasıdır. Online check-in bu işi misafirin telefonuna, girişten önceye taşır: resepsiyon belgeyi önceden görür, eksik ya da okunmayan belgeyi misafir gelmeden düzelttirir; misafir gelince yalnız belgesini gösterir. Aynı bağlantı konaklama boyunca misafirin oteldeki dijital kapısıdır.],
  rol: (
    ([Misafir], [Davetteki ya da resepsiyonun verdiği bağlantıyla portala girer; online check-in, hesap, istek, oda servisi.]),
    ([Resepsiyon], [Online check-in'leri inceler, onaylar ya da düzeltme ister; dolu pencereyle girişi yapar; bağlantıyı verir, yeniler, iptal eder, daveti gönderir.]),
    ([Müdür], [Portal ayarları: açık / kapalı, portal adresi, davet ve açılış günleri, belge saklama süresi, misafire gösterilen metinler.]),
  ),
  baglantilar: (
    "*Check-in / check-out (6):* giriş penceresi online check-in'le dolu açılır; giriş kaydı tamamlar, giriş geri alınırsa onaylıya döner.",
    "*Otomatik bildirimler (9):* davet \"Online check-in daveti\" şablonuyla (e-posta, SMS), `{portalLinki}` değişkeniyle; elle yeniden gönderilebilir.",
    "*Misafir istekleri (7) ve web sohbeti (8):* portaldan gelen istek resepsiyonun listesinde; sohbet balonu portalda açılır.",
    "*Oda servisi (41):* portal içerideki misafire oda bağlantısını verir; sipariş kuralları 41'in.",
    "*Rezervasyon (4):* rezervasyon ayrıntısında portal kartı (bağlantı, QR, davet, online check-in durumu); giriş günü değişince liste kendiliğinden eşitlenir.",
    "*Sanal POS (50) ve dijital anahtar (62):* kartla ödeme ve dijital anahtar kutuları portalda hazır; o modüller gelince açılır.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/guest-portal`: imzalı bağlantı (`links.js`), belge fotoğrafı ve imza, KVKK silmesi (`documents.js`), misafir uçları (`public.js`: ana sayfa, form, gönderim, folyo, istek, oda servisine geçiş), personel tarafı (`service.js`: ayarlar, liste, ayrıntı, onay / düzeltme, giriş olayı, giriş günü eşitlemesi), davet (`invites.js`), zamanlanmış işler ve abonelikler (`jobs.js`). Sözleşme `contracts/guest-portal.js` (dil seçimi, açılış penceresi, zorunlu fotoğraf, şemalar, dört dilde varsayılan metinler). Misafir uygulaması panelden ayrı bir paket: `frontend/guest` (Vite girişi `vite.guest.config.js`), `/misafir/` altında yayınlanır, `dist/misafir`'e derlenir; sözleşme paketini taşımaz (sınırlar `guest/src/limits.js`, sözleşmeyle testle bağlı). Sayfalar `PORTAL_PAGES` kaydında: yeni sayfa bir satırla eklenir.],
  kural: (
    ("Bağlantı", "`/misafir/p/<kimlik>.<imza>`; imza JWT sırrından türetilen anahtarla (41'den ayrı bağlam) bağlantı kimliği + rastgele değerin HMAC'i, sabit zamanlı karşılaştırma. Rezervasyonda tek geçerli bağlantı (kısmi tekil index); yenileme eskisini iptal eder. Portal iptal / gelmedi rezervasyonda ve çıkıştan 14 gün sonra kapanır."),
    ("Pencere", "Online check-in girişten `checkinOpenDays` gün önce açılır; çıkış günü gelince ya da giriş yapılınca kapanır. Gelişi geçmiş ama konaklaması süren (geç gelecek) misafir gönderebilir. Düzeltme istenmiş ve onaylı kayıt yeniden gönderilebilir (yeniden incelemeye düşer)."),
    ("Kişiler", "Yetişkin refakatçi ≤ yetişkin − 1, çocuk ≤ rezervasyonun çocuk sayısı. Her yetişkine en az bir, kişi başına en fazla iki fotoğraf; aynı fotoğraf iki kişiye bağlanamaz; fotoğraf bu rezervasyona yüklenmiş ve silinmemiş olmalı."),
    ("Gönderim", "Rezervasyon kilidi altında; gönderim sürümü (`submitCount`) aynı anda iki sekmeden ikinci yazımı reddeder. İmza sürümlü anahtarla önce diske, kayıt başarılıysa eski imza ve kullanılmayan eski fotoğraflar silinir. İşlem kaydına belge numarası yazılmaz (kişi / fotoğraf sayısı)."),
    ("İnceleme", "Onay ve düzeltme isteği iyimser kilitle (ekrandaki sürüm); giriş yapılmış kayıt değişmez; belgeleri silinmiş kayıt onaylanamaz. Giriş (`guest.checked_in`) kaydı tamamlar, giriş geri alma (`guest.check_in_reverted`) onaylıya döndürür."),
    ("KVKK", "Belge fotoğrafı çıkıştan (gelmeyen / iptalde girişten, kapatılmamış rezervasyonda çıkış gününden) `documentRetentionDays` gün sonra, gönderime bağlanmayan yükleme 48 saat sonra silinir: satır \"silindi\" işaretlenir, dosya diskten gider; kayıttaki kimlik numarası ve doğum tarihi de temizlenir (ad kalır). Fotoğraflar misafire geri gösterilmez; personel yetkili uçtan, önbelleğe alınmadan okur."),
    ("Davet", "`CHECKIN_INVITE` tetikleyicisi; onaylı rezervasyona, girişten `inviteDaysBefore` gün önce, online check-in yoksa, davet gitmemişse ve personel bağlantıyı iptal etmemiş / yenilememişse (o rezervasyonda davet elle gider). Davet bir kanala satır açılınca \"gitti\" sayılır: misafir kartında iletişim yoksa harcanmaz, bilgi eklenince sonraki turda gider. Adaylar indeksle imleçli seçilir, ayıklama parça içinde `IN` ile (yıllar boyu biriken kayıtları taramaz). İş 30 dakikada bir, otel başına 100'lük parçalarla 60 sn bütçeyle; elle gönderim 10 dakikada bir. Portal adresi ya da davetin gidebileceği açık kanal yoksa tur başlamaz."),
    ("Misafir uçları", "Oturumsuz; hız sınırı bağlantı başına (okuma 60, fotoğraf 20, yazma 10 / dk), üstünde IP tavanı (3.000 / dk, oda servisi uçlarıyla ortak): otel Wi-Fi'ı misafirleri tek adresten çıkarır, yalnız IP'ye göre sınır lobideki misafirleri birbirine kilitlerdi. Belirteç istek günlüğünde maskelenir; yanıt `no-store`, `no-referrer`. Fotoğraf ve gönderim için ayrı gövde sınırı. Hata kodla döner; misafir uygulaması kendi dilinde yazar."),
  ),
  tutarlilik: (
    "*Kilitler:* rezervasyon kilidi bağlantı verme / iptal, gönderim, onay / düzeltme ve giriş olayında; 6'nın girişiyle aynı kilit sırası.",
    "*Tekillik:* rezervasyonda tek geçerli bağlantı ve tek online check-in kaydı; davet tekilleştirme anahtarı (otomatik bir kez, elle her gönderim ayrı).",
    "*Giriş günü:* kayıtta indeksli tutulur (liste sırası ve süzgeci); rezervasyonun tarihi değişince `reservation.updated` ile eşitlenir.",
    "*Veritabanı kısıtları:* ayar sınırları (0–14, 1–30, 0–90), ödeme tercihi ve dil listesi, gönderim sürümü ≥ 1, fotoğraf türü JPEG / WebP.",
  ),
  olcek: (
    ("Liste (gelecek girişler, tümü, durum, derin sayfa 300)", "31–54 ms"),
    ("Arama: onay kodu · ad", "29 · 50 ms"),
    ("Ayrıntı · giriş penceresinin ön dolumu", "8 · 22 ms"),
    ("Misafir: ana sayfa · online check-in formu", "19 · 7 ms"),
    ("Misafir: belge fotoğrafı yükleme · gönderim (imza + bağlama + zil)", "22 · 90 ms"),
    ("Davet turu: 3 günün 1.582 varışı", "60 sn bütçede 1.399 davet, kalanı 30 dk sonra (arka planda)"),
    ("KVKK silme turu (200 belge)", "34 ms"),
  ),
  olcek-not: [Ölçüm `scripts/perf-guest-portal.mjs`: 550.500 rezervasyonlu ölçüm otelinde 30.000 bağlantı, 18.000 online check-in, 36.000 belge satırı her çalıştırmada baştan kurulur. Ölçümle yapılan iyileştirmeler: liste 0,2–0,3 sn → 30–50 ms (giriş günü kayıtta, indeksli; sayımlar ve sayfa birleştirmesiz), arama 0,9–1,8 sn → 30–50 ms (onay kodu ve adlar kayıtta, trigram indeksli); davet işi tur başına 100 rezervasyonla sınırlıyken zaman bütçeli döngüye çevrildi — büyük otelde günün bütün varışları bir turda.],
  test-notu: [Sözleşme birim testleri: dil seçimi, açılış penceresi (açılmadı, kapalı ayar, iptal, giriş yapılmış, çıkış günü, geç gelen, düzeltme), portalın kapanışı, metin önceliği ve otelin saatleri, zorunlu fotoğraf ve sınır, gönderim şeması (onaylar, T.C. kimlik denetimi, aynı fotoğraf, plaka), ayar şeması (adres), giriş penceresinin ön dolumu. Hız sınırı (birim): aynı ağdaki iki misafir birbirinin kotasını yemez, bağlantı değiştirerek deneme IP tavanına takılır; belirteç günlükte maskeli. Ön yüz: misafir uygulamasının sınırları ve belge numarası kuralı sözleşmeyle aynı, dört dilin anahtarları eşit. Entegrasyon (gerçek PostgreSQL): bağlantı (imza, yenileme, başka otel), zorunlu fotoğraf ve kişi sayısı, gönderim ve resepsiyon zili, işlem kaydında kimlik numarası yok, misafire maskeli / personele tam, düzeltme → yeniden gönderim (eski fotoğraf ve imza silinir), sürüm kilidi, onay, giriş günü eşitlemesi ve süzgeç, giriş olayıyla tamamlanma ve geri alma, pencere (henüz değil, iptal), folyo / istek / oda servisi, davet (bir kez, uzaktaki gelmez, elle ve sıklık, iletişimsiz misafirde harcanmaz, iptal edilen bağlantıya gitmez, kanal yokken tur başlamaz), folyoda acente penceresi gizli ve dövizli / iptal edilen ödeme, KVKK silmesi, ayarlar ve izinler, eşzamanlı gönderim.],
  degistir: (
    ("Portala yeni sayfa", "`guest/src/App.jsx` `PORTAL_PAGES`'e satır (yol, menü adı, simge, görünürlük) + bileşen; metinleri `messages.js`'e dört dilde (test eşitliği denetler); gerekirse `public.js`'e uç ve `features` alanı."),
    ("Yeni dil", "`GUEST_PORTAL_LANGUAGES` + `guestPortalLanguageFor` + varsayılan metinler (sözleşme), `PORTAL_LANGUAGES` + `messages.js` (misafir uygulaması), migration'daki dil kısıtı."),
    ("Kartla ödeme (50) ve dijital anahtar (62)", "`portalOverview` `features.payOnline` / `features.digitalKey` ve ana sayfadaki kutular; ödeme sağlayıcısının bağlantısı ya da anahtar sağlayıcısının uçları."),
    ("KBS (58)", "Online check-in'in kimlikleri giriş penceresiyle misafir kartına geçer; KBS bildirimi girişin kaydından."),
  ),
  devir: (
    "*50 (sanal POS):* online check-in'de \"kartla ön ödeme\" ve portalda \"kartla ödeme\" pasif; provizyon / ödeme bağlantısı 50'nin sağlayıcısıyla (kart numarası hiçbir tabloda tutulmaz).",
    "*62 (dijital anahtar):* portal ana sayfasındaki kutu ve `features.digitalKey`.",
    "*FlexAI 2.0:* upsell (83), tesis rezervasyonu (99), hediye çeki (84), konaklama ortası nabız (81) portalın sayfa kaydına eklenir.",
    "*Yayın:* misafir uygulaması `dist/misafir`'e derlenir; sunucu derin bağlantıyı tanımazsa panelin sayfası misafiri `/misafir/index.html`'e yönlendirir (nginx ayarı gerekmez). Portal adresi ve web sohbetinin izinli adresleri ayardan.",
  ),
)
