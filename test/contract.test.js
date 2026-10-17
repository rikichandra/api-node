import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlace } from '../lib/scraper.js';
// Historical artifact comparison is optional outside the investigation workspace.
let executeScrapePlan;
try { ({ executeScrapePlan } = await import('../../analysis/source/lib/scrape-runner.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

test('normalizes Maps fields without inventing missing data', () => {
  const record = normalizePlace({
    name: ' Coffee Solo ', address: 'Address: Jalan Solo', phone: 'Phone: 0812-3456',
    labels: ['4.9 stars', '3,690 reviews', '5 stars, 300 reviews'],
    url: 'https://www.google.com/maps/place/Test/data=!1sabc!3d-7.56!4d110.80!19sChIJexample'
  });
  assert.equal(record.placeId, 'ChIJexample');
  assert.equal(record.name, 'Coffee Solo');
  assert.equal(record.rating, 4.9);
  assert.equal(record.reviewsCount, 3690);
  assert.equal(record.phone, '0812-3456');
  assert.equal(record.lat, -7.56);
  assert.equal(record.lng, 110.8);
  assert.equal(record.website, '');
  assert.equal(normalizePlace({}).rating, null);
  assert.equal(normalizePlace({}).reviewsCount, null);
  assert.equal(normalizePlace({}).lat, null);
});

test('replacement record contract works with the recovered runner and its deduplication', { skip: !executeScrapePlan }, async () => {
  const record = normalizePlace({ name: 'Coffee Solo', url: 'https://www.google.com/maps/place/Test/data=!3d-7.56!4d110.8!19sChIJexample' });
  const dataset = [];
  const batches = [];
  const ctx = {
    dataset, seen: new Set(),
    fetchPage: async () => [record, record],
    onBatch: batch => batches.push(batch)
  };
  const plan = { keyword: 'coffee', cityQueries: [{ city: 'Solo', queries: ['coffee Solo'] }], depth: 1 };
  const result = await executeScrapePlan(plan, ctx);
  assert.equal(result.newRecords.length, 1);
  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].city, 'Solo');
  assert.equal(dataset[0].category, 'coffee');
  assert.equal(dataset[0].province, 'Jawa Tengah');
  assert.equal(typeof dataset[0].nearestCampus, 'string');
  assert.equal(batches.length, 1);
  const repeat = await executeScrapePlan(plan, ctx);
  assert.equal(repeat.newRecords.length, 0);
});

test('runner respects cancellation before fetching', { skip: !executeScrapePlan }, async () => {
  let calls = 0;
  const result = await executeScrapePlan({ keyword: 'coffee', cityQueries: [{ city: 'Solo', queries: ['coffee Solo'] }], depth: 1 }, {
    dataset: [], seen: new Set(), shouldAbort: () => true,
    fetchPage: async () => { calls++; return []; }
  });
  assert.equal(calls, 0);
  assert.equal(result.aborted, true);
});
