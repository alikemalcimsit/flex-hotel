/**
 * RBAC izin kataloğu — tek kaynak.
 *
 * İzin adları hem sunucuda (`requirePermission`, rol→izin çözümü) hem tarayıcıda
 * (`useCan`, menü gizleme) kullanılır. Eskiden backend ve frontend `lib/permissions.js`
 * içinde iki kez tanımlıydı; kayması kaçınılmazdı. Artık ikisi de buradan okur.
 *
 * Yeni bir modül izin eklerken: `PERMISSIONS`'a değeri, `PERMISSION_LABELS`'a
 * Türkçe karşılığını, `PERMISSION_GROUPS`'a hangi başlık altında görüneceğini,
 * `DEFAULT_ROLE_PERMISSIONS`'a hangi rollerin varsayılan aldığını ekleyin.
 */

/** İzin değerleri. Değer stringleri veritabanına (RolePermission.permission) yazılır — değiştirmeyin. */
export const PERMISSIONS = Object.freeze({
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  ROOMS_VIEW: 'rooms.view',
  ROOMS_MANAGE: 'rooms.manage',
  ROOMS_OPERATE: 'rooms.operate',

  /** Rezervasyon listesi/detayı — görüntüleme. */
  RESERVATIONS_VIEW: 'reservations.view',
  /** Rezervasyon açma/düzenleme/iptal/no-show, grup ve bekleme listesi. */
  RESERVATIONS_MANAGE: 'reservations.manage',
  /** Sistem fiyatı yerine toplamı elle girmek (gerekçeyle). Yönetim işi. */
  RESERVATIONS_PRICE_OVERRIDE: 'reservations.price_override',

  /** Ön büro listeleri (gelecekler, gidecekler, konaklayanlar) — görüntüleme. */
  STAYS_VIEW: 'stays.view',
  /** Check-in / check-out ve aynı gün geri alma. */
  STAYS_MANAGE: 'stays.manage',
  /** Folyo bakiyesi kapanmadan çıkışa izin vermek (gerekçeyle). Yönetim işi. */
  STAYS_OPEN_BALANCE: 'stays.checkout_open_balance',

  MESSAGES_VIEW: 'messages.view',
  MESSAGES_REPLY: 'messages.reply',
  REQUESTS_VIEW: 'requests.view',
  REQUESTS_MANAGE: 'requests.manage',

  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_MANAGE: 'notifications.manage',

  APPROVALS_VIEW: 'approvals.view',
  APPROVALS_DECIDE: 'approvals.decide',

  /** Kullanıcı listesini görmek. */
  USERS_VIEW: 'users.view',
  /** Kullanıcı ekleme/düzenleme/pasife alma/şifre sıfırlama. */
  USERS_MANAGE: 'users.manage',
  /** Rol → izin matrisini düzenlemek. */
  ROLES_MANAGE: 'roles.manage',

  /** Aktivite akışı, olaylar ve işlem zincirleri (modül 10). */
  ACTIVITY_VIEW: 'activity.view',
  /** Denetim kaydı: kim hangi kaydı ne zaman nasıl değiştirdi (eski/yeni değerle). */
  AUDIT_VIEW: 'audit.view',

  /** Günlük durum ekranı (modül 13): doluluk, gelecek / gidecek, oda geliri, ADR. */
  DASHBOARD_VIEW: 'dashboard.view',
  /** Tahminin kritik gün eşikleri (modül 25; tahminin kendisi günlük durumla görülür). */
  FORECAST_MANAGE: 'forecast.manage',

  /** Folyoları ve kalemlerini görmek (modül 15). Kat hizmetleri görmez. */
  FOLIO_VIEW: 'folio.view',
  /** Harcama işlemek, kalem aktarmak, folyo bölmek / birleştirmek / kapatmak, iptal istemek (iptal onaya gider). */
  FOLIO_POST: 'folio.post',
  /** İndirim uygulamak, kapanmış folyoyu yeniden açmak. Yönetim / muhasebe işi. */
  FOLIO_ADJUST: 'folio.adjust',

  /** Ödeme almak: tahsilat, ön ödeme / depozito (modül 17). Eşik üstü ödeme onaya gider. */
  PAYMENT_RECEIVE: 'payment.receive',
  /** İade ve ödeme iptali (hatalı giriş) istemek. Her ikisi de ikinci bir yetkilinin onayına gider. */
  PAYMENT_REFUND: 'payment.refund',
  /** Kasa görünümü: günün yöntem bazında tahsilat / iade toplamları ve hareketleri. */
  CASH_VIEW: 'cash.view',
  /** Günlük döviz kurunu girmek. Döviz ödemeleri bu kurla çevrilir. */
  EXCHANGE_RATES_MANAGE: 'exchange_rates.manage',

  /** Minibar tüketimlerini, çamaşır siparişlerini ve günlük raporu görmek (modül 19). */
  EXTRAS_VIEW: 'extras.view',
  /** Odada minibar tüketimi girmek (kat görevlisi). Folyoya otomatik yansır. */
  MINIBAR_POST: 'minibar.post',
  /** Çamaşır siparişi almak, parça sayımını düzeltmek, durumunu ilerletmek / teslim etmek. */
  LAUNDRY_POST: 'laundry.post',
  /** Minibar ve çamaşırhane fiyat listeleri, ekspres farkı. */
  EXTRAS_MANAGE: 'extras.manage',

  /** Kat hizmeti görev listesini, kat haritasını ve günlük özeti görmek (modül 14). */
  HOUSEKEEPING_VIEW: 'housekeeping.view',
  /** Görevli işlemleri: görevi başlatmak, bitirmek, sorun bildirmek (modül 14). */
  HOUSEKEEPING_OPERATE: 'housekeeping.operate',
  /** Görev açmak, toplu atama yapmak, görevi iptal etmek (kat şefi, modül 14). */
  HOUSEKEEPING_MANAGE: 'housekeeping.manage',
  /** Temizlenen odayı kontrol edip onaylamak / reddetmek (kat şefi, modül 14). */
  HOUSEKEEPING_INSPECT: 'housekeeping.inspect',

  /** Kayıp eşya listesini ve kayıtlarını görmek (modül 21). Misafirin iletişim bilgisi teslim yetkisiyle görünür. */
  LOST_ITEMS_VIEW: 'lost_items.view',
  /** Bulunan eşyayı fotoğrafıyla kaydetmek, bilgilerini düzeltmek. */
  LOST_ITEMS_RECORD: 'lost_items.record',
  /** Eşyayı misafirle eşleştirmek, misafirle iletişim notu yazmak, teslim etmek / kargolamak. */
  LOST_ITEMS_RELEASE: 'lost_items.release',
  /** Sahibi çıkmayan eşyayı kapatmak (bağış, imha, polis) ve saklama sürelerini ayarlamak. */
  LOST_ITEMS_MANAGE: 'lost_items.manage',

  /** Gelir raporları (modül 23): doluluk, ADR, RevPAR, oda geliri, kırılımlar, geçen yıl. */
  REPORTS_VIEW: 'reports.view',

  /** Bütçe (modül 27): bütçeyi ve sapma raporunu görmek. */
  BUDGET_VIEW: 'budget.view',
  /** Taslağı düzenlemek, gider kalemleri ve gerçekleşenleri, AI yorumu istemek. */
  BUDGET_MANAGE: 'budget.manage',
  /** Bütçeyi onaylamak (kilit) ve revize açmak. */
  BUDGET_APPROVE: 'budget.approve',

  /** Acente ve kontrat (modül 29): acente kartı, kontrat fiyatları, komisyon ve cari özetini görmek. */
  AGENCIES_VIEW: 'agencies.view',
  /** Acente kartı ve kontratı düzenlemek: fiyat, stop-sale, satışa açma, sonlandırma. */
  AGENCIES_MANAGE: 'agencies.manage',

  /** Promosyon ve kupon (modül 31): promosyonları, kuponları ve kullanım raporunu görmek. */
  PROMOTIONS_VIEW: 'promotions.view',
  /** Promosyon açmak / düzenlemek / yayına almak, kupon üretmek ve kapatmak. */
  PROMOTIONS_MANAGE: 'promotions.manage',

  /** Acente bonusu (modül 35): hedef / prim kuralları, ilerleme paneli ve hak ediş raporu. */
  AGENCY_BONUS_VIEW: 'agency_bonus.view',
  /** Kural açmak / düzenlemek / yürürlüğe almak, hak edişi hesaplamak, onaya göndermek, yeniden açmak. */
  AGENCY_BONUS_MANAGE: 'agency_bonus.manage',
  /** Onaylı hak edişi "ödendi" işaretlemek ve işareti gerekçeyle geri almak. */
  AGENCY_BONUS_PAY: 'agency_bonus.pay',

  /** Banket / etkinlik (modül 37): etkinlik dosyaları, salon takvimi, belgeler ve ödemeleri görmek. */
  BANQUET_VIEW: 'banquet.view',
  /** Etkinlik açmak / düzenlemek, opsiyon, kesinleştirme, iptal, teklif / sözleşme / proforma üretmek. */
  BANQUET_MANAGE: 'banquet.manage',
  /** Salon, ekipman, fiyat ve banket politikası (opsiyon süresi, depozito, iptal kademeleri). */
  BANQUET_SETUP: 'banquet.setup',
  /** Etkinlik depozitosu ve ödemesi almak, iade / iptal istemek. */
  BANQUET_PAYMENT: 'banquet.payment',

  /** Restoran POS (modül 39): vardiya açmak, adisyon açmak, sipariş göndermek, ödeme almak, odaya yazmak. */
  POS_OPERATE: 'pos.operate',
  /** Şef garson / müdür: ikram, indirim, gönderilmiş kalemin iptali, adisyonu başka garsona devretmek, kapanmış adisyonu açmak, ürünü "tükendi" yapmak. */
  POS_SUPERVISE: 'pos.supervise',
  /** Satış noktası, masa, menü (grup / ürün / fiyat) ve POS politikası. */
  POS_SETUP: 'pos.setup',
  /** Vardiya raporları, kapanmış adisyonlar, garson performansı. */
  POS_REPORT: 'pos.report',

  /** Reçete ve malzeme kartı (modül 38'in reçete kısmı, 43'te kuruldu): reçeteleri, malzemeleri, maliyet ve kâr marjını görmek. */
  RECIPES_VIEW: 'recipes.view',
  /** Reçete ve malzeme kartı düzenlemek: satırlar, fire, birim maliyet, alerjen. */
  RECIPES_MANAGE: 'recipes.manage',

  /** Satın alma (modül 45'in talep kısmı, 43'te kuruldu): talepleri görmek. */
  PURCHASING_VIEW: 'purchasing.view',
  /** Satın alma talebi açmak (banket ihtiyacından, elle, minimum stoktan) ve iptal etmek. */
  PURCHASING_REQUEST: 'purchasing.request',
  /** Satın alma (modül 45): tedarikçi kartı, teklif turu ve teklifler, kazanan seçimi (sipariş), sipariş iptali, satın alma politikası. */
  PURCHASING_MANAGE: 'purchasing.manage',
  /** Mal kabul / irsaliye: gelen miktarı depoya almak (stok girer). */
  PURCHASING_RECEIVE: 'purchasing.receive',

  /** Stok (44'ün çekirdeği, 45'te kuruldu): depo bazında mevcut, hareketler, stok değeri. */
  STOCK_VIEW: 'stock.view',
  /** Depo tanımları ve malzemenin minimum seviyesi. */
  STOCK_MANAGE: 'stock.manage',

  /** Ön muhasebe (modül 47): cariler ve ekstre, kasa / banka hareketleri, çek / senet portföyü, fişler. */
  ACCOUNTING_VIEW: 'accounting.view',
  /** Fiş girmek (tahsilat, ödeme, virman, kasa / banka giriş-çıkış), çek / senet işlemleri, cari kartı, eksik kayıtları eşitlemek. */
  ACCOUNTING_MANAGE: 'accounting.manage',
  /** Kasa / banka tanımları, yöntem eşlemesi, başlangıç günü ve onay eşiği, açılış bakiyeleri, fiş iptali. */
  ACCOUNTING_SETUP: 'accounting.setup',

  /** Fatura ve e-belge (modül 16 çekirdeği + 49): faturalanacaklar, faturalar, PDF, GİB durumu. */
  INVOICES_VIEW: 'invoices.view',
  /** Folyo / etkinlik faturası: taslak aç, alıcıyı düzenle, kes; e-belgeyi tekrar gönder. */
  INVOICES_ISSUE: 'invoices.issue',
  /** Cariye serbest fatura; fatura iptali istemek (onay kuyruğu). */
  INVOICES_MANAGE: 'invoices.manage',
  /** Fatura ayarları: satıcı bilgileri, seriler, faturalama başlangıcı, vergi kodları, entegratör ve test mükellefleri. */
  INVOICES_SETUP: 'invoices.setup',

  /** Personel listesi ve kartı (modül 51) — ücret, IBAN ve bordro hariç; kimlik numarası maskeli. */
  EMPLOYEES_VIEW: 'employees.view',
  /** Personel kartı ekle / düzenle, departman ata, işten çıkış (hakların hesabı ücret izni ister). */
  EMPLOYEES_MANAGE: 'employees.manage',
  /** Ücretler, IBAN, bordrolar, pusulalar ve çıktılar. */
  PAYROLL_VIEW: 'payroll.view',
  /** Ücret tanımı, puantaj, ek ödeme / kesinti, avans, icra, teşvik, servis payı; bordro hesaplama ve onaya gönderme. */
  PAYROLL_MANAGE: 'payroll.manage',
  /** Maaş ve avans ödemesi (kasa / bankadan çıkış). */
  PAYROLL_PAY: 'payroll.pay',
  /** Yasal parametreler (teyit dahil), kalem türleri, departmanlar, işyeri ayarları. */
  PAYROLL_SETUP: 'payroll.setup',
  /** Online check-in listesi ve ayrıntısı (belge fotoğrafları dahil), misafir portalı bağlantıları (modül 53). */
  GUEST_PORTAL_VIEW: 'guest_portal.view',
  /** Online check-in onayı / düzeltme isteği; portal bağlantısı ver / iptal et, daveti gönder. */
  GUEST_PORTAL_MANAGE: 'guest_portal.manage',
  /** Portal ayarları: davet ve açılış günleri, belge saklama süresi, misafire gösterilen metinler. */
  GUEST_PORTAL_SETUP: 'guest_portal.setup',

  /** Kanal yönetimi (modül 33): kanallar, eşleştirme, senkron logu, kanal rezervasyonları. */
  CHANNEL_MANAGER_VIEW: 'channel_manager.view',
  /** Kanal bağlamak / düzenlemek / senkrona almak, eşleştirme, stop-sale, elle senkron. */
  CHANNEL_MANAGER_MANAGE: 'channel_manager.manage',

  /** Aktör paneli (modül 12): aktörlerin durumu, bildirgesi, LLM harcaması. */
  ACTORS_VIEW: 'actors.view',
  /** Aktörü bu otelde açmak / kapatmak (kapalı aktörün işi personele düşer). */
  ACTORS_MANAGE: 'actors.manage',

  /** Gün kapanış (modül 18): kapanış durumu, önizleme, kapanış geçmişi ve günlük özet. */
  NIGHT_AUDIT_VIEW: 'night_audit.view',
  /** Günü kapatmak: gelmeyenleri düş, oda ücretlerini bas, kasayı say, günü ilerlet. */
  NIGHT_AUDIT_CLOSE: 'night_audit.close',

  /** Teknik servis (modül 20): arıza listesi, bilet ayrıntısı, bakım planı. */
  MAINTENANCE_VIEW: 'maintenance.view',
  /** Arıza bileti aç, başla, çöz, fotoğraf ekle (teknisyen / bildiren personel). */
  MAINTENANCE_OPERATE: 'maintenance.operate',
  /** Bilete teknisyen ata, iptal et, odayı arızaya al, periyodik bakım planı. */
  MAINTENANCE_MANAGE: 'maintenance.manage',
});

