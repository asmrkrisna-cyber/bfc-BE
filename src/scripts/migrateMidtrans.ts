import pool from '../config/database';

/**
 * Migrasi kolom pembayaran Midtrans Payment Gateway pada tabel transactions & mobile_orders.
 * Idempoten dan aman dijalankan berulang kali.
 */
export const runMidtransMigration = async () => {
  const conn = await pool.getConnection();
  try {
    console.log('[Migration] Memulai migrasi kolom Midtrans Payment Gateway...');

    const [trxCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'
    `);
    const trxNames = trxCols.map((c: any) => String(c.COLUMN_NAME).toLowerCase());

    const trxAdditions: Array<[string, string]> = [
      ['midtrans_order_id', 'ALTER TABLE transactions ADD COLUMN midtrans_order_id VARCHAR(120) NULL AFTER transaction_id'],
      ['midtrans_transaction_id', 'ALTER TABLE transactions ADD COLUMN midtrans_transaction_id VARCHAR(120) NULL AFTER midtrans_order_id'],
      ['payment_channel', 'ALTER TABLE transactions ADD COLUMN payment_channel VARCHAR(80) NULL AFTER payment_method'],
      ['payment_status', "ALTER TABLE transactions ADD COLUMN payment_status VARCHAR(40) NULL DEFAULT 'PENDING' AFTER payment_channel"],
      ['snap_token', 'ALTER TABLE transactions ADD COLUMN snap_token VARCHAR(255) NULL AFTER payment_status'],
      ['snap_redirect_url', 'ALTER TABLE transactions ADD COLUMN snap_redirect_url TEXT NULL AFTER snap_token'],
      ['paid_at', 'ALTER TABLE transactions ADD COLUMN paid_at DATETIME NULL AFTER snap_redirect_url'],
    ];

    for (const [col, sql] of trxAdditions) {
      if (!trxNames.includes(col)) {
        await conn.query(sql);
        console.log(`[Migration] transactions.${col} ditambahkan`);
      }
    }

    const [moCols]: any = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mobile_orders'
    `);
    const moNames = moCols.map((c: any) => String(c.COLUMN_NAME).toLowerCase());

    const moAdditions: Array<[string, string]> = [
      ['midtrans_order_id', 'ALTER TABLE mobile_orders ADD COLUMN midtrans_order_id VARCHAR(120) NULL AFTER order_id'],
      ['payment_channel', 'ALTER TABLE mobile_orders ADD COLUMN payment_channel VARCHAR(80) NULL AFTER payment_method'],
      ['payment_status', "ALTER TABLE mobile_orders ADD COLUMN payment_status VARCHAR(40) NULL DEFAULT 'PENDING' AFTER payment_channel"],
      ['snap_token', 'ALTER TABLE mobile_orders ADD COLUMN snap_token VARCHAR(255) NULL AFTER payment_status'],
      ['snap_redirect_url', 'ALTER TABLE mobile_orders ADD COLUMN snap_redirect_url TEXT NULL AFTER snap_token'],
      ['paid_at', 'ALTER TABLE mobile_orders ADD COLUMN paid_at DATETIME NULL AFTER snap_redirect_url'],
    ];

    for (const [col, sql] of moAdditions) {
      if (!moNames.includes(col)) {
        await conn.query(sql);
        console.log(`[Migration] mobile_orders.${col} ditambahkan`);
      }
    }

    console.log('[Migration] Migrasi Midtrans Payment Gateway selesai.');
  } catch (err: any) {
    console.error('[Migration Midtrans Error]:', err.message);
    throw err;
  } finally {
    conn.release();
  }
};

if (require.main === module) {
  runMidtransMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
