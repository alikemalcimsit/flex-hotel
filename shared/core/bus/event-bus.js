import { randomUUID } from 'node:crypto';
import { getContext, runWithContext } from '../correlation.js';
import { validatePayload } from '../events/catalog.js';

/**
 * Süreç içi event bus.
 *
 * Tasarım kararları ve gerekçeleri:
 *
 * - **Kalıcılık önce gelir.** Event önce `EventLog`'a yazılır, sonra dinleyicilere
 *   dağıtılır. Ters sırada olsaydı, süreç çökünce "işlendi ama kaydı yok" durumu
 *   çıkardı ve Activity Feed yalan söylerdi.
 * - **Dinleyici hataları izole.** Bir dinleyicinin patlaması ne yayıncıyı ne de
 *   diğer dinleyicileri etkiler; hata log'lanır. Ayar kaydetmenin, alakasız bir
 *   dinleyici yüzünden başarısız olması kabul edilemez.
 * - **Dinleyiciler bekleniyor (await).** Süreç içi dinleyiciler mikrosaniyelik
 *   (cache invalidation gibi); beklemek davranışı deterministik ve test edilebilir
 *   kılıyor. Gerçek worker'lar (modül 3+) kuyruk üzerinden bağlanacak; o zaman
 *   bu sınıfın yerine kuyruk adaptörü geçecek, arayüz aynı kalacak.
 * - **Hop sınırı.** Dinleyici event yayınlayabildiği için döngü riski var
 *   (A → B → A). `hop` her adımda artar, sınırı aşan zincir kesilir.
 *
 * Prisma'yı bilmez: kalıcılık dışarıdan `persist` ile verilir. Bu paket
 * sektörden ve altyapıdan bağımsız kalmalı.
 */

const MAX_HOPS = 10;

export class InMemoryEventBus {
  /** @type {Map<string, Array<{ subscriber: string, handler: Function }>>} */
  #handlers = new Map();
  #persist;
  #logger;

  /**
   * @param {{ persist?: (envelope: object) => Promise<void>, logger?: { info: Function, warn: Function, error: Function } }} [options]
   */
  constructor({ persist, logger } = {}) {
    this.#persist = persist ?? (async () => {});
    this.#logger = logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  }

  /**
   * @param {string} eventName
   * @param {string} subscriber Dinleyicinin adı (log ve hata mesajları için)
   * @param {(payload: object, envelope: object) => Promise<void> | void} handler
   * @returns {() => void} Aboneliği iptal eden fonksiyon
   */
  subscribe(eventName, subscriber, handler) {
    if (!this.#handlers.has(eventName)) this.#handlers.set(eventName, []);
    const entry = { subscriber, handler };
    this.#handlers.get(eventName).push(entry);

    return () => {
      const list = this.#handlers.get(eventName) ?? [];
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    };
  }

  /**
   * @param {string[]} eventNames
   * @param {string} subscriber
   * @param {(payload: object, envelope: object) => Promise<void> | void} handler
   * @returns {() => void}
   */
  subscribeMany(eventNames, subscriber, handler) {
    const unsubscribers = eventNames.map((name) => this.subscribe(name, subscriber, handler));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /**
   * Zarfı oluşturur ve doğrular — henüz kaydetmez, dağıtmaz.
   *
   * Transactional outbox için ayrı duruyor: çağıran, zarfı iş verisiyle aynı
   * transaction içinde kendi yazıp commit sonrası `dispatch` edebilsin.
   *
   * @param {string} name Katalogda tanımlı event adı
   * @param {object} payload
   * @param {{ actor?: string, correlationId?: string, causationId?: string, hop?: number }} [options]
   * @returns {object} Zarf
   */
  createEnvelope(name, payload, options = {}) {
    const validated = validatePayload(name, payload);
    const context = getContext();

    return {
      id: randomUUID(),
      name,
      version: 1,
      payload: validated,
      correlationId: options.correlationId ?? context?.correlationId ?? randomUUID(),
      causationId: options.causationId ?? context?.causationId,
      hop: options.hop ?? 0,
      actor: options.actor ?? context?.actor ?? 'system',
      occurredAt: new Date(),
    };
  }

  /**
   * Event yayınlar: doğrula → kaydet → dağıt.
   *
   * Basit yol. Değişiklikle atomik olması gereken event'ler için
   * `createEnvelope` + `dispatch` ikilisini kullanın (outbox).
   *
   * @param {string} name
   * @param {object} payload
   * @param {{ actor?: string, correlationId?: string, causationId?: string, hop?: number }} [options]
   * @returns {Promise<object>}
   */
  async publish(name, payload, options = {}) {
    const envelope = this.createEnvelope(name, payload, options);

    if (this.#exceedsHopLimit(envelope)) return envelope;

    try {
      await this.#persist(envelope);
    } catch (error) {
      // Kalıcılık başarısızsa dağıtmıyoruz: izi olmayan bir yan etki, sonradan
      // açıklanamayan durum demektir.
      this.#logger.error({ err: error, event: name }, 'Event kaydedilemedi, dağıtılmadı');
      throw error;
    }

    await this.dispatch(envelope);
    return envelope;
  }

  /** @param {object} envelope */
  #exceedsHopLimit(envelope) {
    if (envelope.hop <= MAX_HOPS) return false;
    this.#logger.error(
      { event: envelope.name, correlationId: envelope.correlationId, hop: envelope.hop },
      `Event zinciri ${MAX_HOPS} adımı aştı, kesildi (döngü şüphesi)`,
    );
    return true;
  }

  /**
   * Kaydedilmiş bir zarfı dinleyicilere dağıtır.
   * @param {object} envelope
   */
  async dispatch(envelope) {
    if (this.#exceedsHopLimit(envelope)) return;
    const handlers = this.#handlers.get(envelope.name) ?? [];
    if (handlers.length === 0) return;

    await Promise.all(
      handlers.map(async ({ subscriber, handler }) => {
        const startedAt = Date.now();
        try {
          // Dinleyici içinde yayınlanan event'ler bu zincire bağlansın diye
          // bağlam yeniden kuruluyor: aynı correlationId, sebep bu event.
          await runWithContext(
            { correlationId: envelope.correlationId, causationId: envelope.id, actor: subscriber },
            () => handler(envelope.payload, { ...envelope, hop: envelope.hop + 1 }),
          );
        } catch (error) {
          this.#logger.error(
            { err: error, event: envelope.name, subscriber, correlationId: envelope.correlationId },
            'Event dinleyicisi hata verdi (diğerleri etkilenmedi)',
          );
        } finally {
          const durationMs = Date.now() - startedAt;
          if (durationMs > 250) {
            this.#logger.warn({ event: envelope.name, subscriber, durationMs }, 'Yavaş event dinleyicisi');
          }
        }
      }),
    );
  }

  /** Test ve teşhis için: hangi event'i kim dinliyor. */
  subscriptions() {
    return Object.fromEntries(
      [...this.#handlers.entries()].map(([name, list]) => [name, list.map((entry) => entry.subscriber)]),
    );
  }
}
