# Mesin scraping lokal pengganti

Versi HTTP API tersedia. Lihat [API-README.md](API-README.md) untuk autentikasi, job queue, database, endpoint, backup dan deployment. Bagian di bawah menjelaskan CLI lama.

Implementasi baru berbasis browser Playwright. Ini bukan source mesin vendor yang dipulihkan. Dibuat terpisah agar hasil ekstraksi asli tetap utuh.

## Menjalankan

Buka PowerShell di folder ini:

```powershell
npm install
npm run scrape -- "kost Solo" --limit 20 --out hasil/kost-solo
```

Dependensi sudah terpasang di mesin ini. Program memakai Microsoft Edge yang sudah terinstal, dengan profil browser sementara terpisah dari profil pribadi. Playwright mendukung channel `msedge` dan `chrome`: https://playwright.dev/docs/browsers

Opsi:

- `--limit 20`: maksimal hasil, 1–200. Ini batas permintaan, bukan jaminan jumlah hasil.
- `--out hasil/kost-solo`: awalan nama tiga file output (.json, .csv, .xlsx).
- `--visible`: menampilkan browser saat proses berjalan.
- Untuk Chrome: `$env:SCRAPER_BROWSER='chrome'` sebelum menjalankan.

Jangan menjalankan dua pekerjaan sekaligus pada instance scraper yang sama. Tidak memerlukan API key atau server vendor. Skrip hanya membaca listing yang terlihat di browser; tidak mengunjungi website usaha.

## Data hasil

placeId, name, category, address, phone, website, rating, reviewsCount, lat, lng, mapsUrl. Data yang tidak tersedia tetap kosong/null. JSON juga mencatat query dan waktu pengambilan UTC. CSV dilindungi dari awalan formula spreadsheet.

## Penggunaan dari kode

```js
import { createScraper } from './lib/scraper.js';
const scraper = await createScraper({ onLog: console.log });
try {
  const page1 = await scraper.fetchGoogleMapsPage('kost Solo', 0);
  const page2 = await scraper.fetchGoogleMapsPage('kost Solo', 20);
} finally {
  await scraper.close();
}
```

`fetchGoogleMapsPage(query, offset)` juga diekspor langsung sesuai kontrak runner GMST. Versi langsung membuka dan menutup browser per pemanggilan. Factory di atas mempertahankan browser selama satu pekerjaan dan lebih efisien.

## Hubungan dengan aplikasi hasil ekstraksi

Modul ini kompatibel dengan `executeScrapePlan` di `analysis/source/lib/scrape-runner.js`. Runner tersebut menambahkan kota/provinsi dan perkiraan kampus/kantor terdekat. CLI mandiri ini tidak menambahkan lokasi administratif berdasarkan tebakan.

Dashboard Electron asli belum dihubungkan ke mesin baru. Startup versi paket memaksa mode client/VPS. Menambahkan file scraper saja tidak mengubah pilihan mode tersebut. Integrasi berikutnya perlu konfigurasi mode lokal, pemasangan dependensi, dan penanganan siklus hidup browser. Tidak ada perubahan pada aktivasi atau lisensi aplikasi asli dalam pekerjaan ini.

## Verifikasi

```powershell
npm test
```

- Pemeriksaan kontrak normalisasi, kecocokan runner asli, deduplikasi dan pembatalan.
- Uji langsung 2026-10-16: query `coffee Solo`, limit 3, berhasil mengambil Kopi Nako Solo, Solo Kopi, dan TETRA Coffee & Eatery - Solo. Hasil ada di `hasil/smoke-solo.*`.
- JSON dan Excel dibaca kembali untuk memeriksa jumlah baris serta nilai hasil.

## Batas yang diketahui

Google Maps saat uji menampilkan pesan limited view. Program tidak menjamin semua usaha atau seluruh halaman dapat diambil. Jika daftar tidak bertambah setelah beberapa kali scroll, program mencatat kondisi tersebut dan mengembalikan hasil yang tersedia. Offset adalah posisi pada daftar pencarian saat itu, bukan cursor permanen; urutan dapat berubah pada sesi berbeda.

Perubahan tampilan Google dapat memerlukan pembaruan selector. CAPTCHA/halaman persetujuan menghentikan proses dengan pesan error. Tidak ada pemecahan CAPTCHA, proxy rotation, atau mekanisme melewati pembatasan. Pembatalan AbortSignal diperiksa di antara operasi; navigasi yang sedang berjalan dapat menunggu timeout hingga 45 detik. Jika terjadi error, CLI keluar dengan kode gagal dan belum mengekspor hasil pekerjaan tersebut.
