import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createScraper } from './lib/scraper.js';

const args = process.argv.slice(2);
const query = args[0];
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Nilai ${name} wajib diisi.`);
  return args[index + 1];
}
function csv(value) {
  let s = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
let scraper;
try {
  if (!query || query.startsWith('--')) throw new Error('Contoh: npm run scrape -- "kost Solo" --limit 20 --out hasil/solo');
  const limit = Number(option('--limit', '20'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('--limit harus 1–200.');
  const out = path.resolve(option('--out', 'hasil/scrape'));
  scraper = await createScraper({ headless: !args.includes('--visible'), onLog: console.error });
  const records = [];
  const seen = new Set();
  for (let offset = 0; offset < limit; offset += 20) {
    const requested = Math.min(20, limit - offset);
    const batch = await scraper.fetchGoogleMapsPage(query, offset, { limit: requested });
    for (const item of batch) {
      const key = item.placeId || item.mapsUrl;
      if (!seen.has(key)) { records.push(item); seen.add(key); }
    }
    if (batch.length < requested) break;
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  const fields = ['placeId', 'name', 'category', 'address', 'phone', 'website', 'rating', 'reviewsCount', 'lat', 'lng', 'mapsUrl'];
  await fs.writeFile(`${out}.json`, JSON.stringify({ query, scrapedAt: new Date().toISOString(), total: records.length, records }, null, 2));
  await fs.writeFile(`${out}.csv`, '\uFEFF' + fields.map(csv).join(',') + '\n' + records.map(r => fields.map(f => csv(r[f])).join(',')).join('\n'));
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Businesses');
  sheet.columns = fields.map(key => ({ header: key, key, width: key === 'address' || key === 'mapsUrl' ? 55 : 24 }));
  sheet.addRows(records);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'K1' };
  await book.xlsx.writeFile(`${out}.xlsx`);
  console.log(`Tersimpan ${records.length} hasil: ${out}.{json,csv,xlsx}`);
} catch (error) {
  console.error(`${error.code || error.name}: ${error.message}`);
  process.exitCode = 1;
} finally { if (scraper) await scraper.close(); }
