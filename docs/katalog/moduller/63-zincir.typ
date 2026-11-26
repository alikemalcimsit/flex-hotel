#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Birden çok oteli olan işletme, her otelin yazılımına ayrı ayrı girip rakamları elle toplamak zorunda kalmamalı. Zincir konsolu otelleri tek panelde birleştirir: zincir yöneticisi üst bardaki otel seçiciyle oteller arasında geçer, zincir panosunda bu gecenin doluluğunu ve gelirini otel otel görür, zincir raporunda istediği dönemi geçen yılla karşılaştırır. Yeni otel, var olan bir otelin ayarları kopyalanarak birkaç dakikada açılır. Kişiler de merkezden yönetilir: bir müdür ana otelinden çıkmadan başka bir otele, o otele özgü rolle erişebilir.],
  rakam: (("1 oturum", "oteller arası geçiş"), ("5 ayar grubu", "yeni otele kopyalanır"), ("200 otel", "zincir başına"), ("Her istekte", "erişim denetimi")),
  adimlar: (("Zincir", "kur · adlandır"), ("Otel", "sihirbaz · var olanı ekle"), ("Erişim", "kişi · otel · rol"), ("Seçici", "üst barda geçiş"), ("Pano", "bu gece · otel otel"), ("Rapor", "dönem · geçen yıl")),
  akis-aciklama: [Oturum her zaman bir otelde açıktır: giriş kişinin ana oteline açılır. Kişinin başka otellere erişimi varsa üst barda otel seçici görünür; seçilen otel için yeni bir oturum verilir, rol ve yetkiler o otelin kendi rol matrisinden gelir. Ana otel dışındaki oturum her istekte erişimle yeniden doğrulanır: erişim kaldırılınca bir sonraki işlemde kişi ana oteline döner ve bunu ekranda görür. Zincir panosu ve raporu yalnız kişinin zinciri görme yetkisi olan otellerden toplanır; para birimleri ayrı toplanır.],
  ozellik: (
    ("Otel seçici", "Üst barda, erişilen otel iki ve üstüyse görünür: ana otel önce, sonra erişimler; otelin kodu, oradaki rol ve zincir adı. Sekiz otelden sonra arama kutusu. Geçişte açık ekranlar, bildirimler ve canlı bağlantı yeni otele göre yenilenir; telefonda üst barın altında tam genişlik açılır."),
    ("Zincir panosu", "Bu gece: doluluk (satılan / satılabilir oda), gelecek, gidecek, konaklayan, oda geliri, ADR, RevPAR — otel otel ve zincir toplamı. Gecikmiş giriş / çıkış ayrıca işaretlenir; satırdan o otele geçilir. İki dakikada bir tazelenir; her otel kendi iş gününde."),
    ("Zincir raporu", "Seçilen dönemde otellerin karşılaştırması: doluluk, satılan / satılabilir oda, oda geliri, toplam gelir, ADR, RevPAR ve geçen yılın aynı dönemine göre değişim (haftanın aynı günü). Hazır dönemler (bu ay, geçen ay, son 30 gün, önümüzdeki 30 gün, yılbaşından bugüne, son 12 ay); Excel'e aktarma."),
    ("Yeni otel sihirbazı", "Üç adım: otelin kimliği (ad, kod, para birimi, saat dilimi, iletişim) → kaynak otel ve kopyalanacaklar (genel parametreler, oda tipleri, vergiler, sezonlar, rol ve izin matrisi) → özet. Para birimi farklıysa oda tipleri ve tutarlı ayarlar kopyalanmaz, ekranda söylenir. Kuran kişi yeni otelin yöneticisi olur ve tek tıkla yeni otele geçer."),
    ("Var olan otel", "Kişinin yönetici olduğu, zincirde olmayan otel zincire eklenir; otel zincirden çıkarılabilir (verisi ve erişimler kalır). Son otel çıkınca zincir kendiliğinden silinir."),
    ("Merkezi kullanıcı yönetimi", "Zincirdeki bütün kişiler tek listede: ana otel ve rolü, zincirdeki erişimleri; otele göre süzme ve arama. Kişiye başka bir otelde rol verilir, değiştirilir, kaldırılır; zincirden doğrudan yeni kullanıcı açılır. Ana oteldeki rol yine kullanıcılar ekranından değişir."),
  ),
  neden: [Zincir yönetiminde iki risk vardır: rakamların elle toplanması (yanlış, geç) ve yetkilerin dağınık yönetilmesi (bir otelden ayrılan kişinin başka otelde açık kalan hesabı). Konsol ikisini de kapatır: rakamlar her otelin kendi hesabından, aynı kuralla gelir; erişim tek yerde verilir, tek yerde kaldırılır ve kaldırıldığı an etkili olur. Bir otelde yönetici olmak başka bir otelde yetki vermez: her otelde yetki o otelin kendi rol matrisinden okunur, kimse kendi erişimini büyütemez, yönetici erişimini yalnız o otelin yöneticisi verir.],
  rol: (
    ([Yönetici], [Zinciri kurar, yeni otel açar, var olan oteli ekler / çıkarır; yönettiği otellerde kişilere erişim verir, rolünü değiştirir, kaldırır; zincirden kullanıcı açar.]),
    ([Müdür], [Zincir panosunu, raporunu ve otel listesini görür (erişimi olan ve orada zinciri görme yetkisi olan oteller); erişimi olan otellere geçer.]),
    ([Diğer roller], [Erişim verildiyse otel seçiciyle o otele geçer; orada o otelin rol matrisindeki yetkilerle çalışır. Zincir ekranlarını görmez.]),
  ),
  baglantilar: (
    "*Kullanıcılar ve roller (2, 11):* her otelin rol matrisi ayrı; erişim o otelin matrisinden yetki alır. Son yöneticiyi koruma kuralı erişimle gelen yöneticileri de sayar.",
    "*Ayarlar (1):* sihirbaz genel parametreleri, oda tiplerini, vergileri, sezonları ve rol matrisini kaynak otelden kopyalar.",
    "*Günlük durum (13) ve gelir raporu (23):* pano ve rapor her otel için aynı hesaplarla.",
    "*Canlı bağlantı ve uyarılar (9, 10):* bağlantı kimliği ve oteli oturumdan alır; geçişte yeni otelin odasına katılır.",
    "*Göç sihirbazı (69), otel açılış asistanı (77):* aynı \"ayarları kopyalayarak otel aç\" servis fonksiyonunu kullanacak.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Sözleşme: `contracts/chain.js` (izin kuralları `roleInHotel`, `membershipChangeError`, `hotelAttachError`; kopyalama grupları; sınırlar; panel şemaları). Sunucu: `modules/chain` (`access.js` kişinin otellerdeki rolü ve yetkisi, `hotels.js` zincir / otel listesi / sihirbaz / ekleme-çıkarma, `users.js` merkezi kullanıcılar, `overview.js` pano ve rapor, `rules.js` alan listeleri ve toplama), `lib/memberships.js` (erişim rolü, önbellek, oturum rolü). Oturum: `modules/auth` (`/auth/hotels`, `/auth/switch-hotel`, yenilemede ana otele dönüş). Ekran: `layout/HotelSwitcher.jsx`, `pages/chain`. Şema: `HotelGroup`, `UserHotel`, `Hotel.groupId`.],
  kural: (
    ("Oturum", "Token: `userId`, `hotelId` (açık otel), `homeHotelId`, `role`. Ana otelin token'ında rol token'dan; başka otelin token'ında her istekte `UserHotel`'den (`sessionRole`, 30 sn önbellek, değişiklikte commit sonrası silinir). Erişim yoksa istek kimliksiz kalır (401). Ana otel bilgisi olmayan eski token'lar ana otelindir."),
    ("Geçiş", "`/auth/switch-hotel`: yenileme token'ı kişinin kendisinin ve geçerli olmalı (401); hedef otele erişim (403 — otel yoksa da aynı cevap). Eski yenileme token'ı iptal, hedef otel için yenisi. İstemci önce erişim token'ını tazeler, yenileme token'ını sonra okur."),
    ("Yenileme", "Yenileme token'ı otelini taşır; o otele erişim kalktıysa oturum ana otelde açılır. İstemci oturumun oteli seçici dışında değişince uyarır ve ana sayfaya döner."),
    ("Erişim verme", "`membershipChangeError`: kendi erişimine dokunulmaz; ana otel erişimle verilmez; hedef otelde `users.manage` gerekir; yönetici rolünü yalnız o otelin yöneticisi verir / değiştirir / kaldırır. Kişi başına kilit (`pg_advisory_xact_lock`), sınır kilit altında sayılır. Değişiklikte kişinin o oteldeki soketleri kesilir (yeni rolle bağlanır)."),
    ("Son yönetici", "Ana oteldeki son yönetici kuralı erişimle gelen aktif yöneticileri de sayar. Kişi pasife alınırken, erişimle tek yöneticisi olduğu otel varsa reddedilir (iki toplu sorgu)."),
    ("Pano / rapor", "Zincirin otelleri, kişinin o otelde `chain.view` taşıdığı otellerle süzülür (gizlenen sayı döner). Her otel `getDashboardToday` / `getRevenueReport` ile, aynı anda en çok 4; hata veren otel toplamdan çıkar ve sayılır. Toplamlar para birimine göre, oranlar toplamlardan (ortalamaların ortalaması değil)."),
    ("Sihirbaz", "`createHotelFromTemplate(tx, { identity, source, copy, groupId })` dışa açık servis. Alanlar açık liste (`HOTEL_GENERAL_FIELDS`, `TEMPLATE_FIELDS`); yeni Hotel / şablon sütunu eklenince birim test hangi listeye ait olduğunu sorar. Para birimi farklıysa oda tipi kopyası reddedilir, tutarlı alanlar atlanır, sabit ücret \"ücret yok\"a döner. Kod sistemde tekil (409). Zincir başına kilit, otel sınırı kilit altında."),
    ("Soket", "Bağlantı erişim token'ıyla doğrulanır (önceden istemcinin söylediği e-posta); token'sız ya da geçersiz bağlantı hiçbir odaya katılmaz. Her bağlantı denemesinde istemci taze token gönderir."),
  ),
  tutarlilik: (
    "*Tek kural iki yerde:* erişim verme kuralı sözleşmede; ekran düğmeleri ve sunucu aynı fonksiyonu çağırır.",
    "*Tek oturum rolü:* HTTP isteği ve soket bağlantısı rolü aynı yardımcıdan (`sessionRole`) alır.",
    "*Personel kimliği:* `currentStaff` ve ad çözümlemesi (işlem kaydı, aktör paneli, görevler, vardiya) erişimle gelen kişiyi de tanır; atama listeleri ana otelin kadrosudur.",
    "*İz:* zincir kurma / adlandırma, otel açma / ekleme / çıkarma, erişim verme / değiştirme / kaldırma denetim kaydına geçer.",
  ),
  olcek: (
    ("Başka otelde her istek", "önbellekten rol (30 sn), değişiklikte hemen"),
    ("Otel seçici listesi", "sayfalı (50), aramalı"),
    ("Merkezi kullanıcı listesi", "(ad, id) imleci; indeks `User(hotelId, name)`"),
    ("Pano / rapor", "otel başına hesap, en çok 4 paralel"),
    ("Zincir sınırı", "200 otel, kişi başına 200 erişim"),
  ),
  olcek-not: [Erişim denetimi her istekte yapılır ama veritabanına her istekte gitmez: süreç içi önbellek erişim değişince silinir. Birden fazla sunucu sürecinde bu silme süreçler arası yayılmalı (şimdilik en geç 30 sn). Ana otelin token'ındaki rol 15 dakikalık token ömrü boyunca geçerlidir (önceki davranış).],
  test-notu: [Sözleşme: rol çözümü, erişim verme kuralları (kendine dokunma, ana otel, yönetme izni, yönetici rolü), ekleme kuralı, şemalar. Backend birim: alan listelerinin şemayı kapsaması ve yabancı anahtar taşımaması, para birimi farkında atlanan alanlar, eşzamanlılık sınırlı hesap, toplamlar, imleç; soket: token'la oda, başka otelin token'ı, token'sız / eski istemci. Entegrasyon (gerçek PostgreSQL, 11): oturumun oteli, geçiş (403 / 401 / rol / eski token iptali), erişim kaldırılınca 401 ve ana otele dönüş, rol yükseltmenin hemen etkisi, zincir kurma / sürüm, sihirbaz kopyası ve para birimi kuralı, pano / rapor gizleme, erişim verme yükseltme kuralları ve imleç, zincirden kullanıcı açma, ekleme / çıkarma / zincir silme, personel kimliği, pasife almada son yönetici.],
  degistir: (
    ("Yeni kopyalanacak ayar", "`HOTEL_COPY_GROUPS` + etiket / açıklama, `TEMPLATE_FIELDS`'a model ve alanlar; `createHotelFromTemplate`'e kopya satırı."),
    ("Yeni Hotel sütunu", "Birim test `HOTEL_GENERAL_FIELDS`'a mı yoksa kopyalanmayanlara mı ait olduğunu sorar."),
    ("Panoya yeni gösterge", "`getDashboardToday` alanı + `dashboardTotalsByCurrency` toplamı + pano sütunu."),
  ),
  devir: (
    "*69 (göç sihirbazı):* eski sistemden gelen otel `createHotelFromTemplate` ile açılır, ardından veri yüklenir.",
    "*77 (otel açılış asistanı):* yapay zekâ asistanı aynı servis fonksiyonunu çağırır.",
    "*Birden fazla sunucu süreci:* erişim önbelleğinin silinmesi süreçler arası yayın (Redis / PostgreSQL LISTEN) ister.",
  ),
)