/** Tüm izinlerin düz listesi (doğrulama ve "ADMIN her şeyi görür" için). */
export const PERMISSION_VALUES = Object.freeze(Object.values(PERMISSIONS));

/** İzinlerin kullanıcıya gösterilen Türkçe adları (matris ekranı başlıkları). */
export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.SETTINGS_VIEW]: 'Ayarları görüntüle',
  [PERMISSIONS.SETTINGS_MANAGE]: 'Ayarları yönet',
  [PERMISSIONS.ROOMS_VIEW]: 'Odaları görüntüle',
  [PERMISSIONS.ROOMS_MANAGE]: 'Oda envanterini yönet',
  [PERMISSIONS.ROOMS_OPERATE]: 'Oda işlemleri (atama, durum)',
  [PERMISSIONS.RESERVATIONS_VIEW]: 'Rezervasyonları görüntüle',
  [PERMISSIONS.RESERVATIONS_MANAGE]: 'Rezervasyonları yönet',
  [PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE]: 'Fiyatı elle belirle',
  [PERMISSIONS.STAYS_VIEW]: 'Giriş / çıkış listelerini görüntüle',
  [PERMISSIONS.STAYS_MANAGE]: 'Giriş / çıkış yap',
  [PERMISSIONS.STAYS_OPEN_BALANCE]: 'Bakiyesi kapanmadan çıkışa izin ver',
  [PERMISSIONS.MESSAGES_VIEW]: 'Mesajları görüntüle',
  [PERMISSIONS.MESSAGES_REPLY]: 'Mesaj yaz / yönet',
  [PERMISSIONS.REQUESTS_VIEW]: 'İstekleri görüntüle',
  [PERMISSIONS.REQUESTS_MANAGE]: 'İstekleri yönet',
  [PERMISSIONS.NOTIFICATIONS_VIEW]: 'Bildirimleri görüntüle',
  [PERMISSIONS.NOTIFICATIONS_MANAGE]: 'Bildirim ayarlarını yönet',
  [PERMISSIONS.APPROVALS_VIEW]: 'Onay kuyruğunu görüntüle',
  [PERMISSIONS.APPROVALS_DECIDE]: 'Onayla / reddet',
  [PERMISSIONS.USERS_VIEW]: 'Kullanıcıları görüntüle',
  [PERMISSIONS.USERS_MANAGE]: 'Kullanıcıları yönet',
  [PERMISSIONS.ROLES_MANAGE]: 'Rolleri ve izinleri yönet',
  [PERMISSIONS.ACTIVITY_VIEW]: 'Aktivite akışını ve zincirleri görüntüle',
  [PERMISSIONS.AUDIT_VIEW]: 'Denetim kaydını görüntüle',
  [PERMISSIONS.DASHBOARD_VIEW]: 'Günlük durumu görüntüle (doluluk, gelir)',
  [PERMISSIONS.FORECAST_MANAGE]: 'Tahminin kritik gün eşiklerini ayarla',
  [PERMISSIONS.FOLIO_VIEW]: 'Folyoları görüntüle',
  [PERMISSIONS.FOLIO_POST]: 'Folyoya harcama işle, aktar, böl, birleştir',
  [PERMISSIONS.FOLIO_ADJUST]: 'İndirim uygula, kapanmış folyoyu yeniden aç',
  [PERMISSIONS.PAYMENT_RECEIVE]: 'Ödeme al (tahsilat, ön ödeme)',
  [PERMISSIONS.PAYMENT_REFUND]: 'İade / ödeme iptali iste (onaya gider)',
  [PERMISSIONS.CASH_VIEW]: 'Kasayı görüntüle',
  [PERMISSIONS.EXCHANGE_RATES_MANAGE]: 'Günlük döviz kurunu gir',
  [PERMISSIONS.EXTRAS_VIEW]: 'Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle',
  [PERMISSIONS.MINIBAR_POST]: 'Minibar tüketimi gir',
  [PERMISSIONS.LAUNDRY_POST]: 'Çamaşır siparişi al, durumunu güncelle',
  [PERMISSIONS.EXTRAS_MANAGE]: 'Minibar / çamaşır fiyat listelerini yönet',
  [PERMISSIONS.HOUSEKEEPING_VIEW]: 'Kat hizmeti görevlerini ve haritayı görüntüle',
  [PERMISSIONS.HOUSEKEEPING_OPERATE]: 'Temizlik görevini başlat / bitir, sorun bildir',
  [PERMISSIONS.HOUSEKEEPING_MANAGE]: 'Temizlik görevi aç, ata, iptal et',
  [PERMISSIONS.HOUSEKEEPING_INSPECT]: 'Temizlenen odayı kontrol et (onay / ret)',
  [PERMISSIONS.LOST_ITEMS_VIEW]: 'Kayıp eşyaları görüntüle',
  [PERMISSIONS.LOST_ITEMS_RECORD]: 'Bulunan eşya kaydet',
  [PERMISSIONS.LOST_ITEMS_RELEASE]: 'Kayıp eşyayı misafirle eşleştir, teslim et',
  [PERMISSIONS.LOST_ITEMS_MANAGE]: 'Sahibi çıkmayan eşyayı kapat, saklama süresini ayarla',
  [PERMISSIONS.REPORTS_VIEW]: 'Gelir raporlarını görüntüle (doluluk, ADR, RevPAR)',
  [PERMISSIONS.BUDGET_VIEW]: 'Bütçeyi ve sapma raporunu görüntüle',
  [PERMISSIONS.BUDGET_MANAGE]: 'Bütçe taslağını, gider kalemlerini ve gerçekleşen giderleri düzenle',
  [PERMISSIONS.BUDGET_APPROVE]: 'Bütçeyi onayla ve revize aç',
  [PERMISSIONS.AGENCIES_VIEW]: 'Acente, kontrat fiyatı ve cari özetini görüntüle',
  [PERMISSIONS.AGENCIES_MANAGE]: 'Acente kartı ve kontratı düzenle (fiyat, stop-sale, satışa aç)',
  [PERMISSIONS.PROMOTIONS_VIEW]: 'Promosyonları, kuponları ve kullanım raporunu görüntüle',
  [PERMISSIONS.PROMOTIONS_MANAGE]: 'Promosyon aç, düzenle, yayına al; kupon üret ve kapat',
  [PERMISSIONS.AGENCY_BONUS_VIEW]: 'Acente hedef / prim kurallarını, ilerlemeyi ve hak ediş raporunu görüntüle',
  [PERMISSIONS.AGENCY_BONUS_MANAGE]: 'Prim kuralı aç, düzenle, yürürlüğe al; hak edişi hesapla ve onaya gönder',
  [PERMISSIONS.AGENCY_BONUS_PAY]: 'Onaylı prim hak edişini ödendi işaretle',
  [PERMISSIONS.BANQUET_VIEW]: 'Etkinlik dosyalarını, salon takvimini, belgeleri ve ödemeleri görüntüle',
  [PERMISSIONS.BANQUET_MANAGE]: 'Etkinlik aç, opsiyonla, kesinleştir, iptal et; teklif / sözleşme / proforma üret',
  [PERMISSIONS.BANQUET_SETUP]: 'Salon, ekipman, fiyat ve banket politikasını düzenle',
  [PERMISSIONS.BANQUET_PAYMENT]: 'Etkinlik depozitosu / ödemesi al, iade ve iptal iste',
  [PERMISSIONS.POS_OPERATE]: 'POS: vardiya aç / kapat, adisyon aç, sipariş gönder, ödeme al, odaya yaz',
  [PERMISSIONS.POS_SUPERVISE]: 'POS: ikram, indirim, gönderilmiş kalemi iptal et, adisyonu devret / yeniden aç, ürünü tükendi yap',
  [PERMISSIONS.POS_SETUP]: 'POS: satış noktası, masa, menü ve politikayı düzenle',
  [PERMISSIONS.POS_REPORT]: 'POS: vardiya raporlarını ve kapanmış adisyonları görüntüle',
  [PERMISSIONS.RECIPES_VIEW]: 'Reçeteleri, malzeme kartlarını, maliyet ve kâr marjını görüntüle',
  [PERMISSIONS.RECIPES_MANAGE]: 'Reçete ve malzeme kartı düzenle (satır, fire, birim maliyet, alerjen)',
  [PERMISSIONS.PURCHASING_VIEW]: 'Satın alma taleplerini görüntüle',
  [PERMISSIONS.PURCHASING_REQUEST]: 'Satın alma talebi aç (banket, elle, minimum stok) ve iptal et',
  [PERMISSIONS.PURCHASING_MANAGE]: 'Tedarikçi, teklif turu, kazanan seçimi / sipariş, sipariş iptali, satın alma politikası',
  [PERMISSIONS.PURCHASING_RECEIVE]: 'Mal kabul / irsaliye gir (stok girer)',
  [PERMISSIONS.STOCK_VIEW]: 'Stok mevcudu, hareketleri ve stok değerini görüntüle',
  [PERMISSIONS.STOCK_MANAGE]: 'Depo tanımları ve minimum stok seviyesi',
  [PERMISSIONS.ACCOUNTING_VIEW]: 'Cariler ve ekstre, kasa / banka hareketleri, çek / senet portföyü ve fişleri görüntüle',
  [PERMISSIONS.ACCOUNTING_MANAGE]: 'Tahsilat / ödeme / virman fişi gir, çek / senet işlemleri, cari kartı aç ve düzenle',
  [PERMISSIONS.ACCOUNTING_SETUP]: 'Kasa / banka tanımları, yöntem eşlemesi, başlangıç günü ve onay eşiği, açılış bakiyesi, fiş iptali',
  [PERMISSIONS.INVOICES_VIEW]: "Faturalanacakları, faturaları, PDF'leri ve GİB durumunu görüntüle",
  [PERMISSIONS.INVOICES_ISSUE]: 'Folyo / etkinlik faturası kes (taslak, alıcı, kesim), e-belgeyi tekrar gönder',
  [PERMISSIONS.INVOICES_MANAGE]: 'Cariye serbest fatura kes, fatura iptali iste (onay kuyruğu)',
  [PERMISSIONS.INVOICES_SETUP]: 'Fatura ayarları: satıcı bilgileri, seriler, faturalama başlangıcı, vergi kodları, entegratör, test mükellefleri',
  [PERMISSIONS.NIGHT_AUDIT_VIEW]: 'Gün kapanışını ve günlük özeti görüntüle',
  [PERMISSIONS.NIGHT_AUDIT_CLOSE]: 'Günü kapat (night audit)',
  [PERMISSIONS.MAINTENANCE_VIEW]: 'Arıza / bakım taleplerini görüntüle',
  [PERMISSIONS.MAINTENANCE_OPERATE]: 'Arıza bileti aç, başla, çöz, fotoğraf ekle',
  [PERMISSIONS.MAINTENANCE_MANAGE]: 'Arıza atama / iptal, odayı arızaya alma, bakım planı',
  [PERMISSIONS.EMPLOYEES_VIEW]: 'Personel listesini ve kartlarını görüntüle (ücret hariç)',
  [PERMISSIONS.EMPLOYEES_MANAGE]: 'Personel kartı ekle / düzenle, işten çıkış yap',
  [PERMISSIONS.PAYROLL_VIEW]: 'Ücretleri, bordroları, pusulaları ve çıktıları görüntüle',
  [PERMISSIONS.PAYROLL_MANAGE]: 'Ücret, puantaj, ek ödeme / kesinti, avans, icra, teşvik, servis payı; bordro hesapla ve onaya gönder',
  [PERMISSIONS.PAYROLL_PAY]: 'Maaş ve avans öde (kasa / banka)',
  [PERMISSIONS.PAYROLL_SETUP]: 'Bordro ayarları: yasal parametreler ve teyidi, kalem türleri, departmanlar, işyeri bilgileri',
  [PERMISSIONS.GUEST_PORTAL_VIEW]: 'Online check-in\'leri ve belge fotoğraflarını gör, misafir portalı bağlantısını gör',
  [PERMISSIONS.GUEST_PORTAL_MANAGE]: 'Online check-in onayla / düzeltme iste; portal bağlantısı ver, iptal et, davet gönder',
  [PERMISSIONS.GUEST_PORTAL_SETUP]: 'Misafir portalı ayarları: davet ve açılış günleri, belge saklama süresi, metinler',
  [PERMISSIONS.CHANNEL_MANAGER_VIEW]: 'Kanalları, senkron logunu ve kanal rezervasyonlarını görüntüle',
  [PERMISSIONS.CHANNEL_MANAGER_MANAGE]: 'Kanal bağla, eşleştir, stop-sale koy, elle senkronla',
  [PERMISSIONS.ACTORS_VIEW]: 'Aktör panelini görüntüle',
  [PERMISSIONS.ACTORS_MANAGE]: 'Aktörleri aç / kapat',
});

