#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Her personel kendi hesabıyla girer. Rolü (yönetici, müdür, ön büro, kat hizmeti, muhasebe, F&B) hangi menüleri göreceğini ve hangi işlemi yapabileceğini belirler. Kat görevlisi folyoyu göremez, resepsiyon yetkisi olmayan işlemi yapamaz — kural yalnız ekranda değil, sunucuda her istekte denetlenir.],
  rakam: (("6", "hazır rol"), ("70+", "ayrı izin"), ("Her istek", "sunucuda izin denetimi")),
  ozellik: (
    ("Gerçek giriş", "E-posta ve şifre; kısa ömürlü erişim anahtarı + yenileme anahtarı, çıkış ve oturum bilgisi."),
    ("Kullanıcı yönetimi", "Ekle, düzenle, pasife al, şifre sıfırla; pasif kullanıcı giriş yapamaz."),
    ("Rol → izin matrisi", "Satırda izinler (modül gruplarıyla), sütunda roller; otel kendi matrisini kaydeder."),
    ("Yeni modül güvenli gelir", "Matris kaydedildikten sonra eklenen modülün izni rolün varsayılanına düşer; yöneticinin kaldırdığı izin geri gelmez."),
    ("Menü ve düğmeler izne göre", "Yetkisi olmayan kullanıcı menüyü ve düğmeyi hiç görmez."),
    ("Denetim izi", "Her istekte hangi iznin istendiği denetim kaydına yazılır."),
  ),
  neden: [Hassas işlemler (iptal, iade, fiyat değişikliği, ödeme) yalnız yetkili kişinin elinde kalır ve kimin yaptığı her zaman bilinir.],
  rol: (([Yönetici], [Kullanıcıları ve rol matrisini yönetir.]), ([Bütün personel], [Kendi hesabıyla girer; rolünün izinleriyle çalışır.])),
  baglantilar: ("*Bütün modüller:* her ekran ve işlem bu modüldeki izinlere bağlıdır; yetkisi olmayan düğmeyi görmez, işlemi sunucu da reddeder.", "*Onay kuyruğu (11):* kendi isteğini onaylama yasağı kullanıcı kimliğiyle denetlenir."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [İzin kataloğu tek yerde: `hotel/contracts/permissions.js` (değer, etiket, grup, rol varsayılanları). Sunucuda `lib/permissions.js` → `requirePermission(izin)` / `requireAnyPermission(...izinler)` Fastify preHandler'ları; gövdeye bağlı ek yetki `assertRequestPermission`. Aktif otel ve personel kimliği JWT'den çözülür (`lib/tenant.js`). Ön yüzde `lib/permissions.js` → `useCan()` menü ve düğmeleri gizler. Yeni bir modülün izni kataloğa (değer, etiket, grup, rol varsayılanı) eklenir; matrisi kaydetmiş otellerde `Hotel.permissionCatalog` sayesinde varsayılana düşer.],
  kural: (
    ("İzin denetimi sunucuda", "Ekrandaki gizleme kolaylıktır; güvenlik sınırı rotanın preHandler'ıdır. İzin yoksa 403, kimlik yoksa 401."),
    ("Rol matrisi + katalog", "Otel matrisi kaydettiğinde o anki izin kataloğu da saklanır; sonradan eklenen izin rol varsayılanından gelir."),
    ("Pasif kullanıcı", "Pasif kullanıcı giriş yapamaz, yenileme anahtarı reddedilir."),
  ),
  tutarlilik: ("Erişim anahtarı kısa ömürlü; yenileme anahtarı veritabanında (`RefreshToken`), çıkışta geçersiz kılınır.", "Denetim izi için istenen izin `request.requiredPermission` olarak kaydedilir."),
  degistir: (
    ("Yeni izin", "`contracts/permissions.js`: `PERMISSIONS` değeri, `PERMISSION_LABELS` etiketi, ilgili `PERMISSION_GROUPS` grubu ve rol varsayılanları; rotada `requirePermission(PERMISSIONS.X)`; ön yüzde `can(PERMISSIONS.X)`."),
    ("Yeni rol", "Rol listesi ve varsayılan izinleri sözleşmede; matris ekranı listeden üretilir."),
  ),
)
