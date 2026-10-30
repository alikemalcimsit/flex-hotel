// Müşteri kitabı teması: koyu kapak, kırmızı vurgu, yuvarlak kartlar, gerçek ekranlar. Teknik ayrıntı (kod adı,
// tablo, uç) bu kitaba girmez; o ayrıntılar teknik referanstadır (teknik.typ).
//
// - `tanitim(...)`: modül dosyasının müşteri bölümü (standart düzen)
// - `musteri-belgesi(bilgi, icerik)`: tek modülün müşteri PDF'i
// - `urun-katalogu(alanlar)`: bütün modüller, alan alan — ürün kataloğu

#import "ortak.typ": *

// ─────────────── Tema ───────────────

#let renk = (
  murekkep: rgb("#101010"),
  murekkep-yumusak: rgb("#3a3a3a"),
  soluk: rgb("#6b6b6b"),
  cizgi: rgb("#e7e5e4"),
  zemin: rgb("#f5f5f4"),
  kirmizi: marka.kirmizi,
  kirmizi-acik: rgb("#fef2f2"),
  camgobegi-koyu: rgb("#0e7490"),
  yesil: rgb("#16a34a"),
  yesil-acik: rgb("#f0fdf4"),
  turuncu: rgb("#d97706"),
  turuncu-acik: rgb("#fffbeb"),
  mavi: rgb("#2563eb"),
  mavi-acik: rgb("#eff6ff"),
  kapak-soluk: rgb("#a8a29e"),
  kapak-metin: rgb("#d6d3d1"),
)

#let kod(icerik) = text(font: es-yazi, size: 0.86em, fill: renk.murekkep-yumusak, icerik)
#let metin(deger) = metin-cevir(deger, kod)

#let etiket(icerik, dolgu: renk.zemin, yazi-rengi: renk.murekkep-yumusak) = box(
  fill: dolgu,
  inset: (x: 5pt, y: 2.5pt),
  radius: 3pt,
  text(size: 7pt, weight: "semibold", fill: yazi-rengi, icerik),
)

/// Bölüm içi başlık + kısa açıklama.
#let altbaslik(ad, aciklama: none) = {
  v(10pt)
  text(font: baslik-yazi, size: 12.5pt, weight: "bold", fill: renk.murekkep, ad)
  if aciklama != none {
    v(-6pt)
    text(size: 8.6pt, fill: renk.soluk, aciklama)
  }
  v(2pt)
}

/// Bilgi kutusu: ton `bilgi` | `ipucu` | `dikkat` | `marka`.
#let kutu(baslik: none, ton: "bilgi", icerik) = {
  let (dolgu, kenar) = (
    bilgi: (renk.mavi-acik, renk.mavi),
    ipucu: (renk.yesil-acik, renk.yesil),
    dikkat: (renk.turuncu-acik, renk.turuncu),
    marka: (renk.kirmizi-acik, renk.kirmizi),
  ).at(ton)
  block(width: 100%, fill: dolgu, inset: (left: 11pt, right: 10pt, y: 8pt), radius: (right: 5pt), stroke: (left: 2.5pt + kenar), breakable: true)[
    #if baslik != none [#text(weight: "bold", size: 9pt, fill: kenar.darken(25%), baslik) \ ]
    #set text(size: 8.8pt)
    #icerik
  ]
}

/// Giriş paragrafı.
#let ozet(icerik) = block(below: 12pt, text(size: 11.4pt, fill: renk.murekkep-yumusak, icerik))

/// Özellik kartları: (başlık, açıklama) dizisi, iki sütun.
#let ozellikler(liste, sutun: 2) = grid(
  columns: range(sutun).map(_ => 1fr),
  gutter: 8pt,
  ..liste.map(((ad, aciklama)) => block(width: 100%, fill: white, stroke: 0.6pt + renk.cizgi, radius: 6pt, inset: (x: 10pt, y: 9pt), breakable: false)[
    #place(top + left, dx: -10pt, dy: -9pt, rect(width: 3pt, height: 16pt, fill: renk.kirmizi, radius: (top-left: 6pt)))
    #text(font: baslik-yazi, weight: "bold", size: 9.6pt, ad) \
    #v(-3pt)
    #text(size: 8.3pt, fill: renk.murekkep-yumusak, metin(aciklama))
  ]),
)

