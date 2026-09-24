import { actorRegistry } from '@hotelos/actor-kit';
import { conciergeAgentManifest, createConciergeAgent } from '@hotelos/concierge-agent';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_SOURCE_LABELS,
  NOTIFICATION_TRIGGER_EVENTS,
  manualTaskPermission,
} from '@hotelos/hotel-contracts';
import { parseToolArguments } from '@hotelos/llm';
import { createNotificationWorker, NOTIFICATION_WORKER_NAME } from '@hotelos/notification-worker';
import { createReservationWorker } from '@hotelos/reservation-worker';
import { createRoomWorker } from '@hotelos/room-worker';
import { createRouterAgent, routerAgentManifest } from '@hotelos/router-agent';
import { createWebchatGateway } from '@hotelos/webchat-gateway';
import { createWhatsAppGateway } from '@hotelos/whatsapp-gateway';
import { prismaUnfiltered } from '../db.js';
import { webchatGatewayService, webchatTransport } from '../modules/channels/webchat.js';
import { whatsappGatewayService } from '../modules/channels/whatsapp.js';
import { createLlmDeps } from '../modules/concierge/llm.js';
import { conciergeService, routerService } from '../modules/concierge/service.js';
import { enqueueTriggerNotifications } from '../modules/notifications/service.js';
import { raiseStaffAlert } from '../modules/notifications/staff-alerts.js';
import { requestApprovalStandalone } from '../modules/approvals/service.js';
import { createFromChannelRequest } from '../modules/reservations/service.js';
import { applySystemRoomState, autoAssignRoom } from '../modules/rooms/service.js';
import { registerAutoResponder, registerChannel } from './channels.js';
import { publishActivity } from './activity-stream.js';
import { readActorEnabled } from './actor-settings.js';
import { eventBus } from './events.js';
import { writeWithEvents } from './write.js';

/**
 * Aktörlerin veritabanına bağlandığı yer.
 *
 * `shared/actor-kit` ve worker paketleri altyapı bilmez; Prisma'ya dokunan
 * her şey burada. Açma/kapama ayarı `ActorSetting` tablosundan okunur
 * (`isEnabled`); yönetim paneli (modül 12) aynı tabloya yazar.
 */

let logger = { warn: () => {}, error: () => {} };

/** @param {{ warn: Function, error: Function }} next */
export function setActorLogger(next) {
  logger = next;
}

/**
 * Aktör bağımlılıkları. Hepsi filtresiz istemciyi kullanır: bu kayıtlar
 * (işlenmiş event, aktivite izi, manuel görev) sistemin defteri, soft-delete
 * filtresine tabi değil.
 */
