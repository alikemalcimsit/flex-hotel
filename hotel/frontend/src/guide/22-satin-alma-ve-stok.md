# Satın alma ve stok

Bu bölüm malzemenin otele giriş-çıkış hikâyesini anlatır: ihtiyacın nasıl doğduğunu (elle, banket menüsü, minimum altı), tekliflerin nasıl karşılaştırıldığını, siparişin nasıl onaylandığını, mal kabulde stoğun ve maliyetin nasıl güncellendiğini; depoları, hareketleri, sayımı; satılan yemeğin reçeteden otomatik düşümünü; maliyet raporlarını. Her ekran için **nerede bulunur**, **ne yapar**, **adım adım**, **arka planda ne olur**, **dikkat edilecekler** düzeni izlenir; her alt bölümde sayılarla örnek vardır.

Kime hitap eder: satın alma sorumlusu, depo / mutfak personeli, şef, muhasebe, F&B müdürü ve ürün sahibi.

Dört ilke bütün bölümü özetler:

- **Hareket kaydı değişmezdir.** Her stok hareketi (giriş, çıkış, fire, transfer, sayım farkı, satış düşümü) o anki miktar ve ortalama maliyetle yazılır ve sonradan değiştirilmez. Raporlar bu kayıtlardan çıkar.
- **Maliyet yalnız mal kabulde değişir.** Hareketli ortalama maliyet girişte güncellenir; çıkış, fire, transfer, sayım farkı ve satış düşümü o anki ortalamayla değerlenir, ortalamayı değiştirmez.
- **Satılan yemek stoğu kendisi düşer.** Adisyon kapanınca Stok aktörü reçeteden malzemeye açar ve satış noktasının deposundan düşer.
- **Minimumun altı kendiliğinden talep olur.** Miktarı düşen malzeme minimumun altına inerse satın alma talebi açılır ve satın alma yetkilisine zil çalar.

## Büyük resim: zincir

| Adım | Ekran | Ne üretir |
|------|-------|-----------|
| İhtiyaç doğar | Satın alma → Talepler (elle) / Etkinlikler → Malzeme ihtiyacı (banket) / Stok aktörü (minimum altı) | **Talep** STR-yıl-sıra |
| Açık satırlar toplanır | Satın alma → Teklif turları → Açık satırlar | **Teklif turu** TKT-yıl-sıra |
| Tedarikçiler fiyat verir | Teklif turu ekranı → teklif gir | Tedarikçi teklifi (turda tedarikçi başına tek) |
| Satır bazında kazanan seçilir | Karşılaştırma matrisi | Tedarikçi başına **sipariş** SAS-yıl-sıra |
| Eşik üstü sipariş onaylanır | Onaylar | Onay (dört göz, 3 gün) |
| Mal gelir | Sipariş ekranı → Mal kabul | **Mal kabul** MKB-yıl-sıra + irsaliye no |
| Stok girer | Stok → Hareketler | "Giriş" hareketi, yeni ortalama maliyet, **tedarikçi borcu** olayı (ön muhasebe) |
| Yemek satılır | Restoran → adisyon kapanır | "Satış" hareketi (reçeteden), minimum altıysa yeni talep |
| Sayım yapılır | Stok → Sayım | "Sayım farkı" hareketi |
| Raporlanır | Stok → Maliyet raporu | Malzeme bazlı / ürün bazlı maliyet, yemek maliyeti % |

## Satın alma zinciri

**Nerede:** Ön büro → **Satın alma** (`/satin-alma`): sekmeler **Talepler** (`/satin-alma/talepler`), **Teklif turları** (`/satin-alma/teklif-turlari`; açık satırlar ve min. stok önerileri buradan), **Siparişler** (`/satin-alma/siparisler`), **Mal kabul** (`/satin-alma/mal-kabul`), **Tedarikçiler** (`/satin-alma/tedarikciler`).

**Yetkiler (düz dille):** görmek müdür, F&B, muhasebe; talep açmak müdür ve F&B; tur / kazanan / sipariş / tedarikçi / politika müdür (satın alma yönetimi); mal kabul müdür ve F&B; sipariş onayı onay karar yetkisi (isteyen kendi siparişini onaylayamaz).

### Talepler

**Ekran:** numara, kaynak (**banket ihtiyacı / elle / minimum stok**), ihtiyaç günü, malzeme ve etkinlik sayısı, tahmini tutar (talep anındaki birim maliyet), durum (**açık → teklif / siparişte → siparişe döndü**; iptal). Arama: numara ya da malzeme adı. Talep ekranı: malzeme başına toplam miktar, tahmini birim maliyet ve tutar, etkinlik dökümü (hangi etkinliğin hangi gün ihtiyacı), zincir (hangi tur, hangi sipariş); gerekçeli iptal; A4 çıktı.

Talebin durumu **satırlarından türer**: bütün satırlar tura girdiyse "teklif / siparişte", siparişe döndüyse "siparişe döndü". Tur kapatılınca siparişe dönmemiş satırlar talebe geri döner.

**Elle talep — adım adım:**

1. Talepler → "Yeni talep".
2. İhtiyaç günü (satır başına farklı gün verilebilir; boşsa talebinki).
3. Malzeme seçici (aktif kartlar) → miktar stok biriminde (adet / g / ml **tam sayı**; kg / L ondalıklı: "2,5").
4. Not. Kaydet → talep ekranı açılır.

**Üç kaynak:**

| Kaynak | Nasıl doğar | Satırda ne var |
|--------|-------------|----------------|
| Elle | Personel formdan açar | Malzeme, miktar, ihtiyaç günü |
| Banket ihtiyacı | Etkinlikler → Malzeme ihtiyacı → "Talebe çevir" (yalnız kesin dosyadan) | Malzeme × **etkinlik**, servisten hazırlık süresi kadar önceki gün |
| Minimum stok | Stok aktörü minimum altına inen malzeme için kendisi açar; ya da Satın alma → Min. stok önerileri'nden seçip açılır | Malzeme, açık = minimum − (eldeki + yoldaki + talepteki), ihtiyaç bugün + 2 gün |

### Minimum stok önerileri

**Nerede:** Satın alma → Teklif turları sekmesi altındaki "Min. stok önerileri" (talep açan / yöneten görür).

Öneri = **minimum − (eldeki + yoldaki siparişler + henüz siparişe dönmemiş elle / stok talepleri)**; sonuç > 0 olanlar, en kritik önce. Seçilenler (sayfalar arası) "minimum stok" kaynaklı talebe döner; miktar talep formunda düzenlenebilir. Minimum seviye **Stok → Mevcut** ekranında tanımlanır.

**Örnek:** Dana kıyma minimum 20 kg. Eldeki 6 kg, yoldaki sipariş 10 kg, siparişe dönmemiş açık talep 0 → öneri 20 − 16 = **4 kg**. Satın alma ister 4 kg ister ambalaja göre 5 kg yazar.

Bu ekran aynı hesabı **her an** gösterir; Stok aktörü kapalı olsa bile buradan elle talep açılabilir (bkz. "Aktör kapalıysa").

### Açık satırlar → teklif turu

**Nerede:** Teklif turları → **Açık satırlar**.