/// İş akışı: adımlar oklarla, satırda en çok `satir` kutu.
#let akis(adimlar, satir: 6) = {
  let kutular = adimlar.enumerate().map(((sira, adim)) => {
    let (ad, alt) = if type(adim) == array { adim } else { (adim, none) }
    let ilk = sira == 0
    block(width: 100%, fill: if ilk { renk.murekkep } else { white }, stroke: 0.8pt + if ilk { renk.murekkep } else { renk.cizgi }, radius: 6pt, inset: (x: 7pt, y: 8pt))[
      #set align(center)
      #text(size: 6.6pt, weight: "bold", fill: if ilk { marka.camgobegi } else { renk.kirmizi }, tracking: 0.08em)[#str(sira + 1)] \
      #text(font: baslik-yazi, size: 8.6pt, weight: "bold", fill: if ilk { white } else { renk.murekkep }, ad)
      #if alt != none [ \ #text(size: 6.8pt, fill: if ilk { renk.kapak-metin } else { renk.soluk }, alt)]
    ]
  })
  let satirlar = range(calc.ceil(kutular.len() / satir)).map(i => kutular.slice(i * satir, calc.min((i + 1) * satir, kutular.len())))
  for parca in satirlar {
    let hucreler = ()
    let sutunlar = ()
    for (i, k) in parca.enumerate() {
      hucreler.push(k)
      sutunlar.push(1fr)
      if i < parca.len() - 1 {
        hucreler.push(align(center + horizon, text(size: 12pt, fill: renk.kirmizi)[→]))
        sutunlar.push(12pt)
      }
    }
    block(below: 6pt, grid(columns: sutunlar, align: horizon, ..hucreler))
  }
}

/// Rakam kutuları: (değer, etiket) dizisi.
#let rakamlar(liste) = grid(
  columns: range(liste.len()).map(_ => 1fr),
  gutter: 7pt,
  ..liste.map(((deger, ad)) => block(width: 100%, fill: renk.zemin, radius: 6pt, inset: (x: 9pt, y: 8pt))[
    #text(font: baslik-yazi, size: if deger.len() > 8 { 13pt } else if deger.len() > 5 { 15pt } else { 17pt }, weight: "bold", fill: renk.murekkep, hyphenate: false, deger) \
    #v(-4pt)
    #text(size: 7.4pt, fill: renk.soluk, hyphenate: false, ad)
  ]),
)

/// Ekran görüntüsü: tarayıcı çerçevesi + açıklama.
#let ekran(dosya, aciklama, genislik: 100%) = figure(
  kind: "ekran",
  supplement: [Ekran],
  block(width: genislik, radius: 7pt, clip: true, stroke: 0.7pt + rgb("#d6d3d1"), fill: white, breakable: false)[
    #block(width: 100%, fill: rgb("#efeeec"), inset: (x: 8pt, y: 5pt), below: 0pt)[
      #box(circle(radius: 2.4pt, fill: rgb("#f87171"))) #h(2pt) #box(circle(radius: 2.4pt, fill: rgb("#fbbf24"))) #h(2pt) #box(circle(radius: 2.4pt, fill: rgb("#4ade80")))
      #h(8pt) #box(fill: white, radius: 3pt, inset: (x: 6pt, y: 1.6pt), text(size: 6pt, fill: renk.soluk)[hotel.flexai.tr])
    ]
    #image(dosya, width: 100%)
  ],
  caption: text(size: 8pt, fill: renk.soluk, aciklama),
)

/// Kayıtta tanımlı ekran görüntüsü (üretilmediyse uyarı kutusu).
#let goruntu(veri, ad, genislik: 100%) = {
  let bilgi = veri.ekranlar.at(ad, default: none)
  if bilgi == none or not bilgi.var {
    kutu(baslik: "Ekran görüntüsü yok", ton: "dikkat")[#raw(ad) — üreticinin `goruntu` adımı çalıştırılmadı.]
  } else {
    ekran("/goruntuler/" + ad + ".jpg", bilgi.aciklama, genislik: genislik)
  }
}

