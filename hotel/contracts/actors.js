import { MAX_USAGE_DAYS } from './concierge.js';
import { z } from './locale.js';
import { PERMISSIONS } from './permissions.js';

/**
 * Aktör yönetim paneli ve manuel görev sözleşmeleri (modül 12).
 *
 * Aktör: olay dinleyip işi kendiliğinden yapan paket (oda atama, bildirim,
 * AI ajanı). Yönetici her aktörü otel bazında açıp kapatır; kapalı aktörün
 * işi kaybolmaz, **manuel görev** olarak işin modülüne yetkili personelin
 * önüne düşer. Görevi gören, zildeki uyarıyı gören kişidir (aynı izin).
 */

/* ─────────────── Aktörler ─────────────── */

/** Bildirgedeki tür (`defineActor`). */
export const ACTOR_TYPES = Object.freeze(['worker', 'agent']);

export const ACTOR_TYPE_LABELS = Object.freeze({
  worker: 'Kural tabanlı',
  agent: 'LLM ajanı',
});

/** Aktör adı: bildirgedeki ad (küçük harf, rakam, tire; ör. `room-worker`). */
export const ACTOR_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Aktör kartındaki sayaçların penceresi (saat). */
export const ACTOR_STATS_WINDOW_HOURS = 24;

/** Aktör detayındaki "son işler" sayısı (fazlası Activity Feed'de). */
export const ACTOR_RECENT_ACTIVITY_LIMIT = 10;

/** Açma / kapama gerekçesi. */
export const MAX_ACTOR_NOTE_LENGTH = 300;

/** LLM ajanı kartındaki günlük seri (gün). */
export const ACTOR_USAGE_DEFAULT_DAYS = 14;

export const actorParamSchema = z.object({
  name: z.string().trim().regex(ACTOR_NAME_PATTERN, 'Geçersiz aktör adı'),
});

/** Açarken de kapatırken de gerekçe isteğe bağlı; denetim izine ve aktörün kartına yazılır. */
export const actorToggleSchema = z.object({
  note: z
    .string()
    .trim()
    .max(MAX_ACTOR_NOTE_LENGTH, `Gerekçe en fazla ${MAX_ACTOR_NOTE_LENGTH} karakter`)
    .optional(),
});

export const actorUsageQuerySchema = z.object({
  days: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int('Gün sayısı tam sayı olmalı')
    .min(1, 'En az 1 gün')
    .max(MAX_USAGE_DAYS, `En fazla ${MAX_USAGE_DAYS} gün`)
    .default(ACTOR_USAGE_DEFAULT_DAYS),
});

/* ─────────────── Manuel görevler ─────────────── */

/** Prisma `TaskStatus` ile birebir. */
export const MANUAL_TASK_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export const MANUAL_TASK_STATUS_LABELS = Object.freeze({
  PENDING: 'Bekliyor',
  IN_PROGRESS: 'Üstlenildi',
  DONE: 'Tamamlandı',
  CANCELLED: 'Gerek kalmadı',
});

export const MANUAL_TASK_OPEN_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS']);
export const MANUAL_TASK_CLOSED_STATUSES = Object.freeze(['DONE', 'CANCELLED']);

/** Liste görünümleri: açıklar (en eski önce) ve kapananlar (en yeni kapanan önce). */
export const MANUAL_TASK_VIEWS = Object.freeze(['OPEN', 'CLOSED']);

export const MANUAL_TASK_VIEW_LABELS = Object.freeze({
  OPEN: 'Açık',
  CLOSED: 'Kapanan',
});

export const MANUAL_TASK_PAGE_SIZE = 30;
export const MANUAL_TASK_MAX_PAGE_SIZE = 100;
export const MAX_MANUAL_TASK_NOTE_LENGTH = 500;
export const MAX_MANUAL_TASK_MODULE_LENGTH = 80;

/**
 * Görevin modülü → görevi görüp kapatabilen izin. Zil uyarısı da aynı izne
 * gider: uyarıyı gören, görevi açıp kapatabilir. Modül adı aktör
 * bildirgesindeki `fallbackModule`'dür; listede olmayan modülün görevi
 * ayarları yönetene düşer.
 */
export const MANUAL_TASK_MODULE_PERMISSIONS = Object.freeze({
  'Oda atama': PERMISSIONS.ROOMS_OPERATE,
  'Bildirim merkezi': PERMISSIONS.NOTIFICATIONS_MANAGE,
  Rezervasyon: PERMISSIONS.RESERVATIONS_MANAGE,
  'Onay kuyruğu': PERMISSIONS.APPROVALS_DECIDE,
  // Modül 8: AI ajanları ve kanal geçitleri (cevaplanmamış / gönderilememiş misafir mesajı).
  'Misafir mesajları': PERMISSIONS.MESSAGES_REPLY,
});