Henüz tura alınmamış talep satırları **malzeme başına toplanır** (toplam miktar, en erken ihtiyaç günü, kaç talep). Yönetici malzemeleri seçer (sayfalar arası; tur başına üst sınır var) ve "**Teklif turu aç**". Tur, seçilen malzemelerin ihtiyaç aralığındaki **bütün açık satırlarını** birleştirir. Ekranın gördüğü toplam bu arada değiştiyse (başka biri talep açtı / iptal etti) tur açılmaz, liste yenilenir — aynı satır iki tura giremez.

**Örnek:** Üç talep: STR-0101 (elle) kıyma 5 kg; STR-0102 (banket, düğün) kıyma 26,130 kg + bonfile 30,130 kg; STR-0103 (minimum stok) kıyma 4 kg. Açık satırlarda "Dana kıyma 35,130 kg — 3 talep — en erken 13 Ağustos", "Dana bonfile 30,130 kg — 1 talep". İkisi seçilir → **TKT-2027-0044** açılır.

### Tedarikçi teklifleri

**Nerede:** Teklif turu ekranı (`RoundPage`) → "Teklif gir".

| Alan | Açıklama |
|------|----------|
| Tedarikçi | Seçici; malzeme gruplarına göre öneriler (kasap grubunu tedarik edenler önce) |
| Termin (gün) | Sipariş verilirse kaç günde teslim; ekran "beklenen teslim" gününü hesaplar ve ihtiyaçtan geç ise uyarır |
| Geçerlilik | Teklifin son günü; süresi dolmuş teklif kazanan seçilemez |
| Satır fiyatları | **KDV hariç**, stok biriminde; boş = bu malzemeyi vermiyor |
| KDV % | %0 / 1 / 10 / 20 (politikadaki varsayılan gelir) |

Turda tedarikçi başına **tek** teklif (düzenlenir). Siparişe dönmüş / bırakılmış satırlar kilitli gösterilir. Her kayıt turun sürüm damgasını ilerletir; tur bu arada değiştiyse pencere kapanır, ekran yenilenir.

### Karşılaştırma matrisi ve satır bazında kazanan

Matris: satırlar malzeme × miktar × ihtiyaç günü; sütunlar tedarikçi teklifleri (termin → beklenen teslim, geçerlilik, toplam). Hücrede KDV hariç birim fiyat ve satır tutarı.

**En uygun** (yeşil) sıralaması: **ihtiyaca yetişen → fiyat → termin → önce girilen**. Ucuz ama ihtiyaç gününe yetişmeyen teklif önerilmez (geç uyarısı). Kazanan **satır bazında** seçilir (varsayılan en uygun); en uygun dışı seçim **gerekçe** ister. Süresi dolmuş teklif ve pasif tedarikçi seçilemez.

**Örnek:**

| Malzeme | Miktar | Kasap A (termin 1 gün) | Kasap B (termin 3 gün) | Toptancı C (termin 1 gün) |
|---------|--------|------------------------|------------------------|---------------------------|
| Dana kıyma | 35,130 kg | 520 → 18.267,60 | 505 → 17.740,65 | 540 → 18.970,20 |
| Dana bonfile | 30,130 kg | 980 → 29.527,40 | 950 → 28.623,50 | — |

İhtiyaç 13 Ağustos, bugün 11 Ağustos. Kasap B 3 günde (14 Ağustos) yetişmiyor → geç uyarısı; en uygun Kasap A (yeşil). Yönetici kıymada Kasap A'yı, bonfilede de Kasap A'yı seçer; "Siparişe dönüştür" → tek tedarikçi olduğundan tek sipariş **SAS-2027-0210**: 18.267,60 + 29.527,40 = 47.795,00 + KDV %1 = **48.272,95 TL**. Politika onay eşiği 20.000 TL → "onaya gider" işareti; sipariş onay bekler.

### Sipariş, onay, PDF

**Siparişler** sekmesi: numara, tedarikçi, tur, beklenen teslim (**gecikti** işareti), tutar ve teslim alınan, durum; "Teslim bekleyen" süzgeci (onaylı + kısmen teslim). Sipariş ekranı: tedarikçi, beklenen teslim, vade, onay durumu, satırlar (sipariş / alınan / kalan, seçim gerekçesi), mal kabuller; eylemler **PDF**, **Mal kabul**, **İptal** (onaylı ve teslim alınmamış), **Eksik kapat** (kısmen teslimde kalanı kapat).

**Onay:** KDV dahil tutar politika eşiğinde ya da üstündeyse "satın alma siparişi" onay türüyle kuyruğa düşer — **dört göz** (isteyen onaylayamaz); **3 gün** içinde karar yoksa reddedilmiş sayılır. Ret / iptal satırları **tura geri döndürür** (başka tedarikçi seçilebilir ya da tur kapatılırsa talebe döner).

### Mal kabul / irsaliye

**Nerede:** Sipariş ekranı → "Mal kabul"; liste **Mal kabul** sekmesinde (numara, irsaliye, kabul günü, tedarikçi, sipariş, depo, KDV dahil tutar, vade).

**Adım adım:**

1. **Depo** seçin (varsayılan depo önce seçili; mal kabul eden depo listesini görür).
2. **İrsaliye no** (tedarikçi başına tek — aynı irsaliye iki kez girilemez), kabul günü.
3. Satır başına **gelen miktar** (varsayılan kalan). Tartılan malzemede siparişin **%5 fazlasına** kadar kabul edilir (30,130 kg bonfile siparişine 31,2 kg gelebilir); adetli malzemede fazla kabul edilmez.
4. Eksik gelen için "**kalanı gelmeyecek**" (eksik kapat) işareti ya da açık bırakıp ikinci mal kabul.
5. Kaydet. Sipariş bu arada değiştiyse (başka kabul) pencere kapanır, ekran yenilenir.

**Kaydedince arka planda (tek işlem):**

| Ne olur | Nerede görünür |
|---------|----------------|
| Depo satırı artar, malzeme kartının toplam mevcudu artar | Stok → Mevcut |
| **Hareketli ortalama maliyet** güncellenir (aşağıda hesap) | Malzeme kartı, Stok → Mevcut |
| "Giriş" hareket kaydı yazılır (miktar, birim maliyet, hareket sonrası mevcut ve ortalama, kaynak: mal kabul numarası) | Stok → Hareketler |
| "Mal teslim alındı" olayı: tutar, **vade = kabul günü + tedarikçi vadesi** | **Ön muhasebe** tedarikçi carisine borç yazar |
| Sipariş durumu kısmen / tamamen teslim olur; talepler "siparişe döndü" | Satın alma ekranları |

**Örnek — kısmi teslim ve eksik kapatma:** SAS-2027-0210: kıyma 35,130 kg, bonfile 30,130 kg.

| Gün | İşlem | Kıyma (alınan / kalan) | Bonfile (alınan / kalan) | Sipariş durumu |
|-----|-------|------------------------|--------------------------|----------------|
| 12 Ağu | Mal kabul MKB-0301, irsaliye KA-7781: kıyma 35,2 kg (+%0,2), bonfile 20 kg | 35,200 / 0 | 20,000 / 10,130 | Kısmen teslim |
| 13 Ağu | Mal kabul MKB-0304, irsaliye KA-7790: bonfile 8 kg; tedarikçi "kalan gelmeyecek" dedi → **eksik kapat** | — | 28,000 / 0 (2,130 kg kapatıldı) | Teslim edildi |

