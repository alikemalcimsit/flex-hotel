#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Rezervasyon açılınca onay, oda verilince oda bilgisi, girişte "hoş geldiniz", çıkışta teşekkür mesajı misafire kendiliğinden gider — SMS ya da e-postayla, misafirin dilinde. Metinler ekrandan düzenlenir; her gönderim denemeleri ve hatasıyla izlenir, ulaşmayan mesaj sessizce kaybolmaz. Personel için üst barda zil: cevapsız misafir mesajı, acil ya da geciken istek, elle yapılması gereken iş, misafire ulaşmayan bildirim.],
  rakam: (("16", "hazır metin: 4 olay × 2 kanal × 2 dil"), ("5 deneme", "geçici hatada 30 sn → 30 dk arayla"), ("Şifreli", "kanal parolaları AES-256-GCM"), ("Tek uyarı", "aynı konu zilde birleşir")),
  adimlar: (("Olay", "onay · oda · giriş · çıkış"), ("Şablon", "kanal · dil · değişken"), ("Kuyruk", "metin dondurulur"), ("Gönderici", "SMTP · Netgsm"), ("Sonuç", "teslim · hata · zil")),
  akis-aciklama: [Gönderim isteğin yolunda değildir: ekran beklemez, sağlayıcı yavaşsa ya da kapalıysa kuyruk tekrar dener.],
  ozellik: (
    ("Şablon editörü", "Olay × kanal × dil başına tek metin; `{misafirAdi}`, `{odaNo}`, `{tarih}` gibi değişken çipleri, örnek değerlerle önizleme, kaydedilmemiş değişiklik uyarısı."),
    ("SMS sayacı", "Netgsm kuralına göre karakter ve parça sayısı (Türkçe harf 2 karakter, en çok 6 parça); desteklenmeyen karakter şablona yazılamaz."),
    ("Gönderim geçmişi", "Kanal, alıcı, durum, hata; özet kutuları süzgeç olarak çalışır. Detayda giden metnin tam hâli ve bütün denemeler; tekrar gönder / iptal."),
    ("Akıllı yeniden deneme", "Geçici hatada 5 denemeye kadar; yanlış parola gibi kalıcı hatada hemen vazgeçer ve yöneticinin ziline \"misafire ulaşmadı\" düşer."),
    ("Sessiz saatler ve tercih", "Otel isterse 22:00–08:00 arası SMS sabah gider. Misafir bir kanalı istemiyorsa o kanaldan gönderilmez, kayıtta \"gönderilmedi\" görünür."),
    ("Zil", "Uyarı kişiye ya da bir yetkiye gider; aynı konu tek uyarıda birleşir, kişi türleri susturabilir, 30 gün saklanır."),
  ),
  neden: [Misafir doğru bilgiyi kendi dilinde, doğru zamanda alır; gitmeyen mesaj fark edilmeden kalmaz — yöneticinin önüne düşer.],
  rol: (([Yönetici, müdür], [Şablonları ve kanal ayarlarını düzenler, iptal / tekrar gönderir.]), ([Ön büro], [Gönderim geçmişini görür.]), ([Bütün personel], [Kendi zil uyarılarını görür, okur, susturur.])),
  baglantilar: ("*Rezervasyon (4), check-in / out (6):* rezervasyon onayı, oda ataması, giriş ve çıkış olayları bildirimi kendiliğinden başlatır.", "*Mesajlar (7):* cevapsız mesaj ve acil / geciken istek zile düşer.", "*Konuşarak rezervasyon (8):* WhatsApp gönderimi o modülün geçidinden yapılacak; ikinci bir gönderici kurulmaz.", "*Aktör paneli (12):* aktörün personele bıraktığı iş zilden göreve götürür.", "*Onay kuyruğu (11):* \"onay bekliyor\" ve \"süresi doldu\" uyarıları."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Olay → `notification-worker` aktörü (`enqueueTriggerNotifications`) → `Notification` kuyruğu (metin kuyruğa girerken dondurulur; şablon sonra değişse de giden metin görülür) → `dispatcher.js` (satırı `FOR UPDATE SKIP LOCKED` ile üstlenir, HTTP isteğinin yolunda değil) → sağlayıcı adaptörü (`providers/`: SMTP, Netgsm; kayıt noktası `registerNotificationProvider`) → `notification.sent` / `failed`. Netgsm teslim raporu 2 dakikada bir sorulur (`DELIVERED` / `FAILED`). Zil ayrı bir yapıdır (`staff-alerts.js`): uyarı satırı bir kişiye ya da bir izne yazılır, okunma `StaffAlertRead`, rozet için son görülme `StaffAlertState` tablosunda.],
  kural: (
    ("Durum makinesi", "`PENDING → SENDING → SENT → DELIVERED`, ya da `FAILED` / `CANCELLED`; durum ile zaman alanlarının tutarlılığı veritabanı kısıtıyla korunur."),
    ("Yeniden deneme", "30 sn / 2 dk / 10 dk / 30 dk, en çok 5 deneme; `ProviderError({ retryable: false })` hemen vazgeçer. Gönderim ortasında kapanan süreç: 5 dk sonra satır sıraya geri alınır."),
    ("Oda bilgisi", "Yalnız giriş günü ya da misafir içerideyken gider; olay geç işlendiyse ve oda yine değiştiyse eski oda gönderilmez (`triggerSkipReason`)."),
    ("Dil", "Türk ya da uyruğu bilinmeyen misafire Türkçe, diğerlerine İngilizce; İngilizce metin kapalıysa Türkçeye düşer."),
    ("SMS güvenliği", "Misafir adındaki yabancı harfler karşılığına çevrilir (`smsSafeVariables`); sessiz saatte sıraya giren SMS bitişte gider (`smsQuietHours`)."),
    ("Tekrar ve iptal", "Tekrar gönderim yeni kayıt açar ve misafir kartındaki güncel adrese gider; yalnız sıradaki bildirim iptal edilir, sebep zorunlu. Kanal testi tekrar gönderilmez, zil açmaz, özete girmez."),
  ),
  tutarlilik: (
    "Aynı olay iki kez işlense de ikinci bildirim açılmaz: `dedupeKey` kısmi tekil index'i (`notificationDedupeKey`).",
    "İki gönderici süreci aynı satırı alamaz (`SKIP LOCKED`); başarısızlık uyarısı aynı gün aynı hata için tek (`failureAlertKey`).",
    "Kanal parolası şifreli saklanır ve hiçbir cevapta dönmez; `SETTINGS_SECRET_KEY` yoksa ekran kaydın neden olmadığını söyler.",
    "2.500 personel: uyarılar kişi başına çoğaltılmaz; rozet sunucudan bir kez (görülmemiş kimlikler, 99 üst sınır) gelir, sonra socket haberiyle artar — haber yalnız kimlik + kime taşır. Özet 5 dk + rastgele payla tazelenir.",
    "Hız sınırı IP + personel başına (`RATE_LIMIT_MAX`, varsayılan 600/dk); nginx arkasında gerçek IP için `TRUST_PROXY` ve `X-Forwarded-For`.",
  ),
  degistir: (
    ("Yeni bildirim olayı", "`contracts/notifications.js → NOTIFICATION_TRIGGERS` + etiket, aktörün dinlediği olay (`lib/actors.js`), varsayılan metin (`ensureDefaultTemplates`) ve `rules.js` atlama kuralı."),
    ("Yeni kanal sağlayıcısı", "`providers/index.js → registerNotificationProvider({ channel, name, send })`; `send` `{ providerMessageId }` döner, hata `ProviderError(message, { code, retryable, configIssue })`."),
    ("Yeni zil türü", "`STAFF_ALERT_KINDS` (sözleşme) ve olay kataloğundaki `staff.alert.raised` birlikte; `alert-kinds.test.js` ikisinin eşit olduğunu denetler."),
  ),
  devir: ("WhatsApp adaptörü modül 8'in geçidine kaydolacak; Meta onaylı şablon eşlemesi geçidin işi. Şablonlar şimdiden düzenlenebilir.", "Bildirimler bilgilendirme amaçlıdır; İYS (ticari ileti) filtresi yoktur.", "Üretimde `SETTINGS_SECRET_KEY` (32 bayt base64) gerekir; anahtar değişirse kayıtlı parolalar yeniden girilir."),
)