/// Rol tablosu: (rol, ne yapar) dizisi.
#let kimler(liste) = table(
  columns: (auto, 1fr),
  stroke: (x, y) => (bottom: 0.5pt + renk.cizgi),
  inset: (x: 6pt, y: 6pt),
  ..liste.map(((rol, gorev)) => (text(weight: "bold", size: 8.6pt, metin(rol)), text(size: 8.6pt, metin(gorev)))).flatten(),
)

// ─────────────── Standart müşteri bölümü ───────────────

/// Modül dosyasının müşteri bölümü.
///
/// - `giris`: giriş paragrafı · `rakam`: (değer, açıklama) 3–4 öne çıkan · `adimlar` / `akis-aciklama`: iş akışı
/// - `ozellik`: (başlık, açıklama) · `neden`: "neden önemli" kutusu · `rol`: (rol, ne yapar) · `baglantilar`: maddeler
#let tanitim(veri, giris: none, rakam: (), adimlar: none, akis-aciklama: none, ozellik: (), neden: none, rol: (), baglantilar: ()) = [
  = Genel bakış
  #ozet(giris)
  #if rakam.len() > 0 { rakamlar(rakam) }
  #if adimlar != none {
    altbaslik("İş akışı", aciklama: akis-aciklama)
    akis(adimlar)
  }

  = Öne çıkan özellikler
  #ozellikler(ozellik)
  #if neden != none { kutu(baslik: "Neden önemli?", ton: "marka", neden) }

  #if veri.ekranlar.len() > 0 [
    = Ekranlar
    #for ad in veri.ekranlar.keys() { goruntu(veri, ad) }
  ]

  #if rol.len() > 0 [
    = Kim ne yapar?
    #kimler(rol)
  ]

  #if baglantilar.len() > 0 [
    = Diğer modüllerle bağlantı
    #for madde in baglantilar [- #metin(madde)
    ]
  ]
]

// ─────────────── Ortak sayfa düzeni ───────────────

#let temel-stil(govde) = {
  set text(font: yazi, size: 9.2pt, lang: "tr", fill: renk.murekkep, hyphenate: true)
  set par(justify: false, leading: 0.62em, spacing: 0.95em)
  set list(marker: text(fill: renk.kirmizi)[•], indent: 2pt, body-indent: 6pt)
  show figure.where(kind: "ekran"): set block(breakable: false)
  show figure.caption: it => block(above: 5pt, it.body)
  show raw: set text(font: es-yazi, size: 0.9em)
  show link: it => text(fill: renk.camgobegi-koyu, it)
  govde
}

/// Modül içi bölüm başlığı (tek modül belgesinde düzey 1, katalogda düzey 3).
#let bolum-basligi(it) = {
  v(14pt, weak: true)
  block(below: 8pt)[
    #text(font: baslik-yazi, size: 15pt, weight: "bold", it.body)
    #v(-7pt)
    #line(length: 28pt, stroke: 2.4pt + renk.kirmizi)
  ]
}
#let ara-baslik(it) = block(above: 12pt, below: 6pt, text(font: baslik-yazi, size: 11.5pt, weight: "bold", it.body))

#let kapak-cemberleri = {
  place(top + right, dx: 60pt, dy: -40pt, circle(radius: 190pt, stroke: 1pt + rgb(255, 255, 255, 18)))
  place(top + right, dx: 20pt, dy: 30pt, circle(radius: 120pt, stroke: 1pt + rgb(239, 68, 68, 60)))
  place(bottom + left, dx: -80pt, dy: 80pt, circle(radius: 160pt, stroke: 1pt + rgb(34, 211, 238, 40)))
}

