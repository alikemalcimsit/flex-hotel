// Teknik referans teması: lacivert + camgöbeği, milimetrik kapak, eş aralıklı etiketler, numaralı bölümler (§45, 45.3),
// başlıklı ve zebra tablolar, keskin köşeler. Müşteri tanıtımı bu kitaba girmez (musteri.typ).
//
// - `teknik-bolum(...)`: modül dosyasının teknik bölümü (standart düzen; tablolar koddan çıkarılan veriden)
// - `teknik-belgesi(bilgi, icerik)`: tek modülün teknik PDF'i
// - `teknik-referans(alanlar)`: bütün modüller, kısım kısım — teknik referans kitabı

#import "ortak.typ": *

// ─────────────── Tema ───────────────

#let renk = (
  lacivert: rgb("#0f2236"),
  metin: rgb("#1b2a3a"),
  metin-yumusak: rgb("#3b4a5a"),
  soluk: rgb("#5f6f80"),
  cizgi: rgb("#d5dde6"),
  zemin: rgb("#f3f6f9"),
  vurgu: rgb("#0e7490"),
  vurgu-koyu: rgb("#0b5568"),
  vurgu-acik: rgb("#e3f4f7"),
  amber: rgb("#b45309"),
  amber-acik: rgb("#fff7ed"),
  kapak-metin: rgb("#c9d6e3"),
  kapak-soluk: rgb("#8aa0b6"),
)

#let kod(icerik) = text(font: es-yazi, size: 0.84em, fill: renk.vurgu-koyu, icerik)
#let metin(deger) = metin-cevir(deger, kod)
#let es(icerik, boy: 7pt, ton: renk.soluk, kalin: false) = text(font: es-yazi, size: boy, fill: ton, weight: if kalin { "bold" } else { "regular" }, icerik)

#let etiket(icerik, dolgu: renk.vurgu-acik, yazi-rengi: renk.vurgu-koyu) = box(
  fill: dolgu,
  inset: (x: 3.6pt, y: 1.8pt),
  radius: 1.5pt,
  text(font: es-yazi, size: 6.2pt, fill: yazi-rengi, icerik),
)

#let yontem-rengi = (GET: rgb("#2563eb"), POST: rgb("#15803d"), PUT: rgb("#c2410c"), PATCH: rgb("#7c3aed"), DELETE: rgb("#b91c1c"))
#let yontem(ad) = box(
  width: 34pt,
  fill: yontem-rengi.at(ad, default: renk.soluk),
  inset: (y: 2pt),
  radius: 1.5pt,
  align(center, text(font: es-yazi, size: 6pt, weight: "bold", fill: white, ad)),
)

/// Başlıklı, zebra satırlı tablo. `hucreler` düz dizi (satır satır).
#let tablo(sutunlar, basliklar, hucreler, hizala: left + top) = table(
  columns: sutunlar,
  stroke: (x, y) => if y > 0 { (bottom: 0.4pt + renk.cizgi) },
  fill: (x, y) => if y == 0 { renk.lacivert } else if calc.even(y) { renk.zemin },
  inset: (x: 5pt, y: 4pt),
  align: hizala,
  table.header(..basliklar.map(b => text(font: es-yazi, size: 6pt, weight: "bold", fill: white, tracking: 0.04em, buyuk(b)))),
  ..hucreler,
)

/// Not kutusu: ton `bilgi` | `dikkat`.
#let kutu(baslik: none, ton: "bilgi", icerik) = {
  let (dolgu, kenar) = (bilgi: (renk.zemin, renk.vurgu), dikkat: (renk.amber-acik, renk.amber)).at(ton)
  block(width: 100%, fill: dolgu, inset: (left: 10pt, right: 9pt, y: 7pt), stroke: (left: 2pt + kenar), breakable: true)[
    #if baslik != none [#es(buyuk(baslik), boy: 6.6pt, ton: kenar, kalin: true) \ ]
    #set text(size: 8.5pt)
    #icerik
  ]
}

/// Ölçü hücreleri: (değer, etiket) dizisi.
#let rakamlar(liste) = grid(
  columns: range(liste.len()).map(_ => 1fr),
  stroke: 0.6pt + renk.cizgi,
  ..liste.map(((deger, ad)) => block(width: 100%, inset: (x: 8pt, y: 7pt))[
    #text(font: baslik-yazi, size: 15pt, weight: "bold", fill: renk.lacivert, deger) \
    #v(-5pt)
    #es(buyuk(ad), boy: 5.8pt)
  ]),
)

