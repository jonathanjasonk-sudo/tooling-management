# Tooling Manager

Sistem untuk melacak **posisi** dan **status** tooling produksi, mencatat tooling **on request**,
dan melihat total per style beserta pembagiannya per gedung — menggantikan file Excel
`DATA KETERSEDIAAN TOOLING`.

## Fitur
- **Dashboard**: total set, sebaran per gedung, status, tooling perlu perhatian, request berjalan, aktivitas terbaru.
- **Matriks Tooling**: tampilan seperti Excel (style × jenis × gedung). Klik angka untuk ubah jumlah/status/catatan atau **pindahkan** ke gedung lain.
- **Status per tooling**: Tersedia, Sedang Dipakai, Maintenance, Kurang Komponen, Rusak.
- **On Request**: ajukan → dalam pembuatan → siap → *terima ke stok* (otomatis masuk stok). Jumlah request ikut dihitung sebagai proyeksi total style.
- **Riwayat**: semua perubahan + nama operator.
- **Import Excel** (data awal, dengan pratinjau) dan **Export Excel** (susunan sama seperti file asli).
- Login password sederhana (`APP_PASSWORD`).

## Menjalankan di komputer
```bash
npm install
cp .env.example .env      # opsional
npm start                 # buka http://localhost:3000
```
Tanpa `DATABASE_URL`, data disimpan di folder `.data/` (database lokal). Di Railway otomatis memakai PostgreSQL.

## Push ke GitHub
```bash
git remote add origin https://github.com/<akun-anda>/<nama-repo>.git
git branch -M main
git push -u origin main
```

## Deploy ke Railway
1. Railway → **New Project** → **Deploy from GitHub repo** → pilih repo ini.
2. Di project yang sama: **+ New** → **Database** → **Add PostgreSQL**.
3. Buka service aplikasi → tab **Variables** → tambahkan:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference ke service Postgres)
   - `APP_PASSWORD` = password pilihan Anda
   - `SESSION_SECRET` = teks acak panjang
4. Tab **Settings → Networking → Generate Domain** untuk mendapatkan alamat web.
5. Buka alamat tersebut → login → menu **Data & Import** → unggah file Excel awal.

Setiap `git push` ke branch `main` akan otomatis ter-deploy ulang. Data aman di PostgreSQL.

## Struktur
```
server.js          API + login
src/db.js          PostgreSQL / database lokal + skema
src/importer.js    pembaca file Excel
src/exporter.js    pembuat file Excel
public/            tampilan (HTML, CSS, JS tanpa build)
```

## Catatan cara file Excel dibaca
- Angka diambil dari teks sel: `6SET (4SET U740 NOSEW)` → 6 set; `1SET (PM3000), 2SET(JT3000)` → 3 set; `-` → 0.
- Teks selain "N SET" disimpan sebagai **catatan**; yang mengandung "KURANG", "HANYA ADA", atau "(-…" otomatis berstatus *Kurang Komponen*.
- Style tanpa tooling di Excel tetap dibuat (kosong) supaya bisa diisi nanti.
