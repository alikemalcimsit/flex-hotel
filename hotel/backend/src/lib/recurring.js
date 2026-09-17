/**
 * Sunucu sürecindeki zamanlanmış işlerin ortak çalıştırıcısı.
 *
 * - Bir iş kendi turunu bitirmeden yeniden başlamaz (yavaş tur üst üste binmez).
 * - Hata log'a düşer, diğer işleri ve sonraki turları durdurmaz.
 * - İlk tur açılıştan biraz sonra başlar (açılış yükü bitsin); zamanlayıcılar
 *   süreci ayakta tutmaz (`unref`).
 *
 * Testler ve betikler bunu başlatmaz; yalnızca `server.js`.
 */

/** Sunucu açılışında ilk turun beklemesi. */
const STARTUP_DELAY_MS = 5_000;

/**
 * @param {{ error: Function }} logger
 * @param {Array<{ name: string, intervalMs: number, run: () => Promise<unknown> }>} jobs
 * @param {{ startupDelayMs?: number }} [options]
 * @returns {() => void} işleri durdurur
 */
export function startRecurringJobs(logger, jobs, { startupDelayMs = STARTUP_DELAY_MS } = {}) {
  const timers = [];
  const busy = new Set();

  for (const job of jobs) {
    const tick = async () => {
      if (busy.has(job.name)) return;
      busy.add(job.name);
      try {
        await job.run();
      } catch (error) {
        logger.error({ err: error, job: job.name }, 'Zamanlanmış iş başarısız');
      } finally {
        busy.delete(job.name);
      }
    };
    const startup = setTimeout(tick, startupDelayMs);
    const repeat = setInterval(tick, job.intervalMs);
    startup.unref?.();
    repeat.unref?.();
    timers.push(startup, repeat);
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  };
}