/// Etiketli madde listesi (K1, K2… / G1, G2…).
#let kurallar(liste, onek: "K") = {
  for (sira, (ad, aciklama)) in liste.enumerate() {
    block(below: 7pt, breakable: false, grid(
      columns: (24pt, 1fr),
      gutter: 6pt,
      box(width: 22pt, inset: (y: 2.4pt), stroke: 0.7pt + renk.vurgu, radius: 1.5pt, align(center, es(onek + str(sira + 1), boy: 6.4pt, ton: renk.vurgu, kalin: true))),
      [#text(weight: "bold", size: 8.8pt, fill: renk.lacivert, metin(ad)) \ #text(size: 8.4pt, fill: renk.metin-yumusak, metin(aciklama))],
    ))
  }
}

#let maddeler(liste) = for madde in liste {
  block(below: 5pt, grid(columns: (9pt, 1fr), box(width: 4pt, height: 4pt, fill: renk.vurgu, baseline: -1.6pt), text(size: 8.6pt, metin(madde))))
}

// ─────────────── Koddan çıkarılan tablolar ───────────────

#let kisalt(yol) = yol.replace("hotel/backend/src/", "backend/").replace("hotel/frontend/src/", "frontend/").replace("hotel/contracts/", "contracts/").replace("hotel/backend/scripts/", "scripts/").replace("hotel/", "")

#let erisim(rota) = {
  if rota.access == "permission" {
    rota.permissions.map(p => etiket(p)).join(if rota.any { es[ veya ] } else { h(2pt) })
  } else if rota.access == "signed-in" {
    etiket(dolgu: renk.zemin, yazi-rengi: renk.metin-yumusak)[oturum açmış herkes]
  } else {
    etiket(dolgu: renk.amber-acik, yazi-rengi: renk.amber)[izin denetimi yok]
  }
}

#let api-tablosu(rotalar) = tablo(
  (auto, 1fr, auto),
  ("Yöntem", "Yol", "Erişim"),
  rotalar.map(r => (yontem(r.method), text(font: es-yazi, size: 6.8pt, r.url), erisim(r))).flatten(),
  hizala: (left + horizon, left + horizon, right + horizon),
)

#let tablo-listesi(tablolar) = tablo(
  (auto, 1fr, auto),
  ("Tablo", "Açıklama (şema belgesinden)", "Alan · ilişki · indeks"),
  tablolar.map(t => (
    text(font: es-yazi, size: 7.2pt, weight: "bold", fill: renk.lacivert, t.name),
    text(size: 7.8pt, fill: renk.metin-yumusak, if t.doc == "" [—] else { t.doc }),
    es(boy: 6.8pt)[#t.fields · #t.relations · #(t.indexes + t.uniques)],
  )).flatten(),
  hizala: (left + top, left + top, right + top),
)

#let izin-tablosu(izinler) = tablo(
  (auto, 1fr, auto),
  ("İzin", "Ne verir", "Varsayılan roller"),
  izinler.map(i => (etiket(i.permission), text(size: 7.8pt, i.label), text(size: 7.4pt, fill: renk.soluk, i.roles.join(", ")))).flatten(),
)

#let olay-tablosu(olaylar) = tablo(
  (auto, 1fr),
  ("Olay", "Açıklama"),
  olaylar.map(o => (text(font: es-yazi, size: 7pt, fill: renk.lacivert, o.name), text(size: 7.8pt, fill: renk.metin-yumusak, if o.label == none [—] else { o.label }))).flatten(),
)

#let kisitlar(liste) = liste.map(k => box(inset: (right: 3pt, bottom: 3pt), box(stroke: 0.5pt + renk.cizgi, inset: (x: 3.6pt, y: 2pt), radius: 1.5pt, es(k, boy: 6.2pt, ton: renk.metin-yumusak)))).join()

#let dosyalar(liste) = tablo((auto, 1fr), ("Dosya", "Açıklama"), liste.map(((yol, aciklama)) => (text(font: es-yazi, size: 6.6pt, kisalt(yol)), text(size: 7.8pt, metin(aciklama)))).flatten())

