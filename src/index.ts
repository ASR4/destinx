import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import { whatsappRoutes } from './routes/whatsapp.js';
import { bookingRoutes } from './routes/booking.js';
import { healthRoutes } from './routes/health.js';
import { startWorkers, stopWorkers } from './jobs/queue.js';
import { startScheduler } from './jobs/scheduler.js';
import { closeDb } from './db/client.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(formbody);

  await app.register(healthRoutes);
  await app.register(whatsappRoutes);
  await app.register(bookingRoutes);

  startWorkers();
  await startScheduler();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await stopWorkers();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, 'Destinx server running');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
