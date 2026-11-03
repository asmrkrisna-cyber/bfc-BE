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
