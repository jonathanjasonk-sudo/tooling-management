// Database: PostgreSQL (Railway) bila DATABASE_URL ada, selain itu PGlite lokal (tanpa instalasi apa pun).
const fs = require('fs');
const { DEFAULT_TYPES, DEFAULT_LOCATIONS } = require('./constants');

const usePg = !!process.env.DATABASE_URL;
if (process.env.RAILWAY_PROJECT_ID && !usePg) {
  throw new Error('DATABASE_URL wajib diatur di Railway agar data tersimpan di PostgreSQL dan tidak hilang saat deploy.');
}
let pool, lite;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS styles (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tooling_types (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  style_id INT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  type_id INT NOT NULL REFERENCES tooling_types(id),
  location_id INT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'TERSEDIA',
  qty INT NOT NULL CHECK (qty >= 0),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (style_id, type_id, location_id, status));
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  style_id INT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  type_id INT NOT NULL REFERENCES tooling_types(id),
  qty INT NOT NULL CHECK (qty > 0),
  target_location_id INT REFERENCES locations(id),
  requested_by TEXT, due_date DATE,
  status TEXT NOT NULL DEFAULT 'DIAJUKAN', note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS movements (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL, style_id INT, type_id INT,
  from_location_id INT, to_location_id INT, qty INT,
  from_status TEXT, to_status TEXT, note TEXT, actor TEXT);
CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  filename TEXT NOT NULL, requested_by TEXT NOT NULL, actor TEXT NOT NULL,
  replace_stock BOOLEAN NOT NULL, item_count INT NOT NULL, total_qty INT NOT NULL,
  details JSONB NOT NULL);
`;

async function q(sql, params = []) {
  return usePg ? pool.query(sql, params) : lite.query(sql, params);
}

async function tx(fn) {
  if (usePg) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn((s, p = []) => c.query(s, p));
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  return lite.transaction((t) => fn((s, p = []) => t.query(s, p)));
}

async function init() {
  if (usePg) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query(SCHEMA);
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || './.data/pglite';
    fs.mkdirSync(dir, { recursive: true });
    lite = new PGlite(dir);
    await lite.waitReady;
    await lite.exec(SCHEMA);
  }
  const t = await q('SELECT count(*)::int AS n FROM tooling_types');
  if (t.rows[0].n === 0) {
    for (const [i, n] of DEFAULT_TYPES.entries()) await q('INSERT INTO tooling_types(name,sort) VALUES($1,$2)', [n, i]);
  }
  const l = await q('SELECT count(*)::int AS n FROM locations');
  if (l.rows[0].n === 0) {
    for (const [i, n] of DEFAULT_LOCATIONS.entries()) await q('INSERT INTO locations(name,sort) VALUES($1,$2)', [n, i]);
  }
  console.log(`[db] ${usePg ? 'PostgreSQL (DATABASE_URL)' : 'PGlite lokal (./.data)'} siap`);
}

module.exports = { init, q, tx, usePg: () => usePg };
