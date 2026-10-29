#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Sistemi arka planda işleten otomatik aktörler — oda atayan, folyoya ücret işleyen, bildirim gönderen, kanaldan rezervasyon alan işçiler ve yapay zekâ ajanları — tek ekranda görünür. Yönetici bir aktörü gerekçesiyle kapatabilir; kapalı aktörün işi kaybolmaz, "manuel görev" olarak yetkili personelin önüne düşer. Yapay zekâ ajanlarının günlük harcaması ve bütçesi aynı panelde.],
  rakam: (("Aç / kapa", "gerekçeli, izli, anında etkili"), ("0 kayıp", "kapalı aktörün işi göreve düşer"), ("Tek kişi", "aynı görevi iki kişi üstlenemez"), ("Günlük özet", "AI maliyeti birkaç düzine satırdan")),
  adimlar: (("Olay", "ör. rezervasyon açıldı"), ("Aktör açık mı?", "her olayda okunur"), ("Açık", "iş kendiliğinden yapılır"), ("Kapalı / hata", "manuel görev"), ("Personel", "üstlen · tamamla")),
  ozellik: (
    ("Aktör listesi", "Türkçe ad, tür, paket, açık / kapalı (kim, ne zaman, neden kapattı), son 24 saatte iş / uyarı / hata, son iş, açık görev, arka plan sırası."),
    ("\"Kapatırsam ne olur?\"", "İşlerin hangi manuel göreve düşeceği ve yayınladığı olayları bekleyen diğer aktörler, bildirgeden hesaplanıp kapatmadan önce gösterilir."),
    ("Aktör detayı", "Dinlediği / yayınladığı olaylar (kim yayınlıyor, kim dinliyor), onay gerektiren işler, yeniden deneme politikası, son 10 iş — zincire bağlantılı."),
    ("Manuel görevler", "İşin modülüne yetkili personele görünür; üstlen, bırak, tamamla (not), \"gerek kalmadı\" (gerekçe zorunlu). Menüde rozet, zilden doğrudan göreve."),
    ("AI ajan kartı", "Model, otelin günlük bütçesi (çubukta ajanın payı koyu), bugünkü ve dönem maliyeti, çağrı başına ortalama, gün gün çubuk, model kırılımı."),
    ("Kurulu olmayan aktör", "Sunucuda anahtar yoksa AI ajanları sebebiyle \"kurulu değil\" görünür; ayarı yine değiştirilebilir."),
  ),
  neden: [Otomasyon kara kutu değildir: neyin otomatik yapıldığı, neyin durduğu ve kimin üstlendiği görünür; bir aktör arızalansa da otel durmaz, iş insana geçer.],
  rol: (([Yönetici], [Aktörleri açar / kapatır.]), ([Müdür], [Paneli ve kullanımı görür.]), ([İlgili personel], [Kendi modülünün manuel görevlerini üstlenir ve tamamlar (ör. oda atama görevini oda yetkilisi).])),
  baglantilar: ("*Konuşarak rezervasyon (8):* AI ajanları kapatılırsa yeni konuşmalar personelde açılır; bütçe aynı otel geneli bütçe.", "*Onay kuyruğu (11):* aktörün onay gerektiren işleri bildirgesinden okunur, kartta \"onay gerektiren işler\" olarak görünür.", "*Aktivite (10):* aç / kapa akışa uyarı satırı yazar; son işler zincire bağlanır.", "*Bildirim (9):* görev açılınca zil uyarısı.", "*Günlük durum (13):* \"bekleyen işler\" kutusu manuel görev özetinden."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Aktör altyapısı `shared/actor-kit`: `defineActor` bildirgesi (ad, `title`, `packageName`, dinlediği / yayınladığı olaylar, `requiresApproval`, yeniden deneme politikası, `fallbackModule`), `ActorRegistry`, `BaseWorker` (idempotency `ProcessedEvent`, kapalıyken `ManualTask`, yeniden deneme, `ActivityLog` izi) ve `BaseLlmAgent` (bütçe → çağrı → kullanım kaydı). Bu modül panel API'lerini (`modules/actors`), manuel görev API'lerini (`modules/manual-tasks`) ve günlük kullanım özetini ekler. Aktör ayarı her olayda veritabanından okunur: kapatılan aktör bir sonraki olayda durur.],
  kural: (
    ("Aç / kapa", "Ayrı uçlar (`POST /actors/:ad/enable|disable`); ayar satırı kilitlenir. İki yönetici aynı anda \"kapat\" derse sonuç yine kapalı, ikinci istek iz bırakmaz. Denetim izine ve aktivite akışına yazılır, olay `actor.setting.changed`."),
    ("Görev işlemleri", "Her işlem satırı kilitler: aynı görevi iki kişi üstlenemez, ikinci \"tamamla\" 409 alır; kapanmış görev yeniden açılmaz (veritabanı kısıtı). Başkasının üstlendiği görev yine tamamlanabilir (iş acil; izde tamamlayan yazar)."),
    ("Görev görünürlüğü", "Modül → izin eşlemesi `MANUAL_TASK_MODULE_PERMISSIONS` (sözleşme); bilinmeyen modülün görevi yalnız ayar yöneticisine görünür."),
    ("Kişisel veri", "Liste olay gövdesi taşımaz; görev açılınca gövde maskesiz gelir — işi yapacak kişinin misafir iletişim bilgisine ihtiyacı var ve zaten o modülün yetkisine sahip."),
    ("AI kapalıysa", "`aiActiveFor` ajanların açık olmasını da arar: AI misafire cevap vermez, her mesaj ayrı göreve düşmez; AI ayar ekranı bunu uyarı olarak gösterir."),
  ),
  tutarlilik: (
    "Her model çağrısı `LlmUsage` satırına ek olarak `LlmUsageDaily`'ye (otel × iş günü × ajan × model) aynı transaction'da sayılır; bütçe denetimi ve kullanım ekranları satırları değil özeti toplar.",
    "Açık görevler `closedAt IS NULL` kısmi, otel kapsamlı index'lerden (zaman / modül / aktör); durum ↔ kapanış anı ↔ üstlenen tutarlılığı veritabanı kısıtı.",
    "Özet sayısı kişinin izin kapsamıyla, otel başına dakikada tek sorgu (önbellek); olaylar `manual_task.created|updated`, canlı kanal `manual-tasks.changed`.",
  ),
  degistir: (
    ("Yeni aktör", "`defineActor` ile `title` ve `packageName` verin; `fallbackModule` adını izniyle `MANUAL_TASK_MODULE_PERMISSIONS`'a ekleyin. Onay isteyecekse işi `requiresApproval` listesine yazın."),
    ("Kapatma etkisi", "\"Kapatırsam ne olur\" bildirgeden hesaplanır (`actors/rules.js`, birim testli); bildirgedeki olay listeleri doğru tutulmalı."),
  ),
  devir: ("`ActorSetting.dailyTokenBudget` kullanılmıyor: bütçe modül 8'deki otel geneli USD bütçesi (ajan başına bütçe ayrı karar).", "Arka plan sırası süreç içidir; birden fazla sunucuda panel isteğin düştüğü sunucunun sırasını gösterir.", "Migration `LlmUsage` büyükse bakım penceresinde uygulanmalı."),
)
