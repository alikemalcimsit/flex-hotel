# CLAUDE.md — Ahmet'in çalışma kuralları (flex-ahmo branch)

> **Kapsam:** Bu dosya yalnızca `flex-ahmo` branch'inde bulunur. `main`'e veya
> `flex-ali`'ye asla merge edilmez, cherry-pick edilmez, kopyalanmaz. Ali'nin
> agent'ı bu dosyayı hiçbir zaman görmemeli. Bu dosyayı gören her agent
> [GOREVLER.md](GOREVLER.md)'de **tek numaralı** maddeler üzerinde çalışıyor demektir.

## Neden bu dosya var

Bu otel yazılımı projesinin bir önceki girişimi resetlendi. Sebep kod hatası
değildi — süreç hatasıydı:

1. Modüller **yüzeysel** kaldı: CRUD iskeleti var ama validasyon, hata
   yönetimi, izin kontrolü, edge-case'ler, ölçek düşünülmeden "demo kalitesi"
   üretildi.
2. Roadmap agent'a teslim edilip arkasından "devam, devam, devam" denildi;
   sonuçta ortaya kimsenin tam hakim olmadığı bir kod tabanı çıktı.

Bu dosyanın amacı bu iki hatayı **tekrarlamamak**. Aşağıdaki kurallar
kesindir, yorum payı yok. Bir kuralı uygulayamayacak durumdaysan (belirsizlik,
çelişki, eksik bilgi) **susup geçmek yerine dur ve sor.**

---

## 1. Çalışma akışı — modül başına tek onay döngüsü

Her modüle başlamadan önce:

- [GOREVLER.md](GOREVLER.md)'deki ilgili maddenin **"Gün sonu"** tanımını ve
  altındaki tüm alt maddeleri oku. Modül, "Gün sonu" cümlesini gerçekten
  karşılamadan bitmiş sayılmaz — checkbox'ları işaretlemek yetmez.
- Kısaca (birkaç cümle) hangi dosyaları/katmanları nasıl kuracağını söyle,
  sonra başla.

Modül bitince:

- Aşağıdaki **§3 Kalite Checklist**'inin her maddesini gerçekten karşıladığını
  doğrula (kontrol etmeden "yaptım" deme).
- Bir özet ver: ne inşa edildi, hangi dosyalar, hangi tasarım kararı neden
  öyle alındı, checklist'in hangi maddesi nasıl karşılandı, hangi ölçek
  önlemi nerede uygulandı.
- **Açıkça onay istemeden bir sonraki modüle geçme.** Kullanıcı "devam et"
  demeden ilerleme — bu, "devam-devam-devam" hastalığının panzehiridir:
  kullanıcı her modülü gerçekten okuyup anlayarak onaylamalı.

Süre bir hedef değildir — bir semptomdur. Checklist'i eksiksiz uygularsan
modül doğal olarak 8-9 dakikadan kısa sürmez. Süreyi doldurmak için yapay
oyalama, gereksiz tekrar veya anlamsız iş **yasaktır**. Eğer checklist
tamamlandı ve modül gerçekten kısa sürdüyse, bu bir sorun değildir —
sorgulanması gereken tek şey checklist'in gerçekten eksiksiz uygulanıp
uygulanmadığıdır.

---

## 2. Ölçek standardı — "2500 kişi / Ankara Hilton büyüklüğü"

Her modül, büyük bir otelin gerçek yükünü kaldıracak şekilde yazılır. Bu
soyut bir dilek değil, somut kod-seviyesi disiplindir:

- **Pagination zorunlu.** Hiçbir liste endpoint'i `findMany` ile limitsiz
  dönmez. Filtre + sayfalama (limit/offset veya cursor) her listede olur.
