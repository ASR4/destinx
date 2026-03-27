import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apply any pending Drizzle migrations at startup.
 * Safe to run on every boot — already-applied migrations are skipped.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.warn('DATABASE_URL not set — skipping migrations');
    return;
  }

  // Resolve migrations folder relative to this file's location.
  // In production: dist/db/migrate.js → ../../drizzle
  // In dev (tsx):  src/db/migrate.ts  → ../../drizzle
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  try {
    logger.info({ migrationsFolder }, 'Running database migrations');
    await migrate(db, { migrationsFolder });
    logger.info('Database migrations complete');
  } catch (err) {
    logger.error({ err }, 'Database migration failed');
    throw err;
  } finally {
    await sql.end();
  }
}
