import pool from '../config/database';

export const runPointsMigration = async () => {
  const connection = await pool.getConnection();
  try {
    console.log('[Migration] Starting points & cashback migration...');

    // 1. Pastikan kolom points di tabel customers
    const [customerCols]: any = await connection.query("SHOW COLUMNS FROM customers LIKE 'points'");
    if (customerCols.length === 0) {
      await connection.query("ALTER TABLE customers ADD COLUMN points INT NOT NULL DEFAULT 0");
      console.log('[Migration] Added column points to customers table');
    } else {
      await connection.query("ALTER TABLE customers MODIFY COLUMN points INT NOT NULL DEFAULT 0");
    }

    // 2. Pastikan kolom points di tabel users (jika ada sistem user/cashier yang pakai)
    const [userCols]: any = await connection.query("SHOW COLUMNS FROM users LIKE 'points'");
    if (userCols.length === 0) {
      await connection.query("ALTER TABLE users ADD COLUMN points INT NOT NULL DEFAULT 0");
      console.log('[Migration] Added column points to users table');
    }

    // 3. Pastikan kolom points_used, points_earned, customer_id di tabel transactions
    const [txUsedCol]: any = await connection.query("SHOW COLUMNS FROM transactions LIKE 'points_used'");
    if (txUsedCol.length === 0) {
      await connection.query("ALTER TABLE transactions ADD COLUMN points_used INT NOT NULL DEFAULT 0 AFTER discount_amount");
      console.log('[Migration] Added column points_used to transactions');
    }

    const [txEarnedCol]: any = await connection.query("SHOW COLUMNS FROM transactions LIKE 'points_earned'");
    if (txEarnedCol.length === 0) {
      await connection.query("ALTER TABLE transactions ADD COLUMN points_earned INT NOT NULL DEFAULT 0 AFTER points_used");
      console.log('[Migration] Added column points_earned to transactions');
    }

    const [txCustCol]: any = await connection.query("SHOW COLUMNS FROM transactions LIKE 'customer_id'");
    if (txCustCol.length === 0) {
      await connection.query("ALTER TABLE transactions ADD COLUMN customer_id INT NULL AFTER transaction_id");
      console.log('[Migration] Added column customer_id to transactions');
    }

    // 4. Pastikan kolom points_used & points_earned di mobile_orders
    const [moUsedCol]: any = await connection.query("SHOW COLUMNS FROM mobile_orders LIKE 'points_used'");
    if (moUsedCol.length === 0) {
      await connection.query("ALTER TABLE mobile_orders ADD COLUMN points_used INT NOT NULL DEFAULT 0 AFTER discount_amount");
      console.log('[Migration] Added column points_used to mobile_orders');
    }

    const [moEarnedCol]: any = await connection.query("SHOW COLUMNS FROM mobile_orders LIKE 'points_earned'");
    if (moEarnedCol.length === 0) {
      await connection.query("ALTER TABLE mobile_orders ADD COLUMN points_earned INT NOT NULL DEFAULT 0 AFTER points_used");
      console.log('[Migration] Added column points_earned to mobile_orders');
    }

    // Pastikan kolom tax_amount (PPN 10%) di mobile_orders
    const [moTaxCol]: any = await connection.query("SHOW COLUMNS FROM mobile_orders LIKE 'tax_amount'");
    if (moTaxCol.length === 0) {
      await connection.query("ALTER TABLE mobile_orders ADD COLUMN tax_amount INT NOT NULL DEFAULT 0 AFTER discount_amount");
      console.log('[Migration] Added column tax_amount to mobile_orders');
    }

    // 5. Buat tabel point_logs
    await connection.query(`
      CREATE TABLE IF NOT EXISTS point_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        transaction_id VARCHAR(50) NULL,
        type ENUM('EARN', 'REDEEM', 'VOID_REFUND') NOT NULL,
        points INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_point_logs_user (user_id),
        INDEX idx_point_logs_type (type),
        INDEX idx_point_logs_tx (transaction_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[Migration] Table point_logs verified/created');

    console.log('[Migration] Points & cashback migration completed successfully.');
  } catch (error) {
    console.error('[Migration] Migration error:', error);
    throw error;
  } finally {
    connection.release();
  }
};