Her mal kabul kendi stok girişini, kendi ortalama güncellemesini ve kendi tedarikçi borcunu (vade kendi kabul günü + 15) yazar. Eksik kapatılan 2,130 kg bonfile "yoldaki"den düşer; düğün ihtiyacı için eksik kalırsa Malzeme ihtiyacı ekranı yeniden eksik gösterir ve yeni talep açılır.

**KDV ve tutar örneği:** Sipariş satırı 35,130 kg × 520 = 18.267,60 (KDV hariç); KDV %1 → 182,68 (satırda yuvarlı); satır dahil 18.450,28. Onay eşiği **KDV dahil** sipariş toplamına bakar.

### Tedarikçiler

**Nerede:** Satın alma → **Tedarikçiler**. Pasif tedarikçi teklif veremez / kazanan olamaz. Altta **satın alma politikası**.

| Alan | Ne anlama gelir | Örnek |
|------|-----------------|-------|
| Ad, vergi no | İkisi de otel içinde tekil | Kasap A Et Ürünleri, 1234567890 |
| Yetkili, telefon, e-posta | Sipariş PDF'i bu kişiye gönderilir (elle) | — |
| Ödeme vadesi (gün) | Mal kabulde borcun vadesi = kabul günü + bu | 15 |
| Olağan termin (gün) | Teklif formunda varsayılan termin | 1 |
| Tedarik ettiği gruplar | Teklif girerken "bu gruba teklif verenler" önerisi | Kasap, şarküteri |
| Aktif | Pasif tedarikçi seçilemez; geçmiş bozulmaz | Evet |
| Açık sipariş / son sipariş | Kartta özet | 2 açık, son 12.08 |

**Satın alma politikası:**

| Alan | Ne yapar | Örnek |
|------|----------|-------|
| Sipariş onay eşiği | KDV dahil tutar bu değere eşit ya da üstüyse dört göz onayı | 20.000 TL |
| Varsayılan KDV % | Teklif formunda önceden seçili | %10 |

### Satın alma zinciri — arka plan özet tablosu

| Ne tetikler | Ne olur | Nerede görünür | Hatada / kapalıysa |
|-------------|---------|----------------|--------------------|
| Banket menüsü kesinleşti, "Talebe çevir" | Eksik kilit altında yeniden hesaplanır; talep açılır (kaynak banket) | Satın alma → Talepler | Eksik bu arada değiştiyse açılmaz, liste yenilenir |
| Malzeme minimumun altına indi | Stok aktörü talep açar (kaynak minimum stok) + zil | Talepler, zil | Aktör kapalıysa yalnız öneri ekranında görünür |
| Tur açıldı | Seçilen malzemelerin açık satırları tura bağlanır; talepler "teklif / siparişte" | Teklif turları | Satırlar değişmişse "satırlar değişti" |
| Teklif girildi | Turun sürümü ilerler | Karşılaştırma matrisi | Tur değişmişse pencere kapanır |
| Kazanan → sipariş | Tedarikçi başına sipariş; eşik üstüyse onay kaydı | Siparişler, Onaylar | Onay 3 günde verilmezse red; satırlar tura döner |
| Sipariş onaylandı | Durum onaylı; PDF indirilebilir | Sipariş ekranı | — |
| Mal kabul | Stok girişi, ortalama maliyet, tedarikçi borcu, sipariş durumu | Stok → Hareketler, Ön muhasebe → Cariler | Aynı siparişe eşzamanlı ikinci kabul "bayat sürüm" |
| Sipariş iptal | Satırlar tura döner; yoldaki düşer | Teklif turları | Teslim alınmışsa iptal edilemez |
| Tur kapatıldı | Siparişe dönmemiş satırlar talebe döner | Talepler "açık" | — |

### Yetki özeti (düz dille)

| İş | Kim |
|----|-----|
| Talepleri, turları, siparişleri, mal kabulleri görmek | Müdür, F&B, muhasebe |
| Elle talep açmak, banket ihtiyacından talep açmak, talep iptali | Müdür, F&B |
| Tur açmak, teklif girmek, kazanan seçmek, sipariş iptal / eksik kapat, tedarikçi ve politika | Müdür (satın alma yönetimi) |
| Sipariş onayı | Onay karar yetkisi olan **başka** kişi |
| Mal kabul | Müdür, F&B |
| Stok görmek (mevcut, hareket, sayım, rapor) | Müdür, muhasebe, F&B |
| Depo, minimum seviye, elle hareket, sayım, nokta → depo eşlemesi | Müdür (stok yönetimi) |
| Malzeme kartı (ad, birim, alerjen) | Reçete yönetimi (müdür / şef) |

### Eşzamanlılık güvenceleri

Aynı satırlara iki tur, aynı tura iki kazanan, aynı siparişe iki mal kabul aynı anda denenirse biri geçer, diğeri "satırlar değişti" / "bayat sürüm" ile reddedilir ve ekran yenilenir. Veritabanı kısıtları son savunmadır: teslim alınan ≤ sipariş (+%5), siparişli tur satırı bırakılamaz, onay bekleyen siparişin onayı vardır, tek varsayılan depo.

## Stok

**Nerede:** Ön büro → **Stok** (`/stok`): **Mevcut** (`/stok`), **Hareketler** (`/stok/hareketler`), **Sayım** (`/stok/sayim`, `/stok/sayim/:countId`), **Maliyet raporu** (`/stok/maliyet`), **Depolar** (`/stok/depolar`).

**Yetkiler:** görmek müdür, muhasebe, F&B (stok görüntüleme); depo tanımı, minimum seviye, elle hareket, sayım, satış noktası → depo eşlemesi müdür (stok yönetimi). Mal kabul eden depo listesini görür (irsaliyede depo seçer).

### Depolar

**Ekran:** kod, ad, **varsayılan** işareti, stoklu malzeme sayısı ve değer; aktif / pasif. En fazla sınırlı sayıda depo (otel ölçeğinde yeterli).

Kurallar: otelde **tek varsayılan depo** (mal kabulde önce seçili; pasife alınamaz); **stoğu olan depo pasife alınamaz** — önce Hareketler → Transfer ile boşaltılır.

**Depo açma — adım adım:**

1. Depolar → "Yeni depo": kod (ANA, BAR, KIOSK), ad.
2. Varsayılan olacaksa işaretleyin (öncekinin işareti kalkar; otelde tek).
3. Kaydet. Yeni depo mal kabul penceresinde ve hareket formunda seçilebilir.

**Ne zaman ayrı depo açılır:** fiziksel olarak ayrı yerde sayılan ve sorumlusu ayrı olan her stok (bar, havuz kiosk, kat hizmetleri temizlik deposu). Aynı soğuk odayı paylaşan iki mutfak için ayrı depo açmak sayımı zorlaştırır.

**Depo satırı örneği:**

| Kod | Ad | Varsayılan | Stoklu malzeme | Değer | Aktif |
|-----|----|-----------|----------------|-------|-------|
| ANA | Ana depo | Evet | 184 | 412.350,20 | Evet |
| BAR | Bar deposu | — | 37 | 58.120,00 | Evet |
| KIOSK | Havuz kiosk | — | 0 | 0,00 | Pasif (sezon dışı; önce boşaltıldı) |

#### Satış noktası → depo eşlemesi

