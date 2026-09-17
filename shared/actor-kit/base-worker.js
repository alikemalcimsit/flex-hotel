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
 * 5. **Onaya götürmek.** İşleyici `ctx.requireApproval` ile "personel karar
 *    versin" derse olay ne işlenmiş sayılır ne manuel göreve düşer; onay
 *    verilince aynı işleyici `ctx.approval` dolu olarak yeniden çağrılır
 *    (bkz. `approval.js`).
 *
 * Altyapıyı bilmez: veritabanı işlemleri dışarıdan `deps` ile verilir.
 */

import { ApprovalRequired, isApprovalRequired } from './approval.js';

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
   *   requestApproval?: (request: object) => Promise<{ approvalId: string, created: boolean }>,
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
   * `context.approval` verilirse bu bir **devam** çağrısıdır: personel onayı
   * vermiştir, işleyici `ctx.approval` ile işi bitirir. Devam çağrısında
   * aktör kapalıysa iş yine yapılır: onay verilmiş bir işi manuel göreve
   * düşürmek personele aynı işi iki kez sormak olurdu.
   *
   * @param {object} payload
   * @param {object} envelope
   * @param {{ approval?: object | null }} [context]
   */
  async handle(payload, envelope, context = {}) {
    const { name } = this.#manifest;
    const handler = this.#handlers[envelope.name];
    if (!handler) return;

    const hotelId = payload.hotelId;
    const startedAt = Date.now();
    const approval = context.approval ?? null;

    try {
      if (await this.#deps.isProcessed(name, envelope.id)) {
        // Aynı event tekrar geldi; sessizce geç. Bu bir hata değil, tasarım.
        return;
      }

      if (!approval && !(await this.#deps.isEnabled(hotelId, name))) {
        await this.#fallbackToManualTask(payload, envelope, 'Aktör kapalı');
        await this.#deps.markProcessed(name, envelope.id, hotelId);
        return;
      }

      let result;
      try {
        result = await this.#runWithRetry(handler, payload, envelope, approval);
      } catch (error) {
        if (!isApprovalRequired(error) || approval) throw error;
        await this.#sendToApproval(payload, envelope, error, startedAt);
        return;
      }
      await this.#deps.markProcessed(name, envelope.id, hotelId);

      await this.#deps.logActivity({
        hotelId,
        actorName: name,
        eventId: envelope.id,
        level: 'INFO',
        message: result?.message ?? `${envelope.name} işlendi`,
        meta: { event: envelope.name, ...(result?.meta ?? {}), ...(approval ? { approvalId: approval.id } : {}) },
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Onaydan sonra yeniden onay istemek bir programlama hatası: iş
      // personelin önüne manuel görev olarak düşer, ikinci onay açılmaz.
      if (isApprovalRequired(error)) {
        error = new Error(`Aktör onaylanmış işte yeniden onay istedi (${error.request?.action ?? '?'})`);
      }
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
   * @param {object | null} approval
   */
  async #runWithRetry(handler, payload, envelope, approval) {
    const { attempts, backoffMs } = this.#manifest.retry;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await handler(payload, envelope, {
          attempt,
          approval,
          /** @param {ConstructorParameters<typeof ApprovalRequired>[0]} request */
          requireApproval: (request) => {
            throw new ApprovalRequired(request);
          },
        });
      } catch (error) {
        lastError = error;
        // Onay sinyali ve iş kuralı hataları tekrar denemekle düzelmez; hemen bırak.
        if (isApprovalRequired(error) || error?.retryable === false) break;
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
   * İşi onaya gönderir. Olay işlenmiş sayılmaz: onay verilince aynı zarf
   * `handle(payload, envelope, { approval })` ile geri gelir. Aynı olay bu
   * arada yeniden dağıtılırsa (outbox) isteyen taraf tekilleştirir
   * (`created: false`); ikinci istek açılmaz.
   *
   * Bildirgede beyan edilmemiş bir iş için onay istemek programlama hatası:
   * yönetim paneli "bu aktör neyi onaya götürür" sorusunu bildirgeden
   * cevaplıyor. Hata olarak ele alınır (manuel görev).
   *
   * @param {object} payload
   * @param {object} envelope
   * @param {ApprovalRequired} signal
   * @param {number} startedAt
   */
  async #sendToApproval(payload, envelope, signal, startedAt) {
    const { name } = this.#manifest;
    const request = signal.request ?? {};
    if (!request.action || !this.#manifest.requiresApproval.includes(request.action)) {
      throw new Error(
        `"${name}" aktörü bildirgesinde beyan etmediği "${request.action ?? '?'}" işi için onay istedi.`,
      );
    }
    if (typeof this.#deps.requestApproval !== 'function') {
      throw new Error(`"${name}" aktörü onay istedi ama onay akışı (requestApproval) bağlı değil.`);
    }

    const outcome = await this.#deps.requestApproval({
      hotelId: payload.hotelId,
      actorName: name,
      action: request.action,
      type: request.type,
      summary: request.summary,
      reason: request.reason ?? null,
      data: request.data ?? {},
      amount: request.amount ?? null,
      currency: request.currency ?? null,
      entityType: request.entityType ?? null,
      entityId: request.entityId ?? null,
      expiresInMs: request.expiresInMs ?? null,
      // Zarfın tamamı: devamda aynı kimlik, aynı zincir (correlationId) kullanılır.
      event: {
        id: envelope.id,
        name: envelope.name,
        version: envelope.version ?? 1,
        payload,
        correlationId: envelope.correlationId ?? null,
        causationId: envelope.causationId ?? null,
        hop: envelope.hop ?? 0,
        actor: envelope.actor ?? 'system',
        occurredAt: envelope.occurredAt ?? new Date().toISOString(),
      },
    });

    await this.#deps.logActivity({
      hotelId: payload.hotelId,
      actorName: name,
      eventId: envelope.id,
      level: 'INFO',
      message:
        outcome?.created === false ? `Onay zaten bekleniyor: ${request.summary}` : `Onaya gönderildi: ${request.summary}`,
      meta: { event: envelope.name, approvalId: outcome?.approvalId ?? null, action: request.action },
      durationMs: Date.now() - startedAt,
    });
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
