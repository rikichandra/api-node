import { chromium } from 'playwright';

export function normalizePlace(raw) {
  const mapsUrl = raw.url || '';
  const coordinate = mapsUrl.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
  const placeId = mapsUrl.match(/!19s([^!?#&]+)/)?.[1]
    || mapsUrl.match(/!1s([^!?#&]+)/)?.[1] || null;
  const labels = raw.labels || [];
  const ratingLabel = labels.find(s => /^[\d.,]+ stars?\b/i.test(s));
  const reviewsLabel = labels.find(s => /^[\d.,\s]+ reviews?\b/i.test(s));
  return {
    placeId: placeId ? decodeURIComponent(placeId) : null,
    name: (raw.name || '').trim(),
    address: (raw.address || '').replace(/^(Address|Alamat):\s*/i, '').trim(),
    phone: (raw.phone || '').replace(/^(Phone|Telepon):\s*/i, '').trim(),
    website: raw.website || '',
    category: (raw.category || '').trim(),
    rating: ratingLabel ? Number.parseFloat(ratingLabel.replace(',', '.')) : null,
    reviewsCount: reviewsLabel ? Number(reviewsLabel.split(/reviews?/i)[0].replace(/\D/g, '')) : null,
    lat: coordinate ? Number(coordinate[1]) : null,
    lng: coordinate ? Number(coordinate[2]) : null,
    mapsUrl
  };
}

async function checkBlock(page) {
  const text = await page.locator('body').innerText({ timeout: 15000 });
  if (/\/sorry\//.test(page.url()) || /unusual traffic|not a robot|verify you are human/i.test(text)) {
    throw Object.assign(new Error('Google meminta verifikasi. Proses dihentikan; tidak melewati CAPTCHA.'), { code: 'GOOGLE_BLOCKED' });
  }
  if (/consent\.google\./.test(page.url())) {
    throw Object.assign(new Error('Halaman persetujuan Google muncul. Pencarian belum bisa dibaca.'), { code: 'GOOGLE_CONSENT' });
  }
  return text;
}

export async function createScraper({ channel = process.env.SCRAPER_BROWSER || 'msedge', headless = true, delayMs = 1000, onLog = () => {} } = {}) {
  const browser = await chromium.launch({ channel, headless });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1365, height: 900 } });
  const search = await context.newPage();
  const detail = await context.newPage();
  search.setDefaultTimeout(15000);
  detail.setDefaultTimeout(15000);
  let currentQuery = null;
  let links = [];
  let exhausted = false;
  let busy = false;
  const cache = new Map();
  const abort = signal => {
    if (signal?.aborted) throw Object.assign(new Error('Scraping dibatalkan.'), { name: 'AbortError' });
  };

  return {
    async fetchGoogleMapsPage(query, offset = 0, { limit = 20, signal } = {}) {
      if (typeof query !== 'string' || !query.trim()) throw new TypeError('Query wajib diisi.');
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new RangeError('Offset harus bilangan bulat 0–1000.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Limit per halaman harus 1–20.');
      if (busy) throw new Error('Satu instance scraper hanya mendukung satu pekerjaan sekaligus.');
      busy = true;
      try {
        abort(signal);
        if (currentQuery !== query) {
          await search.goto(`https://www.google.com/maps/search/${encodeURIComponent(query.trim())}/?hl=en`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await checkBlock(search);
          await search.locator('a[href*="/maps/place/"], h1, [role="feed"]').first().waitFor({ timeout: 20000 });
          currentQuery = query;
          links = [];
          exhausted = false;
          cache.clear();
        }
        let unchanged = 0;
        for (let attempt = 0; links.length < offset + limit && !exhausted && attempt < 60; attempt++) {
          abort(signal);
          const before = links.length;
          const found = await search.locator('a[href*="/maps/place/"]').evaluateAll(es => es.map(e => e.href));
          links = [...new Set([...links, ...found])];
          if (links.length >= offset + limit) break;
          if (!links.length && await search.locator('h1').count()) {
            links = [search.url()];
            exhausted = true;
            break;
          }
          const text = await checkBlock(search);
          if (/You've reached the end of the list/i.test(text)) { exhausted = true; break; }
          unchanged = links.length === before ? unchanged + 1 : 0;
          if (unchanged >= 4) {
            exhausted = true;
            onLog(`Daftar berhenti bertambah pada ${links.length} hasil. Google dapat membatasi hasil yang ditampilkan.`);
            break;
          }
          const feed = search.locator('[role="feed"]').first();
          if (await feed.count()) await feed.evaluate(e => { e.scrollTop = e.scrollHeight; });
          else await search.mouse.wheel(0, 1800);
          await search.waitForTimeout(1200);
        }
        const results = [];
        for (const url of links.slice(offset, offset + limit)) {
          abort(signal);
          if (cache.has(url)) { results.push(cache.get(url)); continue; }
          await detail.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await checkBlock(detail);
          await detail.locator('h1').first().waitFor();
          // Detail rows can arrive after the heading. Wait for a data row or the timeout.
          await detail.locator('[data-item-id], [role="img"][aria-label*="stars"]').first().waitFor({ timeout: 10000 }).catch(() => {});
          await detail.waitForTimeout(500);
          const raw = await detail.evaluate(() => {
            const row = selector => {
              const e = document.querySelector(selector);
              return e?.getAttribute('aria-label') || e?.textContent || '';
            };
            return {
              url: location.href,
              name: document.querySelector('h1')?.textContent,
              address: row('[data-item-id="address"]'),
              phone: row('[data-item-id^="phone:tel:"]'),
              website: document.querySelector('a[data-item-id="authority"]')?.href || '',
              category: [...document.querySelectorAll('button')].find(e => e.getAttribute('jsaction')?.includes('category'))?.textContent || '',
              labels: [...document.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute('aria-label'))
            };
          });
          const record = normalizePlace(raw);
          if (!record.name) throw new Error(`Nama usaha tidak ditemukan: ${url}`);
          cache.set(url, record);
          results.push(record);
          onLog(`${offset + results.length}. ${record.name}`);
          await detail.waitForTimeout(delayMs);
        }
        return results;
      } finally { busy = false; }
    },
    async close() { await browser.close(); }
  };
}

// Drop-in contract used by the recovered GMST runner; always release the browser.
export async function fetchGoogleMapsPage(query, offset = 0) {
  const scraper = await createScraper();
  try { return await scraper.fetchGoogleMapsPage(query, offset); }
  finally { await scraper.close(); }
}
