import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../api/app.js';
import { configFromEnv } from '../api/config.js';
test('public docs assets do not expose job APIs or local secrets', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maps-docs-'));
  const secret = 'docs-secret-that-must-never-be-exposed-in-html';
  const app = await buildApp(configFromEnv({ API_KEYS: JSON.stringify({ docs: secret }), DATA_DIR: dir, LOG_LEVEL: 'silent' }), async () => ({ find: async () => ({}), close: async () => {} }));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  for (const url of ['/docs', '/docs/', '/docs/docs.css', '/docs/docs.js', '/docs/favicon.svg', '/docs/openapi.json']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
    assert.ok(!response.body.includes(secret));
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const html = await app.inject('/docs');
  assert.match(html.headers['content-type'], /text\/html/);
  assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(html.body, /API playground/);
  assert.equal((await app.inject('/v1/jobs')).statusCode, 401);
  assert.equal((await app.inject('/v1/openapi.json')).statusCode, 401);
  assert.equal((await app.inject('/docs/not-a-public-asset')).statusCode, 401);
});
