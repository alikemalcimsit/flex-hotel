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

/** Girdi iş kuralına takıldı (zod'un yakalayamadığı semantik doğrulama). */
export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 422, code: 'VALIDATION', details });
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
 * gelen bir yazımda devreye giren bunlar. Kullanıcının "23P01" görmemesi için
 * burada karşılıkları var.
 */
const CONSTRAINT_MESSAGES = Object.freeze({
  Season_no_overlap: 'Bu tarih aralığı mevcut bir sezonla çakışıyor. Aynı güne iki sezon çarpanı düşemez.',
  Season_date_order: 'Sezon bitiş tarihi başlangıç tarihinden önce olamaz.',
  Hotel_cancellation_policy_coherent:
    'İptal politikası ya tamamen kapalı olmalı ya da hem gün hem ceza oranı dolu olmalı.',
  RoomType_hotelId_code_active_key: 'Bu kodlu bir oda tipi zaten var.',
  Room_hotelId_number_active_key: 'Bu numaralı bir oda zaten var.',
});

/**
 * Hata metninde/meta'sında geçen kısıt adını bulur.
 * @param {unknown} error
 * @returns {string | undefined}
 */
function findConstraintName(error) {
  const meta = /** @type {{ meta?: { constraint?: string | string[] }, message?: string }} */ (error);
  const fromMeta = Array.isArray(meta?.meta?.constraint) ? meta.meta.constraint[0] : meta?.meta?.constraint;
  if (fromMeta && Object.hasOwn(CONSTRAINT_MESSAGES, fromMeta)) return fromMeta;

  // Prisma, CHECK/EXCLUDE ihlallerini tipli bir koda çevirmiyor; kısıt adı
  // yalnızca ham mesajda geçiyor.
  const message = typeof meta?.message === 'string' ? meta.message : '';
  return Object.keys(CONSTRAINT_MESSAGES).find((name) => message.includes(name));
}

/**
 * Prisma/PostgreSQL hatalarını bizim hata tiplerimize çevirir.
 * Yarış durumunda (aynı kodla iki eşzamanlı ekleme) P2002 buradan 409 olur.
 * @param {unknown} error
 * @param {{ uniqueMessage?: string }} [options]
 * @returns {never}
 */
export function rethrowPrismaError(error, { uniqueMessage = 'Bu kayıt zaten mevcut' } = {}) {
  const constraint = findConstraintName(error);
  if (constraint) {
    throw new ConflictError(CONSTRAINT_MESSAGES[constraint], 'CONSTRAINT', { constraint });
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