- **Index disiplini.** Prisma şemasında filtrelenen veya sıralanan her kolon
  (`WHERE`, `ORDER BY`'da kullanılan) index'li olmalı. Yeni bir sorgu
  yazarken var olan index'lerin yeterli olup olmadığını kontrol et; gerekiyorsa
  migration ile ekle.
- **N+1 sorgu yok.** İlişkili veri çekerken Prisma `include`/`select` ile tek
  sorguda getir; döngü içinde ayrı sorgu atma.
- **Kritik yazımlarda transaction.** Para (folio, ödeme, fatura), stok, oda
  atama gibi birden fazla tabloyu birlikte değiştiren her işlem
  `prisma.$transaction` içinde olur.
- **Eşzamanlılık güvenliği.** Aynı anda iki kullanıcı aynı odayı/kaydı
  değiştirebiliyorsa (oda atama, müsaitlik, folyo bakiyesi gibi) optimistic
  lock (`updatedAt`/version kontrolü) veya DB-seviyesi constraint ile
  race condition'a karşı koru. "Muhtemelen çakışmaz" varsayımı geçersizdir.
- **hotelId scope'u asla atlanmaz.** Şema multi-tenant (`Hotel` üzerinden);
  her sorgu ve mutation `hotelId` ile filtrelenir — bu hem ölçek hem
  güvenlik meselesidir.

---

## 3. Kalite Checklist — her modülde zorunlu

### Backend
- [ ] `routes.js` + `service.js` ayrımı (iş mantığı route handler'da değil,
  service'te)
- [ ] Girdi validasyonu (zod) — hatalı/eksik/kötü niyetli girdi güzelce
  reddedilir, sunucu çökmez
- [ ] Hata yönetimi: beklenen hatalar (404, 409, 422) anlamlı mesajla döner;
  beklenmeyenler `server.js`'deki merkezi handler'a düşer
- [ ] İzin kontrolü: `requirePermission(...)` (RBAC hazır olana kadar en
  azından rol kontrolü) her route'a eklenir — `shared/auth` boşsa bunu not
  düş, modülü RBAC'a bağlanmaya hazır şekilde yaz
- [ ] Audit/activity log: kaydı değiştiren her işlem iz bırakır (RBAC/audit
  altyapısı henüz yoksa, en azından ileride kolayca bağlanacak bir noktada
  event/log çağrısı bırak — sessizce atlama)
- [ ] §2'deki ölçek maddeleri (pagination, index, N+1, transaction,
  concurrency, hotelId scope)
- [ ] Kritik iş mantığına (fiyat hesabı, müsaitlik, bakiye/folyo hesapları
  gibi hata payı olmayan servis fonksiyonları) Node'un yerleşik test runner'ı
  ile birim test — bkz. §4

### Frontend
- [ ] Yükleniyor durumu, boş durum (veri yok), hata durumu — üçü de ayrı ayrı
  ele alınır, "spinner sonsuza kadar döner" veya "boş tabloda hiçbir şey
  yazmıyor" gibi durumlar yok
- [ ] Form validasyonu: zorunlu alan, format, aralık kontrolü — sadece
  backend'e güvenip frontend'i boş bırakma
- [ ] Kullanıcıya net geri bildirim: işlem başarılı/başarısız net görünür
  (toast, inline mesaj vb.)
- [ ] Yetkisiz kullanıcıdan gizlenmesi gereken buton/menü gerçekten gizli

### Genel
- [ ] Sahte/mock veri veya "TODO: sonra" bırakılmış yarım kod yok — bir
  modül ya tamamdır ya da başlanmamıştır, aradası teslim edilmez
- [ ] Hardcoded değer yok (magic number, sabit ID, sabit URL) — ayarlar
  tablosundan/parametreden okunur veya en azından üstte adlandırılmış sabit
  olarak tanımlanır

---

## 4. Test politikası

Repo kökündeki README "test yok" diyor — bu genel kural geçerliliğini
korur, **ama** şu istisna bu branch'te devrededir:

- Kritik iş mantığı — fiyat hesabı, müsaitlik kontrolü, bakiye/folyo
  hesaplamaları, overbooking kuralı gibi hata payı sıfıra yakın olması
  gereken saf fonksiyonlar — Node'un yerleşik `node:test` + `node:assert`
  modülüyle test edilir. Ekstra test framework/dependency eklenmez.
- CRUD route'ları, ekranlar, basit servis fonksiyonları test edilmez —
  README'nin genel kuralı burada geçerli.

---

## 5. Kırmızı çizgiler — asla geçilmez

1. Onay almadan bir sonraki modüle geçmek yok.
2. "Gün sonu" tanımını karşılamayan bir modülü tamamlandı olarak sunmak yok.
3. Süreyi doldurmak için anlamsız/tekrar iş üretmek yok — checklist eksiksiz
   uygulanır, süre onun doğal sonucudur, hedef değildir.
4. `hotelId` scope'u atlanmış bir sorgu/mutation yok.
5. Pagination'sız liste endpoint'i yok.
6. Bu dosyayı `main` veya `flex-ali`'ye merge etmek/taşımak yok.
7. Belirsizlik/çelişki varsa varsayımla devam etmek yok — dur, sor.
