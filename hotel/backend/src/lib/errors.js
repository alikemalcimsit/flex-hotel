/**
 * Servis katmanının fırlattığı tipli hatalar. Route'lar try/catch yazmaz;
 * server.js'deki merkezi error handler bunları HTTP durumuna çevirir.
 *
 * `code` alanı frontend'in dallanması içindir (mesaj metnine bakmak kırılgandır).
 */

export class AppError extends Error {
  /**
   * @param {string} message Kullanıcıya gösterilebilir Türkçe mesaj
   * @param {{ statusCode?: number, code?: string, details?: unknown }} [options]
   */
  constructor(message, { statusCode = 500, code = 'INTERNAL', details } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Kayıt yok (veya soft-delete edilmiş). */
export class NotFoundError extends AppError {
  constructor(message = 'Kayıt bulunamadı', details) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', details });
  }
}

/**
 * Kimlik doğrulanamadı: token yok, geçersiz ya da süresi dolmuş; e-posta/şifre
 * hatalı. Frontend bu kodu görünce oturumu temizleyip giriş ekranına döner.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Oturum açmanız gerekiyor', details) {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED', details });
  }
}

/** Kimlik var ama bu işlem için yetki yok (rolün izni yetmiyor). */
export class ForbiddenError extends AppError {
  constructor(message = 'Bu işlem için yetkiniz yok', details) {
    super(message, { statusCode: 403, code: 'FORBIDDEN', details });
  }
}

/** İş kuralı ihlali: benzersizlik çakışması, çakışan sezon, kullanımdaki kayıt. */
export class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT', details) {
    super(message, { statusCode: 409, code, details });
  }
}

/**
 * Optimistic lock çakışması: kaydı okuduktan sonra başkası değiştirmiş.
 * Frontend bu kodu görünce "kayıt değişti, yenile" der; körü körüne üzerine yazmaz.
 */
export class StaleWriteError extends ConflictError {
  constructor(message = 'Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.') {
    super(message, 'STALE_WRITE');
  }
}

/**
 * Girdi iş kuralına takıldı (zod'un yakalayamadığı semantik doğrulama).
 * `details.field` (tek alan, mesaj hatanın kendisi) ya da `details.fields`
 * (alan → mesaj) verilirse hata, şema hatalarıyla aynı biçimde (`fields`)
 * döner: form mesajı ilgili alanın altında gösterir.
 */
export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 422, code: 'VALIDATION', details });
    const { field, fields } = /** @type {{ field?: unknown, fields?: unknown }} */ (details ?? {});
    if (typeof field === 'string') this.fields = { [field]: message };
    else if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      const entries = Object.entries(fields).filter(([, text]) => typeof text === 'string');
      this.fields = entries.length ? Object.fromEntries(entries) : undefined;
    } else this.fields = undefined;
  }
}

/** Silinmek/değiştirilmek istenen kayıt başka kayıtlarca kullanılıyor. */
export class InUseError extends ConflictError {
  /**
   * @param {string} message
   * @param {Record<string, number>} usage Hangi varlıktan kaç tane bağlı
   */
  constructor(message, usage) {
    super(message, 'IN_USE', { usage });
  }
}

/**
 * Veritabanı kısıtlarının kullanıcıya gösterilecek karşılıkları.
 *
 * Bu kısıtlar son savunma hattı: uygulama kodu aynı kuralları önceden kontrol
 * edip daha zengin mesaj veriyor, ama yarış durumunda ya da uygulama dışından
 * gelen bir yazımda devreye giren bunlar. Kullanıcının "Sunucuda beklenmeyen
 * bir hata" ya da "23P01" görmemesi için her kısıtın burada karşılığı olmalı —
 * yeni migration kısıt ekliyorsa bu tabloya da eklenir.
 *
 * `code` frontend'in ve aktörlerin dallanması için: otomatik atama, odası
 * yarışta kapılan rezervasyonu `ROOM_NOT_FREE` görünce sıradaki odayı dener.
 */