const deps = {
  /**
   * Aynı event ikinci kez geldiyse işlenmemeli. `ProcessedEvent` üzerindeki
   * `(actorName, eventId)` unique kısıtı bunu veritabanı seviyesinde tutar.
   */
  isProcessed: async (actorName, eventId) => {
    const existing = await prismaUnfiltered.processedEvent.findFirst({
      where: { actorName, eventId },
      select: { id: true },
    });
    return Boolean(existing);
  },

  markProcessed: async (actorName, eventId, hotelId) => {
    try {
      await prismaUnfiltered.processedEvent.create({ data: { actorName, eventId, hotelId } });
    } catch (error) {
      // Yarış durumunda ikinci yazım unique kısıtına takılır; zaten işaretli
      // olması istediğimiz sonuç, hata değil.
      if (error?.code !== 'P2002') throw error;
    }
  },

  /**
   * Aktör açık mı? Kayıt yoksa varsayılan açıktır — yeni bir aktör eklendiğinde
   * kimse ayar girmeden çalışsın diye. Önbelleksiz: panelden kapatılan aktör
   * bir sonraki olayda durur.
   */
  isEnabled: (hotelId, actorName) => readActorEnabled(hotelId, actorName),

  /** Aktivite satırı (modül 10): yazılır, sonra canlı akışa haber verilir. */
  logActivity: async (entry) => {
    if (!entry.hotelId) return;
    const row = await prismaUnfiltered.activityLog.create({ data: entry, select: { id: true, hotelId: true, level: true } });
    publishActivity(row);
  },

  /**
   * İş personele düştü: görev yazılır ve işin modülüne yetkili personelin
   * ziline uyarı gider (aynı transaction — görev varsa uyarı da vardır).
   * Uyarı görevin kendisine götürür (modül 12'nin görev ekranı).
   */
  createManualTask: async (task) => {
    if (!task.hotelId) return;
    await writeWithEvents(async (tx, stage) => {
      const created = await tx.manualTask.create({
        data: {
          hotelId: task.hotelId,
          module: task.module,
          title: task.title,
          description: task.description ?? null,
          originalEvent: task.originalEvent ?? undefined,
          actorName: task.actorName ?? null,
          correlationId: task.correlationId ?? null,
        },
        select: { id: true },
      });
      await raiseStaffAlert(tx, stage, {
        hotelId: task.hotelId,
        kind: 'MANUAL_TASK',
        severity: 'WARNING',
        title: task.title,
        body: task.description ?? null,
        link: `/gorevler?gorev=${created.id}`,
        permission: manualTaskPermission(task.module),
        entityType: 'ManualTask',
        entityId: created.id,
      });
      await stage('manual_task.created', {
        hotelId: task.hotelId,
        taskId: created.id,
        module: task.module,
        actorName: task.actorName ?? null,
      });
    });
  },

  /**
   * Aktör "personel karar versin" dedi (modül 11): onay isteği ve bekleyen iş
   * aynı transaction'da açılır; yöneticinin ziline uyarı düşer. Aynı olay
   * yeniden gelirse ikinci istek açılmaz.
   */
  requestApproval: (request) => requestApprovalStandalone(request),

  logger: {
    warn: (...args) => logger.warn(...args),
    error: (...args) => logger.error(...args),
  },
};

/** Onay kuyruğunun "aktör artık yok" yolu için (bkz. `modules/approvals/subscribers.js`). */
export const createManualTaskForActor = (task) => deps.createManualTask(task);

/**
 * Aktör bu otelde açık mı (zamanlanmış işler için: ör. bekleyen mesajları
 * gönderen iş, geçit kapatıldıysa o otelin mesajını göndermez).
 * @param {string} hotelId
 * @param {string} actorName
 */
export const isActorEnabled = (hotelId, actorName) => deps.isEnabled(hotelId, actorName);

/**
 * Kayıtlı olmayabilen aktörler: sunucuda model anahtarı yoksa AI ajanları
 * kaydedilmez (bkz. `registerAiAgents`). Panel onları yine gösterir — neden
 * çalışmadıklarıyla — ve ayarları değiştirilebilir (anahtar gelince geçerli).
 */
const OPTIONAL_ACTORS = Object.freeze([
  { manifest: routerAgentManifest, reason: 'Sunucuda OPENAI_API_KEY tanımlı değil; ajan çalışmıyor' },
  { manifest: conciergeAgentManifest, reason: 'Sunucuda OPENAI_API_KEY tanımlı değil; ajan çalışmıyor' },
]);

/**
 * Yönetim panelinin aktör listesi (modül 12): kayıtlı aktörler ve kayıtlı
 * olmayan bilinen aktörler.
 *
 * @returns {Array<{ manifest: any, worker: any | null, registered: boolean, unavailableReason: string | null }>}
 */
export function actorCatalog() {
  const registered = actorRegistry.list().map((manifest) => ({
    manifest,
    worker: actorRegistry.get(manifest.name) ?? null,
    registered: true,
    unavailableReason: null,
  }));
  const names = new Set(registered.map((entry) => entry.manifest.name));
  const missing = OPTIONAL_ACTORS.filter(({ manifest }) => !names.has(manifest.name)).map(({ manifest, reason }) => ({
    manifest,
    worker: null,
    registered: false,
    unavailableReason: reason,
  }));
  return [...registered, ...missing];
}