/// Dosya haritası: katman başlıklı; her dosyanın ilk belge cümlesi ve satır sayısı.
#let dosya-haritasi(veri) = {
  let katmanlar = (
    ("Sözleşme", veri.dosyalar.filter(d => d.path.starts-with("hotel/contracts/"))),
    ("Sunucu", veri.dosyalar.filter(d => d.path.starts-with("hotel/backend/") and not d.path.starts-with("hotel/backend/scripts/"))),
    ("Ön yüz", veri.dosyalar.filter(d => d.path.starts-with("hotel/frontend/"))),
    ("Aktör ve ajan paketleri", veri.dosyalar.filter(d => d.path.starts-with("hotel/workers/") or d.path.starts-with("hotel/agents/") or d.path.starts-with("shared/"))),
    ("Betikler", veri.dosyalar.filter(d => d.path.starts-with("hotel/backend/scripts/"))),
  )
  for (ad, liste) in katmanlar {
    if liste.len() == 0 { continue }
    block(above: 8pt, below: 3pt, sticky: true, es(buyuk(ad), boy: 6.6pt, ton: renk.vurgu, kalin: true))
    tablo(
      (auto, 1fr, auto),
      ("Dosya", "Açıklama (dosya başındaki belgeden)", "Satır"),
      liste.map(d => (text(font: es-yazi, size: 6.6pt, kisalt(d.path)), text(size: 7.6pt, fill: renk.metin-yumusak, if d.summary == "" [—] else { metin(d.summary) }), es(str(d.lines), boy: 6.6pt))).flatten(),
      hizala: (left + top, left + top, right + top),
    )
  }
}

#let test-sayisi(veri) = veri.kod.arka.test + veri.kod.arka.entegrasyon + veri.kod.on.test + veri.kod.sozlesme.test
#let satir-sayisi(veri) = veri.kod.arka.satir + veri.kod.on.satir + veri.kod.sozlesme.satir
#let bin(n) = str(calc.round(n / 1000, digits: 1)).replace(".", ",") + " bin"

