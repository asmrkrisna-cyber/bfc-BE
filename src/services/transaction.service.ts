import pool from '../config/database';
import { calculateRedemption, calculateEarning } from './point.service';

export interface PointsResult {
  earned: number;
  used: number;
  discountAmount: number;
  currentBalance: number;
  isPending: boolean;
}

export interface CreateTransactionParams {
  transactionId: string;
  customerId?: number | null;
  customerName?: string;
  tableNumber?: string;
  subtotal: number;
  discountAmount?: number; // Promo voucher discount
  tax?: number;
  total?: number;
  paymentMethod?: string;
  cashGiven?: number;
  change?: number;
  items: Array<{
    id?: any;
    name?: string;
    product_name?: string;
    price: number;
    quantity: number;
    note?: string;
  }>;
  usePoints?: boolean;
}

/**
 * Membuat transaksi baru dengan proteksi integritas saldo poin & kalkulasi backend.
 * Membungkus operasi potong poin, insert transaksi, insert point_logs, dan tambah poin
 * di dalam MySQL Transaction + SELECT ... FOR UPDATE.
 */
export async function createTransactionService(params: CreateTransactionParams): Promise<{
  success: boolean;
  message: string;
  transactionId: string;
  points: PointsResult;
}> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      transactionId,
      customerId,
      customerName = 'Tamu / Umum',
      tableNumber = '-',
      subtotal = 0,
      discountAmount: promoDiscount = 0,
      tax = 0,
      paymentMethod = 'Cash',
      cashGiven = 0,
      change = 0,
      items = [],
      usePoints = false,
    } = params;

    let pointsUsed = 0;
    let pointDiscountAmount = 0;
    let currentBalance = 0;

    // 1. Jika usePoints aktif dan ada customer terdaftar, lock row user dan hitung diskon
    if (usePoints && customerId) {
      const [userRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ? FOR UPDATE',
        [customerId]
      );

      if (userRows.length > 0) {
        const userBalance = Number(userRows[0].points) || 0;
        const calc = calculateRedemption(userBalance, subtotal);

        pointsUsed = calc.pointsUsed;
        pointDiscountAmount = calc.discountAmount;

        if (pointsUsed > 0) {
          // Potong poin dari saldo pelanggan
          await connection.query(
            'UPDATE customers SET points = points - ? WHERE id = ?',
            [pointsUsed, customerId]
          );

          // Catat log pemakaian poin
          await connection.query(
            `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
             VALUES (?, ?, 'REDEEM', ?, ?, NOW())`,
            [
              customerId,
              transactionId,
              pointsUsed,
              `Tukar ${pointsUsed} Poin (Diskon Rp ${pointDiscountAmount.toLocaleString('id-ID')}) untuk Pesanan #${transactionId}`,
            ]
          );
        }
      }
    }

    // 2. Hitung payableSubtotal dan total akhir transaksi
    const totalDiscount = Number(promoDiscount) + pointDiscountAmount;
    const payableSubtotal = Math.max(0, Number(subtotal) - pointDiscountAmount);
    const finalTotal = Math.max(0, Number(subtotal) - totalDiscount) + Number(tax);

    // 3. Hitung Earning Poin (Cashback 5% = Math.floor(payableSubtotal / 1000) * 5)
    const earnedPoints = calculateEarning(payableSubtotal);

    // Poin hanya otomatis masuk ke saldo jika status pembayaran sudah lunas (PAID / QRIS)
    const isCash = paymentMethod.toLowerCase() === 'cash' || paymentMethod.toLowerCase() === 'tunai';
    const isPending = isCash;

    if (!isPending && earnedPoints > 0 && customerId) {
      await connection.query(
        'UPDATE customers SET points = points + ? WHERE id = ?',
        [earnedPoints, customerId]
      );

      await connection.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'EARN', ?, ?, NOW())`,
        [
          customerId,
          transactionId,
          earnedPoints,
          `Cashback 5% (+${earnedPoints} Poin) dari Pesanan #${transactionId}`,
        ]
      );
    }

    // Ambil saldo akhir customer terkini
    if (customerId) {
      const [finalUserRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ?',
        [customerId]
      );
      if (finalUserRows.length > 0) {
        currentBalance = Number(finalUserRows[0].points) || 0;
      }
    }

    // 4. Insert data transaksi ke tabel transactions
    await connection.query(
      `INSERT INTO transactions 
      (transaction_id, customer_id, customer_name, table_number, subtotal, discount_amount, points_used, points_earned, tax, total, payment_method, cash_given, change_amount, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUKSES', NOW())`,
      [
        transactionId,
        customerId || null,
        customerName,
        tableNumber,
        subtotal,
        totalDiscount,
        pointsUsed,
        earnedPoints,
        tax,
        finalTotal,
        paymentMethod,
        cashGiven,
        change,
      ]
    );

    // 5. Insert item transaksi
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await connection.query(
          `INSERT INTO transaction_items 
          (transaction_id, product_name, price, quantity, note) 
          VALUES (?, ?, ?, ?, ?)`,
          [
            transactionId,
            item.name || item.product_name || 'Item Menu',
            Number(item.price) || 0,
            Number(item.quantity) || 1,
            item.note || '',
          ]
        );
      }
    }

    // 6. Teruskan ke antrian Kitchen Live Tracking
    try {
      const orderSuffix = transactionId ? transactionId.replace(/[^0-9]/g, '').slice(-4) : '';
      const orderNumber = `#BF-${orderSuffix || Math.floor(1000 + Math.random() * 9000)}`;
      const orderType = tableNumber && tableNumber !== '-' ? 'Dine-in' : 'Takeaway';

      const [kResult]: any = await connection.query(
        `INSERT INTO kitchen_orders 
        (order_number, transaction_id, customer_name, source, order_type, table_number, payment_method, status, created_at)
        VALUES (?, ?, ?, 'Kasir', ?, ?, ?, 'Baru', NOW())`,
        [orderNumber, transactionId, customerName, orderType, tableNumber, paymentMethod]
      );

      const kitchenOrderId = kResult.insertId;
      for (const item of items) {
        await connection.query(
          `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
           VALUES (?, ?, ?, ?)`,
          [kitchenOrderId, item.name || item.product_name, item.quantity || 1, item.note || '']
        );
      }
    } catch (kitchenErr) {
      console.warn('Gagal meneruskan ke antrian dapur (non-blocking):', kitchenErr);
    }

    await connection.commit();

    return {
      success: true,
      message: 'Transaksi berhasil disimpan ke database',
      transactionId,
      points: {
        earned: earnedPoints,
        used: pointsUsed,
        discountAmount: pointDiscountAmount,
        currentBalance,
        isPending,
      },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Void transaksi & kembalikan/sesuaikan saldo poin user jika ada.
 */
export async function voidTransactionService(transactionId: string, reason?: string): Promise<{ success: boolean; message: string }> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Ambil data transaksi yang ingin di-void
    const [txRows]: any = await connection.query(
      'SELECT * FROM transactions WHERE transaction_id = ? FOR UPDATE',
      [transactionId]
    );

    if (txRows.length === 0) {
      throw new Error(`Transaksi dengan ID ${transactionId} tidak ditemukan.`);
    }

    const tx = txRows[0];
    if (tx.status === 'VOID') {
      await connection.rollback();
      return { success: true, message: 'Transaksi sudah berstatus VOID sebelumnya.' };
    }

    const customerId = tx.customer_id;
    const pointsUsed = Number(tx.points_used) || 0;
    const pointsEarned = Number(tx.points_earned) || 0;
    const isCash = tx.payment_method?.toLowerCase() === 'cash' || tx.payment_method?.toLowerCase() === 'tunai';

    // 2. Jika ada customer dan pernah pakai poin, KEMBALIKAN saldo poin ke pelanggan
    if (customerId && pointsUsed > 0) {
      await connection.query(
        'UPDATE customers SET points = points + ? WHERE id = ?',
        [pointsUsed, customerId]
      );

      await connection.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
        [
          customerId,
          transactionId,
          pointsUsed,
          `Pengembalian ${pointsUsed} Poin dari Transaksi Void #${transactionId}`,
        ]
      );
    }

    // 3. Jika poin cashback sudah pernah masuk (misal pembayaran non-cash / QRIS), TARIK kembali
    if (customerId && pointsEarned > 0 && !isCash) {
      await connection.query(
        'UPDATE customers SET points = GREATEST(0, points - ?) WHERE id = ?',
        [pointsEarned, customerId]
      );

      await connection.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
        [
          customerId,
          transactionId,
          -pointsEarned,
          `Pembatalan Cashback -${pointsEarned} Poin karena Transaksi Void #${transactionId}`,
        ]
      );
    }

    // 4. Update status transaksi menjadi VOID
    await connection.query(
      'UPDATE transactions SET status = "VOID", void_reason = ? WHERE transaction_id = ?',
      [reason || 'Void oleh Kasir', transactionId]
    );

    // 5. Update kitchen_orders jika ada
    await connection.query(
      'UPDATE kitchen_orders SET status = "Dibatalkan", cancel_reason = ? WHERE transaction_id = ?',
      [`Transaksi Void: ${reason || 'Dibatalkan kasir'}`, transactionId]
    ).catch(() => {});

    // 6. Update mobile_orders jika ada
    await connection.query(
      'UPDATE mobile_orders SET status = "dibatalkan", barista_note = ? WHERE order_id = ?',
      [`Pesanan dibatalkan (Transaksi Void: ${reason || 'Dibatalkan kasir'}).`, transactionId]
    ).catch(() => {});

    await connection.commit();

    return {
      success: true,
      message: 'Transaksi berhasil di-void dan mutasi poin pelanggan telah disesuaikan.',
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
