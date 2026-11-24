#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Misafir çıkış yaptıktan sonraki gün, otelin belirlediği saatte, kendi dilinde kısa bir anket alır: oteli tavsiye etme olasılığı (NPS), oda, temizlik, personel, giriş-çıkış, yiyecek-içecek ve fiyat / kalite puanları, açık uçlu iki soru. Konaklama içinde de, girişin ertesi günü bir iki soruluk "Her şey yolunda mı?" anketi gider: sorun misafir otelden ayrılmadan çözülsün. Düşük puan resepsiyonun ya da müdürün ziline düşer ve bir takip kaydı açar: kim üstlendi, misafirle ne konuşuldu, nasıl kapandı. Rapor NPS'i, bölüm puanlarını ve eğilimi gösterir; yapay zekâ yorumları konu ve tonla etiketler, dönemin ana temalarını örnek alıntılarla özetler.],
  rakam: (("NPS", "bölüm puanları, eğilim"), ("Dört dil", "uyruğa göre açılır"), ("Takip", "içeride 2 saat, çıkmışta 48 saat"), ("AI", "konu, ton, dönem özeti")),
  adimlar: (("Çıkış", "ertesi gün, otelin saatinde"), ("Anket", "NPS · puanlar · yorum"), ("Teşekkür", "yorum bağlantıları"), ("Düşük puan", "zil · takip kaydı"), ("Görüşme", "not · sonuç"), ("Rapor", "NPS · temalar")),
  akis-aciklama: [Anket otelin açık bildirim kanallarından (e-posta, SMS) kendiliğinden gider; bağlantı misafire özeldir ve süreyle sınırlıdır. Aynı misafire ayardaki günden sık anket gitmez (her hafta gelen kurumsal misafir her konaklamada anket almaz). Anketi bitiren her misafire, puanından bağımsız, otelin Google ve TripAdvisor yorum bağlantıları gösterilir; yalnız memnun misafire göstermek Google kurallarına aykırıdır ve yorumların silinmesine yol açabilir.],
  ozellik: (
    ("Çıkış sonrası anket", "Tavsiye (0–10), bölüm puanları (1–5 yıldız), seyahat amacı, en çok beğenilen ve geliştirilecek olan. Sorular otelin: eklenir, düzenlenir, sıralanır; dört dilde yazılır, yazılmayan dilde Türkçesi görünür."),
    ("Ara anket", "Girişin ertesi günü, en kısa konaklamadan uzun kalan misafire; ayrılış gününe gitmez. Düşük puan içerideki misafir için kritik uyarıdır: hedef iki saat."),
    ("Düşük puan takibi", "NPS eşiğin (varsayılan 6) ya da herhangi bir puan eşiğin (varsayılan 2) altındaysa takip açılır, zile düşer. Takip üstlenilir ya da devredilir; misafirle görüşme ve notlar değişmez kayıttır; kapatırken sonuç (özür, telafi, sorun giderildi, açıklama, ulaşılamadı) ve nasıl kapandığı yazılır."),
    ("NPS raporu", "Dönem ve anket türüne göre NPS ve dağılımı, cevap oranı (davet / açılan / cevaplanan), puan ortalaması, haftalık ya da aylık eğilim, soru başına ortalama ve dağılım, bölüm puanları, açık takipler."),
    ("Yapay zekâ", "Her yoruma ton (olumlu, nötr, olumsuz, karışık), en fazla beş konu ve tek cümlelik Türkçe özet; dönem için ana temalar (pay, örnek alıntı) ve en fazla üç öneri. Model misafirin adını, rezervasyon kodunu, iletişim bilgisini görmez. AI kapalıysa anket ve rapor eksiksiz çalışır."),
    ("Misafir portalında", "Açık anket misafir portalında da bir kutu olarak görünür: e-postayı kaçıran misafir portaldan ulaşır."),
  ),
  neden: [Misafirin memnuniyetsizliği çoğu zaman otelden ayrıldıktan sonra yorum sitesinde öğrenilir; o noktada düzeltmek için geç kalınmıştır. Ara anket sorunu konaklama içinde yakalar, çıkış sonrası anket memnuniyeti ölçülebilir kılar (NPS sektörün ortak dilidir), takip kaydı her düşük puana birinin sahip çıkmasını sağlar. Yorumları tek tek okumak büyük otelde mümkün değildir: yapay zekâ konuları ve tonu etiketler, müdüre dönemin ana temalarını ve önerileri verir.],
  rol: (
    ([Misafir], [Bağlantıyla anketi kendi dilinde doldurur; bitince yorum bağlantılarını görür.]),
    ([Resepsiyon], [Cevapları ve raporu görür; içerideki misafirin düşük ara anketini üstlenir, görüşür, kapatır.]),
    ([Müdür / misafir ilişkileri], [Soruları ve ayarları yönetir, takipleri izler ve devreder, AI dönem özeti ister.]),
  ),
  baglantilar: (
    "*Otomatik bildirimler (9):* \"Çıkış sonrası anket\" ve \"Ara anket\" şablonları (e-posta, SMS), `{anketLinki}` değişkeniyle; kanal ve şablon otelin ayarından.",
    "*Misafir portalı (53):* anket sayfası misafir uygulamasında (`/misafir/a/…`); açık anket portalın ana sayfasında kutu; bağlantının tabanı portal adresi.",
    "*Check-in / check-out (6):* çıkış anı çıkış sonrası anketin, giriş anı ara anketin zamanını belirler.",
    "*Zil (9):* düşük puan \"Ankette düşük puan\" uyarısıyla takibe götürür.",
    "*Yorum ve duygu analizi (54):* aynı geri bildirim ajanı (insight-agent) yorum sitelerindeki yorumları da etiketleyebilir.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/surveys`: tasarım ve ayarlar (`design.js`: varsayılan anket kurulumu, soru ekle / düzenle / sırala / arşiv, AI kullanılabilirliği), davet işi (`invites.js`), misafir uçları (`public.js`: form, gönderim, düşük puanda takip + zil), cevaplar ve rapor (`responses.js`: liste, ayrıntı, NPS raporu, AI etiketi ve dönem özetinin girdisi / sonucu), takip (`followups.js`), zamanlanmış iş (`jobs.js`), imzalı bağlantı ve saat yardımcıları (`shared.js`). Sözleşme `contracts/surveys.js` (dört dilde varsayılan sorular, NPS, cevap denetimi ve özeti, gönderim zamanı, şemalar). Ajan `shared/agents/insight-agent` (şemalı JSON çıktı, listeyle sınırlanan ayrıştırma). Misafir sayfası `frontend/guest/src/pages/SurveyPage.jsx`.],
  kural: (
    ("Bağlantı", "`/misafir/a/<davet kimliği>.<imza>`; imza JWT sırrından anket bağlamıyla türetilen anahtarla (portal ve oda servisinden ayrı) HMAC, sabit zamanlı karşılaştırma. Rezervasyon × tür başına tek davet (tekil kısıt); bağlantı `linkValidDays` gün geçerli. Anket ekranları bağlantıyı personele göstermez (giden iletinin metni bildirim geçmişinde durur)."),
    ("Gönderim zamanı", "Çıkış sonrası: çıkış anının otel günü + `postStayDelayDays`, saat `postStaySendHour`'dan itibaren; iş gecikirse en fazla iki gün geç. Ara anket: giriş anının otel günü + 1, saat `midStaySendHour`'dan itibaren, en az `midStayMinNights` gece, ayrılış gününe değil. Zaman gerçek saat (gece kapanışına bağlı değil)."),
    ("Davet", "Aynı misafire aynı tür anket `minDaysBetweenSurveys` günden sık değil; aynı turda aynı misafirin iki odası tek anket. Bir kanala satır açılmazsa (iletişim yok, kanal kapalı) davet silinir, pencere sürüyorsa sonraki turda yeniden. Açık kanal + etkin şablon ya da portal adresi yoksa tur başlamaz."),
    ("Cevap", "Davet başına bir cevap (tekil kısıt; eşzamanlı ikinci gönderim \"zaten cevaplandı\"). Zorunlu soru boş, aralık dışı puan, yabancı seçenek, tekli soruda iki seçenek reddedilir (alan alan); anket bu arada değiştiyse \"yenileyin\". Özet (NPS, kategori, ortalama, düşük, yorum) cevapta donar. İşlem kaydına yorum metni yazılmaz."),
    ("Takip", "Düşük cevapla aynı işlemde açılır; hedef içeride 2, çıkmışta 48 saat. Üstlenme, kapatma, yeniden açma `updatedAt` ile iyimser kilitli; kapalıya not yazılmaz; kapanışta sonuç ve açıklama zorunlu (veritabanı kısıtı)."),
    ("Tasarım", "Anketin `version`'ıyla iyimser kilit (iki yönetici aynı anda düzenlerse ikincisi \"yenileyin\"). Tek NPS sorusu; en fazla 20 soru, 10 seçenek. Cevaplanmış soru silinmez (arşiv), tipi değişmez, cevaplanmış seçeneği kaldırılamaz."),
    ("AI", "Yorumlu cevap AI açıksa `survey.analysis.requested`; ajan yalnız puanları ve yorumu görür, ton ve konu listeyle sınırlanır, yalnız bekleyen cevaba yazılır; 30 dakikada yazılmazsa \"etiketlenemedi\". Dönem özeti en yeni 150 yorumla (her biri 400 karakter), aynı dönem için bekleyen tek istek (kısmi tekil index), istemek `surveys.setup` ister."),
    ("Misafir uçları", "Oturumsuz; bağlantı başına hız sınırı (okuma 30, yazma 5 / dk), üstünde ortak IP tavanı; belirteç istek günlüğünde maskelenir; yanıt `no-store`, `no-referrer`."),
  ),
  tutarlilik: (
    "*Tekillik:* rezervasyon × tür başına tek davet, davet başına tek cevap, cevap başına tek takip, cevapta soru başına tek satır.",
    "*Sürüm:* anket tasarımı `version`, ayar ve takip `updatedAt` ile iyimser kilitli.",
    "*Veritabanı kısıtları:* ayar sınırları, dil listesi, NPS 0–10 ve kategorisiyle birlikte, ortalama 1–5, takipte kapanış alanları birlikte, özet döneminde başlangıç ≤ bitiş.",
    "*Zaman:* ham SQL'de anlar UTC duvar saati, kovalar otelin saat dilimine çevrilerek.",
  ),
  olcek: (
    ("Rapor: 30 gün · 1 yıl", "151 · 183 ms"),
    ("Cevaplar: ilk sayfa · düşük puan · konu · arama · derin sayfa", "18 · 9 · 10 · 12 · 15 ms"),
    ("Ayrıntı · takip listesi · soru tasarımı", "9 · 15 · 7 ms"),
    ("Misafir: form · gönderim (cevap + takip + zil)", "9 · 86 ms"),
    ("AI özetinin girdisi (1 yıl, en yeni 150 yorum)", "193 ms"),
    ("Davet turu: dünün 400 çıkışı", "19 sn, 394 davet (arka planda, 15 dk'da bir)"),
  ),
  olcek-not: [Ölçüm `scripts/perf-surveys.mjs`: ölçüm otelinde iki yıl — 150.000 davet, 60.000 cevap, 534.000 cevap satırı, 7.600 takip — her çalıştırmada baştan kurulur. Ölçümle yapılan iyileştirmeler: 1 yıllık rapor 0,4–0,6 sn → 0,18 sn (soru başına puan dökümü ve davet sayımı yalnız indeksten okunur, seçenek dökümü yalnız seçenekli soruların satırlarından), soru tasarımı 0,2 sn (geçmişle büyüyordu) → 7 ms (soru başına sayım 1.000'de kesilir).],
  test-notu: [Sözleşme birim testleri: NPS kategorisi ve skoru, cevap denetimi (zorunlu, aralık, seçenek, tekli / çoklu, bilinmeyen soru), cevabın özeti ve düşük puan, gönderim zamanı (çıkış sonrası saat ve gecikme payı, ara anket ve kısa konaklama), varsayılan soruların dört dilde tamlığı, şemalar. Ajan: istemde kişisel veri yok, ayrıştırmanın listeyle sınırlanması, AI kapalı / bozuk çıktı / ajan kapalıyken isteğin askıda kalmaması. Entegrasyon (gerçek PostgreSQL): davet zamanı ve sıklık sınırı, iletişimsiz misafir, ara anket ve portal kutusu, misafirin formu ve gönderimi (imza, dil, zorunlu, tek gönderim, süre, değişen anket), düşük puanda takip + zil + işlem kaydında yorum yok, liste süzgeçleri ve rapor, takibin akışı ve sürüm kilidi, tasarımın kuralları, AI sonucunun sınırlanması ve özet girdisinde kişisel veri olmaması, ayarlar ve izinler.],
  degistir: (
    ("Yeni soru tipi", "`SURVEY_QUESTION_TYPES` + `surveyAnswerProblems` / `scoreSurveyResponse` (sözleşme), Prisma enum'u, misafir sayfasında bileşen, rapor dağılımı."),
    ("Yeni konu", "`SURVEY_TOPICS` ve etiketi; ajan listeyi sözleşmeden alır (istem değişmez)."),
    ("Yeni anket türü", "`SURVEY_KINDS`, Prisma enum'u, bildirim tetikleyicisi ve şablonu, gönderim kuralı (`invites.js`), varsayılan sorular."),
  ),
  devir: (
    "*54 (yorum ve duygu analizi):* insight-agent'ın istemleri ve ayrıştırması kaynaktan bağımsız; yorum siteleri için yeni olay adıyla bağlanır.",
    "*FlexAI 2.0:* misafir ilişkileri panosu (ara anket ≤ 3 sinyali, `survey.response.submitted`), konaklama ortası nabız (81), tercih çıkarma (anket yorumundan aday tercih).",
  ),
)