const CONSTRAINT_RULES = Object.freeze({
  Season_no_overlap: {
    code: 'CONSTRAINT',
    message: 'Bu tarih aralığı mevcut bir sezonla çakışıyor. Aynı güne iki sezon çarpanı düşemez.',
  },
  Season_date_order: { code: 'CONSTRAINT', message: 'Sezon bitiş tarihi başlangıç tarihinden önce olamaz.' },
  Hotel_cancellation_policy_coherent: {
    code: 'CONSTRAINT',
    message: 'İptal politikası ya tamamen kapalı olmalı ya da hem gün hem ceza oranı dolu olmalı.',
  },
  RoomType_hotelId_code_active_key: { code: 'DUPLICATE', message: 'Bu kodlu bir oda tipi zaten var.' },
  Room_hotelId_number_active_key: { code: 'DUPLICATE', message: 'Bu numaralı bir oda zaten var.' },
  Reservation_no_double_booking: {
    code: 'ROOM_NOT_FREE',
    message: 'Bu oda seçilen gecelerde başka bir rezervasyona ait. Aynı oda aynı geceye iki misafire verilemez.',
  },
  Reservation_date_order: { code: 'CONSTRAINT', message: 'Çıkış tarihi girişten en az bir gece sonra olmalı.' },
  Reservation_room_blocked: {
    code: 'ROOM_NOT_FREE',
    message: 'Oda bu tarihlerde arızalı veya hizmet dışı; misafir atanamaz.',
  },
  RoomBlock_no_overlap: {
    code: 'BLOCK_OVERLAP',
    message: 'Bu oda için bu tarihlerle çakışan başka bir arıza kaydı var. Mevcut kaydı bitirip yenisini açın.',
  },
  RoomBlock_date_order: { code: 'CONSTRAINT', message: 'Arıza kaydının bitişi başlangıcından sonra olmalı.' },
  RoomBlock_day_precision: { code: 'CONSTRAINT', message: 'Arıza kaydı tarihleri gün hassasiyetinde olmalı.' },
  RoomBlock_has_reservations: {
    code: 'HAS_RESERVATIONS',
    message: 'Bu tarihlerde odada rezervasyon var; arıza kaydı açılamaz. Önce misafiri başka odaya taşıyın.',
  },
  Reservation_room_since_valid: {
    code: 'CONSTRAINT',
    message: 'Oda değişikliği tarihi konaklamanın içinde olmalı; çıkış tarihi taşıma gününden önceye çekilemez.',
  },
  RoomStaySegment_no_overlap: {
    code: 'ROOM_NOT_FREE',
    message: 'Bu odanın geçmişinde aynı gecelere yazılmış başka bir konaklama var.',
  },
  RoomStaySegment_date_order: { code: 'CONSTRAINT', message: 'Oda geçmişi diliminin bitişi başlangıcından sonra olmalı.' },
  RoomStaySegment_day_precision: { code: 'CONSTRAINT', message: 'Oda geçmişi tarihleri gün hassasiyetinde olmalı.' },

  Message_conversation_external_unique: {
    code: 'DUPLICATE_MESSAGE',
    message: 'Bu kanal mesajı zaten kayıtlı.',
  },
  Message_internal_note_valid: { code: 'CONSTRAINT', message: 'İç not yalnızca personel tarafından yazılabilir.' },
  Message_delivery_matches_direction: {
    code: 'CONSTRAINT',
    message: 'Mesajın teslim durumu yönüyle uyuşmuyor (gelen mesaj gönderilemez).',
  },
  Conversation_unread_non_negative: { code: 'CONSTRAINT', message: 'Okunmamış mesaj sayısı eksi olamaz.' },
  Conversation_state_version_non_negative: { code: 'CONSTRAINT', message: 'Konuşma sürümü geçersiz.' },
  Conversation_closed_has_time: { code: 'CONSTRAINT', message: 'Kapalı konuşmanın kapanış zamanı olmalı.' },

  Hotel_phone_country_code_valid: {
    code: 'CONSTRAINT',
    message: 'Telefon ülke kodu 1-3 rakam olmalı ve 0 ile başlamamalı.',
  },
  Notification_dedupe_unique: {
    code: 'DUPLICATE_NOTIFICATION',
    message: 'Bu olay için bildirim zaten sıraya alınmış.',
  },
  Notification_recipient_present: { code: 'CONSTRAINT', message: 'Bildirimin alıcısı boş olamaz.' },
  Notification_body_present: { code: 'CONSTRAINT', message: 'Bildirim metni boş olamaz.' },
  Notification_attempts_non_negative: { code: 'CONSTRAINT', message: 'Deneme sayısı eksi olamaz.' },
  Notification_language_valid: { code: 'CONSTRAINT', message: 'Bildirim dili iki harfli kod olmalı.' },
  Notification_sending_locked: { code: 'CONSTRAINT', message: 'Gönderilen bildirimin üstlenilme zamanı olmalı.' },
  Notification_sent_has_time: { code: 'CONSTRAINT', message: 'Gönderilen bildirimin gönderim zamanı olmalı.' },
  Notification_delivered_has_time: { code: 'CONSTRAINT', message: 'İletilen bildirimin iletim zamanı olmalı.' },
  Notification_failed_has_time: { code: 'CONSTRAINT', message: 'Başarısız bildirimin hata zamanı olmalı.' },
  Notification_cancelled_has_reason: { code: 'CONSTRAINT', message: 'Gönderilmeyen bildirimin sebebi yazılmalı.' },
  NotificationTemplate_active_unique: {
    code: 'DUPLICATE',
    message: 'Bu olay, kanal ve dil için şablon zaten var.',
  },
  NotificationTemplate_body_present: { code: 'CONSTRAINT', message: 'Şablon metni boş olamaz.' },
  NotificationTemplate_language_valid: { code: 'CONSTRAINT', message: 'Şablon dili iki harfli kod olmalı.' },
  NotificationChannelConfig_active_unique: { code: 'DUPLICATE', message: 'Bu kanalın ayarı zaten var.' },
  StaffAlert_has_audience: { code: 'CONSTRAINT', message: 'Uyarının bir alıcısı (kişi ya da izin) olmalı.' },
  StaffAlert_title_present: { code: 'CONSTRAINT', message: 'Uyarı başlığı boş olamaz.' },
  StaffAlert_count_positive: { code: 'CONSTRAINT', message: 'Uyarı sayısı en az 1 olmalı.' },
  GuestRequest_title_present: { code: 'CONSTRAINT', message: 'İsteğin başlığı boş olamaz.' },
  GuestRequest_done_has_completion: {
    code: 'CONSTRAINT',
    message: 'Tamamlanan isteğin tamamlanma zamanı olmalı.',
  },
  GuestRequest_cancel_has_reason: { code: 'CONSTRAINT', message: 'İptal edilen isteğin sebebi yazılmalı.' },
  GuestRequest_wake_up_scheduled: { code: 'CONSTRAINT', message: 'Uyandırma isteğinin saati olmalı.' },

  Reservation_party_valid: { code: 'CONSTRAINT', message: 'Rezervasyonda en az 1 yetişkin olmalı; çocuk sayısı eksi olamaz.' },
  Reservation_price_valid: { code: 'CONSTRAINT', message: 'Rezervasyon fiyatı eksi olamaz.' },
  Reservation_fees_valid: { code: 'CONSTRAINT', message: 'İptal / gelmedi ücreti eksi olamaz.' },
  Reservation_manual_price_has_note: { code: 'CONSTRAINT', message: 'Elle girilen fiyatın gerekçesi yazılmalı.' },
  Reservation_stay_times_valid: {
    code: 'CONSTRAINT',
    message: 'İçerideki misafirin giriş, çıkmış misafirin giriş ve çıkış zamanı kayıtlı olmalı.',
  },
  Reservation_stay_fees_valid: { code: 'CONSTRAINT', message: 'Erken giriş / geç çıkış ücreti eksi olamaz.' },
  Reservation_deposit_valid: {
    code: 'CONSTRAINT',
    message: 'Teminat türü seçildiyse tutarı sıfırdan büyük olmalı; teminat yoksa tutar girilmez.',
  },
  Reservation_open_balance_has_reason: {
    code: 'CONSTRAINT',
    message: 'Bakiyesi kapanmadan yapılan çıkışın gerekçesi yazılmalı.',
  },
  MessagingChannel_externalAccountId_key: {
    code: 'DUPLICATE',
    message: 'Bu WhatsApp telefon numarası kimliği başka bir otele bağlı.',
  },
  MessagingChannel_publicKey_key: { code: 'DUPLICATE', message: 'Balon anahtarı çakıştı; tekrar deneyin.' },
  MessagingChannel_whatsapp_complete: {
    code: 'CONSTRAINT',
    message: 'WhatsApp kanalını açmak için telefon numarası kimliği ve anahtarlar gerekli.',
  },
  AiSettings_models_when_enabled: { code: 'CONSTRAINT', message: 'AI açıkken iki model de seçilmeli.' },
  AiSettings_budget_valid: { code: 'CONSTRAINT', message: 'Günlük AI bütçesi eksi olamaz.' },
  Hotel_stay_fees_valid: {
    code: 'CONSTRAINT',
    message: 'Erken giriş / geç çıkış ücreti eksi olamaz; yüzde seçildiyse 100 değerini geçemez.',
  },
  Reservation_hotelId_requestId_key: {
    code: 'DUPLICATE_REQUEST',
    message: 'Bu istek zaten işlendi; aynı rezervasyon ikinci kez açılmaz.',
  },
  ReservationNight_day_precision: { code: 'CONSTRAINT', message: 'Gece fiyatı gün hassasiyetinde olmalı.' },
  ReservationNight_amount_valid: { code: 'CONSTRAINT', message: 'Gece fiyatı eksi olamaz.' },
  Agency_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu koda sahip bir acente zaten var.' },
  Agency_hotelId_name_key: { code: 'DUPLICATE', message: 'Bu adla bir acente zaten kayıtlı.' },
  Agency_code_format: { code: 'CONSTRAINT', message: 'Acente kodu harf, rakam, nokta, tire ve alt çizgiden oluşmalı (en fazla 20 karakter).' },
  Agency_name_not_blank: { code: 'CONSTRAINT', message: 'Acente adı en az 2 karakter olmalı.' },
  Agency_commission_range: { code: 'CONSTRAINT', message: 'Komisyon yüzdesi 0 ile 100 arasında olmalı.' },
  Agency_term_range: { code: 'CONSTRAINT', message: 'Vade 0 ile 365 gün arasında olmalı.' },
  Contract_period_valid: { code: 'CONSTRAINT', message: 'Kontrat bitişi başlangıcından önce olamaz ve en fazla 1100 gün sürebilir.' },
  Contract_currency_code: { code: 'CONSTRAINT', message: 'Kontrat para birimi üç harfli kod olmalı.' },
  Contract_name_not_blank: { code: 'CONSTRAINT', message: 'Kontrat adı en az 2 karakter olmalı.' },
  Contract_status_trail: { code: 'CONSTRAINT', message: 'Kontratın durumu ile satışa açma / sonlandırma kaydı uyuşmuyor.' },
  Contract_one_active_per_day: {
    code: 'CONTRACT_OVERLAP',
    message: 'Bu acentenin bu tarihleri kapsayan, satışta başka bir kontratı var. Önce onu sonlandırın ya da tarihleri değiştirin.',
  },
  ContractRate_price_valid: { code: 'CONSTRAINT', message: 'Kontrat fiyatı sıfırdan büyük olmalı.' },
  ContractRate_period_valid: { code: 'CONSTRAINT', message: 'Fiyat döneminin bitişi başlangıcından önce olamaz.' },
  ContractRate_no_overlap: {
    code: 'RATE_OVERLAP',
    message: 'Aynı oda tipi ve pansiyon için fiyat dönemleri çakışıyor.',
  },
  ContractStopSale_period_valid: { code: 'CONSTRAINT', message: 'Stop-sale bitişi başlangıcından önce olamaz.' },
  ContractStopSale_reason_length: { code: 'CONSTRAINT', message: 'Stop-sale sebebi en fazla 200 karakter olabilir.' },
  ContractStopSale_no_overlap: {
    code: 'STOP_SALE_OVERLAP',
    message: 'Bu tarihlerde aynı kapsamda başka bir stop-sale zaten var.',
  },
  Reservation_agency_commission: { code: 'CONSTRAINT', message: 'Acenteli rezervasyonun komisyon oranı kayıtlı olmalı (0–100).' },
  Promotion_hotelId_name_key: { code: 'DUPLICATE', message: 'Bu adla bir promosyon zaten var.' },
  Promotion_name_not_blank: { code: 'CONSTRAINT', message: 'Promosyon adı en az 2 karakter olmalı.' },
  Promotion_discount_valid: {
    code: 'CONSTRAINT',
    message: 'İndirim tipiyle değerler uyuşmuyor (yüzde 0–100, tutar sıfırdan büyük, "X kal Y öde"de Y < X).',
  },
  Promotion_book_window_valid: { code: 'CONSTRAINT', message: 'Rezervasyon döneminin bitişi başlangıcından önce olamaz (en fazla 1100 gün).' },
  Promotion_stay_window_valid: { code: 'CONSTRAINT', message: 'Konaklama döneminin bitişi başlangıcından önce olamaz (en fazla 1100 gün).' },
  Promotion_nights_valid: { code: 'CONSTRAINT', message: 'En fazla gece, en az geceden küçük olamaz.' },
  Promotion_lead_valid: { code: 'CONSTRAINT', message: 'Son dakika günü, erken rezervasyon gününden küçük olamaz.' },
  Promotion_sources_valid: { code: 'CONSTRAINT', message: 'En az bir satış kanalı seçilmeli; acente seçilemez.' },
  Promotion_status_trail: { code: 'CONSTRAINT', message: 'Taslak promosyonun yayın kaydı olamaz.' },
  Coupon_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu kupon kodu zaten kullanılıyor.' },
  Coupon_code_format: { code: 'CONSTRAINT', message: 'Kupon kodu büyük harf, rakam ve tireden oluşmalı (4–30 karakter).' },
  Coupon_max_uses_valid: { code: 'CONSTRAINT', message: 'Kupon kullanım sayısı en az 1 olmalı.' },
  Reservation_coupon_needs_promotion: { code: 'CONSTRAINT', message: 'Kupon, promosyonu olmadan rezervasyona bağlanamaz.' },
  Reservation_promotion_terms: { code: 'CONSTRAINT', message: 'Promosyonlu rezervasyonun promosyon kopyası kayıtlı olmalı.' },
  Reservation_discount_valid: { code: 'CONSTRAINT', message: 'İndirim yalnızca promosyonla doğar ve eksi olamaz.' },
  Reservation_promotion_not_agency: { code: 'CONSTRAINT', message: 'Acente satışına promosyon uygulanmaz.' },
  Reservation_promotion_calculated: { code: 'CONSTRAINT', message: 'Elle fiyat girilen rezervasyona promosyon uygulanmaz.' },
  ReservationNight_discount_valid: { code: 'CONSTRAINT', message: 'Gece indirimi eksi olamaz.' },
  Channel_hotelId_name_active_key: { code: 'DUPLICATE', message: 'Bu adla bir kanal zaten var.' },
  Channel_channex_property_key: { code: 'DUPLICATE', message: 'Bu Channex mülkü başka bir kanala bağlı (bir mülk tek kanala bağlanır).' },
  Channel_type_fields: { code: 'CONSTRAINT', message: 'Kanal türüyle ayarları uyuşmuyor (Channex: ortam, mülk, anahtar; iCal: takvimin geldiği yer).' },
  Channel_name_not_blank: { code: 'CONSTRAINT', message: 'Kanal adı en az 2 karakter olmalı.' },
  Channel_markup_range: { code: 'CONSTRAINT', message: 'Kanal fiyat farkı %-50 ile %100 arasında olmalı.' },
  Channel_horizon_range: { code: 'CONSTRAINT', message: 'Kanala gönderilecek gün sayısı 30 ile 730 arasında olmalı.' },
  ChannelState_dirty_window: { code: 'CONSTRAINT', message: 'Kanalın gönderim penceresi tutarsız.' },
  ChannelState_failure_count: { code: 'CONSTRAINT', message: 'Kanalın hata sayacı eksi olamaz.' },
  Channel_status_trail: { code: 'CONSTRAINT', message: 'Senkrondaki kanalın senkrona alınma kaydı olmalı.' },
  ChannelRoomMapping_channelId_roomTypeId_key: { code: 'DUPLICATE', message: 'Bu oda tipi bu kanalda zaten eşleşmiş.' },
  ChannelRoomMapping_channelId_externalRoomTypeId_key: { code: 'DUPLICATE', message: 'Bu kanal oda tipi başka bir oda tipiyle eşleşmiş.' },
  ChannelRateMapping_channelId_externalRatePlanId_key: { code: 'DUPLICATE', message: 'Bu kanal fiyat planı başka bir satırda eşleşmiş.' },
  ChannelStopSale_period: { code: 'CONSTRAINT', message: 'Stop-sale bitişi başlangıcından önce olamaz.' },
  ChannelBooking_room_count: { code: 'CONSTRAINT', message: 'Kanal rezervasyonunda en az bir oda olmalı.' },
  ChannelBooking_amount: { code: 'CONSTRAINT', message: 'Kanal rezervasyonunun tutarı eksi olamaz.' },
  ChannelBooking_stay: { code: 'CONSTRAINT', message: 'Kanal rezervasyonunun çıkışı girişten sonra olmalı.' },
  ChannelBooking_resolution: { code: 'CONSTRAINT', message: 'Kapatılan kanal rezervasyonunun kimin kapattığı ve notu kayıtlı olmalı.' },
  ChannelBookingRevision_channelId_externalRevisionId_key: { code: 'DUPLICATE', message: 'Bu kanal revizyonu zaten alınmış.' },
  Reservation_channel_room: { code: 'CONSTRAINT', message: 'Kanal rezervasyonuna bağlı rezervasyonun oda sırası olmalı.' },
  WaitlistEntry_date_order: { code: 'CONSTRAINT', message: 'Çıkış tarihi girişten en az bir gece sonra olmalı.' },
  WaitlistEntry_party_valid: { code: 'CONSTRAINT', message: 'En az 1 yetişkin olmalı; çocuk sayısı eksi olamaz.' },
  AgencyBonusRule_name_not_blank: { code: 'CONSTRAINT', message: 'Kural adı en az 2 karakter olmalı.' },
  AgencyBonusRule_period_valid: { code: 'CONSTRAINT', message: 'Kural dönemi bitişi başlangıcından önce olamaz ve en fazla 731 gün sürebilir.' },
  AgencyBonusRule_target_valid: { code: 'CONSTRAINT', message: 'Hedef 0\'dan büyük olmalı; gece hedefi tam sayıdır.' },
  AgencyBonusRule_tiers_shape: { code: 'CONSTRAINT', message: 'Kuralın 1 ile 10 arasında kademesi olmalı.' },
  AgencyBonusRule_room_types: { code: 'CONSTRAINT', message: 'Oda tipi süzgecinde en fazla 100 oda tipi olabilir.' },
  AgencyBonusRule_max_bonus: { code: 'CONSTRAINT', message: 'Prim tavanı 0\'dan büyük olmalı (tavansız için boş bırakın).' },
  AgencyBonusRule_currency_code: { code: 'CONSTRAINT', message: 'Kuralın para birimi üç harfli kod olmalı.' },
  AgencyBonusRule_progress_valid: { code: 'CONSTRAINT', message: 'Kuralın ilerleme özeti tutarsız.' },
  AgencyBonusRule_status_trail: { code: 'CONSTRAINT', message: 'Kuralın durumu ile yürürlük / iptal kaydı uyuşmuyor.' },
  AgencyBonusRule_one_active_nights: {
    code: 'BONUS_RULE_OVERLAP',
    message: 'Bu acentenin bu dönemle çakışan, gece ölçütlü yürürlükte başka bir prim kuralı var. Aynı üretime aynı türden iki prim verilemez.',
  },
  AgencyBonusRule_one_active_revenue: {
    code: 'BONUS_RULE_OVERLAP',
    message: 'Bu acentenin bu dönemle çakışan, ciro ölçütlü yürürlükte başka bir prim kuralı var. Aynı üretime aynı türden iki prim verilemez.',
  },
  AgencyBonus_ruleId_key: { code: 'DUPLICATE', message: 'Bu kuralın hak edişi az önce başka bir işlemle hesaplandı; sayfayı yenileyin.' },
  AgencyBonus_period_valid: { code: 'CONSTRAINT', message: 'Hak ediş dönemi tutarsız.' },
  AgencyBonus_figures_valid: { code: 'CONSTRAINT', message: 'Hak ediş rakamları eksi olamaz.' },
  AgencyBonus_amount_valid: { code: 'CONSTRAINT', message: 'Hak ediş tutarı tutarsız (tavan / brüt prim).' },
  AgencyBonus_room_types: { code: 'CONSTRAINT', message: 'Hak edişin oda tipi süzgeci boş olamaz.' },
  AgencyBonus_currency_code: { code: 'CONSTRAINT', message: 'Hak edişin para birimi üç harfli kod olmalı.' },
  AgencyBonus_status_trail: { code: 'CONSTRAINT', message: 'Hak edişin durumu ile onay / ödeme kaydı uyuşmuyor.' },
  AgencyBonusLine_nights_valid: { code: 'CONSTRAINT', message: 'Hak ediş satırının gecesi eksi olamaz.' },
  Venue_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu kodlu bir salon zaten var.' },
  Venue_name_not_blank: { code: 'CONSTRAINT', message: 'Salon adı en az 2 karakter olmalı.' },
  Venue_rates_valid: { code: 'CONSTRAINT', message: 'Salon fiyatları ve alanı (girildiyse) 0\'dan büyük olmalı.' },
  Venue_buffers_valid: { code: 'CONSTRAINT', message: 'Kurulum / söküm süresi 0–720 dakika olmalı.' },
  Venue_not_own_part: { code: 'CONSTRAINT', message: 'Salon kendisinin parçası olamaz.' },
  VenueCapacity_valid: { code: 'CONSTRAINT', message: 'Kapasite 1–10.000 arası olmalı.' },
  VenueCapacity_venueId_layout_key: { code: 'DUPLICATE', message: 'Bu düzenin kapasitesi zaten yazılmış.' },
  EventEquipment_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu kodlu bir ekipman zaten var.' },
  EventEquipment_valid: { code: 'CONSTRAINT', message: 'Ekipman fiyatı eksi olamaz, stok 0–10.000 olmalı.' },
  EventClient_name_not_blank: { code: 'CONSTRAINT', message: 'Müşteri adı en az 2 karakter olmalı.' },
  EventSettings_valid: { code: 'CONSTRAINT', message: 'Banket politikası değerleri sınır dışında.' },
  EventSequence_valid: { code: 'CONSTRAINT', message: 'Belge numara serisi tutarsız.' },
  Event_hotelId_code_key: { code: 'DUPLICATE', message: 'Etkinlik numarası çakıştı; tekrar deneyin.' },
  Event_name_not_blank: { code: 'CONSTRAINT', message: 'Etkinlik adı en az 2 karakter olmalı.' },
  Event_pax_valid: { code: 'CONSTRAINT', message: 'Kişi sayıları 1–10.000 arası olmalı.' },
  Event_totals_valid: { code: 'CONSTRAINT', message: 'Etkinlik tutarları tutarsız.' },
  Event_span_valid: { code: 'CONSTRAINT', message: 'Etkinliğin tarih aralığı tutarsız.' },
  Event_currency_code: { code: 'CONSTRAINT', message: 'Etkinlik para birimi üç harfli kod olmalı.' },
  Event_status_trail: { code: 'CONSTRAINT', message: 'Etkinliğin durumu ile opsiyon / kesin / iptal kaydı uyuşmuyor.' },
  EventSession_time_valid: { code: 'CONSTRAINT', message: 'Oturumun bitişi başlangıçtan sonra olmalı ve en fazla 72 saat sürebilir.' },
  EventSession_pax_valid: { code: 'CONSTRAINT', message: 'Oturum kişi sayısı 1–10.000 arası olmalı.' },
  EventSession_buffers_valid: { code: 'CONSTRAINT', message: 'Kurulum / söküm süresi 0–720 dakika olmalı.' },
  EventSession_title_not_blank: { code: 'CONSTRAINT', message: 'Oturum adı en az 2 karakter olmalı.' },
  EventVenueHold_time_valid: { code: 'CONSTRAINT', message: 'Salon tutma aralığı tutarsız.' },
  EventVenueHold_no_double_definite: {
    code: 'VENUE_TAKEN',
    message: 'Salon bu saatlerde başka bir kesin etkinliğe ait (kurulum ve söküm dahil). Aynı salon aynı saatte iki etkinliğe kesin verilemez.',
  },
  EventItem_amounts_valid: { code: 'CONSTRAINT', message: 'Kalem tutarları tutarsız.' },
  EventItem_equipment_valid: { code: 'CONSTRAINT', message: 'Ekipman kalemi bir oturuma bağlı olmalı ve adedi tam sayı olmalı.' },
  EventItem_per_person_unit: { code: 'CONSTRAINT', message: 'Kişi başı kalemin birimi kişi olmalı.' },
  EventInstallment_valid: { code: 'CONSTRAINT', message: 'Taksit tutarı 0\'dan büyük olmalı.' },
  EventPayment_amount_sign: { code: 'CONSTRAINT', message: 'Ödeme tutarının işareti türüyle uyuşmuyor.' },
  EventPayment_currency_code: { code: 'CONSTRAINT', message: 'Ödeme para birimi üç harfli kod olmalı.' },
  EventPayment_status_trail: { code: 'CONSTRAINT', message: 'Ödemenin durumu ile onay kaydı uyuşmuyor.' },
  EventPayment_method_valid: { code: 'CONSTRAINT', message: 'Etkinlikte bu ödeme yöntemi kullanılamaz.' },
  EventPayment_hotelId_sourceKey_key: { code: 'DUPLICATE', message: 'Bu ödeme isteği zaten işlendi.' },
  EventDocument_valid: { code: 'CONSTRAINT', message: 'Belge kaydı tutarsız.' },
  EventDocument_status_by_kind: { code: 'CONSTRAINT', message: 'Belge türü bu durumu alamaz.' },
  EventDocument_decision_trail: { code: 'CONSTRAINT', message: 'Belgenin kabul / imza kaydı eksik.' },
  EventDocument_one_current_per_kind: { code: 'DOCUMENT_RACE', message: 'Bu türden belge az önce başka bir işlemle üretildi; sayfayı yenileyin.' },
  PosOutlet_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu kodlu bir satış noktası zaten var.' },
  PosOutlet_name_not_blank: { code: 'CONSTRAINT', message: 'Satış noktası adı en az 2 karakter olmalı.' },
  PosTable_outletId_name_key: { code: 'DUPLICATE', message: 'Bu satış noktasında aynı adlı bir masa zaten var.' },
  PosTable_valid: { code: 'CONSTRAINT', message: 'Masa adı boş olamaz, kişi 1–50 arası olmalı.' },
  MenuCategory_hotelId_name_key: { code: 'DUPLICATE', message: 'Bu adla bir menü grubu zaten var.' },
  MenuCategory_name_not_blank: { code: 'CONSTRAINT', message: 'Menü grubu adı en az 2 karakter olmalı.' },
  MenuItem_hotelId_code_key: { code: 'DUPLICATE', message: 'Bu kodlu bir ürün zaten var.' },
  MenuItem_categoryId_name_key: { code: 'DUPLICATE', message: 'Bu grupta aynı adlı bir ürün zaten var.' },
  MenuItem_valid: { code: 'CONSTRAINT', message: 'Ürün adı en az 2 karakter, fiyatı 0\'dan büyük olmalı.' },
  PosSettings_valid: { code: 'CONSTRAINT', message: 'POS politikası tutarları eksi olamaz.' },
  PosSequence_valid: { code: 'CONSTRAINT', message: 'Adisyon numara serisi tutarsız.' },
  PosShift_valid: { code: 'CONSTRAINT', message: 'Kasa avansı / sayım eksi olamaz.' },
  PosShift_status_trail: { code: 'CONSTRAINT', message: 'Vardiyanın durumu ile kapanış kaydı uyuşmuyor.' },
  PosShift_one_open_per_waiter: { code: 'SHIFT_OPEN', message: 'Bu garsonun zaten açık bir vardiyası var.' },
  PosCheck_hotelId_number_key: { code: 'DUPLICATE', message: 'Adisyon numarası çakıştı; tekrar deneyin.' },
  PosCheck_covers_valid: { code: 'CONSTRAINT', message: 'Kişi sayısı 1–200 arası olmalı.' },
  PosCheck_totals_valid: { code: 'CONSTRAINT', message: 'Adisyon tutarları tutarsız.' },
  PosCheck_status_trail: { code: 'CONSTRAINT', message: 'Adisyonun durumu ile kapanış / ödeme kaydı uyuşmuyor.' },
  PosOrderLine_valid: { code: 'CONSTRAINT', message: 'Kalem adedi 1–99 olmalı; iptal ve ikram adedi kalemi aşamaz.' },
  PosAdjustment_shape: { code: 'CONSTRAINT', message: 'Düzeltme kaydı türüyle uyuşmuyor.' },
  PosAdjustment_status_trail: { code: 'CONSTRAINT', message: 'Düzeltmenin durumu ile onay kaydı uyuşmuyor.' },
  PosPayment_amount_sign: { code: 'CONSTRAINT', message: 'Ödeme tutarının işareti türüyle uyuşmuyor.' },
  PosPayment_method_valid: { code: 'CONSTRAINT', message: 'POS\'ta yalnızca nakit ya da kart alınır.' },
  PosPayment_status_trail: { code: 'CONSTRAINT', message: 'Ödemenin durumu ile onay kaydı uyuşmuyor.' },
  PosPayment_hotelId_sourceKey_key: { code: 'DUPLICATE', message: 'Bu ödeme isteği zaten işlendi.' },
  PosRoomCharge_valid: { code: 'CONSTRAINT', message: 'Odaya yazılan tutar 0\'dan büyük olmalı.' },
});

