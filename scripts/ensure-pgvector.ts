import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.log('DATABASE_URL not set — skipping pgvector setup');
    process.exit(0);
  }

  const sql = postgres(url);
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log('pgvector extension ensured');
  } catch (err) {
    console.warn('Could not create pgvector extension (may need superuser):', err);
  } finally {
    await sql.end();
  }
}

main();