Depolar ekranının altındaki kart: hangi satış noktasının (restoran, bar, oda servisi, paket) satışı **hangi depodan** düşer. Eşlenmeyen nokta **varsayılan depodan** düşer. Kayıt otel ayarının sürüm damgasıyla (iki kişi aynı anda değiştirirse ikincisi uyarı alır).

**Örnek:** Depolar: "Ana depo" (varsayılan), "Bar deposu", "Havuz kiosk". Eşleme: Bar → Bar deposu; Havuz bar → Havuz kiosk; Ana Restoran, Oda servisi, Paket servis eşlenmemiş → Ana depo.

### Mevcut ekranı

**Ekran:** özet kutuları (**stok değeri**, eldeki malzeme sayısı, **minimum altı** sayısı, depo sayısı); malzeme başına satır:

| Sütun | Anlamı |
|-------|--------|
| Toplam mevcut | Depoların toplamı (malzeme kartı) |
| Depo dağılımı | Depo başına miktar |
| Yoldaki | Açık siparişlerin teslim alınmamış kısmı |
| Minimum | Altına düşen satın alma önerisine girer; burada düzenlenir (stok yönetimi) |
| Ortalama maliyet | Hareketli ortalama, KDV hariç, otel geneli tek değer (depolar arası aynı) |
| Değer | Mevcut × ortalama maliyet; eksi mevcut 0 değer sayılır |

Arama, grup süzgeci, görünüm süzgeci (minimum altı, eksi, sıfır…).

**Minimum seviye tanımlama — adım adım:**

1. Mevcut ekranında malzeme satırındaki minimum alanına (kalem simgesi) tıklayın.
2. Miktarı stok biriminde yazın (kıyma 20 kg; yumurta 300 adet; zeytinyağı 15 L).
3. Kaydet. Değişiklik "stok değişti (minimum)" olayı yayınlar; bu olay satın alma önerisi **tetiklemez** (yalnız miktar değişimleri tetikler) — ama Satın alma → Min. stok önerileri ekranı yeni minimuma göre anında hesaplar.

**Minimum nasıl seçilir (öneri):** günlük ortalama tüketim × (tedarik süresi + emniyet günü). Kıyma günde ~6 kg tüketiliyor, tedarik 1 gün, emniyet 2 gün → 6 × 3 = **18 kg**; 20 kg yuvarlanır.

**Örnek satır:**

| Malzeme | Toplam | Ana depo | Bar deposu | Yoldaki | Minimum | Ortalama | Değer |
|---------|--------|----------|------------|---------|---------|----------|-------|
| Dana kıyma | 23,200 kg | 23,200 | 0 | 0 | 20 | 420,17 | 9.748,00 |
| Limon | 70 adet | 45 | 25 | 0 | 50 | 4,50 | 315,00 |
| Taze somon | 6,300 kg | 6,300 | 0 | 10,000 | 8 | 680,00 | 4.284,00 (minimum altı — ama yoldaki 10 kg olduğu için öneri 0) |
| Zeytinyağı 5 L | −1,0 | −1,0 | 0 | 0 | 6 | 310,00 | 0,00 (eksi mevcut 0 değer; sayım gerekir) |

### Hareketli ortalama maliyet — nasıl hesaplanır

Her **girişte** malzemenin birim maliyeti eldeki ve gelen miktarın **ağırlıklı ortalamasına** çekilir:

> yeni maliyet = (eldeki × eski maliyet + gelen × alış fiyatı) ÷ (eldeki + gelen)

Elde stok **yoksa ya da eksideyse** yeni maliyet doğrudan alış fiyatıdır (eksi stoğun eski maliyeti ortalamaya karışırsa anlamsız "eksi ağırlık" doğar). Maliyet 4 ondalık basamakla saklanır. Aynı irsaliyede aynı malzemenin iki satırı sırayla işlenir; ikincisi birincinin sonucunu "eldeki" sayar.

**Örnek 1 — tek giriş:** Kıyma: eldeki 10 kg @ 400,00 TL. Mal kabul 5 kg @ 430,00 TL.
yeni = (10 × 400 + 5 × 430) ÷ (10 + 5) = (4.000 + 2.150) ÷ 15 = 6.150 ÷ 15 = **410,00 TL/kg**. Mevcut 15 kg, değer 6.150 TL.

**Örnek 2 — aynı irsaliyede iki satır:** Eldeki 15 kg @ 410. Satır A 10 kg @ 450 → (15 × 410 + 10 × 450) ÷ 25 = (6.150 + 4.500) ÷ 25 = **426,00**. Satır B 5 kg @ 420 → (25 × 426 + 5 × 420) ÷ 30 = (10.650 + 2.100) ÷ 30 = **425,00 TL/kg**. Mevcut 30 kg, değer 12.750 TL.

**Örnek 3 — çıkış maliyeti değiştirmez:** 30 kg @ 425'ten 8 kg çıkış yapılır. Mevcut 22 kg, ortalama **425 kalır**; çıkış hareketi 8 × 425 = 3.400 TL ile değerlenir.

**Örnek 4 — eksiden giriş:** Satış düşümüyle kıyma −2 kg'a inmiş (kayıt geride kalmış). Mal kabul 20 kg @ 440 → eldeki ≤ 0 olduğundan yeni maliyet **440,00**; mevcut 18 kg.

Maliyet **otel geneli tek değerdir**: Bar deposundaki ve Ana depodaki kıymanın ortalaması aynıdır; transfer maliyeti değiştirmez.

### Hareket türleri

| Tür | İşaret | Ne zaman | Maliyet etkisi | Kaynak bağı |
|-----|--------|----------|----------------|-------------|
| **Giriş** (mal kabul) | + | İrsaliye kaydedilince | Ortalamayı **günceller** | Mal kabul no |
| **Çıkış** | − | Departman kullanımı (kat hizmetleri temizlik malzemesi, personel yemeği…) | O anki ortalamayla değerlenir | Elle hareket (not) |
| **Fire** | − | Bozulma, son kullanma, kırılma; **sebep zorunlu** | O anki ortalama | Elle hareket (sebep) |
| **Transfer çıkan / giren** | − / + | Depolar arası; kaynakta eksi, hedefte artı, **kart toplamı sabit** | Değişmez | Elle hareket |
| **Sayım farkı** | ± | Sayım onaylanınca, sayılan − o anki mevcut | O anki ortalama | Sayım no |
| **Satış** | − (düzeltmede +) | Adisyon kapanınca reçeteden | O anki ortalama | Adisyon no + menü ürünü |

### Hareketler ekranı

Değişmez kayıtlar, en yeni önce: tür rozeti (giriş yeşil, transfer / sayım bilgi, çıkış / fire / satış uyarı), malzeme, depo, miktar, birim maliyet, **hareket sonrası mevcut ve ortalama**, kaynak belge bağlantısı (mal kabul, sayım, adisyon; elle harekette not / sebep), kim, ne zaman. Süzgeç: malzeme, depo, tür, gün aralığı (otelin günü).

**Hareket satırı örneği (Hareketler ekranı):**