/**
 * Hata metninde/meta'sında geçen kısıt adını bulur.
 * @param {unknown} error
 * @returns {string | undefined}
 */
function findConstraintName(error) {
  const meta = /** @type {{ meta?: { constraint?: string | string[] }, message?: string }} */ (error);
  const fromMeta = Array.isArray(meta?.meta?.constraint) ? meta.meta.constraint[0] : meta?.meta?.constraint;
  if (fromMeta && Object.hasOwn(CONSTRAINT_RULES, fromMeta)) return fromMeta;

  // Prisma, CHECK/EXCLUDE/tetikleyici ihlallerini tipli bir koda çevirmiyor;
  // kısıt adı yalnızca ham mesajda geçiyor.
  const message = typeof meta?.message === 'string' ? meta.message : '';
  return Object.keys(CONSTRAINT_RULES).find((name) => message.includes(name));
}

/**
 * Veritabanı o an yoğun: havuzda boş bağlantı yok ya da transaction zamanında
 * başlatılamadı. Kullanıcıya "beklenmeyen hata" değil "birazdan tekrar deneyin"
 * denir (503); istemci kısa bir beklemeyle yeniden dener.
 */
export class BusyError extends AppError {
  constructor(message = 'Sistem şu an çok yoğun. Lütfen birkaç saniye sonra tekrar deneyin.') {
    super(message, { statusCode: 503, code: 'BUSY' });
    this.retryAfterSeconds = 2;
  }
}