/// Künye: kaynak yolları, ölçüler, testler, satır sayısı.
#let kunye(veri) = {
  let k = veri.kaynaklar
  let yollar(liste) = if liste.len() == 0 [—] else { liste.map(y => text(font: es-yazi, size: 6.8pt, kisalt(y))).join([ · ]) }
  let satirlar = (
    ("Sunucu", yollar(k.arka)),
    ("Ön yüz", yollar(k.on)),
    ("Sözleşme", yollar(k.sozlesme)),
    ..if k.aktor.len() > 0 { (("Aktör / ajan", yollar(k.aktor)),) } else { () },
    ("Ölçüler", [#veri.rotalar.len() API ucu · #veri.tablolar.len() tablo · #veri.kisitlar.len() veritabanı kısıtı · #veri.izinler.len() izin · #veri.olaylar.len() olay]),
    ("Testler", [#veri.kod.arka.test birim · #veri.kod.arka.entegrasyon entegrasyon (gerçek veritabanı) · #(veri.kod.sozlesme.test + veri.kod.on.test) sözleşme ve ön yüz]),
    ("Kod", [#bin(satir-sayisi(veri)) satır (sunucu #bin(veri.kod.arka.satir), ön yüz #bin(veri.kod.on.satir), sözleşme #bin(veri.kod.sozlesme.satir))]),
  )
  block(width: 100%, stroke: (top: 1.2pt + renk.lacivert, bottom: 0.6pt + renk.cizgi), inset: (y: 4pt), below: 12pt, grid(
    columns: (62pt, 1fr),
    row-gutter: 5pt,
    column-gutter: 8pt,
    ..satirlar.map(((ad, deger)) => (es(buyuk(ad), boy: 6.2pt, ton: renk.vurgu, kalin: true), text(size: 8pt, deger))).flatten(),
  ))
}

// ─────────────── Standart teknik bölüm ───────────────

/// Modül dosyasının teknik bölümü.
///
/// - `mimari`: mimari özet · `kural`: (ad, açıklama) iş kuralları · `tutarlilik`: eşzamanlılık maddeleri
/// - `olcek`: (ölçüm, süre) · `olcek-not` · `test-notu` · `degistir`: (konu, nasıl) genişletme rehberi
/// - `devir`: sınırlar ve bağlantı noktaları · `ek`: bölüm sonuna serbest içerik
#let teknik-bolum(veri, mimari: none, kural: (), tutarlilik: (), olcek: (), olcek-not: none, test-notu: none, degistir: (), devir: (), ek: none) = [
  = Mimari
  #kunye(veri)
  #mimari

  == Dosya haritası
  #dosya-haritasi(veri)

  = Veri modeli
  #if veri.tablolar.len() > 0 [
    Sayılar alan · ilişki · index + tekil kısıt; açıklamalar `schema.prisma` belge yorumlarından.
    #tablo-listesi(veri.tablolar)
  ] else [
    Modülün kendi tablosu yok; diğer modüllerin tablolarını okur ve günceller.
  ]
  #if veri.kisitlar.len() > 0 [
    == Veritabanı kısıtları
    Kurallar veritabanında da korunur; uygulama kodu atlansa bile yanlış kayıt yazılamaz.
    #kisitlar(veri.kisitlar)
  ]
  #if veri.migrationlar.len() > 0 [
    == Migration'lar
    #maddeler(veri.migrationlar.map(m => [#kod(m.ad) — #m.tablo yeni tablo, #m.satir satır SQL]))
  ]

  = API uçları
  Erişim, rotanın koddan okunan izin denetimidir; "veya" ile bağlı izinlerden biri yeter.
  #api-tablosu(veri.rotalar)

  #if veri.izinler.len() > 0 [
    = İzinler ve varsayılan roller
    #izin-tablosu(veri.izinler)
  ]

  #if veri.olaylar.len() > 0 [
    = Olaylar
    Olay kataloğundaki ad ve açıklamalar; ekranlar ilgili canlı kanal üzerinden tazelenir.
    #olay-tablosu(veri.olaylar)
  ]

  #if kural.len() > 0 [
    = İş kuralları
    #kurallar(kural)
  ]

  #if tutarlilik.len() > 0 [
    = Eşzamanlılık ve tutarlılık
    #maddeler(tutarlilik)
  ]

  #if olcek.len() > 0 [
    = Ölçek
    #tablo((1fr, auto), ("Ölçüm", "Süre"), olcek.map(((ad, deger)) => (text(size: 8.2pt, metin(ad)), es(deger, boy: 7.6pt, ton: renk.lacivert, kalin: true))).flatten(), hizala: (left + horizon, right + horizon))
    #if olcek-not != none { v(3pt); text(size: 8.2pt, fill: renk.metin-yumusak, olcek-not) }
  ]

  = Testler
  #rakamlar((
    (str(veri.kod.arka.test), "birim (sunucu)"),
    (str(veri.kod.arka.entegrasyon), "entegrasyon (gerçek veritabanı)"),
    (str(veri.kod.sozlesme.test + veri.kod.on.test), "sözleşme + ön yüz"),
  ))
  #v(4pt)
  #if test-notu != none { test-notu }
  #let test-dosyalari = veri.kod.arka.testDosyalari + veri.kod.sozlesme.at("testDosyalari", default: ()) + veri.kod.on.at("testDosyalari", default: ())
  #if test-dosyalari.len() > 0 {
    dosyalar(test-dosyalari.map(f => (f, if f.contains("integration") [Entegrasyon (gerçek veritabanı)] else if f.contains("/contracts/") [Sözleşme (ön yüzle paylaşılan kurallar)] else [Birim (saf kurallar)])))
  }

  #if degistir.len() > 0 [
    = Genişletme rehberi
    #kurallar(degistir, onek: "G")
  ]

  #if devir.len() > 0 [
    = Sınırlar ve bağlantı noktaları
    #maddeler(devir)
  ]
  #if ek != none { ek }
]

// ─────────────── Ortak sayfa düzeni ───────────────

#let temel-stil(govde) = {
  set text(font: yazi, size: 8.8pt, lang: "tr", fill: renk.metin, hyphenate: true)
  set par(justify: false, leading: 0.6em, spacing: 0.9em)
  set list(marker: box(width: 4pt, height: 4pt, fill: renk.vurgu, baseline: -1.6pt), indent: 1pt, body-indent: 6pt)
  show raw: set text(font: es-yazi, size: 0.86em)
  show link: it => text(fill: renk.vurgu, it)
  govde
}

/// Bölüm başlığı (tek modül belgesinde düzey 1, kitapta düzey 3): "45.3  API uçları".
#let bolum-basligi(it) = {
  v(16pt, weak: true)
  block(below: 9pt, sticky: true)[
    #grid(
      columns: (auto, 1fr),
      column-gutter: 9pt,
      align: bottom,
      context es(counter(heading).display(it.numbering), boy: 9.4pt, ton: renk.vurgu, kalin: true),
      text(font: baslik-yazi, size: 14pt, weight: "bold", fill: renk.lacivert, it.body),
    )
    #v(-6pt)
    #line(length: 100%, stroke: 0.6pt + renk.cizgi)
  ]
}
#let ara-baslik(it) = block(above: 11pt, below: 5pt, sticky: true)[#box(width: 5pt, height: 5pt, fill: renk.vurgu) #h(3pt) #text(font: baslik-yazi, size: 10pt, weight: "bold", fill: renk.lacivert, it.body)]

