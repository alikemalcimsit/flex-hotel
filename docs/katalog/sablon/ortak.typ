// İki kitabın ortak parçaları: marka renkleri, logo, yazı aileleri ve metin dizisini içeriğe çeviren yardımcı.
// Tema (renk, köşe, tablo düzeni) her kitabın kendi dosyasındadır: musteri.typ ve teknik.typ.

#let marka = (
  kirmizi: rgb("#ef4444"),
  camgobegi: rgb("#22d3ee"),
)

#let yazi = "Plus Jakarta Sans"
#let baslik-yazi = "Space Grotesk"
#let es-yazi = "DejaVu Sans Mono"

/// FlexHotel logosu: "Flex" kalın, eğik, kırmızı; "Hotel" ince aralıklı camgöbeği.
#let logo(boy: 14pt, hotel-rengi: marka.camgobegi) = box(baseline: 0.2em)[
  #box(skew(ax: -9deg, text(font: baslik-yazi, size: boy, weight: "bold", fill: marka.kirmizi)[Flex]))#h(0.04em)#text(font: baslik-yazi, size: boy, weight: "regular", fill: hotel-rengi, tracking: 0.04em)[Hotel]
]

/// Metin dizisini içeriğe çevirir: `ters tırnak` arası `kod` ile, kod dışındaki `*kalın*` kalın.
/// İçerik ([...]) olduğu gibi döner.
#let metin-cevir(deger, kod) = {
  if type(deger) != str { return deger }
  deger.split("`").enumerate().map(((i, parca)) => if calc.odd(i) { kod(parca) } else {
    parca.split("*").enumerate().map(((j, p)) => if calc.odd(j) { strong(p) } else { p }).join()
  }).join()
}

/// Romen rakamı (kısım numaraları).
#let romen(n) = numbering("I", n)

/// Türkçe büyük harf: `upper` "i"yi "I" yapar; önce "İ"ye çevrilir. İçerik verilirse düz `upper`.
#let buyuk(s) = if type(s) == str { upper(s.replace("i", "İ")) } else { upper(s) }
