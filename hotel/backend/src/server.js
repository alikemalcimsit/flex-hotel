import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app.js';
import { actorRegistry } from './lib/actors.js';
import { originChecker, resolveJwtSecret, resolveTrustProxy, socketIpResolver } from './lib/http-security.js';
import { startMaintenanceJobs } from './lib/maintenance-jobs.js';
import { sessionRole } from './lib/memberships.js';
import { registerActivityBridge, registerRealtimeBridge, registerSocketHandlers, stopRealtimeBridge } from './lib/realtime.js';
import { resolveEffectivePermissions } from './modules/roles/service.js';
import { startApprovalJobs } from './modules/approvals/jobs.js';
import { startFolioJobs } from './modules/folios/jobs.js';
import { startHousekeepingJobs } from './modules/housekeeping/jobs.js';
import { startPricingJobs } from './modules/pricing/jobs.js';
import { startSalesJobs } from './modules/sales/jobs.js';
import { startAssetJobs } from './modules/assets/jobs.js';
import { startReservationJobs } from './modules/reservations/jobs.js';
import { startChannelJobs } from './modules/channels/jobs.js';
import { webchatOrigins } from './modules/channels/service.js';
import { registerWebchatNamespace, setWebchatTransport, webchatSessionSecret } from './modules/channels/webchat.js';
import { startConciergeJobs } from './modules/concierge/jobs.js';
import { startNotificationJobs } from './modules/notifications/jobs.js';
import { startInvoiceJobs } from './modules/invoicing/dispatcher.js';
import { startLostItemJobs } from './modules/lost-items/jobs.js';
import { startMaintenanceModuleJobs } from './modules/maintenance/jobs.js';
import { startHrModuleJobs } from './modules/hr/jobs.js';
import { startLoyaltyModuleJobs } from './modules/loyalty/jobs.js';
import { startKbsJobs } from './modules/kbs/dispatcher.js';
import { startReviewJobs } from './modules/reviews/jobs.js';
import { startExchangeRateJobs } from './modules/exchange-rates/jobs.js';
import { startPaymentGatewayJobs } from './modules/payment-gateway/jobs.js';
import { startGuestPortalJobs } from './modules/guest-portal/jobs.js';
import { startSurveyJobs } from './modules/surveys/jobs.js';
import { startSpaJobs } from './modules/spa/jobs.js';
import { startReportJobs } from './modules/reports/jobs.js';
import { startChannelManagerJobs } from './modules/channel-manager/jobs.js';
import { startAgencyBonusJobs } from './modules/agency-bonus/jobs.js';
import { startBanquetJobs } from './modules/banquet/jobs.js';
import { startPosJobs } from './modules/pos/jobs.js';
import { startIntegrationJobs } from './modules/integrations/jobs.js';
import { disconnectReporting } from './modules/reports/queries.js';
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

/**
 * Soket kimliği: erişim token'ı doğrulanır, ana otel dışındaki otelde erişim (HTTP'deki gibi) denetlenir; izinler o
 * otelin rol matrisinden.
 * @param {string} token
 */
async function socketIdentity(token) {
  let payload;
  try {
    payload = app.jwt.verify(token);
  } catch {
    return null;
  }
  const role = await sessionRole(payload);
  if (!role) return null;
  return { hotelId: payload.hotelId, userId: payload.userId, permissions: await resolveEffectivePermissions(payload.hotelId, role) };
}

registerSocketHandlers(io, { authenticate: socketIdentity, logger: app.log });
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
// e-belge gönderimi, GİB durum sorgusu, takılı gönderim kurtarma (modül 49).
const stopInvoiceJobs = startInvoiceJobs(app.log);
const stopMaintenanceJobs = startMaintenanceJobs(app.log);
const stopPricingJobs = startPricingJobs(app.log);
const stopSalesJobs = startSalesJobs(app.log);
// Garantisi bitecek demirbaşların zili (modül 46).
const stopAssetJobs = startAssetJobs(app.log);
const stopApprovalJobs = startApprovalJobs(app.log);
const stopFolioJobs = startFolioJobs(app.log);
const stopHousekeepingJobs = startHousekeepingJobs(app.log);
const stopReservationJobs = startReservationJobs(app.log);
const stopChannelJobs = startChannelJobs(app.log);
const stopConciergeJobs = startConciergeJobs(app.log);
const stopLostItemJobs = startLostItemJobs(app.log);
const stopMaintenanceModuleJobs = startMaintenanceModuleJobs(app.log);
const stopHrModuleJobs = startHrModuleJobs(app.log);
const stopLoyaltyModuleJobs = startLoyaltyModuleJobs(app.log);
const stopKbsJobs = startKbsJobs(app.log);
const stopReviewJobs = startReviewJobs(app.log);
const stopExchangeRateJobs = startExchangeRateJobs(app.log);
const stopPaymentGatewayJobs = startPaymentGatewayJobs(app.log);
const stopGuestPortalJobs = startGuestPortalJobs(app.log);
const stopSurveyJobs = startSurveyJobs(app.log);
const stopSpaJobs = startSpaJobs(app.log);
const stopReportJobs = startReportJobs(app.log);
const stopChannelManagerJobs = startChannelManagerJobs(app.log);
const stopAgencyBonusJobs = startAgencyBonusJobs(app.log);
const stopBanquetJobs = startBanquetJobs(app.log);
const stopPosJobs = startPosJobs(app.log);
// Webhook gönderimi ve teslimat temizliği (modül 61).
const stopIntegrationJobs = startIntegrationJobs(app.log);

// Açık socket bağlantıları kapatılmazsa HTTP sunucusu kapanmayı bekler ve
// süreç yöneticisi (systemd) onu zorla öldürene kadar asılı kalır.
app.addHook('onClose', async () => {
  stopNotificationJobs();
  stopInvoiceJobs();
  stopMaintenanceJobs();
  stopPricingJobs();
  stopSalesJobs();
  stopAssetJobs();
  stopApprovalJobs();
  stopFolioJobs();
  stopHousekeepingJobs();
  stopReservationJobs();
  stopChannelJobs();
  stopConciergeJobs();
  stopLostItemJobs();
  stopMaintenanceModuleJobs();
  stopHrModuleJobs();
  stopLoyaltyModuleJobs();
  stopKbsJobs();
  stopReviewJobs();
  stopExchangeRateJobs();
  stopPaymentGatewayJobs();
  stopGuestPortalJobs();
  stopSurveyJobs();
  stopSpaJobs();
  stopReportJobs();
  stopChannelManagerJobs();
  stopAgencyBonusJobs();
  stopBanquetJobs();
  stopPosJobs();
  stopIntegrationJobs();
  if (!(await actorRegistry.idle(SHUTDOWN_DRAIN_MS))) {
    app.log.warn('Arka plan aktörleri kapanış süresinde bitmedi; kalan işler açılışta toplanacak');
  }
  setWebchatTransport(null);
  closeProviders();
  stopRealtimeBridge();
  stopActivityBridge();
  // Ayrı rapor bağlantısı (REPORTING_DATABASE_URL) açıldıysa bırakılır.
  await disconnectReporting();
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