| Zaman | Tür | Malzeme | Depo | Miktar | Birim maliyet | Sonra mevcut | Sonra ortalama | Kaynak |
|-------|-----|---------|------|--------|---------------|--------------|----------------|--------|
| 03.09 10:12 | Giriş | Dana kıyma | Ana depo | +15,600 kg | 430,00 | 23,200 | 420,17 | MKB-2027-0304 |
| 03.09 13:40 | Satış | Dana kıyma | Ana depo | −0,600 kg | 420,17 | 22,600 | 420,17 | ADS-2027-1203 · Izgara köfte |
| 05.09 09:05 | Fire | Dana kıyma | Ana depo | −1,200 kg | 420,17 | 21,400 | 420,17 | Elle · "son kullanma" |
| 06.09 16:30 | Transfer çıkan | Limon | Ana depo | −15 adet | 4,50 | 45 | 4,50 | Elle · Bar deposuna |
| 06.09 16:30 | Transfer giren | Limon | Bar deposu | +15 adet | 4,50 | 25 | 4,50 | Elle · Ana depodan |
| 07.09 11:45 | Sayım farkı | Dana kıyma | Ana depo | +0,200 kg | 420,17 | 20,400 | 420,17 | SYM-2027-0012 |

"Sonra mevcut" depodaki mevcuttur; "sonra ortalama" kartın otel geneli ortalaması. Süzgeçle "yalnız fire, Eylül" seçilince aylık fire listesi ve toplam tutarı çıkar.

### "Hareket gir" formu — adım adım

**Nerede:** Hareketler → "**Hareket gir**" (stok yönetimi yetkisi).

1. **Tür çipi** seçin: Çıkış / Fire / Transfer.
2. **Depo** (kaynak). Transferde ayrıca **hedef depo** (kaynaktan farklı).
3. Satır ekle: malzeme arama seçicisi → **miktar** stok biriminde ("2,5" kg olur; adet / g / ml tam sayı).
4. Fire ise **sebep** zorunlu (serbest metin: "son kullanma geçti", "soğutucu arızası"). Çıkış ve transferde not isteğe bağlı.
5. Kaydet. Sonuç özeti satır başına hareket sonrası mevcudu ve tutarı gösterir.

Kurallar: miktar depodaki mevcuttan **fazla olamaz** ("yetersiz stok" satır hatasıyla döner — eksiye yalnız satış düşümü iner); pasif malzeme seçilemez; formun ürettiği istek kimliğiyle **çift gönderim** ikinci hareket yazmaz (ilk özeti döner).

**Örnek — fire:** Ana depo, fire, "Taze somon 3,2 kg", sebep "soğutucu arızası". Somon ortalaması 680 TL → hareket 3,2 × 680 = **2.176 TL** değerle yazılır; mevcut 9,5 → 6,3 kg; ortalama 680 kalır. Maliyet raporunda "fire" sütununda 2.176 TL görünür.

**Örnek — transfer:** Ana depo → Bar deposu, "Limon 15 adet". Ana depo 60 → 45, Bar 10 → 25; kart toplamı 70 adet değişmez; iki hareket (çıkan / giren) aynı anda yazılır.

### Sayım

**Nerede:** Stok → **Sayım**: depo başına sayım listesi; sayım ekranı `/stok/sayim/:countId`. Numara **SYM-yıl-sıra**. Depoda aynı anda **tek açık sayım**.

**Adım adım:**

1. **Aç:** depo seçin → "Sayım aç". Açılışta deponun **sıfır olmayan mevcutları** ve o anki ortalama maliyet "**beklenen**" olarak dondurulur (sayım sürerken giren mal listeyi kaydırmaz).
2. **Say:** her satıra **sayılan** miktarı yazın; boş = sayılmadı. Listede olmayan malzeme (depoda görünmeyen ama rafta bulunan) aranıp eklenir (beklenen = o anki depo mevcudu, çoğu zaman 0). "**Kaydet**" ile gönderin. Kayıt, sayım ekranının gördüğü sürümle gider: iki sayımcı aynı anda yazarsa ikincisi "liste güncellendi" uyarısıyla güncel listeyi görür, kendi girişini tekrar yazar.
3. **Onayla:** sayılan her satır için **fark = sayılan − onay anındaki depo mevcudu** (beklenen değil! sayım sürerken satış / çıkış devam eder). Sıfır olmayan fark "**sayım farkı**" hareketi olur (o anki ortalama maliyetle; maliyet değişmez). **Sayılmayan satıra dokunulmaz.** Fazla da eksik de yalnız onayla stoğa işler.
4. **İptal:** sebep girilir; hiçbir şeye dokunmaz.

Ekran satır başına: beklenen (açılıştaki), **şu anki** mevcut, sayılan, fark ve farkın değeri.

**Örnek:** Ana depo sayımı 10:00'da açılır. Kıyma: beklenen 22,000 kg @ 425. Sayım 11:30'da biter: sayılan **20,400 kg**. Bu arada öğle servisinde 1,800 kg satış düşümü oldu → onay anındaki mevcut 20,200 kg. **Fark = 20,400 − 20,200 = +0,200 kg** (fazla). Beklenenle karşılaştırılsaydı −1,600 görünür ve öğle satışı "kayıp" sanılırdı. Hareket: sayım farkı +0,200 kg × 425 = +85 TL. Kıyma 20,400 kg olur; ortalama 425 kalır.

Aynı sayımda "Zeytinyağı 5 L": beklenen 12,0, şu anki 12,0, sayılan 10,5 → fark **−1,5 L**; ortalama 310 TL → −465 TL kayıp. Maliyet raporunda "sayım farkı" sütununda görünür (tüketimden ayrı: kayıp / fazla).

**Dikkat:** sayım açıkken mal kabul / hareket yapılabilir; onay hesabı her zaman güncel mevcudu baz alır. Aynı depoda ikinci sayım açılamaz; önce onaylayın ya da iptal edin.

### Satış düşümü (reçeteden otomatik)

**Ne tetikler:** Adisyon kapanınca (restoran, oda servisi, paket) yayınlanan "**adisyon kapandı**" olayı: ürün başına **satılan / ikram / zayi** adet.

**Ne olur (Stok aktörü):**

1. Her ürün için **reçete** bulunur (ürüne bağlı reçete). Reçetesiz ürün ve **sistem ürünleri** (oda servisi ücreti, paket servis ücreti) **atlanır**, özette sayılır.
2. Reçete malzemeye **açılır**: ara reçeteler kendi satırlarına, fire payı **brüt** olarak (net ÷ (1 − fire)).
3. Düşülecek miktar = **(satılan + ikram + zayi) × birim ihtiyaç**, binde bire yuvarlı. İkram ve zayi edilen ürün de malzeme tüketmiştir; iptal (hazırlanmamış) tüketmemiştir.
4. **Hangi depo:** satış noktasının eşlendiği depo, yoksa varsayılan depo.
5. "**Satış**" hareketleri yazılır: kaynak adisyon numarası, **menü ürünü kimliği** (ürün bazlı rapor için). **Stok eksiye inebilir**: adisyon gerçektir, kayıt geride kalmıştır — sayım düzeltir.
6. Miktarı düşen malzemeler için **minimum altı denetimi** (aşağıda).

**Örnek — köfte, 5 porsiyon:** Reçete (1 porsiyon): kıyma 200 g; yumurta 0,4 adet (2 yumurta / 5 porsiyon); soğan 30 g fire %12; ekmek içi 20 g. Adisyonda 4 satılan + 1 ikram = 5 porsiyon.

