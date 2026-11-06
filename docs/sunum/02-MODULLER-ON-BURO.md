# 02 — Modüller: Ön Büro + Operasyon (Modül 1–22)

> Her modül için: **Ne yapar** · **Gün sonu** (kullanıcı eline ne geçer) · **Kilit kurallar** · **Hangi aktör** · **Demo değeri**. İşaretler: ✅ Tam · ⚠️ Kısmi · ❌ Yol haritası.

---

## M1 — Ayarlar / Parametreler ✅
**Ne yapar:** Otelin tek doğruluk kaynağı — otel bilgisi, oda tipleri, vergiler, sezonlar, politikalar (iptal, overbooking, giriş-çıkış saati, kimlik).
**Gün sonu:** 5 tanım ekranı dolu; tüm modüller aynı taban fiyat, sezon çarpanı, para birimini kullanır.
**Kilit kurallar:** Sezon çakışması DB `Season_no_overlap` kısıtıyla engellenir. Rezervasyon/folyo varsa para birimi kilitli (`CURRENCY_LOCKED`). Kullanımdaki oda tipi kapasitesi düşürülemez (`CAPACITY_IN_USE`). Silinen vergi geçmiş folyoyu bozmaz. Sezon yoksa çarpan `'1'`.
**Aktör:** `rate.changed` olayını kanal aktörü (M33) dinler.
**Demo değeri:** Orta — temel, ama "her şey buradan besleniyor" mesajı için önemli.

## M2 — Kullanıcı, Rol, Yetki (RBAC) ✅
**Ne yapar:** Her personel kendi hesabıyla girer; 77+ ayrı izin her istekte **sunucuda** denetlenir.
**Gün sonu:** JWT + rotation'lı refresh token; otelin kendi rol→izin matrisi; hassas işlem yalnız yetkilide ve izli.
**Kilit kurallar:** Gövdeye bağlı ek yetki (örn. elle fiyat ayrı izin ister). Enumeration koruması. Parola hash'i audit'e asla sızmaz. Son aktif ADMIN kilitlenemez. Yeni modül izni rol varsayılanına düşer (herkese kapalı kalmaz).
**Demo değeri:** Orta — "kat görevlisi parayı göremez" sorusuna cevap burada.

## M3 — Oda Müsaitlik & Atama ✅
**Ne yapar:** "15–18 Ekim kaç Standart boş?" sorusunu rezervasyon + arıza + atanmamış talebi birlikte hesaba katarak anında cevaplar; oda kendiliğinden/elle atanır.
**Gün sonu:** Oda tipi × gece müsaitlik tablosu; çifte satış DB garantisiyle sıfır.
**Kilit kurallar:** Müsaitlik gece gece oda seviyesinde (tek geçişte bit alanı — 90 gece × 1500 oda ≈ 135 KB). Konaklama müsaitliği = gecelerin en düşüğü. Overbooking gizlenmez, **negatif** gösterilir. İki arıza tipi: `OUT_OF_ORDER` envanterden düşer, `OUT_OF_SERVICE` düşmez ama atanamaz. Otomatik atama insanın seçeceğini seçer (bugün gelen için önce temiz+boş).
**Aktör:** `room-worker` — `reservation.created` dinler, oda seçer, `room.assigned` yayınlar; kapalıysa manuel görev.
**Demo değeri:** Yüksek — "çifte satış imkânsız" hikayesinin temeli.

## M4 — Rezervasyon ✅
**Ne yapar:** Tek/gruplu rezervasyon tek formda; sistem müsaitlik + gece gece fiyatı hesaplar, misafiri tanır, iptal/no-show'u politikadan bulur.
**Gün sonu:** Canlı önizlemeli açma/düzenleme/iptal/no-show, grup, bekleme listesi; çifte gönderim/satış sıfır.
**Kilit kurallar (PARA):** Gece fiyatı = `taban × o geceye düşen sezon çarpanı`, kuruşa yuvarlı; toplam = yuvarlanmış gecelerin toplamı. Uzatmada eski geceler yeniden yazılmaz. İptal: girişe `policyDays` günden az kala `penaltyPct` ceza. No-show = ilk gece fiyatı. Açmada `lockRoomTypes` + aynı transaction overbooking kontrolü. Çift gönderim koruması `requestId` (201/200/202). Kimlik eşleştirme: telefon/e-posta + ad aynıysa kart kullanılır, farklıysa personele sorulur. Onay kodu telefonda karışmayan alfabeden, kriptografik, tekil.
**Aktör:** `reservation-worker` kanaldan gelen isteği aynı kurallardan geçirir; yer yoksa → onaya → onaylanınca **aynı requestId** ile açılır.
**Demo değeri:** Çok yüksek — çekirdek iş akışı.

