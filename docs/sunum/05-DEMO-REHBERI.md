# 05 — Demo Rehberi

> Canlı demo için adım adım kılavuz. **Demodan ÖNCE bu dokümanın "Hazırlık" ve "Patlamasın" bölümlerini mutlaka uygula.** Prova yapmadan sunuma girme.

---

## 1. Sistemi çalıştırma

### Gereksinimler
- Node.js 22+
- PostgreSQL (13+; `postgresql-contrib` — `btree_gist` eklentisi için)
- Dolu bir `.env` (en azından `DATABASE_URL`)

### Komutlar (kök dizinde)

```bash
npm install                 # (zaten yapıldı — bağımlılıklar + workspace linkleri)
npm run db:migrate          # tabloları oluşturur
npm run db:seed             # demo verisi yükler
npm run dev                 # backend + frontend birlikte
```

- **Backend:** http://localhost:3000/health → `{ ok: true }` dönmeli
- **Frontend:** http://localhost:5173
- **Giriş:** `admin@hotel.local` / `admin123` (ADMIN — tüm menü açık)

Sadece birini açmak: `npm run dev:backend` veya `npm run dev:frontend`.
Veritabanını görsel incelemek: `npm run db:studio`.

> **Senin gerçek yerel kurulumun (önerilen demo yolu):** Bilgisayarında Postgres yok; sunucudaki Postgres'e **SSH tüneliyle** bağlanıyorsun ve canlı DB yerine izole `hotelos_local` kopyasını kullanıyorsun (demo verisi — 52 oda, 1000 misafir — zaten seed'li, yani `db:seed`'e gerek yok). Kök `.env` içindeki `DATABASE_URL` 5433 portundaki tüneli gösterir.
> 1. Tüneli aç: `ssh -fN -L 5433:127.0.0.1:5432 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes root@188.132.235.142`
> 2. Tünel ayakta mı: `lsof -nP -iTCP:5433 -sTCP:LISTEN`
> 3. Kökte `npm run dev`.
>
> ⚠️ Demoyu **canlı `hotelos` DB'sine değil, `hotelos_local`'a** bağla (yoksa arka plan işleri çift çalışır). Kopya eskiyse sunucuda tazele (bkz. hafıza: local-run-setup).

---

## 2. Demodan ÖNCE hazırlık (kontrol listesi)

- [ ] **Backend + frontend ayakta.** `http://localhost:3000/health` yeşil, panel açılıyor.
- [ ] **Socket/canlı bağlantı çalışıyor.** Panele gir → Dashboard'daki sistem durumu kartlarında **"Canlı bağlantı · Bağlı"** (yeşil) görünmeli. Sarı/kırmızı ise socket kapalıdır — demo "canlılık" kısmı patlar.
- [ ] **Demo veritabanı DOLU.** En az: birkaç oda tipi + oda, 2-3 rezervasyon (en az biri bugün giriş), açık bir folyo, bir POS noktası + menü + masa, en az bir misafir mesajı, bir onay bekleyen iş. Boş ekranlar ("Henüz oda tanımlı değil") demoyu zayıflatır.
- [ ] **AI göstereceksen:** Sunucuda `OPENAI_API_KEY` tanımlı mı? Değilse Aktör panelinde "Ajanlar çalışmıyor" uyarısı çıkar — bu durumda AI'yı "canlı cevap" değil, "aç/kapat + bütçe izleme" özelliği olarak anlat.
- [ ] **WhatsApp göstereceksen:** Otelin Meta WhatsApp kimlik bilgileri tanımlı ve geçit açık mı? Değilse giden mesaj "gönderim bekliyor" kalır — "canlı WhatsApp gitti" deme (bkz. §5).
- [ ] **İki tarayıcı penceresi hazır** (canlılık demosu için — biri oda planı/mesaj, diğeri işlem yapan).
- [ ] **Prova:** Aşağıdaki 12 adımı bir kez baştan sona dene; hangi ekran boş/eksik çıkıyor, hangi veri lazım, önceden gör.

---

## 3. Önerilen 12 adımlık demo akışı

