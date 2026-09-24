/**
 * Aktör kaydı.
 *
 * Modül 12'nin yönetim paneli "hangi aktörler var, ne yapıyorlar, açık mı"
 * sorusunu buradan cevaplayacak. Aktörler kendilerini kayda ekler; panel
 * listeyi okur, açma/kapama ayarını `ActorSetting` tablosuna yazar.
 */

export class ActorRegistry {
  /** @type {Map<string, { worker: object, unbind?: () => void }>} */
  #actors = new Map();

  /**
   * @param {{ manifest: { name: string }, bind: (bus: object) => () => void }} worker
   */
  register(worker) {
    const { name } = worker.manifest;
    if (this.#actors.has(name)) {
      throw new Error(`"${name}" adlı aktör zaten kayıtlı`);
    }
    this.#actors.set(name, { worker });
    return this;
  }

  /**
   * Kayıtlı aktörleri event bus'a bağlar.
   * @param {{ subscribe: Function }} bus
   */
  bindAll(bus) {
    for (const entry of this.#actors.values()) {
      entry.unbind?.();
      entry.unbind = entry.worker.bind(bus);
    }
  }

  /** Bütün abonelikleri kaldırır (test ve yeniden yapılandırma için). */
  unbindAll() {
    for (const entry of this.#actors.values()) {
      entry.unbind?.();
      entry.unbind = undefined;
    }
  }

  /**
   * Arka plan aktörlerinin işleri bitene kadar bekler (testler ve düzgün
   * kapanış). Zincir de beklenir: bir aktörün işi bitince başka bir aktöre
   * iş düşebilir (router → concierge → rezervasyon sonucu); hepsi aynı anda
   * boş görülene kadar tekrar bakılır. `timeoutMs` dolarsa beklemeyi bırakır
   * ve `false` döner.
   *
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  async idle(timeoutMs = Infinity) {
    const workers = [...this.#actors.values()].map((entry) => entry.worker);
    const busy = () =>
      workers.some((worker) => {
        const backlog = worker.backlog?.();
        return backlog ? backlog.running > 0 || backlog.queued > 0 : false;
      });
    const all = (async () => {
      do {
        await Promise.all(workers.map((worker) => worker.idle?.() ?? Promise.resolve()));
        // Biten işin yayınladığı olay bir sonraki turda sıraya girer.
        await new Promise((resolve) => setImmediate(resolve));
      } while (busy());
    })();
    if (!Number.isFinite(timeoutMs)) {
      await all;
      return true;
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([all.then(() => true), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Yönetim paneli için aktör listesi.
   * @returns {Array<object>}
   */
  list() {
    return [...this.#actors.values()].map((entry) => entry.worker.manifest);
  }

  /**
   * @param {string} name
   * @returns {object | undefined}
   */
  get(name) {
    return this.#actors.get(name)?.worker;
  }
}

/** Uygulama genelinde tek kayıt. */
export const actorRegistry = new ActorRegistry();