## M5 — Oda Planı / Takvim ✅
**Ne yapar:** Tüm odalar + konaklamalar tek canlı takvimde (satır=oda, sütun=gece); **sürükle-bırakla oda değişimi**, boş hücreden rezervasyon.
**Gün sonu:** 7/14/30 günlük canlı takvim, oda bekleyenler şeridi, günlük özet.
**Kilit kurallar:** Kendi tablosu yok — okuma katmanı. Oda değiştirmiş misafir iki bar (geçmiş yeniden yazılmaz). `IN_HOUSE_MOVED` aynı transaction'da eski odayı boş+kirli, yeni odayı dolu yapar. Bitmiş konaklamanın ataması kaldırılamaz.
**Aktör:** Canlı yayın (`lib/realtime.js`) — değişiklik socket'e düşer, panel tazeler; tazeleme ≤8 sn'ye dağıtılır (2500 panel aynı anda sorgu atmasın).
**Demo değeri:** Çok yüksek — **sürükle-bırak en görsel an.**

## M6 — Check-in / Check-out ✅
**Ne yapar:** Tek adımda giriş/çıkış; sistem oda hazırlığını, erken/geç ücreti, bakiyeyi denetler.
**Gün sonu:** Tek tıkla giriş/çıkış; oda durumu + folyo otomatik.
**Kilit kurallar (PARA/ZAMAN):** Saat **daima otelin saati** (DST-doğru). Erken giriş = ilk gece fiyatı, geç çıkış = son gece (sabit/yüzde). Erken ayrılış: ileri geceler envantere döner + fiyattan düşer, personel onaylı. **Fiyat tutarlılığı:** istemci gördüğü ücreti gönderir, sunucu farklı hesaplarsa `FEE_CHANGED` (sessiz yanlış tutar yok). Açık bakiyeyle çıkış engelli; yalnız özel yetkili gerekçeyle, yönetime zil. Kimlik maskeli (ilk 3 + son 2), tamamı yalnız giriş önizlemesinde. Geri alma yalnız aynı gün.
**Aktör:** `billing-worker` folyo açar/kapatır; `room-worker` doluluğu yazar (tek yazıcı).
**Demo değeri:** Çok yüksek — günlük operasyonun kalbi.

## M7 — Misafir Mesaj / İstek ✅
**Ne yapar:** Tüm WhatsApp/web-sohbet tek gelen kutusunda; istekler (havlu/arıza/uyandırma/şikâyet) süreli görev olarak izlenir.
**Gün sonu:** Tüm konuşmalar tek yerde; istekler SLA'lı görev.
**Kilit kurallar:** Gelen mesajın HTTP ucu YOK (sahte mesaj koruması). Personel AI konuşmasına yazınca mod `MANUAL`'a geçer. SLA: acil 15 / yüksek 30 / normal 60 / düşük 240 dk. Telefon eşleştirme ülke kodu duyarlı. Teslim durumu yalnız ileri gider.
**Aktör:** `guest.request.created` → housekeeping/teknik servis görevleri.
**Demo değeri:** Yüksek — WhatsApp benzeri gelen kutusu tanıdık ve etkileyici.

