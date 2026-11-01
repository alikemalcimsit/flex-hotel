import { z } from './locale.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema, optionalQueryInt, queryBoolean } from './fields.js';

/**
 * Kat hizmetleri (modül 14) sözleşmeleri.
 *
 * Görev, odanın kat hizmeti durumundan ayrı bir kayıttır: durum "oda şu an
 * nasıl" sorusuna, görev "kim ne zaman ne yapacak" sorusuna cevap verir.
 * 2500 kişilik otelde kat şefi sabah listeyi görevlilere dağıtır; görevli
 * telefondan "Başladım / Bitti / Sorun var" der; şef temizlenen odayı kontrol
 * eder. Oda durumunu görev yazmaz — `housekeeping-worker` olaydan günceller,
 * aktör kapalıysa iş manuel göreve düşer (sistem aktörsüz de çalışır).
 */

/* ─────────────── Görev tipleri ─────────────── */

export const HOUSEKEEPING_TASK_TYPES = Object.freeze(['CHECKOUT_CLEAN', 'STAYOVER', 'DEEP_CLEAN', 'GUEST_REQUEST']);

export const HOUSEKEEPING_TASK_TYPE_LABELS = Object.freeze({
  CHECKOUT_CLEAN: 'Çıkış temizliği',
  STAYOVER: 'Konaklama temizliği',
  DEEP_CLEAN: 'Detaylı temizlik',
  GUEST_REQUEST: 'Misafir isteği',
});

/**
 * Oda durumunu süren görev tipleri. `GUEST_REQUEST` (havlu, yastık) odanın
 * temizliğini değiştirmez: başlaması odayı "Temizleniyor" yapmaz, bitmesi
 * "Temiz" yapmaz — yalnızca bağlı misafir isteğini kapatır.
 */
export const HOUSEKEEPING_CLEANING_TYPES = Object.freeze(['CHECKOUT_CLEAN', 'STAYOVER', 'DEEP_CLEAN']);

/** Personelin elle açabildiği tipler: misafir isteği görevi yalnızca istekten doğar. */
export const HOUSEKEEPING_MANUAL_TYPES = Object.freeze(['CHECKOUT_CLEAN', 'STAYOVER', 'DEEP_CLEAN']);

/* ─────────────── Görev durumları ─────────────── */

export const HOUSEKEEPING_TASK_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export const HOUSEKEEPING_TASK_STATUS_LABELS = Object.freeze({
  PENDING: 'Bekliyor',
  IN_PROGRESS: 'Temizleniyor',
  DONE: 'Bitti',
  CANCELLED: 'İptal',
});

export const HOUSEKEEPING_TASK_OPEN_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS']);

/**
 * Görev durum geçişi kuralı — sunucu da tarayıcı da bunu kullanır.
 *
 * `PENDING → DONE` bilinçli serbest: görevli "Başladım" demeyi unutup işi
 * bitirmiş olabilir; kaydı gerçeğe uydururuz, görevliyi forma değil işe
 * zorlarız. Kapanmış görev (bitti / iptal) değişmez — yanlış kapandıysa
 * yenisi açılır, geçmiş oynanmaz.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string | null} Hata mesajı; geçiş geçerliyse `null`
 */
export function housekeepingTaskTransitionError(from, to) {
  if (!HOUSEKEEPING_TASK_STATUSES.includes(to)) return 'Geçersiz görev durumu';
  if (from === to) return null;
  if (from === 'DONE' || from === 'CANCELLED') {
    return `${HOUSEKEEPING_TASK_STATUS_LABELS[from] ?? from} görev değiştirilemez; gerekiyorsa yeni görev açın.`;
  }
  if (to === 'PENDING' && from !== 'IN_PROGRESS') return 'Görev yalnızca başlatılmışken bırakılabilir';
  return null;
}

/* ─────────────── Öncelik ─────────────── */

/** 1 en acil, 5 en düşük. Çıkış temizliği 2'den açılır: oda satışa dönecek. */
export const HOUSEKEEPING_PRIORITIES = Object.freeze([1, 2, 3, 4, 5]);
export const HOUSEKEEPING_PRIORITY_LABELS = Object.freeze({
  1: 'Acil',
  2: 'Yüksek',
  3: 'Normal',
  4: 'Düşük',
  5: 'Boşken',
});

export const HOUSEKEEPING_DEFAULT_PRIORITY = 3;
export const HOUSEKEEPING_CHECKOUT_PRIORITY = 2;

/**
 * Misafir isteği önceliği → görev önceliği. İstek modülünün (7) kendi
 * SLA'sı var; görev listesi aynı aciliyeti taşısın ki kat şefi iki ayrı
 * sıralamayla uğraşmasın.
 *
 * @param {string} requestPriority `LOW | NORMAL | HIGH | URGENT`
 * @returns {number}
 */
export function housekeepingPriorityForRequest(requestPriority) {
  const map = { URGENT: 1, HIGH: 2, NORMAL: 3, LOW: 4 };
  return map[requestPriority] ?? HOUSEKEEPING_DEFAULT_PRIORITY;
}

/* ─────────────── Kontrol (dört göz) ─────────────── */

/**
 * Kat şefi kontrolü hangi görevde yapılabilir?
 *
 * Yalnızca **bitmiş temizlik** görevi kontrol edilir ve temizliği yapan kendi
 * işini onaylayamaz (dört göz — onay kuyruğundaki kuralın aynısı). İkinci kez
 * kontrol edilmez: karar verildiyse geçmiş oynanmaz, kalan oda yeniden
 * kirlendiyse yeni görev zaten açılır.
 *
 * @param {{ status: string, type: string, inspectionPassed: boolean | null, completedById: string | null }} task
 * @param {string | null} inspectorId
 * @returns {string | null} Hata mesajı; kontrol edilebilirse `null`
 */
