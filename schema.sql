-- ========================================================
-- BreakFree Coffee POS - Database Schema & Initial Seeds
-- ========================================================

CREATE DATABASE IF NOT EXISTS `breakfree` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `breakfree`;

-- 1. Tabel Users (Admin / Kasir Login)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `role` VARCHAR(50) DEFAULT 'admin',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default user (Format email gmail sesuai validasi Zod login)
INSERT IGNORE INTO `users` (`id`, `username`, `password`, `name`, `role`) VALUES
(1, 'admin@gmail.com', 'admin123', 'Administrator', 'admin'),
(2, 'kasir@gmail.com', 'kasir123', 'Kasir Utama', 'kasir');

-- 2. Tabel Cashiers (Daftar Kasir & PIN Shift)
CREATE TABLE IF NOT EXISTS `cashiers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `pin` VARCHAR(10) NOT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed kasir default
INSERT IGNORE INTO `cashiers` (`id`, `name`, `pin`, `is_active`) VALUES
(1, 'pasha', '1234', 1),
(2, 'chris', '1111', 1),
(3, 'dwi', '2222', 1),
(4, 'adit', '3333', 1);

-- 3. Tabel Products (Daftar Menu Kopi, Non-Kopi, Moctails, Makanan, Snack)
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'Espresso Based',
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `description` TEXT,
  `image` VARCHAR(255) DEFAULT '',
  `is_available` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default products
INSERT IGNORE INTO `products` (`name`, `category`, `price`, `description`, `image`, `is_available`) VALUES
('Ice Kopi Susu', 'Espresso Based', 16000, 'Kopi susu signature creamy khas BreakFree.', '', 1),
('Breakfree Aren Latte', 'Espresso Based', 18000, 'Perpaduan espresso bold dengan gula aren asli pilihan.', '', 1),
('Americano', 'Espresso Based', 14000, 'Espresso double shot segar panas/dingin.', '', 1),
('Caramel Macchiato', 'Espresso Based', 19000, 'Sentuhan rasa manis karamel berpadu espresso lembut.', '', 1),
('Matcha Coffee Latte', 'Espresso Based', 20000, 'Kombinasi matcha premium Jepang dengan shot espresso.', '', 1),
('Hot Coklat Ori', 'Non Coffee', 10000, 'Coklat hangat dengan kakao pekat original.', '', 1),
('Hot Coklat Milk', 'Non Coffee', 12000, 'Coklat hangat lembut dengan susu creamy.', '', 1),
('Matcha Latte', 'Non Coffee', 18000, 'Matcha murni berpadu fresh milk lembut.', '', 1),
('Manggo Orange Twist', 'Moctails', 17000, 'Perpaduan mangga tropis dan jeruk segar dengan sensasi soda dingin yang menyegarkan.', '', 1),
('Grape Fizz', 'Moctails', 17000, 'Kombinasi anggur segar dengan soda berkarbonasi dingin yang melegakan dahaga.', '', 1),
('Nasi Goreng Breakfree', 'Makanan', 22000, 'Nasi goreng racikan spesial dengan telur mata sapi dan acar.', '', 1),
('Mie Goreng Spesial', 'Makanan', 20000, 'Mie goreng gurih khas nusantara lengkap dengan topping.', '', 1),
('Kentang Goreng (French Fries)', 'Snack', 15000, 'Kentang goreng renyah dengan taburan bumbu gurih.', '', 1),
('Cireng Crispy Rujak', 'Snack', 14000, 'Cireng gurih kenyal disajikan dengan bumbu rujak pedas manis.', '', 1);

-- 4. Tabel Discounts (Diskon Kasir)
CREATE TABLE IF NOT EXISTS `discounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `value` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `min_purchase` DECIMAL(12,2) DEFAULT 0.00,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default discount
INSERT IGNORE INTO `discounts` (`code`, `name`, `type`, `value`, `min_purchase`, `is_active`) VALUES
('PROMO10', 'Diskon Grand Opening 10%', 'percentage', 10.00, 30000.00, 1),
('JUMATBERKAH', 'Jumat Berkah Hemat 5rb', 'fixed', 5000.00, 25000.00, 1);

-- 5. Tabel Shifts (Rekap Shift Kasir)
CREATE TABLE IF NOT EXISTS `shifts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `cashier_name` VARCHAR(100) NOT NULL,
  `shift_status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `starting_cash` DECIMAL(12,2) DEFAULT 0.00,
  `closing_cash` DECIMAL(12,2) DEFAULT 0.00,
  `actual_cash` DECIMAL(12,2) DEFAULT 0.00,
  `cash_difference` DECIMAL(12,2) DEFAULT 0.00,
  `note` TEXT,
  `start_time` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `end_time` TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Tabel Transactions (Riwayat Transaksi POS)
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `transaction_id` VARCHAR(50) NOT NULL UNIQUE,
  `customer_name` VARCHAR(100) DEFAULT 'Tamu / Umum',
  `table_number` VARCHAR(20) DEFAULT '-',
  `subtotal` DECIMAL(12,2) DEFAULT 0.00,
  `discount_amount` DECIMAL(12,2) DEFAULT 0.00,
  `discount_name` VARCHAR(100) DEFAULT NULL,
  `tax` DECIMAL(12,2) DEFAULT 0.00,
  `total` DECIMAL(12,2) DEFAULT 0.00,
  `payment_method` VARCHAR(50) DEFAULT 'Cash',
  `cash_given` DECIMAL(12,2) DEFAULT 0.00,
  `change_amount` DECIMAL(12,2) DEFAULT 0.00,
  `status` VARCHAR(20) DEFAULT 'SUKSES',
  `void_reason` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Tabel Transaction Items (Item Produk Transaksi)
CREATE TABLE IF NOT EXISTS `transaction_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `transaction_id` VARCHAR(50) NOT NULL,
  `product_id` INT DEFAULT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `quantity` INT NOT NULL DEFAULT 1,
  `note` VARCHAR(255) DEFAULT '',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Tabel Kitchen Orders (Live Order Tracking Antrian Dapur)
CREATE TABLE IF NOT EXISTS `kitchen_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(50) NOT NULL,
  `transaction_id` VARCHAR(50) NOT NULL,
  `customer_name` VARCHAR(100) DEFAULT 'Tamu / Umum',
  `source` VARCHAR(50) DEFAULT 'Kasir',
  `order_type` VARCHAR(50) DEFAULT 'Dine-in',
  `table_number` VARCHAR(20) DEFAULT '-',
  `payment_method` VARCHAR(50) DEFAULT 'Cash',
  `status` VARCHAR(50) DEFAULT 'Baru',
  `cancel_reason` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. Tabel Kitchen Order Items (Detail Item Dapur)
CREATE TABLE IF NOT EXISTS `kitchen_order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `kitchen_order_id` INT NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `variant` VARCHAR(255) DEFAULT '',
  INDEX (`kitchen_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
