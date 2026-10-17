import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
const destination = process.argv[2];
if (!destination) throw new Error('Usage: npm run backup -- backups/jobs-YYYYMMDD.sqlite');
const output = path.resolve(destination);
const input = path.resolve(process.env.DATA_DIR || 'storage', 'jobs.sqlite');
if (input === output) throw new Error('Backup must use a different path');
try { await fs.access(output); throw new Error('Backup target already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
const db = new Database(input, { readonly: true, fileMustExist: true });
try { await db.backup(output); } finally { db.close(); }
console.log(`Consistent SQLite snapshot saved: ${output}`);
