#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Yönetici otelde olan biteni canlı izler: hangi otomatik aktör hangi olayı işledi, ne kadar sürdü, hata var mı. Bir rezervasyonun bütün işlem zinciri — açılış, oda ataması, bildirim, folyo — tek tıkla, sıralı ve süreleriyle görünür. Denetim kaydı her değişikliği kişi, zaman, eski ve yeni değerle saklar; silinmez.],
  rakam: (("Canlı", "akış 500 ms'lik paketlerle"), ("Tek tık", "rezervasyonun işlem zinciri"), ("Eski → yeni", "her değişikliğin alan alan izi"), ("Maskeli", "telefon, e-posta, kimlik, kart")),
  adimlar: (("İşlem", "personel ya da aktör"), ("Denetim izi", "aynı transaction'da"), ("Olay", "outbox → dağıtım"), ("Aktör", "işler · süre · deneme"), ("Zincir", "hepsi tek kimlikte")),
  akis-aciklama: [Her HTTP isteği bir zincir kimliği alır; o istekten doğan bütün değişiklikler, olaylar ve aktör işleri aynı kimliği taşır.],
  ozellik: (
    ("Canlı akış", "Olaylar insan diliyle, aktörüyle; duraklat, okunan yeri korur, \"N yeni\" düğmesiyle yeniler."),
    ("Sorunlar süzgeci", "Tek tıkla yalnız uyarı + hata; aktör kapalıyken ya da iş sırası taşınca akışa uyarı satırı düşer."),
    ("Olay günlüğü", "Sistemdeki bütün olaylar; \"dağıtılmamış\" süzgeci yayınlanamamış olayları gösterir."),
    ("Zincir görünümü", "Olay → onu işleyen aktör → aktörün yazdığı değişiklik ve yayınladığı olay; ağaç hâlinde, süreleriyle."),
    ("Denetim kaydı", "Kim, ne zaman, hangi kayıt, hangi alan: eski → yeni. \"Bu kişinin değişiklikleri\", \"bu kaydın geçmişi\" tek tıkla."),
    ("Paylaşılabilir", "Süzgeçler adres çubuğunda; bağlantıyı gönderen aynı görünümü açar. Rezervasyon detayında \"İşlem zinciri\"."),
  ),
  neden: ["Bu rezervasyona neden oda atanmadı?" sorusu tahmine değil kayda dayanır; "kim değiştirdi" tartışması biter.],
  rol: (([Yönetici, müdür], [Akışı ve olayları izler.]), ([Yönetici, müdür], [Denetim kaydını ve değişikliklerin eski / yeni değerlerini görür. İki izin rol matrisinde ayrı ayrı verilebilir.])),
  baglantilar: ("*Rezervasyon (4):* detayda \"İşlem zinciri\" düğmesi.", "*Aktör paneli (12):* aktörün son işleri zincire bağlanır.", "*Ayarlar (1):* denetim izi, zincir kimliği ve olay outbox'ı bu modülde kuruldu.", "*Bütün modüller:* değişiklik, denetim izi ve olay aynı transaction'da yazılır; biri yazılamazsa hiçbiri yazılmaz."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Altyapı modül 1'de kuruldu: `AuditLog` değişiklikle aynı transaction'da (`lib/audit.js`), zincir kimliği `AsyncLocalStorage` ile çağrı ağacında taşınır (`x-correlation-id` başlığı dışarı da verilir), olaylar outbox olarak `EventLog`'a yazılır ve commit sonrası dağıtılıp işaretlenir. Bu modül okuma API'lerini, canlı akışı ve zincir kurucuyu ekler. Canlı akış: satır yazılınca süreç içi yayın (`lib/activity-stream.js`) → socket köprüsü 500 ms'de bir, otel başına *yalnız kimlikleri* ve seviye sayılarını gönderir → panel satırları aynı süzgeçle HTTP'den çeker (`ids` parametresi). Socket el sıkışması kimlik doğrulamadığı için içerik socket'ten hiç gönderilmez.],
  kural: (
    ("Bağlam düzeltmesi", "İstek bağlamı `onRequest` kancasının başında kurulur, kimlik doğrulanınca güncellenir. Önceden `enterWith` await'lerden sonra kurulduğu için HTTP değişikliklerinde kişi `system` görünüyordu; eski satırlar geriye dönük düzeltilemez."),
    ("Zincir ağacı", "`causationId`, aktör adı ve işleyiş süresiyle kurulur; bozuk kayıtta döngü koruması; her kaynaktan en çok 500 adım."),
    ("Maskeleme", "Olay gövdesindeki telefon, e-posta, kimlik, kart numarası maskelenir (`redactPayload`, sözleşmede)."),
    ("Yetki ayrımı", "Zincirdeki değişikliklerin eski / yeni değerleri yalnız `audit.view` iznine; `activity.view` yalnız adımı görür."),
    ("Aktör izi", "Her aktivite satırı olay adını ve zincir kimliğini taşır; geçici hatadan sonra başaran işin deneme sayısı izde."),
  ),
  tutarlilik: (
    "İşlem içinde yazılan satır commit'ten sonra yayınlanır (`writeWithEvents` → `afterCommit`): geri alınan işlem akışta hiç görünmez.",
    "İzleyen yoksa toplama yapılmaz; 200 kimliği aşan pakette panel listeyi baştan yükler.",
    "Otel kapsamlı imleç index'leri: aktivite (zaman / aktör / olay / seviye), olay (zaman / ad), denetim (zaman / kişi / kayıt türü / kayıt). Eski otel kapsamsız index'ler kaldırıldı.",
  ),
  degistir: (
    ("Yeni kayıt türünü denetle", "Yazan servis `recordAudit(tx, { hotelId, entity, entityId, action, before, after })` çağırır; ekrandaki Türkçe ad `AUDIT_ENTITY_LABELS`'a."),
    ("Yeni hassas alan", "`redactPayload` (sözleşme) kural listesine; birim testi `contracts/activity.test.js`."),
  ),
  devir: ("Saklama süresi yok: denetim kaydı silinmez; eski aktivite / olay satırları için politika kararı gerekir.", "Migration index'leri büyük tabloda kilitle oluşur — bakım penceresinde uygulanmalı."),
)