#let sayfa-duzeni(ust, alt-sol) = (
  paper: "a4",
  margin: (top: 26mm, bottom: 20mm, x: 18mm),
  header: context {
    grid(columns: (auto, 1fr, auto), align: horizon, logo(boy: 10pt), [], text(size: 7.6pt, fill: renk.soluk, ust()))
    v(-3pt)
    line(length: 100%, stroke: 0.5pt + renk.cizgi)
  },
  footer: context {
    set text(size: 7.2pt, fill: renk.soluk)
    grid(columns: (1fr, auto), alt-sol, [#counter(page).display() / #counter(page).final().first()])
  },
)

// ─────────────── Tek modül belgesi ───────────────

/// - `bilgi`: (numara, ad, slogan, alan)
#let musteri-belgesi(bilgi, icerik) = {
  set document(title: "FlexHotel — " + bilgi.ad, author: "FlexHotel")
  show: temel-stil
  show heading.where(level: 1): bolum-basligi
  show heading.where(level: 2): ara-baslik

  page(margin: 0pt, fill: renk.murekkep, header: none, footer: none)[
    #kapak-cemberleri
    #pad(x: 46pt, top: 48pt, bottom: 40pt)[
      #logo(boy: 22pt)
      #h(1fr)
      #text(size: 8pt, fill: renk.kapak-soluk, tracking: 0.12em, weight: "semibold")[ÜRÜN KATALOĞU]
      #v(150pt)
      #text(font: baslik-yazi, size: 120pt, weight: "bold", fill: renk.kirmizi)[#str(bilgi.numara)]
      #v(-30pt)
      #text(font: baslik-yazi, size: 36pt, weight: "bold", fill: white, bilgi.ad)
      #v(-4pt)
      #block(width: 80%, text(size: 13pt, fill: renk.kapak-metin, bilgi.slogan))
      #v(1fr)
      #line(length: 100%, stroke: 0.6pt + rgb(255, 255, 255, 40))
      #v(6pt)
      #text(size: 7pt, fill: renk.kapak-soluk, tracking: 0.08em)[ALAN] \
      #text(size: 10pt, fill: white, weight: "semibold", bilgi.alan)
    ]
  ]

  set page(..sayfa-duzeni(() => [Modül #bilgi.numara · #bilgi.ad], [FlexHotel ürün kataloğu]))
  counter(page).update(1)
  block(below: 8pt, text(font: baslik-yazi, size: 16pt, weight: "bold")[Bu belgede])
  outline(title: none, depth: 1, indent: 12pt)
  v(10pt)
  icerik
}

// ─────────────── Ürün kataloğu (bütün modüller) ───────────────

/// Modül açılışı: büyük numara + ad + slogan + alan. Başlık düzeyi 2 (alan 1, modül içi bölümler 3).
#let modul-acilisi(bilgi) = {
  pagebreak(weak: true)
  block(width: 100%, below: 14pt, fill: renk.zemin, radius: 8pt, inset: (x: 16pt, y: 14pt), stroke: 0.6pt + renk.cizgi)[
    #grid(
      columns: (auto, 1fr),
      gutter: 14pt,
      align: horizon,
      text(font: baslik-yazi, size: 44pt, weight: "bold", fill: renk.kirmizi, str(bilgi.numara)),
      [
        #heading(level: 2, supplement: [#bilgi.numara], numbering: (..) => str(bilgi.numara), bilgi.ad)
        #v(-4pt)
        #text(size: 9.4pt, fill: renk.murekkep-yumusak, bilgi.slogan)
        #v(2pt)
        #etiket(dolgu: white, yazi-rengi: renk.soluk, bilgi.alan)
      ],
    )
  ]
}

/// Alan açılışı: koyu şerit + açıklama + alanın modülleri.
#let alan-acilisi(alan) = {
  pagebreak(weak: true)
  block(width: 100%, fill: renk.murekkep, radius: 8pt, inset: (x: 18pt, y: 18pt))[
    #text(size: 7.6pt, fill: renk.kapak-soluk, tracking: 0.12em, weight: "semibold")[ALAN]
    #v(-2pt)
    #heading(level: 1, alan.ad)
    #v(-2pt)
    #text(size: 10pt, fill: renk.kapak-metin, alan.aciklama)
  ]
  v(8pt)
  for m in alan.moduller {
    block(below: 6pt, grid(
      columns: (30pt, 1fr),
      gutter: 8pt,
      text(font: baslik-yazi, size: 15pt, weight: "bold", fill: renk.kirmizi, str(m.bilgi.numara)),
      [#text(weight: "bold", size: 9.6pt, m.bilgi.ad) \ #text(size: 8.6pt, fill: renk.murekkep-yumusak, m.bilgi.slogan)],
    ))
  }
}

