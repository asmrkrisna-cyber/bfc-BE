import pool from '../config/database';

/**
 * Migrasi lengkap untuk:
 * 1. Google Sign-In & nomor HP opsional pada tabel customers (hapus default dummy)
 * 2. Tabel user_favorites (relasi favorit menu user <-> products)
 * 3. Kolom shift_id, cashier_name, cancel_reason pada transactions & mobile_orders
 */
export const runFullIntegrationMigration = async () => {
  const conn = await pool.getConnection();
  try {
    console.log('[Migration] Memulai migrasi Full Integration (Google Auth, Favorites, Shift & Cancel)...');

    // 1. Update skema tabel customers
    const [custCols]: any = await conn.query(`
      SELECT COLUMN_NAME, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
    `);
    const custColNames = custCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!custColNames.includes('google_id')) {
      await conn.query(`ALTER TABLE customers ADD COLUMN google_id VARCHAR(255) NULL UNIQUE AFTER email`);
      console.log('[Migration] customers.google_id ditambahkan');
    }

    if (!custColNames.includes('avatar_url')) {
      await conn.query(`ALTER TABLE customers ADD COLUMN avatar_url TEXT NULL AFTER google_id`);
      console.log('[Migration] customers.avatar_url ditambahkan');
    }

    // Hapus nilai default dummy di kolom phone & birth_date, serta izinkan password NULL untuk akun Google
    await conn.query(`ALTER TABLE customers MODIFY COLUMN phone VARCHAR(30) NULL DEFAULT NULL`);
    await conn.query(`ALTER TABLE customers MODIFY COLUMN birth_date VARCHAR(50) NULL DEFAULT NULL`);
    await conn.query(`ALTER TABLE customers MODIFY COLUMN password VARCHAR(255) NULL DEFAULT NULL`);
    await conn.query(`ALTER TABLE customers MODIFY COLUMN member_badge VARCHAR(50) NULL DEFAULT 'Member BreakFree'`);

    // Bersihkan data dummy lama yang tersimpan dari default sebelumnya
    await conn.query(`UPDATE customers SET phone = NULL WHERE phone = '0812 •••• 7890'`);
    await conn.query(`UPDATE customers SET birth_date = NULL WHERE birth_date = '18 Mei 2000'`);

    // 2. Buat tabel user_favorites jika belum ada
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_product (user_id, product_id),
        CONSTRAINT fk_user_favorites_user FOREIGN KEY (user_id) REFERENCES customers(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_favorites_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[Migration] Tabel user_favorites diverifikasi/dibuat');

    // 3. Tambah kolom shift_id, cashier_name, cancel_reason pada tabel transactions
    const [trxCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'
    `);
    const trxColNames = trxCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!trxColNames.includes('shift_id')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN shift_id INT NULL AFTER transaction_id`);
      console.log('[Migration] transactions.shift_id ditambahkan');
    }

    if (!trxColNames.includes('cashier_name')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN cashier_name VARCHAR(150) NULL AFTER shift_id`);
      console.log('[Migration] transactions.cashier_name ditambahkan');
    }

    if (!trxColNames.includes('cancel_reason')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER void_reason`);
      console.log('[Migration] transactions.cancel_reason ditambahkan');
    }

    await conn.query(`ALTER TABLE transactions MODIFY COLUMN status VARCHAR(30) NULL DEFAULT 'SUKSES'`);

    // 4. Tambah kolom shift_id, cashier_name, cancel_reason pada tabel mobile_orders & hapus default dummy barista_name
    const [moCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mobile_orders'
    `);
    const moColNames = moCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!moColNames.includes('shift_id')) {
      await conn.query(`ALTER TABLE mobile_orders ADD COLUMN shift_id INT NULL AFTER counter_name`);
      console.log('[Migration] mobile_orders.shift_id ditambahkan');
    }

    if (!moColNames.includes('cashier_name')) {
      await conn.query(`ALTER TABLE mobile_orders ADD COLUMN cashier_name VARCHAR(150) NULL AFTER shift_id`);
      console.log('[Migration] mobile_orders.cashier_name ditambahkan');
    }

    if (!moColNames.includes('cancel_reason')) {
      await conn.query(`ALTER TABLE mobile_orders ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER barista_note`);
      console.log('[Migration] mobile_orders.cancel_reason ditambahkan');
    }

    await conn.query(`ALTER TABLE mobile_orders MODIFY COLUMN barista_name VARCHAR(150) NULL DEFAULT NULL`);
    await conn.query(`ALTER TABLE mobile_orders MODIFY COLUMN barista_note VARCHAR(255) NULL DEFAULT NULL`);

    console.log('[Migration] Migrasi Full Integration selesai dengan sukses.');
  } catch (err: any) {
    console.error('[Migration Full Integration Error]:', err.message);
    throw err;
  } finally {
    conn.release();
  }
};

// Izinkan eksekusi mandiri via tsx
if (require.main === module) {
  runFullIntegrationMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