## M8 — Konuşarak Rezervasyon (AI Concierge) ✅
**Ne yapar:** Misafir sohbete "15–18 Ekim 2 kişilik" yazar; AI müsaitlik+fiyat söyler, teklif sunar, **açık onayda** rezervasyon açar, oda atanır, onay kodu yazılır.
**Gün sonu:** 7/24 AI rezervasyon; belirsizlik/şikâyet personele.
**Kilit kurallar:** **Onay olmadan talep YOK** — dört koşul birlikte: (1) teklif sunulmuş, (2) önceki turda sunulmuş (misafir görmüş), (3) router "evet" saymış, (4) başka bekleyen istek yok. Gönderimden hemen önce fiyat/müsaitlik **yeniden** denetlenir. Tur başına max 5 model çağrısı. Sınırlar → personele: 30 gece / 10 kişi / 540 gün. Teklif ömrü 30 dk. Günlük AI bütçesi; dolunca personele. Onay kodu/tutar **şablondan, modelden değil.**
**Aktör:** `router-agent` (niyet) + `concierge-agent` + `budget-agent` — yalnız `OPENAI_API_KEY` varsa.
**Demo değeri:** Çok yüksek — ama ⚠️ demoda AI anahtarı + kanal durumu kontrol edilmeli (bkz. `05-DEMO-REHBERI.md`).

## M9 — Bildirim Merkezi ✅
**Ne yapar:** Misafire SMS/e-posta (kendi dilinde) otomatik; personele üst-bar zili.
**Gün sonu:** Her gönderim loglu, retry'lı; şablonlar ekrandan.
**Kilit kurallar:** Kuyruk + arka plan `FOR UPDATE SKIP LOCKED` (çok-örnekli güvenli); giden metin kuyruğa girerken dondurulur. Akıllı retry 30sn→2dk→10dk→30dk, 5 deneme; kalıcı hatada "ulaşmadı" zili. Oda bilgisi yalnız giriş günü. Dil: Türk/bilinmeyen→TR, diğer→EN. Sessiz saat (22:00–08:00) SMS bekler. Opt-out (KVKK). Kanal parolası AES-256-GCM.
**Aktör:** `notification-worker` — bildirimi kuyruğa yazar; gönderimi backend göndericisi yapar.
**Demo değeri:** Orta.

## M10 — Aktivite + Audit + İşlem Zinciri ✅
**Ne yapar:** Sistemin kara kutusu — Olaylar (EventLog), İşleyişler (ActivityLog), Değişiklikler (AuditLog) + **`correlationId` zinciri** (işlem ağacı).
**Gün sonu:** "WhatsApp mesajından folyoya" kadar kim-ne-ne zaman tek ağaçta.
**Kilit kurallar:** Audit değişiklikle **aynı transaction'da.** Kayıtlar **silinmez** (immutable defter). Kimlik/telefon/e-posta maskeli; eski/yeni değerler yalnız `audit.view`. Zincir ağacı saf fonksiyonla + döngü koruması. Tüm listeler imleçli (milyonluk tablo).
**Demo değeri:** Teknik izleyiciye yüksek — "sistem neyi neden yaptığını gösterebiliyor."

## M11 — Onay Kuyruğu (Human-in-the-loop) ✅
**Ne yapar:** Aktörün/servisin "yetkili karar versin" dediği yer (iade, büyük ödeme, overbooking, folyo iptali); onaylanınca iş **kaldığı yerden otomatik tamamlanır.**
**Gün sonu:** Riskli işler tek listede; onayla → devam eder; kimse karar vermezse süre dolar + zil.
**Kilit kurallar:** Onay açma HTTP ucu yok (yalnız servis/aktör). Devam **bus'a değil, isteyene, aynı olay kimliğiyle.** Tam-bir-kez devam (`resumedAt`). Dört göz: isteyen kendi isteğini onaylayamaz. Yarış: satır kilidi + tekil kısıt. Süre dolumu `FOR UPDATE SKIP LOCKED`.
**Demo değeri:** Yüksek — kurumsal kontrol hissi. Detay ve dürüstlük notu `01-MIMARI.md` §3.

