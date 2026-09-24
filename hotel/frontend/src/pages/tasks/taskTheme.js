/** Görev durumlarının rozet rengi (modül 12). */
export const STATUS_TONES = Object.freeze({
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELLED: 'neutral',
});

/** Adres çubuğundaki süzgeçler: sayfa yenilense de kalır, zilin bağlantısı `?gorev=` ile açar. */
export const TASK_PARAMS = Object.freeze({ view: 'gorunum', module: 'modul', actor: 'aktor', detail: 'gorev' });
