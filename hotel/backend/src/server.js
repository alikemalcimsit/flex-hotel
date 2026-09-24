import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app.js';
import { prismaUnfiltered } from './db.js';
import { actorRegistry } from './lib/actors.js';
import { originChecker, resolveJwtSecret, resolveTrustProxy, socketIpResolver } from './lib/http-security.js';
import { startMaintenanceJobs } from './lib/maintenance-jobs.js';
import { permissionsForRole } from './lib/permissions.js';
import { registerActivityBridge, registerRealtimeBridge, registerSocketHandlers, stopRealtimeBridge } from './lib/realtime.js';
import { findActiveStaffByEmail } from './lib/staff.js';
import { resolveHotelId } from './lib/tenant.js';
import { startApprovalJobs } from './modules/approvals/jobs.js';
import { startReservationJobs } from './modules/reservations/jobs.js';
import { startChannelJobs } from './modules/channels/jobs.js';
import { webchatOrigins } from './modules/channels/service.js';
import { registerWebchatNamespace, setWebchatTransport, webchatSessionSecret } from './modules/channels/webchat.js';
import { startConciergeJobs } from './modules/concierge/jobs.js';
import { startNotificationJobs } from './modules/notifications/jobs.js';
import { closeProviders } from './modules/notifications/providers/index.js';

/**
 * Sunucu önyüklemesi. Uygulamanın kendisi `app.js`'te — testler oradan
 * `buildApp()` çağırıp port açmadan istek atabilsin diye ayrı duruyor.
 */

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Dinlenecek adres. Varsayılan yalnızca bu makine: üretimde nginx aynı
 * makineden bağlanır, geliştirmede panel de localhost'tan. `0.0.0.0` iken
 * kimlik doğrulaması henüz olmayan API yerel ağdaki herkese açık kalıyordu.
 * Konteyner gibi dışarıdan erişim gereken kurulumlarda `HOST=0.0.0.0` verilir.
 */
const HOST = process.env.HOST ?? '127.0.0.1';

/**
 * Kapanışta arka plan aktörlerinin (AI turu, kanal gönderimi) bitmesi için
 * beklenen en uzun süre. Dolarsa kalan işler bırakılır: takılan AI konuşmasını
 * süpüren iş ve bekleyen mesaj gönderici açılışta onları toplar.
 */
const SHUTDOWN_DRAIN_MS = 10_000;

const app = await buildApp();

// socket.io aynı HTTP sunucusuna bağlanır. Panelin adreslerine ek olarak web
// chat balonunun gömülü olduğu otel siteleri (yalnızca `/webchat` ad alanına
// bağlanabilir; her bağlantı kendi otelinin listesiyle ayrıca denetlenir).
const staffOrigin = originChecker(app.allowedOrigins);
const io = new SocketServer(app.server, {
  cors: {
    origin: (origin, callback) =>
      staffOrigin(origin, (error, allowed) => {
        if (error || allowed) return callback(error, allowed);
        webchatOrigins().then(
          (origins) => callback(null, origins.has(origin)),
          () => callback(null, false),
        );
      }),
  },
});

registerSocketHandlers(io, {
  resolveHotelId,
  findStaff: (hotelId, email) => findActiveStaffByEmail(prismaUnfiltered, hotelId, email),
  permissionsForRole,
  logger: app.log,
});
registerRealtimeBridge(io, app.log);
const stopActivityBridge = registerActivityBridge(io);
setWebchatTransport(
  registerWebchatNamespace(io, {
    secret: webchatSessionSecret(resolveJwtSecret(app.log)),
    clientIp: socketIpResolver(resolveTrustProxy()),
    logger: app.log,
  }),
);
app.decorate('io', io);

// Bildirim göndericisi ve zamanlanmış işler yalnızca sunucu sürecinde çalışır
// (testler ve betikler `buildApp` ile açıp kapatır, arka plan işi başlatmaz).
const stopNotificationJobs = startNotificationJobs(app.log);
const stopMaintenanceJobs = startMaintenanceJobs(app.log);
const stopApprovalJobs = startApprovalJobs(app.log);
const stopReservationJobs = startReservationJobs(app.log);
const stopChannelJobs = startChannelJobs(app.log);
const stopConciergeJobs = startConciergeJobs(app.log);

// Açık socket bağlantıları kapatılmazsa HTTP sunucusu kapanmayı bekler ve
// süreç yöneticisi (systemd) onu zorla öldürene kadar asılı kalır.
app.addHook('onClose', async () => {
  stopNotificationJobs();
  stopMaintenanceJobs();
  stopApprovalJobs();
  stopReservationJobs();
  stopChannelJobs();
  stopConciergeJobs();
  if (!(await actorRegistry.idle(SHUTDOWN_DRAIN_MS))) {
    app.log.warn('Arka plan aktörleri kapanış süresinde bitmedi; kalan işler açılışta toplanacak');
  }
  setWebchatTransport(null);
  closeProviders();
  stopRealtimeBridge();
  stopActivityBridge();
  await new Promise((resolve) => {
    io.close(() => resolve());
  });
});

// Kapanışta açık bağlantılar ve veritabanı havuzu düzgün bırakılır.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} alındı, kapanılıyor...`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
