# FlexHotel kitapları

İki ayrı kitap üretir; her birinin kendi teması vardır:

| Çıktı | Kime | İçerik | Tema |
| --- | --- | --- | --- |
| `cikti/FlexHotel-Urun-Katalogu.pdf` | Müşteri | Modül tanıtımı, öne çıkan özellikler, gerçek ekranlar, kim ne yapar, diğer modüllerle bağlantı | `sablon/musteri.typ`: koyu kapak, kırmızı vurgu, yuvarlak kartlar |
| `cikti/FlexHotel-Teknik-Referans.pdf` | Teknik ekip | Mimari ve künye, dosya haritası, veri modeli ve kısıtlar, API uçları ve izinleri, olaylar, iş kuralları, eşzamanlılık, ölçek, testler, genişletme rehberi, sınırlar | `sablon/teknik.typ`: lacivert milimetrik kapak, eş aralıklı etiketler, §NN / NN.k numaralı bölümler, başlıklı tablolar |

Her modülün iki PDF'i ayrıca, ayrı dosyalar olarak tek klasörde toplanır: `cikti/moduller/NN-slug-musteri.pdf` ve
`cikti/moduller/NN-slug-teknik.pdf`; yeni modül üretildikçe bu klasöre eklenir. Müşteri kitabına kod adı, tablo ya da uç
girmez; teknik kitaba müşteri tanıtımı girmez.

Teknik tablolar (API uçları ve izinleri, tablolar, kısıtlar, migration'lar, olaylar, dosya haritası, künye, test sayıları)
**koddan çıkarılır**; elle yazılan yalnız `moduller/NN-slug.typ` içindeki metindir. Kod değişince yeniden üretmek yeter.

## Üretmek

```bash
node docs/katalog/uret.mjs --adim veri,pdf,kitap            # olgular + modül PDF'leri + iki kitap
node docs/katalog/uret.mjs --adim veri,kitap                # yalnız iki kitap
node docs/katalog/uret.mjs --modul 45 --adim veri,pdf       # tek modül
node docs/katalog/uret.mjs --modul 9 --adim goruntu,veri,pdf  # ekran görüntülerini de yeniden çek
```

Gerekenler:

- **veri:** `DATABASE_URL` tanımlı olmalı (rota eklentileri yüklenir, sorgu atılmaz).
- **goruntu:** demo verili ön yüz açık (`KATALOG_TABAN`, varsayılan `http://localhost:5173`), demo hesabı
  `KATALOG_EPOSTA` / `KATALOG_SIFRE` ortam değişkenlerinde, Edge ya da Chrome kurulu. Kanallar ekranı için sunucuda
  `SETTINGS_SECRET_KEY` tanımlı olmalı (yoksa ekranda "anahtar tanımlı değil" uyarısı görüntüye girer).
- **pdf / kitap:** [Typst](https://typst.app) 0.15 (`KATALOG_TYPST` ya da `PATH`'te `typst`). Fontlar `fontlar/` altında (OFL).

`cikti/`, `veri/`, `goruntuler/` ve `.uret/` üretilen dosyalardır, depoya girmez.

## Klasörler

- `uret.mjs` — üretici (adımlar: `veri`, `goruntu`, `pdf`, `kitap`); iki kitabın kısımları (iş alanları) da burada (`ALANLAR`).
- `moduller.mjs`, `moduller-diger.mjs` — modül kaydı: ad, slogan, kod yolları, rota desenleri, tablolar, izin grupları,
  olay önekleri ve ekran görüntüsü tarifleri.
- `araclar/olgular.mjs` — koddan olgu çıkarımı (rotalar ve gerçek izin denetimleri, Prisma modelleri, migration kısıtları,
  izin ve olay katalogları, dosya belge yorumları, satır / test sayıları).
- `araclar/goruntu.mjs` — headless tarayıcıyla ekran görüntüsü (Chrome DevTools Protocol).
- `sablon/ortak.typ` — marka, logo, yazı aileleri; `sablon/musteri.typ` — müşteri teması, `tanitim(...)`, ürün kataloğu;
  `sablon/teknik.typ` — teknik tema, `teknik-bolum(...)`, teknik referans; `sablon/standart.typ` — modül dosyalarının girişi.
- `moduller/NN-slug.typ` — modülün elle yazılan metni (`musteri(veri)` ve `teknik(veri)`).

## Yeni modül eklemek

1. `moduller-diger.mjs` (ya da `moduller.mjs`) kaydına giriş: kod yolları, rota desenleri, tablolar, izin grupları,
   olay önekleri, ekranlar.
2. `moduller/NN-slug.typ`: `#import "/sablon/standart.typ": *`, ardından `musteri(veri) = tanitim(veri, ...)` ve
   `teknik(veri) = teknik-bolum(veri, ...)`. Metin GOREVLER notundan ve koddan doğrulanarak yazılır — tahmin yazılmaz.
   Müşteri metninde kod adı (izin, olay, onay türü) kullanılmaz; onlar teknik kitabın tablolarındadır.
3. `uret.mjs` içindeki `ALANLAR`'a modül numarası (alansız modül kitap adımını durdurur).
4. `node docs/katalog/uret.mjs --modul NN --adim goruntu,veri,pdf` ve `--adim kitap`.
