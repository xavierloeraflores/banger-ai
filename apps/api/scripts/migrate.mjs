import pg from 'pg';
import { readFile } from 'node:fs/promises';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(4262647)');
  await client.query('CREATE TABLE IF NOT EXISTS banger_migrations (name text PRIMARY KEY)');
  const name = '001_workspace.sql';
  if (!(await client.query('SELECT 1 FROM banger_migrations WHERE name=$1', [name])).rowCount) {
    await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    await client.query('INSERT INTO banger_migrations VALUES ($1)', [name]);
  }
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