/** Prisma: havuzdan bağlantı alınamadı / transaction başlatılamadı ya da süresi doldu. */
const BUSY_PRISMA_CODES = new Set(['P2024', 'P2028']);

/** PostgreSQL: kilitlenme ve serileştirme çatışması — işlemi baştan yapmak düzeltir. */
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);

/**
 * Tekrar denenince düzelecek bir çakışma mı (deadlock, yazma çatışması)?
 * İşin tamamı geri alındığı için transaction baştan çalıştırılabilir.
 *
 * @param {unknown} error
 */
export function isRetryableTransactionError(error) {
  const known = /** @type {{ code?: string, meta?: { code?: string }, message?: string }} */ (error);
  if (known?.code === 'P2034') return true;
  if (known?.code === 'P2010' && RETRYABLE_PG_CODES.has(String(known.meta?.code ?? ''))) return true;
  const message = typeof known?.message === 'string' ? known.message : '';
  return /deadlock detected|could not serialize access/i.test(message);
}

/**
 * Havuz/transaction zaman aşımını 503'e çevirir; değilse `null`.
 * @param {unknown} error
 * @returns {BusyError | null}
 */
export function asBusyError(error) {
  if (error instanceof BusyError) return error;
  const code = /** @type {{ code?: string }} */ (error)?.code;
  if (code && BUSY_PRISMA_CODES.has(code)) return new BusyError();
  return null;
}