| Malzeme | Birim ihtiyaç (brüt) | × 5 | Yuvarlı | Değer (ortalama) |
|---------|----------------------|-----|---------|------------------|
| Dana kıyma | 200 g | 1.000 g | **1,000 kg** | 1,000 × 425 = 425,00 |
| Yumurta | 0,4 adet | 2 adet | **2 adet** | 2 × 6 = 12,00 |
| Soğan | 30 ÷ 0,88 = 34,09 g | 170,45 g | **0,170 kg** | 0,170 × 18 = 3,06 |
| Ekmek içi | 20 g | 100 g | **0,100 kg** | 0,100 × 60 = 6,00 |

Ana depodan dört "satış" hareketi; adisyon ADS-2027-1187 bağı; ürün "Izgara köfte". Toplam reçete maliyeti 446,06 TL (5 porsiyon; porsiyon başı 89,21).

**Yeniden açılan adisyon:** Adisyon yeniden açılıp kapanırsa olay **yeniden** gelir; adisyon başına **son yayın** esastır: hedef tüketim − daha önce düşülen = **düzeltme hareketi** (artı ya da eksi). Örnek: yukarıdaki adisyon yeniden açılır, bir köfte iptal edilir (hazırlanmamış) → hedef 4 porsiyon → kıyma düzeltmesi **+0,200 kg** (geri gelir). Daha yeni bir kapanış işlenmişse eski yayın atlanır. Satış noktası bu arada başka depoya eşlendiyse eski depodaki düşüm tamamen geri alınır, yeni depodan baştan düşülür.

**Aynı olayın iki kopyası** aynı anda gelse kart kilidi sıralar; ikincisi fark görmez (çift düşüm yok).

### Minimum altı → otomatik satın alma talebi + zil

**Ne tetikler:** "stok değişti" olayı — yalnız **satış, elle hareket (çıkış / fire / transfer) ve sayım** kaynaklı olanlar; miktarı değişen malzeme listesiyle. Mal kabul, depo, minimum ve ayar değişikliği tetiklemez (giriş stoğu düşürmez).

**Ne olur (Stok aktörü, tek işlem, kartlar kilitliyken):**

1. Miktarı değişen malzemelerden **minimumun altına inenler** bulunur.
2. Açık = minimum − (eldeki + yoldaki sipariş + siparişe dönmemiş elle / stok talebi) > 0 — Satın alma'daki öneri ekranıyla **aynı hesap**, aynı yuvarlama.
3. Açığı olanlar için **tek** satın alma talebi açılır: kaynak **minimum stok**, satırlar malzeme başına, ihtiyaç günü **bugün + 2 gün**.
4. Satın alma yetkilisine **zil** ("stok" uyarısı; talebe bağlantı).

Açılan talep "talep edilen"e sayıldığı için aynı malzeme için **ikinci talep açılmaz**; talep iptal edilirse bir sonraki hareket yeniden önerir. Aynı anda kapanan iki adisyon aynı açık için iki talep açamaz (ikincisi kilidi bekler, güncel "talep edilen"i görür). Öneri işi kendisi "stok değişti" yayınlamaz → döngü yoktur.

**Örnek:** Kıyma minimum 20 kg. Akşam servisinde düşümlerle mevcut 19,2 kg'a iner; yoldaki 0, talepte 0 → açık 0,8 kg → talep **STR-2027-0188** (minimum stok, kıyma 0,800 kg, ihtiyaç 2 gün sonra) + satın alma yetkilisine zil. Ertesi gün yeni düşümler mevcudu 15 kg'a indirir: açık = 20 − (15 + 0 + 0,8) = 4,2 kg → ama talep zaten var… **dikkat:** hesap talep edilen 0,8'i düşer, kalan 4,2 kg açıktır → yeni bir talep açılır mı? Evet: açık > 0 olduğu için 4,200 kg'lık ikinci bir satır / talep doğar. Pratikte satın alma ilk talebi tura alırken miktarı ambalaja göre (örneğin 20 kg) artırırsa sonraki hareketlerde açık kalmaz ve ikinci talep doğmaz. Öneri ekranındaki miktarı gerçek alım miktarına çıkarmak bu yüzden iyi alışkanlıktır.

### Aktör kapalıysa / hatada ne olur

**Nerede:** Yönetim → **Aktörler** → "Stok aktörü" (inventory-worker). Dinlediği olaylar: adisyon kapandı, stok değişti. Yayınladığı: stok değişti, satın alma talebi değişti, personel uyarısı.

| Durum | Satış düşümü | Minimum altı önerisi |
|-------|--------------|----------------------|
| Aktör açık, her şey yolunda | Otomatik "satış" hareketleri | Otomatik talep + zil |
| Aktör **kapalı** | **"Stok" manuel görevi** düşer (Görevler menüsü; görev adisyon numarasını taşır); stok yetkilisi "Hareket gir → Çıkış" ile elle düşer ve görevi tamamlar | Atlanır (görev açılmaz); Satın alma → Min. stok önerileri aynı hesabı her an gösterir, elle talep açılır |
| Depo yok ya da satış noktasının deposu **pasif** | İş kuralı hatası → manuel göreve düşer (depoyu düzeltip görevi elle tamamlayın) | — |
| Geçici hata (veritabanı kopması) | Aktör 3 kez dener (artan bekleme); yine olmazsa manuel görev | Aynı |
| Ürünün reçetesi yok | Atlanır, özette "reçetesiz" sayılır; görev açılmaz | — |

Aktör yeniden açılınca bekleyen manuel görevler kendiliğinden kapanmaz; elle düşüm yapılmış görevler tamamlanır, yapılmamışlar görev listesinde kalır.

### Maliyet raporu

**Nerede:** Stok → **Maliyet raporu** (`/stok/maliyet`): iki görünüm, özet kutuları, dönem (en fazla 366 gün), depo süzgeci.

#### Malzeme bazlı

Dönemde malzeme başına: **giriş** (mal kabul), **satış düşümü**, **çıkış**, **fire**, **sayım farkı**, **transfer** (depo süzgecinde net) — miktar ve tutar (her hareket kendi anındaki ortalamayla); **bugünkü mevcut ve değer** (depo süzgecinde deponun mevcudu × kartın ortalaması). **Tüketim = satış + çıkış + fire**; sayım farkı ayrı (kayıp / fazla). Gün aralığı otelin günüdür; hareketler işlem anına göre.

**Örnek (Ağustos, kıyma):** giriş 120 kg / 51.600 TL; satış düşümü 98,4 kg / 41.820 TL; çıkış 2 kg / 850 TL (personel yemeği); fire 1,5 kg / 637,50 TL; sayım farkı −0,8 kg / −340 TL; transfer (Bar deposuna) −3 kg. Tüketim = 98,4 + 2 + 1,5 = **101,9 kg / 43.307,50 TL**. Dönem sonu mevcut 36,3 kg × 425 = 15.427,50 TL.

#### Ürün bazlı (yemek maliyeti %)

Menü ürünü başına: **satılan adet ve ciro** (kapanan adisyon kalemleri, iş günü aralığı; liste fiyatıyla, iptal / ikram düşülmüş), **reçeteden düşen maliyet** (satış hareketlerinden, adisyonun iş gününe göre — ciro ile aynı takvim) → **brüt kâr** ve **yemek maliyeti %** (%30 / %38 eşikleri renkli).

