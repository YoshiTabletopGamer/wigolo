import type Database from 'better-sqlite3';
import { createLogger } from '../../logger.js';

const log = createLogger('cache');

/**
 * Migration registry. Entries are TS constants (not file reads) so the
 * built dist/ tree has no runtime filesystem dependency. Each migration's
 * `sql` string is also mirrored in src/cache/migrations/NNN-*.sql for
 * grep-ability and review.
 */
export interface Migration {
  /** Unique stable name. Must never be renamed after release. */
  name: string;
  sql: string;
}

const MIGRATION_001_SQLITE_VEC = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
  embedding float[384]
);

CREATE TABLE IF NOT EXISTS vec_id_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vec_metadata (
  rowid INTEGER PRIMARY KEY REFERENCES vec_id_map(rowid) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_vec_metadata_url ON vec_metadata(url);
CREATE INDEX IF NOT EXISTS idx_vec_metadata_hash ON vec_metadata(content_hash);
CREATE INDEX IF NOT EXISTS idx_vec_metadata_model ON vec_metadata(model_id);
`;

export const MIGRATIONS: Migration[] = [
  { name: '001-sqlite-vec', sql: MIGRATION_001_SQLITE_VEC },
];

/**
 * Apply pending migrations in order. Idempotent — already-applied migrations
 * are skipped via the schema_migrations table.
 */
export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map(r => r.name));

  const recordStmt = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        recordStmt.run(migration.name, Date.now());
      })();
      log.info('migration applied', { name: migration.name });
    } catch (err) {
      log.error('migration failed', {
        name: migration.name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
