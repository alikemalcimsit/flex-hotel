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
