#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Yıllık bütçe kalem × ay ızgarasında girilir ya da otele özel Excel şablonu indirilip doldurularak yüklenir: gelirler, doluluk ve ADR hedefleri, tahsilat ve giderler. Bütçe taslak → onaylı olarak kilitlenir, değişiklik revizyonla yapılır (eski sürüm saklanır). Sapma raporu gerçekleşeni sistemden alır — oda geliri gelir raporuyla birebir aynı — ve oda geliri sapmasını doluluk etkisi ile fiyat etkisine ayırır. Yapay zekâ sapmayı tek paragrafta yorumlar.],
  rakam: (("12 ay", "kalem × ay ızgarası + Excel"), ("Kilitli", "onaylı bütçe; değişiklik revizyonla"), ("2 etki", "oda geliri sapması: doluluk + fiyat"), ("0,46 sn", "yılbaşından bu yana sapma, 1.500 oda")),
  adimlar: (("Plan", "ızgara · Excel yükle"), ("Onay", "müdür kilitler"), ("Gerçekleşen", "sistemden + elle gider"), ("Sapma", "plan · gerçek · fark"), ("Yorum", "AI paragrafı")),
  ozellik: (
    ("Bütçe ızgarası", "Gelir / hedef / nakit / gider grupları, ara toplamlar, brüt faaliyet kârı; Türkçe sayı biçimi, hücre hatası ay adıyla."),
    ("Excel şablonu", "Otelin kalemleriyle şablon indir → doldur → yükle (kod sütunuyla eşleşir); yüklenen değer kaydedilmemiş değişiklik olarak gelir, gözden geçirilip kaydedilir."),
    ("Sürümler", "Taslak → onaylı (kilit) → revize; önceki onaylı \"eski sürüm\" olarak saklanır. Yıl başına tek taslak ve tek onaylı."),
    ("Sapma raporu", "Ay ya da yılbaşından seçilen aya; gelirde fazlası, giderde azı olumlu (renk + işaret); gerçekleşeni girilmemiş gider \"eksik\" işaretli."),
    ("Ay içi orantı", "İçinde bulunulan ayın planı kapanmış gün oranında karşılaştırılır — ayın 10'unda tam ay planıyla kıyas yapılmaz."),
    ("AI yorumu", "Sapmayı yorumlayan paragraf; ajan kapalıysa ya da bütçe dolduysa rapor yorumsuz da eksiksizdir. Modele kişisel veri gitmez."),
  ),
  neden: [Bütçe ile gerçekleşenin aynı tanımdan gelmesi, "bütçe raporu başka, gelir raporu başka diyor" tartışmasını bitirir; sapmanın sebebi (doluluk mu fiyat mı) rakamla görünür.],
  rol: (([Müdür, muhasebe], [Bütçeyi görür ve girer.]), ([Müdür], [Bütçeyi onaylar / revizyonu başlatır.])),
  baglantilar: ("*Gelir raporları (23):* oda geliri, ek ücret, iptal geliri, satılan / satılabilir oda aynı hesaptan.", "*Folyo (15), ödeme (17):* restoran / minibar / çamaşır geliri kalem türünden; tahsilat kasa tanımıyla.", "*Aktör paneli (12):* bütçe yorum ajanının kullanımı ve bütçesi.", "*Konuşarak rezervasyon (8):* model ve günlük AI bütçesi aynı ayardan."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/budget`: yıl görünümü, aç / revize / onayla, satır kaydı (sürümlü), gider kalemleri, gerçekleşen gider (hücre sürümlü), sapma ve yorum isteği. Veri: `Budget` (yıl × sürüm; `DRAFT` / `APPROVED` / `SUPERSEDED`), `BudgetLine` (kalem × ay plan), `BudgetExpenseItem` (otelin gider kalemleri; ilk bütçede USALI'ye göre 7 önerilen kalem), `BudgetExpenseActual`, `BudgetCommentary`. AI: `explain_variance` aracı raporlama MCP sunucusunda; `budget-agent` olay güdümlü (`budget.commentary.requested` → yorum → `budget.commentary.completed`).],
  kural: (
    ("Gerçekleşen", "Yalnız kapanmış günler. Oda geliri / ek ücret / iptal geliri / satılan / satılabilir gelir raporunun hesabından; diğer gelir folyo kalem türünden (indirim kendi vergi kategorisinin gelirinden düşer, vergi kalemi gelir değil); tahsilat = işlenmiş ödeme − iade ± iptal kaydı; gider elle."),
    ("Hedef ağırlıkları", "Doluluk hedefi satılabilir odayla, ADR hedefi planlanan geceyle ağırlıklı; doluluk 0–100."),
    ("Plan kaynağı", "Yılın onaylı bütçesi, yoksa taslak (ekranda işaretli)."),
    ("Ayrıştırma", "Oda geliri sapması = doluluk etkisi + fiyat etkisi; girilen plan hedeflerle tutmuyorsa fark ayrıca gösterilir."),
    ("Gider kalemi", "Etkin ad tekil; kaldırılan arşivlenir — açık taslaklardan düşer, onaylılarda kalır. Gelecek ayın gerçekleşeni girilmez."),
  ),
  tutarlilik: (
    "Yıl başına tek taslak ve tek onaylı: kısmi tekil index; satırlar ve gider hücreleri sürüm kontrollü (eski sürümle kayıt 409).",
    "Canlı tazeleme kaydedilmemiş girişi silmez; başkası kaydettiyse uyarır (kanal `budget.changed`).",
    "AI isteği askıda kalmaz: ajan kapalı / anahtar yok / bütçe doldu → \"yazılamadı\"; 5 dk zaman aşımı son güvence; dönem başına tek bekleyen yorum.",
    "CHECK'ler: ay, tutar, onay izi, yorum izi.",
  ),
  olcek: (("Yılbaşından bu yana sapma (soğuk)", "~0,46 sn"), ("Ay / kapsam değişimi", "önbellekten, anında")),
  olcek-not: [Ölçüm `scripts/perf-budget.mjs`: 1.500 oda, 4 yıl. Yılın sistem gerçekleşeni bir kez okunur.],
  degistir: (
    ("Yeni bütçe kalemi (sistem)", "Sözleşmedeki kalem listesi + gerçekleşen hesabı (`budget` sorguları); Excel şablonu kod sütunundan kendiliğinden üretilir."),
    ("Yorum davranışı", "`hotel/agents/budget-agent` (birim testli; sahte modelle uçtan uca entegrasyon testi var)."),
  ),
  devir: ("Gider gerçekleşeni şimdilik elle: satın alma (45) ve ön muhasebe (47) verisinden otomatik hesap, bütçe kalemi ↔ gider eşlemesiyle sonraki iş.", "Doğal dil raporlama (24) `explain_variance`'ı MCP'den çağırır."),
)
