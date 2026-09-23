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
 * `details.field` verilirse hata, şema hatalarıyla aynı biçimde (`fields`)
 * döner: form mesajı ilgili alanın altında gösterir.
 */
export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 422, code: 'VALIDATION', details });
    const field = /** @type {{ field?: unknown } | undefined} */ (details)?.field;
    this.fields = typeof field === 'string' ? { [field]: message } : undefined;
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
  WaitlistEntry_date_order: { code: 'CONSTRAINT', message: 'Çıkış tarihi girişten en az bir gece sonra olmalı.' },
  WaitlistEntry_party_valid: { code: 'CONSTRAINT', message: 'En az 1 yetişkin olmalı; çocuk sayısı eksi olamaz.' },
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
