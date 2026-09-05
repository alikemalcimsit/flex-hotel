# HotelOS — Modül Modül Geliştirme Maddeleri

Tarih: 5 Eylül 2026
Paylaşım: **Tek numaralar = arkadaşın, çift numaralar = Ali Kemal.**
Her modülde: **Gün sonu** = modül bitince elinde ne olacak. Altındaki maddeler = yapılacak işler, sırayla.
"Backend" = API + servis + tablo. "Ekran" = React sayfası. "Aktör" = worker/agent kodu.

---

## 1. ÖN BÜRO (temel)

### 1. Ayarlar / parametreler — arkadaşın
**Gün sonu:** Admin, oteli tanımlayabiliyor: oda tipleri, vergiler, sezonlar, otel bilgileri girilmiş; rezervasyon modülü bu tanımları kullanabiliyor.
- [ ] Backend: RoomType, Tax, Season, Hotel için listele / ekle / düzenle / sil API'leri
- [ ] Ekran: Otel bilgileri formu (ad, adres, telefon, logo, para birimi, saat dilimi, check-in/out saati)
- [ ] Ekran: Oda tipleri listesi + form (kod, ad, yetişkin/çocuk kapasitesi, taban fiyat, açıklama)
- [ ] Ekran: Vergiler listesi + form (ad, oran, fiyata dahil mi)
- [ ] Ekran: Sezonlar listesi + form (ad, başlangıç, bitiş, çarpan)
- [ ] Ekran: Genel parametreler (iptal politikası, para birimi, varsayılan pansiyon)
- [ ] Sidebar'a "Ayarlar" menüsü, sadece ADMIN görür

### 2. Kullanıcı, rol, yetki (RBAC) — Ali Kemal
**Gün sonu:** Personel kendi hesabıyla giriyor; rolüne göre menüler ve işlemler kısıtlı. Kat görevlisi folyoyu göremiyor, resepsiyon fatura silemiyor.
- [ ] Backend: gerçek login (e-posta + şifre → JWT + refresh), logout, refresh, `/me`
- [ ] Backend: User CRUD API'leri (ekle, düzenle, pasife al, şifre sıfırla)
- [ ] Backend: izin listesi tanımı (örn. `reservation.create`, `folio.view`, `invoice.cancel`) ve rol → izin eşlemesi
- [ ] Backend: `requirePermission('...')` hook'u; her route'a eklenir
- [ ] Ekran: Login sayfasını gerçek API'ye bağla (çatıdaki sahte girişi değiştir)
- [ ] Ekran: Kullanıcı listesi + form (ad, e-posta, rol, aktif)
- [ ] Ekran: Rol → izin matrisi (satır rol, sütun izin, checkbox)
- [ ] Frontend: sidebar menüleri ve butonlar izne göre gizlenir

### 3. Oda tipi müsaitlik & oda atama — arkadaşın
**Gün sonu:** "15-18 Ekim'de kaç Standart boş?" sorusuna sistem cevap veriyor; rezervasyona uygun oda otomatik veya elle atanıyor.
- [ ] Backend: `checkAvailability(checkIn, checkOut, roomTypeId)` servisi (rezervasyonlar + bloke odalar düşülür)
- [ ] Backend: `assignRoom`, `unassignRoom`, `blockRoom`, `setRoomStatus` servisleri + API
- [ ] Backend: Room CRUD API'leri
- [ ] Ekran: Oda listesi (numara, kat, tip, durum rengi) + oda ekle/düzenle formu
- [ ] Ekran: Müsaitlik tablosu (satır oda tipi, sütun gün, hücrede boş sayısı)
- [ ] Ekran: Rezervasyon detayında "oda ata" (uygun boş odalar listesi, seç)
- [ ] Aktör: room-worker paketi (manifest, `reservation.created` → oda seç → `room.assigned`; `guest.checked_out` → oda DIRTY)
- [ ] Aktör kapalıysa: "oda atanacak" manuel görevi düşer

### 4. Rezervasyon yönetimi — Ali Kemal
**Gün sonu:** Resepsiyon elle rezervasyon açıyor, düzenliyor, iptal ediyor; sistem müsaitlik ve fiyatı kendi hesaplıyor; grup rezervasyon ve bekleyen liste çalışıyor.
- [ ] Backend: `createReservation` servisi (müsaitlik kontrolü, fiyat hesabı: taban fiyat × sezon çarpanı × gece, onay kodu üretimi)
- [ ] Backend: `updateReservation`, `cancelReservation`, `markNoShow` servisleri
- [ ] Backend: overbooking kuralı (kapasite aşımında reddet veya onaya gönder)
- [ ] Backend: Guest oluştur/eşleştir (telefon/e-posta ile mevcut misafiri bul)
- [ ] Backend: listeleme API'si (filtre: tarih aralığı, durum, kaynak, misafir adı)
- [ ] Ekran: Rezervasyon listesi (tablo, filtre, durum rozeti)
- [ ] Ekran: Yeni rezervasyon formu (misafir ara/yeni, tarih, kişi, oda tipi, pansiyon, fiyat önizleme, not)
- [ ] Ekran: Rezervasyon detayı (bilgiler, durum geçmişi, iptal butonu, folyo linki)
- [ ] Ekran: Grup rezervasyon (tek formda birden fazla oda satırı)
- [ ] Ekran: Bekleyen liste (yer yoksa "listeye al", yer açılınca uyarı)
- [ ] Aktör: reservation-worker paketi (`reservation.requested` → servis → `reservation.created` / `reservation.rejected`)

### 5. Oda planı / takvim — arkadaşın
**Gün sonu:** Resepsiyon, tüm odaları ve rezervasyonları tek takvimde görüyor; tıklayınca detay açılıyor.
- [ ] Backend: takvim verisi API'si (tarih aralığı → odalar + o aralıktaki rezervasyonlar)
- [ ] Ekran: Takvim ızgarası (satır oda, sütun gün; rezervasyon renkli blok; durum rengi)
- [ ] Ekran: Haftalık / aylık görünüm, bugüne git, tarih seçici
- [ ] Ekran: Bloğa tıkla → rezervasyon detay paneli
- [ ] Ekran: Boş hücreye tıkla → o oda ve tarihle yeni rezervasyon formu
- [ ] Frontend: `room.status.changed` ve `reservation.*` socket event'leriyle canlı güncelleme
- [ ] (ikinci aşama) Sürükle-bırak ile oda / tarih değiştirme

### 6. Check-in / Check-out — Ali Kemal
**Gün sonu:** Misafir gelince tek tıkla giriş, giderken tek tıkla çıkış yapılıyor; oda durumu ve folyo otomatik değişiyor.
- [ ] Backend: `checkIn(reservationId)` servisi (oda atanmış mı, kimlik bilgisi var mı kontrolü → CHECKED_IN → `guest.checked_in`)
- [ ] Backend: `checkOut(reservationId)` servisi (folyo bakiyesi 0 mı kontrolü → CHECKED_OUT → `guest.checked_out`)
- [ ] Backend: erken giriş / geç çıkış ücreti parametresi
- [ ] Ekran: Bugün gelecekler listesi (rezervasyon, oda, durum) + "Check-in" butonu → kısa form (kimlik no, uyruk, plaka, kart/depozito)
- [ ] Ekran: Bugün gidecekler listesi + "Check-out" butonu → bakiye gösterimi, bakiye varsa ödeme ekranına yönlendir
- [ ] Ekran: Konaklayanlar listesi (şu an içeride kim var)
- [ ] Aktör: room-worker'a `guest.checked_in` → OCCUPIED, `guest.checked_out` → DIRTY kuralları