/// Bölüm numarası: yalnız modül içi birinci düzey (`derinlik`) numaralanır → "45.3".
#let bolum-numarasi(numara, derinlik) = (..n) => if n.pos().len() == derinlik { str(numara) + "." + str(n.pos().last()) }

/// Milimetrik kapak zemini.
#let milimetrik = {
  let ince = tiling(size: (14pt, 14pt))[
    #place(line(start: (0pt, 0pt), end: (14pt, 0pt), stroke: 0.3pt + rgb(34, 211, 238, 26)))
    #place(line(start: (0pt, 0pt), end: (0pt, 14pt), stroke: 0.3pt + rgb(34, 211, 238, 26)))
  ]
  let kalin = tiling(size: (70pt, 70pt))[
    #place(line(start: (0pt, 0pt), end: (70pt, 0pt), stroke: 0.5pt + rgb(34, 211, 238, 46)))
    #place(line(start: (0pt, 0pt), end: (0pt, 70pt), stroke: 0.5pt + rgb(34, 211, 238, 46)))
  ]
  place(rect(width: 100%, height: 100%, fill: ince))
  place(rect(width: 100%, height: 100%, fill: kalin))
}

#let kapak-ust = grid(
  columns: (auto, 1fr, auto),
  align: horizon,
  logo(boy: 20pt),
  [],
  es(boy: 7.6pt, ton: renk.kapak-soluk, kalin: true)[TEKNİK REFERANS],
)

