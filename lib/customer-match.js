export function nameTokens(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(x => x && !['pt', 'cv', 'persero', 'tbk', 'toko', 'ud', 'pd'].includes(x));
}

export function nameSimilarity(left, right) {
  const a = new Set(nameTokens(left));
  const b = new Set(nameTokens(right));
  if (!a.size || !b.size) return 0;
  return 2 * [...a].filter(t => b.has(t)).length / (a.size + b.size);
}

export function isSouthSumatra(record) {
  return /sumat(?:e)?ra selatan|south sumatra/i.test(record.address || '');
}

export function isRegion(record, region) {
  if (/^(sumat(?:e)?ra selatan|south sumatra)$/i.test(region.trim())) return isSouthSumatra(record);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const needle = norm(region);
  return Boolean(needle) && ` ${norm(record.address)} `.includes(` ${needle} `);
}

function legalForm(value) {
  return String(value || '').match(/\b(pt|cv|ud|pd)\b/i)?.[1].toLowerCase() || '';
}

export function classifyCustomer(name, candidates, region = 'Sumatra Selatan') {
  const sourceForm = legalForm(name);
  const rank = c => c.nameSimilarity + (c.regionMatch ? 0.15 : 0) - (c.legalFormConflict ? 0.3 : 0);
  const ranked = candidates.map(c => ({ ...c, nameSimilarity: nameSimilarity(name, c.name), regionMatch: isRegion(c, region),
    legalFormConflict: Boolean(sourceForm && legalForm(c.name) && sourceForm !== legalForm(c.name)) }))
    .sort((a, b) => rank(b) - rank(a));
  const relevant = ranked.filter(c => c.nameSimilarity >= 0.5);
  const best = relevant[0] || null;
  if (!best) return { status: 'Tidak ada kandidat sesuai', reason: candidates.length ? 'Nama hasil pencarian berbeda dari customer.' : 'Maps tidak menampilkan kandidat usaha.', best: null, candidates: ranked };
  const exactLocal = relevant.filter(c => c.nameSimilarity === 1 && c.regionMatch && !c.legalFormConflict);
  let status, reason;
  if (exactLocal.length > 1) {
    status = 'Beberapa lokasi; pilih cabang';
    reason = `Lebih dari satu lokasi memiliki nama sama di ${region}; perlu alamat customer.`;
  } else if (best.legalFormConflict) {
    status = 'Perlu verifikasi nama';
    reason = 'Bentuk badan usaha berbeda (misalnya PT dan CV); perlu alamat atau telepon customer.';
  } else if (!best.regionMatch) {
    status = 'Provinsi belum sesuai';
    reason = `Alamat kandidat tidak menyebut ${region}; jangan gunakan pin tanpa pemeriksaan.`;
  } else if (best.nameSimilarity === 1) {
    status = 'Nama dan provinsi cocok';
    reason = 'Nama cocok setelah mengabaikan PT/CV/Toko; identitas dan cabang customer belum terverifikasi.';
  } else {
    status = 'Perlu verifikasi nama';
    reason = 'Hanya sebagian nama yang sama; cocokkan alamat atau telepon customer.';
  }
  if (best.lat == null || best.lng == null) reason += ' Koordinat belum tersedia.';
  return { status, reason, best, candidates: ranked };
}
