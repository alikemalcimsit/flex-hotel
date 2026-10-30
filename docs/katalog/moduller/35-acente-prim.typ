#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Acentelere dönemlik satış hedefi ve kademeli prim kuralı tanımlanır: gece ya da ciro hedefi, 10 kademeye kadar oran, isteğe bağlı oda tipi süzgeci ve prim tavanı. Panel her acentenin hedefe ne kadar yaklaştığını, temposunu ve tahmini primini canlı gösterir. Dönem kapanınca hak ediş kendiliğinden hesaplanır, dayandığı rezervasyonlar dondurulur ve ikinci bir yetkilinin onayına gider; muhasebe ödendi olarak işaretler.],
  rakam: (("10 kademe", "geriye dönük ya da dilimli"), ("Gerçek gece", "iptal ve gelmeyen sayılmaz"), ("Dört göz", "gönderen onaylayamaz"), ("2,4 sn", "25 bin rezervasyonlu dev acente hak edişi")),
  adimlar: (("Kural", "hedef · kademe · tavan"), ("Dönem", "canlı ilerleme · tempo"), ("Hesap", "dönem kapanınca kendiliğinden"), ("Onay", "dört göz"), ("Ödeme", "gün + belge no")),
  ozellik: (
    ("Hedef durumu", "İlerleme çubuğu kademe işaretleriyle, hedefe ulaşma yüzdesi (acente puanı), kademe ve tempo: doğrusal beklentiye göre önünde / yakın / gerisinde."),
    ("Kural formu", "Kademe satırları, okunur kademe cümleleri ve kaydetmeden önizleme."),
    ("Kural ekranı", "Gerçekleşen, eldekiyle tahmin, şu ana kadarki ve tahmini prim, dilim dökümü, kademe merdiveni, aylık üretim."),
    ("Hak ediş", "Rakamlar, uyarılar, akış, geçmiş, dondurulmuş rezervasyon dökümü (aranabilir) ve Excel; bugünkü veriyle fark gösterilir."),
    ("Kademe uyarısı", "Dönem içinde kademe yükselince yöneticiye bir kez uyarı; dönem bitince \"onaya gönderin\"."),
    ("Acente kartında", "\"Prim ve hedef\" sekmesi; onay penceresinde hak edişe bağlantı."),
  ),
  neden: [Prim hesabı tabloda elle yapıldığında hem hata hem tartışma doğar; burada üretim gelir raporuyla aynı tanımdan gelir, hak edişin dayandığı her rezervasyon kayıtlıdır.],
  rol: (([Müdür], [Kural tanımlar, hesaplatır, onaya gönderir.]), ([Muhasebe, müdür], [Ödendi işaretler / geri alır.]), ([Onay yetkilisi], [Hak edişi onaylar; gönderen onaylayamaz (dört göz).])),
  baglantilar: ("*Acente ve kontrat (29):* acente kartı ve komisyon oranı.", "*Gelir raporları (23):* matrah = folyoya işlenen vergisiz oda geliri, aynı tanım.", "*Onay kuyruğu (11):* acente prim onayı, 7 gün süre.", "*Bildirim (9):* kademe ve dönem sonu zil uyarıları."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/agency-bonus`: kurallar (`AgencyBonusRule`: acente, dönem ≤ 731 gün, ölçüt gece / ciro, uygulama tüm üretime ya da yalnız aşan kısma, 1–10 kademe, oda tipi süzgeci, tavan; taslak → yürürlükte → iptal), hak edişler (`AgencyBonus`: kural başına tek; kuralın hesap anındaki kopyası + sonuç; hesaplandı → onay bekliyor → onaylandı → ödendi) ve döküm (`AgencyBonusLine`: rezervasyon başına dönemdeki gece ve ciro, dondurulmuş). Hesap motoru `agency-bonus/rules.js` saf ve birim testli; dönem sonu ve ilerleme işleri zamanlanmış (30 dk).],
  kural: (
    ("Üretim", "Dönemin içine düşen, misafirin gerçekten kaldığı geceler; dönem sınırını aşan konaklama gece gece bölünür; eldeki geceler yalnız tahmin. Ters kayıt asıl gecenin gününe yazılır."),
    ("Kademe ve dilim", "Eşiğe eşit üretim kademeye ulaşır. Dilimli hesapta gece diliminin tutarı = dilimdeki gece × dönemin ortalama gece geliri (hangi gecenin \"aşan\" olduğundan bağımsız). Prim yuvarlanmış dilimlerin toplamıdır (döküm toplamı primi tutar); tavan uygulanır; eksi ciro sıfır."),
    ("Bayatlık", "Onaya gönderirken kural hesaptan sonra değiştiyse ya da bugünkü üretim hesaptakinden farklıysa önce yeniden hesap istenir."),
    ("Yaşam döngüsü", "Prim doğmayan dönem kuyruğa gitmeden kapanır. Ret / süre dolumu \"hesaplandı\"ya döner; onaylı ama ödenmemiş hak ediş gerekçeyle yeniden açılır (sürüm artar). Ödeme günü ileri tarih ve onaydan önce olamaz."),
    ("Kural kilidi", "Hak edişi onaya gitmiş kural değiştirilemez / iptal edilemez; dönemi uzatılan kuralın taslak hak edişi silinir."),
  ),
  tutarlilik: (
    "Aynı acentenin aynı ölçütte çakışan iki yürürlükteki kuralı olamaz: ölçüt başına `EXCLUDE` kısıtı; eşzamanlı yürürlüğe alma ve eşzamanlı hesap testli.",
    "Kilit sırası: kural → hak ediş. Durum izleri CHECK'le korunur.",
    "İlerleme özeti kolonları ham SQL'le yazılır ve `updatedAt`'e dokunmaz — arka plan işi kullanıcının sürüm kontrolünü bozmaz.",
    "Döküm veritabanında `INSERT … SELECT` ile yazılır (ilk sürüm 4,6–6,6 sn idi).",
  ),
  olcek: (("İlerleme işi (1.202 kural, tek sorgu)", "0,76 sn"), ("Liste / özet", "8–16 ms / 4 ms"), ("Dev acentenin kural ekranı", "0,36 sn"), ("Hak ediş hesabı", "2,4 sn"), ("25 bin satır Excel (10 binlik parçalar)", "1,6 sn")),
  olcek-not: [Ölçüm `scripts/perf-agency-bonus.mjs`: 550 bin rezervasyon, 3.000 acente, 1.803 kural, 25 bin rezervasyonlu "dev tur operatörü".],
  degistir: (
    ("Yeni ölçüt", "`rules.js` hesap fonksiyonu + Prisma enum + migration + `EXCLUDE` kısıtının ölçüt kapsamı; ilerleme SQL'i ve döküm sorgusu aynı tanımı kullanmalı."),
    ("Matrah tanımı", "Gelir raporunun oda geliri tanımıyla bağlı — ayrı bir tanım yazılmamalı."),
  ),
  devir: ("Acente carisinden prim düşümü ve ödeme kaydı ön muhasebe (47) ile bağlanacak.", "Misafir sadakat puanı ayrı modül (56); \"acente puanı\" burada hedefe ulaşma yüzdesidir, ayrı puan defteri yok."),
)