> Her ekranda 3 şey söyle: (1) ne görüyorlar, (2) arkada ne oluyor, (3) neden farklı. Gerçek route'lar verildi.

**1) Kurumsal açılış (opsiyonel, 1 dk).** `web/` sitesini aç (ayrı Vite projesi, kendi klasöründe `npm install` + `npm run dev`) → FlexAI vitrinini göster → "Panele giriş" ile panele geç. (Zaman darsa atla.)

**2) Giriş** → `http://localhost:5173/login`, `admin@hotel.local` / `admin123`. Markayı ve login ekranının tasarımını göster.

**3) Panel (Dashboard)** → `/` — "Müdürün sabah ekranı." Doluluk (dünle kıyaslı), ADR/RevPAR, gelen/giden, bekleyen işler, sistem durumu kartları.
→ **De ki:** "Bunlar otelcilik standardı metrikler, vergiler hariç hesaplanıyor; tüm modüller aynı tek kaynaktan besleniyor, sayılar asla birbirini tutmamazlık etmez."

**4) Rezervasyon oluştur** → `/rezervasyonlar/yeni` — misafir, tarih, oda tipi, pansiyon seç; canlı fiyat önizlemesini göster; kaydet.
→ **De ki:** "Fiyat gece gece sezon çarpanıyla hesaplanıyor; müsaitlik aynı anda kilitleniyor — iki kişi aynı odayı aynı anda satamaz."

**5) Oda planı** → `/oda-plani` — yeni rezervasyonu "oda bekleyenler" şeridinde göster, **bir odaya sürükle-bırak** (en görsel an). İçerideki bir misafiri başka odaya taşırken onay+sebep diyaloğunu göster.
→ **De ki:** "Satır oda, sütun gece. Sürükle-bırakla oda değişimi; geçmiş hiç yeniden yazılmıyor, iz kalıyor."

**6) Check-in** → `/on-buro/gelecekler` → satırdan tek tıkla giriş (CheckInDialog). Oda otomatik "dolu" olur, folyo açılır.
→ **De ki:** "Tek tık; arkada oda aktörü odayı dolu yaptı, folyo aktörü hesabı açtı, kanal aktörü OTA'ları güncelledi — hepsi aynı anda."

**7) Folyo / Ödeme** → `/folyolar/<rezervasyonId>` — oda ücretini ve bir harcamayı göster, vergi özetini aç, **ödeme al**. (Büyük tutar girersen onaya düşer — adım 11'de onaylarsın.)
→ **De ki:** "Kalemler asla silinmiyor; iptal bile onaylı ters kayıt. Bakiye her zaman kalemlerden yeniden hesaplanıyor — kasa açığı yapısal olarak kapalı."

**8) Housekeeping** → `/kat-hizmetleri/gorevler` — çıkışla düşen temizlik görevleri; "Görevlerim" ile görevli telefonu görünümü.
→ **De ki:** "Çıkan oda otomatik listeye düştü. Temizliği yapan kişi kendi işini onaylayamaz — dört göz kuralı."

**9) POS / Oda servisi panosu** → `/pos/masalar` (dokunmatik masa planı) → `/pos/oda-servisi` (4 kolonlu KDS benzeri pano: Onay bekleyen · Mutfakta · Hazır · Yolda). Bir siparişi adım adım ilerlet.
→ **De ki:** "Restoran hesabı 'odaya yaz' ile folyoya kuruşu kuruşuna aynı yansıyor; yuvarlanamayan tutar reddedilip en yakın iki seçenek öneriliyor."

**10) Mesaj gelen kutusu** → `/mesajlar` — WhatsApp benzeri 3 sütunlu düzen.
→ **Canlılık demosu:** İki pencere aç; birinden cevap yaz, diğerinde anında belirsin. **De ki:** "Canlı ekranlar sunucudan veri çekmiyor; sadece 'şu değişti' haberi alıp kendini tazeliyor — ne sürekli sorgu, ne bayat ekran." (⚠️ Kanal bağlı değilse "misafire gitti" deme — §5.)

