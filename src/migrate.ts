import fs from 'node:fs';
import path from 'node:path';
import { closePool, query, transaction } from './db/pool';

async function main() {
  let connected = false;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await query('SELECT 1');
      connected = true;
      break;
    } catch (error) {
      if (attempt === 30) throw error;
      console.log(`[migrate] PostgreSQL todavía no está listo (${attempt}/30); reintentando…`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  if (!connected) throw new Error('No se pudo conectar a PostgreSQL.');
  const directory = path.join(process.cwd(), 'db', 'migrations');
  const migrations = fs.readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(row => row.name));
  for (const name of migrations) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    await transaction(async client => { await client.query(sql); await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]); });
    console.log(`[migrate] Aplicada ${name}`);
  }
}
main().then(closePool).catch(async error => { console.error('[migrate] Error:', error); await closePool(); process.exit(1); });