/**
 * Matris ekranında izinlerin gruplandığı başlıklar. Satır=rol, sütun=izin
 * matrisi bu gruplara bölünerek okunur olur.
 */
export const PERMISSION_GROUPS = Object.freeze([
  { key: 'settings', label: 'Ayarlar', permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE] },
  {
    key: 'rooms',
    label: 'Odalar',
    permissions: [PERMISSIONS.ROOMS_VIEW, PERMISSIONS.ROOMS_MANAGE, PERMISSIONS.ROOMS_OPERATE],
  },
  {
    key: 'reservations',
    label: 'Rezervasyonlar',
    permissions: [PERMISSIONS.RESERVATIONS_VIEW, PERMISSIONS.RESERVATIONS_MANAGE, PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE],
  },
  {
    key: 'stays',
    label: 'Giriş / çıkış',
    permissions: [PERMISSIONS.STAYS_VIEW, PERMISSIONS.STAYS_MANAGE, PERMISSIONS.STAYS_OPEN_BALANCE],
  },
  {
    key: 'guest',
    label: 'Misafir iletişimi',
    permissions: [
      PERMISSIONS.MESSAGES_VIEW,
      PERMISSIONS.MESSAGES_REPLY,
      PERMISSIONS.REQUESTS_VIEW,
      PERMISSIONS.REQUESTS_MANAGE,
    ],
  },
  {
    key: 'notifications',
    label: 'Bildirimler',
    permissions: [PERMISSIONS.NOTIFICATIONS_VIEW, PERMISSIONS.NOTIFICATIONS_MANAGE],
  },
  { key: 'approvals', label: 'Onaylar', permissions: [PERMISSIONS.APPROVALS_VIEW, PERMISSIONS.APPROVALS_DECIDE] },
  {
    key: 'admin',
    label: 'Yönetim',
    permissions: [PERMISSIONS.USERS_VIEW, PERMISSIONS.USERS_MANAGE, PERMISSIONS.ROLES_MANAGE],
  },
  { key: 'dashboard', label: 'Günlük durum', permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FORECAST_MANAGE] },
  {
    key: 'folios',
    label: 'Folyo',
    permissions: [PERMISSIONS.FOLIO_VIEW, PERMISSIONS.FOLIO_POST, PERMISSIONS.FOLIO_ADJUST],
  },
  {
    key: 'payments',
    label: 'Ödeme ve kasa',
    permissions: [PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.CASH_VIEW, PERMISSIONS.EXCHANGE_RATES_MANAGE],
  },
  {
    key: 'extras',
    label: 'Minibar ve çamaşır',
    permissions: [PERMISSIONS.EXTRAS_VIEW, PERMISSIONS.MINIBAR_POST, PERMISSIONS.LAUNDRY_POST, PERMISSIONS.EXTRAS_MANAGE],
  },
  {
    key: 'housekeeping',
    label: 'Kat hizmetleri',
    permissions: [
      PERMISSIONS.HOUSEKEEPING_VIEW,
      PERMISSIONS.HOUSEKEEPING_OPERATE,
      PERMISSIONS.HOUSEKEEPING_MANAGE,
      PERMISSIONS.HOUSEKEEPING_INSPECT,
    ],
  },
  {
    key: 'lost_items',
    label: 'Kayıp eşya',
    permissions: [PERMISSIONS.LOST_ITEMS_VIEW, PERMISSIONS.LOST_ITEMS_RECORD, PERMISSIONS.LOST_ITEMS_RELEASE, PERMISSIONS.LOST_ITEMS_MANAGE],
  },
  { key: 'reports', label: 'Raporlar', permissions: [PERMISSIONS.REPORTS_VIEW] },
  { key: 'night_audit', label: 'Gün kapanış', permissions: [PERMISSIONS.NIGHT_AUDIT_VIEW, PERMISSIONS.NIGHT_AUDIT_CLOSE] },
  { key: 'maintenance', label: 'Teknik servis', permissions: [PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.MAINTENANCE_OPERATE, PERMISSIONS.MAINTENANCE_MANAGE] },
  { key: 'budget', label: 'Bütçe', permissions: [PERMISSIONS.BUDGET_VIEW, PERMISSIONS.BUDGET_MANAGE, PERMISSIONS.BUDGET_APPROVE] },
  { key: 'agencies', label: 'Acente ve kontrat', permissions: [PERMISSIONS.AGENCIES_VIEW, PERMISSIONS.AGENCIES_MANAGE] },
  { key: 'promotions', label: 'Promosyon ve kupon', permissions: [PERMISSIONS.PROMOTIONS_VIEW, PERMISSIONS.PROMOTIONS_MANAGE] },
  {
    key: 'banquet',
    label: 'Banket ve etkinlik',
    permissions: [PERMISSIONS.BANQUET_VIEW, PERMISSIONS.BANQUET_MANAGE, PERMISSIONS.BANQUET_SETUP, PERMISSIONS.BANQUET_PAYMENT],
  },
  {
    key: 'pos',
    label: 'Restoran POS ve menü',
    permissions: [PERMISSIONS.POS_OPERATE, PERMISSIONS.POS_SUPERVISE, PERMISSIONS.POS_SETUP, PERMISSIONS.POS_REPORT],
  },
  { key: 'recipes', label: 'Reçete ve maliyet', permissions: [PERMISSIONS.RECIPES_VIEW, PERMISSIONS.RECIPES_MANAGE] },
  {
    key: 'purchasing',
    label: 'Satın alma',
    permissions: [PERMISSIONS.PURCHASING_VIEW, PERMISSIONS.PURCHASING_REQUEST, PERMISSIONS.PURCHASING_MANAGE, PERMISSIONS.PURCHASING_RECEIVE],
  },
  { key: 'stock', label: 'Stok ve depo', permissions: [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_MANAGE] },
  { key: 'accounting', label: 'Ön muhasebe', permissions: [PERMISSIONS.ACCOUNTING_VIEW, PERMISSIONS.ACCOUNTING_MANAGE, PERMISSIONS.ACCOUNTING_SETUP] },
  { key: 'invoices', label: 'Fatura ve e-belge', permissions: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_ISSUE, PERMISSIONS.INVOICES_MANAGE, PERMISSIONS.INVOICES_SETUP] },
  { key: 'employees', label: 'Personel', permissions: [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_MANAGE] },
  { key: 'payroll', label: 'Bordro', permissions: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.PAYROLL_PAY, PERMISSIONS.PAYROLL_SETUP] },
  { key: 'guest_portal', label: 'Misafir portalı ve online check-in', permissions: [PERMISSIONS.GUEST_PORTAL_VIEW, PERMISSIONS.GUEST_PORTAL_MANAGE, PERMISSIONS.GUEST_PORTAL_SETUP] },
  {
    key: 'agency_bonus',
    label: 'Acente primi',
    permissions: [PERMISSIONS.AGENCY_BONUS_VIEW, PERMISSIONS.AGENCY_BONUS_MANAGE, PERMISSIONS.AGENCY_BONUS_PAY],
  },
  {
    key: 'channel_manager',
    label: 'Kanal yönetimi',
    permissions: [PERMISSIONS.CHANNEL_MANAGER_VIEW, PERMISSIONS.CHANNEL_MANAGER_MANAGE],
  },
  { key: 'monitoring', label: 'İzleme', permissions: [PERMISSIONS.ACTIVITY_VIEW, PERMISSIONS.AUDIT_VIEW] },
  { key: 'actors', label: 'Aktörler', permissions: [PERMISSIONS.ACTORS_VIEW, PERMISSIONS.ACTORS_MANAGE] },
]);

