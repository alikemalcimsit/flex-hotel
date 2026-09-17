import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app.js';
import { originChecker } from './lib/http-security.js';
import { hotelRoom, registerRealtimeBridge, stopRealtimeBridge } from './lib/realtime.js';
import { resolveHotelId } from './lib/tenant.js';
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

const app = await buildApp();

// socket.io aynı HTTP sunucusuna bağlanır.
const io = new SocketServer(app.server, { cors: { origin: originChecker(app.allowedOrigins) } });

/**
 * Bağlanan istemci otelinin odasına katılır; canlı yayın (oda planı) oraya
 * düşer.
 *
 * ⚠️ GEÇİCİ: otel, HTTP tarafındaki gibi `HOTEL_CODE`'dan çözülüyor. Modül 2
 * gelince el sıkışmadaki JWT'den okunacak — o gün burada değişecek tek şey
 * `hotelId`'nin kaynağı, oda adı (`hotel:<id>`) ve yayın aynı kalacak.
 */
io.on('connection', async (socket) => {
  try {
    const hotelId = await resolveHotelId();
    await socket.join(hotelRoom(hotelId));
    socket.emit('ready', { hotelId });
  } catch (error) {
    app.log.error({ err: error }, 'Socket otel bağlamına katılamadı');
    // Katılamayan istemci sessizce "canlı" sanmasın: panel bunu görünce
    // periyodik tazelemeye düşer.
    socket.emit('ready', { hotelId: null });
  }
});

registerRealtimeBridge(io, app.log);
app.decorate('io', io);

// Bildirim göndericisi ve zamanlanmış işler yalnızca sunucu sürecinde çalışır
// (testler ve betikler `buildApp` ile açıp kapatır, arka plan işi başlatmaz).
const stopNotificationJobs = startNotificationJobs(app.log);

// Açık socket bağlantıları kapatılmazsa HTTP sunucusu kapanmayı bekler ve
// süreç yöneticisi (systemd) onu zorla öldürene kadar asılı kalır.
app.addHook('onClose', async () => {
  stopNotificationJobs();
  closeProviders();
  stopRealtimeBridge();
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
