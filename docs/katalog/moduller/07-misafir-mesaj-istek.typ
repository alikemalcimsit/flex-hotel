#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Misafirle yapılan bütün WhatsApp ve web sohbet konuşmaları tek gelen kutusunda toplanır; personel konuşmayı devralıp elle cevaplar. Havlu, temizlik, uyandırma, arıza gibi istekler süreli görev olarak açılır, atanır, izlenir ve kapanır — gecikme gizlenemez.],
  rakam: (("Tek kutu", "WhatsApp + web sohbet"), ("Süreli", "istek: acil 15 dk … düşük 4 sa"), ("Canlı", "rozet, ses, sekme sayısı")),
  ozellik: (
    ("Gelen kutusu", "Görünümler: açık, cevap bekleyen, bana atanan, atanmamış, kapalı. Kanal ikonu, misafir, son mesaj, okunmamış sayısı."),
    ("Konuşma detayı", "Balonlar (misafir / personel / AI / sistem), iç notlar, teslim durumu (gönderildi → iletildi → okundu)."),
    ("Manuele al", "Personel yazınca AI modundaki konuşma personele geçer; asistan o konuşmaya karışmaz."),
    ("Mesajdan istek", "Tek tıkla istek; konuşma odaya / konaklamaya bağlanır."),
    ("Süreli görevler", "Önceliğe göre hedef süre; zamanlı işte istenen saat. Başlatılmış işi geri almak süreyi sıfırlamaz."),
    ("Misafiri tanıma", "Telefon otelin ülke koduyla karşılaştırılır; son rakamları aynı başka ülke numarası eşleşmez."),
  ),
  rol: (([Ön büro / misafir ilişkileri], [Konuşmaları cevaplar.]), ([Kat hizmeti, teknik], [İstekleri görür ve yürütür; konuşmaları görmeyebilir.])),
  baglantilar: ("*Konuşarak rezervasyon (8):* kanal geçitleri ve AI asistanı bu gelen kutusuna bağlanır.", "*Oda servisi (41):* istek siparişe çevrilir; teslimde istek kapanır.", "*Bildirim (9):* zil uyarıları."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Gelen kutusu kanaldan bağımsız: kanal geçidi `receiveInboundMessage` ile mesaj yazar (HTTP ucu yok — imza doğrulaması geçidin), personel / AI cevabı `guest.message.reply` olayıyla geçide gider, sonuç `markMessageDelivery` ile işlenir (durum yalnız ileri gider). AI kaydı `registerAutoResponder`; cevap `appendAiReply` (konuşma personele geçtiyse 409 `CONVERSATION_MANUAL`).],
  kural: (
    ("Durum geçişi", "Tek kural: `guestRequestTransitionError` (sözleşme); iptal sebep ister."),
    ("Hizmet süresi", "`GUEST_REQUEST_SLA_MINUTES`: acil 15, yüksek 30, normal 60, düşük 240 dk; tamamlanmış işi yeniden açmak süreyi sıfırlar."),
    ("Çakışma koruması", "Konuşma yönetimi `expectedStateVersion` (misafirin yazması çakışma sayılmaz); istek işlemleri `expectedUpdatedAt`."),
    ("Tekrar gönderim", "Aynı istemci kimliğiyle ikinci gönderim yeni mesaj yazmaz (çift tık, ağ tekrarı); aynı webhook iki kez gelirse tek kayıt."),
    ("Saatler", "Otelin saat diliminde girilir ve gösterilir (`zonedWallTimeToUtc`; yaz saati geçişleri testli)."),
  ),
  tutarlilik: ("Rozet ve sekme sayıları iki parçalı önbellekte: otel geneli (sürüm + dakika anahtarlı) ortak, \"bana atanan\" kişi başına.", "Gelen kutusu ilk sayfası ve aramasız istek listeleri sürüm anahtarlı önbellekte; canlı haberde yalnız açık konuşmanın geçmişi tazelenir."),
  degistir: (
    ("Yeni istek kategorisi", "Sözleşmede kategori + etiket; ekran çipleri listeden üretilir."),
    ("Yeni kanal", "`lib/channels.js → registerChannel`; gelen / giden sözleşmesi yukarıdaki gibi."),
  ),
)
