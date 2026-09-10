import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app.js';

/**
 * Sunucu önyüklemesi. Uygulamanın kendisi `app.js`'te — testler oradan
 * `buildApp()` çağırıp port açmadan istek atabilsin diye ayrı duruyor.
 */

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();

// socket.io aynı HTTP sunucusuna bağlanır; şimdilik sadece "hello" gönderir
const io = new SocketServer(app.server, { cors: { origin: true } });
io.on('connection', (socket) => {
  socket.emit('hello', { message: 'HotelOS socket bağlı' });
});
app.decorate('io', io);

// Kapanışta açık bağlantılar ve veritabanı havuzu düzgün bırakılır.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} alındı, kapanılıyor...`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