/**
 * Aktörleri kaydeder ve event bus'a bağlar.
 *
 * İdempotent: `buildApp()` birden fazla kez çağrılabildiği için aynı aktör
 * ikinci kez kaydedilmez. `bindAll` da önce eski aboneliği kaldırır — aksi
 * hâlde tek rezervasyon için iki kez oda atanmaya çalışılırdı.
 */
/** Olay → misafir bildirimi eşlemesi (notification-worker'a verilir). */
const NOTIFICATION_TRIGGERS = Object.freeze(
  Object.fromEntries(
    Object.entries(NOTIFICATION_TRIGGER_EVENTS).flatMap(([trigger, eventNames]) =>
      [eventNames].flat().map((eventName) => [eventName, { trigger, label: NOTIFICATION_SOURCE_LABELS[trigger] }]),
    ),
  ),
);

export function registerActors() {
  if (!actorRegistry.get('room-worker')) {
    actorRegistry.register(createRoomWorker({ autoAssignRoom, applySystemRoomState }, deps));
  }
  if (!actorRegistry.get('reservation-worker')) {
    actorRegistry.register(createReservationWorker({ createFromChannelRequest }, deps));
  }
  if (!actorRegistry.get(NOTIFICATION_WORKER_NAME)) {
    actorRegistry.register(
      createNotificationWorker(
        {
          triggers: NOTIFICATION_TRIGGERS,
          enqueue: enqueueTriggerNotifications,
          channelLabels: NOTIFICATION_CHANNEL_LABELS,
        },
        deps,
      ),
    );
  }
  registerChannelGateways();
  registerAiAgents();
  actorRegistry.bindAll(eventBus);
  return actorRegistry;
}

/**
 * WhatsApp ve web chat geçitleri (modül 8). Her zaman kayıtlı: kanalın bir
 * otelde açık olup olmadığı o otelin kanal ayarından okunur.
 */
function registerChannelGateways() {
  if (!actorRegistry.get('whatsapp-gateway')) {
    actorRegistry.register(createWhatsAppGateway(whatsappGatewayService, deps));
    registerChannel('WHATSAPP', { name: 'whatsapp-gateway' });
  }
  if (!actorRegistry.get('webchat-gateway')) {
    actorRegistry.register(createWebchatGateway(webchatGatewayService, webchatTransport, deps));
    registerChannel('WEBCHAT', { name: 'webchat-gateway' });
  }
}

/**
 * Router ve concierge ajanları (modül 8) — yalnızca model istemcisi varsa
 * (sunucuda `OPENAI_API_KEY`). Yoksa kaydedilmez: gelen kutusu yeni
 * konuşmaları personel modunda açar, AI modundaki konuşmaya gelen mesaj
 * konuşmayı personele alır (bkz. `aiActiveFor`).
 *
 * Testler sahte istemciyle kaydeder (`client`); kayıt bir kez yapılır.
 *
 * @param {{ client?: object | null }} [options]
 * @returns {boolean} ajanlar kayıtlı mı
 */
export function registerAiAgents({ client } = {}) {
  if (actorRegistry.get('concierge-agent')) return true;
  const llm = createLlmDeps(client !== undefined ? { client } : {});
  if (!llm.client) return false;
  actorRegistry.register(createRouterAgent(routerService, { ...deps, llm }));
  actorRegistry.register(createConciergeAgent(conciergeService, { ...deps, llm, parseArguments: parseToolArguments }));
  registerAutoResponder({ name: 'concierge-agent' });
  // Sonradan (testte) kaydedildiyse de bus'a bağlansın; bağlama tekrar edilebilir.
  actorRegistry.bindAll(eventBus);
  return true;
}

export { actorRegistry };