/// - `alanlar`: ((ad, aciklama, moduller: ((bilgi, icerik), ...)), ...)
#let urun-katalogu(alanlar) = {
  let tum = alanlar.map(a => a.moduller).flatten()
  set document(title: "FlexHotel — Ürün kataloğu", author: "FlexHotel")
  show: temel-stil
  show heading.where(level: 1): it => text(font: baslik-yazi, size: 26pt, weight: "bold", fill: white, it.body)
  show heading.where(level: 2): it => text(font: baslik-yazi, size: 20pt, weight: "bold", fill: renk.murekkep, it.body)
  show heading.where(level: 3): bolum-basligi
  show heading.where(level: 4): ara-baslik

  // ── Kapak ──
  page(margin: 0pt, fill: renk.murekkep, header: none, footer: none)[
    #kapak-cemberleri
    #pad(x: 46pt, top: 48pt, bottom: 40pt)[
      #logo(boy: 22pt)
      #h(1fr)
      #text(size: 8pt, fill: renk.kapak-soluk, tracking: 0.12em, weight: "semibold")[ÜRÜN KATALOĞU]
      #v(170pt)
      #text(font: baslik-yazi, size: 54pt, weight: "bold", fill: white)[Otelin bütün işi \ tek sistemde.]
      #v(10pt)
      #block(width: 82%, text(size: 13pt, fill: renk.kapak-metin)[Rezervasyondan kasaya, mutfaktan kanal yönetimine #str(tum.len()) modül — gerçek ekranlarla, büyük otel ölçeğinde ölçülmüş.])
      #v(1fr)
      #grid(
        columns: (1fr, 1fr, 1fr),
        ..((str(tum.len()), "modül"), (str(alanlar.len()), "iş alanı"), ("2.500", "kişilik otel ölçeği")).map(((deger, ad)) => [
          #text(font: baslik-yazi, size: 30pt, weight: "bold", fill: renk.kirmizi, deger) \
          #text(size: 9pt, fill: renk.kapak-metin, ad)
        ]),
      )
      #v(16pt)
      #line(length: 100%, stroke: 0.6pt + rgb(255, 255, 255, 40))
      #v(6pt)
      #text(size: 8.4pt, fill: renk.kapak-soluk, alanlar.map(a => a.ad).join("  ·  "))
    ]
  ]

  // Üst bilgi: bu sayfaya kadar (bu sayfa dahil) açılan son alan ya da modül.
  let ust() = {
    let son = query(heading.where(level: 1).or(heading.where(level: 2))).filter(h => h.location().page() <= here().page())
    if son.len() > 0 {
      let b = son.last()
      if b.level == 2 [Modül #b.supplement · #b.body] else [Alan · #b.body]
    }
  }
  set page(..sayfa-duzeni(ust, [FlexHotel ürün kataloğu]))
  counter(page).update(1)

  // ── Modül haritası ──
  text(font: baslik-yazi, size: 18pt, weight: "bold")[Modül haritası]
  v(-4pt)
  text(size: 9pt, fill: renk.soluk)[Her modül tek başına çalışır ama aynı veriyi paylaşır: rezervasyon folyoya, folyo kasaya, kasa raporlara bağlanır.]
  v(6pt)
  grid(
    columns: (1fr, 1fr),
    gutter: 8pt,
    ..alanlar.map(alan => block(width: 100%, stroke: 0.6pt + renk.cizgi, radius: 6pt, inset: (x: 10pt, y: 9pt), breakable: false)[
      #text(font: baslik-yazi, weight: "bold", size: 10.5pt, alan.ad)
      #v(-3pt)
      #for m in alan.moduller [
        #text(weight: "bold", fill: renk.kirmizi, size: 8.6pt, str(m.bilgi.numara)) #h(3pt) #text(size: 8.6pt, m.bilgi.ad) \
      ]
    ]),
  )

  // ── İçindekiler ──
  pagebreak()
  text(font: baslik-yazi, size: 18pt, weight: "bold")[İçindekiler]
  v(4pt)
  {
    show outline.entry.where(level: 1): it => {
      v(6pt)
      strong(it)
    }
    outline(title: none, depth: 2, indent: 14pt)
  }

  // ── Alanlar ve modüller ──
  for alan in alanlar {
    alan-acilisi(alan)
    for m in alan.moduller {
      modul-acilisi(m.bilgi)
      {
        set heading(offset: 2)
        m.icerik
      }
    }
  }
}
