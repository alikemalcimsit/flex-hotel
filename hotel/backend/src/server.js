import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { Server as SocketServer } from 'socket.io';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { checkDb } from './db.js';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-degistir';

/**
 * Fastify uygulamasını kurar. Modüller sırası gelince buraya register edilir.
 * @returns {import('fastify').FastifyInstance}
 */
export function buildApp() {
  const app = Fastify({ logger: true });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });
  app.register(jwt, { secret: JWT_SECRET });

  // Tüm hatalar aynı zarfla döner
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const status = error.statusCode ?? 500;
    reply.status(status).send({ success: false, error: error.message ?? 'Sunucu hatası' });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ success: false, error: 'Bulunamadı' });
  });

  app.get('/health', async () => {
    const db = await checkDb();
    return { success: true, data: { status: 'ok', db } };
  });

  // TODO: modüller buraya: app.register(reservationRoutes, { prefix: '/reservations' })

  return app;
}

const app = buildApp();

// socket.io aynı HTTP sunucusuna bağlanır; şimdilik sadece "hello" gönderir
const io = new SocketServer(app.server, { cors: { origin: true } });
io.on('connection', (socket) => {
  socket.emit('hello', { message: 'HotelOS socket bağlı' });
});
app.decorate('io', io);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
