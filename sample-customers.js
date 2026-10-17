import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const input = JSON.parse(await fs.readFile('data/customer-input.json', 'utf8'));
const shuffled = [...input.rows];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = crypto.randomInt(i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = {
  source: input.source, sheet: input.sheet, populationRows: input.rows.length,
  sampledAt: new Date().toISOString(), region: 'Sumatra Selatan',
  sampling: '100 baris tanpa pengembalian; pengulangan nama dalam sumber dipertahankan',
  rows: shuffled.slice(0, 100).map((r, i) => ({ sampleNo: i + 1, ...r }))
};
await fs.mkdir('hasil/customer-100', { recursive: true });
await fs.writeFile('hasil/customer-100/sample.json', JSON.stringify(sample, null, 2));
console.log(`Sample: ${sample.rows.length} baris; ${new Set(sample.rows.map(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, ''))).size} nama unik ternormalisasi.`);
console.log(sample.rows.slice(0, 5));
