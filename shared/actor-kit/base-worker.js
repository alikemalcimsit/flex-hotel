/**
 * Aktörlerin ortak tabanı.
 *
 * Her worker aynı dört şeyi doğru yapmak zorunda; bunları tek tek yazmak, altı
 * worker sonra altı farklı davranış demek:
 *
 * 1. **Aynı event'i iki kez işlememek.** Event yeniden dağıtılırsa (yeniden
 *    deneme, outbox tarayıcısı, süreç yeniden başlaması) oda ikinci kez
 *    atanmamalı. `ProcessedEvent` kaydı bunu garanti eder.
 * 2. **Kapalıyken işi düşürmemek.** Aktör yönetim panelinden kapatıldığında
 *    iş kaybolmaz, "manuel görev" olarak personelin önüne düşer.
 * 3. **Geçici hatada yeniden denemek.** Veritabanı bir an cevap vermediyse
 *    pes etmek yerine birkaç kez denenir; yine olmazsa manuel göreve düşer.
 * 4. **İz bırakmak.** Ne kadar sürdü, başarılı mıydı — Activity Feed (modül 10)
 *    bunu gösterecek.
 *
 * Altyapıyı bilmez: veritabanı işlemleri dışarıdan `deps` ile verilir.
 */

export class BaseWorker {
  #manifest;
  #handlers;
  #deps;

  /**
   * @param {ReturnType<import('./manifest.js').defineActor>} manifest
   * @param {Record<string, (payload: object, envelope: object, ctx: object) => Promise<void>>} handlers
   * @param {{
   *   isProcessed: (actorName: string, eventId: string) => Promise<boolean>,
   *   markProcessed: (actorName: string, eventId: string, hotelId: string) => Promise<void>,
   *   isEnabled: (hotelId: string, actorName: string) => Promise<boolean>,
   *   logActivity: (entry: object) => Promise<void>,
   *   createManualTask: (task: object) => Promise<void>,
   *   sleep?: (ms: number) => Promise<void>,
   *   logger?: { warn: Function, error: Function },
   * }} deps
   */
  constructor(manifest, handlers, deps) {
    for (const eventName of Object.keys(handlers)) {
      if (!manifest.subscribes.includes(eventName)) {
        throw new Error(
          `"${manifest.name}" aktörü "${eventName}" için işleyici tanımlamış ama manifest'inde dinlediğini beyan etmemiş.`,
        );
      }
    }

    this.#manifest = manifest;
    this.#handlers = handlers;
    this.#deps = {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      logger: { warn: () => {}, error: () => {} },
      ...deps,
    };
  }

  get manifest() {
    return this.#manifest;
  }

  /**
   * Event bus'a bağlar. Dinlediği her event için tek bir giriş noktası kurar.
   * @param {{ subscribe: Function }} bus
   * @returns {() => void} aboneliği iptal eden fonksiyon
   */
  bind(bus) {
    const unsubscribers = this.#manifest.subscribes
      .filter((eventName) => this.#handlers[eventName])
      .map((eventName) =>
        bus.subscribe(eventName, this.#manifest.name, (payload, envelope) => this.handle(payload, envelope)),
      );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /**
   * Bir event'i işler. Asla dışarı hata fırlatmaz — bus'ın diğer dinleyicileri
   * ve yayıncı bundan etkilenmemeli.
   *
   * @param {object} payload
   * @param {object} envelope
   */
  async handle(payload, envelope) {
    const { name } = this.#manifest;
    const handler = this.#handlers[envelope.name];
    if (!handler) return;

    const hotelId = payload.hotelId;
    const startedAt = Date.now();

    try {
      if (await this.#deps.isProcessed(name, envelope.id)) {
        // Aynı event tekrar geldi; sessizce geç. Bu bir hata değil, tasarım.
        return;
      }

      if (!(await this.#deps.isEnabled(hotelId, name))) {
        await this.#fallbackToManualTask(payload, envelope, 'Aktör kapalı');
        await this.#deps.markProcessed(name, envelope.id, hotelId);
        return;
      }

      const result = await this.#runWithRetry(handler, payload, envelope);
      await this.#deps.markProcessed(name, envelope.id, hotelId);

      await this.#deps.logActivity({
        hotelId,
        actorName: name,
        eventId: envelope.id,
        level: 'INFO',
        message: result?.message ?? `${envelope.name} işlendi`,
        meta: { event: envelope.name, ...(result?.meta ?? {}) },
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.#deps.logger.error?.({ err: error, actor: name, event: envelope.name }, 'Aktör hata verdi');

      await this.#safely(() =>
        this.#deps.logActivity({
          hotelId,
          actorName: name,
          eventId: envelope.id,
          level: 'ERROR',
          message: error.message ?? 'Bilinmeyen hata',
          meta: { event: envelope.name },
          durationMs: Date.now() - startedAt,
        }),
      );

      // İş kaybolmasın: hata sonrası da personelin önüne düşsün.
      await this.#safely(() => this.#fallbackToManualTask(payload, envelope, error.message));
      await this.#safely(() => this.#deps.markProcessed(name, envelope.id, hotelId));
    }
  }

  /**
   * @param {Function} handler
   * @param {object} payload
   * @param {object} envelope
   */
  async #runWithRetry(handler, payload, envelope) {
    const { attempts, backoffMs } = this.#manifest.retry;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await handler(payload, envelope, { attempt });
      } catch (error) {
        lastError = error;
        // İş kuralı hataları tekrar denemekle düzelmez; hemen bırak.
        if (error?.retryable === false) break;
        if (attempt < attempts) {
          this.#deps.logger.warn?.(
            { actor: this.#manifest.name, event: envelope.name, attempt },
            'Aktör yeniden deniyor',
          );
          await this.#deps.sleep(backoffMs * attempt);
        }
      }
    }

    throw lastError;
  }

  /**
   * @param {object} payload
   * @param {object} envelope
   * @param {string} reason
   */
  async #fallbackToManualTask(payload, envelope, reason) {
    await this.#deps.createManualTask({
      hotelId: payload.hotelId,
      module: this.#manifest.fallbackModule,
      title: this.describeFallback(envelope.name, payload),
      description: `${this.#manifest.name} bu işi yapamadı: ${reason}`,
      originalEvent: { id: envelope.id, name: envelope.name, payload },
    });
  }

  /**
   * Manuel görevin başlığı. Alt sınıflar ezerek anlamlı hâle getirir —
   * "Elle yapılacak: reservation.created" yerine "DEMO-0001 için oda ata".
   * Personel görev listesinde event adı değil, iş görmek ister.
   *
   * @param {string} eventName
   * @param {object} _payload
   * @returns {string}
   */
  describeFallback(eventName, _payload) {
    return `Elle yapılacak: ${eventName}`;
  }

  /** @param {() => Promise<unknown>} fn */
  async #safely(fn) {
    try {
      await fn();
    } catch (error) {
      this.#deps.logger.error?.({ err: error, actor: this.#manifest.name }, 'Aktör temizlik adımı da başarısız');
    }
  }
}
