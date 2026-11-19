# BreakFree POS - Backend API (bfc-BE)

Backend API untuk sistem kasir BreakFree Coffee Hub berbasis Node.js, Express, TypeScript, dan MySQL.

## Prasyarat
- **Node.js**: v18 atau v20+
- **MySQL Database**: v8.0+ atau MariaDB (misalnya via XAMPP / Laragon / Docker)

---

## Panduan Instalasi & Menjalankan

### 1. Clone Repositori & Masuk Direktori
```bash
git clone https://github.com/asmrkrisna-cyber/bfc-BE.git
cd bfc-BE
```

### 2. Install Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Sesuaikan kredensial database di dalam `.env` jika diperlukan:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=breakfree
JWT_SECRET=rahasiabanget123
```

### 4. Setup Database MySQL
Buat database dan impor tabel beserta data awal menggunakan file `schema.sql`:
- **Lewat Terminal:**
  ```bash
  mysql -u root -p < schema.sql
  ```
- **Atau lewat phpMyAdmin:** Buka tab *Import* dan pilih file `schema.sql`.

### 5. Jalankan Server
- **Mode Development (Hot-Reload):**
  ```bash
  npm run dev
  ```
- **Mode Production:**
  ```bash
  npm run build
  npm start
  ```
Server akan aktif di `http://localhost:5000`.

---

## Daftar Endpoint API Terpadu

### A. Endpoint Kasir POS (`/api/v1/...`)
- **Autentikasi Kasir:** `POST /api/v1/auth/login`
- **Produk POS:** `GET|POST /api/v1/products`, `PUT|PATCH|DELETE /api/v1/products/:id`
- **Shift Kasir:** `POST /api/v1/shifts/start`, `POST /api/v1/shifts/close`, `GET /api/v1/shifts/active`
- **Transaksi POS:** `POST /api/v1/transactions`, `GET /api/v1/transactions`, `PATCH /api/v1/transactions/:id/void`
- **Antrean Dapur (Kitchen):** `GET /api/v1/kitchen-orders`, `PATCH /api/v1/kitchen-orders/:id/status`

### B. Endpoint Mobile Pelanggan (`/api/v1/mobile/...`)
- **Autentikasi Member:**
  - `POST /api/v1/mobile/auth/register` - Pendaftaran member baru (+100 poin bonus)
  - `POST /api/v1/mobile/auth/login` - Masuk akun member
  - `POST /api/v1/mobile/auth/forgot-password` - Minta kode OTP reset kata sandi
  - `POST /api/v1/mobile/auth/reset-password` - Verifikasi OTP dan set kata sandi baru
- **Profil & Poin Cashback:**
  - `GET /api/v1/mobile/profile/me` - Ambil profil member (nama, poin, badge)
  - `PUT /api/v1/mobile/profile/me` - Perbarui profil (nama, telepon, tanggal lahir)
  - `GET /api/v1/mobile/profile/points` - Riwayat perolehan & penukaran poin
- **Katalog Menu Mobile:**
  - `GET /api/v1/mobile/products` - Filter berdasarkan kategori, subkategori, dan kata kunci
  - `GET /api/v1/mobile/products/categories` - Hierarki kategori menu & jumlah item
- **Promo & Voucher:**
  - `POST /api/v1/mobile/promos/validate` - Validasi kode promo (BREAK20, KOPIKAMPUS, dll)
- **Pesanan & Live Tracking:**
  - `POST /api/v1/mobile/orders/checkout` - Buat pesanan (otomatis sinkron ke antrean dapur POS & hitung cashback poin)
  - `GET /api/v1/mobile/orders/active` - Ambil pesanan aktif yang sedang dibuat
  - `GET /api/v1/mobile/orders/history` - Riwayat pesanan selesai
  - `GET /api/v1/mobile/orders/:id/track` - Live tracking status pesanan per tahapan
  - `PATCH /api/v1/mobile/orders/:id/status` - Ubah status pesanan (diterima, diproses, siapDiambil, selesai)
- **AI Barista Chatbot:**
  - `POST /api/v1/mobile/ai-chat/message` - Obrolan cerdas rekomendasi menu, preferensi lambung, promo, dan info kafe

