import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import postgres from 'postgres';
import { whatsappRoutes } from './routes/whatsapp.js';
import { bookingRoutes } from './routes/booking.js';
import { healthRoutes } from './routes/health.js';
import { startWorkers, stopWorkers } from './jobs/queue.js';
import { startScheduler } from './jobs/scheduler.js';
import { closeDb } from './db/client.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function ensureDbExtensionsAndConstraints() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const sql = postgres(url);
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    logger.info('pgvector extension ensured');

    // Deduplicate user_preferences before adding unique constraint
    // (drizzle-kit push can't do this non-interactively)
    await sql`
      DELETE FROM user_preferences a USING user_preferences b
      WHERE a.id > b.id
        AND a.user_id = b.user_id
        AND a.category = b.category
        AND a.key = b.key
    `;
    await sql`
      ALTER TABLE user_preferences
      ADD CONSTRAINT IF NOT EXISTS user_preferences_user_id_category_key_unique
      UNIQUE (user_id, category, key)
    `;
    logger.info('user_preferences unique constraint ensured');
  } catch (err) {
    logger.warn({ err }, 'DB setup warning (non-fatal)');
  } finally {
    await sql.end();
  }
}

async function main() {
  await ensureDbExtensionsAndConstraints();

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(formbody);

  await app.register(healthRoutes);
  await app.register(whatsappRoutes);
  await app.register(bookingRoutes);

  if (process.env.NODE_ENV !== 'production') {
    const { devRoutes } = await import('./routes/dev.js');
    await app.register(devRoutes);
    logger.info('Dev routes enabled at /dev/*');
  }

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
