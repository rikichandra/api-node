# Customer Maps Matching API v1

Dokumentasi HTML interaktif: buka `/docs` pada origin layanan, misalnya `http://127.0.0.1:3108/docs`. Halaman memuat panduan, contoh cURL/JavaScript/PowerShell, referensi endpoint dari kontrak, dan playground. Key dimasukkan sendiri dan tidak disimpan ke localStorage/sessionStorage. Playground membuat job nyata hanya setelah tombol kirim ditekan. Halaman serta `/docs/openapi.json` bersifat publik; endpoint `/v1` tetap membutuhkan API key.

API untuk mengirim daftar nama usaha, mencari kandidat lokasinya di Google Maps, dan mengambil progres/hasil melalui HTTP. Satu deployment menjalankan satu proses API dengan beberapa browser worker yang dibatasi. Data dan checkpoint disimpan di SQLite; setiap client hanya dapat melihat pekerjaannya sendiri.

## Jalankan di Windows

Node.js 24 dan Microsoft Edge diperlukan. Folder kerja: `scraper-local`.

```powershell
npm ci
npm start
```

File `.env` lokal sudah dibuat dengan key acak yang tidak ditampilkan di chat. Untuk instalasi baru, salin `.env.example` menjadi `.env`, lalu isi `API_KEYS` dengan secret acak minimal 32 karakter. Jangan gunakan nilai contoh. Buat key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Contoh format konfigurasi, dengan secret milik Anda:

```dotenv
API_KEYS={"internal":"SECRET_ACAK_ANDA","client-b":"SECRET_ACAK_CLIENT_B"}
HOST=127.0.0.1
PORT=3108
DATA_DIR=./storage
SCRAPER_BROWSER=msedge
```

Nama client (`internal`, `client-b`) adalah pemilik data yang stabil. Rotasi secret dengan mempertahankan nama client, kemudian restart. Key tidak disimpan di database atau dicatat dalam log request.

## Contoh pemakaian

Contoh PowerShell berikut membaca key dari lingkungan proses. Set `$env:CUSTOMER_MAPS_KEY` dari secret manager atau konfigurasi lokal Anda terlebih dahulu.

```powershell
$headers = @{ 'X-API-Key' = $env:CUSTOMER_MAPS_KEY; 'Idempotency-Key' = 'upload-customer-20261016-001' }
$payload = @{
  region = 'Sumatra Selatan'
  customers = @(
    @{ id = 'C001'; name = 'PT Bupala Alam Perkasa' }
    @{ id = 'C002'; name = 'PT Cakra Indo Pratama' }
  )
} | ConvertTo-Json -Depth 5
$job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3108/v1/jobs' -Headers $headers -ContentType 'application/json' -Body $payload
Invoke-RestMethod -Uri "http://127.0.0.1:3108/v1/jobs/$($job.id)" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:3108/v1/jobs/$($job.id)/results?offset=0&limit=100" -Headers $headers
```

Input berupa JSON, bukan upload Excel. Untuk data Excel, gunakan nomor baris atau kode customer sebagai `id` dan nama usaha sebagai `name`. `id` wajib unik dalam satu pekerjaan. Nama yang sama tetap menghasilkan baris terpisah sehingga dapat digabungkan kembali ke data asal. Batas: 1000 customer dan 256 KiB per request. Mulailah dengan batch 100.

Wilayah dapat diisi nama provinsi/kota. Pencocokan wilayah mengandalkan teks alamat; alias Sumatra/Sumatera Selatan dan South Sumatra didukung. Untuk wilayah lain, tulis nama yang biasa muncul pada alamat Maps. Identitas customer tidak otomatis terverifikasi hanya karena nama dan wilayah sama.

## Endpoint

