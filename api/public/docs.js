const $ = id => document.getElementById(id);
const base = location.origin;
$('base-url').textContent = base;
const sample = { region: 'Sumatra Selatan', customers: [{ id: 'C001', name: 'PT Bupala Alam Perkasa' }, { id: 'C002', name: 'PT Cakra Indo Pratama' }] };
const json = JSON.stringify(sample, null, 2);
const continuation = String.fromCharCode(92);
const examples = {
  curl: [`curl -X POST '${base}/v1/jobs'`, "  -H 'X-API-Key: YOUR_API_KEY'", "  -H 'Content-Type: application/json'", "  -H 'Idempotency-Key: customer-upload-001'", `  -d '${json}'`].join(` ${continuation}\n`),
  javascript: `const response = await fetch('${base}/v1/jobs', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'customer-upload-001'
  },
  body: JSON.stringify(${json})
});
const job = await response.json();
if (!response.ok) throw new Error(job.error?.message);
console.log(job.id); // Gunakan untuk cek status dan hasil.`,
  powershell: `$headers = @{
  'X-API-Key' = 'YOUR_API_KEY'
  'Idempotency-Key' = 'customer-upload-001'
}
$body = @'
${json}
'@
$job = Invoke-RestMethod -Method Post ${String.fromCharCode(96)}
  -Uri '${base}/v1/jobs' ${String.fromCharCode(96)}
  -Headers $headers -ContentType 'application/json' -Body $body

Invoke-RestMethod -Headers $headers ${String.fromCharCode(96)}
  -Uri "${base}/v1/jobs/$($job.id)/results?offset=0&limit=100"`
};
function language(name) {
  $('request-code').textContent = examples[name]; $('code-language').textContent = name.toUpperCase();
  $('example-panel').setAttribute('aria-labelledby', `tab-${name}`);
  document.querySelectorAll('[data-language]').forEach(b => { const active = b.dataset.language === name; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
}
language('curl');
document.querySelectorAll('[data-language]').forEach(b => b.addEventListener('click', () => language(b.dataset.language)));
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200); }
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); toast('Disalin ke clipboard'); } catch { toast('Tidak dapat menyalin. Pilih teks lalu salin manual.'); }
}));
fetch('/health/ready', { cache: 'no-store' }).then(r => {
  $('health-dot').classList.add(r.ok ? 'ready' : 'unavailable'); $('health-text').textContent = r.ok ? 'Layanan siap' : 'Layanan sedang tidak siap';
}).catch(() => { $('health-dot').classList.add('unavailable'); $('health-text').textContent = 'Layanan tidak terjangkau'; });
const descriptions = {
  createJob: 'Kirim daftar customer. Terima job ID melalui respons 202.', listJobs: 'Lihat daftar pekerjaan milik client Anda.',
  getJob: 'Periksa status, total input, progres dan jumlah error.', deleteJob: 'Hapus job terminal beserta hasilnya. Batalkan job aktif terlebih dahulu.',
  getResults: 'Ambil hasil parsial atau final dengan offset dan limit.', cancelJob: 'Batalkan pekerjaan; pertahankan hasil yang sudah tersimpan.',
  getContract: 'Ambil kontrak OpenAPI untuk tooling integrasi.', liveness: 'Periksa apakah proses hidup.', readiness: 'Periksa apakah layanan siap menerima pekerjaan.'
};
fetch('/docs/openapi.json').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(spec => {
  const container = $('endpoint-list'); container.replaceChildren();
  Object.entries(spec.paths).forEach(([path, methods]) => Object.entries(methods).forEach(([method, operation]) => {
    if (!['get', 'post', 'delete', 'put', 'patch'].includes(method)) return;
    const card = document.createElement('article'); card.className = 'endpoint';
    const top = document.createElement('div'); top.className = 'endpoint-top';
    const badge = document.createElement('span'); badge.className = `method ${method}`; badge.textContent = method.toUpperCase();
    const route = document.createElement('code'); route.textContent = path;
    const auth = document.createElement('span'); auth.className = 'auth-label'; auth.textContent = operation.security?.length === 0 ? 'Publik' : 'API key';
    top.append(badge, route, auth); const text = document.createElement('p'); text.textContent = descriptions[operation.operationId] || operation.description || '';
    card.append(top, text); container.append(card);
  }));
}).catch(() => { $('endpoint-list').textContent = 'Kontrak belum bisa dimuat. Muat ulang halaman ketika layanan siap.'; });
const buttons = ['submit-job', 'get-status', 'get-results'];
async function request(method, pathname, body, idempotency) {
  const key = $('api-key').value.trim();
  if (!key) { $('api-key').focus(); toast('Masukkan API key terlebih dahulu.'); return; }
  buttons.forEach(id => { $(id).disabled = true; }); $('http-status').textContent = 'Mengirim…';
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = { 'X-API-Key': key };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotency) headers['Idempotency-Key'] = idempotency;
    const response = await fetch(pathname, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal, cache: 'no-store', redirect: 'error' });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { response: text }; }
    $('http-status').textContent = `${response.status} ${response.statusText}`; $('api-response').textContent = JSON.stringify(data, null, 2);
    if (response.ok && method === 'POST' && data.id) $('job-id').value = data.id;
  } catch (error) {
    $('http-status').textContent = 'Request gagal';
    $('api-response').textContent = error.name === 'AbortError' ? 'Request melewati batas 20 detik. Job mungkin sudah dibuat; kirim ulang dengan Idempotency-Key yang sama.' : 'Tidak dapat menghubungi API. Periksa jaringan dan status layanan.';
  } finally { clearTimeout(timeout); buttons.forEach(id => { $(id).disabled = false; }); }
}
$('submit-job').addEventListener('click', () => {
  let body; try { body = JSON.parse($('request-body').value); } catch { toast('Body JSON belum valid.'); $('request-body').focus(); return; }
  if (!$('idem-key').value.trim()) $('idem-key').value = `docs-${crypto.randomUUID()}`;
  void request('POST', '/v1/jobs', body, $('idem-key').value.trim());
});
function jobPath(suffix) {
  const id = $('job-id').value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) { $('job-id').focus(); toast('Masukkan job ID yang valid.'); return null; }
  return `/v1/jobs/${id}${suffix}`;
}
$('get-status').addEventListener('click', () => { const path = jobPath(''); if (path) void request('GET', path); });
$('get-results').addEventListener('click', () => { const path = jobPath('/results?offset=0&limit=100'); if (path) void request('GET', path); });
$('clear-key').addEventListener('click', () => { $('api-key').value = ''; toast('API key dihapus dari halaman.'); });
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
}, { rootMargin: '-10% 0px -65% 0px' });
document.querySelectorAll('main section[id]').forEach(section => observer.observe(section));