## M12 — Aktör Paneli ✅ (otonomi kumanda merkezi)
**Ne yapar:** Otonom ağın kumandası — her aktör sağlıklı mı, ne yaptı, **kapatırsam ne durur**, LLM günlük maliyeti bütçeye karşı.
**Gün sonu:** Yönetici "dijital ekibi" tek ekrandan açıp kapatır.
**Kilit kurallar:** Aç/kapa iki ayrı uç (anahtar değil). Ayar her olayda DB'den okunur (anında etki). "Kapatırsam ne olur" bildirgeden **kodsuz** hesaplanır. Sağlık: UNAVAILABLE / OFF / ERROR / WARN / OK / IDLE.
**Kayıtlı 11 aktör:** room, reservation, housekeeping, billing, accounting, channel-sync, notification, whatsapp-gateway, webchat-gateway, router, concierge, budget (AI'lar yalnız anahtar varsa).
**Demo değeri:** Çok yüksek — **ürünün imza ekranı, farklılaştırıcı.**

## M13 — Günlük Durum (Dashboard) ✅
**Ne yapar:** Müdürün sabah ekranı — doluluk (dün kıyaslı), satılabilir oda, gelen/giden, gelir (kesin+opsiyonlu), ADR, RevPAR, oda durumu, arıza, sistem sağlığı.
**Gün sonu:** Tek bakışta otel sağlığı + finans.
**Kilit kurallar (PARA):** Tek doğruluk kaynağı (sayılar asla ayrışmaz). **Gelir/ADR/RevPAR vergiler HARİÇ** (otelcilik standardı; dahil göstermek geliri ~%12 şişirir). ADR = gelir / satılan gece (gece yoksa null); RevPAR = gelir / satılabilir oda. Overbooking negatif gösterilir. Farklı para birimleri toplanmaz. Önbellek canlı sürüm anahtarıyla.
**Demo değeri:** Çok yüksek — açılış ekranı, otelcinin dilinden KPI.

## M14 — Housekeeping ✅
**Ne yapar:** Çıkan oda otomatik temizlik listesine düşer, atanır, "Bitti" + şef onayından geçince tekrar satılabilir.
**Gün sonu:** Çıkan oda otomatik listede; "temizledim" denince satılabilir.
**Kilit kurallar:** Görev odanın durumunu **yazmaz** (tek yazıcı = housekeeping-worker). Akış DIRTY→CLEANING→CLEAN→INSPECTED. STAYOVER sabah planı. Oda başına tek açık görev. **Dört göz: temizliği yapan onaylayamaz.** Oda doluluğu ile temizlik durumu **bağımsız** (dolu oda da kirli olabilir).
**Aktör:** `housekeeping-worker`.
**Demo değeri:** Yüksek — rol ayrımı (şef / görevli) güzel.

## M15 — Folyo ✅ (para çekirdeği)
**Ne yapar:** Her konaklamanın hesabı tek ekranda; oda ücreti her gece otomatik, harcamalar otomatik, canlı vergi önizlemeli elle ekleme, bölme/birleştirme/transfer. **Kalem asla silinmez** (iptal = onaylı ters kayıt).
**Gün sonu:** Hesap tek ekranda; bölme/birleştirme/transfer çalışır.
**Kilit kurallar (PARA — formüller):** Satır: net = **brüt ÷ (1 + Σ dahil oran)**; dahil vergi = brüt − net (yuvarlamayı son vergi yutar, kuruş kaybı yok); hariç vergi = net × oran; toplam = brüt + hariç. **Bakiye = Σ kalem − Σ POSTED ödeme** (folyo kilitliyken yeniden hesap). Gece uzlaştırma: işlenmemiş gece→NIGHT, fiyat değişti→ADJUSTMENT. **Çift yazım koruması:** `nightSourceKey` tekil. İptal = ters kayıt, iptal günü tarihli.
**Aktör:** `billing-worker` (kapalıysa manuel görev, çift yazmaz).
**Demo değeri:** Yüksek — finansal derinlik.

## M16 — Fatura (folyo → fatura) ❌ YOL HARİTASI
Ekran yazılmadı. **Altyapı hazır:** folyo kapanınca `folio.closed` olayı + vergi dökümü (`chargeLine`) zaten çalışıyor. **Demoda "fatura kesme" gösterme** — "folyo kapanışı ve vergi dökümü hazır, fatura ekranı yol haritasında" de.

## M17 — Ödeme ✅ (para çekirdeği)
**Ne yapar:** Nakit/kart/havale/döviz tahsilat; ön ödeme/teminat otomatik; eşik üstü onaya; ödeme silinmez.
**Gün sonu:** Tahsilat/iade/döviz; büyük tutar onaya; kasa anlık.
**Kilit kurallar (PARA):** Döviz: `folioAmount = ROUND(tutar × kur, 2)`, her ödeme kendi kurunu saklar. Kur yaşı: en çok 3 gün eski, ileri tarihli yok, form kuru ≠ sunucu → `RATE_CHANGED`. Büyük ödeme eşiği → onaya (eşik 0 = onay yok). İade sınırı = işlenmiş net − bekleyen iadeler; iadesi yapılmış ödeme iptal edilemez. Çok folyoda folyo seçilmeden ödeme yok.
**Aktör:** `billing-worker` teminatı ödemeye çevirir, bitmiş folyoyu kapatır.
**Demo değeri:** Yüksek — "ödeme al" demo adımı.

## M18 — Vardiya / Kasa Kapama (Night Audit) ❌ YOL HARİTASI
Ekran yazılmadı. **Altyapı hazır:** kasa özeti (`getCashSummary`) + gecelik oda ücreti (`runRoomCharges`) + garson vardiyası modeli + iş günü kilidi tek fonksiyonda hazır. **Demoda gösterme.**

## M19 — Çamaşır / Minibar ✅
**Ne yapar:** Kat görevlisi minibar tüketimini telefondan girer → folyoya düşer; çamaşır siparişi (alındı→yıkamada→hazır→teslim) teslimde folyoya işlenir.
**Gün sonu:** Minibar/çamaşır geliri kaçaksız folyoya.
**Kilit kurallar:** Kime yazılır: IN_HOUSE / LATE (son 24 saatte ayrılan) / NONE (gerekçe zorunlu). Fiş silinmez. Çamaşır fiyatı sipariş anında donar; ekspres farkı ayrı satır. Çift teslim koruması. `minibar.consumed`/`laundry.charged` → folyo aktörü.
**Demo değeri:** Orta.

## M20 — Teknik Servis / Arıza-Bakım ❌ YOL HARİTASI
Ekran yazılmadı. **Altyapı hazır:** oda arıza bloğu (`RoomBlock`) + "sorun var → manuel görev" köprüsü çalışıyor. **Demoda gösterme.**

## M21 — Kayıp Eşya ✅
**Ne yapar:** Bulunan eşya fotoğraflı + etiketli (`LF-XXXXXX`) kaydedilir; sistem sahip adayını önerir; elden (kimlikle) ya da kargoyla teslim.
**Gün sonu:** "Eşyamı kim aldı" fotoğraf+teslim iziyle kesin cevaplanır.
**Kilit kurallar:** Aday eşleştirme konaklama geçmişinden, ayrılışa yakınlığa göre. Zaman aşımı ayardan hesaplanır (ayar değişince tüm açık eşyalara anında). Değerli eşya kimliksiz verilmez. İletişim bilgisi yalnız teslim yetkisine. Fotoğraf imza+boyut doğrulu, 30 gün sonra silinir.
**Demo değeri:** Orta — hoş bir ek, "düşünülmüş" izlenimi.

## M22 — CRM / Misafir Kartı ❌ YOL HARİTASI
Ayrı ekran yazılmadı. **Altyapı hazır:** mükerrer misafir önleme + konaklama geçmişli arama çalışıyor (rezervasyonda misafir eşleştirme bunu kullanır). **Demoda ayrı "CRM" modülü gösterme.**

---

## Bu grubun sunum özeti

**Tam ve testli (18 modül):** 1–15, 17, 19, 21.
**Yol haritası (4 modül, altyapısı hazır):** 16 Fatura, 18 Night audit, 20 Teknik servis, 22 CRM.

**Vurgulanacak 5 çarpıcı özellik:**
1. Çifte satış matematiksel olarak imkânsız (uygulama kilidi + DB EXCLUDE kısıtı).
2. Otonom dijital ekip — ama tam geri çekilebilir ve şeffaf (aktör paneli).
3. 7/24 konuşarak rezervasyon — AI yalnız açık onayda rezervasyon basar.
4. Kasa açığı yapısal olarak kapalı (kalem/ödeme silinmez, bakiye hep yeniden hesaplanır, dört göz her yerde).
5. İşlem zinciri = tam izlenebilirlik (WhatsApp'tan folyoya tek ağaç).