| Endpoint | Fungsi |
| --- | --- |
| `POST /v1/jobs` | Antrekan pekerjaan; respons 202 dan header Location. |
| `GET /v1/jobs` | Daftar pekerjaan client pemilik key. |
| `GET /v1/jobs/{id}` | Status, total baris, processed dan jumlah error. |
| `GET /v1/jobs/{id}/results` | Hasil parsial/final; urut menurut index input. |
| `POST /v1/jobs/{id}/cancel` | Batalkan queued/running; hasil yang sudah tersimpan tetap tersedia. |
| `DELETE /v1/jobs/{id}` | Hapus pekerjaan terminal dan hasilnya; queued/running menghasilkan 409. |
| `GET /v1/openapi.json` | Kontrak OpenAPI; perlu key. |
| `GET /health/live` | Proses hidup; tanpa key. |
| `GET /health/ready` | SQLite/antrean siap dan tidak sedang cooldown; tanpa key. |

Daftar dan hasil memakai `offset` (default 0) dan `limit` (default 100, maksimal 200). `results.total` adalah jumlah baris yang sudah diproses, bukan jumlah customer yang sudah cocok. Hasil dapat dibaca ketika pekerjaan masih berjalan. Baris hasil berisi `index`, `customer`, `checkedAt`, `match`, dan `errorCode` jika gagal.

Status pekerjaan:

- `queued`, `running`: masih menunggu/berjalan.
- `succeeded`: seluruh baris selesai dievaluasi; customer tanpa kandidat tetap merupakan evaluasi yang berhasil.
- `partial`: seluruh baris dievaluasi tetapi sebagian pencarian gagal.
- `blocked`: Google meminta CAPTCHA/persetujuan; progres tersimpan dan antrean dijeda.
- `failed`: browser gagal dibuat atau batas waktu pekerjaan terlampaui.
- `cancelled`: dibatalkan pengguna; progres tersimpan.

`match.best` adalah usulan kandidat, bukan keputusan identitas customer. `match.candidates` memuat maksimal tiga kandidat yang detailnya berhasil dibaca. Data tidak tersedia tetap null/kosong. Koordinat berasal dari URL detail atau dialog Embed milik lokasi yang dipilih, bukan pusat viewport. Nama perseorangan yang belum menyebut usaha dikembalikan sebagai perlu nama usaha.