/**
 * Prisma/PostgreSQL hatalarını bizim hata tiplerimize çevirir.
 * Yarış durumunda (aynı kodla iki eşzamanlı ekleme) P2002 buradan 409 olur.
 *
 * Zaten bizim tipimizde olan hata (servisin kendi fırlattığı ConflictError
 * gibi) dokunulmadan geri fırlatılır.
 *
 * @param {unknown} error
 * @param {{ uniqueMessage?: string }} [options]
 * @returns {never}
 */
export function rethrowPrismaError(error, { uniqueMessage = 'Bu kayıt zaten mevcut' } = {}) {
  if (error instanceof AppError) throw error;
  const busy = asBusyError(error);
  if (busy) throw busy;

  const constraint = findConstraintName(error);
  if (constraint) {
    const rule = CONSTRAINT_RULES[constraint];
    throw new ConflictError(rule.message, rule.code, { constraint });
  }

  const code = /** @type {{ code?: string, meta?: { target?: string[] } }} */ (error)?.code;
  if (code === 'P2002') {
    throw new ConflictError(uniqueMessage, 'DUPLICATE', {
      fields: /** @type {{ meta?: { target?: string[] } }} */ (error).meta?.target,
    });
  }
  if (code === 'P2025') {
    throw new NotFoundError();
  }
  throw error;
}
