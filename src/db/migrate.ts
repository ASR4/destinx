import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apply any pending Drizzle migrations at startup.
 * Safe to run on every boot — already-applied migrations are skipped.
 * Non-fatal: the app continues even if migrations fail (tables already exist).
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.warn('DATABASE_URL not set — skipping migrations');
    return;
  }

  const sql = postgres(url, { max: 1 });

  try {
    // Ensure pgvector extension exists before migrations reference the vector type
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;

    // Deduplicate user_preferences so the unique index migration succeeds
    await sql`
      DELETE FROM user_preferences a USING user_preferences b
      WHERE a.created_at > b.created_at
        AND a.user_id = b.user_id
        AND a.category = b.category
        AND a.key = b.key
    `.catch(() => { /* table may not exist yet on fresh DB */ });

    // Resolve migrations folder — try multiple locations
    const candidates = [
      path.resolve(__dirname, '../../drizzle'),   // dev: src/db → root/drizzle
      path.resolve(__dirname, '../drizzle'),       // prod: dist/db → dist/drizzle
    ];
    const migrationsFolder = candidates.find((p) => fs.existsSync(p));

    if (!migrationsFolder) {
      logger.warn({ candidates }, 'Drizzle migrations folder not found — skipping');
      return;
    }

    const db = drizzle(sql);
    logger.info({ migrationsFolder }, 'Running database migrations');
    await migrate(db, { migrationsFolder });
    logger.info('Database migrations complete');
  } catch (err) {
    logger.error({ err }, 'Database migration failed (non-fatal, continuing)');
  } finally {
    await sql.end();
  }
}
