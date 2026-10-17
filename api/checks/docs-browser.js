// Optional browser QA. Run explicitly: node api/checks/docs-browser.js.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildApp } from '../app.js';
import { configFromEnv } from '../config.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maps-docs-browser-'));
const key = 'browser-qa-key-not-a-production-secret-0001';
let searches = 0;
const app = await buildApp(configFromEnv({ API_KEYS: JSON.stringify({ docs: key }), DATA_DIR: dir, LOG_LEVEL: 'silent' }), async () => ({
  find: async () => { searches++; return { status: 'Nama dan provinsi cocok', reason: 'Controlled browser test', best: { name: 'Test business', lat: -3, lng: 104 }, candidates: [] }; }, close: async () => {}
}));
let browser;
try {
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/docs`);
  await page.waitForFunction(() => document.querySelectorAll('.endpoint').length === 9);
  assert.equal(searches, 0);
  await fs.mkdir('storage/docs-qa', { recursive: true });
  await page.screenshot({ path: 'storage/docs-qa/desktop.png' });
  await page.locator('#tab-javascript').click();
  assert.match(await page.locator('#request-code').innerText(), /JSON\.stringify/);
  await page.locator('#tab-powershell').click();
  assert.match(await page.locator('#request-code').innerText(), /Invoke-RestMethod/);
  await page.locator('#submit-job').click();
  assert.equal(searches, 0);
  await page.locator('#api-key').fill(key);
  await page.locator('#submit-job').click();
  await page.waitForFunction(() => document.querySelector('#job-id').value.length === 36);
  await page.locator('#get-results').click();
  await page.waitForFunction(() => document.querySelector('#api-response').textContent.includes('"total": 2'));
  assert.equal(searches, 2);
  await page.locator('#get-status').click();
  await page.waitForFunction(() => document.querySelector('#api-response').textContent.includes('"status": "succeeded"'));
  const persisted = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  assert.deepEqual(persisted, { local: 0, session: 0 });
  await page.locator('#clear-key').click(); assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.locator('#request-body').fill('not json'); await page.locator('#submit-job').click();
  assert.match(await page.locator('#toast').innerText(), /JSON belum valid/);
  await page.locator('#playground').screenshot({ path: 'storage/docs-qa/playground.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${url}/docs`);
  await page.waitForFunction(() => document.querySelectorAll('.endpoint').length === 9);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  await page.screenshot({ path: 'storage/docs-qa/mobile.png' });
  assert.deepEqual(errors, []);
  console.log('Browser QA passed: docs/contract, language tabs, authenticated submit/status/results, empty key and invalid JSON guards, key clearing, no browser storage, responsive layout, no JS errors. Matcher is controlled; no Google lookup performed.');
} finally { await browser?.close(); await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
