import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { normalizePlace } from './lib/scraper.js';
import { nameSimilarity, classifyCustomer } from './lib/customer-match.js';

const dir = 'hasil/customer-100';
const sample = JSON.parse(await fs.readFile(`${dir}/sample.json`, 'utf8'));
let checkpoint = { region: sample.region, results: [], startedAt: new Date().toISOString(), sampleSource: 'sample.json' };
try { checkpoint = JSON.parse(await fs.readFile(`${dir}/matches.json`, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const key = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const completed = new Map(checkpoint.results.map(r => [key(r.customer), r]));
// Older checkpoints without the selected place's coordinates must be refreshed.
for (const [k, r] of completed) if (r.best && r.best.lat == null) completed.delete(k);
const queue = [...new Map(sample.rows.map(r => [key(r.name), r.name])).values()].filter(name => !completed.has(key(name)));
const max = Number(process.env.MATCH_MAX || queue.length);
const tasks = queue.slice(0, max);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let stopped = false;
let saveQueue = Promise.resolve();
function save() {
  saveQueue = saveQueue.then(async () => {
    checkpoint.updatedAt = new Date().toISOString();
    await fs.writeFile(`${dir}/matches.tmp.json`, JSON.stringify(checkpoint, null, 2));
    await fs.rename(`${dir}/matches.tmp.json`, `${dir}/matches.json`);
  });
  return saveQueue;
}

async function checkPage(page) {
  const text = await page.locator('body').innerText({ timeout: 15000 });
  if (/\/sorry\//.test(page.url()) || /unusual traffic|not a robot|verify you are human/i.test(text)) {
    throw Object.assign(new Error('Google meminta verifikasi; batch dihentikan.'), { code: 'GOOGLE_BLOCKED' });
  }
  if (/consent\.google\./.test(page.url())) throw Object.assign(new Error('Persetujuan Google diperlukan.'), { code: 'GOOGLE_CONSENT' });
  return text;
}

async function readPlace(page) {
  await page.locator('h1').first().waitFor({ timeout: 15000 });
  await page.locator('[data-item-id]').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const raw = await page.evaluate(() => {
    const row = selector => {
      const e = document.querySelector(selector);
      return e?.getAttribute('aria-label') || e?.textContent || '';
    };
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    return {
      url: canonical?.includes('/maps/') ? canonical : location.href,
      name: document.querySelector('h1')?.textContent,
      address: row('[data-item-id="address"]'), phone: row('[data-item-id^="phone:tel:"]'),
      website: document.querySelector('a[data-item-id="authority"]')?.href || '',
      category: [...document.querySelectorAll('button')].find(e => e.getAttribute('jsaction')?.includes('category'))?.textContent || '',
      labels: [...document.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute('aria-label')),
      actualUrl: location.href
    };
  });
  // Canonical URLs can be less specific than the visible place URL.
  let place = normalizePlace({ ...raw, url: raw.actualUrl });
  if (!place.placeId || place.lat == null) {
    const alternative = normalizePlace(raw);
    place = { ...place, placeId: place.placeId || alternative.placeId, lat: place.lat ?? alternative.lat, lng: place.lng ?? alternative.lng };
  }
  place.coordinateSource = place.lat == null ? '' : 'URL detail Google Maps';
  if (place.lat == null) {
    // Direct search results may leave a search URL in the address bar. Read the
    // selected business's Embed dialog instead; never use the viewport center.
    try {
      await page.getByRole('button', { name: 'Share', exact: true }).first().click({ timeout: 5000 });
      await page.getByText('Embed a map', { exact: true }).click({ timeout: 5000 });
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some(e => e.value.includes('/maps/embed?')), {}, { timeout: 8000 });
      const snippet = await page.locator('input').evaluateAll(es => es.map(e => e.value).find(s => s.includes('/maps/embed?')) || '');
      const longitude = snippet.match(/!2d(-?[\d.]+)/)?.[1];
      const latitude = snippet.match(/!3d(-?[\d.]+)/)?.[1];
      const identity = snippet.match(/!1s(0x[0-9a-f]+(?:%3A|:)0x[0-9a-f]+)/i)?.[1];
      if (latitude && longitude && identity) {
        const id = decodeURIComponent(identity);
        place.lat = Number(latitude);
        place.lng = Number(longitude);
        place.placeId = place.placeId || id;
        place.mapsUrl = `https://www.google.com/maps?cid=${BigInt(id.split(':')[1]).toString()}`;
        place.embedUrl = snippet.match(/src="([^"]+)"/)?.[1] || '';
        place.coordinateSource = 'Embed lokasi terpilih di Google Maps';
      } else place.coordinateError = 'Format embed tidak memuat koordinat dan ID lokasi.';
    } catch (e) { place.coordinateError = e.message.split('\n')[0]; }
  }
  return place;
}

async function findCustomer(page, name) {
  if (/^(bapak|ibu|sdr|saudara)\b/i.test(name)) {
    return { status: 'Perlu nama usaha', reason: 'Input hanya nama perseorangan; tambahkan nama usaha untuk mencari lokasi bisnis customer.', best: null, candidates: [] };
  }
  const query = `${name.replace(/\bPT\./gi, 'PT ').replace(/\bCV\./gi, 'CV ')} Sumatera Selatan Indonesia`;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/?hl=en`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await checkPage(page);
  // Wait for a place, list, or explicit no-results message. Errors remain errors.
  await page.waitForFunction(() => {
    const t = document.body?.innerText || '';
    return document.querySelector('[role="feed"] a[href*="/maps/place/"]')
      || (document.querySelector('h1') && document.querySelector('[data-item-id]'))
      || /can't find|couldn't find|No results found|did not match any locations/i.test(t);
  }, { }, { timeout: 25000 });
  const text = await checkPage(page);
  if (/can't find|couldn't find|No results found|did not match any locations/i.test(text)) {
    return { query, searchUrl, ...classifyCustomer(name, []) };
  }
  const candidates = [];
  if (await page.locator('[role="feed"]').count()) {
    await page.waitForTimeout(1000);
    const links = await page.locator('a[href*="/maps/place/"]').evaluateAll(es => es.map(e => ({ name: e.getAttribute('aria-label') || e.textContent, url: e.href })));
    const unique = [...new Map(links.map(l => [l.url, l])).values()];
    const ranked = unique.map(l => ({ ...l, sim: nameSimilarity(name, l.name) })).sort((a, b) => b.sim - a.sim);
    // Inspect at most three closest named results, keeping alternatives for branch review.
    const selected = ranked.filter(l => l.sim >= 0.5).slice(0, 3);
    const errors = [];
    for (const link of selected) {
      await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await checkPage(page);
      try { candidates.push(await readPlace(page)); }
      catch (e) { errors.push({ url: link.url, message: e.message }); }
      await page.waitForTimeout(1000);
    }
    const result = classifyCustomer(name, candidates);
    if (!selected.length && unique.length) result.reason = 'Maps menampilkan hasil, tetapi nama kandidat tidak cukup sesuai.';
    if (errors.length && !candidates.length) return { query, searchUrl, status: 'Pencarian gagal', reason: 'Detail kandidat gagal dimuat.', best: null, candidates: [], discovered: unique, errors };
    if (errors.length) result.reason += ' Sebagian detail kandidat gagal dimuat; daftar alternatif belum lengkap.';
    return { query, searchUrl, ...result, discovered: unique, errors };
  }
  candidates.push(await readPlace(page));
  return { query, searchUrl, ...classifyCustomer(name, candidates) };
}

async function worker(id) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    while (tasks.length && !stopped) {
      const name = tasks.shift();
      let result;
      try { result = await findCustomer(page, name); }
      catch (e) {
        result = { status: 'Pencarian gagal', reason: e.message.split('\n')[0], code: e.code || e.name, best: null, candidates: [] };
        if (['GOOGLE_BLOCKED', 'GOOGLE_CONSENT'].includes(e.code)) stopped = true;
      }
      const row = { customer: name, checkedAt: new Date().toISOString(), ...result };
      checkpoint.results = checkpoint.results.filter(r => key(r.customer) !== key(name));
      checkpoint.results.push(row);
      completed.set(key(name), row);
      await save();
      console.log(`[${completed.size}/${new Set(sample.rows.map(r => key(r.name))).size}] ${name}: ${row.status}${row.best ? ` — ${row.best.name}` : ''}`);
      await page.waitForTimeout(1500);
    }
  } finally { await context.close(); }
}

try {
  console.log(`Mencari ${tasks.length} nama unik tersisa; region ${sample.region}.`);
  await Promise.all([worker(1), worker(2)]);
} finally {
  await saveQueue;
  await browser.close();
}
console.log(JSON.stringify({ completedNames: completed.size, sampleRows: sample.rows.length, stopped }));