Error HTTP berbentuk `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. 400 untuk input, 401 untuk key, 404 untuk pekerjaan tidak ditemukan/tidak dimiliki, 409 untuk konflik idempotensi/pekerjaan aktif, 413 untuk body terlalu besar, 429 untuk batas permintaan/antrean/penyimpanan, 503 untuk cooldown atau shutdown. Detail stack/internal tidak dikirim ke caller.

## Idempotensi dan restart

`Idempotency-Key` opsional, 8–128 karakter ASCII terlihat. Key yang sama pada client yang sama dan body yang sama mengembalikan job yang sama; body berbeda menghasilkan 409. Key disimpan selama job masih ada. Setelah job dihapus atau expired, key bisa digunakan kembali.

Checkpoint setiap baris dan penghitung progres ditulis dalam transaksi SQLite. Setelah restart, pekerjaan running kembali queued dan hanya index yang belum tersimpan yang dijalankan. Operasi browser terakhir dapat diulang jika proses mati sebelum commit; jangan menganggap aktivitas browser exactly-once. Urutan/input id dan hasil yang sudah commit tetap terjaga.

SIGTERM/SIGINT menutup browser dan mengantrekan kembali pekerjaan aktif. Timeout total dihitung sejak pekerjaan pertama kali dimulai, termasuk waktu setelah restart. Setelah crash keras, lock proses bisa membutuhkan hingga 30 detik untuk dianggap stale. Jangan hapus lock aktif. Direktori data hanya boleh dipakai satu proses layanan; jangan jalankan PM2 cluster atau beberapa replika dengan direktori yang sama.

## Batas dan operasi

Default konfigurasi tersedia di `.env.example`:

- Worker 1; maksimal 4. Mulai dengan 1 dan pantau memori browser.
- Maksimal 50 pekerjaan aktif, 10 per client, 1000 tersimpan.
- Timeout pekerjaan 30 menit; cooldown Google 5 menit.
- Retensi hasil 7 hari; pembersihan saat startup dan setiap jam.
- Rate limit 120 request/menit per alamat koneksi, termasuk request tanpa autentikasi. Header X-Forwarded-For tidak dipercaya. Jika memakai reverse proxy, alamat yang terlihat adalah alamat proxy; atur juga pembatasan di proxy sesuai kebutuhan.

Jika diblokir Google, pekerjaan menjadi terminal `blocked`. Antrean yang belum berjalan menunggu cooldown. Tidak ada retry CAPTCHA atau upaya melewati persetujuan. Untuk mengulang pekerjaan blocked setelah kondisi pulih, buat pekerjaan baru dengan idempotency key baru. Error timeout per customer disimpan sebagai kegagalan baris dan worker melanjutkan baris berikutnya; tidak ada retry tanpa batas.

Log JSON memuat metadata request, bukan body customer atau API key. Simpan log dengan rotasi dan pantau health, errorCode pekerjaan, disk serta jumlah pending. SQLite menyimpan data customer dalam plaintext di disk: batasi hak akses volume, gunakan enkripsi disk/volume dan backup sesuai kebutuhan operasional.

## Docker dan HTTPS

```sh
docker compose up -d --build
docker compose logs -f api
```

Compose memerlukan `.env` yang berisi API_KEYS, memakai volume persisten, proses non-root, init, seccomp Chromium, shared memory 1 GiB, limit memori 2 GiB/CPU 2 dan rotasi log. Port dipublikasikan hanya pada loopback host. Gunakan reverse proxy HTTPS sebelum akses dari luar; contoh konfigurasi Caddy disediakan di `deploy/Caddyfile.example`. Ganti domain dan arahkan DNS ke server. Caddyfile ini untuk Caddy yang berjalan di host, bukan container lain.

Profil seccomp disalin dari Microsoft Playwright: https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json . Hash salinan: `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`. Pengaturan Chromium sandbox mengikuti https://playwright.dev/docs/docker . Host Linux harus mendukung user namespaces; startup sengaja gagal bila browser/sandbox tidak bisa berjalan.

Dockerfile memasang Chromium yang cocok dengan versi Playwright di lockfile, bukan mengandalkan browser di host. Pin digest image dasar pada deployment yang memerlukan build sepenuhnya tetap. Docker belum dibangun/dijalankan dalam workspace ini karena daemon/CLI Docker tidak tersedia. Jalankan smoke test pada server target sebelum menerima trafik produksi.

## Backup

```powershell
npm run backup -- backups/jobs-20261016.sqlite
```

Backup memakai SQLite online backup API sehingga snapshot konsisten walaupun WAL aktif. Simpan backup di lokasi terpisah dan batasi akses. Pada container, jalankan `node api/backup.js /app/storage/backup.sqlite`, lalu salin snapshot keluar; hapus snapshot lama setelah transfer bila tidak diperlukan. Untuk restore: hentikan layanan, gunakan direktori/volume data baru, salin snapshot sebagai `jobs.sqlite`, lalu mulai satu instance dengan nama client yang sama. Uji restore secara berkala.

## Pengujian dan batas bukti

```powershell
npm test
npm audit --omit=dev
npm run contract
```

Pengujian API memakai matcher terkontrol untuk memeriksa auth, ownership, validasi, idempotensi, antrean, paging, pembatalan, timeout, error parsial, circuit breaker dan pemulihan running/checkpoint. Pengujian ini membuktikan perilaku layanan, bukan kestabilan Google. Dua pengujian kompatibilitas runner historis otomatis dilewati jika folder analisis installer tidak tersedia; pengujian API berdiri sendiri.

Uji HTTP langsung pada Windows berhasil untuk satu customer nyata dan koordinat, serta readiness diperiksa dengan Postman CLI (dua assertion). Hasil 100 baris sebelumnya menguji mesin batch pendahulu, bukan load test API produksi. Belum ada pengukuran beban jangka panjang atau uji Docker/Linux. Perubahan tampilan Google, pembatasan hasil dan CAPTCHA tetap dapat menyebabkan hasil parsial atau pekerjaan blocked.

Untuk beberapa replika atau throughput tinggi, pindahkan antrean ke layanan bersama dan penyimpanan ke database server, dengan lease/recovery worker yang sesuai. Versi ini ditujukan untuk satu server/instance.
