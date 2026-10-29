#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Misafir gelince giriş, giderken çıkış tek adımda yapılır. Sistem odanın hazır olup olmadığını, kimlik bilgisinin (KBS) eksiksizliğini, erken giriş / geç çıkış ücretini ve folyo bakiyesini kendisi denetler; oda durumu ve folyo otomatik değişir. Aynı gün yapılan hatalı giriş ya da çıkış geri alınabilir.],
  rakam: (("Tek adım", "giriş ve çıkış"), ("KBS", "kimlik denetimi, maskeli saklama"), ("Otomatik", "erken giriş / geç çıkış ücreti"), ("0 bakiye", "olmadan çıkış yok (yetkili hariç)")),
  adimlar: (("Gelecekler", "oda · kişi · hazırlık"), ("Check-in", "kimlik · oda · teminat"), ("Konaklayanlar", "oda · bakiye"), ("Check-out", "bakiye · ücret"), ("Oda", "boş + kirli")),
  ozellik: (
    ("Kimlik (KBS)", "Sahibinin belgesi zorunlu (TC kimlik no doğrulamalı, pasaport biçimli); politika \"bütün yetişkinler\" ise refakatçilerin de. Kimlik no ekranda ve denetim izinde maskeli (KVKK)."),
    ("Oda hazırlığı", "Önceki misafir hâlâ içerideyse, oda arızalıysa ya da başkasınaysa giriş olmaz; kirli odaya giriş personel onayıyla."),
    ("Erken giriş / geç çıkış", "Otelin saatine göre, ilk / son gecenin fiyatı üzerinden; personel ücreti uygulamayabilir (iz kalır)."),
    ("Teminat", "Nakit, kart provizyonu, havale; nota ya da referansa kart numarası yazılamaz (PCI)."),
    ("Bakiye denetimi", "Açık bakiyeyle çıkış olmaz; yetkili gerekçeyle bakiyeyle çıkarabilir, yönetime zil uyarısı düşer."),
    ("Erken ayrılış", "Kalan geceler envantere döner ve fiyattan düşer (onaylı)."),
  ),
  rol: (([Ön büro], [Giriş / çıkış yapar.]), ([Yönetim], [Bakiyeyle çıkışa izin verir.]), ([Kat hizmeti, muhasebe], [Listeleri görür.])),
  baglantilar: ("*Oda (3):* oda aktörü doluluğu ve kat hizmetini giriş / çıkış olaylarıyla kendiliğinden değiştirir.", "*Folyo (15):* girişte folyo açılır, ücretler ve teminat folyoya işlenir.", "*Bildirim (9):* giriş / çıkış bildirimleri kendiliğinden gider.", "*Günlük durum (13):* gelecek / gidecek / içeride sayıları."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/front-desk`: giriş / çıkış servisleri, önizlemeler (`GET /stays/:id/check-in|check-out` — kimliğin tamamı yalnız `stays.manage` ile), geri almalar ve listeler. Bakiye hesabı `front-desk/folio.js` içinde folyo tablolarından yapılır (denormalize bakiyeye güvenilmez). Oda durumu servisten yazılmaz: doluluğun tek yazıcısı oda aktörüdür (olay → `applySystemRoomState`).],
  kural: (
    ("Giriş penceresi", "Giriş günü gelmiş, çıkış günü gelmemiş (geç gelen ertesi gün de girer). Oda verilmemişse aynı işlemde verilir."),
    ("Ücret tutarlılığı", "İstemci gördüğü tutarı gönderir; sunucu farklı hesaplarsa (saat geçti) yazmaz (`FEE_CHANGED`)."),
    ("Bakiye", "Bakiye = Σ(kalem × adet) − Σ(ödeme × kur); silinmiş ve aktarılmış sayılmaz. Folyo yoksa bakiye \"bilinmiyor\" sayılır, sıfır değil."),
    ("Geri alma", "Yalnız aynı gün; folyoda hareket olan giriş, oda başkasına verilmiş çıkış geri alınmaz."),
    ("Taşınmış misafir", "Erken çıkışta `roomSince <= checkOut` kısıtı (`Reservation_room_since_valid`)."),
  ),
  tutarlilik: ("Aynı konaklamaya aynı anda iki giriş: biri geçer (kilit + sürüm; testli).", "İçerideki kaydın giriş, çıkmışın iki zamanı da zorunlu (veritabanı kısıtı).", "Geri alma olayları (`check_in_reverted`, `check_out_reverted`) oda aktörünün doluluğu düzeltmesini sağlar."),
  degistir: (
    ("Yeni giriş alanı", "`Reservation` / `Guest` alanı + migration, `contracts/front-desk.js`, giriş penceresi `CheckInDialog.jsx`. Kişisel veri maskelemesini koruyun."),
    ("Ücret politikası", "Otel ayarları (`Hotel.earlyCheckInFee*`, `lateCheckOutFee*`) ve `front-desk/rules.js`."),
  ),
)