export const MANUAL_TASK_KNOWN_MODULES = Object.freeze(Object.keys(MANUAL_TASK_MODULE_PERMISSIONS));

export const MANUAL_TASK_FALLBACK_PERMISSION = PERMISSIONS.SETTINGS_MANAGE;

/** @param {string} module */
export function manualTaskPermission(module) {
  return MANUAL_TASK_MODULE_PERMISSIONS[module] ?? MANUAL_TASK_FALLBACK_PERMISSION;
}

/**
 * Kişinin görebildiği görevler: bilinen modüllerden izni olanlar, ayrıca
 * ayar yönetimi izni varsa listede olmayan modüller (`others`).
 *
 * @param {readonly string[]} permissions etkin izinler
 * @returns {{ all: boolean, modules: string[], others: boolean, empty: boolean }}
 */
export function manualTaskScope(permissions) {
  const granted = new Set(permissions ?? []);
  const modules = MANUAL_TASK_KNOWN_MODULES.filter((module) => granted.has(MANUAL_TASK_MODULE_PERMISSIONS[module]));
  const others = granted.has(MANUAL_TASK_FALLBACK_PERMISSION);
  const all = others && modules.length === MANUAL_TASK_KNOWN_MODULES.length;
  return { all, modules, others, empty: modules.length === 0 && !others };
}

/**
 * @param {readonly string[]} permissions
 * @param {string} module
 */
export function canHandleManualTask(permissions, module) {
  return (permissions ?? []).includes(manualTaskPermission(module));
}

/** Görev üzerindeki işlemler. */
export const MANUAL_TASK_ACTIONS = Object.freeze(['claim', 'release', 'complete', 'cancel']);

/**
 * Bu işlem bu görevde yapılabilir mi? Yapılamazsa kod ve kullanıcıya
 * gösterilecek sebep. Kapanmış görev değişmez; üstlenilmiş görevi başkası
 * üstlenemez (ama iş acildir: tamamlayabilir ya da "gerek kalmadı" diyebilir);
 * görevi yalnızca üstlenen bırakabilir.
 *
 * @param {{ status: string, assignedTo?: string | null }} task
 * @param {'claim' | 'release' | 'complete' | 'cancel'} action
 * @param {string | null} meId işlemi yapan personelin kimliği
 * @returns {{ code: string, message: string } | null}
 */
export function manualTaskActionError(task, action, meId) {
  if (MANUAL_TASK_CLOSED_STATUSES.includes(task.status)) {
    return {
      code: 'TASK_CLOSED',
      message: `Bu görev zaten kapatılmış (${MANUAL_TASK_STATUS_LABELS[task.status] ?? task.status})`,
    };
  }
  if (action === 'claim' && task.status === 'IN_PROGRESS' && task.assignedTo && task.assignedTo !== meId) {
    return { code: 'TASK_CLAIMED', message: 'Bu görevi başka biri üstlendi' };
  }
  if (action === 'release') {
    if (task.status !== 'IN_PROGRESS') return { code: 'TASK_NOT_CLAIMED', message: 'Görev üstlenilmemiş' };
    if (!meId || task.assignedTo !== meId) {
      return { code: 'TASK_CLAIMED', message: 'Görevi yalnızca üstlenen kişi bırakabilir' };
    }
  }
  return null;
}

const cursorLimit = (fallback, max) =>
  z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(max, `Kayıt sayısı en fazla ${max} olabilir`)
    .default(fallback);

export const manualTaskListQuerySchema = z.object({
  view: z.enum(MANUAL_TASK_VIEWS, { error: 'Geçersiz görünüm' }).default('OPEN'),
  module: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MANUAL_TASK_MODULE_LENGTH, `Modül adı en fazla ${MAX_MANUAL_TASK_MODULE_LENGTH} karakter`)
    .optional(),
  actor: z.string().trim().regex(ACTOR_NAME_PATTERN, 'Geçersiz aktör adı').optional(),
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: cursorLimit(MANUAL_TASK_PAGE_SIZE, MANUAL_TASK_MAX_PAGE_SIZE),
});

export const manualTaskParamSchema = z.object({
  taskId: z.string().uuid({ message: 'Geçersiz görev' }),
});

const taskNote = z
  .string()
  .trim()
  .max(MAX_MANUAL_TASK_NOTE_LENGTH, `Not en fazla ${MAX_MANUAL_TASK_NOTE_LENGTH} karakter`);

/** Tamamlarken not isteğe bağlı ("oda 204 atandı"). */
export const completeManualTaskSchema = z.object({
  note: taskNote.optional(),
});

/** "Gerek kalmadı" derken gerekçe zorunlu: iş yapılmadan kapanıyor. */
export const cancelManualTaskSchema = z.object({
  reason: taskNote.min(1, 'Neden gerek kalmadığını yazın'),
});