**Örnek (Ağustos, Izgara köfte):** satılan 412 adet, ciro 412 × 380 = 156.560 TL (KDV dahil liste); satış hareketleri (ikram ve zayi dahil 431 porsiyonluk malzeme) 38.447 TL → brüt kâr 118.113 TL, yemek maliyeti % = 38.447 ÷ 156.560 = **%24,6** (yeşil). İkram / zayi oranı yüksekse maliyet % satılan adet başına şişer — bu bilinçli: gerçek malzeme gitti.

**Bilinçli sınır:** ürün bazlı ciro KDV dahil liste fiyatıyladır (reçete listesindeki gıda maliyeti % ise KDV hariç satış fiyatıyla hesaplanır — ikisi farklı çıkabilir; rapor "gerçekleşen", reçete listesi "teorik" değerdir). Fire için ayrı sebep sözlüğü yoktur (serbest metin).

## Günlük, haftalık, aylık rutin (öneri)

| Sıklık | Kim | Ne yapar | Nerede |
|--------|-----|----------|--------|
| Her gün sabah | Satın alma | Zile düşen minimum altı taleplerini ve banket taleplerini gözden geçir; miktarları gerçek alım miktarına çıkar; tur aç | Satın alma → Talepler / Açık satırlar |
| Her gün | Depo / mutfak | Gelen malı irsaliyeyle **aynı gün** mal kabul et; fire ve çıkışları gir | Sipariş ekranı → Mal kabul; Stok → Hareketler |
| Her gün | Şef garson / F&B | Görevler menüsünde "Stok" manuel görevi var mı bak (aktör kapalı ya da depo sorunu) | Görevler |
| Haftada bir | Depo | Hassas gruplar (et, balık, süt) için kısa sayım | Stok → Sayım |
| Ayda bir | Depo + muhasebe | Depo bazında tam sayım; farkları onayla | Stok → Sayım |
| Ayda bir | F&B müdürü / muhasebe | Maliyet raporu: malzeme bazlı tüketim ve fire; ürün bazlı yemek maliyeti %; eşik üstü ürünlerin reçetesini / fiyatını gözden geçir | Stok → Maliyet raporu; Mutfak → Reçeteler |
| Ayda bir | Satın alma | Tedarikçi vadelerini ve açık siparişleri (gecikti işareti) kontrol et | Satın alma → Siparişler; Ön muhasebe |

## Uçtan uca örnek: bir köfte porsiyonundan mal kabule

**Başlangıç (1 Eylül):** Ana depo (varsayılan). Dana kıyma: mevcut 10,000 kg, ortalama 400,00 TL, minimum 8 kg. Reçete "Izgara köfte": kıyma 200 g, yumurta 0,4 adet, soğan 30 g fire %12, ekmek içi 20 g. Ana Restoran eşlenmemiş → Ana depodan düşer. Satın alma politikası: onay eşiği 20.000 TL. Tedarikçi Kasap A: vade 15 gün, termin 1 gün.

