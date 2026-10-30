// Modül dosyalarının giriş noktası: `#import "/sablon/standart.typ": *` ile müşteri bölümü `tanitim(...)`, teknik bölüm
// `teknik-bolum(...)` gelir. İki bölüm iki ayrı kitaba, iki ayrı temayla girer (musteri.typ / teknik.typ); modül dosyası
// yalnız kendine özgü metni verir, tablolar ve dosya haritası koddan çıkarılan veriden (veri/NN.json) gelir.

#import "musteri.typ": tanitim
#import "teknik.typ": teknik-bolum