export function housekeepingInspectionError(task, inspectorId) {
  if (!HOUSEKEEPING_CLEANING_TYPES.includes(task.type)) return 'Yalnızca temizlik görevleri kontrol edilir';
  if (task.status !== 'DONE') return 'Yalnızca bitmiş görev kontrol edilir';
  if (task.inspectionPassed !== null && task.inspectionPassed !== undefined) return 'Görev zaten kontrol edilmiş';
  if (inspectorId && task.completedById && inspectorId === task.completedById) {
    return 'Temizliği yapan görevli kendi işini onaylayamaz (dört göz kuralı)';
  }
  return null;
}

/* ─────────────── Şemalar ─────────────── */

export const MAX_HOUSEKEEPING_NOTE_LENGTH = 500;
export const HOUSEKEEPING_TASK_PAGE_SIZE = 30;
/** Toplu atamada tek istekte işaretlenebilecek görev sayısı. */
export const HOUSEKEEPING_MAX_BULK_ASSIGN = 100;

const noteField = z.string().trim().max(MAX_HOUSEKEEPING_NOTE_LENGTH, `Not en fazla ${MAX_HOUSEKEEPING_NOTE_LENGTH} karakter`);

export const createHousekeepingTaskSchema = z.object({
  roomId: z.string({ error: 'Oda seçilmedi' }).uuid({ message: 'Geçersiz oda' }),
  type: z.enum(HOUSEKEEPING_MANUAL_TYPES, { error: 'Geçersiz görev tipi' }).default('STAYOVER'),
  priority: z.coerce
    .number({ error: 'Öncelik sayı olmalı' })
    .int('Öncelik tam sayı olmalı')
    .min(1, 'Öncelik 1-5 arası olmalı')
    .max(5, 'Öncelik 1-5 arası olmalı')
    .default(HOUSEKEEPING_DEFAULT_PRIORITY),
  scheduledFor: dateField.optional(),
  notes: noteField.optional().nullable(),
  assignedToId: z.string().uuid({ message: 'Geçersiz görevli' }).optional().nullable(),
});

export const assignHousekeepingTasksSchema = z.object({
  taskIds: z
    .array(z.string().uuid({ message: 'Geçersiz görev' }), { error: 'Görev seçilmedi' })
    .min(1, 'En az bir görev seçin')
    .max(HOUSEKEEPING_MAX_BULK_ASSIGN, `Tek seferde en fazla ${HOUSEKEEPING_MAX_BULK_ASSIGN} görev atanabilir`),
  /** `null`: atamayı kaldır (görev havuza döner). */
  assignedToId: z.string().uuid({ message: 'Geçersiz görevli' }).nullable(),
});

export const startHousekeepingTaskSchema = z.object({ expectedUpdatedAt });

export const completeHousekeepingTaskSchema = z.object({
  expectedUpdatedAt,
  note: noteField.optional().nullable(),
});

export const reportHousekeepingIssueSchema = z.object({
  expectedUpdatedAt,
  note: z
    .string({ error: 'Sorunu yazın' })
    .trim()
    .min(1, 'Sorunu yazın')
    .max(MAX_HOUSEKEEPING_NOTE_LENGTH, `Not en fazla ${MAX_HOUSEKEEPING_NOTE_LENGTH} karakter`),
});

export const inspectHousekeepingTaskSchema = z
  .object({
    expectedUpdatedAt,
    passed: z.boolean({ error: 'Kontrol sonucu zorunlu' }),
    note: noteField.optional().nullable(),
  })
  .refine((value) => value.passed || (value.note ?? '').length > 0, {
    path: ['note'],
    message: 'Reddederken sebebini yazın — görevli neyi düzelteceğini bilsin',
  });

export const cancelHousekeepingTaskSchema = z.object({
  expectedUpdatedAt,
  reason: z
    .string({ error: 'Sebep zorunlu' })
    .trim()
    .min(1, 'Sebep zorunlu')
    .max(MAX_HOUSEKEEPING_NOTE_LENGTH, `Sebep en fazla ${MAX_HOUSEKEEPING_NOTE_LENGTH} karakter`),
});

export const housekeepingTaskListQuerySchema = paginationQuerySchema.extend({
  /** Gün; verilmezse otelin iş günü. */
  date: dateField.optional(),
  status: z.enum(HOUSEKEEPING_TASK_STATUSES, { error: 'Geçersiz durum filtresi' }).optional(),
  type: z.enum(HOUSEKEEPING_TASK_TYPES, { error: 'Geçersiz tip filtresi' }).optional(),
  assignedToId: z.string().uuid({ message: 'Geçersiz görevli' }).optional(),
  roomId: z.string().uuid({ message: 'Geçersiz oda' }).optional(),
  floor: optionalQueryInt({ label: 'Kat', min: -5, max: 200 }),
  /** Yalnızca sorun bildirilen görevler. */
  onlyIssues: queryBoolean.optional(),
});

/* ─────────────── Oda durum haritası ─────────────── */

/** Harita kutusundaki rozetler: bugün giriş bekleyen odanın temizliği öne alınır. */
export const FLOOR_MAP_FLAGS = Object.freeze({
  ARRIVAL: 'Bugün giriş var',
  DEPARTURE: 'Bugün çıkış var',
  BLOCKED: 'Arızalı / hizmet dışı',
});
