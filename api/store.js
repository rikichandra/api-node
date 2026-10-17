import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
export const terminal = status => !['queued', 'running'].includes(status);
export function apiError(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
export async function openStore(config, onCompromised = () => {}) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(config.dataDir, { stale: 30000, update: 10000, retries: 0, onCompromised });
  let db;
  try {
    db = new Database(path.join(config.dataDir, 'jobs.sqlite'));
    db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, region TEXT NOT NULL,
      customers TEXT NOT NULL, total INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, error_code TEXT, idem TEXT, fingerprint TEXT NOT NULL, UNIQUE(owner,idem));
      CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner,created_at);
      CREATE TABLE IF NOT EXISTS results (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id,idx));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    db.prepare("UPDATE jobs SET status='queued',updated_at=? WHERE status='running'").run(Date.now());
    const read = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    const owned = (id, owner) => {
      const row = read(id);
      if (!row || row.owner !== owner) throw apiError(404, 'NOT_FOUND', 'Job not found');
      return row;
    };
    const create = db.transaction((owner, body, idem) => {
      const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      if (idem) {
        const prior = db.prepare('SELECT * FROM jobs WHERE owner=? AND idem=?').get(owner, idem);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw apiError(409, 'IDEMPOTENCY_CONFLICT', 'Key already used with another request');
          return { row: prior, replayed: true };
        }
      }
      const pending = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get().n;
      const perOwner = db.prepare("SELECT COUNT(*) n FROM jobs WHERE owner=? AND status IN ('queued','running')").get(owner).n;
      if (pending >= config.maxPending || perOwner >= config.maxPendingPerOwner) throw apiError(429, 'QUEUE_FULL', 'Pending job quota reached');
      if (db.prepare('SELECT COUNT(*) n FROM jobs').get().n >= config.maxStored) throw apiError(429, 'STORAGE_QUOTA', 'Delete terminal jobs or wait for retention cleanup');
      const id = randomUUID(), now = Date.now();
      db.prepare('INSERT INTO jobs(id,owner,status,region,customers,total,created_at,updated_at,idem,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, owner, 'queued', body.region, JSON.stringify(body.customers), body.customers.length, now, now, idem || null, fingerprint);
      return { row: read(id), replayed: false };
    });
    const append = db.transaction((id, index, data) => {
      if (read(id)?.status !== 'running') return;
      db.prepare('INSERT INTO results(job_id,idx,data) VALUES(?,?,?)').run(id, index, JSON.stringify(data));
      db.prepare('UPDATE jobs SET processed=processed+1,errors=errors+?,updated_at=? WHERE id=?').run(data.errorCode ? 1 : 0, Date.now(), id);
    });
    return {
      read, owned, create, append,
      claim() { const row = db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get(); if (row) { db.prepare("UPDATE jobs SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").run(Date.now(), Date.now(), row.id); return read(row.id); } },
      list(owner, limit, offset) { return db.prepare('SELECT * FROM jobs WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(owner, limit, offset); },
      results(id, limit, offset) { return db.prepare('SELECT data FROM results WHERE job_id=? ORDER BY idx LIMIT ? OFFSET ?').all(id, limit, offset).map(r => JSON.parse(r.data)); },
      doneIndices(id) { return new Set(db.prepare('SELECT idx FROM results WHERE job_id=?').all(id).map(r => r.idx)); },
      finish(id, status, code = null) { db.prepare("UPDATE jobs SET status=?,error_code=?,updated_at=? WHERE id=? AND status='running'").run(status, code, Date.now(), id); },
      cancel(id, owner) { owned(id, owner); db.prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running')").run(Date.now(), id); return read(id); },
      remove(id, owner) { if (!terminal(owned(id, owner).status)) throw apiError(409, 'JOB_ACTIVE', 'Cancel the job before deleting it'); db.prepare('DELETE FROM jobs WHERE id=?').run(id); },
      cleanup() { db.prepare("DELETE FROM jobs WHERE status NOT IN ('queued','running') AND updated_at < ?").run(Date.now() - config.retentionDays * 86400000); },
      cooldown() { return Number(db.prepare("SELECT value FROM meta WHERE key='cooldown'").get()?.value || 0); },
      blockUntil(time) { db.prepare("INSERT INTO meta(key,value) VALUES('cooldown',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(time)); },
      healthy() { return db.prepare('SELECT 1 ok').get().ok === 1; },
      async close() { db.close(); await release(); }
    };
  } catch (e) { db?.close(); await release(); throw e; }
}
export function publicJob(r) {
  return { id: r.id, status: r.status, region: r.region, total: r.total, processed: r.processed, errors: r.errors,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), errorCode: r.error_code || null };
}
