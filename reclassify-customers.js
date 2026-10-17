import fs from 'node:fs/promises';
import { classifyCustomer } from './lib/customer-match.js';
const file = 'hasil/customer-100/matches.json';
const d = JSON.parse(await fs.readFile(file, 'utf8'));
for (let i = 0; i < d.results.length; i++) {
  const r = d.results[i];
  if (/^(bapak|ibu|sdr|saudara)\b/i.test(r.customer)) {
    d.results[i] = { customer: r.customer, checkedAt: r.checkedAt, status: 'Perlu nama usaha', reason: 'Input hanya nama perseorangan; tambahkan nama usaha untuk mencari lokasi bisnis customer.', best: null, candidates: [] };
  } else if (r.status !== 'Pencarian gagal') {
    for (const c of r.candidates) if (c.lat != null && !c.coordinateSource) c.coordinateSource = 'URL detail Google Maps';
    const classified = classifyCustomer(r.customer, r.candidates);
    if (r.errors?.length) classified.reason += ' Sebagian detail kandidat gagal dimuat; daftar alternatif belum lengkap.';
    Object.assign(r, classified);
  }
}
await fs.writeFile(file, JSON.stringify(d, null, 2));
console.log(`Reclassified ${d.results.length} names from retained search records.`);
