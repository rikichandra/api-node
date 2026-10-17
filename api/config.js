import path from 'node:path';
export function configFromEnv(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}..${max}`);
    return n;
  };
  let keys;
  try { keys = JSON.parse(env.API_KEYS || '{}'); } catch { throw new Error('API_KEYS must be a JSON object of client names to keys'); }
  if (!keys || Array.isArray(keys) || typeof keys !== 'object' || !Object.keys(keys).length) throw new Error('API_KEYS is required');
  for (const [owner, value] of Object.entries(keys)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(owner) || typeof value !== 'string' || value.length < 32 || value.startsWith('REPLACE_')) throw new Error('Each client needs a real key of at least 32 characters');
  }
  if (new Set(Object.values(keys)).size !== Object.keys(keys).length) throw new Error('API keys must be unique across clients');
  return {
    keys, dataDir: path.resolve(env.DATA_DIR || 'storage'), host: env.HOST || '127.0.0.1', port: integer('PORT', 3108, 1, 65535),
    workers: integer('WORKERS', 1, 1, 4), maxPending: integer('MAX_PENDING_JOBS', 50, 1, 1000),
    maxPendingPerOwner: integer('MAX_PENDING_PER_CLIENT', 10, 1, 100), maxStored: integer('MAX_STORED_JOBS', 1000, 1, 100000),
    retentionDays: integer('RETENTION_DAYS', 7, 1, 365), jobTimeoutMs: integer('JOB_TIMEOUT_MS', 1800000, 1000, 86400000),
    cooldownMs: integer('UPSTREAM_COOLDOWN_MS', 300000, 1000, 3600000), rateLimit: integer('RATE_LIMIT_PER_MINUTE', 120, 1, 10000),
    browserChannel: env.SCRAPER_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    logLevel: env.LOG_LEVEL || 'info'
  };
}
