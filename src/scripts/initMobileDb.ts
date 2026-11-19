import pool from '../config/database';

/**
 * Script untuk membuat dan memperbarui tabel-tabel khusus aplikasi Mobile langsung ke MySQL
 * tanpa harus menjalankan atau mengimpor ulang seluruh file schema.sql.
 *
 * Menggunakan perintah IF NOT EXISTS dan INSERT IGNORE sehingga:
 * - Tidak akan menimpa data kasir/POS yang sudah ada.
 * - Aman dijalankan berulang kali (Idempotent).
 */
export async function initMobileDatabase(): Promise<void> {
  console.log('🚀 Memulai sinkronisasi tabel mobile ke MySQL database...');

  try {
    // 1. Tambah kolom subcategory dan tag pada tabel products (jika belum ada)
    try {
      await pool.query(`ALTER TABLE products ADD COLUMN subcategory VARCHAR(100) DEFAULT NULL`);
      console.log('  ✓ Kolom "subcategory" berhasil ditambahkan ke tabel products.');
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('  ℹ Kolom "subcategory" sudah ada di tabel products.');
      } else {
        console.warn('  ⚠ Info kolom subcategory:', e.message);
      }
    }

    try {
      await pool.query(`ALTER TABLE products ADD COLUMN tag VARCHAR(100) DEFAULT NULL`);
      console.log('  ✓ Kolom "tag" berhasil ditambahkan ke tabel products.');
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('  ℹ Kolom "tag" sudah ada di tabel products.');
      } else {
        console.warn('  ⚠ Info kolom tag:', e.message);
      }
    }

    // 2. Buat Tabel customers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        phone VARCHAR(30) DEFAULT '0812 •••• 7890',
        password VARCHAR(255) NOT NULL,
        birth_date VARCHAR(50) DEFAULT '18 Mei 2000',
        member_badge VARCHAR(50) DEFAULT 'Member Gold',
        points INT DEFAULT 1240,
        reset_token VARCHAR(100) DEFAULT NULL,
        reset_token_expires DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  ✓ Tabel "customers" siap.');

    // 3. Buat Tabel customer_points_history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_points_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        order_id VARCHAR(50) DEFAULT NULL,
        type ENUM('EARN', 'REDEEM') NOT NULL DEFAULT 'EARN',
        points INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  ✓ Tabel "customer_points_history" siap.');

    // 4. Buat Tabel mobile_orders
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mobile_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL UNIQUE,
        queue_number VARCHAR(20) NOT NULL,
        customer_id INT NOT NULL,
        customer_name VARCHAR(150) NOT NULL,
        counter_name VARCHAR(100) DEFAULT 'Counter Bar 01',
        pickup_type VARCHAR(100) DEFAULT 'Dine-in (Minum di Kafe)',
        status VARCHAR(50) DEFAULT 'diterima',
        total_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        discount_amount DECIMAL(12,2) DEFAULT 0.00,
        payment_method VARCHAR(50) DEFAULT 'QRIS',
        promo_code VARCHAR(50) DEFAULT NULL,
        estimated_minutes INT DEFAULT 8,
        barista_name VARCHAR(100) DEFAULT 'Barista Reza',
        barista_note VARCHAR(255) DEFAULT 'Biji kopi baru diekstrak, sedang menuang susu segar creamy.',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (customer_id),
        INDEX (status),
        INDEX (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  ✓ Tabel "mobile_orders" siap.');

    // 5. Buat Tabel mobile_order_items
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mobile_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL,
        product_id VARCHAR(50) DEFAULT NULL,
        product_name VARCHAR(150) NOT NULL,
        options VARCHAR(255) DEFAULT 'Regular',
        price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        quantity INT NOT NULL DEFAULT 1,
        image VARCHAR(255) DEFAULT '',
        INDEX (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  ✓ Tabel "mobile_order_items" siap.');

    // 6. Masukkan Akun Default Customer (Testing)
    await pool.query(`
      INSERT IGNORE INTO customers (id, name, email, phone, password, birth_date, member_badge, points)
      VALUES 
      (1, 'HAFIZ MAULANA', 'hafizizza@gmail.com', '0812 •••• 7890', 'AnakLuarGerbang', '18 Mei 2000', 'Member Gold', 1240),
      (2, 'HAFIZ MAULANA', 'hafiz.maulana@gmail.com', '0812 •••• 7890', 'AnakLuarGerbang', '18 Mei 2000', 'Member Gold', 1240);
    `);
    console.log('  ✓ Data akun customer awal siap.');

    // 7. Masukkan Riwayat Poin Awal
    await pool.query(`
      INSERT IGNORE INTO customer_points_history (customer_id, order_id, type, points, description)
      VALUES 
      (1, '#BF-0302', 'EARN', 450, 'Cashback Poin dari Pesanan #BF-0302'),
      (1, '#BF-0297', 'EARN', 620, 'Cashback Poin dari Pesanan #BF-0297'),
      (1, NULL, 'EARN', 170, 'Bonus Pendaftaran Member Gold Baru');
    `);
    console.log('  ✓ Data riwayat poin siap.');

    // 8. Masukkan Voucher Diskon Mobile
    await pool.query(`
      INSERT IGNORE INTO discounts (code, name, type, value, min_purchase, is_active)
      VALUES 
      ('BREAK20', 'Voucher Spesial BREAK20 (Diskon 20% maks 10rb)', 'percentage', 20.00, 30000.00, 1),
      ('KOPIKAMPUS', 'Promo Komunitas KopiKampus Diskon 20%', 'percentage', 20.00, 0.00, 1);
    `);
    console.log('  ✓ Voucher promo mobile siap.');

    // 9. Masukkan Contoh Pesanan Aktif untuk Live Tracking
    await pool.query(`
      INSERT IGNORE INTO mobile_orders (id, order_id, queue_number, customer_id, customer_name, counter_name, pickup_type, status, total_price, discount_amount, payment_method, promo_code, estimated_minutes, barista_name, barista_note)
      VALUES (1, '#BF-2849', 'A-14', 1, 'Hafiz Maulana', 'Counter Bar 01', 'Dine-in (Minum di Kafe)', 'diproses', 42000.00, 10000.00, 'QRIS', 'BREAK20', 6, 'Barista Reza', 'Espresso baru selesai diekstrak, sedang menuang susu segar creamy.');
    `);

    await pool.query(`
      INSERT IGNORE INTO mobile_order_items (order_id, product_id, product_name, options, price, quantity, image)
      VALUES 
      ('#BF-2849', 'demo-item-1', 'Breakfree Aren Latte', 'Ice Coffee • Less Sugar • Oatmilk', 25000.00, 1, ''),
      ('#BF-2849', 'demo-item-2', 'French Fries', 'Snack • Saus Sambal & Mayo', 17000.00, 1, '');
    `);
    console.log('  ✓ Contoh pesanan aktif live tracking siap.');

    console.log('\n🎉 Selesai! Seluruh tabel dan data mobile telah berhasil disinkronisasi ke MySQL database.');
  } catch (error: any) {
    console.error('❌ Gagal sinkronisasi database:', error);
  } finally {
    process.exit(0);
  }
}

// Jalankan langsung jika script ini dipanggil via CLI
if (require.main === module) {
  initMobileDatabase();
}