#let sayfa-duzeni(ust) = (
  paper: "a4",
  margin: (top: 24mm, bottom: 19mm, left: 20mm, right: 17mm),
  header: context {
    grid(
      columns: (auto, auto, 1fr, auto),
      column-gutter: 8pt,
      align: horizon,
      logo(boy: 9pt),
      es(boy: 6.4pt, kalin: true)[TEKNİK REFERANS],
      [],
      es(boy: 7pt, ton: renk.lacivert, ust()),
    )
    v(-2pt)
    line(length: 100%, stroke: 0.8pt + renk.lacivert)
  },
  footer: context {
    line(length: 100%, stroke: 0.4pt + renk.cizgi)
    v(-3pt)
    grid(columns: (1fr, auto), es(boy: 6.6pt)[FlexHotel teknik referans], es(boy: 6.6pt, ton: renk.lacivert)[s. #counter(page).display() / #counter(page).final().first()])
  },
)

// ─────────────── Tek modül belgesi ───────────────

/// Modül açılışı: lacivert §NN kutusu + ad + kapsam + kısım. `duzey: none` → başlık değil düz yazı (tek modül belgesi).
#let modul-basligi(bilgi, duzey) = {
  let ad = if duzey == none { text(font: baslik-yazi, size: 20pt, weight: "bold", fill: renk.lacivert, bilgi.ad) } else {
    heading(level: duzey, supplement: [#bilgi.numara], numbering: (..) => [§#bilgi.numara], bilgi.ad)
  }
  block(width: 100%, below: 10pt, grid(
    columns: (auto, 1fr),
    column-gutter: 12pt,
    align: horizon,
    box(fill: renk.lacivert, inset: (x: 11pt, y: 10pt), text(font: es-yazi, size: 20pt, weight: "bold", fill: white)[§#bilgi.numara]),
    [
      #ad
      #v(-3pt)
      #text(size: 8.8pt, fill: renk.metin-yumusak, bilgi.slogan)
      #v(-2pt)
      #es(buyuk(bilgi.alan), boy: 6.2pt, ton: renk.vurgu, kalin: true)
    ],
  ))
}

/// - `bilgi`: (numara, ad, slogan, alan)
#let teknik-belgesi(bilgi, icerik) = {
  set document(title: "FlexHotel teknik referans — §" + str(bilgi.numara) + " " + bilgi.ad, author: "FlexHotel")
  show: temel-stil

  page(margin: 0pt, fill: renk.lacivert, header: none, footer: none)[
    #milimetrik
    #pad(x: 46pt, top: 46pt, bottom: 40pt)[
      #kapak-ust
      #v(140pt)
      #text(font: es-yazi, size: 64pt, weight: "bold", fill: marka.camgobegi)[§#bilgi.numara]
      #v(-10pt)
      #text(font: baslik-yazi, size: 34pt, weight: "bold", fill: white, bilgi.ad)
      #v(-2pt)
      #block(width: 82%, text(size: 12pt, fill: renk.kapak-metin, bilgi.slogan))
      #v(1fr)
      #line(length: 100%, stroke: 0.6pt + rgb(34, 211, 238, 70))
      #v(4pt)
      #es(boy: 7.4pt, ton: renk.kapak-soluk)[MİMARİ · VERİ MODELİ · API · İZİNLER · OLAYLAR · İŞ KURALLARI · ÖLÇEK · TESTLER]
    ]
  ]

  set page(..sayfa-duzeni(() => [§#bilgi.numara · #bilgi.ad]))
  counter(page).update(1)
  show heading.where(level: 1): bolum-basligi
  show heading.where(level: 2): ara-baslik
  set heading(numbering: bolum-numarasi(bilgi.numara, 1))

  modul-basligi(bilgi, none)
  block(above: 10pt, below: 6pt, es(boy: 6.6pt, ton: renk.vurgu, kalin: true)[BU BELGEDE])
  {
    show outline.entry: set text(size: 8.4pt)
    outline(title: none, depth: 1)
  }
  v(8pt)
  icerik
}

// ─────────────── Teknik referans kitabı ───────────────

/// Kısım açılışı: tam sayfa; büyük kısım numarası, alan, modül listesi.
#let kisim-acilisi(sira, alan) = {
  pagebreak(weak: true)
  v(60pt)
  es(boy: 9pt, ton: renk.vurgu, kalin: true)[KISIM #romen(sira)]
  v(-2pt)
  heading(level: 1, supplement: [#romen(sira)], numbering: (..) => romen(sira), alan.ad)
  v(-4pt)
  block(width: 85%, text(size: 10pt, fill: renk.metin-yumusak, alan.aciklama))
  v(14pt)
  tablo(
    (auto, auto, 1fr, auto, auto, auto),
    ("§", "Modül", "Kapsam", "Uç", "Tablo", "Test"),
    alan.moduller.map(m => (
      es(str(m.bilgi.numara), boy: 7.6pt, ton: renk.vurgu, kalin: true),
      text(size: 8.2pt, weight: "bold", fill: renk.lacivert, m.bilgi.ad),
      text(size: 7.6pt, fill: renk.metin-yumusak, m.bilgi.slogan),
      es(str(m.veri.rotalar.len())),
      es(str(m.veri.tablolar.len())),
      es(str(test-sayisi(m.veri))),
    )).flatten(),
    hizala: (left + top, left + top, left + top, right + top, right + top, right + top),
  )
  pagebreak()
}

/// - `alanlar`: ((ad, aciklama, moduller: ((bilgi, veri, icerik), ...)), ...)
/// - `toplam-test`: modüllerin paylaştığı dosyalar bir kez sayılmış toplam (verilmezse modül toplamı)
#let teknik-referans(alanlar, toplam-test: none) = {
  let tum = alanlar.map(a => a.moduller).flatten()
  let tekil(liste) = liste.dedup().len()
  let rotalar = tekil(tum.map(m => m.veri.rotalar.map(r => r.method + " " + r.url)).flatten())
  let tablolar = tekil(tum.map(m => m.veri.tablolar.map(t => t.name)).flatten())
  let izinler = tekil(tum.map(m => m.veri.izinler.map(i => i.permission)).flatten())
  let olaylar = tekil(tum.map(m => m.veri.olaylar.map(o => o.name)).flatten())
  let testler = if toplam-test != none { toplam-test } else { tum.map(m => test-sayisi(m.veri)).sum() }

  set document(title: "FlexHotel — Teknik referans", author: "FlexHotel")
  show: temel-stil

  // ── Kapak ──
  page(margin: 0pt, fill: renk.lacivert, header: none, footer: none)[
    #milimetrik
    #pad(x: 46pt, top: 46pt, bottom: 40pt)[
      #kapak-ust
      #v(150pt)
      #es(boy: 9pt, ton: marka.camgobegi, kalin: true)[OTEL YÖNETİM SİSTEMİ]
      #v(-4pt)
      #text(font: baslik-yazi, size: 52pt, weight: "bold", fill: white)[Teknik referans]
      #v(4pt)
      #block(width: 80%, text(size: 12pt, fill: renk.kapak-metin)[Mimari, veri modeli, API uçları, izinler, olaylar ve iş kuralları — #str(tum.len()) modül, tabloları kaynak koddan çıkarılmış.])
      #v(1fr)
      #grid(
        columns: range(6).map(_ => 1fr),
        stroke: (x, y) => (left: if x > 0 { 0.5pt + rgb(34, 211, 238, 60) }),
        inset: (x: 7pt, y: 2pt),
        ..(
          (str(tum.len()), "modül"),
          (str(rotalar), "API ucu"),
          (str(tablolar), "tablo"),
          (str(izinler), "izin"),
          (str(olaylar), "olay"),
          (str(testler), "otomatik test"),
        ).map(((deger, ad)) => [
          #text(font: es-yazi, size: 18pt, weight: "bold", fill: white, deger) \
          #es(buyuk(ad), boy: 6.2pt, ton: renk.kapak-soluk)
        ]),
      )
      #v(14pt)
      #line(length: 100%, stroke: 0.6pt + rgb(34, 211, 238, 70))
      #v(4pt)
      #set text(hyphenate: false)
      #es(boy: 7pt, ton: renk.kapak-soluk)[#alanlar.len() KISIM · #alanlar.map(a => buyuk(a.ad)).join(" · ")]
    ]
  ]

  // Üst bilgi: bu sayfaya kadar (bu sayfa dahil) açılan son kısım ya da modül.
  let ust() = {
    let son = query(heading.where(level: 1).or(heading.where(level: 2))).filter(h => h.location().page() <= here().page())
    if son.len() > 0 {
      let b = son.last()
      if b.level == 2 [§#b.supplement · #b.body] else [KISIM #b.supplement · #buyuk(if b.body.has("text") { b.body.text } else { b.body })]
    }
  }
  set page(..sayfa-duzeni(ust))
  counter(page).update(1)
  show heading.where(level: 1): it => text(font: baslik-yazi, size: 30pt, weight: "bold", fill: renk.lacivert, it.body)
  show heading.where(level: 2): it => text(font: baslik-yazi, size: 20pt, weight: "bold", fill: renk.lacivert, it.body)
  show heading.where(level: 3): bolum-basligi
  show heading.where(level: 4): ara-baslik

  // ── Okuma kılavuzu ──
  let on-baslik(ad) = block(below: 8pt, text(font: baslik-yazi, size: 18pt, weight: "bold", fill: renk.lacivert, ad))
  let on-ara(ad) = block(above: 12pt, below: 5pt, sticky: true, es(buyuk(ad), boy: 6.8pt, ton: renk.vurgu, kalin: true))
  on-baslik[Okuma kılavuzu]
  text(size: 9.2pt, fill: renk.metin-yumusak)[Kitap, sistemin her modülünü aynı sırayla anlatır. Kısımlar iş alanlarıdır; modüller #es[§NN], modül içi bölümler #es[NN.k] numarasıyla anılır. Tablolar her üretimde kaynak koddan yeniden çıkarılır; elle yazılan yalnız mimari, kural ve rehber metinleridir.]

  on-ara("Sistem")
  tablo(
    (auto, 1fr),
    ("Paket", "İçerik"),
    (
      kod("hotel/backend"), [Fastify 5 + Prisma 6 (PostgreSQL); istek doğrulama zod (`fastify-type-provider-zod`), canlı kanallar socket.io, PDF pdfkit.],
      kod("hotel/frontend"), [React 19 + Vite, Tailwind; socket.io istemcisi ile canlı tazeleme.],
      kod("hotel/contracts"), [zod şemaları, durum listeleri ve sabitler — ön yüz ve sunucu aynı paketi kullanır (`@hotelos/hotel-contracts`).],
      kod("hotel/workers"), [Olay dinleyen aktörler: oda, rezervasyon, faturalama, kanal eşitleme, kat hizmeti, F&B.],
      kod("hotel/agents"), [Yapay zekâ ajanları: konuşarak rezervasyon (concierge), bütçe yorumu, fiyat.],
      kod("shared"), [Ortak çekirdek: olay kataloğu ve dağıtım (`core`), aktör tabanı (`actor-kit`), yetki (`auth`), MCP sunucusu, kanallar.],
    ).map(x => if type(x) == content { text(size: 8pt, metin(x)) } else { x }),
  )

  on-ara("Her modülde geçerli ilkeler")
  maddeler((
    "*Otel kapsamı:* her sorgu ve yazım `hotelId` ile süzülür; başka otelin kaydı okunamaz, yazılamaz.",
    "*Sayfalama:* liste uçlarının hepsi sayfalıdır; süzülen ve sıralanan her kolon index'lidir.",
    "*Transaction:* birden çok tabloyu birlikte değiştiren işlemler (para, stok, oda) tek transaction'dadır; denetim izi ve olay aynı transaction'da yazılır, olay commit'ten sonra dağıtılır.",
    "*Eşzamanlılık:* aynı kaydı iki kişi değiştirebiliyorsa sürüm damgası, satır kilidi ya da veritabanı kısıtı; kısıt son savunmadır.",
    "*İzin:* her rota koddan okunabilir bir izin denetimi taşır; ön yüz yetkisiz düğmeyi gizler, sunucu yine reddeder.",
    "*Test:* fiyat, bakiye, müsaitlik gibi hata payı olmayan saf kurallar `node:test` ile birim testli; akışlar gerçek PostgreSQL'de entegrasyon testli.",
  ))

  on-ara("Gösterim")
  grid(
    columns: (auto, 1fr),
    column-gutter: 10pt,
    row-gutter: 6pt,
    align: (left + horizon, left + horizon),
    [#yontem("GET") #yontem("POST") #yontem("PUT") #yontem("PATCH") #yontem("DELETE")], text(size: 8pt)[API yöntemi.],
    [#etiket[pos.operate] #es[ veya ] #etiket[pos.supervise]], text(size: 8pt)[Erişim: izinlerden biri yeter. #etiket(dolgu: renk.zemin, yazi-rengi: renk.metin-yumusak)[oturum açmış herkes] izin istemez; #etiket(dolgu: renk.amber-acik, yazi-rengi: renk.amber)[izin denetimi yok] imzalı bağlantı ya da sağlayıcı imzasıyla korunan açık uçtur.],
    [#es[12 · 4 · 6]], text(size: 8pt)[Veri modelinde alan · ilişki · index + tekil kısıt sayısı.],
    [#box(width: 22pt, inset: (y: 2.4pt), stroke: 0.7pt + renk.vurgu, radius: 1.5pt, align(center, es("K1", boy: 6.4pt, ton: renk.vurgu, kalin: true))) #box(width: 22pt, inset: (y: 2.4pt), stroke: 0.7pt + renk.vurgu, radius: 1.5pt, align(center, es("G1", boy: 6.4pt, ton: renk.vurgu, kalin: true)))], text(size: 8pt)[İş kuralı · genişletme rehberi maddesi.],
    [#es[ms · sn]], text(size: 8pt)[Ölçek ölçümleri yerel veritabanında `scripts/perf-*.mjs` ile; veri hacmi her tablonun altında yazılıdır.],
  )

  // ── Modül dizini ──
  pagebreak()
  on-baslik[Modül dizini]
  tablo(
    (auto, 1fr, auto, auto, auto, auto, auto, auto),
    ("§", "Modül", "Kısım", "Uç", "Tablo", "İzin", "Olay", "Test"),
    alanlar.enumerate().map(((i, alan)) => alan.moduller.map(m => (
      es(str(m.bilgi.numara), boy: 7.4pt, ton: renk.vurgu, kalin: true),
      text(size: 8pt, weight: "semibold", fill: renk.lacivert, m.bilgi.ad),
      es(romen(i + 1)),
      es(str(m.veri.rotalar.len())),
      es(str(m.veri.tablolar.len())),
      es(str(m.veri.izinler.len())),
      es(str(m.veri.olaylar.len())),
      es(str(test-sayisi(m.veri))),
    ))).flatten(),
    hizala: (left, left, center, right, right, right, right, right),
  )

  // ── İçindekiler ──
  pagebreak()
  on-baslik[İçindekiler]
  {
    show outline.entry.where(level: 1): it => {
      v(7pt)
      text(font: baslik-yazi, weight: "bold", fill: renk.lacivert, it)
    }
    show outline.entry.where(level: 2): set text(size: 8.4pt)
    outline(title: none, depth: 2, indent: 16pt)
  }

  // ── Kısımlar ve modüller ──
  for (i, alan) in alanlar.enumerate() {
    kisim-acilisi(i + 1, alan)
    for m in alan.moduller {
      pagebreak(weak: true)
      modul-basligi(m.bilgi, 2)
      {
        set heading(offset: 2, numbering: bolum-numarasi(m.bilgi.numara, 3))
        m.icerik
      }
    }
  }
}
