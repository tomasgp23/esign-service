const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'esign.db');
const FILES_DIR = path.join(DATA_DIR, 'files');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

const sqliteDb = new DatabaseSync(DB_PATH);
sqliteDb.exec('PRAGMA journal_mode = WAL');
sqliteDb.exec('PRAGMA foreign_keys = ON');

// Thin wrapper so the rest of the codebase can use the same
// db.prepare(sql).get/all/run(...) shape regardless of which underlying
// driver is in use.
const db = {
  exec: (sql) => sqliteDb.exec(sql),
  prepare: (sql) => sqliteDb.prepare(sql),
};

db.exec(`
  create table if not exists _migrations (
    name text primary key,
    applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

const applied = new Set(db.prepare('select name from _migrations').all().map((r) => r.name));
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  db.exec('begin');
  try {
    db.exec(sql);
    db.prepare('insert into _migrations (name) values (?)').run(file);
    db.exec('commit');
    console.log(`[db] applied migration ${file}`);
  } catch (err) {
    db.exec('rollback');
    throw new Error(`Migration ${file} failed: ${err.message}`);
  }
}

module.exports = { db, FILES_DIR };