### 7. Misafir mesajları / istek takibi — arkadaşın
**Gün sonu:** Personel, misafirlerle yapılan tüm chat/WhatsApp konuşmalarını görüyor, gerekirse elle cevaplıyor; misafir istekleri görev olarak takip ediliyor.
- [ ] Backend: Conversation / Message API'leri (liste, detay, mesaj gönder, okundu işaretle)
- [ ] Backend: GuestRequest (istek) tablosu + API (tip: havlu, oda servisi, uyandırma; durum)
- [ ] Ekran: Konuşma listesi (kanal ikonu, misafir, son mesaj, okunmamış sayısı)
- [ ] Ekran: Konuşma detayı (balonlar; AI cevapları etiketli; elle cevap kutusu)
- [ ] Ekran: "Manuele al" butonu (concierge bu konuşmaya karışmaz)
- [ ] Ekran: İstekler listesi (oda, istek, durum, atanan) + tamamla
- [ ] Frontend: yeni mesaj gelince socket ile anlık güncelleme + ses/rozet

### 8. WhatsApp / web chat ile konuşarak rezervasyon — Ali Kemal
**Gün sonu:** Misafir web chat'e "15-18 Ekim 2 kişilik oda" yazıyor; AI konuşup onay alıyor; rezervasyon kendiliğinden oluşuyor, oda atanıyor, onay mesajı gidiyor.
- [ ] Web chat widget'ı (siteye gömülen balon; socket ile mesaj gönder/al)
- [ ] webchat-gateway paketi (widget mesajı → `guest.message.received`; `guest.message.reply` → widget'a)
- [ ] whatsapp-gateway paketi (Meta Cloud API webhook doğrulama, gelen mesaj → event, giden mesaj → API)
- [ ] router-agent paketi (küçük model; intent: rezervasyon / soru / şikâyet / diğer → `guest.intent.detected`)
- [ ] concierge-agent paketi (LangGraph grafiği; tool'lar: `check_availability`, `request_reservation`, `get_hotel_info`; konuşma geçmişi + rolling summary; misafir "evet" demeden rezervasyon talebi basmaz)
- [ ] Prompt caching + günlük token bütçesi + LlmUsage kaydı
- [ ] Bütçe aşımı veya agent kapalıysa konuşma manuel göreve düşer (7'deki ekrana)
- [ ] Uçtan uca demo: chat → rezervasyon → oda → onay mesajı, Activity Feed'de izlenir

### 9. Bildirim merkezi — arkadaşın
**Gün sonu:** Sistem misafire e-posta/SMS/WhatsApp, personele uygulama içi bildirim gönderiyor; her gönderim loglu; şablonlar ekrandan düzenleniyor.
- [ ] Backend: Notification, NotificationTemplate, ChannelConfig tabloları + API
- [ ] Backend: kanal adaptörleri (SMTP e-posta, SMS sağlayıcı, WhatsApp gönderim, uygulama içi)
- [ ] Ekran: Şablon listesi + editör (değişkenler: {misafirAdi}, {odaNo}, {tarih})
- [ ] Ekran: Kanal ayarları (SMTP bilgileri, SMS API key, WhatsApp token)
- [ ] Ekran: Gönderim geçmişi (kanal, alıcı, durum, hata, tekrar gönder)
- [ ] Frontend: üst barda zil ikonu, personel bildirimleri listesi
- [ ] Aktör: notification-worker paketi (`notification.send.requested` → gönder → `notification.sent/failed`; `reservation.created` → onay şablonu; `room.assigned` → oda bilgisi şablonu)

### 10. Aktör Activity Feed + audit log — Ali Kemal
**Gün sonu:** Admin, sistemde olan biteni canlı izliyor: hangi aktör hangi event'i işledi, ne kadar sürdü, hata var mı; bir rezervasyonun tüm zincirini tek tıkla görüyor.
- [ ] Backend: ActivityLog ve EventLog listeleme API'si (filtre: aktör, event, seviye, tarih, correlationId)
- [ ] Backend: AuditLog (kullanıcı hangi kaydı değiştirdi; servis katmanında otomatik yazım)
- [ ] Backend: socket.io `activity` kanalı (her log satırı anlık yayınlanır)
- [ ] Ekran: Canlı akış (liste, otomatik kaydırma, duraklat)
- [ ] Ekran: Filtre çubuğu (aktör, event adı, seviye, tarih)
- [ ] Ekran: Zincir görünümü (correlationId seç → adımlar sıralı, süreleriyle)
- [ ] Ekran: Kullanıcı audit listesi (kim, ne zaman, hangi kayıt, eski/yeni değer)

### 11. Onay kuyruğu — arkadaşın
**Gün sonu:** Para iadesi, büyük ödeme, toplu fiyat değişimi gibi işler personelin önüne düşüyor; onaylayınca sistem kaldığı yerden devam ediyor.
- [ ] Backend: Approval CRUD + `grant` / `deny` API'leri
- [ ] Backend: `approval.granted` yayınlanınca PendingAction'daki event tekrar bus'a verilir
- [ ] Backend: süre dolan onaylar EXPIRED olur (zamanlayıcı)
- [ ] Ekran: Bekleyen onaylar listesi (tip, özet, isteyen aktör, tutar, süre)
- [ ] Ekran: Onay detayı (veri, gerekçe) + Onayla / Reddet + not
- [ ] Ekran: Geçmiş onaylar
- [ ] Frontend: yeni onay gelince üst barda sayaç + socket bildirimi

### 12. Aktör yönetim paneli — Ali Kemal
**Gün sonu:** Admin, aktörleri tek ekrandan açıp kapatıyor; kapalı aktörün işleri "manuel görevler"de listeleniyor; LLM agent'ların token harcaması görünüyor.
- [ ] Backend: `GET /actors` (manifest + durum), `enable` / `disable` API'leri
- [ ] Backend: ManualTask listeleme / tamamlama API'si
- [ ] Backend: LlmUsage günlük özet API'si
- [ ] Ekran: Aktör listesi (ad, tip, paket, durum, switch)
- [ ] Ekran: Aktör detay paneli (açıklama, dinlediği / yayınladığı event'ler, onay gerektiren aksiyonlar, retry politikası)
- [ ] Ekran: LLM agent kartı (model, günlük bütçe, bugünkü kullanım çubuğu, tahmini maliyet)
- [ ] Ekran: Manuel görevler listesi (modül, başlık, orijinal event, "tamamla")

### 13. Günlük durum ekranı — arkadaşın
**Gün sonu:** Müdür sabah tek ekrana bakıp günü anlıyor: doluluk, gelecek/gidecek, gelir, bekleyen işler.
- [ ] Backend: `GET /dashboard/today` (doluluk %, gelecek/gidecek sayısı, dolu/boş/kirli oda, bugünkü gelir, ADR)
- [ ] Backend: `GET /dashboard/week` (7 günlük doluluk serisi)
- [ ] Ekran: KPI kartları (6 kart)
- [ ] Ekran: Haftalık doluluk çizgi grafiği
- [ ] Ekran: Bugün gelecekler / gidecekler kısa listesi (6'ya link)
- [ ] Ekran: Bekleyen işler kutusu (onaylar, manuel görevler, açık arızalar)

---

## 2. ÖN BÜRO (operasyon + para)

### 14. Housekeeping / kat hizmetleri — Ali Kemal
**Gün sonu:** Check-out olan oda otomatik temizlik listesine düşüyor, kat görevlisine atanıyor, telefondan "temizledim" deyince oda tekrar satılabilir oluyor.
- [ ] Backend: HousekeepingTask CRUD, atama, tamamlama, inspection API'leri
- [ ] Backend: her sabah konaklayan odalar için STAYOVER görevi üreten zamanlayıcı
- [ ] Ekran: Günlük temizlik listesi (oda, tip, öncelik, atanan, durum)
- [ ] Ekran: Toplu atama (kat görevlisi seç, odaları işaretle)
- [ ] Ekran: Mobil görünüm (büyük butonlar: Başladım / Bitti / Sorun var)
- [ ] Ekran: Kat şefi kontrol ekranı (temizlenen odayı onayla → AVAILABLE)
- [ ] Ekran: Oda durum haritası (kat kat, renkli kutular)
- [ ] Aktör: housekeeping-worker paketi (`guest.checked_out` → CHECKOUT_CLEAN görevi; `housekeeping.task.completed` → `room.status.changed` CLEANING→AVAILABLE)

### 15. Folyo yönetimi — arkadaşın
**Gün sonu:** Her konaklamanın hesabı tek ekranda: oda ücreti, restoran, minibar kalemleri; bölme, birleştirme, transfer yapılabiliyor.
- [ ] Backend: Folio / FolioItem API'leri (aç, kalem ekle, kalem iptal, kapat)
- [ ] Backend: `splitFolio`, `mergeFolios`, `transferItem` servisleri
- [ ] Backend: bakiye hesabı (kalemler − ödemeler), vergi dahil/hariç
- [ ] Ekran: Folyo detayı (kalem tablosu, toplam, ödenen, bakiye)
- [ ] Ekran: Harcama ekle formu (tip, açıklama, tutar, adet, vergi)
- [ ] Ekran: Bölme (kalemleri iki folyoya dağıt), birleştirme (grup), transfer
- [ ] Ekran: Kalem iptali → onay kuyruğuna gider
- [ ] Aktör: billing-worker paketi (`guest.checked_in` → folyo aç; gece → oda ücreti kalemi; `fnb.order.charged` / `minibar.consumed` → kalem; `guest.checked_out` → bakiye kontrolü)

### 16. Fatura kesme — Ali Kemal
**Gün sonu:** Kapanan folyodan tek tıkla fatura üretiliyor, PDF alınıyor, numara serisi düzgün ilerliyor.
- [ ] Backend: Invoice / InvoiceLine tabloları, numara serisi (yıl-sıra), `createInvoiceFromFolio`, `cancelInvoice`
- [ ] Backend: PDF üretimi (şablon: otel logosu, alıcı, kalemler, vergi dökümü)
- [ ] Ekran: Faturalandırılacak folyolar listesi
- [ ] Ekran: Fatura oluştur formu (alıcı tipi: kişi/şirket, vergi no, adres; kalem önizleme)
- [ ] Ekran: Fatura listesi (numara, tarih, tutar, durum) + PDF indir
- [ ] Ekran: İptal → onay kuyruğu
- [ ] Aktör: billing-worker'a `folio.closed` → fatura taslağı kuralı

### 17. Ödeme alma — arkadaşın
**Gün sonu:** Resepsiyon nakit/kart/havale/döviz tahsilat giriyor; büyük tutarlar onaya düşüyor; kasa durumu anlık görünüyor.
- [ ] Backend: Payment API (al, iade et, listele); ExchangeRate tablosu + günlük kur girişi
- [ ] Backend: tutar eşiği parametresi; eşik üstü → `approval.requested`
- [ ] Ekran: Ödeme al formu (folyo, yöntem, tutar, para birimi, kur, referans)
- [ ] Ekran: Ön ödeme / depozito (rezervasyona bağlı)
- [ ] Ekran: İade formu → onay kuyruğu
- [ ] Ekran: Kasa görünümü (bugün yöntem bazında toplamlar)
- [ ] Aktör: billing-worker'a `payment.received` → folyo bakiyesi güncelle kuralı

### 18. Vardiya / kasa kapama (night audit) — Ali Kemal
**Gün sonu:** Gece görevlisi sihirbazı adım adım geçip günü kapatıyor; oda ücretleri işleniyor, no-show'lar düşülüyor, kasa farkı raporlanıyor.
- [ ] Backend: NightAudit, ShiftReport tabloları; `startNightAudit`, `closeDay` servisleri
- [ ] Backend: gelmeyen rezervasyonları NO_SHOW yapma, tüm dolu odalara oda ücreti basma
- [ ] Backend: günlük özet (gelir, doluluk, tahsilat) DailyStats tablosuna yazılır
- [ ] Ekran: Night audit sihirbazı (1. gelmeyenler → 2. oda ücretleri → 3. kasa sayımı → 4. fark → 5. kapat)
- [ ] Ekran: Vardiya devir formu (kasa sayımı, not) + devir raporu PDF
- [ ] Ekran: Kapanış geçmişi
- [ ] Aktör: billing-worker'a `night.audit.started` kuralı

### 19. Çamaşırhane & minibar — arkadaşın
**Gün sonu:** Kat görevlisi odadan tüketilen minibar ürünlerini giriyor, çamaşır siparişi alınıyor; ikisi de folyoya otomatik yansıyor.
- [ ] Backend: MinibarItem, MinibarConsumption, LaundryOrder tabloları + API
- [ ] Backend: tüketim kaydı → `minibar.consumed` event → folyo kalemi
- [ ] Ekran: Minibar ürün listesi + fiyat
- [ ] Ekran: Oda bazlı tüketim girişi (mobil; oda seç, ürün + adet)
- [ ] Ekran: Çamaşır siparişi (oda, parça listesi, teslim tarihi, durum)
- [ ] Ekran: Günlük minibar / çamaşır raporu

### 20. Teknik servis / arıza-bakım — Ali Kemal
**Gün sonu:** "204 klima bozuk" kaydı açılıyor, teknisyene gidiyor, oda gerekirse bakıma alınıyor, çözülünce kapanıyor.
- [ ] Backend: MaintenanceTicket, MaintenancePlan tabloları + API
- [ ] Backend: arıza "oda kullanılamaz" işaretliyse `room.status.changed` → MAINTENANCE
- [ ] Ekran: Arıza listesi (oda, başlık, öncelik, durum, atanan, süre)
- [ ] Ekran: Yeni arıza formu (oda/alan, açıklama, fotoğraf, öncelik, odayı kapat mı)
- [ ] Ekran: Teknisyen görünümü (bana atananlar, başla / bitti)
- [ ] Ekran: Periyodik bakım planı (aylık kontrol listeleri, otomatik görev üretimi)

### 21. Kayıp eşya — arkadaşın
**Gün sonu:** Bulunan eşyalar fotoğraflı kayıt altında; misafirle eşleştirilip teslim edildiği izleniyor.
- [ ] Backend: LostItem API (kaydet, ara, eşleştir, teslim et)
- [ ] Ekran: Bulunan eşya formu (açıklama, oda, bulan, tarih, fotoğraf)
- [ ] Ekran: Liste + arama (tarih, oda, açıklama)
- [ ] Ekran: Misafirle eşleştir (o tarihte o odada kim kalmış), iletişim notu
- [ ] Ekran: Teslim edildi / kargo bilgisi

### 22. CRM & misafir kartı — Ali Kemal
**Gün sonu:** Her misafirin tek profili var: geçmiş konaklamalar, tercihler, toplam harcama, notlar; mükerrer kayıtlar birleştirilebiliyor.
- [ ] Backend: Guest genişletme (GuestPreference, GuestNote tabloları), `mergeGuests` servisi
- [ ] Backend: misafir özeti API'si (konaklama sayısı, toplam harcama, son konaklama)
- [ ] Ekran: Misafir listesi + arama (ad, telefon, e-posta, etiket)
- [ ] Ekran: Misafir kartı (iletişim, kimlik, tercihler: kat / yastık / alerji; etiketler: VIP / sorunlu)
- [ ] Ekran: Konaklama geçmişi sekmesi, harcama sekmesi, notlar sekmesi
- [ ] Ekran: Birleştirme (iki kaydı seç, hangi alanlar kalacak)
- [ ] Rezervasyon formuna misafir kartı önizlemesi (tercihler görünsün)

---

## 3. RAPORLAMA

### 23. Gelir raporları — arkadaşın
**Gün sonu:** Doluluk, ADR, RevPAR raporları tarih aralığına göre tablo + grafik olarak çıkıyor; geçen yılla karşılaştırma var.
- [ ] Backend: MCP server paketi (read-only DB bağlantısı; tool'lar: `get_occupancy`, `get_revenue`, `run_report_query` parametrik/güvenli)
- [ ] Backend: rapor SQL'leri (günlük/haftalık/aylık doluluk, ADR, RevPAR, kaynak bazlı, oda tipi bazlı)
- [ ] Ekran: Rapor sayfası (tarih aralığı, gruplama seçici)
- [ ] Ekran: Doluluk raporu (tablo + çizgi grafik)
- [ ] Ekran: ADR / RevPAR raporu
- [ ] Ekran: Kaynak ve oda tipi kırılımı (pasta / çubuk)
- [ ] Ekran: Geçen yıl karşılaştırma sütunu

### 24. Doğal dil raporlama — Ali Kemal
**Gün sonu:** Müdür "geçen ayın haftalık doluluğunu göster" yazıyor, tablo ve grafik geliyor; rapor kaydedilebiliyor.
- [ ] report-agent paketi (LangGraph; MCP tool'larını çağırır; sonuç: tablo verisi + grafik tipi önerisi + kısa yorum)
- [ ] Backend: SavedReport tablosu + API
- [ ] Ekran: Rapor sohbeti (soru kutusu, cevap: tablo + grafik + yorum)
- [ ] Ekran: "Kaydet" → kayıtlı raporlar listesi, tekrar çalıştır
- [ ] Token bütçesi + LlmUsage kaydı; agent kapalıysa "rapor talebi" manuel görevi

### 25. Günlük durum — forecast — arkadaşın
**Gün sonu:** Dashboard'da önümüzdeki 30 günün doluluk ve gelir tahmini görünüyor; riskli günler işaretli.
- [ ] Backend: MCP `get_forecast` (mevcut rezervasyonlar + geçen yıl aynı dönem trendi)
- [ ] Backend: kritik gün tespiti (doluluk < %30 veya > %95)
- [ ] Ekran: 30 günlük doluluk grafiği (gerçek + tahmin ayrımı)
- [ ] Ekran: Gelir tahmini kartı
- [ ] Ekran: Kritik günler listesi

### 26. Rapor tasarımcısı + Excel — Ali Kemal
**Gün sonu:** Kullanıcı kendi raporunu kolon seçerek kuruyor, Excel indiriyor; Excel'den toplu misafir / fiyat yükleyebiliyor.
- [ ] Backend: ReportDefinition tablosu; kaynak tanımları (rezervasyon, folyo, misafir, ödeme) ve izin verilen kolonlar
- [ ] Backend: dinamik sorgu üretici (kolon, filtre, grupla, sırala; SQL injection'a kapalı)
- [ ] Backend: Excel export (xlsx), Excel import (misafir listesi, fiyat planı) + doğrulama raporu
- [ ] Ekran: Tasarımcı (kaynak seç → kolon sürükle → filtre ekle → önizle → kaydet)
- [ ] Ekran: Kayıtlı raporlar + çalıştır + Excel indir
- [ ] Ekran: Excel yükleme sihirbazı (dosya seç → kolon eşleştir → hataları göster → içe aktar)

### 27. Bütçe yönetimi — arkadaşın
**Gün sonu:** Yıllık bütçe ay ay giriliyor; gerçekleşenle sapma raporu çıkıyor; AI sapmayı yorumluyor.
- [ ] Backend: Budget, BudgetLine tabloları + API (yıl, ay, kalem, plan tutarı)
- [ ] Backend: gerçekleşen tutarları folyo / ödeme / satın alma verisinden hesaplama
- [ ] Ekran: Bütçe giriş tablosu (satır kalem, sütun ay; Excel'den yükleme)
- [ ] Ekran: Sapma raporu (plan, gerçek, fark, fark %; renkli)
- [ ] report-agent'a `explain_variance` tool'u → yorum paragrafı

---

## 4. SATIŞ & DAĞITIM

### 28. Paket / pansiyon tipleri — Ali Kemal
**Gün sonu:** RO/BB/HB/FB/AI pansiyon tipleri ve tarih bazlı fiyat planları tanımlı; rezervasyon fiyatı bunlardan hesaplanıyor.
- [ ] Backend: RatePlan genişletme (oda tipi × pansiyon × tarih aralığı × fiyat, min. gece, kişi başı ek), Package tablosu
- [ ] Backend: fiyat hesaplama servisini RatePlan'a bağla (sezon çarpanı yerine plan fiyatı)
- [ ] Ekran: Pansiyon tipi tanımları
- [ ] Ekran: Fiyat planı tablosu (satır oda tipi, sütun tarih aralığı, hücre fiyat; toplu düzenleme)
- [ ] Ekran: Paket tanımı (oda + SPA + transfer gibi bileşenler, toplam fiyat)
- [ ] Rezervasyon formuna pansiyon ve paket seçimi

### 29. Kontrat & acente yönetimi — arkadaşın
**Gün sonu:** Acenteler kayıtlı, kontrat fiyatları girili; acente adına açılan rezervasyon kontrat fiyatını otomatik alıyor.
- [ ] Backend: Agency, Contract, ContractRate tabloları + API
- [ ] Backend: rezervasyonda acente seçiliyse kontrat fiyatı kullan; stop-sale günlerinde reddet
- [ ] Ekran: Acente listesi + kart (firma, yetkili, iletişim, komisyon %, vade)
- [ ] Ekran: Kontrat formu (acente, dönem, oda tipi, pansiyon, fiyat, stop-sale tarihleri)
- [ ] Ekran: Acente rezervasyonları ve cari özeti (47 ile bağlanır)

### 30. Grup & allotment — Ali Kemal
**Gün sonu:** Acenteye ayrılan oda kotası tanımlı; müsaitlik hesabı kotayı düşüyor; rooming list yüklenip toplu check-in yapılıyor.
- [ ] Backend: Allotment, ReservationGroup tabloları + API
- [ ] Backend: `checkAvailability`'ye allotment düşümü; serbest bırakma tarihinde kota geri açılır
- [ ] Backend: rooming list import (Excel: ad, soyad, oda tipi, tarih)
- [ ] Ekran: Allotment tanımı (acente, tarih aralığı, oda tipi, adet, release günü)
- [ ] Ekran: Kota kullanım tablosu (verilen / kullanılan / kalan)
- [ ] Ekran: Grup dosyası (grup adı, rezervasyonlar, toplu check-in, toplu folyo)

### 31. Promosyon & kupon — arkadaşın
**Gün sonu:** "Erken rezervasyon %15", "3 gece kal 1 gece bedava" gibi kurallar tanımlanıyor; kupon kodu girilince fiyat düşüyor.
- [ ] Backend: Promotion, Coupon tabloları + API; kural motoru (koşul: tarih, min. gece, oda tipi, erken rezervasyon günü)
- [ ] Backend: fiyat hesabına promosyon uygulama, kupon doğrulama
- [ ] Ekran: Promosyon formu (ad, geçerlilik, indirim tipi, koşullar)
- [ ] Ekran: Kupon kodu üretimi (adet, tek kullanımlık mı)
- [ ] Ekran: Kullanım raporu
- [ ] Rezervasyon formuna ve web widget'a kupon alanı

### 32. Online rezervasyon motoru — Ali Kemal
**Gün sonu:** Otel sitesindeki widget'tan misafir tarih seçip fiyat görüyor, bilgilerini girip rezervasyon yapıyor; chat balonu da aynı widget'ta.
- [ ] Backend: public API (müsaitlik, fiyat, rezervasyon talebi; rate limit; API key)
- [ ] Widget: ayrı küçük React uygulaması (tek script ile gömülür)
- [ ] Widget: adımlar (tarih + kişi → oda tipi + fiyat listesi → misafir bilgileri → özet → onay)
- [ ] Widget: kupon alanı, pansiyon seçimi, çoklu dil hazırlığı
- [ ] Widget: 8'deki chat balonunu içine al
- [ ] Rezervasyon `source=WIDGET` ile reservation-worker zincirine düşer, onay e-postası gider

### 33. Kanal yönetimi / Channel Manager — arkadaşın
**Gün sonu:** Müsaitlik ve fiyat değişince OTA'ya gidiyor, OTA'dan gelen rezervasyon sisteme düşüyor; oda tipleri eşleştirilmiş.
- [ ] Backend: Channel, ChannelRoomMapping, ChannelSyncLog tabloları + API
- [ ] Adaptör 1: iCal (Airbnb / Booking iCal export-import)
- [ ] Adaptör 2: bir OTA API'si (Booking veya bir channel manager aracısı)
- [ ] Ekran: Kanal listesi + bağlantı ayarları
- [ ] Ekran: Oda tipi eşleştirme (bizim tip ↔ kanal tipi)
- [ ] Ekran: Senkron logu (ne gönderildi, hata) + manuel senkron butonu, stop-sale
- [ ] Aktör: channel-sync-worker paketi (`room.availability.changed` / `rate.changed` → kanala gönder; kanal webhook → `reservation.requested`)

### 34. Dinamik fiyat / yield — Ali Kemal
**Gün sonu:** Sistem günde bir fiyat önerisi üretiyor, gerekçesiyle onaya düşüyor; onaylanınca fiyat değişip kanallara gidiyor.
- [ ] Kural tabanlı yield (worker): doluluk > %80 → +%10, < %30 ve 7 gün kaldı → −%15 (parametreler ayarlardan)
- [ ] pricing-agent paketi (günde 1 çalışır; doluluk, kalan gün, geçen yıl, etkinlik takvimi okur; öneri + gerekçe; `approval.requested`)
- [ ] Backend: PriceSuggestion tablosu; onaylanınca RatePlan güncelle → `rate.changed`
- [ ] Ekran: Öneriler listesi (tarih, oda tipi, mevcut, önerilen, gerekçe) + onayla / reddet / düzenle
- [ ] Ekran: Yield kuralları ayarı
- [ ] Ekran: Fiyat geçmişi grafiği

### 35. Acente bonus / sadakat — arkadaşın
**Gün sonu:** Acentelerin satış hedefleri ve hak ettiği primler dönem sonunda raporlanıyor.
- [ ] Backend: AgencyBonusRule, AgencyBonus tabloları; dönem sonu hesaplama servisi
- [ ] Ekran: Bonus kuralı (acente, dönem, hedef gece/ciro, prim oranı)
- [ ] Ekran: Acente puan / hedef durumu
- [ ] Ekran: Hak ediş raporu (dönem sonu, onaylı)

### 36. Call center & satış CRM — Ali Kemal
**Gün sonu:** Telefonla gelen her talep kayıtlı; teklif gönderiliyor; takip görevleri hatırlatıyor.
- [ ] Backend: Lead, CallLog, Quote tabloları + API
- [ ] Backend: teklif PDF + e-posta gönderimi (notification-worker)
- [ ] Ekran: Arama kaydı formu (arayan, telefon, talep, sonuç)
- [ ] Ekran: Fırsat panosu (yeni / teklif verildi / bekliyor / kazanıldı / kaybedildi)
- [ ] Ekran: Teklif oluştur (tarih, oda, fiyat) → gönder → kabul edilince rezervasyona çevir
- [ ] Ekran: Hatırlatmalar (bugün aranacaklar)

### 37. Satış projeleri & banket / etkinlik — arkadaşın
**Gün sonu:** Düğün, toplantı gibi etkinlikler salon takviminde; teklif → sözleşme → fatura akışı çalışıyor.
- [ ] Backend: Venue, Event, EventItem tabloları + API
- [ ] Ekran: Salon tanımları (kapasite, düzen tipleri, saatlik/günlük fiyat)
- [ ] Ekran: Etkinlik takvimi (salon × tarih)
- [ ] Ekran: Etkinlik dosyası (müşteri, tarih, salon, kişi, düzen, ekipman, menü linki (43), fiyat)
- [ ] Ekran: Teklif → sözleşme (PDF) → depozito → fatura (16'ya bağlanır)

---

## 5. F&B / POS

### 38. Menü & reçete — Ali Kemal
**Gün sonu:** Restoran menüsü ve her ürünün reçetesi tanımlı; ürün maliyeti otomatik hesaplanıyor.
- [ ] Backend: MenuCategory, MenuItem, Recipe, RecipeLine tabloları + API
- [ ] Backend: maliyet hesabı (reçete satırları × stok birim maliyeti)
- [ ] Ekran: Menü grupları ve ürünler (ad, fiyat, KDV, görsel, aktif)
- [ ] Ekran: Reçete editörü (ürün → malzeme + miktar + birim)
- [ ] Ekran: Maliyet / kâr marjı tablosu
- [ ] Ekran: QR menü için public JSON çıktısı (53 kullanır)

### 39. Restoran POS — arkadaşın
**Gün sonu:** Garson masayı açıp sipariş giriyor, adisyon kapatıyor, ödeme alıyor veya odaya yazıyor.
- [ ] Backend: Table, Order, OrderLine, Check tabloları + API
- [ ] Backend: adisyon bölme / ikram / indirim servisleri; "odaya yaz" → `fnb.order.charged`
- [ ] Ekran: Masa planı (salon seçimi, masa kutuları: boş / dolu / hesap istiyor)
- [ ] Ekran: Sipariş ekranı (dokunmatik; ürün grupları, adet, not, gönder)
- [ ] Ekran: Adisyon (kalemler, böl, ikram, indirim, kapat)
- [ ] Ekran: Ödeme (nakit / kart / odaya yaz; oda seçimi)
- [ ] Ekran: Garson vardiya raporu
- [ ] Aktör: fnb-worker paketi (`order.placed` → mutfak; `order.paid` → stok düşümü event'i; `fnb.order.charged` → billing-worker folyo kalemi)

### 40. Mutfak ekranı (KDS) — Ali Kemal
**Gün sonu:** Mutfaktaki tablette siparişler sırayla görünüyor, süre sayıyor, "hazır" deyince garsona haber gidiyor.
- [ ] Backend: Order durum geçişleri (NEW → PREPARING → READY → SERVED), istasyon alanı
- [ ] Backend: socket kanalı `kitchen`
- [ ] Ekran: Sipariş kartları (masa, kalemler, geçen süre; renk: yeni / hazırlanıyor / gecikti)
- [ ] Ekran: Kart butonları (Başla / Hazır), istasyon filtresi (sıcak / soğuk / bar)
- [ ] Ekran: Garson tarafında "hazır" bildirimi

### 41. Oda servisi — arkadaşın
**Gün sonu:** Odaya sipariş giriliyor, mutfağa düşüyor, teslim edilince folyoya yazılıyor.
- [ ] Backend: Order'a `roomId` + teslim durumu; `fnb.order.charged` → folyo
- [ ] Ekran: Oda servisi sipariş formu (oda, ürünler, not, teslim saati)
- [ ] Ekran: Teslim listesi (hazır siparişler, teslim edildi)
- [ ] Misafir tarafı: QR menüden sipariş (53 ile birleşir)

### 42. Online paket sipariş — Ali Kemal
**Gün sonu:** Dışarıdan gelen paket siparişler aynı POS zincirinden geçiyor; kurye ataması ve teslim takibi var.
- [ ] Backend: Order `source=ONLINE`, DeliveryInfo tablosu (adres, telefon, kurye, durum)
- [ ] Ekran: Dış sipariş formu (müşteri, adres, ürünler, ödeme tipi)
- [ ] Ekran: Sipariş panosu (hazırlanıyor / yolda / teslim)
- [ ] Ekran: Kurye atama
- [ ] (opsiyonel) Public sipariş sayfası

### 43. Banket F&B planlaması — arkadaşın
**Gün sonu:** Etkinliğin menüsü seçiliyor; kişi sayısına göre malzeme ihtiyacı ve maliyet çıkıyor.
- [ ] Backend: EventMenu tablosu; reçeteden kişi sayısına göre malzeme hesaplama
- [ ] Ekran: Etkinlik menüsü seçimi (set menü, kişi başı fiyat)
- [ ] Ekran: Malzeme ihtiyaç listesi (satın alma talebine çevir → 45)
- [ ] Ekran: Mutfak üretim planı (gün / saat)

---

## 6. STOK & SATIN ALMA

### 44. Stok & maliyet analizi — Ali Kemal
**Gün sonu:** Depodaki her ürünün miktarı ve hareketli ortalama maliyeti izleniyor; satılan yemek reçeteden stoğu düşüyor; sayım farkları görünüyor.
- [ ] Backend: Warehouse, StockItem, StockMovement, StockCount tabloları + API
- [ ] Backend: hareketli ortalama maliyet hesabı (her girişte güncelle)
- [ ] Backend: transfer, fire, sayım düzeltme servisleri
- [ ] Ekran: Depo tanımları
- [ ] Ekran: Stok kartları (ürün, birim, mevcut, min. seviye, ortalama maliyet)
- [ ] Ekran: Hareket listesi + manuel hareket formu
- [ ] Ekran: Sayım ekranı (fiziksel gir, fark listesi, onayla)
- [ ] Ekran: Maliyet raporu (ürün / reçete bazlı)
- [ ] Aktör: inventory-worker paketi (`order.paid` → reçete satırlarını düş; stok < min → `purchase.request.suggested`)

### 45. Satın alma — arkadaşın
**Gün sonu:** Talep → teklif karşılaştırma → sipariş → mal kabul zinciri kayıtlı; mal kabulde stok otomatik giriyor.
- [ ] Backend: Supplier, PurchaseRequest, PurchaseQuote, PurchaseOrder, GoodsReceipt tabloları + API
- [ ] Backend: sipariş tutarı eşik üstü → `approval.requested`; mal kabul → stok girişi + tedarikçi borcu event'i
- [ ] Ekran: Tedarikçi kartları
- [ ] Ekran: Talep formu (talep eden, ürün, miktar, ihtiyaç tarihi) + otomatik önerilen talepler listesi
- [ ] Ekran: Teklif karşılaştırma (tedarikçi × fiyat × termin)
- [ ] Ekran: Sipariş (onaylı) + PDF
- [ ] Ekran: Mal kabul / irsaliye (gelen miktar, fark, depo)

### 46. Demirbaş & amortisman — Ali Kemal
**Gün sonu:** Otelin sabit kıymetleri barkodlu kayıtlı; konumları, garanti bitişleri ve amortisman tablosu görünüyor.
- [ ] Backend: Asset, AssetMovement, Depreciation tabloları + API; amortisman hesabı (doğrusal)
- [ ] Ekran: Demirbaş kartı (barkod, ad, kategori, konum/oda, alış tarihi, tutar, garanti bitiş, zimmet)
- [ ] Ekran: Barkod etiketi yazdırma
- [ ] Ekran: Sayım (barkod okut, eksikleri listele)
- [ ] Ekran: Amortisman tablosu (yıllık)
- [ ] Ekran: Garantisi bitecekler uyarısı

---

## 7. MUHASEBE / ERP

### 47. Ön muhasebe — arkadaşın
**Gün sonu:** Acente / tedarikçi / şirket carileri, kasa, banka, çek-senet tek yerde; faturalar ve tahsilatlar otomatik cariye işliyor.
- [ ] Backend: Account (cari), AccountTransaction, CashRegister, BankAccount, Cheque tabloları + API
- [ ] Ekran: Cari kartlar + ekstre (borç / alacak / bakiye)
- [ ] Ekran: Kasa hareketleri (giriş / çıkış, açıklama)
- [ ] Ekran: Banka hesapları + hareketler
- [ ] Ekran: Çek / senet portföyü (vade, durum, tahsil / ciro / karşılıksız)
- [ ] Ekran: Tahsilat / ödeme fişi
- [ ] Aktör: accounting-worker paketi (`invoice.issued` → cari alacak; `payment.received` → kasa/banka; `goods.received` → tedarikçi borç)

### 48. Genel muhasebe — Ali Kemal
**Gün sonu:** Tek Düzen Hesap Planı yüklü; her satış / tahsilat otomatik yevmiye fişi oluyor; mizan çıkıyor.
- [ ] Backend: ChartOfAccounts (ağaç), Journal, JournalLine tabloları + API; Tek Düzen seed
- [ ] Backend: otomatik fiş kuralları tablosu (event tipi → borç hesap / alacak hesap)
- [ ] Backend: mizan sorgusu (tarih aralığı, hesap bazlı borç / alacak / bakiye)
- [ ] Ekran: Hesap planı ağacı + hesap ekle
- [ ] Ekran: Fiş listesi + manuel fiş girişi (borç = alacak kontrolü)
- [ ] Ekran: Mizan
- [ ] Ekran: Otomatik fiş kuralları ayarı
- [ ] Aktör: accounting-worker'a fiş üretim kuralları

### 49. e-Fatura / e-Arşiv / e-Defter — arkadaşın
**Gün sonu:** Faturalar özel entegratör üzerinden GİB'e gidiyor, durumu izleniyor; e-Defter aylık dosyası üretiliyor.
- [ ] Backend: EInvoiceConfig, EInvoiceLog tabloları; entegratör adaptörü (1 firma ile başla)
- [ ] Backend: UBL XML üretimi, gönderim, durum sorgulama; alıcı mükellef mi kontrolü (e-Fatura / e-Arşiv ayrımı)
- [ ] Backend: e-Defter aylık yevmiye / kebir dosyası
- [ ] Ekran: Entegratör ayarları (hesap, test / canlı)
- [ ] Ekran: Fatura listesine "GİB durumu" kolonu + gönder / tekrar gönder
- [ ] Ekran: e-Defter aylık üretim + indirme

### 50. Sanal POS / ödeme geçidi — Ali Kemal
**Gün sonu:** Misafire ödeme linki gönderiliyor veya widget'ta kartla ödeme yapılıyor; sonuç otomatik folyoya düşüyor.
- [ ] Backend: PaymentGatewayConfig, PaymentTransaction tabloları; sağlayıcı adaptörü (iyzico veya PayTR)
- [ ] Backend: ödeme linki üret, 3D Secure akışı, webhook → `payment.received`
- [ ] Ekran: Sağlayıcı ayarları
- [ ] Ekran: "Ödeme linki gönder" (rezervasyon / folyo üzerinden; e-posta / WhatsApp ile)
- [ ] Widget'a kart ödeme adımı
- [ ] Ekran: İşlem listesi (başarılı / başarısız / iade)

### 51. Personel & bordro — arkadaşın
**Gün sonu:** Personel kartları kayıtlı; aylık bordro hesaplanıp çıktı alınıyor.
- [ ] Backend: Employee, Payroll, PayrollLine tabloları + API; brüt → net hesabı (SGK, vergi dilimi parametrik)
- [ ] Ekran: Personel listesi + kart (kimlik, pozisyon, departman, işe giriş, maaş, IBAN)
- [ ] Ekran: Aylık bordro hesapla (ek ödeme / kesinti gir → hesapla → onayla)
- [ ] Ekran: Bordro PDF / toplu çıktı

### 52. İK — Ali Kemal
**Gün sonu:** İzin talepleri onaylanıyor, vardiya çizelgesi yapılıyor, puantaj tutuluyor, özlük belgeleri saklanıyor.
- [ ] Backend: Leave, Shift, Timesheet, EmployeeDocument tabloları + API; izin bakiye hesabı
- [ ] Ekran: İzin talebi (personel) + onay (yönetici) → onay kuyruğu
- [ ] Ekran: İzin bakiyeleri
- [ ] Ekran: Haftalık vardiya çizelgesi (departman × gün)
- [ ] Ekran: Puantaj (giriş / çıkış, mesai)
- [ ] Ekran: Özlük belgeleri (yükle, süre takibi)

---

## 8. MİSAFİR DENEYİMİ

### 53. Temassız uygulamalar — arkadaşın
**Gün sonu:** Misafir gelmeden telefonundan check-in yapıyor, QR ile menüden sipariş veriyor, portalda folyosunu görüyor.
- [ ] Backend: OnlineCheckin, GuestPortalSession tabloları; token'lı public linkler
- [ ] Misafir portalı (ayrı küçük React app): rezervasyonum, online check-in formu (kimlik, imza, kart), folyom, istek gönder, chat (8)
- [ ] QR menü sayfası (38'deki menü JSON'u; sipariş → 41)
- [ ] Ekran (personel): online check-in yapanlar listesi, onayla → 6'daki check-in
- [ ] Dijital anahtar butonu (62 tamamlanınca aktif)

### 54. Misafir yorum entegrasyonu + duygu analizi — Ali Kemal
**Gün sonu:** Google / Booking yorumları sisteme düşüyor; AI olumlu-olumsuz ve konu etiketi veriyor, cevap öneriyor; trend grafiği var.
- [ ] Backend: Review, ReviewAnalysis tabloları; yorum çekme (API varsa) + manuel / Excel yükleme
- [ ] insight-agent paketi (toplu çalışır: duygu, konu etiketi, önerilen cevap, anomali: "temizlik şikâyeti bu hafta 3 kat arttı")
- [ ] Ekran: Yorum listesi (kaynak, puan, duygu, konu; filtre)
- [ ] Ekran: Yorum detayı + önerilen cevap → düzenle → gönder / kopyala
- [ ] Ekran: Trend grafiği (haftalık duygu, konu dağılımı)
- [ ] Anomali → yöneticiye bildirim

### 55. Anket & memnuniyet — arkadaşın
**Gün sonu:** Check-out'tan 1 gün sonra anket gidiyor; cevaplar toplanıyor; NPS ve AI özeti görünüyor.
- [ ] Backend: Survey, SurveyQuestion, SurveyResponse tabloları + API; public cevap sayfası
- [ ] Backend: `guest.checked_out` + 1 gün → notification-worker anket linki gönderir
- [ ] Ekran: Anket tasarımı (sorular, tip: puan / çoktan seçmeli / açık)
- [ ] Ekran: Cevaplar listesi + NPS skoru
- [ ] insight-agent özeti (açık uçlu cevapların ana temaları)

### 56. Sadakat programı — Ali Kemal
**Gün sonu:** Misafir her konaklamada puan kazanıyor, seviyesi yükseliyor, puanla indirim alıyor.
- [ ] Backend: LoyaltyProgram, LoyaltyAccount, LoyaltyTransaction tabloları; puan kazanma kuralı (`folio.closed` → harcama × oran)
- [ ] Ekran: Program kuralları (puan oranı, seviyeler, seviye avantajları)
- [ ] Ekran: Misafir kartına "puan / seviye" kutusu (22)
- [ ] Ekran: Puan harcama (rezervasyonda indirim olarak kullan)
- [ ] Portala (53) puan görünümü

### 57. SPA & spor salonu randevu — arkadaşın
**Gün sonu:** Masaj / hamam / PT randevuları terapist takviminde; ücret folyoya yansıyor.
- [ ] Backend: SpaService, Therapist, SpaAppointment tabloları + API; çakışma kontrolü
- [ ] Ekran: Hizmet listesi (süre, fiyat, gereken terapist)
- [ ] Ekran: Randevu takvimi (terapist × saat)
- [ ] Ekran: Randevu formu (misafir / dışarıdan, hizmet, terapist, saat) → folyo kalemi
- [ ] Portaldan (53) randevu alma

---

## 9. YASAL & ENTEGRASYON

### 58. Emniyet kimlik bildirimi (KBS) — Ali Kemal
**Gün sonu:** Her check-in sonrası misafir bilgisi KBS'ye otomatik gidiyor; hata olursa listede görünüp tekrar gönderiliyor.
- [ ] Backend: KbsConfig, KbsLog tabloları; KBS web servis adaptörü
- [ ] Backend: `guest.checked_in` → bildirim gönder (worker kuralı); `guest.checked_out` → çıkış bildirimi
- [ ] Ekran: KBS ayarları (tesis kodu, kullanıcı)
- [ ] Ekran: Bildirim logu (başarılı / hatalı, tekrar gönder)
- [ ] Check-in formunda KBS için zorunlu alan kontrolü

### 59. Kimlik / pasaport okuma (OCR) — arkadaşın
**Gün sonu:** Check-in'de kimliğin fotoğrafı çekilince ad, soyad, TC / pasaport no, doğum tarihi otomatik doluyor.
- [ ] Backend: OCR servisi bağlantısı (MRZ okuma; bulut API veya kütüphane)
- [ ] Ekran: Check-in formunda "Kimlik tara" butonu (kamera / dosya)
- [ ] Ekran: Okunan alanları göster → onayla → forma yaz
- [ ] Kimlik görselini misafir kaydına ekle (KVKK: süre sonunda sil)

### 60. Çoklu dil & çoklu para birimi — Ali Kemal
**Gün sonu:** Arayüz TR / EN arasında geçiyor; fiyatlar seçilen para biriminde görünüyor; günlük kur otomatik geliyor.
- [ ] Frontend: i18n altyapısı (çeviri dosyaları, dil seçici, tarih / sayı formatı)
- [ ] Tüm mevcut ekranların metinlerini çeviri anahtarına taşıma
- [ ] Backend: ExchangeRate günlük çekme (TCMB), kur geçmişi
- [ ] Ekran: Para birimi seçici; fiyat gösterimlerinde dönüşüm
- [ ] Fatura ve widget'ta döviz desteği

### 61. Webhook & açık API — arkadaşın
**Gün sonu:** Dış sistemler API key ile bağlanıyor; istedikleri event'i kendi URL'lerine alıyor; dokümantasyon sayfası var.
- [ ] Backend: ApiKey, WebhookSubscription, WebhookDelivery tabloları + API
- [ ] Backend: public REST API (rezervasyon, müsaitlik, misafir; rate limit); OpenAPI dokümanı
- [ ] Backend: webhook gönderici (event → URL; imza; tekrar deneme)
- [ ] Ekran: API key yönetimi
- [ ] Ekran: Webhook abonelikleri + teslimat logu
- [ ] Doküman sayfası (Swagger UI)

### 62. Donanım entegrasyonları — Ali Kemal
**Gün sonu:** Check-in'de kapı kartı kodlanıyor, oda telefonu açılıyor; check-out'ta kapanıyor; POS cihazından ödeme sonucu geliyor.
- [ ] Backend: Device, DeviceLog tabloları; ortak adaptör arayüzü (`encodeKey`, `revokeKey`, `openLine`, `closeLine`, `chargeCard`)
- [ ] Adaptör: 1 kapı kilidi markası
- [ ] Adaptör: 1 santral
- [ ] Adaptör: 1 POS cihazı
- [ ] Ekran: Cihaz tanımları + bağlantı testi
- [ ] Check-in / check-out akışına cihaz adımları; hata olursa manuel görev

### 63. Multi-tenant zincir konsolu — arkadaşın
**Gün sonu:** Zincir yöneticisi birden çok oteli tek panelden görüyor; otel arası geçiş yapıyor; zincir raporu alıyor.
- [ ] Backend: HotelGroup, UserHotel tabloları; kullanıcı → birden çok otel yetkisi
- [ ] Backend: zincir raporu (oteller karşılaştırmalı doluluk / gelir)
- [ ] Ekran: Otel listesi + yeni otel ekleme sihirbazı (ayarlar 1'i kopyala)
- [ ] Ekran: Üst barda otel seçici
- [ ] Ekran: Zincir dashboard'u
- [ ] Ekran: Merkezi kullanıcı yönetimi

---

## 10. DİKEY PAKETLER

Hepsi aynı çekirdeği kullanır. Her paket: kendi manifest'i, birkaç ek tablo, birkaç ekran, "oda" kavramının yeniden adlandırılması.

### 64. Apart / rezidans — Ali Kemal
**Gün sonu:** Daireler uzun dönem kiralanıyor, aylık fatura ve aidat kesiliyor, sayaç okuması giriliyor.
- [ ] Oda → daire; uzun dönem sözleşme tablosu
- [ ] Aylık otomatik faturalama (kira + aidat + sayaç)
- [ ] Sayaç okuma ekranı (elektrik / su)
- [ ] Kiracı portalı (53'ün uyarlaması)

### 65. Yurt yönetimi — arkadaşın
**Gün sonu:** Öğrenciler yatak bazında kayıtlı; dönemlik ücret, veli bilgisi, giriş-çıkış ve yemek listesi çalışıyor.
- [ ] Oda → yatak; öğrenci kartı (veli, okul)
- [ ] Dönemlik kayıt ve taksitli ücret
- [ ] Giriş / çıkış kontrolü (kart okuyucu veya manuel)
- [ ] Haftalık yemek listesi ekranı

### 66. Devremülk — Ali Kemal
**Gün sonu:** Malikler ve dönem hakları kayıtlı; dönem takası ve aidat takibi yapılıyor.
- [ ] Oda → hisse / dönem; malik kartı
- [ ] Hak sahipliği takvimi (hangi hafta kimin)
- [ ] Dönem takas talebi + onay
- [ ] Aidat tahakkuk ve tahsilat

### 67. Marina — arkadaşın
**Gün sonu:** Bağlama yerleri iskele bazında tanımlı; tekneler sözleşmeyle bağlanıyor; elektrik-su ve kara hizmetleri faturalanıyor.
- [ ] Oda → bağlama yeri (iskele, no, boy / en sınırı); tekne kartı (ad, boy, en, bayrak, sahip)
- [ ] Bağlama sözleşmesi (günlük / aylık / sezonluk) → rezervasyon çekirdeği
- [ ] İskele planı ekranı (5'in uyarlaması)
- [ ] Sayaç (elektrik / su) okuma → folyo
- [ ] Kara hizmetleri (çekme, indirme, yıkama) → folyo kalemi

### 68. Klinik — Ali Kemal
**Gün sonu:** Hasta kartı, randevu, hekim takvimi ve tedavi faturası aynı çekirdek üstünde çalışıyor (`clinic/` paketi).
- [ ] Oda → muayene odası / yatak; hasta kartı (22'nin uyarlaması)
- [ ] Hekim takvimi + randevu (57'nin uyarlaması)
- [ ] Tedavi planı ve seans takibi
- [ ] Fatura (16) ve ödeme (17) aynen kullanılır
