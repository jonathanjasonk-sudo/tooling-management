# Tooling Manager

Sistem untuk melacak **posisi** dan **status** tooling produksi, mencatat tooling **on request**,
dan melihat total per style beserta pembagiannya per gedung — menggantikan file Excel
`DATA KETERSEDIAAN TOOLING`.

## Fitur
- **Dashboard**: total set, sebaran per gedung, status, tooling perlu perhatian, request berjalan, aktivitas terbaru.
- **Matriks Tooling**: tampilan seperti Excel (style × jenis × gedung). Klik angka untuk ubah jumlah/status/catatan atau **pindahkan** ke gedung lain.
- **Status per tooling**: Tersedia, Sedang Dipakai, Maintenance, Kurang Komponen, Rusak.
- **On Request**: ajukan → dalam pembuatan → siap → *terima ke stok* (otomatis masuk stok). PIC peminta otomatis mengikuti nama PIC di menu samping; request dalam pembuatan dapat direvisi. Jumlah request ikut dihitung sebagai proyeksi total style.
- **Riwayat**: perubahan dengan nama PIC, request, penambahan stok manual, dan detail baris pada impor Excel.
- Penambahan stok dan request mencatat PIC peminta serta PIC yang menambahkan/mencatat. Riwayat import Excel menyimpan rincian setiap baris.
- Tab **Data & Import** dan perubahan master data memerlukan password admin. Menghapus jenis tooling akan meminta konfirmasi; stok dan request yang terkait ikut dihapus, sedangkan riwayat aktivitas tetap tersimpan.
- **Import Excel** (data awal, dengan pratinjau) dan **Export Excel** (susunan sama seperti file asli).
- Login password sederhana (`APP_PASSWORD`).

## Menjalankan di komputer
```bash
npm install
cp .env.example .env      # opsional
npm start                 # buka http://localhost:3000
```
Tanpa `DATABASE_URL`, data disimpan di folder `.data/` (database lokal). Railway wajib memakai PostgreSQL; aplikasi akan menolak start jika `DATABASE_URL` belum diatur agar tidak menyimpan data ke disk sementara.

## Push ke GitHub
```bash
git remote add origin https://github.com/<akun-anda>/<nama-repo>.git
git branch -M main
git push -u origin main
```

## Deploy ke Railway
1. Railway → **New Project** → **Deploy from GitHub repo** → pilih repo ini.
2. Di project yang sama: **+ New** → **Database** → **Add PostgreSQL**.
3. Pastikan service PostgreSQL tetap ada di project. Buka service aplikasi → tab **Variables** → tambahkan:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference ke service PostgreSQL; sesuaikan `Postgres` dengan nama service database Anda)
   - `APP_PASSWORD` = password pilihan Anda
   - `SESSION_SECRET` = teks acak panjang
   - `TOOLING_ADMIN_PASSWORD` = password admin untuk membuka Data & Import dan mengelola master data. Tambah stok, request, impor, serta penerimaan request tetap memakai nama PIC; tambah stok manual tidak meminta password.
4. Tab **Settings → Networking → Generate Domain** untuk mendapatkan alamat web.
5. Buka alamat tersebut → login → menu **Data & Import** → unggah file Excel awal.

Setiap `git push` ke branch `main` akan otomatis ter-deploy ulang. Selama `DATABASE_URL` menunjuk ke service PostgreSQL yang sama dan database tidak dihapus, deploy kode tidak menghapus data. Jangan hapus service PostgreSQL atau mengubah referensi database. Data yang sebelumnya tersimpan di database lokal Railway tidak otomatis dipindahkan ke PostgreSQL; export dan import datanya setelah PostgreSQL tersambung.

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
