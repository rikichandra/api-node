import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../api/app.js';
import { configFromEnv } from '../api/config.js';
import { openStore } from '../api/store.js';

const keys = { alpha: 'a'.repeat(48), beta: 'b'.repeat(48) };
const headers = { 'x-api-key': keys.alpha };
const customer = (id, name = 'PT Contoh Usaha') => ({ id, name });
const body = customers => ({ region: 'Sumatra Selatan', customers });
const match = { status: 'Nama dan provinsi cocok', reason: 'Customer identity remains unverified', best: { name: 'PT Contoh Usaha', lat: -3, lng: 104 }, candidates: [] };
function delayed(signal, ms = 10000) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Aborted'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function setup(t, factory = async () => ({ find: async () => match, close: async () => {} }), overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maps-api-test-'));
  const config = { ...configFromEnv({ API_KEYS: JSON.stringify(keys), DATA_DIR: dir, LOG_LEVEL: 'silent' }), ...overrides };
  const app = await buildApp(config, factory);
  const apps = [app];
  t.after(async () => { for (const a of apps) await a.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { app, config, factory, apps };
}
async function submit(app, customers = [customer('1')], extraHeaders = {}) {
  return app.inject({ method: 'POST', url: '/v1/jobs', headers: { ...headers, ...extraHeaders }, payload: body(customers) });
}
async function wait(app, id, predicate = r => !['queued', 'running'].includes(r.status)) {
  for (let i = 0; i < 500; i++) {
    const r = (await app.inject({ url: `/v1/jobs/${id}`, headers })).json();
    if (predicate(r)) return r;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for job');
}

test('fails startup with missing, weak or duplicate client keys', () => {
  assert.throws(() => configFromEnv({}), /required/);
  assert.throws(() => configFromEnv({ API_KEYS: '{"a":"short"}' }), /32/);
  assert.throws(() => configFromEnv({ API_KEYS: JSON.stringify({ a: keys.alpha, b: keys.alpha }) }), /unique/);
});
test('authentication, ownership and discovery', async t => {
  const { app } = await setup(t);
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject('/v1/jobs')).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/openapi.json', headers })).json().openapi, '3.1.0');
  const created = await submit(app);
  assert.equal(created.statusCode, 202);
  const { id } = created.json();
  assert.equal(created.headers.location, `/v1/jobs/${id}`);
  assert.equal((await app.inject({ url: `/v1/jobs/${id}`, headers: { 'x-api-key': keys.beta } })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: '/v1/jobs', headers: { 'x-api-key': keys.beta } })).json().items, []);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/jobs/${id}`, headers: { 'x-api-key': keys.beta } })).statusCode, 404);
});
test('rejects malformed, oversized, unknown-field and duplicate-id requests', async t => {
  const { app } = await setup(t);
  for (const payload of [body([]), body([customer('a'), customer('a ')]), { ...body([customer('a')]), url: 'http://localhost/admin' }, body([customer('a', ' ')]), body([customer('a', 'a ')]), { region: 'a ', customers: [customer('a')] }, { region: ' ', customers: [customer('a')] }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: body(Array.from({ length: 1001 }, (_, i) => customer(String(i)))) })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/jobs', headers: { ...headers, 'content-type': 'application/json' }, payload: 'x'.repeat(262145) })).statusCode, 413);
  assert.equal((await app.inject({ url: '/v1/jobs?limit=201', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: '/v1/jobs/not-a-uuid', headers })).statusCode, 400);
});
test('idempotency is scoped per client and rejects conflicting bodies', async t => {
  const { app } = await setup(t);
  const idem = { 'idempotency-key': 'request-0001' };
  const first = await submit(app, [customer('a')], idem);
  const replay = await submit(app, [customer('a')], idem);
  assert.equal(replay.json().id, first.json().id);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.equal((await submit(app, [customer('b')], idem)).statusCode, 409);
  const other = await app.inject({ method: 'POST', url: '/v1/jobs', headers: { 'x-api-key': keys.beta, ...idem }, payload: body([customer('a')]) });
  assert.notEqual(other.json().id, first.json().id);
});
test('retains duplicate customer names as separate ordered input rows and paginates', async t => {
  const { app } = await setup(t);
  const id = (await submit(app, [customer('a'), customer('b'), customer('c')])).json().id;
  const state = await wait(app, id);
  assert.equal(state.status, 'succeeded'); assert.equal(state.processed, 3);
  const page = (await app.inject({ url: `/v1/jobs/${id}/results?offset=1&limit=1`, headers })).json();
  assert.equal(page.total, 3); assert.equal(page.items.length, 1); assert.equal(page.items[0].customer.id, 'b');
  assert.equal(page.items[0].index, 1);
});
test('partial failures preserve successful rows and expose error codes', async t => {
  const { app } = await setup(t, async () => ({ find: async name => {
    if (name === 'timeout') throw Object.assign(new Error('Internal URL or secret must not leak'), { name: 'TimeoutError' });
    return match;
  }, close: async () => {} }));
  const id = (await submit(app, [customer('a'), customer('b', 'timeout'), customer('c')])).json().id;
  const state = await wait(app, id);
  assert.equal(state.status, 'partial'); assert.equal(state.errors, 1); assert.equal(state.processed, 3);
  const rows = (await app.inject({ url: `/v1/jobs/${id}/results`, headers })).json().items;
  assert.equal(rows[1].errorCode, 'UPSTREAM_TIMEOUT'); assert.equal(rows[1].match, null); assert.ok(rows[2].match);
  assert.ok(!JSON.stringify(rows).includes('secret must not leak'));
});
test('cancels queued and active jobs and preserves partial progress', async t => {
  const { app } = await setup(t, async ({ signal }) => ({ find: async () => { await delayed(signal); return match; }, close: async () => {} }));
  const first = (await submit(app)).json().id;
  const second = (await submit(app, [customer('2')])).json().id;
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/jobs/${first}`, headers })).statusCode, 409);
  for (const id of [second, first]) {
    assert.equal((await app.inject({ method: 'POST', url: `/v1/jobs/${id}/cancel`, headers })).json().status, 'cancelled');
    assert.equal((await app.inject({ method: 'POST', url: `/v1/jobs/${id}/cancel`, headers })).json().status, 'cancelled');
  }
  assert.equal((await wait(app, first)).processed, 0);
});
test('reports incomplete candidate detail and omits raw browser diagnostics', async t => {
  const { app } = await setup(t, async () => ({ find: async () => ({ ...match, errors: [{ message: 'INTERNAL_STACK' }], discovered: [{ internal: true }] }), close: async () => {} }));
  const id = (await submit(app)).json().id;
  assert.equal((await wait(app, id)).status, 'partial');
  const response = await app.inject({ url: `/v1/jobs/${id}/results`, headers });
  assert.equal(response.json().items[0].errorCode, 'UPSTREAM_DETAIL_ERROR');
  assert.ok(!response.body.includes('INTERNAL_STACK'));
  assert.ok(!response.body.includes('discovered'));
});
test('job deadline aborts work with a durable explicit failure', async t => {
  const { app } = await setup(t, async ({ signal }) => ({ find: async () => { await delayed(signal); return match; }, close: async () => {} }), { jobTimeoutMs: 30 });
  const id = (await submit(app)).json().id;
  const state = await wait(app, id);
  assert.equal(state.status, 'failed'); assert.equal(state.errorCode, 'JOB_TIMEOUT');
});
test('CAPTCHA opens a durable circuit breaker without retrying it', async t => {
  let calls = 0;
  const { app, config, apps } = await setup(t, async () => ({ find: async () => { calls++; throw Object.assign(new Error('Captcha'), { code: 'GOOGLE_BLOCKED' }); }, close: async () => {} }));
  const id = (await submit(app)).json().id;
  assert.equal((await wait(app, id)).status, 'blocked');
  assert.equal(calls, 1);
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
  assert.equal((await submit(app)).statusCode, 503);
  await app.close();
  const next = await buildApp(config, async () => ({ find: async () => match, close: async () => {} }));
  apps.push(next);
  assert.equal((await next.inject('/health/ready')).statusCode, 503);
});
test('graceful restart resumes only unfinished customers', async t => {
  const seen = [];
  const { app, config, apps } = await setup(t, async ({ signal }) => ({ find: async name => { if (name === 'second') await delayed(signal); return match; }, close: async () => {} }));
  const id = (await submit(app, [customer('a', 'first'), customer('b', 'second')])).json().id;
  await wait(app, id, r => r.processed === 1);
  await app.close();
  const next = await buildApp(config, async () => ({ find: async name => { seen.push(name); return match; }, close: async () => {} }));
  apps.push(next);
  const final = await wait(next, id);
  assert.equal(final.processed, 2); assert.equal(final.status, 'succeeded'); assert.deepEqual(seen, ['second']);
});
test('startup recovers persisted running state left by interruption', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maps-api-recovery-'));
  const config = configFromEnv({ API_KEYS: JSON.stringify(keys), DATA_DIR: dir, LOG_LEVEL: 'silent' });
  const store = await openStore(config);
  const row = store.create('alpha', body([customer('a'), customer('b')])).row;
  store.claim(); store.append(row.id, 0, { index: 0, customer: customer('a'), checkedAt: new Date().toISOString(), match });
  await store.close();
  let calls = 0;
  const app = await buildApp(config, async () => ({ find: async () => { calls++; return match; }, close: async () => {} }));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  assert.equal((await wait(app, row.id)).processed, 2); assert.equal(calls, 1);
});
test('enforces single instance per storage directory', async t => {
  const { config } = await setup(t);
  await assert.rejects(buildApp(config, async () => ({})), e => e.code === 'ELOCKED');
});
test('bounded queue and storage quotas, terminal deletion', async t => {
  const { app } = await setup(t, async ({ signal }) => ({ find: async () => { await delayed(signal); return match; }, close: async () => {} }), { maxPending: 1, maxStored: 1 });
  const id = (await submit(app)).json().id;
  assert.equal((await submit(app, [customer('2')])).statusCode, 429);
  await app.inject({ method: 'POST', url: `/v1/jobs/${id}/cancel`, headers });
  assert.equal((await submit(app)).json().error.code, 'STORAGE_QUOTA');
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/jobs/${id}`, headers })).statusCode, 204);
  assert.equal((await submit(app)).statusCode, 202);
});
test('rate limits even unauthenticated requests', async t => {
  const { app } = await setup(t, undefined, { rateLimit: 2 });
  await app.inject('/v1/jobs'); await app.inject('/v1/jobs');
  assert.equal((await app.inject('/v1/jobs')).statusCode, 429);
});
