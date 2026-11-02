import {
  HOUSEKEEPING_PRIORITY_LABELS,
  HOUSEKEEPING_TASK_STATUS_LABELS,
  HOUSEKEEPING_TASK_TYPE_LABELS,
} from '@hotelos/hotel-contracts';

/**
 * Kat hizmeti ekranlarının ortak yardımcıları (modül 14).
 *
 * Renk tonları `RoomStateBadges`taki oda renkleriyle çakışmaz: görev durumu
 * iş akışını (bekliyor → temizleniyor → bitti), oda durumu fiziksel hâli
 * anlatır. Anlam hiçbir zaman yalnızca renkte değil, metin her rozette var.
 */

/** Görev durumu: bekliyor sarı, temizleniyor gök mavisi, bitti yeşil, iptal nötr. */
export const TASK_STATUS_TONES = Object.freeze({
  PENDING: 'warning',
  IN_PROGRESS: 'sky',
  DONE: 'success',
  CANCELLED: 'neutral',
});

/** Öncelik: 1-2 kırmızı / sarı dikkat çeker, 3+ sakin. */
export const PRIORITY_TONES = Object.freeze({
  1: 'danger',
  2: 'warning',
  3: 'neutral',
  4: 'neutral',
  5: 'neutral',
});

/** @param {string} status */
export const taskStatusLabel = (status) => HOUSEKEEPING_TASK_STATUS_LABELS[status] ?? status;

/** @param {string} type */
export const taskTypeLabel = (type) => HOUSEKEEPING_TASK_TYPE_LABELS[type] ?? type;

/** @param {number} priority */
export const priorityLabel = (priority) => HOUSEKEEPING_PRIORITY_LABELS[priority] ?? String(priority);

/**
 * Görev kartındaki işlem düğmeleri: hangi durumda hangisi görünür?
 * Ekran yalnızca gösterimi yapar; asıl kural sunucuda (geçiş + izin).
 *
 * @param {{ status: string }} task
 */
export function taskActions(task) {
  return {
    canStart: task.status === 'PENDING',
    canComplete: task.status === 'PENDING' || task.status === 'IN_PROGRESS',
    canReportIssue: task.status === 'PENDING' || task.status === 'IN_PROGRESS',
    canCancel: task.status === 'PENDING' || task.status === 'IN_PROGRESS',
  };
}

/**
 * Görevlinin mobil listesi için sıralama: önce başladığı iş (yarım kalmasın),
 * sonra acil olan, sonra oda numarası.
 *
 * @param {Array<{ status: string, priority: number, room: { number: string } | null }>} tasks
 * @returns yeni dizi (girdi değişmez)
 */
export function sortForCleaner(tasks) {
  const statusOrder = { IN_PROGRESS: 0, PENDING: 1, DONE: 2, CANCELLED: 3 };
  return [...tasks].sort((a, b) => {
    const byStatus = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (a.room?.number ?? '').localeCompare(b.room?.number ?? '', 'tr', { numeric: true });
  });
}

/**
 * Toplu atama önerisi: işaretli görevler, açık görev yükü en az olan
 * görevliden başlanarak sırayla dağıtılır (yük dengesi). Ekran öneriyi
 * gösterir; şef isterse tek kişiye verir.
 *
 * @param {Array<{ id: string }>} tasks
 * @param {Array<{ id: string, openTasks: number }>} staff
 * @returns {Map<string, string>} görev id → görevli id (personel yoksa boş)
 */
export function suggestAssignments(tasks, staff) {
  const result = new Map();
  if (staff.length === 0) return result;
  const load = staff.map((user) => ({ id: user.id, openTasks: user.openTasks }));
  for (const task of tasks) {
    const lightest = load.reduce((min, user) => (user.openTasks < min.openTasks ? user : min), load[0]);
    result.set(task.id, lightest.id);
    lightest.openTasks += 1;
  }
  return result;
}