1. **Satış (1 Eylül akşamı):** 6 adisyon toplam 12 köfte (11 satılan + 1 ikram). Her adisyon kapanışında Stok aktörü düşer: toplam kıyma 12 × 0,200 = **2,400 kg**. Mevcut 7,600 kg. Hareketler ekranında 6 "satış" satırı, her biri adisyon numarasıyla, ortalama 400 TL'den değerlenmiş.
2. **Minimum altı:** son adisyonun düşümüyle 7,600 < 8 → açık = 8 − (7,6 + 0 + 0) = **0,400 kg** → talep **STR-2027-0201** (minimum stok, ihtiyaç 3 Eylül) + satın alma yetkilisine zil.
3. **Talep düzeltme (2 Eylül sabah):** Satın alma sorumlusu talebi görür; 0,4 kg almak anlamsız — "Açık satırlar"da kıymayı seçip tur açar (**TKT-2027-0050**) ve elle 15 kg'lık ek talep açıp aynı tura katar: toplam 15,400 kg.
4. **Teklifler:** Kasap A 430 TL (termin 1 gün), Kasap B 415 TL (termin 4 gün — 3 Eylül'e yetişmez, geç uyarısı). En uygun Kasap A. Kazanan seçilir → **SAS-2027-0230**: 15,4 × 430 = 6.622 TL + KDV %1 = 6.688,22 TL. Eşik altı → onay gerekmez, sipariş onaylı. PDF tedarikçiye gönderilir.
5. **Mal kabul (3 Eylül):** 15,4 kg yerine tartı 15,600 kg geldi (+%1,3, %5 sınırı içinde). İrsaliye "KA-7781", Ana depo. Kaydedilince:
   - Giriş hareketi 15,600 kg @ 430.
   - **Yeni ortalama = (7,600 × 400 + 15,600 × 430) ÷ (7,600 + 15,600) = (3.040 + 6.708) ÷ 23,2 = 9.748 ÷ 23,2 = 420,17 TL/kg.** Mevcut 23,200 kg, değer 9.748 TL.
   - Ön muhasebeye Kasap A borcu 6.688,22 TL (KDV dahil), vade 18 Eylül.
   - Sipariş "teslim edildi"; talepler "siparişe döndü".
6. **Fire (5 Eylül):** 1,2 kg kıyma renk değiştirdi → "Hareket gir → Fire", sebep "son kullanma". 1,2 × 420,17 = 504,20 TL fire. Mevcut 22,000 kg; ortalama değişmez.
7. **Sayım (7 Eylül):** Ana depo sayımı açılır; kıyma beklenen 22,000. Sayım sırasında öğle servisinde 1,8 kg düştü; sayılan 20,400; onay anındaki mevcut 20,200 → fark **+0,200 kg** (+84,03 TL). Mevcut 20,400 kg.
8. **Maliyet raporu (1–7 Eylül, kıyma):** giriş 15,600 kg / 6.708 TL; satış düşümü toplam (akşam + öğle servisleri) 4,200 kg; fire 1,200 kg / 504,20 TL; sayım farkı +0,200 kg / +84,03 TL; mevcut 20,400 kg × 420,17 = 8.571,47 TL. Ürün bazlı: Izgara köfte satılan 11 + sonrası, ciro, reçete maliyeti, yemek maliyeti %.
9. **Reçete listesi:** köfte porsiyon maliyeti kıymanın yeni ortalamasıyla (0,200 × 420,17 = 84,03 kıyma payı) kendiliğinden güncellenmiştir; gıda maliyeti % buna göre.

## Terimler sözlüğü

| Terim | Anlamı |
|-------|--------|
| Talep (STR) | "Şu malzemeden şu kadar, şu güne lazım" kaydı; kaynak elle / banket / minimum stok |
| Açık satır | Henüz teklif turuna alınmamış talep satırı |
| Teklif turu (TKT) | Bir grup malzeme için tedarikçilerden fiyat istenen dönem |
| Kazanan | Satır (malzeme) bazında seçilen tedarikçi teklifi |
| Sipariş (SAS) | Tedarikçi başına, kazanan satırlardan oluşan satın alma emri |
| Mal kabul (MKB) / irsaliye | Gelen malın sayılıp depoya alındığı kayıt; stok girişi ve tedarikçi borcu burada doğar |
| Yoldaki | Onaylı siparişlerin henüz teslim alınmamış miktarı |
| Hareketli ortalama maliyet | Her girişte eldeki ve gelenin ağırlıklı ortalamasıyla güncellenen birim maliyet |
| Hareket | Değişmez stok kaydı: giriş, çıkış, fire, transfer çıkan / giren, sayım farkı, satış |
| Satış düşümü | Kapanan adisyonun ürünlerinin reçeteden malzemeye açılıp depodan düşülmesi |
| Beklenen (sayımda) | Sayım açılırken dondurulan depo mevcudu; fark bununla değil onay anındaki mevcutla hesaplanır |
| Sayım farkı | Sayılan − onay anındaki mevcut; artı (fazla) ya da eksi (kayıp) |
| Minimum seviye | Altına inince satın alma önerisi / otomatik talep doğuran eşik |
| Varsayılan depo | Mal kabulde önce seçili, eşlenmemiş satış noktalarının düştüğü depo; otelde tek |
| Manuel görev | Aktör kapalı ya da iş yapılamıyorsa personelin önüne düşen "bunu elle yap" kaydı (Görevler menüsü) |

## Sık sorulanlar

**Mal kabul yaptım ama maliyet tam alış fiyatına eşit değil.** Hareketli ortalama: eldeki stokun eski maliyeti ile gelenin fiyatı ağırlıklı ortalanır. Elde stok yoksa (ya da eksideyse) alış fiyatı birebir alınır.

**Fire ya da çıkış girdim, ortalama maliyet neden değişmedi?** Tasarım kararı: yalnızca giriş ortalamayı değiştirir. Çıkış, fire, transfer, sayım farkı ve satış o anki ortalamayla değerlenir.

**Stok eksiye düştü, bu nasıl olur?** Yalnız satış düşümü eksiye inebilir: adisyon gerçektir, mal kabul ya da sayım geride kalmıştır. Mal kabulü kaydedin ya da sayım yapın; eksi mevcut raporda 0 değer sayılır.

**Elle çıkış "yetersiz stok" diyor ama rafta mal var.** Depodaki kayıtlı mevcut yetersiz. Önce sayım yapıp farkı onaylayın ya da doğru depodan çıkış yapın (mal başka depoda kayıtlı olabilir — transfer).

**Satılan yemek stoktan düşmedi.** Sırayla: ürünün reçetesi var mı (Mutfak → Reçeteler → "bağlı ürün")? Stok aktörü açık mı (Aktörler)? Görevler menüsünde "Stok" manuel görevi düştü mü? Satış noktasının deposu pasif mi?

**Sayım farkı beklediğimden farklı.** Fark sayılan − **onay anındaki** mevcuttur, açılıştaki "beklenen" değil. Sayım sürerken yapılan satış / çıkış mevcudu değiştirir; ekrandaki "şu anki" sütununa bakın.

**Aynı malzeme için iki satın alma talebi açıldı.** İlk talep tura alınırken miktar artırılmadıysa sonraki düşümlerde açık kalır ve yeni talep doğar. Öneri miktarını gerçek alım miktarına çıkarın; ya da gereksiz talebi gerekçeyle iptal edin.

**Ucuz teklif neden "en uygun" değil?** Sıralama önce ihtiyaç gününe **yetişen** teklifleri alır; termin geç olan teklif ucuz olsa da önerilmez. Yine de seçebilirsiniz; gerekçe istenir.

**Sipariş onaya gitti, kim onaylar?** Onay karar yetkisi olan **başka** bir kişi (dört göz). 3 gün içinde karar yoksa reddedilmiş sayılır ve satırlar tura döner.

**Mal kabulde fazla geldi, kabul edemiyorum.** Tartılan malzemede siparişin %5 fazlasına kadar kabul edilir; adetli malzemede fazla kabul edilmez. Fazlası için tedarikçiyle görüşüp ayrı sipariş / iade.

**Tedarikçi borcu nerede görünür?** Ön muhasebe → Cariler; mal kabul olayı vade = kabul günü + tedarikçi vadesi ile borç yazar.

**Bar satışları yanlış depodan düşüyor.** Stok → Depolar → "Satış noktası → depo" kartında barı bar deposuna eşleyin. Eşleme değişince sonraki adisyonlar yeni depodan düşer; yeniden açılıp kapanan eski adisyon da yeni depoya taşınır.

**Reçete listesindeki gıda maliyeti % ile maliyet raporundaki yemek maliyeti % farklı.** Reçete listesi teorik (güncel malzeme maliyeti × reçete, KDV hariç satış fiyatı); rapor gerçekleşen (ikram ve zayi dahil düşülen malzeme, KDV dahil liste cirosu). İkisi birlikte okunur.

## Sık yapılan hatalar

- **Mal kabulü yapmadan malı rafa koymak.** Stok kayıtta eksik kalır, satış düşümü eksiye iner, gereksiz minimum altı talepleri doğar, ortalama maliyet güncellenmez.
- **İrsaliyeyi yanlış depoya kaydetmek.** Satış başka depodan düşer, bir depo eksiye öteki fazlaya gider. Transferle düzeltin; mal kabul değişmez.
- **Minimum seviyeyi tanımlamamak ya da çok yüksek tutmak.** Tanımsız malzeme hiç önerilmez; çok yüksek minimum sürekli talep üretir.
- **Minimum altı talebini olduğu gibi (0,4 kg) sipariş etmek.** Talep "açığı kapat" miktarıdır; tura alırken gerçek alım miktarına çıkarın.
- **Fire yerine çıkış girmek (ya da tersi).** Raporda fire kaybı, çıkış departman tüketimidir; karışırsa maliyet analizi yanıltır. Fire sebep ister — sebep yazamıyorsanız muhtemelen çıkıştır.
- **Sayımda sayılmayan satırları "0" yazmak.** Boş bırakın; 0 yazmak o malzemenin tamamını kayıp olarak işler.
- **Sayım açıkken saatlerce beklemek.** Onay güncel mevcuda göre hesaplar ama uzun sayımda karışıklık artar; depo bazında kısa sayımlar yapın.
- **Depoyu boşaltmadan pasife almayı denemek.** Sistem reddeder; önce transfer.
- **Aynı irsaliye numarasını iki kez girmek.** Tedarikçi başına tekil; reddedilir. Kısmi teslimde aynı irsaliyeyi değil, ikinci irsaliyeyi girin ya da "eksik kapat" kullanın.
- **Siparişi iptal etmek yerine mal kabulü atlamak.** Yoldaki miktar öneri hesabında düşülmeye devam eder; gelmeyecek mal için siparişi iptal edin ya da eksik kapatın.
- **Reçetesi olmayan ürün satmak.** Stok düşmez, maliyet raporunda maliyet 0 görünür, yemek maliyeti % yanıltıcı düşük çıkar.
- **Stok aktörünü kapatıp görevleri unutmak.** Her kapanan adisyon manuel göreve dönüşür; görevler birikir, stok kayıtla gerçek arasında açılır.
- **Banket ihtiyacını opsiyonlu dosyadan talebe çevirmeye çalışmak.** Talep yalnız kesin dosyadan açılır; opsiyonlu "olası" sütunundadır.
- **Ortalama maliyeti elle "düzeltmeye" çalışmak.** Elde stok varken malzemenin maliyeti elle değiştirilemez; maliyet mal kabulle oluşur.