/** Roller (Prisma `UserRole` enum'uyla birebir). */
export const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTING', 'FNB']);

/** Rollerin kullanıcıya gösterilen Türkçe adları. */
export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Yönetici',
  MANAGER: 'Müdür',
  FRONT_DESK: 'Ön büro',
  HOUSEKEEPING: 'Kat hizmetleri',
  ACCOUNTING: 'Muhasebe',
  FNB: 'Yiyecek & İçecek',
});

/**
 * Varsayılan rol → izin eşlemesi. Bir otelin `RolePermission` tablosunda hiç
 * satırı yoksa çözüm buna düşer; matris kaydedilince DB kaynak olur.
 *
 * ADMIN listelenmez: kod her zaman ADMIN'e tüm izinleri verir (matris ekranından
 * kilitlenme koruması). Bu tablo diğer roller için başlangıç noktasıdır.
 */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  ADMIN: PERMISSION_VALUES,
  MANAGER: Object.freeze([
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_MANAGE,
    PERMISSIONS.ROOMS_OPERATE,
    PERMISSIONS.RESERVATIONS_VIEW,
    PERMISSIONS.RESERVATIONS_MANAGE,
    PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.STAYS_MANAGE,
    PERMISSIONS.STAYS_OPEN_BALANCE,
    PERMISSIONS.MESSAGES_VIEW,
    PERMISSIONS.MESSAGES_REPLY,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
    PERMISSIONS.APPROVALS_VIEW,
    PERMISSIONS.APPROVALS_DECIDE,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    // Müdür aktörleri görür; açıp kapatmak (otomasyonu durdurmak) yöneticinin kararı.
    PERMISSIONS.ACTORS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    PERMISSIONS.FOLIO_ADJUST,
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.EXCHANGE_RATES_MANAGE,
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    PERMISSIONS.EXTRAS_MANAGE,
    // Kat hizmetinin tüm akışı yöneticide: görev açar, dağıtır, kontrol eder.
    PERMISSIONS.HOUSEKEEPING_VIEW,
    PERMISSIONS.HOUSEKEEPING_OPERATE,
    PERMISSIONS.HOUSEKEEPING_MANAGE,
    PERMISSIONS.HOUSEKEEPING_INSPECT,
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    PERMISSIONS.LOST_ITEMS_RELEASE,
    PERMISSIONS.LOST_ITEMS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.FORECAST_MANAGE,
    // Gün kapanışı (night audit) gece müdürünün / yönetimin işi.
    PERMISSIONS.NIGHT_AUDIT_VIEW,
    PERMISSIONS.NIGHT_AUDIT_CLOSE,
    // Teknik servisin tüm akışı yöneticide: bilet, atama, oda kapatma, bakım planı.
    PERMISSIONS.MAINTENANCE_VIEW,
    PERMISSIONS.MAINTENANCE_OPERATE,
    PERMISSIONS.MAINTENANCE_MANAGE,
    // Bütçeyi müdür onaylar.
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.BUDGET_MANAGE,
    PERMISSIONS.BUDGET_APPROVE,
    // Acente sözleşmesi ve kontrat fiyatı ticari karar: müdürün.
    PERMISSIONS.AGENCIES_VIEW,
    PERMISSIONS.AGENCIES_MANAGE,
    // İndirim kampanyası fiyat kararıdır: müdürün.
    PERMISSIONS.PROMOTIONS_VIEW,
    PERMISSIONS.PROMOTIONS_MANAGE,
    // Hangi kanalda hangi fiyattan satılacağı ticari karar: müdürün.
    PERMISSIONS.CHANNEL_MANAGER_VIEW,
    PERMISSIONS.CHANNEL_MANAGER_MANAGE,
    // Acente hedef primi ticari söz: kuralı ve hak edişi müdür hazırlar; onayı (dört göz) başka
    // bir yetkili verir. Ödeme işaretini muhasebe yapar ama müdür de yapabilir (küçük otel).
    PERMISSIONS.AGENCY_BONUS_VIEW,
    PERMISSIONS.AGENCY_BONUS_MANAGE,
    PERMISSIONS.AGENCY_BONUS_PAY,
    // Satış / banket müdürlüğü: etkinlik satışı, salon ve fiyat tanımları, tahsilat.
    PERMISSIONS.BANQUET_VIEW,
    PERMISSIONS.BANQUET_MANAGE,
    PERMISSIONS.BANQUET_SETUP,
    PERMISSIONS.BANQUET_PAYMENT,
    // F&B müdürlüğü: servis, ikram / indirim / iptal yetkisi, menü ve fiyat, vardiya raporları.
    PERMISSIONS.POS_OPERATE,
    PERMISSIONS.POS_SUPERVISE,
    PERMISSIONS.POS_SETUP,
    PERMISSIONS.POS_REPORT,
    // Reçete ve maliyet F&B müdürlüğünün (şef reçeteyi yazar; matristen F&B'ye açılabilir).
    PERMISSIONS.RECIPES_VIEW,
    PERMISSIONS.RECIPES_MANAGE,
    // Satın alma müdürün: talep, teklif turu, kazanan seçimi, mal kabul; eşik üstü siparişi başka yetkili onaylar.
    PERMISSIONS.PURCHASING_VIEW,
    PERMISSIONS.PURCHASING_REQUEST,
    PERMISSIONS.PURCHASING_MANAGE,
    PERMISSIONS.PURCHASING_RECEIVE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    // Ön muhasebe müdürün de işi (küçük otel); eşik üstü ödeme fişini başka bir yetkili onaylar.
    PERMISSIONS.ACCOUNTING_VIEW,
    PERMISSIONS.ACCOUNTING_MANAGE,
    PERMISSIONS.ACCOUNTING_SETUP,
    // Fatura müdürün: ayarlar ve serbest fatura dahil; iptali başka bir yetkili onaylar.
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.INVOICES_ISSUE,
    PERMISSIONS.INVOICES_MANAGE,
    PERMISSIONS.INVOICES_SETUP,
    // Personel listesini müdür görür; ücret ve bordro muhasebenin (bordronun onayı başka bir yetkilinin).
    PERMISSIONS.EMPLOYEES_VIEW,
    // Misafir portalı ve online check-in (modül 53): ayarlar dahil.
    PERMISSIONS.GUEST_PORTAL_VIEW,
    PERMISSIONS.GUEST_PORTAL_MANAGE,
    PERMISSIONS.GUEST_PORTAL_SETUP,
  ]),
  FRONT_DESK: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    PERMISSIONS.RESERVATIONS_VIEW,
    PERMISSIONS.RESERVATIONS_MANAGE,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.STAYS_MANAGE,
    PERMISSIONS.MESSAGES_VIEW,
    PERMISSIONS.MESSAGES_REPLY,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    // Resepsiyon hesabı görür, harcama işler; indirim ve yeniden açma yönetimde.
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    // Tahsilat ve kendi kasası resepsiyonun işi; iade / iptal isteyebilir (onaylayamaz).
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    // Resepsiyon misafirin çamaşırını alır, çıkışta minibarı sorar.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    // Misafir eşyasını resepsiyona sorar: eşleştirme, iletişim ve teslim resepsiyonda.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    PERMISSIONS.LOST_ITEMS_RELEASE,
    // Resepsiyon odanın temizlik kuyruğunu görür ("104 ne zaman hazır olur?").
    PERMISSIONS.HOUSEKEEPING_VIEW,
    // Resepsiyon salon takvimini görür (bugün balo salonunda ne var) ve depozito alabilir.
    PERMISSIONS.BANQUET_VIEW,
    PERMISSIONS.BANQUET_PAYMENT,
    // Çıkışta folyonun faturasını resepsiyon keser (alıcı bilgisi masada alınır); serbest fatura ve iptal muhasebede.
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.INVOICES_ISSUE,
    // Online check-in'i girişten önce resepsiyon inceler (belgeyi görür, onaylar ya da düzeltme ister); bağlantıyı verir.
    PERMISSIONS.GUEST_PORTAL_VIEW,
    PERMISSIONS.GUEST_PORTAL_MANAGE,
    // Gece vardiyasında günü resepsiyon kapatır (night audit).
    PERMISSIONS.NIGHT_AUDIT_VIEW,
    PERMISSIONS.NIGHT_AUDIT_CLOSE,
    // Resepsiyon arızayı görür ve bilet açar (teknisyene gider).
    PERMISSIONS.MAINTENANCE_VIEW,
    PERMISSIONS.MAINTENANCE_OPERATE,
  ]),
  HOUSEKEEPING: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    // Gidecekler listesi: hangi oda bugün boşalacak (temizlik sırası).
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    // Kat hizmetinin kendi modülü (14): görevli başlatır/bitirir; kat şefi aynı
    // rolde — görev açma, dağıtma ve kontrol varsayılan açık, dört göz kuralı
    // kişinin kendi temizliğini onaylamasını zaten engelliyor. Oteli isterse
    // rol matrisinden şef ve görevliyi ayırır.
    PERMISSIONS.HOUSEKEEPING_VIEW,
    PERMISSIONS.HOUSEKEEPING_OPERATE,
    PERMISSIONS.HOUSEKEEPING_MANAGE,
    PERMISSIONS.HOUSEKEEPING_INSPECT,
    // Minibar sayımı ve çamaşırhane kat hizmetlerinin işi; fiyat listesi yönetimde.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    // Eşyayı en çok oda temizliğinde kat görevlisi bulur; sahibine teslim resepsiyonun işi.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    // Arızayı temizlikte görür ve bilet açar / teknisyense çözer.
    PERMISSIONS.MAINTENANCE_VIEW,
    PERMISSIONS.MAINTENANCE_OPERATE,
  ]),
  ACCOUNTING: Object.freeze([
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.APPROVALS_VIEW,
    // Gelir ve ADR muhasebenin günlük işi.
    PERMISSIONS.DASHBOARD_VIEW,
    // Hesap düzeltmesi, açık bakiye takibi muhasebenin işi.
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    PERMISSIONS.FOLIO_ADJUST,
    // Tahsilat, kasa mutabakatı ve günlük kur muhasebenin işi.
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.EXCHANGE_RATES_MANAGE,
    // Ek hizmet geliri ve fiyat listesi muhasebenin de işi.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.EXTRAS_MANAGE,
    // Gelir raporları muhasebenin aylık işi.
    PERMISSIONS.REPORTS_VIEW,
    // Bütçeyi muhasebe hazırlar ve gerçekleşen giderleri girer; onay müdürün.
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.BUDGET_MANAGE,
    // Acente carisi ve komisyon muhasebenin takibi; kontratı düzenlemez.
    PERMISSIONS.AGENCIES_VIEW,
    // Verilen indirimin geliri ne kadar düşürdüğünü muhasebe izler; promosyonu düzenlemez.
    PERMISSIONS.PROMOTIONS_VIEW,
    // Acente priminin hak edişini muhasebe izler ve ödendi işaretler; kuralı düzenlemez.
    PERMISSIONS.AGENCY_BONUS_VIEW,
    PERMISSIONS.AGENCY_BONUS_PAY,
    // Etkinlik tahsilatı, depozito takibi ve proforma muhasebenin işi; satışı düzenlemez.
    PERMISSIONS.BANQUET_VIEW,
    PERMISSIONS.BANQUET_PAYMENT,
    // Restoran vardiya kasası ve adisyonları muhasebe izler; servis yapmaz.
    PERMISSIONS.POS_REPORT,
    // Maliyet kontrolü: reçete maliyeti ve gıda maliyeti yüzdesini izler; reçeteyi düzenlemez.
    PERMISSIONS.RECIPES_VIEW,
    // Satın alma taleplerini ve siparişleri izler (tedarikçi borcu 47'de); stok değeri muhasebenin işi.
    PERMISSIONS.PURCHASING_VIEW,
    PERMISSIONS.STOCK_VIEW,
    // Cari, kasa, banka, çek / senet ve fişler muhasebenin işi; kasa / banka tanımı, açılış bakiyesi ve fiş iptali müdürün.
    PERMISSIONS.ACCOUNTING_VIEW,
    PERMISSIONS.ACCOUNTING_MANAGE,
    // Faturalar ve e-belge takibi muhasebenin işi; fatura ayarları müdürün.
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.INVOICES_ISSUE,
    PERMISSIONS.INVOICES_MANAGE,
    // Personel ve bordro muhasebenin işi: kart, puantaj, hesap, ödeme; yasal parametre teyidi yöneticinin.
    PERMISSIONS.EMPLOYEES_VIEW,
    PERMISSIONS.EMPLOYEES_MANAGE,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.PAYROLL_PAY,
  ]),
  FNB: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    // Mutfak ve servis etkinlik programını, kişi sayısını ve menü kalemlerini görür.
    PERMISSIONS.BANQUET_VIEW,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    // Restoranda / havuz barında unutulan eşyayı kaydeder.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    // Garson: vardiya, adisyon, sipariş, ödeme, odaya yaz. İkram / indirim / iptal şef garson
    // yetkisidir (`pos.supervise`); otel rol matrisinden F&B'ye açabilir.
    PERMISSIONS.POS_OPERATE,
    // Mutfak reçeteyi okuyarak pişirir, banket malzemesini talep eder. Reçete düzenlemek
    // (`recipes.manage`) müdürde; otel şef için matristen açar.
    PERMISSIONS.RECIPES_VIEW,
    PERMISSIONS.PURCHASING_VIEW,
    PERMISSIONS.PURCHASING_REQUEST,
    // Mutfak / ambar malı teslim alır ve stoğu görür; tedarikçi seçimi ve sipariş müdürde.
    PERMISSIONS.PURCHASING_RECEIVE,
    PERMISSIONS.STOCK_VIEW,
  ]),
});

/**
 * Bir rolün varsayılan izinleri (salt okuma yardımcı). Bilinmeyen rol → boş.
 * @param {string | null | undefined} role
 * @returns {readonly string[]}
 */
export function defaultPermissionsForRole(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}
