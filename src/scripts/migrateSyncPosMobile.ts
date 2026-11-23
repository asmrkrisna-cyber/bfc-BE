import pool from '../config/database';

export const runSyncMigration = async () => {
  const conn = await pool.getConnection();
  try {
    console.log('[Migration] Memulai migrasi sinkronisasi POS ↔ Mobile ↔ Backend...');

    // 1. Sesuaikan tabel discounts
    const [discountCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discounts'
    `);
    const discountColNames = discountCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!discountColNames.includes('title')) {
      await conn.query(`ALTER TABLE discounts ADD COLUMN title VARCHAR(150) NULL AFTER name`);
      await conn.query(`UPDATE discounts SET title = name WHERE title IS NULL`);
      console.log('[Migration] discounts.title ditambahkan');
    }

    if (!discountColNames.includes('description')) {
      await conn.query(`ALTER TABLE discounts ADD COLUMN description TEXT NULL AFTER title`);
      console.log('[Migration] discounts.description ditambahkan');
    }

    if (!discountColNames.includes('max_discount')) {
      await conn.query(`ALTER TABLE discounts ADD COLUMN max_discount INT NULL AFTER min_purchase`);
      console.log('[Migration] discounts.max_discount ditambahkan');
    }

    if (!discountColNames.includes('updated_at')) {
      await conn.query(`ALTER TABLE discounts ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      console.log('[Migration] discounts.updated_at ditambahkan');
    }

    // Set max_discount default untuk BREAK20 jika ada
    await conn.query(`UPDATE discounts SET max_discount = 10000, description = 'Diskon 20% buat jedamu (Min. Rp30.000, Maks. Rp10.000)' WHERE code = 'BREAK20' AND (max_discount IS NULL OR max_discount = 0)`);

    // 2. Sesuaikan tabel products
    const [productCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
    `);
    const productColNames = productCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!productColNames.includes('is_available')) {
      await conn.query(`ALTER TABLE products ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 1`);
      console.log('[Migration] products.is_available ditambahkan');
    }

    // 3. Sesuaikan tabel transactions
    const [trxCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'
    `);
    const trxColNames = trxCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!trxColNames.includes('order_number')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN order_number VARCHAR(50) NULL AFTER transaction_id`);
      console.log('[Migration] transactions.order_number ditambahkan');
    }

    if (!trxColNames.includes('order_source')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN order_source ENUM('POS', 'MOBILE') DEFAULT 'POS' AFTER order_number`);
      console.log('[Migration] transactions.order_source ditambahkan');
    }

    if (!trxColNames.includes('order_type')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN order_type VARCHAR(50) DEFAULT 'DINE_IN' AFTER order_source`);
      console.log('[Migration] transactions.order_type ditambahkan');
    }

    if (!trxColNames.includes('voucher_code')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN voucher_code VARCHAR(50) NULL AFTER discount_amount`);
      console.log('[Migration] transactions.voucher_code ditambahkan');
    }

    if (!trxColNames.includes('voucher_discount')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN voucher_discount INT DEFAULT 0 AFTER voucher_code`);
      console.log('[Migration] transactions.voucher_discount ditambahkan');
    }

    if (!trxColNames.includes('points_discount')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN points_discount INT DEFAULT 0 AFTER points_used`);
      console.log('[Migration] transactions.points_discount ditambahkan');
    }

    if (!trxColNames.includes('tax_amount')) {
      await conn.query(`ALTER TABLE transactions ADD COLUMN tax_amount INT DEFAULT 0 AFTER tax`);
      console.log('[Migration] transactions.tax_amount ditambahkan');
    }

    // 4. Sesuaikan tabel transaction_items
    const [trxItemCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_items'
    `);
    const trxItemColNames = trxItemCols.map((c: any) => c.COLUMN_NAME.toLowerCase());

    if (!trxItemColNames.includes('product_id')) {
      await conn.query(`ALTER TABLE transaction_items ADD COLUMN product_id VARCHAR(50) NULL AFTER transaction_id`);
      console.log('[Migration] transaction_items.product_id ditambahkan');
    }

    if (!trxItemColNames.includes('subtotal_item')) {
      await conn.query(`ALTER TABLE transaction_items ADD COLUMN subtotal_item INT DEFAULT 0 AFTER quantity`);
      console.log('[Migration] transaction_items.subtotal_item ditambahkan');
    }

    if (!trxItemColNames.includes('created_at')) {
      await conn.query(`ALTER TABLE transaction_items ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log('[Migration] transaction_items.created_at ditambahkan');
    }

    console.log('[Migration] Migrasi skema database berhasil diselesaikan.');
  } catch (err: any) {
    console.error('[Migration Error]:', err.message);
    throw err;
  } finally {
    conn.release();
  }
};

// Jalankan jika dieksekusi langsung
if (require.main === module) {
  runSyncMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