**11) Onay kuyruğu + Aktör paneli** → `/onaylar/bekleyen` (adım 7'deki büyük ödemeyi buradan onayla — iş kaldığı yerden tamamlanır) → `/aktorler`.
→ **De ki (farklılaştırıcı burada):** "Bunlar dijital çalışanlar. Her birini tek tıkla kapatabilirim; kapattığımda iş kaybolmuyor, personelin görev listesine düşüyor. AI ajanlarının günlük maliyeti bütçeye karşı burada görünüyor. 'Bu aktörü kapatırsam ne durur' önceden yazıyor."

**12) Raporlar** → `/raporlar/gelir` (+ `/butce/plan`) — gelir/ADR/RevPAR raporu ve bütçe sapması ile kapanış.
→ **De ki:** "Dönem oranları toplamdan hesaplanıyor; geçen yılla kıyas otomatik. Forecast 30 gün önceden boş kalacak günleri gösteriyor."

**Bonus (teknik izleyici varsa):** `/aktivite/akis` → canlı olay akışı ve işlem zinciri. "Bir WhatsApp mesajından folyoya kadar tüm zinciri tek ağaçta görebiliyoruz."

---

## 4. Alternatif kısa akış (5 dk, zaman darsa)

Dashboard (`/`) → Oda planı sürükle-bırak (`/oda-plani`) → Check-in (`/on-buro/gelecekler`) → Ödeme (`/folyolar/:id`) → Aktör paneli (`/aktorler`). Beş ekran, beş temel mesaj.

---

## 5. ⚠️ DEMODA PATLAMASIN — bilinen tuzaklar

| Tuzak | Ne olur | Ne yap |
|---|---|---|
| **Mesaj kanalı bağlı değil** | Giden cevap "gönderim bekliyor" olarak kalır (misafire gitmez). UI zaten bunu dürüstçe yazar. | Gelen kutusunu **mevcut/kurgulu veriyle** göster. "Misafire canlı WhatsApp gitti" deme. "Entegrasyon gerçek; kimlik tanımlanınca canlı çalışır" de. |
| **`OPENAI_API_KEY` yok** | Aktör panelinde "Ajanlar çalışmıyor"; AI konuşması olmaz. | Önceden tanımla. Yoksa AI'yı "aç/kapat + bütçe izleme" özelliği olarak anlat, canlı AI cevabı vaat etme. |
| **Backend/socket kapalı** | Ekranlarda sarı "Canlı değil", Dashboard'da kırmızı "Kopuk". | Demodan önce sistem durumu kartlarının yeşil olduğunu teyit et. |
| **Boş veritabanı** | "Henüz oda tanımlı değil", "Masa tanımlı değil" boş ekranları. | Demo DB'sini önceden doldur (§2). |
| **Forecast geçmiş verisi yok** | "Tahmin eldeki rezervasyonla aynı" der. | Birkaç haftalık veri yoksa forecast'ı öne çıkarma. |
| **Ağır rapor ilk açılış** | Gelir raporu ilk açılışta birkaç saniye (1 dk önbellekli). | Panik yapma; önceden bir kez aç, önbelleğe girsin. |
| **Yazılmamış modül sorulursa** | 16 Fatura, 18 Night audit, 20 Teknik servis, 22 CRM, 28/30/32/34/36/40/42/46, ve 24/26/44 kısmi. | "Altyapısı hazır, yol haritasında" de (bkz. `00-GENEL-BAKIS.md` ve `04`). Asla "var" deyip gösterememe durumuna düşme. |
| **Yetki sorusu** | "Frontend'de güvenlik mi?" | "Hayır — asıl yetki sunucuda her istekte. Arayüz sadece menü/buton gizler." |

---

## 6. Demo sonrası

- Soruları `04-SUNUM-VE-SORU-CEVAP.md`'deki bankadan cevapla.
- "Pilot" öner: çekirdek modüllerle (rezervasyon, folyo, ödeme, housekeeping, POS, kanal, ön muhasebe) başlayıp eksik modülleri yol haritasında ekleme.
- Teknik ekip isterse `01-MIMARI.md`'yi paylaş.
