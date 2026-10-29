#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Para iadesi, büyük ödeme, folyo kalemi ya da ödeme iptali, kapasite aşımı (overbooking), acente primi, restoran adisyon düzeltmesi, eşik üstü satın alma siparişi gibi riskli işler doğrudan yapılmaz: yetkilinin önüne onay olarak düşer. Onaylanınca sistem kaldığı yerden devam eder, reddedilir ya da süresi dolarsa iş geri alınır. Parayla ilgili türlerde isteyen kendi isteğini onaylayamaz — dört göz kuralı.],
  rakam: (("12", "onay türü, tek kuyruk"), ("Dört göz", "9 türde isteyen onaylayamaz"), ("Süreli", "varsayılan 1 gün, en çok 30 gün"), ("Tek karar", "iki yönetici aynı anda karar veremez")),
  adimlar: (("İstek", "servis ya da aktör"), ("Kuyruk", "özet · tutar · süre"), ("Haber", "zil + üst bar sayacı"), ("Karar", "onay notu / ret gerekçesi"), ("Devam", "iş kaldığı yerden")),
  akis-aciklama: [Onay HTTP'den elle açılmaz; yalnız işi yapan servis ya da aktör açar. Kuyruk, isteğin verisini yorumlamadan gösterir.],
  ozellik: (
    ("Bekleyen onaylar", "Özet kutuları; en uzun bekleyen üstte, akan kalan süre; satırdan tek tıkla onayla / reddet."),
    ("Detay ve karar", "İsteyenin verisi, gerekçe, tutar, ilgili kayda bağlantı; karar aynı pencerede. Onayın bağlantısı paylaşılabilir; açan doğrudan o kararın penceresine gelir."),
    ("Geçmiş", "Karar süzgeci; kim, ne zaman, hangi notla karar verdi."),
    ("Süre dolumu", "Süresi geçen onay kendiliğinden düşer; isteyenin ziline \"yapılmadı\" uyarısı gider. Süresi geçmiş onaya karar verilemez."),
    ("Üst bar sayacı", "Bekleyen sayısı; süresi yaklaşan varsa kırmızı. Yan menüde rozet, zilde uyarı, yetkiliye kısa bildirim."),
    ("Gerekçe zorunlu", "Ret gerekçesiz olmaz: isteyen ve denetim izi nedenini görmeli. İsteyen kendi isteğini reddederek geri çekebilir."),
  ),
  neden: [Tek bir kişinin hatası ya da kötü niyeti parayı tek başına hareket ettiremez; her kararın kim tarafından, neden verildiği kalıcı olarak kayıtlıdır.],
  rol: (([Yönetici, müdür], [Onaylar / reddeder.]), ([Muhasebe], [Bekleyen ve geçmiş onayları görür.]), ([İsteyen personel], [İşini başlatır; dört göz türlerinde kendi isteğini onaylayamaz.])),
  baglantilar: ("*Folyo (15):* kalem iptali.", "*Ödeme (17):* iade, büyük ödeme, ödeme iptali.", "*Rezervasyon (4):* kapasite aşımı (overbooking).", "*Acente prim (35), banket (37), restoran (39), satın alma (45):* prim hak edişi, etkinlik ödemesi, adisyon düzeltmesi / ödemesi, eşik üstü sipariş.", "*Günlük durum (13):* \"bekleyen işler\" kutusu bu kuyruğun özetinden."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [İki istek yolu var. *Servis yolu* (bugünkü bütün akışlar): servis kendi transaction'ında `requestApproval(tx, stage, { hotelId, type, summary, amount, currency, data, entityType, entityId })` der (`modules/approvals/service.js`); karar `approval.granted` / `denied` / `expired` olayıyla gelir, isteyen modülün dinleyicisi `approvalId` ile işini bitirir ya da geri alır. *Aktör yolu* (`shared/actor-kit/approval.js`): işleyici `ctx.requireApproval({ action, type, summary, data, amount, expiresInMs })` der; taban sınıf bunu hata değil sinyal sayar — yeniden denemez, manuel göreve düşürmez — ve onay + `PendingAction` (olayın zarfı) açar. Onay verilince *aynı işleyici aynı olayla* `ctx.approval` dolu çağrılır.],
  kural: (
    ("Neden devam bus'a değil", "Onaylanan olay bus'a yeniden verilseydi aynı olayı dinleyen diğer aktörler işi ikinci kez yapardı (misafire iki onay). Devam yalnız isteyen aktörün işleyicisine, aynı olay kimliği ve zincirle; aktör olarak onaylayan kişi yazılır."),
    ("Dört göz", "`APPROVAL_SELF_DECISION_FORBIDDEN_TYPES` (iptaller, iade, büyük ödeme, prim, POS, sipariş): isteyen onaylayamaz (409 `SELF_DECISION`), reddedebilir."),
    ("Tek karar", "Karar satır kilidiyle; ikinci karar 409 `NOT_PENDING`. Süresi geçmiş onay karar anında ayrı transaction'da düşürülür (409 ile biten karar transaction'ı düşürmeyi geri alırdı)."),
    ("Süre", "Varsayılan bir gün (`APPROVAL_DEFAULT_TTL_MS`), `expiresInMs: null` süresiz, en çok 30 gün; tarayıcı dakikada bir `FOR UPDATE SKIP LOCKED` ile düşürür."),
    ("Tek şema", "`approvalRequestSchema`: tür bilinmeli, tutar iki ondalıklı metin, para birimi 3 harf. Aktör yolunda `action` bildirgedeki `requiresApproval` listesinde olmalı; değilse programlama hatası, iş manuel göreve düşer."),
  ),
  tutarlilik: (
    "`PendingAction (actorName, eventId)` tekil: aynı olay yeniden gelse de ikinci istek açılmaz; `resumedAt` üstlenme işaretiyle devam bir kez.",
    "Onaylanmış iş, aktör bu arada kapatılmış olsa da yapılır; ret / süre dolumu olayı o aktör için `ProcessedEvent`'e yazılır. Aktör kayıttan kalkmışsa iş `Onay kuyruğu` manuel görevine düşer.",
    "Olaylar yalnız kimlik + tür taşır (özet ve tutar socket'e çıkmaz); canlı kanal `approvals.changed`.",
    "2.500 panel: özet sürüm + dakika anahtarlı önbellekte; sayaç canlı haberle en çok 10 sn'de bir tazelenir; imleçli liste `(hotelId, status, createdAt, id)` / `(hotelId, status, decidedAt, id)` index'lerinden, süre dolumu kısmi index'ten, özet araması trigram.",
  ),
  degistir: (
    ("Yeni onay türü", "`contracts/approvals.js`: `APPROVAL_TYPES` + etiket (+ dört göz gerekiyorsa yasak listesi) ve ekran ikonu `approvalTheme.js` — sütun metin olduğundan migration gerekmez, tür sözleşme şemasında doğrulanır; isteyen modülde `requestApproval` + `approval.*` dinleyicisi."),
    ("Eşik değiştir", "Eşikler ilgili modülün ayarındadır (ör. satın alma onay eşiği, nakit sınırı); kuyruk kodu değişmez."),
  ),
  devir: ("`BULK_PRICE_CHANGE` türü tanımlı, ekranda ikonu var; henüz bu türde onay açan akış yok.", "Aktör yolu uçtan uca testli (`actor-kit/approval.test.js`), bugün üretimde onay isteyen aktör yok — bütün istekler servislerden."),
)
